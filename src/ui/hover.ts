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

      // 同一范围可能同时存在多笔记；去重并固定顺序，避免重复渲染或命中两次同一条
      const seen = new Set<string>();
      const uniqueHits = hits.filter((n) => {
        if (seen.has(n.id)) return false;
        seen.add(n.id);
        return true;
      });

      const parts: string[] = [];
      for (let i = 0; i < uniqueHits.length; i++) {
        const n = uniqueHits[i];
        const def = core.kinds.get(n.kind);
        parts.push(`### ${def.emoji ?? ''} ${escapeMd(n.title)}${n.anchor!.status === 'unresolved' ? ' ⚠️' : ''}`);
        const body = (await core.readBody(n)).trim();
        if (body) {
          // MarkdownString 中的换行会被解析为分段，正文摘要压缩成单行避免撑高浮窗
          const first = body.slice(0, 400).replace(/\r?\n+/g, ' ').trim();
          parts.push(first.length < body.length ? first + ' …' : first);
        }
        const links = [
          `[打开 MD 预览](command:codenotes.note.open?${encode([n.id])})`,
          `[编辑](command:codenotes.note.edit?${encode([n.id])})`,
          `[跳转到代码](command:codenotes.note.revealAnchor?${encode([n.id])})`,
          `[重新锚定](command:codenotes.note.move?${encode([n.id])})`,
          `[复制引用](command:codenotes.link.copy?${encode([n.id])})`,
          `[删除](command:codenotes.note.remove?${encode([n.id])})`,
        ];
        parts.push(`\`${n.tags.join(' ') || '(无标签)'}\`\n\n${links.join(' · ')}`);
        if (i < uniqueHits.length - 1) parts.push('---');
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
