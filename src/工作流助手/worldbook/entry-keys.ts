import { parseCommaSeparatedList } from '../tasks/comma-separated';
import type { WorldbookWriteAppliedEntry } from './write-sync';

/** 中文间隔号 / 全角・ / 半角･；不含 ASCII 句点 */
const NAME_SEPARATOR = /[·・･]/;

/** 逗号/空白拆分、trim、去空 */
export function normalizeKeywordList(raw: string | string[] | undefined | null): string[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) {
    return raw.map(s => String(s).trim()).filter(Boolean);
  }
  return parseCommaSeparatedList(String(raw));
}

function isDroppedShortPart(part: string): boolean {
  return /^[A-Za-z0-9]$/.test(part);
}

/** 间隔号拆分段（不含原词）；空段与单字符拉丁字母/数字丢弃 */
export function nameSeparatorParts(key: string): string[] {
  const trimmed = String(key ?? '').trim();
  if (!trimmed || !NAME_SEPARATOR.test(trimmed)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of trimmed.split(NAME_SEPARATOR).map(s => s.trim())) {
    if (!part || part === trimmed || isDroppedShortPart(part) || seen.has(part)) continue;
    seen.add(part);
    out.push(part);
  }
  return out;
}

/** 保留全名并追加间隔号拆分段，保序去重 */
export function expandNameSeparatorKeywords(keys: string[] | undefined | null): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (key: string) => {
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(key);
  };
  for (const key of normalizeKeywordList(keys)) {
    add(key);
    for (const part of nameSeparatorParts(key)) add(part);
  }
  return out;
}

/** 默认 keys ∪ 额外 keys，保序去重；合并后再展开间隔号名称 */
export function mergeEntryKeys(defaultKeys: string[], extraKeys: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const key of [...normalizeKeywordList(defaultKeys), ...normalizeKeywordList(extraKeys)]) {
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return expandNameSeparatorKeywords(out);
}

/** 从最终 keys 中抽出不属于默认集合的部分（回填旧账本） */
export function diffExtraKeys(finalKeys: string[], defaultKeys: string[]): string[] {
  const defaults = new Set(expandNameSeparatorKeywords(defaultKeys));
  const out: string[] = [];
  const seen = new Set<string>();
  for (const key of expandNameSeparatorKeywords(finalKeys)) {
    if (defaults.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

/** 从 applied 账本读取额外关键词；仅信任显式 extraKeys，缺失视为 []（不从 strategy.keys 猜测） */
export function resolveAppliedExtraKeys(
  applied: WorldbookWriteAppliedEntry | undefined | null,
): string[] {
  if (!applied || !Array.isArray(applied.extraKeys)) return [];
  return normalizeKeywordList(applied.extraKeys);
}

/**
 * 属性改名时改写 keys：丢掉旧全名及其自动拆分段，插入新名后再展开间隔号。
 * 碰巧等于旧名一段的用户 extra 不会出现在结果里，调用方需再 merge extraKeys。
 */
export function remapKeywordsForAttrRename(
  keys: string[] | undefined | null,
  from: string,
  to: string,
): string[] {
  const fromNorm = String(from ?? '').trim();
  const toNorm = String(to ?? '').trim();
  const list = normalizeKeywordList(keys);
  if (!fromNorm || fromNorm === toNorm) {
    return expandNameSeparatorKeywords(list.map(k => (k === fromNorm ? toNorm : k)));
  }

  const oldAuto = new Set<string>([fromNorm, ...nameSeparatorParts(fromNorm)]);
  const kept: string[] = [];
  let insertedTo = false;
  let droppedOld = false;

  for (const key of list) {
    if (key === fromNorm) {
      droppedOld = true;
      if (toNorm && !insertedTo) {
        kept.push(toNorm);
        insertedTo = true;
      }
      continue;
    }
    if (oldAuto.has(key)) {
      droppedOld = true;
      continue;
    }
    kept.push(key);
  }

  if (toNorm && droppedOld && !insertedTo) {
    kept.unshift(toNorm);
  }

  return expandNameSeparatorKeywords(kept);
}
