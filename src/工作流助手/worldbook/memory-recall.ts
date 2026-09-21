import {
  isChronicleMemoryRowEntry,
  isChronicleMemoryWrapAfter,
  isChronicleMemoryWrapBefore,
  normalizeWorldbookComment,
} from './blocked';
import { processTemplateText } from '../tasks/template-process';
import { resolveBookNames } from './content';
import type { PlotWorldbookConfig } from '../tasks/schema';

import type { WorldbookEntry } from '@types/function/worldbook';

const AM_CODE_RE = /\bAM(\d{4})\b/i;

export function extractAmCodeNumber(text: string): number | null {
  const m = String(text || '').match(AM_CODE_RE);
  if (!m) return null;
  const n = Number.parseInt(m[1]!, 10);
  return Number.isFinite(n) ? n : null;
}

export function extractAmCodeFromEntry(entry: WorldbookEntry): number | null {
  const keys = entry.strategy?.keys ?? [];
  for (const key of keys) {
    const fromKey = extractAmCodeNumber(String(key));
    if (fromKey != null) return fromKey;
  }
  return extractAmCodeNumber(entry.name || '');
}

export type ChronicleMemoryCandidate = {
  entry: WorldbookEntry;
  bookName: string;
  am: number;
};

/** 按 AM 降序取最近 N 条，再升序排列输出（时间正序） */
export function selectRecentChronicleMemoryEntries(
  candidates: ChronicleMemoryCandidate[],
  recentCount: number,
): ChronicleMemoryCandidate[] {
  const n = Math.max(0, Math.floor(Number(recentCount) || 0));
  if (n <= 0 || candidates.length === 0) return [];
  const sortedDesc = [...candidates].sort((a, b) => b.am - a.am || a.entry.uid - b.entry.uid);
  const taken = sortedDesc.slice(0, n);
  return taken.sort((a, b) => a.am - b.am || a.entry.uid - b.entry.uid);
}

/** 有选中行时：包裹上 → 行 → 包裹下；条目 content 原样拼接（不做外层 <记忆回溯>） */
export function assembleMemoryRecallEntries(parts: {
  wrapBefore?: WorldbookEntry | null;
  rows: WorldbookEntry[];
  wrapAfter?: WorldbookEntry | null;
}): WorldbookEntry[] {
  if (parts.rows.length === 0) return [];
  const out: WorldbookEntry[] = [];
  if (parts.wrapBefore) out.push(parts.wrapBefore);
  out.push(...parts.rows);
  if (parts.wrapAfter) out.push(parts.wrapAfter);
  return out;
}

async function formatEntryContents(entries: WorldbookEntry[], messageId: number): Promise<string> {
  const parts: string[] = [];
  for (const entry of entries) {
    const content = await processTemplateText(entry.content || '', messageId, { source: 'world_info' });
    const trimmed = String(content || '').trim();
    if (!trimmed) continue;
    parts.push(trimmed);
  }
  return parts.join('\n\n');
}

/** $6：最近 N 条 AM 纪要行 + 可选 包裹上下；content 原样输出 */
export async function getMemoryRecallContentForPostProcess(
  config: PlotWorldbookConfig,
  recentCount: number,
  messageId: number,
): Promise<string> {
  const bookNames = await resolveBookNames(config);
  if (bookNames.length === 0) return '';

  const candidates: ChronicleMemoryCandidate[] = [];
  let wrapBefore: WorldbookEntry | null = null;
  let wrapAfter: WorldbookEntry | null = null;

  for (const bookName of bookNames) {
    try {
      const entries = await getWorldbook(bookName);
      for (const entry of entries) {
        if (!entry.enabled) continue;
        const normalized = normalizeWorldbookComment(entry.name);
        if (isChronicleMemoryWrapBefore(normalized)) {
          if (!wrapBefore) wrapBefore = entry;
          continue;
        }
        if (isChronicleMemoryWrapAfter(normalized)) {
          if (!wrapAfter) wrapAfter = entry;
          continue;
        }
        if (!isChronicleMemoryRowEntry(normalized)) continue;
        const am = extractAmCodeFromEntry(entry);
        if (am == null) continue;
        candidates.push({ entry, bookName, am });
      }
    } catch {
      continue;
    }
  }

  const selected = selectRecentChronicleMemoryEntries(candidates, recentCount);
  const ordered = assembleMemoryRecallEntries({
    wrapBefore,
    rows: selected.map(c => c.entry),
    wrapAfter,
  });
  if (ordered.length === 0) return '';
  return formatEntryContents(ordered, messageId);
}
