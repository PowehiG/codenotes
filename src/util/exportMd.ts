/**
 * 导出工具：把全部笔记渲染成一份自包含的 Markdown 报告。
 * 每张笔记都带：文件锚点（引用式）、标签、更新时间、正文、代码上下文片段（配置可关）。
 */
import { NotesCore } from '../core/notesCore';
import * as vscode from 'vscode';

export async function renderMarkdownReport(core: NotesCore): Promise<string> {
  const notes = core.allNotes();
  const title = vscode.workspace.getConfiguration('codenotes.export').get<string>('reportTitle', 'CodeNotes 代码笔记导出');
  const quote = vscode.workspace.getConfiguration('codenotes.quote').get<boolean>('enabled', true);

  const lines: string[] = [`# ${title}`, '', `> 共 ${notes.length} 条笔记 · 导出时间：${new Date().toLocaleString()}`, ''];

  // 排序：按文件 → 行号
  const sorted = [...notes].sort((a, b) => {
    const au = a.anchor?.uri ?? '～全局';
    const bu = b.anchor?.uri ?? '～全局';
    if (au !== bu) return au.localeCompare(bu);
    return (a.anchor?.start ?? 0) - (b.anchor?.start ?? 0);
  });

  let lastFile = '';
  for (const n of sorted) {
    const file = n.anchor ? n.anchor.uri : '（全局笔记）';
    if (file !== lastFile) {
      lines.push(`## ${file}`);
      lastFile = file;
    }
    const def = core.kinds.get(n.kind);
    const lineRef = n.anchor ? ` L${n.anchor.start + 1}${n.anchor.end > n.anchor.start ? '-' + (n.anchor.end + 1) : ''}` : '';
    lines.push('');
    lines.push(`### ${def.emoji ?? '📌'} ${n.title} ${lineRef}${n.anchor && n.anchor.status === 'unresolved' ? ' ⚠️' : ''}`);
    const tagPart = n.tags.length ? ` · 标签：\`${n.tags.join('、')}\`` : '';
    lines.push(`> 类型：${def.label}${tagPart} · 更新：${new Date(n.updatedAt).toLocaleString()}`);
    const body = (await core.readBody(n)).trim();
    lines.push('');
    lines.push(body || '_（空）_');
    if (quote && n.anchor) {
      const snippet = await codeSnippet(n.anchor.uri, n.anchor.start, n.anchor.end);
      if (snippet) {
        lines.push('', '```text');
        lines.push(...snippet.split('\n'));
        lines.push('```');
      }
    }
    lines.push('');
  }
  return lines.join('\n');
}

/** 读取锚点代码片段（带行号） */
async function codeSnippet(relUri: string, start: number, end: number): Promise<string | undefined> {
  try {
    const doc = await vscode.workspace.openTextDocument(resolveAbs(relUri));
    const s = Math.max(0, start);
    const e = Math.min(end, doc.lineCount - 1);
    const out: string[] = [];
    for (let i = s; i <= e; i++) out.push(`${i + 1}  ${doc.lineAt(i).text}`);
    return out.join('\n');
  } catch {
    return undefined;
  }
}

function resolveAbs(rel: string): vscode.Uri {
  const folders = vscode.workspace.workspaceFolders;
  const root = folders?.[0]?.uri ?? vscode.Uri.file('');
  return vscode.Uri.joinPath(root, rel);
}