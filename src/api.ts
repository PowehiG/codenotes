/**
 * CodeNotes 对外 API：供其他扩展（或插件化能力）集成。通过 extension.activate() 返回值获取。
 *
 * 主要扩展点：
 * - registerNoteKind：注册新笔记类型（图标/槽位颜色/默认模式/标签）
 * - createNote / anchorNote / openNote：编程式创建与定位
 * - onNotesChanged：订阅笔记数据变更（联动、指数同步等）
 */
import * as vscode from 'vscode';
import { NotesCore, CreateNoteInput } from './core/notesCore';
import { NoteKindDef, NoteKindRegistry } from './core/registry';
import { Note } from './types';

export interface CodeNotesApi {
  /** 注册自定义笔记类型（返回注销句柄） */
  registerNoteKind(def: NoteKindDef): vscode.Disposable;

  /** 完整类型列表（含内置） */
  kinds(): NoteKindDef[];

  /** 查询某文件（绝对 Uri）下关联的全部笔记 */
  notesOfFile(uri: vscode.Uri): Note[];

  /** 工作区全部笔记（按更新时间倒序） */
  allNotes(): Note[];

  /** 编程式创建笔记（可带锚点与正文） */
  createNote(input: CreateNoteInput): Promise<Note>;

  /** 更新笔记（可选替换正文） */
  updateNote(note: Note, body?: string): Promise<void>;

  removeNote(id: string): Promise<void>;

  /** 将笔记锚定到指定文件的某行区间 */
  anchorNote(noteId: string, uri: vscode.Uri, startLine: number, endLine: number): Promise<void>;

  /** 打开笔记聚焦视图 */
  openNote(id: string): void;

  /** 切换存储模式（workspace ⇄ global），数据自动迁移 */
  setStorageMode(mode: 'workspace' | 'global'): Promise<void>;

  /** 订阅笔记数据变更（新增/删除/锚点移动） */
  onNotesChanged(listener: () => void): vscode.Disposable;
}

export function buildApi(
  core: NotesCore,
  hooks: {
    openNote: (id: string) => void;
    setMode: (mode: 'workspace' | 'global') => Promise<void>;
  }
): CodeNotesApi {
  const listeners = new Set<() => void>();
  core.onChanged(() => {
    for (const fn of [...listeners]) {
      try {
        fn();
      } catch {
        /* 忽略单个监听器错误 */
      }
    }
  });
  return {
    registerNoteKind(def) {
      core.kinds.register(def);
      return { dispose: () => void 0 };
    },
    kinds: () => core.kinds.all(),
    notesOfFile: (uri) => core.notesOfFile(vscode.workspace.asRelativePath(uri)),
    allNotes: () => core.allNotes(),
    createNote: (input) => core.createNote(input),
    updateNote: (note, body) => core.updateNote(note, body),
    removeNote: (id) => core.removeNote(id),
    anchorNote: async (noteId, uri, startLine, endLine) => {
      const rel = vscode.workspace.asRelativePath(uri);
      const doc = await vscode.workspace.openTextDocument(uri);
      const lines = doc.getText().split('\n');
      await core.setAnchor(noteId, rel, startLine, endLine, lines);
    },
    openNote: (id) => hooks.openNote(id),
    setStorageMode: (mode) => hooks.setMode(mode),
    onNotesChanged: (listener) => {
      listeners.add(listener);
      return { dispose: () => listeners.delete(listener) };
    },
  };
}

export type { NoteKindDef, NoteKindRegistry };