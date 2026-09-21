import type { WorldbookEntry } from '@types/function/worldbook';
import {
  collectStageTagsForRule,
  renderChatBodyTagReplaceTemplate,
} from '../tasks/chat-body-tag-replace';
import {
  formatExtractedFragmentForKey,
  parseCompositeKey,
  parseExtractTagSpec,
} from '../tasks/tag-extract';
import { writeFloorTagValues } from '../tasks/tag-variables';
import { normalizePlotWorldbookPosition, normalizeWorldbookWritePlacement } from './entry-order';
import {
  expandNameSeparatorKeywords,
  mergeEntryKeys,
  resolveAppliedExtraKeys,
} from './entry-keys';
import {
  appendAppliedToMessage,
  appliedLedgerKey,
  POST_PROCESS_WORLDBOOK_WRITE_APPLIED_KEY,
  reloadWorldInfoEditorIfSelected,
  withWorldbookWriteLock,
  type WorldbookWriteAppliedEntry,
} from './write-sync';
import { mergeAppliedLedgerEntries, resolveWrapperStableNames } from './write-ledger-utils';
import type { ChatWorldbookWriteRule, ScriptSettings } from '../tasks/schema';
import type { TaskRunResult } from '../tasks/runtime';
import { parseCommaSeparatedList } from '../tasks/comma-separated';

export { resolveWrapperEntryBaseName, resolveWrapperStableNames } from './write-ledger-utils';
export {
  diffExtraKeys,
  expandNameSeparatorKeywords,
  mergeEntryKeys,
  normalizeKeywordList,
  remapKeywordsForAttrRename,
  resolveAppliedExtraKeys,
} from './entry-keys';

export const POST_PROCESS_WORLDBOOK_WRITE_SNAPSHOT_KEY = '_post_process_worldbook_write_snapshots';

export type WorldbookWriteSnapshotEntry = {
  bookName: string;
  entryName: string;
  uid: number;
  content: string;
  enabled: boolean;
  existed: boolean;
};

function isMvuExtraAnalysisActive(): boolean {
  try {
    return typeof Mvu !== 'undefined' && Mvu.isDuringExtraAnalysis?.() === true;
  } catch {
    return false;
  }
}

function splitCommaKeywords(raw: string): string[] {
  return parseCommaSeparatedList(raw);
}

export function defaultWorldbookEntryName(rule: ChatWorldbookWriteRule, attrValue?: string): string {
  const spec = parseExtractTagSpec(rule.targetTag.trim());
  const tagName = spec?.tagName ?? rule.targetTag.trim();
  if (rule.splitByAttr && spec?.attrName && attrValue != null) {
    return `WorkflowHelper-${tagName} ${spec.attrName}-${attrValue}`;
  }
  return `WorkflowHelper-${tagName}`;
}

/** 条目名固定为默认 WorkflowHelper-…（忽略规则中遗留的 entryName 字段） */
export function resolveStableEntryName(rule: ChatWorldbookWriteRule, attrValue?: string): string {
  return defaultWorldbookEntryName(rule, attrValue);
}

/** 按属性拆分包裹：XML 标签名（可配置；空则用目标标签 tagName） */
export function resolveWrapTagName(rule: ChatWorldbookWriteRule): string {
  const custom = (rule.wrapTagName ?? '').trim();
  if (custom) return custom;
  const spec = parseExtractTagSpec(rule.targetTag.trim());
  return (spec?.tagName ?? rule.targetTag.trim()).trim();
}

export function resolveWrapperContent(rule: ChatWorldbookWriteRule, side: 'before' | 'after'): string {
  const tag = resolveWrapTagName(rule);
  if (!tag) return '';
  return side === 'before' ? `<${tag}>` : `</${tag}>`;
}

function buildPositionWithOrder(rule: ChatWorldbookWriteRule, order: number): WorldbookEntry['position'] {
  const placement = normalizeWorldbookWritePlacement(rule.placement);
  const normalized = normalizePlotWorldbookPosition(placement.position);
  if (normalized === 'at_depth_as_system') {
    return {
      type: 'at_depth',
      role: 'system',
      depth: placement.depth,
      order,
    };
  }
  return {
    type: normalized,
    role: 'system',
    depth: 0,
    order,
  };
}

function buildRecursion(rule: ChatWorldbookWriteRule): WorldbookEntry['recursion'] {
  const prevent = rule.preventRecursion !== false;
  return {
    prevent_incoming: prevent,
    prevent_outgoing: prevent,
    delay_until: null,
  };
}

/** 包裹条目固定 constant；order 为规则 order±1 */
export function buildWrapperEntryPartial(
  rule: ChatWorldbookWriteRule,
  side: 'before' | 'after',
): Partial<WorldbookEntry> {
  const placement = normalizeWorldbookWritePlacement(rule.placement);
  const baseOrder = placement.order;
  const order = side === 'before' ? Math.max(1, baseOrder - 1) : baseOrder + 1;
  const content = resolveWrapperContent(rule, side);
  return {
    enabled: true,
    content,
    strategy: {
      type: 'constant',
      keys: [],
      keys_secondary: { logic: 'and_any', keys: [] },
      scan_depth: 'same_as_global',
    },
    position: buildPositionWithOrder(rule, order),
    probability: 100,
    recursion: buildRecursion(rule),
    effect: {
      sticky: null,
      cooldown: null,
      delay: null,
    },
  };
}

export function resolveWorldbookWriteContent(
  tagKey: string,
  stageTags: Record<string, string>,
  rendered: string,
  useSplit: boolean,
): string {
  if (useSplit) {
    const raw = stageTags[tagKey]?.trim();
    if (raw) return formatExtractedFragmentForKey(tagKey, raw);
  }
  return rendered.trim();
}

/**
 * 将说明文档里的字面占位符「标签@属性」替换为规则实际目标规格。
 * 例如目标 npc@act 时：{{total:launched:标签@属性}} → {{total:launched:npc@act}}
 */
export function rewriteAttrSpecDocPlaceholders(template: string, targetTag: string): string {
  const spec = parseExtractTagSpec(targetTag.trim());
  if (!spec?.attrName) return template;
  const concrete = `${spec.tagName}@${spec.attrName}`;
  // 长前缀优先，避免 total:标签@属性 误伤 total:launched:…
  return template
    .split('{{total:last-launched:标签@属性}}')
    .join(`{{total:last-launched:${concrete}}}`)
    .split('{{total:launched:标签@属性}}')
    .join(`{{total:launched:${concrete}}}`)
    .split('{{total:标签@属性}}')
    .join(`{{total:${concrete}}}`)
    .split('{{标签@属性}}')
    .join(`{{${concrete}}}`);
}

export function resolveWriteTargetBookName(rule: ChatWorldbookWriteRule): string | null {
  if (rule.bookSource === 'manual') {
    const name = rule.manualBookName.trim();
    return name || null;
  }
  try {
    const books = getCharWorldbookNames('current');
    const primary = books.primary?.trim();
    return primary || null;
  } catch {
    return null;
  }
}

export function resolveEntryKeys(rule: ChatWorldbookWriteRule, compositeKey?: string): string[] {
  const staticKeys = splitCommaKeywords(rule.keywords);
  if (rule.entryType !== 'keyword') return [];

  const spec = parseExtractTagSpec(rule.targetTag.trim());
  let keys: string[] = staticKeys;
  if (rule.splitByAttr && compositeKey && spec?.attrName) {
    const parsed = parseCompositeKey(compositeKey);
    if (parsed) {
      keys = [...splitCommaKeywords(parsed.attrValue), ...staticKeys];
    }
  } else if (!staticKeys.length && spec && !spec.attrName) {
    // 裸标签 keyword 条目：未填静态关键字时默认使用标签名（如 result）
    keys = [spec.tagName];
  }
  return expandNameSeparatorKeywords(keys);
}

function buildPosition(rule: ChatWorldbookWriteRule): WorldbookEntry['position'] {
  const placement = normalizeWorldbookWritePlacement(rule.placement);
  const normalized = normalizePlotWorldbookPosition(placement.position);
  if (normalized === 'at_depth_as_system') {
    return {
      type: 'at_depth',
      role: 'system',
      depth: placement.depth,
      order: placement.order,
    };
  }
  return {
    type: normalized,
    role: 'system',
    depth: 0,
    order: placement.order,
  };
}

export function buildWorldbookEntryPartial(
  rule: ChatWorldbookWriteRule,
  content: string,
  compositeKey?: string,
  extraKeys: string[] = [],
): Partial<WorldbookEntry> {
  const keys = mergeEntryKeys(resolveEntryKeys(rule, compositeKey), extraKeys);
  const strategyType = rule.entryType === 'keyword' ? 'selective' : 'constant';
  return {
    enabled: true,
    content,
    strategy: {
      type: strategyType,
      keys,
      keys_secondary: { logic: 'and_any', keys: [] },
      scan_depth: 'same_as_global',
    },
    position: buildPosition(rule),
    probability: 100,
    recursion: buildRecursion(rule),
    effect: {
      sticky: null,
      cooldown: null,
      delay: null,
    },
  };
}

function readAppliedFromMessageData(messageId: number): WorldbookWriteAppliedEntry[] {
  const msg = getChatMessages(messageId)[0];
  if (!msg || msg.role !== 'assistant') return [];
  const data = (msg.data ?? {}) as Record<string, unknown>;
  const raw = data[POST_PROCESS_WORLDBOOK_WRITE_APPLIED_KEY];
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (item): item is WorldbookWriteAppliedEntry =>
      !!item &&
      typeof item === 'object' &&
      typeof (item as WorldbookWriteAppliedEntry).bookName === 'string' &&
      typeof (item as WorldbookWriteAppliedEntry).stableName === 'string' &&
      !!(item as WorldbookWriteAppliedEntry).partial,
  );
}

/** 收集截至 maxMessageId 的 applied 账本（含当前楼），供阶段重写保留 extraKeys */
function collectAppliedLedgerUpTo(maxMessageId: number): Map<string, WorldbookWriteAppliedEntry> {
  if (maxMessageId < 0) return new Map();
  let msgs;
  try {
    msgs = getChatMessages(`0-${maxMessageId}`);
  } catch {
    return new Map();
  }
  const batches: WorldbookWriteAppliedEntry[][] = [];
  for (const msg of msgs) {
    if (msg.role !== 'assistant') continue;
    batches.push(readAppliedFromMessageData(msg.message_id));
  }
  return mergeAppliedLedgerEntries(batches);
}

export async function upsertEntryByStableName(
  bookName: string,
  stableName: string,
  partial: Partial<WorldbookEntry>,
): Promise<{ uid: number; created: boolean; previous: WorldbookWriteSnapshotEntry | null }> {
  let previous: WorldbookWriteSnapshotEntry | null = null;
  let resultUid = 0;
  let updated = false;

  await updateWorldbookWith(bookName, entries => {
    const idx = entries.findIndex(e => (e.name || '').trim() === stableName);
    if (idx < 0) return entries;
    const existing = entries[idx]!;
    previous = {
      bookName,
      entryName: stableName,
      uid: existing.uid,
      content: existing.content ?? '',
      enabled: existing.enabled !== false,
      existed: true,
    };
    entries[idx] = {
      ...existing,
      ...partial,
      name: stableName,
      uid: existing.uid,
    };
    resultUid = existing.uid;
    updated = true;
    return entries;
  });

  if (updated) {
    return { uid: resultUid, created: false, previous };
  }

  previous = {
    bookName,
    entryName: stableName,
    uid: -1,
    content: '',
    enabled: true,
    existed: false,
  };
  const { new_entries } = await createWorldbookEntries(bookName, [{ ...partial, name: stableName }]);
  const createdEntry = new_entries[0];
  if (createdEntry) {
    resultUid = createdEntry.uid;
    previous = { ...previous, uid: createdEntry.uid };
  }
  return { uid: resultUid, created: true, previous };
}

function snapshotLedgerKey(bookName: string, entryName: string): string {
  return `${bookName.trim()}\0${entryName.trim()}`;
}

/** 同楼快照：同 bookName+entryName 仅保留首次（写入前状态），后续阶段不重复追加 */
export function upsertSnapshotKeepFirstInList(
  list: WorldbookWriteSnapshotEntry[],
  snapshot: WorldbookWriteSnapshotEntry,
): { list: WorldbookWriteSnapshotEntry[]; skipped: boolean } {
  const key = snapshotLedgerKey(snapshot.bookName, snapshot.entryName);
  const exists = list.some(e => snapshotLedgerKey(e.bookName, e.entryName) === key);
  if (exists) return { list, skipped: true };
  return { list: [...list, snapshot], skipped: false };
}

async function appendSnapshotToMessage(
  messageId: number,
  snapshot: WorldbookWriteSnapshotEntry,
): Promise<void> {
  const msg = getChatMessages(messageId)[0];
  if (!msg) return;
  const data = (msg.data ?? {}) as Record<string, unknown>;
  const raw = data[POST_PROCESS_WORLDBOOK_WRITE_SNAPSHOT_KEY];
  const prev = Array.isArray(raw) ? [...(raw as WorldbookWriteSnapshotEntry[])] : [];
  const { list } = upsertSnapshotKeepFirstInList(prev, snapshot);
  await setChatMessages(
    [
      {
        message_id: messageId,
        data: { ...data, [POST_PROCESS_WORLDBOOK_WRITE_SNAPSHOT_KEY]: list },
      },
    ],
    { refresh: 'none' },
  );
}

export async function restoreWorldbookWriteSnapshots(messageId: number): Promise<void> {
  const msg = getChatMessages(messageId)[0];
  if (!msg) return;
  const data = (msg.data ?? {}) as Record<string, unknown>;
  const raw = data[POST_PROCESS_WORLDBOOK_WRITE_SNAPSHOT_KEY];
  if (!Array.isArray(raw) || !raw.length) return;

  for (const snap of raw as WorldbookWriteSnapshotEntry[]) {
    if (!snap?.bookName || !snap.entryName) continue;
    try {
      if (!snap.existed) {
        await deleteWorldbookEntries(snap.bookName, e => e.uid === snap.uid);
        continue;
      }
      await updateWorldbookWith(snap.bookName, entries => {
        const idx = entries.findIndex(e => e.uid === snap.uid);
        if (idx >= 0) {
          entries[idx] = {
            ...entries[idx]!,
            content: snap.content,
            enabled: snap.enabled,
          };
        }
        return entries;
      });
    } catch (e) {
      console.warn('[工作流助手] 恢复世界书写入快照失败:', snap.entryName, e);
    }
  }

  const nextData = { ...data };
  delete nextData[POST_PROCESS_WORLDBOOK_WRITE_SNAPSHOT_KEY];
  await setChatMessages([{ message_id: messageId, data: nextData }], { refresh: 'none' });
}

function isWorldbookWriteRuleActive(
  rule: ChatWorldbookWriteRule,
  assistantTags: string[],
  stageResults: TaskRunResult[],
): boolean {
  const targetTag = rule.targetTag.trim();
  const template = rule.template.trim();
  if (!targetTag || !template) return false;
  if (assistantTags.some(t => t.trim() === targetTag)) return true;
  const stageTags = collectStageTagsForRule(stageResults, targetTag);
  return Object.keys(stageTags).length > 0;
}

export interface ApplyChatWorldbookWriteAfterStageOptions {
  messageId: number;
  settings: ScriptSettings;
  stageResults: TaskRunResult[];
  allStageResults: TaskRunResult[];
}

export async function applyChatWorldbookWriteAfterStage(
  options: ApplyChatWorldbookWriteAfterStageOptions,
): Promise<void> {
  const { messageId, settings, stageResults, allStageResults } = options;
  const rules = settings.chatWorldbookWriteRules ?? [];
  if (!rules.length) return;

  const msg = getChatMessages(messageId)[0];
  if (!msg || msg.role !== 'assistant') return;

  if (isMvuExtraAnalysisActive()) {
    console.warn('[工作流助手] MVU 额外模型解析进行中，已跳过本阶段世界书写入');
    return;
  }

  await withWorldbookWriteLock(async () => {
    const assistantTags = settings.chatExtractTags?.assistant ?? [];
    const writtenBooks = new Set<string>();
    const priorLedger = collectAppliedLedgerUpTo(messageId);

    for (const rule of rules) {
      if (!isWorldbookWriteRuleActive(rule, assistantTags, stageResults)) continue;

      const stageTags = collectStageTagsForRule(stageResults, rule.targetTag);
      if (!Object.keys(stageTags).length) continue;

      const bookName = resolveWriteTargetBookName(rule);
      if (!bookName) {
        console.warn('[工作流助手] 世界书写入跳过：未找到目标世界书', rule.id || rule.targetTag);
        continue;
      }

      writeFloorTagValues(messageId, stageTags);

      const spec = parseExtractTagSpec(rule.targetTag.trim());
      const useSplit = rule.splitByAttr && !!spec?.attrName;
      const keysToWrite = useSplit ? Object.keys(stageTags) : [spec?.tagName ?? rule.targetTag.trim()];
      const template = rewriteAttrSpecDocPlaceholders(rule.template, rule.targetTag);

      let writtenCount = 0;
      for (const tagKey of keysToWrite) {
        const rendered = await renderChatBodyTagReplaceTemplate(
          template,
          allStageResults,
          messageId,
          settings.tasks,
        );
        const content = resolveWorldbookWriteContent(tagKey, stageTags, rendered, useSplit);
        if (!content) continue;

        const parsed = useSplit ? parseCompositeKey(tagKey) : null;
        const attrValue = parsed?.attrValue;
        const stableName = resolveStableEntryName(rule, attrValue);
        const compositeKey = useSplit ? tagKey : undefined;
        const defaultKeys = resolveEntryKeys(rule, compositeKey);
        if (rule.entryType === 'keyword' && defaultKeys.length === 0) continue;

        const ledgerKey = appliedLedgerKey(bookName, stableName);
        const extraKeys =
          rule.entryType === 'keyword' ? resolveAppliedExtraKeys(priorLedger.get(ledgerKey)) : [];

        const partial = buildWorldbookEntryPartial(rule, content, compositeKey, extraKeys);
        partial.name = stableName;

        const { previous } = await upsertEntryByStableName(bookName, stableName, partial);
        if (previous) {
          await appendSnapshotToMessage(messageId, previous);
        }

        const appliedPartial = _.cloneDeep(partial);
        appliedPartial.name = stableName;
        const applied: WorldbookWriteAppliedEntry = {
          ruleId: rule.id,
          bookName,
          stableName,
          partial: appliedPartial,
          ...(rule.entryType === 'keyword' ? { extraKeys } : {}),
        };
        await appendAppliedToMessage(messageId, applied);
        priorLedger.set(ledgerKey, applied);
        writtenBooks.add(bookName);
        writtenCount += 1;
      }

      if (useSplit && writtenCount > 0) {
        const { before, after } = resolveWrapperStableNames(rule);
        for (const side of ['before', 'after'] as const) {
          const stableName = side === 'before' ? before : after;
          const partial = buildWrapperEntryPartial(rule, side);
          if (!partial.content) continue;
          partial.name = stableName;

          const { previous } = await upsertEntryByStableName(bookName, stableName, partial);
          if (previous) {
            await appendSnapshotToMessage(messageId, previous);
          }

          const appliedPartial = _.cloneDeep(partial);
          appliedPartial.name = stableName;
          await appendAppliedToMessage(messageId, {
            ruleId: rule.id,
            bookName,
            stableName,
            partial: appliedPartial,
          });
          writtenBooks.add(bookName);
        }
      }
    }

    reloadWorldInfoEditorIfSelected(writtenBooks);
  });
}
