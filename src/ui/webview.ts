/**
 * Webview 面板：
 * - editor：笔记编辑器 —— 标题 / 类型 / 显示模式 / 标签 / 正文（textarea + 预览切换）
 * - focus：聚焦视图 —— 「笔记渲染在锚点代码块上方」的沉浸式阅读
 *
 * 安全：所有 markdown 先 HTML 转义再渲染；链接仅放行 http(s) 外部链接与的内置按钮。
 */
import * as vscode from 'vscode';
import * as path from 'path';
import { NotesCore } from '../core/notesCore';
import { absUriOf } from '../util/ws';

export type PanelView = 'editor' | 'focus';

/** webview 内联的极简 markdown → html 渲染器（普通 JS 字符串，注入面板） */
const MD_RENDER_JS = String.raw`
function mdRender(src){
  var esc = function(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); };
  var inline = function(s){
    var t = esc(s);
    t = t.replace(/\`([^\`]+)\`/g,'<code>$1</code>');
    t = t.replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>');
    t = t.replace(/\*([^*]+)\*/g,'<em>$1</em>');
    t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,'<a href="$2" target="_blank" rel="noopener">$1</a>');
    return t;
  };
  var lines = String(src).split(/\r?\n/);
  var out = [];
  var inCode = false, inQuote = false, list = false;
  for (var i = 0; i < lines.length; i++) {
    var raw = lines[i];
    var t = raw.trim();
    if (t.indexOf('\`\`\`') === 0) { if (inCode) out.push('</pre>'); else out.push('<pre>'); inCode = !inCode; continue; }
    if (inCode) { out.push(esc(raw)); continue; }
    if (!t) {
      if (list) { out.push('</ul>'); list = false; }
      if (inQuote) { out.push('</blockquote>'); inQuote = false; }
      out.push('');
      continue;
    }
    var hm = t.match(/^(#{1,3})\s+(.*)$/);
    if (hm) { out.push('<h' + (hm[1].length + 2) + '>' + inline(hm[2]) + '</h' + (hm[1].length + 2) + '>'); continue; }
    if (t.indexOf('- ') === 0 || /^\d+\.\s/.test(t)) {
      if (!list) out.push('<ul>');
      list = true;
      out.push('<li>' + inline(t.replace(/^(?:- |\d+\.\s)/, '')) + '</li>');
      continue;
    }
    if (t.indexOf('>') === 0) {
      if (!inQuote) out.push('<blockquote>');
      inQuote = true;
      out.push(inline(t.replace(/^>\s?/, '')));
      continue;
    }
    if (list) { out.push('</ul>'); list = false; }
    if (inQuote) { out.push('</blockquote>'); inQuote = false; }
    out.push('<p>' + inline(t) + '</p>');
  }
  if (inCode) out.push('</pre>');
  if (list) out.push('</ul>');
  if (inQuote) out.push('</blockquote>');
  return out.join('\n');
}
`;

export class NoteWebview {
  private panel: vscode.WebviewPanel | undefined;
  private current: { view: PanelView; noteId: string } = { view: 'editor', noteId: '' };

  constructor(
    private readonly core: NotesCore,
    private readonly hooks: {
      openNoteInEditor: (noteId: string) => void;
      onSaved: (noteId: string) => void;
      onRemoved: (noteId: string) => Promise<boolean> | boolean;  // 返回 true=已确认删除
      storageRoot: () => string;
    }
  ) {}

  open(view: PanelView, noteId: string): void {
    const note = this.core.getNote(noteId);
    if (!note) return;
    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel(
        'codenotes',
        'CodeNotes',
        vscode.ViewColumn.Beside,
        { enableScripts: true, retainContextWhenHidden: true }
      );
      this.panel.webview.html = this.shellHtml();
      this.panel.onDidDispose(() => {
        this.panel = undefined;
      });
      this.panel.webview.onDidReceiveMessage((msg) => void this.onMessage(msg));
    }
    this.current = { view, noteId };
    this.panel.title = view === 'editor' ? `CodeNotes · ${note.title}` : 'CodeNotes 聚焦视图';
    void this.pushInit();
    void this.panel.reveal(vscode.ViewColumn.Beside);
  }

  private async pushInit(): Promise<void> {
    if (!this.panel) return;
    const note = this.core.getNote(this.current.noteId);
    if (!note) return;
    const body = await this.core.readBody(note);
    const def = this.core.kinds.get(note.kind);

    let anchorView: { uri: string; start: number; end: number; code: string[]; status: string } | null = null;
    if (note.anchor) {
      const abs = absUriOf(note.anchor.uri);
      if (abs) {
        try {
          const doc = await vscode.workspace.openTextDocument(abs);
          const a = note.anchor;
          const start = Math.max(0, a.start);
          const end = Math.min(a.end, doc.lineCount - 1);
          const code: string[] = [];
          for (let i = start; i <= end; i++) code.push(`${i + 1}  ${doc.lineAt(i).text}`);
          anchorView = { uri: note.anchor.uri, start: a.start + 1, end: a.end + 1, code, status: a.status };
        } catch {
          anchorView = null;
        }
      }
    }

    await this.panel.webview.postMessage({
      type: 'init',
      payload: {
        view: this.current.view,
        note: {
          id: note.id,
          title: note.title,
          kind: note.kind,
          kindLabel: def.label,
          kindEmoji: def.emoji ?? '📌',
          tags: note.tags,
          mode: note.mode,
          createdAt: note.createdAt,
          updatedAt: note.updatedAt,
          body,
        },
        kinds: this.core.kinds.all().map((k) => ({ kind: k.kind, label: k.label })),
        anchor: anchorView,
      },
    });
  }

  private async onMessage(msg: any): Promise<void> {
    if (!msg || !this.panel) return;
    const note = this.core.getNote(this.current.noteId);
    if (!note) return;
    switch (msg.type) {
      case 'save': {
        const p = msg.payload ?? {};
        note.title = (p.title ?? note.title).trim() || note.title;
        if (typeof p.kind === 'string' && this.core.kinds.get(p.kind)) note.kind = p.kind;
        if (typeof p.mode === 'string' && ['star', 'inline', 'both'].includes(p.mode)) note.mode = p.mode;
        if (Array.isArray(p.tags)) note.tags = p.tags;
        await this.core.updateNote(note, typeof p.body === 'string' ? p.body : undefined);
        vscode.window.showInformationMessage('保存成功');
        await this.panel.webview.postMessage({ type: 'saved' });
        this.hooks.onSaved(note.id);
        await this.pushInit();
        break;
      }
      case 'openFile':
        this.openMarkdownPreviewOfNote(note);
        break;
      case 'editor':
        this.current = { view: 'editor', noteId: note.id };
        this.panel.title = `CodeNotes · ${note.title}`;
        await this.pushInit();
        break;
      case 'unanchor':
        await this.core.clearAnchor(note.id);
        await this.pushInit();
        break;
      case 'remove': {
        // 删除确认放到主进程侧处理，避免 webview confirm() 在部分环境被拦截无响应
        const confirmed = await this.hooks.onRemoved(note.id);
        if (confirmed) this.panel?.dispose();
        break;
      }
      default:
        break;
    }
  }

  private async openMarkdownPreviewOfNote(note: import('../types').Note): Promise<void> {
    const mdPath = path.join(this.hooks.storageRoot(), note.body);
    const uri = vscode.Uri.file(path.resolve(mdPath));
    try {
      // 在侧栏打开 MD 渲染预览，不占用当前源码所在的编辑器栏
      await vscode.commands.executeCommand('markdown.showPreviewToSide', uri);
    } catch {
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc, { preview: true, viewColumn: vscode.ViewColumn.Beside });
    }
  }

  // ---------- HTML 模板 ----------

  private shellHtml(): string {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"/>
<style>
*{box-sizing:border-box}
body{font-family:var(--vscode-font-family);font-size:13px;color:var(--vscode-foreground);margin:0;padding:16px}
h2{margin:0 0 10px;font-size:15px}
.meta{color:var(--vscode-descriptionForeground);font-size:11px;margin-bottom:14px}
.field{margin-bottom:12px}
label{display:block;font-size:11px;color:var(--vscode-descriptionForeground);margin-bottom:4px}
input[type=text],textarea,select{background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border,transparent);border-radius:4px;padding:6px;font-family:inherit;font-size:13px}
input[type=text]{width:100%}
textarea{width:100%;min-height:220px;resize:vertical}
select{margin-right:8px;padding:4px}
.btn{background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;padding:5px 12px;border-radius:4px;cursor:pointer;font-size:12px}
.btn:hover{background:var(--vscode-button-hoverBackground)}
.btn.sec{background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground)}
.btn.danger{background:var(--vscode-errorForeground)}
.anchorbox{background:var(--vscode-editor-background);border:1px solid var(--vscode-widget-border);border-radius:6px;padding:10px;margin-bottom:12px}
.anchorbox pre{font-family:var(--vscode-editor-font-family);font-size:12px;margin:8px 0 0;white-space:pre;overflow-x:auto}
.codehead{color:var(--vscode-descriptionForeground);font-size:11px;margin-bottom:4px}
.preview{border-left:3px solid var(--vscode-widget-border);padding-left:12px;font-size:12.5px}
.preview h3{margin:10px 0 6px;font-size:13px}
.preview code{padding:1px 4px}
.preview pre{padding:8px;overflow-x:auto}
.preview code,.preview pre{background:rgba(127,127,127,.15);border-radius:4px}
.preview blockquote{margin:6px 0;padding:2px 12px;border-left:3px solid var(--vscode-widget-border);color:var(--vscode-descriptionForeground)}
.preview ul{margin:6px 0;padding-left:20px}
.bar{display:flex;gap:8px;align-items:center;margin-top:14px}
.spacer{flex:1}
.kind-pill{display:inline-block;background:rgba(127,127,127,.18);border-radius:10px;padding:1px 8px;margin-right:6px;font-size:11px}
</style>
</head>
<body>
<div id="app">加载中…</div>
<script>
${MD_RENDER_JS}
(function(){
  var vsc = acquireVsCodeApi();
  var app = document.getElementById('app');
  var state = null;

  var MODES = [['star','星标（行号旁小星）'],['inline','行内注释'],['both','两者']];

  function el(tag, cls){ var e = document.createElement(tag); if (cls) e.className = cls; return e; }
  function field(labelText, build){
    var f = el('div','field');
    var l = document.createElement('label'); l.textContent = labelText;
    f.appendChild(l); f.appendChild(build());
    return f;
  }
  function render(){
    if(!state){ app.textContent = '加载中…'; return; }
    app.innerHTML = '';
    if (state.view === 'editor') renderEditor(); else renderFocus();
  }
  function anchorBox(showBody){
    if (!state.anchor) {
      var d = el('div','anchorbox');
      d.textContent = state.view === 'editor'
        ? '全局笔记（未关联代码）—— 选中代码后执行「重新锚定」即可挂到代码上'
        : '（未关联代码）';
      return d;
    }
    var a = state.anchor, n = state.note;
    var box = el('div','anchorbox');
    var hd = el('div','codehead');
    hd.textContent = '锚点 ' + a.uri + ' L' + a.start + '-' + a.end + (a.status === 'unresolved' ? ' ⚠️ 未定位' : '');
    box.appendChild(hd);
    if (showBody) {
      var pv = el('div','preview');
      pv.innerHTML = mdRender(n.body || '（空）');
      box.appendChild(pv);
    }
    var pre = document.createElement('pre');
    pre.textContent = a.code.join('\\n');
    box.appendChild(pre);
    return box;
  }

  function renderEditor(){
    var n = state.note;
    var h = el('h2'); h.textContent = n.kindEmoji + ' 编辑笔记'; app.appendChild(h);
    var meta = el('div','meta');
    meta.textContent = '创建 ' + new Date(n.createdAt).toLocaleString() + ' · 更新 ' + new Date(n.updatedAt).toLocaleString();
    app.appendChild(meta);

    app.appendChild(field('标题', function(){
      var i = el('input'); i.type = 'text'; i.value = n.title; i.id = 'cf_title'; return i;
    }));

    var kindSel = document.createElement('select'); kindSel.id = 'cf_kind';
    (state.kinds || []).forEach(function(k){
      var o = document.createElement('option'); o.value = k.kind; o.textContent = k.label;
      if (k.kind === n.kind) o.selected = true;
      kindSel.appendChild(o);
    });
    var modeSel = document.createElement('select'); modeSel.id = 'cf_mode';
    MODES.forEach(function(m){
      var o = document.createElement('option'); o.value = m[0]; o.textContent = m[1];
      if (m[0] === n.mode) o.selected = true;
      modeSel.appendChild(o);
    });
    var r = document.createElement('div'); r.style.cssText = 'margin-bottom:12px';
    r.appendChild(kindSel); r.appendChild(modeSel);
    app.appendChild(r);

    app.appendChild(field('标签（空格分隔）', function(){
      var i = el('input'); i.type = 'text'; i.value = n.tags.join(' '); i.id = 'cf_tags'; return i;
    }));

    var bf = el('div','field');
    var bl = document.createElement('label'); bl.textContent = '正文 Markdown（AI 对话可直接粘贴）';
    var bw = el('div');
    var toggle = el('button','btn sec'); toggle.textContent = '预览';
    var bodyTxt = document.createElement('textarea'); bodyTxt.id = 'cf_body'; bodyTxt.value = n.body;
    var previewBox = el('div','preview'); previewBox.style.display = 'none';
    bf.appendChild(bl); bw.appendChild(toggle); bf.appendChild(bw); bf.appendChild(bodyTxt); bf.appendChild(previewBox);
    app.appendChild(bf);
    toggle.onclick = function(){
      if (previewBox.style.display !== 'none') {
        previewBox.style.display = 'none'; toggle.textContent = '预览';
      } else {
        previewBox.innerHTML = mdRender(bodyTxt.value); previewBox.style.display = 'block'; toggle.textContent = '编辑';
      }
    };

    app.appendChild(anchorBox(false));

    var bar = el('div','bar');
    var saveBtn = el('button','btn'); saveBtn.textContent = '保存';
    saveBtn.onclick = function(){
      var tags = document.getElementById('cf_tags').value.split(/[，,;\\s]+/).filter(Boolean);
      vsc.postMessage({ type: 'save', payload: {
        title: document.getElementById('cf_title').value,
        kind: kindSel.value,
        mode: modeSel.value,
        tags: tags,
        body: bodyTxt.value
      }});
    };
    bar.appendChild(saveBtn);
    var openBtn = el('button','btn sec'); openBtn.textContent = '打开 Markdown 预览';
    openBtn.onclick = function(){ vsc.postMessage({ type: 'openFile' }); };
    bar.appendChild(openBtn);
    var sp = el('span','spacer'); bar.appendChild(sp);
    if (state.anchor) {
      var unBtn = el('button','btn sec'); unBtn.textContent = '解除代码锚点';
      unBtn.onclick = function(){ vsc.postMessage({ type: 'unanchor' }); };
      bar.appendChild(unBtn);
    }
    var delBtn = el('button','btn danger'); delBtn.textContent = '删除';
    delBtn.onclick = function(){ vsc.postMessage({ type: 'remove' }); };
    bar.appendChild(delBtn);
    app.appendChild(bar);
  }

  function renderFocus(){
    var n = state.note;
    var h = el('h2'); h.textContent = n.kindEmoji + ' ' + n.title; app.appendChild(h);
    var meta = el('div','meta');
    meta.textContent = '更新 ' + new Date(n.updatedAt).toLocaleString() +
      (n.tags.length ? ' · ' + n.tags.map(function(t){ return '#' + t; }).join(' ') : '');
    app.appendChild(meta);
    app.appendChild(anchorBox(true));
    var bar = el('div','bar');
    var editBtn = el('button','btn'); editBtn.textContent = '编辑笔记';
    editBtn.onclick = function(){ vsc.postMessage({ type: 'editor' }); };
    bar.appendChild(editBtn);
    if (state.anchor) {
      var openBtn = el('button','btn sec'); openBtn.textContent = '打开 Markdown 预览';
      openBtn.onclick = function(){ vsc.postMessage({ type: 'openFile' }); };
      bar.appendChild(openBtn);
    }
    app.appendChild(bar);
  }

  function anchorBox(showBody){
    if (!state.anchor) {
      var d = el('div','anchorbox');
      d.textContent = state.view === 'editor'
        ? '全局笔记（未关联代码）—— 选中代码后执行「重新锚定」即可挂到代码上'
        : '（未关联代码）';
      return d;
    }
    var a = state.anchor, n = state.note;
    var box = el('div','anchorbox');
    var hd = el('div','codehead');
    hd.textContent = '锚点 ' + a.uri + ' L' + a.start + '-' + a.end + (a.status === 'unresolved' ? ' ⚠️ 未定位' : '');
    box.appendChild(hd);
    if (showBody) {
      var pv = el('div','preview');
      pv.innerHTML = mdRender(n.body || '（空）');
      box.appendChild(pv);
    }
    var pre = document.createElement('pre');
    pre.textContent = a.code.join('\\n');
    box.appendChild(pre);
    return box;
  }

  window.addEventListener('message', function(ev){
    var m = ev.data;
    if (m && m.type === 'init') {
      state = m.payload;
      render();
    }
  });

  render();
})();
</script>
</body>
</html>`;
  }
}