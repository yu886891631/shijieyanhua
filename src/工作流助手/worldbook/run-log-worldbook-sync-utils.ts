import type { ChatWorldbookWriteRule } from '../tasks/schema';
import {
  buildCompositeKey,
  parseCompositeKey,
  parseExtractTagSpec,
  storedTagValueToInner,
} from '../tasks/tag-extract';
import { removeTagKeyFromRawContainer } from '../tasks/tag-variables-nested';
import { resolveAppliedExtraKeys } from './entry-keys';
import { ledgerEntryKey } from './write-ledger-utils';
import { defaultWorldbookEntryName, resolveEntryKeys, resolveStableEntryName } from './write-from-template';
import type { WorldbookWriteAppliedEntry } from './write-sync';

export type AppliedLedgerOwnerEntry = WorldbookWriteAppliedEntry & {
  ownerMessageId: number;
};

export type RunLogWorldbookRow = {
  rowKey: string;
  ruleId: string;
  targetTag: string;
  tagKey: string;
  stableName: string;
  bookName: string;
  ownerMessageId: number;
  content: string;
  entryType: ChatWorldbookWriteRule['entryType'];
  defaultKeys: string[];
  extraKeys: string[];
};

export { removeTagKeyFromRawContainer };

export function collectAppliedLedgerWithOwnersFromBatches(
  batches: Array<{ messageId: number; entries: WorldbookWriteAppliedEntry[] }>,
): Map<string, AppliedLedgerOwnerEntry> {
  const merged = new Map<string, AppliedLedgerOwnerEntry>();
  for (const batch of batches) {
    for (const entry of batch.entries) {
      if (!entry?.bookName?.trim() || !entry?.stableName?.trim()) continue;
      const key = ledgerEntryKey(entry.bookName, entry.stableName);
      merged.set(key, { ...entry, ownerMessageId: batch.messageId });
    }
  }
  return merged;
}

export function extractTagInnerFromWorldbookContent(tagKey: string, content: string): string {
  return storedTagValueToInner(tagKey, content);
}

function inferAttrValueFromDefaultStableName(
  rule: ChatWorldbookWriteRule,
  stableName: string,
): string | null {
  const spec = parseExtractTagSpec(rule.targetTag.trim());
  if (!spec?.attrName) return null;
  const tagName = spec.tagName;
  const attrName = spec.attrName;
  const workflowPrefix = `WorkflowHelper-${tagName} ${attrName}-`;
  if (stableName.startsWith(workflowPrefix)) {
    return stableName.slice(workflowPrefix.length);
  }
  const prefix = defaultWorldbookEntryName(rule, 'PLACEHOLDER').replace('PLACEHOLDER', '');
  if (stableName.startsWith(prefix)) return stableName.slice(prefix.length);
  return null;
}

export function resolveTagKeyForRow(
  rule: ChatWorldbookWriteRule,
  stableName: string,
  ownerFloorTags: Record<string, string>,
): string | null {
  const spec = parseExtractTagSpec(rule.targetTag.trim());
  const trimmedStable = stableName.trim();

  if (rule.splitByAttr && spec?.attrName) {
    for (const key of Object.keys(ownerFloorTags)) {
      const parsed = parseCompositeKey(key);
      if (!parsed) continue;
      if (resolveStableEntryName(rule, parsed.attrValue) === trimmedStable) return key;
    }
    const attrValue = inferAttrValueFromDefaultStableName(rule, trimmedStable);
    if (attrValue) return buildCompositeKey(spec.tagName, spec.attrName, attrValue);
    return null;
  }

  const tagName = spec?.tagName ?? rule.targetTag.trim();
  if (!tagName) return null;
  if (resolveStableEntryName(rule) === trimmedStable) return tagName;
  if (Object.prototype.hasOwnProperty.call(ownerFloorTags, tagName)) return tagName;
  return tagName;
}

export function buildRunLogWorldbookRow(
  entry: AppliedLedgerOwnerEntry,
  rule: ChatWorldbookWriteRule,
  ownerFloorTags: Record<string, string>,
  liveContent: string | null,
): RunLogWorldbookRow | null {
  const tagKey = resolveTagKeyForRow(rule, entry.stableName, ownerFloorTags);
  if (!tagKey) return null;

  const fallback = String(entry.partial?.content ?? '').trim();
  const content = (liveContent ?? fallback).trim();
  if (!content && !fallback) return null;

  const defaultKeys =
    rule.entryType === 'keyword' ? resolveEntryKeys(rule, tagKey) : [];
  const extraKeys = rule.entryType === 'keyword' ? resolveAppliedExtraKeys(entry) : [];

  return {
    rowKey: ledgerEntryKey(entry.bookName, entry.stableName),
    ruleId: entry.ruleId,
    targetTag: rule.targetTag,
    tagKey,
    stableName: entry.stableName,
    bookName: entry.bookName,
    ownerMessageId: entry.ownerMessageId,
    content: content || fallback,
    entryType: rule.entryType,
    defaultKeys,
    extraKeys,
  };
}
