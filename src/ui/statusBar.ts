/**
 * 状态栏：当前文件笔记数 + 一键搜索全部笔记。
 */
import * as vscode from 'vscode';
import { NotesCore } from '../core/notesCore';

export class NoteStatusBar {
  private item: vscode.StatusBarItem;

  constructor(private readonly core: NotesCore) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.item.command = 'codenotes.search';
  }

  update(editor: vscode.TextEditor | undefined): void {
    if (!editor) {
      this.item.hide();
      return;
    }
    const rel = vscode.workspace.asRelativePath(editor.document.uri);
    const notes = this.core.notesOfFile(rel);
    const unresolved = notes.filter((n) => n.anchor && n.anchor.status === 'unresolved').length;
    const total = this.core.allNotes().length;
    if (total === 0) {
      this.item.hide();
      return;
    }
    this.item.text =
      notes.length > 0
        ? `📌 ${notes.length}${unresolved > 0 ? ` ⚠${unresolved}` : ''}`
        : `☰ ${total}`;
    this.item.tooltip =
      notes.length > 0
        ? `当前文件 ${notes.length} 条笔记${unresolved > 0 ? `（${unresolved} 条未定位）` : ''}，点击搜索全部`
        : `工作区共 ${total} 条笔记，点击搜索`;
    this.item.show();
  }

  dispose(): void {
    this.item.dispose();
  }
}