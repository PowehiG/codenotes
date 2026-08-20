/**
 * NoteStore：.codenotes/store.json 的读写与笔记 CRUD。
 *
 * - 原子写：先写 <store>.tmp 再 rename，避免半截文件损坏数据。
 * - schema 版本化：读入时按版本迁移（迁移函数注册表，向前兼容）。
 * - 正文（.md）独立管理，见 bodyStore。
 *
 * 纯 node 实现，不依赖 vscode API，可直接单测。
 */
import * as path from 'path';
import * as fsp from 'fs/promises';
import { Note, NoteBook, SCHEMA_VERSION } from '../types';
import { StorageLocation } from './storage';

export class NoteStoreError extends Error {}

/** schema 迁移注册表：{ fromVersion: (book) => book } */
const MIGRATIONS: Record<number, (book: any) => any> = {};

export interface LoadResult {
  book: NoteBook;
  /** 存储目录是否刚创建（首次使用） */
  isNew: boolean;
}

export class NoteStore {
  constructor(private readonly loc: StorageLocation) {}

  /** 确保目录存在并加载（首次使用时创建空库） */
  async load(): Promise<LoadResult> {
    const { root, mdDir, storePath } = this.loc;
    await fsp.mkdir(root, { recursive: true });
    await fsp.mkdir(mdDir, { recursive: true });
    try {
      const raw = await fsp.readFile(storePath, 'utf8');
      const parsed = JSON.parse(raw) as any;
      return { book: migrate(parsed), isNew: false };
    } catch (e: any) {
      if (e && e.code === 'ENOENT') {
        const book: NoteBook = { schemaVersion: SCHEMA_VERSION, notes: [] };
        await this.save(book);
        return { book, isNew: true };
      }
      throw new NoteStoreError(`读取笔记库失败: ${e.message}`);
    }
  }

  /** 整体读取（无则返回空库，不落盘） */
  async read(): Promise<NoteBook> {
    const { book } = await this.load();
    return book;
  }

  /** 保存整库（原子写；Linux rename 直接覆盖，Windows 下兜底删旧再改名） */
  async save(book: NoteBook): Promise<void> {
    const tmp = `${this.loc.storePath}.tmp`;
    const dest = this.loc.storePath;
    const data = JSON.stringify(book, null, 2);
    await fsp.writeFile(tmp, data, 'utf8');
    try {
      await fsp.rename(tmp, dest);
    } catch (e: any) {
      if (e && (e.code === 'EEXIST' || e.code === 'EPERM' || e.code === 'EACCES')) {
        await fsp.rm(dest, { force: true });
        await fsp.rename(tmp, dest);
      } else {
        throw e;
      }
    }
  }

  /* ---------- CRUD ---------- */

  async listNotes(): Promise<Note[]> {
    return (await this.read()).notes;
  }

  async addNote(note: Note): Promise<void> {
    const book = await this.read();
    if (book.notes.some((n) => n.id === note.id)) {
      throw new NoteStoreError(`笔记 id 冲突: ${note.id}`);
    }
    book.notes.push(note);
    await this.save(book);
  }

  async updateNote(note: Note): Promise<void> {
    const book = await this.read();
    const i = book.notes.findIndex((n) => n.id === note.id);
    if (i === -1) throw new NoteStoreError(`笔记不存在: ${note.id}`);
    note.updatedAt = Date.now();
    book.notes[i] = note;
    await this.save(book);
  }

  async removeNote(id: string): Promise<boolean> {
    const book = await this.read();
    const before = book.notes.length;
    book.notes = book.notes.filter((n) => n.id !== id);
    if (book.notes.length === before) return false;
    await this.save(book);
    return true;
  }

  /** 以锚点文件（workspace 相对路径）查询笔记 */
  async notesOfFile(relativeUri: string): Promise<Note[]> {
    const book = await this.read();
    return book.notes.filter((n) => n.anchor && n.anchor.uri === relativeUri);
  }

  /** 校验 + 修复正文文件路径（迁移或手工改名后使用） */
  bodyAbsPath(relPath: string): string {
    const base = path.basename(relPath);
    return path.join(this.loc.mdDir, base);
  }
}

/** 处理 schema 版本（迁移），按注册表逐级升级 */
function migrate(parsed: any): NoteBook {
  let book = parsed as NoteBook;
  if (!book || typeof book !== 'object') {
    throw new NoteStoreError('笔记库文件格式错误');
  }
  if (typeof book.schemaVersion !== 'number') {
    throw new NoteStoreError('笔记库缺少 schemaVersion，可能不是 CodeNotes 数据或已被损坏');
  }
  let v = book.schemaVersion;
  while (v < SCHEMA_VERSION) {
    const fn = MIGRATIONS[v];
    if (!fn) throw new NoteStoreError(`缺少从 schema v${v} 到 v${SCHEMA_VERSION} 的迁移函数`);
    book = fn(book);
    v = book.schemaVersion;
  }
  if (v !== SCHEMA_VERSION) throw new NoteStoreError(`不支持的 schema v${v}`);
  return book;
}

/** 导出迁移注册表（供未来版本注册；v1 暂无迁移） */
export function registerMigration(fromVersion: number, fn: (book: any) => any): void {
  MIGRATIONS[fromVersion] = fn;
}

// 仅类型导出用，避免未引用警告
export type { NoteBook };