/**
 * NotesCore：领域核心 —— 不依赖 vscode，可独立测试。
 * 装配 NoteStore（store.json 持久化）+ BodyStore（正文 md）+ NoteKindRegistry + 锚点重定位算法，
 * 向上层提供 CRUD、锚点操作与变更事件；UI 层（装饰/树/命令/webview）全部围绕它搭。
 *
 * 一致性原则：内存中的 book 是唯一真源，写操作直接在内存上改并原子落盘；
 * 磁盘只在 load() 时读入（store 类内部提供 CRUD，但核心走整库 save，简单可靠）。
 */
import {
  AnchorData,
  genId,
  normalizeLine,
  Note,
  NoteBook,
  NoteMode,
  SCHEMA_VERSION,
} from '../types';
import { resolveAnchors } from '../anchor/anchorResolver';
import { BodyStore } from '../storage/bodyStore';
import { NoteStore } from '../storage/noteStore';
import { StorageLocation } from '../storage/storage';
import { NoteKindRegistry } from './registry';

/** 变更事件载荷，UI 订阅刷新 */
export interface ChangedPayload {
  kind: 'note' | 'anchors' | 'body';
  noteId?: string;
  uri?: string;
}

export type ChangeListener = (payload: ChangedPayload) => void;

export interface ReconcileResult {
  changed: boolean;
  unresolved: number;
}

export interface CreateNoteInput {
  kind?: string;
  title: string;
  body?: string;
  tags?: string[];
  mode?: NoteMode;
  anchor?: AnchorData | null;
  extra?: Record<string, unknown>;
}

export class NotesCore {
  store!: NoteStore;
  bodies!: BodyStore;
  readonly kinds = new NoteKindRegistry();

  private book: NoteBook = { schemaVersion: SCHEMA_VERSION, notes: [] };
  private listeners = new Set<ChangeListener>();

  constructor(public loc: StorageLocation) {
    this.store = new NoteStore(loc);
    this.bodies = new BodyStore(loc);
  }

  /** 存储位置迁移（storageOps.migrateStorage 使用）：复制完成后平滑切换 */
  async relocate(loc: StorageLocation): Promise<void> {
    this.loc = loc;
    this.store = new NoteStore(loc);
    this.bodies = new BodyStore(loc);
    await this.load();
  }

  /* ------------- 生命周期 ------------- */

  /** 加载（首次使用时初始化目录与空库；进程内只调用一次） */
  async load(): Promise<void> {
    const { book } = await this.store.load();
    this.book = book;
  }

  /** 订阅变更；返回取消订阅函数 */
  onChanged(fn: ChangeListener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private emit(payload: ChangedPayload): void {
    for (const fn of [...this.listeners]) {
      try {
        fn(payload);
      } catch (e) {
        console.error('[codenotes] listener error', e);
      }
    }
  }

  /* ------------- 查询 ------------- */

  allNotes(): Note[] {
    return [...this.book.notes].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /** 按 workspace 相对路径取该文件的笔记 */
  notesOfFile(uri: string): Note[] {
    return this.book.notes.filter((n) => n.anchor && n.anchor.uri === uri);
  }

  fileHasNotes(uri: string): boolean {
    return this.book.notes.some((n) => n.anchor && n.anchor.uri === uri);
  }

  getNote(id: string): Note | undefined {
    return this.book.notes.find((n) => n.id === id);
  }

  /** 读取笔记正文（md） */
  async readBody(note: Note): Promise<string> {
    return this.bodies.readBody(note.body);
  }

  /* ------------- 写操作（内存真源 + 原子落盘） ------------- */

  /** 新建笔记（含正文）并入库 */
  async createNote(input: CreateNoteInput): Promise<Note> {
    const kind = input.kind ?? 'note';
    const def = this.kinds.get(kind);
    const now = Date.now();
    const id = genId();
    const note: Note = {
      id,
      kind,
      title: input.title.trim() || def.label,
      createdAt: now,
      updatedAt: now,
      body: `md/${id}.md`,
      anchor: input.anchor ?? null,
      mode: input.mode ?? def.defaultMode ?? 'star',
      tags: input.tags ?? [...(def.defaultTags ?? [])],
      extra: input.extra,
    };
    this.book.notes.push(note);
    await this.bodies.writeBody(note.body, input.body ?? '');
    await this.store.save(this.book);
    this.emit({ kind: 'note', noteId: id, uri: note.anchor?.uri });
    return note;
  }

  /** 更新笔记（可选传入新正文） */
  async updateNote(note: Note, body?: string): Promise<void> {
    const i = this.book.notes.findIndex((n) => n.id === note.id);
    if (i === -1) return;
    note.updatedAt = Date.now();
    this.book.notes[i] = note;
    if (body !== undefined) await this.bodies.writeBody(note.body, body);
    await this.store.save(this.book);
    this.emit({ kind: 'note', noteId: note.id, uri: note.anchor?.uri });
  }

  async removeNote(id: string): Promise<void> {
    const note = this.getNote(id);
    if (!note) return;
    this.book.notes = this.book.notes.filter((n) => n.id !== id);
    await this.bodies.removeBody(note.body);
    await this.store.save(this.book);
    this.emit({ kind: 'note', noteId: id, uri: note.anchor?.uri });
  }

  /** 为既有笔记设置/更新锚点（选中代码行时调用） */
  async setAnchor(noteId: string, uri: string, startLine: number, endLine: number, lines: string[]): Promise<void> {
    const note = this.getNote(noteId);
    if (!note) return;
    const maxIdx = Math.max(0, lines.length - 1);
    const start = Math.min(Math.max(0, startLine), maxIdx);
    const end = Math.min(Math.max(start, endLine), maxIdx);
    const anchor: AnchorData = {
      uri,
      start,
      end,
      startText: normalizeLine(lines[start]),
      endText: normalizeLine(lines[end]),
      snippet: lines[start].trim().slice(0, 80),
      status: 'ok',
    };
    note.anchor = anchor;
    await this.store.save(this.book);
    this.emit({ kind: 'anchors', noteId, uri });
  }

  /** 解除锚点（转为全局笔记） */
  async clearAnchor(noteId: string): Promise<void> {
    const note = this.getNote(noteId);
    if (!note) return;
    note.anchor = null;
    await this.store.save(this.book);
    this.emit({ kind: 'anchors', noteId });
  }

  /* ------------- 锚点重定位 ------------- */

  /**
   * 文档内容变化后，对该文件所有笔记做重定位（双端文本匹配 + 窗口搜索 + 全文兜底）。
   * 返回是否有变化与 unresolved 数，UI 据此刷新装饰。
   */
  reconcileFile(uri: string, lines: string[]): ReconcileResult {
    const notes = this.book.notes.filter((n) => n.anchor && n.anchor.uri === uri);
    if (notes.length === 0) return { changed: false, unresolved: 0 };

    const anchors = notes.map((n) => n.anchor as AnchorData);
    const result = resolveAnchors(lines, anchors, 2000);
    let changed = false;
    notes.forEach((n, i) => {
      const next = result.anchors[i];
      const cur = n.anchor;
      if (cur && next && (cur.start !== next.start || cur.end !== next.end || cur.status !== next.status)) {
        changed = true;
        cur.start = next.start;
        cur.end = next.end;
        cur.status = next.status;
      }
    });
    if (changed) {
      void this.store.save(this.book).then(() => this.emit({ kind: 'anchors', uri }));
    }
    return { changed, unresolved: result.unresolvedCount };
  }

  /** 打开文件时轻量刷新（不落盘，仅更新内存状态并通知 UI） */
  refreshFile(uri: string, lines: string[]): void {
    this.reconcileFile(uri, lines);
  }
}