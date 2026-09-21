import { buildFloorTagMap, readTagContainer, removeFloorTagKey, writeFloorTagValues } from '../tasks/tag-variables';
import type { ChatWorldbookWriteRule } from '../tasks/schema';
import {
  deleteWorldbookEntriesByStableName,
  pruneAppliedLedgerFromChat,
} from '../tasks/prune-applied-for-replica';
import {
  buildRunLogWorldbookRow,
  collectAppliedLedgerWithOwnersFromBatches,
  extractTagInnerFromWorldbookContent,
  type RunLogWorldbookRow,
} from './run-log-worldbook-sync-utils';
import { mergeEntryKeys, normalizeKeywordList } from './entry-keys';
import { POST_PROCESS_WORLDBOOK_WRITE_APPLIED_KEY, scheduleWorldbookReconcile } from './write-reconcile';
import { upsertEntryByStableName } from './write-from-template';
import { appendAppliedToMessage, withWorldbookWriteLock, type WorldbookWriteAppliedEntry } from './write-sync';

export type { RunLogWorldbookRow } from './run-log-worldbook-sync-utils';
export {
  buildRunLogWorldbookRow,
  collectAppliedLedgerWithOwnersFromBatches,
  extractTagInnerFromWorldbookContent,
  removeTagKeyFromRawContainer,
  resolveTagKeyForRow,
} from './run-log-worldbook-sync-utils';

function readAppliedFromMessage(messageId: number): WorldbookWriteAppliedEntry[] {
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

export function collectAppliedLedgerWithOwners(maxMessageId: number): Map<
  string,
  import('./run-log-worldbook-sync-utils').AppliedLedgerOwnerEntry
> {
  if (maxMessageId < 0) return new Map();

  let msgs;
  try {
    msgs = getChatMessages(`0-${maxMessageId}`);
  } catch {
    return new Map();
  }

  const batches: Array<{ messageId: number; entries: WorldbookWriteAppliedEntry[] }> = [];
  for (const msg of msgs) {
    if (msg.role !== 'assistant') continue;
    batches.push({ messageId: msg.message_id, entries: readAppliedFromMessage(msg.message_id) });
  }
  return collectAppliedLedgerWithOwnersFromBatches(batches);
}

async function readLiveWorldbookContent(bookName: string, stableName: string): Promise<string | null> {
  try {
    const entries = await getWorldbook(bookName);
    const entry = entries.find(e => (e.name || '').trim() === stableName.trim());
    if (!entry) return null;
    return entry.content ?? '';
  } catch {
    return null;
  }
}

export async function collectRunLogWorldbookRows(options: {
  maxMessageId: number;
  rules: ChatWorldbookWriteRule[];
}): Promise<RunLogWorldbookRow[]> {
  const { maxMessageId, rules } = options;
  if (maxMessageId < 0 || !rules.length) return [];

  const ruleById = new Map(rules.map(rule => [rule.id, rule]));
  const owners = collectAppliedLedgerWithOwners(maxMessageId);
  const rows: RunLogWorldbookRow[] = [];
  const contentCache = new Map<string, string | null>();

  for (const entry of owners.values()) {
    const rule = ruleById.get(entry.ruleId);
    if (!rule) continue;

    let ownerFloorTags: Record<string, string> = {};
    try {
      const variables = getVariables({ type: 'message', message_id: entry.ownerMessageId }) ?? {};
      ownerFloorTags = readTagContainer(variables);
    } catch {
      ownerFloorTags = Object.fromEntries(buildFloorTagMap(entry.ownerMessageId).entries());
    }

    const cacheKey = `${entry.bookName}\0${entry.stableName}`;
    if (!contentCache.has(cacheKey)) {
      contentCache.set(cacheKey, await readLiveWorldbookContent(entry.bookName, entry.stableName));
    }
    const liveContent = contentCache.get(cacheKey) ?? null;

    const row = buildRunLogWorldbookRow(entry, rule, ownerFloorTags, liveContent);
    if (row) rows.push(row);
  }

  rows.sort((a, b) => {
    const book = a.bookName.localeCompare(b.bookName, undefined, { numeric: true });
    if (book !== 0) return book;
    return a.stableName.localeCompare(b.stableName, undefined, { numeric: true });
  });
  return rows;
}

export async function applyRunLogWorldbookEdit(
  row: RunLogWorldbookRow,
  nextContent: string,
  nextExtraKeys?: string[] | string,
): Promise<void> {
  const trimmedContent = nextContent.trim();
  if (!trimmedContent) throw new Error('条目内容不能为空');

  const isKeyword = row.entryType === 'keyword';
  const extraKeys = isKeyword
    ? normalizeKeywordList(nextExtraKeys ?? row.extraKeys)
    : [];
  const defaultKeys = isKeyword ? row.defaultKeys : [];

  await withWorldbookWriteLock(async () => {
    const inner = extractTagInnerFromWorldbookContent(row.tagKey, trimmedContent);
    writeFloorTagValues(row.ownerMessageId, { [row.tagKey]: inner });

    const existing = collectAppliedLedgerWithOwners(row.ownerMessageId).get(row.rowKey);
    const partial = _.cloneDeep(existing?.partial ?? { name: row.stableName, enabled: true });
    partial.content = trimmedContent;
    partial.name = row.stableName;

    if (isKeyword) {
      const mergedKeys = mergeEntryKeys(defaultKeys, extraKeys);
      partial.strategy = {
        ...(partial.strategy ?? {
          type: 'selective' as const,
          keys_secondary: { logic: 'and_any' as const, keys: [] },
          scan_depth: 'same_as_global' as const,
        }),
        type: 'selective',
        keys: mergedKeys,
      };
    }

    await upsertEntryByStableName(row.bookName, row.stableName, partial);
    await appendAppliedToMessage(row.ownerMessageId, {
      ruleId: row.ruleId,
      bookName: row.bookName,
      stableName: row.stableName,
      partial,
      ...(isKeyword ? { extraKeys } : {}),
    });
  });

  scheduleWorldbookReconcile('run_log_edit', 500);
}

export async function deleteRunLogWorldbookRow(row: RunLogWorldbookRow): Promise<void> {
  await withWorldbookWriteLock(async () => {
    await deleteWorldbookEntriesByStableName([{ bookName: row.bookName, stableName: row.stableName }]);
    await pruneAppliedLedgerFromChat(new Set([row.stableName.trim()]));
    removeFloorTagKey(row.ownerMessageId, row.tagKey);
  });

  scheduleWorldbookReconcile('run_log_delete', 500);
}
