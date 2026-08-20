/**
 * 命令层：把 codenotes.* 命令（package.json contributes.commands）编排到核心与 UI 组件上。
 *
 * 约定：多数命令接受可选的 [noteId] 参数（从树/悬停/装饰链接传入）；无参数时按
 * 「当前选中行/当前文件」的语境工作。全部命令返回后统一刷新 UI。
 */
import * as vscode from 'vscode';
import * as path from 'path';
import { Note } from './types';
import { NotesCore } from './core/notesCore';
import { NoteDecorator } from './ui/decorations';
import { NotesTreeProvider } from './ui/treeView';
import { NoteStatusBar } from './ui/statusBar';
import { NoteWebview } from './ui/webview';
import { absUriOf, relOf } from './util/ws';
import { renderMarkdownReport } from './util/exportMd';
import { migrateStorage, StorageService } from './storage/storageOps';

export interface Ctx {
  /** 数据变化后刷新全部 UI（重绘装饰/树/状态栏） */
  refresh(): void;
  core: NotesCore;
  decorator: NoteDecorator;
  tree: NotesTreeProvider;
  statusBar: NoteStatusBar;
  webview: NoteWebview;
  storage: StorageService;
  storageRoot(): string;
  output: vscode.OutputChannel;
}

/** 当前活动编辑器的选区行区间；无选区则取光标行 */
export function selectionRange(editor: vscode.TextEditor): { start: number; end: number } {
  const sel = editor.selection;
  if (!sel || sel.isEmpty) {
    const l = editor.selection.active.line;
    return { start: l, end: l };
  }
  return { start: Math.min(sel.start.line, sel.end.line), end: Math.max(sel.start.line, sel.end.line) };
}

/** 当前文件行数组（剔除末尾空行） */
export function docLines(editor: vscode.TextEditor): string[] {
  const lines = editor.document.getText().split('\n');
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** 无 noteId 或 id 失效时尝试用「当前选中行上的第一处笔记」兜底 */
function resolveNoteId(core: NotesCore, id?: string, editor?: vscode.TextEditor): string | undefined {
  if (id && core.getNote(id)) return id;
  if (editor) {
    const line = editor.selection.active.line;
    const hit = core.notesOfFile(vscode.workspace.asRelativePath(editor.document.uri)).find(
      (n) => n.anchor && line >= n.anchor.start && line <= n.anchor.end
    );
    if (hit) return hit.id;
  }
  return undefined;
}

function urlEncodeArg(id: string): string {
  return encodeURIComponent(JSON.stringify([id]));
}

export function registerCommands(ctx: Ctx): vscode.Disposable[] {
  const { core } = ctx;
  const cmd = (...args: Parameters<typeof vscode.commands.registerCommand>) =>
    vscode.commands.registerCommand(args[0], args[1]);

  /* ================= 创建类 ================= */

  /** 在选中代码上快速建笔记（右键菜单/命令面板入口） */
  async function quickAdd(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    const { start, end } = selectionRange(editor);
    const title = await vscode.window.showInputBox({
      prompt: '笔记标题',
      placeHolder: '例如：为什么 KV Cache 要分段？',
      validateInput: (v) => (v && v.trim() ? undefined : '标题不能为空'),
    });
    if (!title || !title.trim()) return;
    const clip = (await vscode.env.clipboard.readText()).trim();
    const note = await core.createNote({ title: title.trim(), body: clip && clip.length < 2000 ? clip : '' });
    await core.setAnchor(note.id, vscode.workspace.asRelativePath(editor.document.uri), start, end, docLines(editor));
    ctx.refresh();
    ctx.webview.open('editor', note.id);
  }

  /** AI 对话捕捉：选中代码 → 剪贴板对话 → chat 笔记（自动 tag AI） */
  async function chatCapture(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage('请先打开一个代码文件并选中代码（或把光标放在某行上）');
      return;
    }
    const { start, end } = selectionRange(editor);
    const clipboard = (await vscode.env.clipboard.readText()).trim();
    const title = await vscode.window.showInputBox({
      prompt: 'AI 对话笔记标题',
      value: clipboard ? '' : '与 AI 的讨论',
      placeHolder: '例如：分段注意力为什么省显存',
    });
    if (title === undefined) return;

    let body = '';
    if (clipboard) {
      const useClip = await vscode.window.showInformationMessage(
        `检测到剪贴板内容（${clipboard.length} 字），作为对话正文？`,
        { modal: false },
        '使用剪贴板',
        '手动输入'
      );
      if (useClip === undefined) return;
      if (useClip === '手动输入') {
        const manual = await vscode.window.showInputBox({ prompt: '粘贴 AI 对话（可多行 Markdown）' });
        if (manual === undefined) return;
        body = manual;
      } else {
        body = clipboard;
      }
    }
    if (!body.trim()) {
      const manual = await vscode.window.showInputBox({ prompt: '粘贴 AI 对话（可多行 Markdown）' });
      if (manual === undefined) return;
      body = manual;
    }
    if (!body.trim()) {
      vscode.window.showWarningMessage('对话内容为空，已取消');
      return;
    }

    const note = await core.createNote({ kind: 'chat', title: title.trim() || 'AI 对话', body, tags: ['AI'] });
    await core.setAnchor(note.id, vscode.workspace.asRelativePath(editor.document.uri), start, end, docLines(editor));
    ctx.refresh();
    vscode.window.showInformationMessage('CodeNotes：AI 对话已保存并锚定 → 聚焦视图已打开');
    ctx.webview.open('focus', note.id);
  }

  /** 从 Markdown 文件导入为笔记（kind=file） */
  async function importMd(): Promise<void> {
    const picked = await vscode.window.showOpenDialog({
      canSelectMany: false,
      filters: { Markdown: ['md', 'markdown'] },
      title: '选择要导入为笔记的 Markdown 文件',
    });
    if (!picked || picked.length === 0) return;
    const uri = picked[0];
    const content = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
    const note = await core.createNote({
      kind: 'file',
      title: path.basename(uri.fsPath, path.extname(uri.fsPath)),
      body: content,
    });
    const editor = vscode.window.activeTextEditor;
    if (editor && editor.document.uri.fsPath !== uri.fsPath) {
      const { start, end } = selectionRange(editor);
      await core.setAnchor(note.id, vscode.workspace.asRelativePath(editor.document.uri), start, end, docLines(editor));
    }
    ctx.refresh();
    ctx.webview.open('editor', note.id);
  }

  /* ================= 锚点/定位类 ================= */

  function openNote(noteId?: string): void {
    const id = resolveNoteId(ctx.core, noteId, vscode.window.activeTextEditor);
    if (id) {
      revealNote(id);
      ctx.webview.open('focus', id);
    }
  }

  function editNote(noteId?: string): void {
    const id = resolveNoteId(ctx.core, noteId, vscode.window.activeTextEditor);
    if (id) ctx.webview.open('editor', id);
  }

  function toggleMode(noteId?: string): void {
    const id = resolveNoteId(ctx.core, noteId);
    const note = id ? core.getNote(id) : undefined;
    if (!note) return;
    note.mode = note.mode === 'star' ? 'inline' : note.mode === 'inline' ? 'both' : 'star';
    void core.updateNote(note).then(() => ctx.refresh());
  }

  /** 把笔记锚定到当前选中代码（重新锚定 / 把全局笔记挂上代码） */
  async function moveNote(noteId?: string): Promise<void> {
    const id = resolveNoteId(ctx.core, noteId, vscode.window.activeTextEditor);
    if (!id) {
      // 无上下文：从 quickpick 选一条笔记
      const notes = core.allNotes();
      if (notes.length === 0) {
        vscode.window.showWarningMessage('还没有笔记。先生成一条笔记，再把它锚定到代码。');
        return;
      }
      const pick = await vscode.window.showQuickPick(
        notes.map((n) => ({ label: n.title, description: n.anchor ? n.anchor.uri : '（全局）', id: n.id })),
        { placeHolder: '选择要锚定的笔记' }
      );
      if (!pick) return;
      return moveNote(pick.id);
    }
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage('请先在编辑器中选中（或定位到）要锚定的代码区域');
      return;
    }
    const { start, end } = selectionRange(editor);
    await core.setAnchor(id, vscode.workspace.asRelativePath(editor.document.uri), start, end, docLines(editor));
    ctx.refresh();
    vscode.window.showInformationMessage('CodeNotes：笔记已重新锚定到当前代码');
  }

  async function removeNote(noteId?: string): Promise<void> {
    const id = resolveNoteId(ctx.core, noteId);
    const note = id ? core.getNote(id) : undefined;
    if (!note) return;
    const ans = await vscode.window.showQuickPick(['删除', '取消'], {
      placeHolder: `确认删除「${note.title}」？（正文 md 一并删除，不可恢复）`,
    });
    if (ans !== '删除') return;
    await core.removeNote(note.id);
    ctx.refresh();
  }

  /** 手动触发当前文件锚点重扫（代码改动后笔记没有跟上前可用） */
  function resolveCurrent(): void {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    const r = core.reconcileFile(vscode.workspace.asRelativePath(editor.document.uri), docLines(editor));
    ctx.refresh();
    void vscode.window.showInformationMessage(
      r.unresolved > 0 ? `锚点重扫完成：${r.unresolved} 条仍未定位，可选中代码后「重新锚定」` : '锚点重扫完成：全部已定位'
    );
  }

  function revealNote(id: string): void {
    const note = core.getNote(id);
    if (!note || !note.anchor) return;
    const abs = absUriOf(note.anchor.uri);
    if (!abs) return;
    void (async () => {
      const doc = await vscode.workspace.openTextDocument(abs);
      const ed = await vscode.window.showTextDocument(doc);
      const a = note.anchor!;
      const last = Math.min(a.end, ed.document.lineCount - 1);
      const range = new vscode.Range(a.start, 0, last, ed.document.lineAt(last).text.length);
      ed.selection = new vscode.Selection(range.start, range.end);
      ed.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    })();
  }

  /* ================= 视图/搜索类 ================= */

  function focusView(): void {
    void vscode.commands.executeCommand('workbench.view.extension.codenotes');
  }

  async function searchNotes(): Promise<void> {
    const notes = core.allNotes();
    if (notes.length === 0) {
      vscode.window.showInformationMessage('还没有笔记。选中代码 → 右键 → CodeNotes → 添加笔记或 AI 对话');
      return;
    }
    const pick = await vscode.window.showQuickPick(
      notes.map((n) => {
        const def = core.kinds.get(n.kind);
        const loc = n.anchor
          ? `${n.anchor.uri} L${n.anchor.start + 1}-${n.anchor.end + 1}${n.anchor.status === 'unresolved' ? ' ⚠️' : ''}`
          : '（全局）';
        return {
          label: `${def.emoji ?? '📌'} ${n.title}`,
          description: loc,
          detail: n.tags.length ? `标签：${n.tags.join(', ')}` : undefined,
          id: n.id,
        };
      }),
      { placeHolder: '搜索全部笔记（回车打开）' }
    );
    if (!pick) return;
    openNote(pick.id);
  }

  /* ================= 工具类 ================= */

  /** 复制笔记的代码引用链接（发给同学 / 贴进聊天） */
  async function copyLink(noteId?: string): Promise<void> {
    const id = resolveNoteId(ctx.core, noteId);
    const note = id ? core.getNote(id) : undefined;
    if (!note || !note.anchor) return;
    const a = note.anchor;
    const link = `${a.uri}:L${a.start + 1}${a.end > a.start ? `-${a.end + 1}` : ''}`;
    await vscode.env.clipboard.writeText(link);
    vscode.window.showInformationMessage(`已复制引用：${link}`);
  }

  async function addToGitIgnore(): Promise<void> {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!root) return;
    const gi = vscode.Uri.joinPath(root, '.gitignore');
    let content = '';
    try {
      content = new TextDecoder().decode(await vscode.workspace.fs.readFile(gi));
    } catch {
      /* 无 .gitignore 时新建 */
    }
    if (content.includes('.codenotes/')) {
      vscode.window.showInformationMessage('.codenotes/ 已在 .gitignore 中');
      return;
    }
    const ans = await vscode.window.showQuickPick(['追加到 .gitignore', '取消'], {
      placeHolder: '将 .codenotes/ 追加到 .gitignore（推荐：笔记不进版本管理）',
    });
    if (ans !== '追加到 .gitignore') return;
    const nl = content && !content.endsWith('\n') ? '\n' : '';
    await vscode.workspace.fs.writeFile(
      gi,
      Buffer.from(`${content}${nl}# CodeNotes 个人笔记数据（不入库）\n.codenotes/\n`, 'utf8')
    );
    vscode.window.showInformationMessage('已将 .codenotes/ 加入 .gitignore');
  }

  async function showLocation(): Promise<void> {
    const root = ctx.storage.root;
    try {
      await vscode.env.openExternal(vscode.Uri.file(root));
    } catch {
      vscode.window.showInformationMessage(`笔记存储位置：${root}`);
    }
  }

  /** 切换存储模式（工程内 ⇄ 用户全局），并迁移数据 */
  async function switchStorageMode(): Promise<void> {
    const current = vscode.workspace.getConfiguration('codenotes.storage').get<'workspace' | 'global'>('mode', 'workspace');
    const target = current === 'workspace' ? 'global' : 'workspace';
    const showMode = (m: 'workspace' | 'global') => (m === 'workspace' ? '工程内 .codenotes/' : '用户全局目录');
    const ans = await vscode.window.showQuickPick(
      [
        { label: `切换到 ${showMode(target)} 并迁移现有笔记`, id: 'go' },
        { label: '取消' },
      ],
      { placeHolder: `当前：${showMode(current)}` }
    );
    if (!ans || ans.id !== 'go') return;
    try {
      await migrateStorage(ctx.core, current, target);
      await vscode.workspace.getConfiguration('codenotes.storage').update('mode', target, vscode.ConfigurationTarget.Workspace);
      vscode.window.showInformationMessage(
        `存储模式已切换为 ${showMode(target)}，旧数据保留（可在旧位置手动清理）。窗口即将重载…`
      );
      setTimeout(() => void vscode.commands.executeCommand('workbench.action.reloadWindow'), 1200);
    } catch (e: any) {
      vscode.window.showErrorMessage(`切换失败：${e?.message ?? e}`);
    }
  }

  /** 导出全部笔记为 markdown 报告 */
  async function exportAll(): Promise<void> {
    const uri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.joinPath(vscode.workspace.workspaceFolders?.[0]?.uri ?? vscode.Uri.file(''), 'codenotes-export.md'),
      filters: { Markdown: ['md'] },
    });
    if (!uri) return;
    const md = await renderMarkdownReport(core);
    await vscode.workspace.fs.writeFile(uri, Buffer.from(md, 'utf8'));
    const count = core.allNotes().length;
    vscode.window.showInformationMessage(`已导出 ${count} 条笔记 → ${uri.fsPath}`);
  }

  /* ================= 注册 ================= */
  const registrations: vscode.Disposable[] = [];
  const reg = (id: string, fn: (...args: any[]) => unknown): void => {
    registrations.push(vscode.commands.registerCommand(id, fn));
  };

  reg('codenotes.note.quickAdd', quickAdd);
  reg('codenotes.note.chatCapture', chatCapture);
  reg('codenotes.note.importMd', importMd);
  reg('codenotes.note.open', (id?: string) => openNote(id));
  reg('codenotes.note.edit', (id?: string) => editNote(id));
  reg('codenotes.note.toggleMode', (id?: string) => toggleMode(id));
  reg('codenotes.note.move', (id?: string) => moveNote(id));
  reg('codenotes.note.remove', (id?: string) => removeNote(id));
  reg('codenotes.anchor.resolveCurrent', resolveCurrent);
  reg('codenotes.view.focus', focusView);
  reg('codenotes.search', searchNotes);
  reg('codenotes.link.copy', (id?: string) => copyLink(id));
  reg('codenotes.storage.addToGitIgnore', addToGitIgnore);
  reg('codenotes.storage.showLocation', showLocation);
  reg('codenotes.storage.switchProvider', switchStorageMode);
  reg('codenotes.export.markdown', exportAll);

  return registrations;
}