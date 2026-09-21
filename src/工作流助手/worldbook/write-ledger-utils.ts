import type { ChatWorldbookWriteRule } from '../tasks/schema';
import { parseExtractTagSpec } from '../tasks/tag-extract';
import { WORKFLOW_HELPER_ENTRY_PREFIX, type WorldbookWriteAppliedEntry } from './write-sync';

export function ledgerEntryKey(bookName: string, stableName: string): string {
  return `${bookName.trim()}\0${stableName.trim()}`;
}

/** @deprecated 手动条目名已移除；恒返回 null，保留导出以免外部引用报错 */
export function customEntryNamePrefix(_rule: ChatWorldbookWriteRule): string | null {
  return null;
}

/** 包裹条目共用 base（不含 -包裹-上/下） */
export function resolveWrapperEntryBaseName(rule: ChatWorldbookWriteRule): string {
  const spec = parseExtractTagSpec(rule.targetTag.trim());
  const tagName = spec?.tagName ?? rule.targetTag.trim();
  return `WorkflowHelper-${tagName}`;
}

export function resolveWrapperStableNames(rule: ChatWorldbookWriteRule): { before: string; after: string } {
  const base = resolveWrapperEntryBaseName(rule);
  return {
    before: `${base}-包裹-上`,
    after: `${base}-包裹-下`,
  };
}

function isWrapperEntryNameForRule(name: string, rule: ChatWorldbookWriteRule): boolean {
  if (!rule.splitByAttr) return false;
  const { before, after } = resolveWrapperStableNames(rule);
  return name === before || name === after;
}

export function isManagedWorldbookEntryName(name: string, rules: ChatWorldbookWriteRule[]): boolean {
  const trimmed = (name || '').trim();
  if (!trimmed) return false;
  if (trimmed.startsWith(WORKFLOW_HELPER_ENTRY_PREFIX)) return true;
  return rules.some(rule => isWrapperEntryNameForRule(trimmed, rule));
}

/** 单条世界书写入规则托管条目名判定（比全局 isManagedWorldbookEntryName 更精确） */
export function isManagedWorldbookEntryNameForRule(name: string, rule: ChatWorldbookWriteRule): boolean {
  const trimmed = (name || '').trim();
  if (!trimmed) return false;
  if (isWrapperEntryNameForRule(trimmed, rule)) return true;
  const tag = rule.targetTag.trim();
  const atIdx = tag.indexOf('@');
  const tagName = atIdx > 0 ? tag.slice(0, atIdx) : tag;
  if (rule.splitByAttr && atIdx > 0) {
    const attrName = tag.slice(atIdx + 1);
    const prefix = `WorkflowHelper-${tagName} ${attrName}-`;
    return trimmed.startsWith(prefix) && trimmed.length > prefix.length;
  }
  return trimmed === `WorkflowHelper-${tagName}` || trimmed.startsWith(`WorkflowHelper-${tagName} `);
}

export function mergeAppliedLedgerEntries(
  batches: WorldbookWriteAppliedEntry[][],
): Map<string, WorldbookWriteAppliedEntry> {
  const merged = new Map<string, WorldbookWriteAppliedEntry>();
  for (const batch of batches) {
    for (const entry of batch) {
      if (!entry?.bookName?.trim() || !entry?.stableName?.trim()) continue;
      merged.set(ledgerEntryKey(entry.bookName, entry.stableName), entry);
    }
  }
  return merged;
}

export function ledgerStableNamesForBook(
  ledger: Map<string, WorldbookWriteAppliedEntry>,
  bookName: string,
): Set<string> {
  const names = new Set<string>();
  const trimmedBook = bookName.trim();
  for (const entry of ledger.values()) {
    if (entry.bookName.trim() !== trimmedBook) continue;
    names.add(entry.stableName.trim());
  }
  return names;
}

/** 托管条目是否应删除：在 ledger 中无对应 stableName 的孤儿 */
export function shouldDeleteManagedEntryAsOrphan(
  entryName: string,
  rules: ChatWorldbookWriteRule[],
  ledgerStableNames: Set<string>,
): boolean {
  const trimmed = (entryName || '').trim();
  if (!trimmed) return false;
  if (!isManagedWorldbookEntryName(trimmed, rules)) return false;
  return !ledgerStableNames.has(trimmed);
}
