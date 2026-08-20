/**
 * CodeNotes 数据模型（带版本号的 schema）
 *
 * 设计原则：
 * - store.json 只存「元数据 + 锚点」，笔记正文独立存 `.codenotes/md/<id>.md`，
 *   便于用户直接打开编辑正文、外部工具消费、未来迁移。
 * - 锚点采用「行号 + 首/末行规范化文本」双保险：代码漂移时可用文本找回。
 * - 所有字段对未来类型扩展开放：`kind` 可任意字符串，`extra` 为自由扩展字段。
 */

/** 内置笔记类型；外部扩展可通过 registerNoteKind 注册任意字符串 kind */
export const BUILTIN_KINDS = ['note', 'chat', 'link', 'todo', 'file'] as const;
export type BuiltinKind = (typeof BUILTIN_KINDS)[number];

/** 锚点状态：ok=已定位；unresolved=代码漂移后未找到（需手动重锚） */
export type AnchorStatus = 'ok' | 'unresolved';

/** 呈现模式：star=仅在行号旁显示星标；inline=行内幽灵注释；both=两者 */
export type NoteMode = 'star' | 'inline' | 'both';

/**
 * 代码锚点。行号一律 0-based（VSCode 里显示时 +1）。
 * uri 为 workspace 相对路径（正斜杠），保证跨机器稳定。
 */
export interface AnchorData {
  /** workspace 相对路径，如 "python/sglang/srt/layers/attention.py" */
  uri: string;
  /** 锚定起始行（0-based，含） */
  start: number;
  /** 锚定结束行（0-based，含） */
  end: number;
  /** 首行「规范化文本」（去空白后取前 120 字符），用于代码漂移后的找回 */
  startText: string;
  /** 末行规范化文本，双端校验更稳 */
  endText: string;
  /** 首行原始文本片段（截断 80 字符），用于展示 */
  snippet: string;
  /** 定位状态 */
  status: AnchorStatus;
}

/** 一条笔记的元数据（正文在独立 md 文件中） */
export interface Note {
  id: string;
  kind: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  /** 正文 .md 相对 .codenotes 根目录的路径，如 "md/a1b2.md" */
  body: string;
  /** 锚点；null 表示「全局笔记」（未关联代码） */
  anchor: AnchorData | null;
  mode: NoteMode;
  tags: string[];
  /** 扩展字段：具体 kind 可放置自定义数据 */
  extra?: Record<string, unknown>;
}

/** 整个仓库（notebook）文件 */
export interface NoteBook {
  schemaVersion: number;
  notes: Note[];
}

export const SCHEMA_VERSION = 1;

/** 空的新建笔记（尚未写入正文） */
export function createEmptyNote(): Note {
  const id = genId();
  const now = Date.now();
  return {
    id,
    kind: 'note',
    title: '未命名笔记',
    createdAt: now,
    updatedAt: now,
    body: `md/${id}.md`,
    anchor: null,
    mode: 'star',
    tags: [],
  };
}

/** 生成短随机 id（时间戳 36 进制 + 随机段） */
export function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/** 规范化文本：全部空白移除（含换行），供稳定匹配 */
export function normalizeLine(text: string, max = 120): string {
  const t = text.replace(/\s+/g, '').toLowerCase();
  return t.slice(0, max);
}

/** 生成展示用片段：trim 后截断 */
export function snippetOf(text: string, max = 80): string {
  const t = text.trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

/** 以 id 查笔记（无则 undefined） */
export function findNote(book: NoteBook, id: string): Note | undefined {
  return book.notes.find((n) => n.id === id);
}