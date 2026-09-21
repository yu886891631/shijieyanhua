import type { ChatWorldbookWriteRule } from '../tasks/schema';
import type { WorldbookWriteSnapshotEntry } from './write-from-template';
import { isManagedWorldbookEntryNameForRule } from './write-ledger-utils';
import type { WorldbookWriteAppliedEntry } from './write-sync';

export function collectEntriesToMoveFromLedger(
  ledger: Map<string, WorldbookWriteAppliedEntry>,
  ruleId: string,
  fromBook: string,
): WorldbookWriteAppliedEntry[] {
  const trimmedBook = fromBook.trim();
  const trimmedRuleId = ruleId.trim();
  const out: WorldbookWriteAppliedEntry[] = [];
  const seen = new Set<string>();
  for (const entry of ledger.values()) {
    if (entry.ruleId !== trimmedRuleId) continue;
    if (entry.bookName.trim() !== trimmedBook) continue;
    const stableName = entry.stableName.trim();
    if (!stableName || seen.has(stableName)) continue;
    seen.add(stableName);
    out.push(entry);
  }
  return out;
}

export function shouldDeleteManagedEntryForRuleOnBook(
  entryName: string,
  rule: ChatWorldbookWriteRule,
  stableNamesToMigrate: ReadonlySet<string>,
  ledgerStableNamesOnFromBook: ReadonlySet<string>,
): boolean {
  const trimmed = (entryName || '').trim();
  if (!trimmed) return false;
  if (stableNamesToMigrate.has(trimmed)) return true;
  if (!isManagedWorldbookEntryNameForRule(trimmed, rule)) return false;
  return !ledgerStableNamesOnFromBook.has(trimmed);
}

export function rewriteAppliedEntriesBookName(
  applied: WorldbookWriteAppliedEntry[],
  ruleId: string,
  fromBook: string,
  toBook: string,
): { next: WorldbookWriteAppliedEntry[]; changed: number } {
  const trimmedRuleId = ruleId.trim();
  const trimmedFrom = fromBook.trim();
  const trimmedTo = toBook.trim();
  let changed = 0;
  const next = applied.map(entry => {
    if (entry.ruleId !== trimmedRuleId) return entry;
    if (entry.bookName.trim() !== trimmedFrom) return entry;
    changed++;
    return { ...entry, bookName: trimmedTo };
  });
  return { next, changed };
}

export function rewriteSnapshotEntriesBookName(
  snapshots: WorldbookWriteSnapshotEntry[],
  fromBook: string,
  stableNamesToMigrate: ReadonlySet<string>,
  toBook: string,
): { next: WorldbookWriteSnapshotEntry[]; changed: number } {
  const trimmedFrom = fromBook.trim();
  const trimmedTo = toBook.trim();
  let changed = 0;
  const next = snapshots.map(snap => {
    if (snap.bookName.trim() !== trimmedFrom) return snap;
    if (!stableNamesToMigrate.has(snap.entryName.trim())) return snap;
    changed++;
    return { ...snap, bookName: trimmedTo };
  });
  return { next, changed };
}
