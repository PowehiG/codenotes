/**
 * 装饰层：把笔记「画」在编辑器上，但从不写入文档 → git 完全无感。
 *
 * - 星标：行号旁 ★（按笔记类型着色；unresolved 为灰色），悬停显示标题
 * - 行内幽灵注释：行尾追加「💬 标题」（纯渲染不落盘，可在设置中开关）
 * - 锚定行浅色高亮，光标所在锚定行更明显
 */
import * as vscode from 'vscode';
import { Note } from '../types';
import { NotesCore } from '../core/notesCore';
import { NoteKindDef } from '../core/registry';

/** 生成指定颜色的 SVG 星标（data URI），作为 gutter 图标 */
function starSvgDataUri(color: string, dim = false): vscode.Uri {
  const fill = dim ? '#98a0a8' : color;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">` +
    `<path d="M8 1.2 L9.9 5.4 L14.5 5.9 L11.1 9.1 L12.2 13.7 L8 11.5 L3.8 13.7 L4.9 9.1 L1.5 5.9 L6.1 5.4 Z" ` +
    `fill="${fill}" stroke="rgba(255,255,255,0.85)" stroke-width="0.8"/></svg>`;
  return vscode.Uri.parse(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
}

export class NoteDecorator {
  private starTypes = new Map<string, vscode.TextEditorDecorationType>();
  private inlineType: vscode.TextEditorDecorationType;
  private highlightType: vscode.TextEditorDecorationType;
  private activeType: vscode.TextEditorDecorationType;

  constructor(private readonly core: NotesCore) {
    this.inlineType = vscode.window.createTextEditorDecorationType({
      after: { color: '#8a8f98', fontStyle: 'italic' },
      rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
    });
    this.highlightType = vscode.window.createTextEditorDecorationType({
      backgroundColor: 'rgba(96,125,255,0.05)',
      isWholeLine: true,
      rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
    });
    this.activeType = vscode.window.createTextEditorDecorationType({
      backgroundColor: 'rgba(96,125,255,0.13)',
      isWholeLine: true,
      rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
    });
  }

  /** 为单个编辑器整体重绘（调用前确保该文件笔记已 reconcile 到最新） */
  draw(editor: vscode.TextEditor): void {
    const rel = vscode.workspace.asRelativePath(editor.document.uri);
    const notes = this.core.notesOfFile(rel);
    if (notes.length === 0) {
      this.clear(editor);
      return;
    }
    const cfg = vscode.workspace.getConfiguration('codenotes.display');
    const wantStar = cfg.get<boolean>('showGutterStar', true);
    const wantInline = cfg.get<boolean>('inlinePreview', false);
    const wantHighlight = cfg.get<boolean>('highlightAnchoredLines', true);
    const maxLen = cfg.get<number>('inlineMaxLength', 40);

    const stars = new Map<string, vscode.DecorationOptions[]>();
    const inline: vscode.DecorationOptions[] = [];
    const highlights: vscode.DecorationOptions[] = [];

    const lineCount = editor.document.lineCount;
    for (const n of notes) {
      const a = n.anchor;
      if (!a || a.start < 0 || a.start >= lineCount) continue;

      const line = editor.document.lineAt(a.start);
      const lineRange = new vscode.Range(a.start, 0, a.start, line.text.length);

      if (wantStar) {
        const key = a.status === 'unresolved' ? `${n.kind}:unresolved` : n.kind;
        let arr = stars.get(key);
        if (!arr) {
          arr = [];
          stars.set(key, arr);
        }
        const noteReference = new vscode.MarkdownString();
        noteReference.appendMarkdown(
          `${this.kindOf(n).emoji ?? ''} **${escapeTitle(n.title)}**\n\n` +
            (a.status === 'unresolved' ? '_⚠️ 代码漂移后未定位，点击行内命令重新锚定_\n\n' : '') +
            `[打开笔记](command:codenotes.note.open?${encodeURIComponent(JSON.stringify([n.id]))}) · ` +
            `[编辑](command:codenotes.note.edit?${encodeURIComponent(JSON.stringify([n.id]))}) · ` +
            `[移动锚点](command:codenotes.note.move?${encodeURIComponent(JSON.stringify([n.id]))})`
        );
        noteReference.isTrusted = true;
        arr.push({ range: lineRange, hoverMessage: noteReference });
      }

      if (wantInline && (n.mode === 'inline' || n.mode === 'both')) {
        const glyph = `${this.kindOf(n).emoji} ${n.title}`.slice(0, maxLen);
        inline.push({
          range: lineRange,
          renderOptions: { after: { contentText: ` // ${glyph}`, color: '#8f94a0', fontStyle: 'italic' } },
        });
      }

      if (wantHighlight && a.status === 'ok') {
        const endLine = Math.min(a.end, lineCount - 1);
        highlights.push({
          range: new vscode.Range(a.start, 0, endLine, editor.document.lineAt(endLine).text.length),
        });
      }
    }

    for (const [key, arr] of stars) editor.setDecorations(this.starType(key), arr);
    for (const [key, t] of this.starTypes) {
      if (!stars.has(key)) editor.setDecorations(t, []);
    }
    editor.setDecorations(this.inlineType, inline);
    editor.setDecorations(this.highlightType, highlights);
    this.drawActiveLine(editor);
  }

  /** 光标所在锚定行显示「当前行」强调 */
  private drawActiveLine(editor: vscode.TextEditor): void {
    const sel = editor.selection;
    if (!sel || sel.isEmpty) {
      editor.setDecorations(this.activeType, []);
      return;
    }
    const notes = this.core.notesOfFile(vscode.workspace.asRelativePath(editor.document.uri));
    const hit = notes.find((n) => n.anchor && sel.start.line >= n.anchor.start && sel.start.line <= n.anchor.end);
    if (hit) {
      const a = hit.anchor!;
      const endLine = Math.min(a.end, editor.document.lineCount - 1);
      editor.setDecorations(this.activeType, [
        new vscode.Range(a.start, 0, endLine, editor.document.lineAt(endLine).text.length),
      ]);
    } else {
      editor.setDecorations(this.activeType, []);
    }
  }

  clear(editor: vscode.TextEditor): void {
    for (const t of this.starTypes.values()) editor.setDecorations(t, []);
    editor.setDecorations(this.inlineType, []);
    editor.setDecorations(this.highlightType, []);
    editor.setDecorations(this.activeType, []);
  }

  dispose(): void {
    for (const t of this.starTypes.values()) t.dispose();
    this.inlineType.dispose();
    this.highlightType.dispose();
    this.activeType.dispose();
  }

  private starType(key: string): vscode.TextEditorDecorationType {
    let t = this.starTypes.get(key);
    if (!t) {
      const unresolved = key.endsWith(':unresolved');
      const kind = unresolved ? key.slice(0, -':unresolved'.length) : key;
      t = vscode.window.createTextEditorDecorationType({
        gutterIconPath: starSvgDataUri(this.kindDef(kind).gutterColor, unresolved),
        gutterIconSize: 'contain',
      });
      this.starTypes.set(key, t);
    }
    return t;
  }

  private kindOf(n: Note): NoteKindDef {
    return this.kindDef(n.kind);
  }

  private kindDef(kind: string): NoteKindDef {
    return this.core.kinds.get(kind);
  }
}

function escapeTitle(t: string): string {
  return t.replace(/[*_`[\]]/g, (c) => `\\${c}`);
}