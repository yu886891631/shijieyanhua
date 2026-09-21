import type { AddonData } from './schema';
import { normalizeAddonData } from './schema';

/** AI 提示词中隐藏的字段名（深度剥离） */
export const ADDON_HIDDEN_FROM_PROMPT_KEYS = new Set<string>(['平行演化', '位面交汇']);

function stripDeep(value: unknown): unknown {
  if (value === null || value === undefined || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(stripDeep);
  }
  const obj = value as Record<string, unknown>;
  const next: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(obj)) {
    if (ADDON_HIDDEN_FROM_PROMPT_KEYS.has(key)) {
      continue;
    }
    next[key] = stripDeep(child);
  }
  return next;
}

/** 生成供世界书/提示词使用的 addon 快照（剥离隐藏字段；不再二次 Schema.parse） */
export function stripAddonHiddenFieldsForDisplay(data: unknown): unknown {
  if (data === null || data === undefined || typeof data !== 'object' || Array.isArray(data)) {
    return data;
  }
  return stripDeep(_.cloneDeep(data));
}

/** normalize 后再 strip，避免 prefault 把隐藏字段填回 */
export function toDisplayAddonData(data: AddonData | unknown): unknown {
  return stripAddonHiddenFieldsForDisplay(normalizeAddonData(data));
}
