import type { WorldbookEntry } from '@types/function/worldbook';
import type { ChatWorldbookWritePlacement } from '../tasks/schema';

export const DEFAULT_WORLDBOOK_WRITE_PLACEMENT: ChatWorldbookWritePlacement = {
  position: 'at_depth_as_system',
  depth: 2,
  order: 10000,
};

function parsePlacementInt(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) ? n : fallback;
}

/** 对齐 shujuku normalizePlacementConfig_ACU */
export function normalizeWorldbookWritePlacement(
  raw?: Partial<ChatWorldbookWritePlacement> | null,
  fallbackPlacement: ChatWorldbookWritePlacement = DEFAULT_WORLDBOOK_WRITE_PLACEMENT,
): ChatWorldbookWritePlacement {
  const source = raw && typeof raw === 'object' ? raw : {};
  const position = normalizePlotWorldbookPosition(source.position ?? fallbackPlacement.position);
  const depth = parsePlacementInt(source.depth, fallbackPlacement.depth);
  const order = Math.max(1, parsePlacementInt(source.order, fallbackPlacement.order));
  return { position, depth, order };
}

export type PlotWorldbookSortEntry = WorldbookEntry & {
  bookName?: string;
  placeholderOriginalIndex?: number;
};

export type PlotWorldbookSortKey = {
  segment: number;
  depthRank: number;
  order: number;
};

type FlatWorldbookEntry = WorldbookEntry & {
  order?: number;
  depth?: number;
  position?: WorldbookEntry['position'] | string;
};

function readFlatPositionRaw(entry: FlatWorldbookEntry): string {
  const pos = entry.position;
  if (typeof pos === 'string') return pos.trim().toLowerCase();
  if (pos && typeof pos === 'object' && pos.type) return String(pos.type).trim().toLowerCase();
  return '';
}

/** 对齐 shujuku normalizeLorebookPosition：before/after 两段，其余归入 at_depth 段 */
export function normalizePlotWorldbookPosition(
  positionType: string | undefined,
): 'before_character_definition' | 'after_character_definition' | 'at_depth_as_system' {
  const raw = String(positionType ?? '').trim().toLowerCase();
  if (
    raw === 'before_char' ||
    raw === 'before_character' ||
    raw === 'before_character_definition' ||
    raw === '0'
  ) {
    return 'before_character_definition';
  }
  if (
    raw === 'after_char' ||
    raw === 'after_character' ||
    raw === 'after_character_definition' ||
    raw === '1'
  ) {
    return 'after_character_definition';
  }
  return 'at_depth_as_system';
}

function getEntryOrderNumber(entry: FlatWorldbookEntry): number | null {
  const nested = entry.position && typeof entry.position === 'object' ? entry.position.order : undefined;
  const flat = entry.order;
  const v = nested ?? flat;
  const n = typeof v === 'number' ? v : parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) ? n : null;
}

function getEntryDepthNumber(entry: FlatWorldbookEntry): number {
  const nested = entry.position && typeof entry.position === 'object' ? entry.position.depth : undefined;
  const flat = entry.depth;
  const v = nested ?? flat;
  const n = typeof v === 'number' ? v : parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) ? n : 0;
}

export function getPlotWorldbookEntrySortKey(entry: PlotWorldbookSortEntry): PlotWorldbookSortKey {
  const positionRaw = readFlatPositionRaw(entry);
  const position = normalizePlotWorldbookPosition(positionRaw);
  const order = getEntryOrderNumber(entry);
  const normalizedOrder = order === null ? Number.MAX_SAFE_INTEGER : order;
  const normalizedDepth = getEntryDepthNumber(entry);

  if (position === 'before_character_definition') {
    return { segment: 0, depthRank: 0, order: normalizedOrder };
  }
  if (position === 'after_character_definition') {
    return { segment: 1, depthRank: 0, order: normalizedOrder };
  }
  return { segment: 2, depthRank: -normalizedDepth, order: normalizedOrder };
}

export function comparePlotWorldbookEntriesForPlaceholder(
  a: PlotWorldbookSortEntry,
  b: PlotWorldbookSortEntry,
): number {
  const keyA = getPlotWorldbookEntrySortKey(a);
  const keyB = getPlotWorldbookEntrySortKey(b);

  if (keyA.segment !== keyB.segment) return keyA.segment - keyB.segment;
  if (keyA.depthRank !== keyB.depthRank) return keyA.depthRank - keyB.depthRank;
  if (keyA.order !== keyB.order) return keyA.order - keyB.order;

  const originalIndexA = Number.isFinite(a.placeholderOriginalIndex)
    ? a.placeholderOriginalIndex!
    : Number.MAX_SAFE_INTEGER;
  const originalIndexB = Number.isFinite(b.placeholderOriginalIndex)
    ? b.placeholderOriginalIndex!
    : Number.MAX_SAFE_INTEGER;
  if (originalIndexA !== originalIndexB) return originalIndexA - originalIndexB;

  const bookNameA = String(a.bookName || '');
  const bookNameB = String(b.bookName || '');
  if (bookNameA !== bookNameB) return bookNameA.localeCompare(bookNameB, 'zh-Hans-CN');

  const uidA = String(a.uid ?? '');
  const uidB = String(b.uid ?? '');
  return uidA.localeCompare(uidB, 'zh-Hans-CN');
}

export function sortPlotWorldbookEntries<T extends PlotWorldbookSortEntry>(entries: T[]): T[] {
  return [...entries].sort(comparePlotWorldbookEntriesForPlaceholder);
}
