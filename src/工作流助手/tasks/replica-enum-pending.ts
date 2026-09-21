/** 本轮阶段同步收到的 ReplicaEnum 属性值（按原本 id），供写楼层快照合并 */

import { composePendingReplicaRenames, type PendingReplicaRename } from './replica-enum-parse';

let pendingLastEnumByRootId: Record<string, string[]> = {};

type PendingReplicaRenameState = {
  messageId: number;
  renames: PendingReplicaRename[];
};

let pendingReplicaRenameState: PendingReplicaRenameState | null = null;

export function recordPendingLastEnumAttrValues(rootId: string, values: string[]): void {
  const cleaned = values.map(v => String(v ?? '').trim()).filter(Boolean);
  if (!rootId || !cleaned.length) return;
  pendingLastEnumByRootId[rootId] = [...cleaned];
}

export function takePendingLastEnumAttrValues(): Record<string, string[]> {
  const out = pendingLastEnumByRootId;
  pendingLastEnumByRootId = {};
  return out;
}

/** 测试用：清空 pending */
export function clearPendingLastEnumAttrValues(): void {
  pendingLastEnumByRootId = {};
}

function mergeRenameIntoState(messageId: number, renames: PendingReplicaRename[]): void {
  if (!renames.length) return;
  if (!pendingReplicaRenameState || pendingReplicaRenameState.messageId !== messageId) {
    pendingReplicaRenameState = { messageId, renames: [] };
  }
  const target = pendingReplicaRenameState.renames;
  for (const r of renames) {
    const from = String(r.from ?? '').trim();
    const to = String(r.to ?? '').trim();
    const specKey = String(r.specKey ?? '').trim();
    if (!specKey || !from || !to || from === to) continue;
    const taskRef = r.taskRef?.trim() || undefined;
    const idx = target.findIndex(
      e =>
        e.specKey.toLowerCase() === specKey.toLowerCase() &&
        (e.taskRef ?? '') === (taskRef ?? '') &&
        e.from === from,
    );
    const next: PendingReplicaRename = { specKey, from, to, taskRef };
    if (idx >= 0) target[idx] = next;
    else target.push(next);
  }
  pendingReplicaRenameState.renames = composePendingReplicaRenames(pendingReplicaRenameState.renames);
}

export function recordPendingReplicaRenames(messageId: number, renames: PendingReplicaRename[]): void {
  if (messageId < 0 || !renames.length) return;
  mergeRenameIntoState(messageId, renames);
}

export function takePendingReplicaRenames(messageId: number): PendingReplicaRename[] {
  if (messageId < 0 || !pendingReplicaRenameState || pendingReplicaRenameState.messageId !== messageId) {
    return [];
  }
  const out = pendingReplicaRenameState.renames;
  pendingReplicaRenameState = null;
  return out;
}

/** 测试/取消用：无参清空全部；有参仅清该楼 */
export function clearPendingReplicaRenames(messageId?: number): void {
  if (messageId === undefined) {
    pendingReplicaRenameState = null;
    return;
  }
  if (pendingReplicaRenameState?.messageId === messageId) {
    pendingReplicaRenameState = null;
  }
}
