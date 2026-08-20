/**
 * 笔记类型注册表（可扩展点）。
 *
 * 内置 5 种类型，外部（其他扩展或未来版本）可通过 CodeNotes API 的
 * `registerNoteKind` 注册任意新类型，核心层无需改动：
 * 新类型可以带不同的图标、槽位颜色、默认标签与附加命令。
 */
import { NoteMode } from '../types';

export interface NoteKindDef {
  kind: string;
  /** 展示名（侧边栏 / 快速选择） */
  label: string;
  /** 图标字符（emoji，用于树视图与 webview） */
  emoji?: string;
  /** 槽位星标颜色（css 颜色串，multi-color gutter 星标） */
  gutterColor: string;
  defaultMode?: NoteMode;
  defaultTags?: string[];
  /** 该类型专属的额外命令（vscode 命令 id），暂用于 UI 展示 */
  actions?: string[];
}

const DEFAULTS: NoteKindDef[] = [
  { kind: 'note', label: '普通笔记', emoji: '📝', gutterColor: '#4c9aff', defaultMode: 'star' },
  { kind: 'chat', label: 'AI 对话', emoji: '💬', gutterColor: '#b07cff', defaultTags: ['AI'], defaultMode: 'both' },
  { kind: 'link', label: '链接', emoji: '🔗', gutterColor: '#ffab3d', defaultMode: 'inline' },
  { kind: 'todo', label: '待办', emoji: '✅', gutterColor: '#3ecf8e', defaultTags: ['todo'], defaultMode: 'star' },
  { kind: 'file', label: '文档引用', emoji: '📄', gutterColor: '#8ab8ff', defaultMode: 'star' },
];

export class NoteKindRegistry {
  private defs = new Map<string, NoteKindDef>();

  constructor() {
    for (const d of DEFAULTS) this.defs.set(d.kind, d);
  }

  /** 注册或覆盖一个类型（返回是否覆盖了内置） */
  register(def: NoteKindDef): boolean {
    const existed = this.defs.has(def.kind);
    this.defs.set(def.kind, def);
    return existed;
  }

  get(kind: string): NoteKindDef {
    return (
      this.defs.get(kind) ?? {
        kind,
        label: kind,
        emoji: '📌',
        gutterColor: '#9e9e9e',
      }
    );
  }

  all(): NoteKindDef[] {
    return [...this.defs.values()];
  }
}