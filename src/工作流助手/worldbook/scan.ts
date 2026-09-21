import type { WorldbookEntry } from '@types/function/worldbook';

export const DEFAULT_WORLDBOOK_MAX_RECURSION_STEPS = 10;

export type ScanWorldbookOptions = {
  allowDisabled?: boolean;
  recursionEnabled?: boolean;
  maxRecursionSteps?: number;
};

function keywordToString(keyword: string | RegExp): string {
  return typeof keyword === 'string' ? keyword.toLowerCase() : keyword.source.toLowerCase();
}

function getEntryKeywords(entry: WorldbookEntry): string[] {
  const keys = entry.strategy?.keys ?? [];
  return keys.map(keywordToString).filter(Boolean);
}

function delayUntil(entry: WorldbookEntry): number {
  const n = entry.recursion?.delay_until;
  return typeof n === 'number' && n > 0 ? n : 0;
}

function isConstantEligibleAtDepth(entry: WorldbookEntry, depth: number): boolean {
  return depth >= delayUntil(entry);
}

function isSelectiveEligibleAtDepth(entry: WorldbookEntry, depth: number): boolean {
  if (depth > 0 && entry.recursion?.prevent_incoming) return false;
  return depth >= delayUntil(entry);
}

function hasWaitingDelay(entries: WorldbookEntry[], depth: number): boolean {
  return entries.some(e => delayUntil(e) > depth);
}

function matchKeywords(entry: WorldbookEntry, haystack: string): boolean {
  const keywords = getEntryKeywords(entry);
  if (keywords.length === 0) return false;
  return keywords.some(kw => haystack.includes(kw));
}

function recursionHaystack(triggered: Iterable<WorldbookEntry>): string {
  return Array.from(triggered)
    .filter(e => !e.recursion?.prevent_outgoing)
    .map(e => e.content || '')
    .join('\n')
    .toLowerCase();
}

function resolveMaxRecursionSteps(raw: number | undefined): number {
  const n = Math.floor(Number(raw ?? DEFAULT_WORLDBOOK_MAX_RECURSION_STEPS));
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_WORLDBOOK_MAX_RECURSION_STEPS;
  return Math.min(DEFAULT_WORLDBOOK_MAX_RECURSION_STEPS, n);
}

export function scanTriggeredWorldbookEntries(
  entries: WorldbookEntry[],
  baseScanText: string,
  options?: ScanWorldbookOptions,
): WorldbookEntry[] {
  const allowDisabled = options?.allowDisabled === true;
  const recursionEnabled = options?.recursionEnabled !== false;
  const maxRecursionSteps = resolveMaxRecursionSteps(options?.maxRecursionSteps);
  const passEnabled = (e: WorldbookEntry) => allowDisabled || e.enabled;

  const pendingConstants = entries.filter(e => e.strategy?.type === 'constant' && passEnabled(e));
  let remaining = entries.filter(e => e.strategy?.type === 'selective' && passEnabled(e));
  const triggered = new Set<WorldbookEntry>();
  const lowerBase = String(baseScanText || '').toLowerCase();

  const activateConstantsAtDepth = (depth: number) => {
    const stillPending: WorldbookEntry[] = [];
    for (const entry of pendingConstants) {
      if (isConstantEligibleAtDepth(entry, depth)) triggered.add(entry);
      else stillPending.push(entry);
    }
    pendingConstants.length = 0;
    pendingConstants.push(...stillPending);
  };

  const matchSelective = (haystack: string, depth: number) => {
    const nextRemaining: WorldbookEntry[] = [];
    for (const entry of remaining) {
      if (!isSelectiveEligibleAtDepth(entry, depth)) {
        nextRemaining.push(entry);
        continue;
      }
      if (matchKeywords(entry, haystack)) triggered.add(entry);
      else nextRemaining.push(entry);
    }
    remaining = nextRemaining;
  };

  activateConstantsAtDepth(0);
  matchSelective(lowerBase, 0);

  if (!recursionEnabled) return Array.from(triggered);

  for (
    let depth = 1;
    depth <= maxRecursionSteps && remaining.length + pendingConstants.length > 0;
    depth++
  ) {
    const before = triggered.size;
    activateConstantsAtDepth(depth);
    matchSelective(recursionHaystack(triggered), depth);
    const waiting = hasWaitingDelay([...remaining, ...pendingConstants], depth);
    if (triggered.size === before && !waiting) break;
  }

  return Array.from(triggered);
}

export function formatWorldbookEntriesRaw(entries: WorldbookEntry[]): string {
  return entries
    .map(entry => String(entry.content || '').trim())
    .filter(Boolean)
    .join('\n\n');
}
