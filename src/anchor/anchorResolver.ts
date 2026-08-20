/**
 * 锚点解析 / 重定位算法（纯逻辑，不依赖 vscode，可直接单测）
 *
 * 场景：用户在代码行上挂了笔记后，代码发生修改（SGLang 更新、重构、格式化等），
 * 行号会漂移。本模块负责在「新的文档内容」中重新找到每个锚点。
 *
 * 策略（由强到弱）：
 * 1. 双端命中：旧 start/end 行文本与保存的一致 → 直接 ok（常见：仅行号不变的轻微编辑）
 * 2. 窗口重定位：在 [start-window, end+window] 内找到 startText 的第一次出现，
 *    按偏移平移整个锚点，并尽量校验 endText → ok
 * 3. 全文重定位：窗口内没找到 → 全文找 startText → ok
 * 4. 全部失败 → unresolved（存在笔记列表，标注 ⚠，可手动「重新锚定」）
 *
 * 注意：匹配用「规范化文本」（去空白、小写、前 120 字符），
 * 缩小格式化/缩进变化带来的误判，代价是匹配更宽松。
 */
import { AnchorData, normalizeLine } from '../types';

export interface ResolveResult {
  anchors: AnchorData[];
  /** unresolved 的锚点数 */
  unresolvedCount: number;
}

/**
 * 对一份文档内容做全量重定位。
 * @param lines 当前文档的所有行（含内容）
 * @param anchors 需要解析的锚点列表（将被浅克隆并更新）
 * @param window 搜索窗口（前后各 N 行），默认 200
 */
export function resolveAnchors(lines: string[], anchors: AnchorData[], window = 200): ResolveResult {
  const result = anchors.map((a) => resolveOne(lines, a, window));
  return {
    anchors: result.map((r) => r.anchor),
    unresolvedCount: result.filter((r) => !r.ok).length,
  };
}

/** 解析单个锚点的结果 */
export interface ResolveOneResult {
  anchor: AnchorData;
  ok: boolean;
}

/** 查找规范文本在行数组中的第一个位置（按 1 行前向搜索） */
export function findLine(lines: string[], target: string, from: number, to: number): number {
  const max = Math.min(to, lines.length);
  for (let i = Math.max(0, from); i < max; i++) {
    if (normalizeLine(lines[i]) === target) return i;
  }
  return -1;
}

export function resolveOne(lines: string[], anchor: AnchorData, window = 200): ResolveOneResult {
  const len = lines.length;
  const { start, end, startText, endText } = anchor;
  const updated: AnchorData = { ...anchor };

  // 1. 行号直接命中（既在界内，文本又一致）
  if (start >= 0 && start < len && end >= 0 && end < len) {
    const sMatch = normalizeLine(lines[start]) === startText;
    const eMatch = endText === '' || normalizeLine(lines[end]) === endText;
    if (sMatch && eMatch) {
      updated.status = 'ok';
      return { anchor: updated, ok: true };
    }
  }

  // 2. 窗口搜索 startText
  let p = findLine(lines, startText, Math.max(0, start - window), Math.min(len, end + window + 1));
  if (p === -1) {
    // 3. 全文搜索
    p = findLine(lines, startText, 0, len);
  }
  if (p !== -1) {
    const newStart = p;
    const newEnd = newStart + (end - start);
    // 尽量用 endText 二次确认；若越界则只看 start
    let isOk = false;
    if (newEnd >= 0 && newEnd < len) {
      isOk = endText === '' || normalizeLine(lines[newEnd]) === endText;
    }
    if (isOk) {
      updated.start = newStart;
      updated.end = newEnd;
      updated.status = 'ok';
      return { anchor: updated, ok: true };
    }
    // endText 没对上：也许块大小变了，只锚定 start 行（end=start）
    updated.start = newStart;
    updated.end = newStart;
    updated.status = 'ok';
    return { anchor: updated, ok: true };
  }

  // 4. 找不到：保持旧坐标，标记 unresolved
  updated.status = 'unresolved';
  return { anchor: updated, ok: false };
}