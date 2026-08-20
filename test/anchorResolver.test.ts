/**
 * 锚点重定位算法单元测试：
 * 覆盖「双端命中 / 窗口平移 / 全文兜底 / 找不到→unresolved」四条路径，
 * 以及批量重定位与空行场景。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AnchorData, normalizeLine } from '../src/types';
import { resolveAnchors, resolveOne } from '../src/anchor/anchorResolver';

function doc(lines: string[]): { anchor: AnchorData; uri: string } {
  return { anchor: mkAnchor(lines, 10, 12), uri: 'a.py' };
}

function mkAnchor(lines: string[], start: number, end: number, uri = 'a.py'): AnchorData {
  return {
    uri,
    start,
    end,
    startText: normalizeLine(lines[start]),
    endText: normalizeLine(lines[end]),
    snippet: lines[start].trim().slice(0, 80),
    status: 'ok',
  };
}

const base = [
  'line0', 'line1', 'line2', 'line3', 'line4',
  'line5', 'line6', 'line7', 'line8', 'line9',
  'target_a', 'target_b', 'target_c',
  'line13', 'line14', 'line15', 'line16', 'line17', 'line18', 'line19',
];

test('直接命中：行号未漂移时保持 ok', () => {
  const a = mkAnchor(base, 10, 12);
  const r = resolveOne(base, a);
  assert.equal(r.ok, true);
  assert.equal(r.anchor.start, 10);
  assert.equal(r.anchor.end, 12);
  assert.equal(r.anchor.status, 'ok');
});

test('窗口平移：代码前插入 5 行后自动跟随', () => {
  const a = mkAnchor(base, 10, 12);
  // 模拟在文档头部插入 5 行
  const shifted = ['new0', 'new1', 'new2', 'new3', 'new4', ...base];
  const r = resolveOne(shifted, a, 10);
  assert.equal(r.ok, true);
  assert.equal(r.anchor.start, 15);
  assert.equal(r.anchor.end, 17);
});

test('窗口平移：行内容不改但块内行数变化（endText 失效时只锚首行）', () => {
  const a = mkAnchor(base, 10, 12);
  // 删掉 target_b，使 end 行对不上
  const modified = [...base.slice(0, 11), 'target_c_changed', ...base.slice(13)];
  const r = resolveOne(modified, a, 20);
  assert.equal(r.ok, true);
  assert.equal(r.anchor.start, 10);
  // endText 无法确认 → end 收拢到 start
  assert.equal(r.anchor.end, 10);
});

test('全文兜底：窗口内找不到时全文搜索', () => {
  const a = mkAnchor(base, 10, 12);
  // 目标行被移到很远的后面（窗口外）
  const far = [
    ...Array.from({ length: 300 }, (_, i) => `filler${i}`),
    'target_a', 'target_b', 'target_c',
  ];
  const r = resolveOne(far, a, 20);
  assert.equal(r.ok, true);
  assert.equal(r.anchor.start, 300);
  assert.equal(r.anchor.end, 302);
});

test('找不到：目标行被删除后标记 unresolved（保留旧坐标）', () => {
  const a = mkAnchor(base, 10, 12);
  const removed = base.filter((l) => !l.startsWith('target'));
  const r = resolveOne(removed, a, 50);
  assert.equal(r.ok, false);
  assert.equal(r.anchor.status, 'unresolved');
  assert.equal(r.anchor.start, 10); // 旧坐标保留，供手动重锚参考
});

test('批量重定位：多笔记整体平移且引用同一批行', () => {
  const notes = [mkAnchor(base, 10, 12, 'a.py'), mkAnchor(base, 13, 13, 'a.py')];
  const shifted = [...Array.from({ length: 9 }, (_, i) => `new${i}`), ...base];
  const r = resolveAnchors(shifted, notes, 30);
  assert.equal(r.unresolvedCount, 0);
  assert.equal(r.anchors[0].start, 19);
  assert.equal(r.anchors[1].start, 22);
});

test('空白差异匹配：格式化（tab/空格）后仍能命中', () => {
  const lines = ['  def foo():', '\t\treturn 1'];
  const a = mkAnchor(lines, 0, 1);
  const reformatted = ['   def foo():', '\t\t  return 1'];
  const r = resolveOne(reformatted, a, 5);
  assert.equal(r.ok, true);
});

test('endText 为空串时视为任意行（单一目标匹配）', () => {
  const a: AnchorData = {
    uri: 'a.py', start: 5, end: 5,
    startText: 'needle', endText: '', snippet: 'needle', status: 'ok',
  };
  const lines = ['x', 'y', 'needle', 'z', 'w'];
  const r = resolveOne(lines, a, 5);
  assert.equal(r.ok, true);
  assert.equal(r.anchor.start, 2);
});