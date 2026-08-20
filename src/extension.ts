/**
 * CodeNotes 扩展入口：装配全部模块。
 *
 * 生命周期：
 * - activate：读配置 → 创建 NotesCore（含存储定位）→ 注册 UI（装饰/树/状态栏/webview）
 *   → 注册全部命令 → 订阅事件（文档打开/变更/选中 → 锚点重定位 + 重绘）
 * - 对外暴露 CodeNotesApi（其它扩展可编程操作）
 */
import * as vscode from 'vscode';
import { NotesCore } from './core/notesCore';
import { resolveStorage } from './storage/storage';
import { StorageService } from './storage/storageOps';
import { NoteDecorator } from './ui/decorations';
import { NotesTreeProvider } from './ui/treeView';
import { NoteStatusBar } from './ui/statusBar';
import { NoteWebview } from './ui/webview';
import { registerNoteHover } from './ui/hover';
import { registerCommands, Ctx } from './commands';
import { buildApi, CodeNotesApi } from './api';

export async function activate(context: vscode.ExtensionContext): Promise<CodeNotesApi> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    vscode.window.showWarningMessage('CodeNotes 需要打开一个工作区（文件夹）才能使用。');
    return buildNopApi();
  }

  const mode = vscode.workspace.getConfiguration('codenotes.storage').get<'workspace' | 'global'>('mode', 'workspace');
  const storage = new StorageService(folder.uri.fsPath, mode);
  const core = new NotesCore(storage.loc);
  await core.load();

  const output = vscode.window.createOutputChannel('CodeNotes');

  const tree = new NotesTreeProvider(core);
  const treeView = vscode.window.createTreeView('codenotes.notesTree', { treeDataProvider: tree });
  const decorator = new NoteDecorator(core);
  const statusBar = new NoteStatusBar(core);

  // webview 依赖回调（打开代码位置 / 数据变化刷新）
  const webview = new NoteWebview(core, {
    openNoteInEditor: (id) => revealNote(core, id),
    onSaved: () => refreshAll(),
    onRemoved: () => refreshAll(),
  });

  /** 全局刷新回调（命令层每次改动后调用） */
  const refreshAll = (): void => {
    tree.refresh();
    statusBar.update(vscode.window.activeTextEditor);
    for (const ed of vscode.window.visibleTextEditors) decorator.draw(ed);
  };

  const ctx: Ctx = {
    core,
    decorator,
    tree,
    statusBar,
    webview,
    storage,
    output,
    refresh: refreshAll,
    storageRoot: () => storage.root,
  };

  // —— 命令 ——
  const commandDisposables = registerCommands(ctx);

  // —— 事件接线 ——
  const listeners: vscode.Disposable[] = [
    { dispose: core.onChanged(() => refreshAll()) },
    vscode.workspace.onDidOpenTextDocument((doc) => {
      if (doc.uri.scheme !== 'file') return;
      const rel = vscode.workspace.asRelativePath(doc.uri);
      if (core.fileHasNotes(rel)) {
        core.refreshFile(rel, doc.getText().split('\n'));
        refreshAll();
      }
    }),
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.scheme !== 'file') return;
      const rel = vscode.workspace.asRelativePath(e.document.uri);
      if (core.fileHasNotes(rel)) {
        core.reconcileFile(rel, e.document.getText().split('\n'));
        refreshAll();
      }
    }),
    vscode.window.onDidChangeActiveTextEditor((ed) => {
      statusBar.update(ed ?? undefined);
      if (ed) decorator.draw(ed);
    }),
    vscode.window.onDidChangeVisibleTextEditors((eds) => {
      for (const ed of eds) decorator.draw(ed);
    }),
    vscode.window.onDidChangeTextEditorSelection((e) => {
      statusBar.update(e.textEditor);
      decorator.draw(e.textEditor);
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('codenotes.display')) refreshAll();
    }),
  ];

  context.subscriptions.push(
    ...commandDisposables,
    ...listeners,
    treeView,
    ...registerNoteHover(core, context),
    decorator,
    statusBar,
    output
  );

  // 首次激活即渲染当前编辑器
  const active = vscode.window.activeTextEditor;
  if (active) {
    statusBar.update(active);
    decorator.draw(active);
  }

  return buildApi(core, {
    openNote: (id) => webview.open('focus', id),
    setMode: async (m) => {
      const config = vscode.workspace.getConfiguration('codenotes.storage');
      await config.update('mode', m, vscode.ConfigurationTarget.Workspace);
      vscode.window.showInformationMessage('存储模式已更新，请重载窗口生效');
    },
  });
}

export function deactivate(): void {
  /* 所有 dispose 已通过 context.subscriptions 管理 */
}

/** 无工作区时返回一个最小可用 API（避免引用报错） */
function buildNopApi(): CodeNotesApi {
  const none = new NotesCore(resolveStorage(process.cwd(), 'workspace'));
  return buildApi(none, { openNote: () => void 0, setMode: async () => void 0 });
}

/** 跳转并选中笔记锚点代码 */
function revealNote(core: NotesCore, id: string): void {
  const note = core.getNote(id);
  if (!note || !note.anchor) {
    vscode.window.showWarningMessage('该笔记未关联代码');
    return;
  }
  const root = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!root) return;
  void (async () => {
    try {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(root, note.anchor!.uri));
      const ed = await vscode.window.showTextDocument(doc);
      const a = note.anchor!;
      const last = Math.min(a.end, ed.document.lineCount - 1);
      const range = new vscode.Range(a.start, 0, last, ed.document.lineAt(last).text.length);
      ed.selection = new vscode.Selection(range.start, range.end);
      ed.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    } catch (e: any) {
      vscode.window.showWarningMessage(`无法打开锚定文件：${e?.message ?? e}`);
    }
  })();
}