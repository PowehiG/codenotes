/**
 * 存储层 + NotesCore 集成测试（使用真实临时目录）：
 * - 首次加载创建 .codenotes 结构与空库
 * - 笔记 CRUD、正文独立 md 文件、删除连带清理
 * - 端到端：建笔记 → 挂锚点 → 模拟代码变更 → 锚点自动平移
 * - 锚点失效降级 unresolved（保留旧坐标）
 * - global 模式工程零写入
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolveStorage, StorageLocation } from '../src/storage/storage';
import { NotesCore } from '../src/core/notesCore';

/** 模拟一个被阅读的工程文件内容 */
const SAMPLE = [
  'package torch',
  'class Attention(nn.Module):',
  '    def forward(self, x):',
  '        # kv cache attention',
  '        x = x @ self.wq',
  '        return x',
  '    def forward2(self): ...',
];

function makeCore(mode: 'workspace' | 'global'): { ws: string; core: NotesCore; loc: StorageLocation } {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'codenotes-test-'));
  const loc = resolveStorage(ws, mode);
  const core = new NotesCore(loc);
  return { ws, core, loc };
}

test('首次加载：创建 .codenotes 目录与空库', async () => {
  const { ws, core } = makeCore('workspace');
  await core.load();
  assert.ok(fs.existsSync(path.join(ws, '.codenotes', 'store.json')));
  assert.ok(fs.existsSync(path.join(ws, '.codenotes', 'md')));
  assert.equal(core.allNotes().length, 0);
  const raw = JSON.parse(fs.readFileSync(path.join(ws, '.codenotes', 'store.json'), 'utf8'));
  assert.equal(raw.schemaVersion, 1);
});

test('CRUD：创建 → 更新踢正文 → 删除连带清理', async () => {
  const { ws, core } = makeCore('workspace');
  await core.load();

  const note = await core.createNote({ title: 'SGLang 分段？', kind: 'chat', body: '## 我的问题\n- 为什么分段' });
  assert.equal(core.allNotes().length, 1);
  assert.equal(await core.readBody(note), '## 我的问题\n- 为什么分段');

  const mdPath = path.join(ws, '.codenotes', note.body);
  assert.ok(fs.existsSync(mdPath), '正文独立 md 文件应存在');

  // 更新
  note.title = '改名';
  await core.updateNote(note, '# 新正文\n');
  assert.equal((await core.readBody(core.getNote(note.id)!)), '# 新正文\n');

  // 删除：store 与 md 一并清理
  await core.removeNote(note.id);
  assert.equal(core.allNotes().length, 0);
  assert.ok(!fs.existsSync(mdPath));
});

test('锚点建立与自动平移（代码前插入 2 行）', async () => {
  const { core } = makeCore('workspace');
  await core.load();
  const note = await core.createNote({ title: '为什么 forward 这样分段', body: '' });

  await core.setAnchor(note.id, 'src/model.py', 2, 4, SAMPLE);
  assert.equal(core.getNote(note.id)!.anchor!.status, 'ok');
  assert.equal(core.getNote(note.id)!.anchor!.start, 2);

  // 模拟代码变更：文件头新增 2 行 import
  const changed = ['from typing import Optional', 'import abc', ...SAMPLE];
  const r = core.reconcileFile('src/model.py', changed);
  assert.equal(r.unresolved, 0);
  assert.equal(r.changed, true);
  const a = core.getNote(note.id)!.anchor!;
  assert.equal(a.start, 4);
  assert.equal(a.end, 6);
  assert.equal(a.status, 'ok');
});

test('锚点失效：unresolved 且保留旧坐标', async () => {
  const { core } = makeCore('workspace');
  await core.load();
  const note = await core.createNote({ title: 'x', body: '' });
  await core.setAnchor(note.id, 'a.py', 0, 1, ['aaa long line', 'echo']);
  const r = core.reconcileFile('a.py', ['zzz', 'yyy', 'xxx']);
  assert.equal(r.unresolved, 1);
  const a = core.getNote(note.id)!.anchor!;
  assert.equal(a.status, 'unresolved');
  assert.equal(a.start, 0);
});

test('global 模式：数据在用户目录，工程零写入', async () => {
  const { ws, core } = makeCore('global');
  await core.load();
  await core.createNote({ title: '全局笔记', body: '' });
  assert.ok(!fs.existsSync(path.join(ws, '.codenotes')), '工程目录不应出现 .codenotes');
  assert.equal(core.allNotes().length, 1);
});

test('笔记变更事件可订阅', async () => {
  const { core } = makeCore('workspace');
  await core.load();
  const seen: string[] = [];
  core.onChanged((p) => seen.push(p.kind));
  const n = await core.createNote({ title: 't', body: '' });
  await core.updateNote(n, 'b');
  await core.removeNote(n.id);
  assert.deepEqual(seen, ['note', 'note', 'note']);
});