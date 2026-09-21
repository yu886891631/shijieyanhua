import type { ChatWorldbookWriteRule } from '../tasks/schema';
import {
  POST_PROCESS_WORLDBOOK_WRITE_SNAPSHOT_KEY,
  resolveWriteTargetBookName,
  upsertEntryByStableName,
  type WorldbookWriteSnapshotEntry,
} from './write-from-template';
import {
  collectEntriesToMoveFromLedger,
  rewriteAppliedEntriesBookName,
  rewriteSnapshotEntriesBookName,
  shouldDeleteManagedEntryForRuleOnBook,
} from './write-book-migrate-utils';
import {
  collectAppliedLedgerFromChat,
  ledgerStableNamesForBook,
  scheduleWorldbookReconcile,
} from './write-reconcile';
import {
  POST_PROCESS_WORLDBOOK_WRITE_APPLIED_KEY,
  withWorldbookWriteLock,
  type WorldbookWriteAppliedEntry,
} from './write-sync';

export {
  collectEntriesToMoveFromLedger,
  rewriteAppliedEntriesBookName,
  rewriteSnapshotEntriesBookName,
  shouldDeleteManagedEntryForRuleOnBook,
} from './write-book-migrate-utils';

const CLEANUP_SETTLE_DELAY_MS = 300;

async function waitForCleanupSettle(): Promise<void> {
  await new Promise<void>(resolve => setTimeout(resolve, CLEANUP_SETTLE_DELAY_MS));
}

async function rewriteAppliedBookNameInChat(
  ruleId: string,
  fromBook: string,
  toBook: string,
  stableNamesToMigrate: ReadonlySet<string>,
): Promise<number> {
  const lastId = getLastMessageId();
  if (lastId < 0) return 0;

  let msgs;
  try {
    msgs = getChatMessages(`0-${lastId}`);
  } catch {
    return 0;
  }

  let totalChanged = 0;
  const updates: Array<{ message_id: number; data: Record<string, unknown> }> = [];

  for (const msg of msgs) {
    if (msg.role !== 'assistant') continue;
    const data = { ...(msg.data ?? {}) } as Record<string, unknown>;
    let messageChanged = false;

    const rawApplied = data[POST_PROCESS_WORLDBOOK_WRITE_APPLIED_KEY];
    if (Array.isArray(rawApplied)) {
      const { next, changed } = rewriteAppliedEntriesBookName(
        rawApplied as WorldbookWriteAppliedEntry[],
        ruleId,
        fromBook,
        toBook,
      );
      if (changed > 0) {
        data[POST_PROCESS_WORLDBOOK_WRITE_APPLIED_KEY] = next;
        totalChanged += changed;
        messageChanged = true;
      }
    }

    const rawSnapshots = data[POST_PROCESS_WORLDBOOK_WRITE_SNAPSHOT_KEY];
    if (Array.isArray(rawSnapshots)) {
      const { next, changed } = rewriteSnapshotEntriesBookName(
        rawSnapshots as WorldbookWriteSnapshotEntry[],
        fromBook,
        stableNamesToMigrate,
        toBook,
      );
      if (changed > 0) {
        data[POST_PROCESS_WORLDBOOK_WRITE_SNAPSHOT_KEY] = next;
        messageChanged = true;
      }
    }

    if (messageChanged) {
      updates.push({ message_id: msg.message_id, data });
    }
  }

  if (updates.length) {
    await setChatMessages(updates, { refresh: 'none' });
  }
  return totalChanged;
}

export async function migrateWorldbookWriteRuleTarget(options: {
  rule: ChatWorldbookWriteRule;
  fromBook: string;
  toBook: string;
}): Promise<{ moved: number; deletedFromOld: number }> {
  const { rule, fromBook, toBook } = options;
  const trimmedFrom = fromBook.trim();
  const trimmedTo = toBook.trim();
  if (!trimmedFrom || !trimmedTo || trimmedFrom === trimmedTo) {
    return { moved: 0, deletedFromOld: 0 };
  }

  let moved = 0;
  let deletedFromOld = 0;

  await withWorldbookWriteLock(async () => {
    const ledger = collectAppliedLedgerFromChat();
    const toMove = collectEntriesToMoveFromLedger(ledger, rule.id, trimmedFrom);
    const stableNamesToMigrate = new Set(toMove.map(e => e.stableName.trim()).filter(Boolean));
    const ledgerStableOnFromBook = ledgerStableNamesForBook(ledger, trimmedFrom);

    for (const entry of toMove) {
      const partial = _.cloneDeep(entry.partial);
      partial.name = entry.stableName;
      await upsertEntryByStableName(trimmedTo, entry.stableName, partial);
      moved++;
    }

    try {
      const result = await deleteWorldbookEntries(trimmedFrom, entry =>
        shouldDeleteManagedEntryForRuleOnBook(
          entry.name || '',
          rule,
          stableNamesToMigrate,
          ledgerStableOnFromBook,
        ),
      );
      deletedFromOld = result?.deleted_entries?.length ?? 0;
      await waitForCleanupSettle();
    } catch (e) {
      console.warn('[工作流助手] 迁移时清理旧世界书条目失败:', trimmedFrom, e);
    }

    await rewriteAppliedBookNameInChat(rule.id, trimmedFrom, trimmedTo, stableNamesToMigrate);
  });

  scheduleWorldbookReconcile('rule_book_migrated', 500);
  return { moved, deletedFromOld };
}

export { resolveWriteTargetBookName };
