/** 需严格校验的布尔字段名 (深度遍历时剔除非法值 / coerce 字符串布尔) */
export const STRICT_BOOLEAN_KEYS = new Set(['降临', '平行演化', '原典', '临界事件', '位面交汇']);

/** schema 中应为字符串的数值型字段 */
export const LOOSE_NUMERIC_STRING_KEYS = new Set([
  '报',
  '当前价格',
  '上期价格',
  '近月价格',
  '远月价格',
  '本期',
  '上期',
]);

const FIELD_ALIASES: Record<string, string> = {
  关联转折: '关键转折',
  关联要素: '关键要素',
};

function coerceStrictBoolean(value: unknown): unknown {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
}

function coercePercentValue(value: unknown): unknown {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `${value}%`;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed && /^\d+(\.\d+)?$/.test(trimmed)) {
      return `${trimmed}%`;
    }
  }
  return value;
}

function coerce权力支柱Value(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.trim() ? { [value]: '' } : {};
  }
  if (Array.isArray(value)) {
    const record: Record<string, string> = {};
    for (const item of value) {
      if (typeof item === 'string' && item.trim()) {
        record[item] = '';
      }
    }
    return record;
  }
  return value;
}

function coerce核心母题关键词(value: unknown): unknown {
  if (Array.isArray(value)) {
    const parts = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
    return parts.join('，');
  }
  return value;
}

function coerceFieldValue(key: string, value: unknown): unknown {
  if (STRICT_BOOLEAN_KEYS.has(key)) {
    return coerceStrictBoolean(value);
  }
  if (key === '进度') {
    return coercePercentValue(value);
  }
  if (key === '权力支柱') {
    return coerce权力支柱Value(value);
  }
  if (key === '核心母题关键词') {
    return coerce核心母题关键词(value);
  }
  if (LOOSE_NUMERIC_STRING_KEYS.has(key) && typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return value;
}

function applyFieldAliases(obj: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const alias = FIELD_ALIASES[key];
    if (alias && !(alias in obj)) {
      next[alias] = value;
      continue;
    }
    if (alias && alias in obj) {
      continue;
    }
    next[key] = value;
  }
  return next;
}

function coerceValue(value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(coerceValue);
  }

  const aliased = applyFieldAliases(value as Record<string, unknown>);
  const next: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(aliased)) {
    const coercedChild = coerceFieldValue(key, child);
    if (coercedChild !== null && typeof coercedChild === 'object' && !Array.isArray(coercedChild)) {
      next[key] = coerceValue(coercedChild);
    } else {
      next[key] = coercedChild;
    }
  }
  return next;
}

/** 在 Zod parse 前修正 AI 常见类型/字段名误写 */
export function coerceAddonData(raw: unknown): unknown {
  return coerceValue(raw ?? {});
}
