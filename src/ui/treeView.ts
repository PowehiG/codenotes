/**
 * 侧边栏视图：按「文件 → 笔记」两级组织。
 * - 文件节点：相对路径 + 该文件笔记数
 * - 笔记节点：emoji + 标题，⌜ 驱动 re-anchor
 * 点击笔记 → 跳转代码位置并打开焦点视图。
 */
import * as vscode from 'vscode';
import { Note } from '../types';
import { NotesCore } from '../core/notesCore';

export class NotesTreeProvider implements vscode.TreeDataProvider<TreeItem> {
  private _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  constructor(private readonly core: NotesCore) {}

  refresh(): void {
    this._onDidChange.fire();
  }

  getTreeItem(element: TreeItem): vscode.TreeItem {
    if (element.kind === 'file') {
      const uri = element.uri ?? '';
      const notes = element.notes ?? [];
      const item = new vscode.TreeItem(uri, vscode.TreeItemCollapsibleState.Expanded);
      item.description = `${notes.length.toString()} 条`;
      item.iconPath = new vscode.ThemeIcon('file-code');
      item.contextValue = 'codenotesFile';
      item.tooltip = `CodeNotes · ${uri}`;
      return item;
    }
    const n = element.note!;
    const def = this.core.kinds.get(n.kind);
    const item = new vscode.TreeItem(
      `${def.emoji ?? '📌'} ${n.title}${n.anchor && n.anchor.status === 'unresolved' ? ' ⚠️' : ''}`,
      vscode.TreeItemCollapsibleState.None
    );
    item.id = `note:${n.id}`;
    item.iconPath = new vscode.ThemeIcon(n.anchor ? 'gist' : 'book');
    item.contextValue = 'codenotesNote';
    item.tooltip = buildTooltip(n, def.label);
    if (n.anchor) {
      item.command = {
        command: 'codenotes.note.open',
        title: '打开笔记',
        arguments: [n.id],
      };
    }
    return item;
  }

  async getChildren(element?: TreeItem): Promise<TreeItem[]> {
    const notes = this.core.allNotes();
    if (!element) {
      // 根：按文件分组（含全局笔记组）
      const byFile = new Map<string, Note[]>();
      const global: Note[] = [];
      for (const n of notes) {
        if (n.anchor) {
          const arr = byFile.get(n.anchor.uri) ?? [];
          arr.push(n);
          byFile.set(n.anchor.uri, arr);
        } else {
          global.push(n);
        }
      }
      const files: TreeItem[] = [];
      for (const [uri, ns] of byFile) {
        files.push({ kind: 'file', uri, notes: ns } as TreeItem);
      }
      files.sort((a, b) => (a.uri ?? '').localeCompare(b.uri ?? ''));
      if (global.length > 0) {
        files.push({ kind: 'file', uri: '（全局笔记）', notes: global } as TreeItem);
      }
      return files;
    }
    if (element.kind === 'file') {
      return (element.notes ?? []).map((n) => ({ kind: 'note', note: n } as TreeItem));
    }
    return [];
  }
}

interface TreeItem {
  kind: 'file' | 'note';
  uri?: string;
  notes?: Note[];
  note?: Note;
}

function buildTooltip(n: Note, kindLabel: string): vscode.MarkdownString {
  const md = new vscode.MarkdownString('', true);
  md.appendMarkdown(`**${n.title}**\n\n`);
  md.appendMarkdown(`类型：${kindLabel}`);
  if (n.tags.length) md.appendMarkdown(` · 标签：\`${n.tags.join(' ')}\``);
  if (n.anchor) {
    const a = n.anchor;
    md.appendMarkdown(`\n锚点：\`${a.uri}\` ${a.start + 1}-${a.end + 1} 行 ${a.status === 'unresolved' ? '⚠️ 未定位' : '✅'}`);
  }
  md.appendMarkdown(`\n创建：${new Date(n.createdAt).toLocaleString()}`);
  return md;
}