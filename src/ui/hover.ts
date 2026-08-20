/**
 * 悬停预览：鼠标停在锚定代码块上时展示该块的全部笔记（标题 + 正文摘要 + 操作）。
 * 独立于 gutter 星标悬停，覆盖整行范围，允许长文本预览。
 */
import * as vscode from 'vscode';
import { NotesCore } from '../core/notesCore';

export function registerNoteHover(core: NotesCore, ctx: vscode.ExtensionContext): vscode.Disposable[] {
  const provider = vscode.languages.registerHoverProvider({ pattern: '**' }, {
    async provideHover(document: vscode.TextDocument, position: vscode.Position) {
      const rel = vscode.workspace.asRelativePath(document.uri);
      const notes = core.notesOfFile(rel);
      if (notes.length === 0) return undefined;

      const hits = notes.filter((n) => n.anchor && position.line >= n.anchor.start && position.line <= n.anchor.end);
      if (hits.length === 0) return undefined;

      const parts: string[] = [];
      for (const n of hits.slice(0, 3)) {
        const def = core.kinds.get(n.kind);
        parts.push(`### ${def.emoji ?? ''} ${escapeMd(n.title)}${n.anchor!.status === 'unresolved' ? ' ⚠️' : ''}`);
        const body = (await core.readBody(n)).trim();
        if (body) {
          const first = body.slice(0, 400);
          parts.push(first.length < body.length ? first + ' …' : first);
        }
        parts.push(
          `\`${n.tags.join(' ')}\`\n\n` +
            `[打开](command:codenotes.note.open?${encode([n.id])}) · [编辑](command:codenotes.note.edit?${encode([n.id])}) · ` +
            `[重新锚定](command:codenotes.note.move?${encode([n.id])}) · [复制引用](command:codenotes.link.copy?${encode([n.id])})`
        );
        if (hits.length > 1) parts.push('---');
      }
      const md = new vscode.MarkdownString(parts.join('\n\n'), true);
      md.isTrusted = true;
      md.supportThemeIcons = true;
      return new vscode.Hover(md);
    },
  });
  return [provider];
}

function encode(args: unknown[]): string {
  return encodeURIComponent(JSON.stringify(args));
}

function escapeMd(t: string): string {
  return t.replace(/[*_`#]/g, (c) => `\\${c}`);
}