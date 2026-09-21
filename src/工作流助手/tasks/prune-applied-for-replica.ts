import { resolveStableEntryName, resolveWriteTargetBookName } from '../worldbook/write-from-template';
import {
  POST_PROCESS_WORLDBOOK_WRITE_APPLIED_KEY,
  reloadWorldInfoEditorIfSelected,
  type WorldbookWriteAppliedEntry,
} from '../worldbook/write-sync';
import type { ChatWorldbookWriteRule } from './schema';
import { parseExtractTagSpec } from './tag-extract';

export type RemovedReplicaInfo = {
  rootId: string;
  spec: string;
  attrValues: string[];
};

export type PrunableWorldbookTarget = {
  bookName: string;
  stableName: string;
};

/** 依据被删副本的 attrValue，推导应清理的世界书条目（bookName + stableName） */
export function computePrunableWorldbookTargets(
  removed: RemovedReplicaInfo[],
  rules: ChatWorldbookWriteRule[],
): PrunableWorldbookTarget[] {
  const targets: PrunableWorldbookTarget[] = [];
  const seen = new Set<string>();

  for (const info of removed) {
    if (!info.attrValues.length) continue;
    const rootSpec = parseExtractTagSpec(info.spec || '');

    for (const rule of rules) {
      if (!rule.splitByAttr) continue;
      const ruleSpec = parseExtractTagSpec(rule.targetTag.trim());
      if (!ruleSpec?.attrName) continue;
      if (rootSpec) {
        if (ruleSpec.tagName !== rootSpec.tagName) continue;
        if (rootSpec.attrName && ruleSpec.attrName !== rootSpec.attrName) continue;
      }
      const bookName = resolveWriteTargetBookName(rule);
      if (!bookName) continue;

      for (const attrValue of info.attrValues) {
        const stableName = resolveStableEntryName(rule, attrValue);
        const key = `${bookName}\0${stableName}`;
        if (seen.has(key)) continue;
        seen.add(key);
        targets.push({ bookName, stableName });
      }
    }
  }

  return targets;
}

/** 删除世界书里实际条目（按 bookName 分组批量删） */
export async function deleteWorldbookEntriesByStableName(
  targets: PrunableWorldbookTarget[],
): Promise<void> {
  const byBook = new Map<string, Set<string>>();
  for (const { bookName, stableName } of targets) {
    if (!byBook.has(bookName)) byBook.set(bookName, new Set());
    byBook.get(bookName)!.add(stableName.trim());
  }
  for (const [bookName, names] of byBook) {
    try {
      await deleteWorldbookEntries(bookName, entry => names.has((entry.name || '').trim()));
    } catch (e) {
      console.warn('[工作流助手] 删除副本世界书条目失败:', bookName, e);
    }
  }
  reloadWorldInfoEditorIfSelected(byBook.keys());
}

/** 从全部 assistant 楼的 applied 账本中移除命中的 stableName 记录 */
export async function pruneAppliedLedgerFromChat(stableNames: Set<string>): Promise<void> {
  if (!stableNames.size) return;
  const lastId = getLastMessageId();
  if (lastId < 0) return;

  let msgs;
  try {
    msgs = getChatMessages(`0-${lastId}`);
  } catch {
    return;
  }

  for (const msg of msgs) {
    if (msg.role !== 'assistant') continue;
    const data = (msg.data ?? {}) as Record<string, unknown>;
    const raw = data[POST_PROCESS_WORLDBOOK_WRITE_APPLIED_KEY];
    if (!Array.isArray(raw) || !raw.length) continue;

    const list = raw as WorldbookWriteAppliedEntry[];
    const filtered = list.filter(entry => !stableNames.has((entry?.stableName ?? '').trim()));
    if (filtered.length === list.length) continue;

    const nextData = { ...data };
    if (filtered.length) {
      nextData[POST_PROCESS_WORLDBOOK_WRITE_APPLIED_KEY] = filtered;
    } else {
      delete nextData[POST_PROCESS_WORLDBOOK_WRITE_APPLIED_KEY];
    }
    try {
      await setChatMessages([{ message_id: msg.message_id, data: nextData }], { refresh: 'none' });
    } catch (e) {
      console.warn('[工作流助手] 清理 applied 账本失败:', msg.message_id, e);
    }
  }
}

/** 被删副本 → 删除对应世界书条目 + 清理 applied 账本 */
export async function pruneWorldbookForRemovedReplicas(
  removed: RemovedReplicaInfo[],
  rules: ChatWorldbookWriteRule[],
): Promise<void> {
  if (!removed.length || !rules.length) return;
  const targets = computePrunableWorldbookTargets(removed, rules);
  if (!targets.length) return;

  await deleteWorldbookEntriesByStableName(targets);
  await pruneAppliedLedgerFromChat(new Set(targets.map(t => t.stableName.trim())));
}
