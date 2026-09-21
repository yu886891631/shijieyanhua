import type { ContextTagRule } from './schema';

function trimBoundary(boundary: string): string {
  return String(boundary ?? '').trim();
}

/** 残缺 XML 开标签前缀（如 `<tp`），非完整字面量边界 */
function isIncompleteOpenTag(boundary: string): boolean {
  return boundary.startsWith('<') && !boundary.endsWith('>');
}

/** 前缀命中后，下一字符须为合法开标签延续，避免 `<tp` 误匹配 `<tpx>` */
function isValidOpenTagPrefixMatch(source: string, startIdx: number, prefixLen: number): boolean {
  if (startIdx > 0 && source[startIdx - 1] === '/') return false;

  const ch = source[startIdx + prefixLen];
  if (ch === undefined) return true;
  if (ch === '>' || ch === '=') return true;
  if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') return true;
  if (/[A-Za-z0-9_-]/.test(ch)) return false;
  return true;
}

function findLastStartIndex(source: string, startBoundary: string, searchBefore: number): number {
  const start = String(startBoundary || '');
  if (!start) return -1;

  const lowerSource = source.toLowerCase();
  const lowerStart = start.toLowerCase();
  const limit = Math.max(0, searchBefore - 1);

  if (!isIncompleteOpenTag(start)) {
    return lowerSource.lastIndexOf(lowerStart, limit);
  }

  let idx = limit;
  while (idx >= 0) {
    const found = lowerSource.lastIndexOf(lowerStart, idx);
    if (found === -1) return -1;
    if (isValidOpenTagPrefixMatch(source, found, start.length)) return found;
    idx = found - 1;
  }
  return -1;
}

function findLastEndIndex(source: string, endBoundary: string, searchFrom = source.length): number {
  const end = String(endBoundary || '');
  if (!end) return -1;
  return source.toLowerCase().lastIndexOf(end.toLowerCase(), Math.max(0, searchFrom - 1));
}

export function normalizeContextTagRules(
  rulesInput: unknown,
  legacyTagsText = '',
): ContextTagRule[] {
  const normalized: ContextTagRule[] = [];
  const dedup = new Set<string>();

  const pushRule = (startRaw: unknown, endRaw: unknown) => {
    const start = trimBoundary(String(startRaw ?? ''));
    const end = trimBoundary(String(endRaw ?? ''));
    if (!start || !end) return;
    const key = `${start}\u0000${end}`;
    if (dedup.has(key)) return;
    dedup.add(key);
    normalized.push({ start, end });
  };

  if (Array.isArray(rulesInput)) {
    for (const rule of rulesInput) {
      if (!rule) continue;
      if (typeof rule === 'string') {
        const parts = rule.split('|');
        if (parts.length >= 2) {
          const start = parts.shift();
          pushRule(start, parts.join('|'));
        }
        continue;
      }
      if (typeof rule === 'object') {
        const r = rule as Record<string, unknown>;
        if ('tag' in r && !('start' in r)) {
          const tag = String(r.tag ?? '').replace(/[<>]/g, '');
          if (tag) pushRule(`<${tag}>`, `</${tag}>`);
          continue;
        }
        pushRule(r.start ?? r.begin ?? r.open, r.end ?? r.close ?? r.finish);
      }
    }
  }

  if (normalized.length === 0 && legacyTagsText.trim()) {
    for (const tag of legacyTagsText.split(/[,，\s]+/).map(t => t.trim()).filter(Boolean)) {
      const clean = tag.replace(/[<>]/g, '');
      pushRule(`<${clean}>`, `</${clean}>`);
    }
  }

  return normalized;
}

function removeLastMatchedBoundary(text: string, startBoundary: string, endBoundary: string): string {
  const source = String(text ?? '');
  const start = String(startBoundary || '');
  const end = String(endBoundary || '');
  if (!source || !start || !end) return source;

  const endIdx = findLastEndIndex(source, end);
  if (endIdx === -1) return source;
  const startIdx = findLastStartIndex(source, start, endIdx);
  if (startIdx === -1) return source;
  const removeTo = endIdx + end.length;
  if (removeTo <= startIdx) return source;
  return source.slice(0, startIdx) + source.slice(removeTo);
}

function extractLastMatchedBoundary(text: string, startBoundary: string, endBoundary: string): string | null {
  const source = String(text ?? '');
  const start = String(startBoundary || '');
  const end = String(endBoundary || '');
  if (!source || !start || !end) return null;

  const endIdx = findLastEndIndex(source, end);
  if (endIdx === -1) return null;
  const startIdx = findLastStartIndex(source, start, endIdx);
  if (startIdx === -1) return null;
  const rangeEnd = endIdx + end.length;
  if (rangeEnd <= startIdx) return null;
  return source.slice(startIdx, rangeEnd);
}

export function applyExtractRulesToText(text: string, rules: ContextTagRule[]): string {
  const source = String(text ?? '');
  if (!source || !rules.length) return source;
  const parts: string[] = [];
  for (const rule of rules) {
    const matched = extractLastMatchedBoundary(source, rule.start, rule.end);
    if (matched !== null) parts.push(matched);
  }
  if (!parts.length) return source;
  return parts.join('\n\n');
}

export function applyExcludeRulesToText(text: string, rules: ContextTagRule[]): string {
  let result = String(text ?? '');
  if (!result || !rules.length) return result;
  for (const rule of rules) {
    result = removeLastMatchedBoundary(result, rule.start, rule.end);
  }
  return result.replace(/\n{3,}/g, '\n\n').trim();
}

export function applyContextTagFilters(
  text: string,
  extractRules: ContextTagRule[],
  excludeRules: ContextTagRule[],
): string {
  let result = String(text ?? '');
  result = applyExtractRulesToText(result, extractRules);
  result = applyExcludeRulesToText(result, excludeRules);
  return result;
}
