import { loadSettings } from '../settings';
import { resolveEffectiveSettings } from './effective-settings';
import { persistRuntimeTaskChanges } from './persist-runtime-tasks';
import { isReplicaFamilyRootTemplate } from './replica-family';
import {
  applyLastEnumToReplicaSnapshot,
  applyReplicaStateToTasks,
  buildReplicaStateFromTasks,
  mergeReplicaStateForRerun,
  mergeReplicaStateSnapshots,
  normalizeReplicaStateSnapshot,
  POST_PROCESS_REPLICA_STATE_KEY,
  type ReplicaStateSnapshot,
} from './replica-state';
import { takePendingLastEnumAttrValues } from './replica-enum-pending';
import type { PostProcessTask } from './schema';

export {
  applyReplicaStateToTasks,
  buildReplicaStateFromTasks,
  mergeReplicaStateForRerun,
  mergeReplicaStateSnapshots,
  POST_PROCESS_REPLICA_STATE_KEY,
} from './replica-state';
export type { ReplicaRootState, ReplicaStateSnapshot } from './replica-state';

export type ReconcileReplicaOptions = {
  excludeMessageId?: number;
  maxMessageId?: number;
  reason?: string;
};

let reconcileInFlight = false;
let reconcileTimer: ReturnType<typeof setTimeout> | null = null;
let pendingReconcile: { reason: string } | null = null;

export function readReplicaStateFromMessage(messageId: number): ReplicaStateSnapshot | null {
  const msg = getChatMessages(messageId)[0];
  if (!msg || msg.role !== 'assistant') return null;
  const data = (msg.data ?? {}) as Record<string, unknown>;
  return normalizeReplicaStateSnapshot(data[POST_PROCESS_REPLICA_STATE_KEY]);
}

/** 本楼快照优先；空则向上合并聊天中的副本状态 */
export function resolveReplicaStateForMessage(messageId: number): ReplicaStateSnapshot {
  if (messageId < 0) return {};
  const direct = readReplicaStateFromMessage(messageId);
  if (direct && Object.keys(direct).length) return direct;
  return collectReplicaStateFromChat({ maxMessageId: messageId });
}

/** 写入当前楼的副本状态快照（仅 assistant 楼） */
export async function writeReplicaStateSnapshot(
  messageId: number,
  tasks: PostProcessTask[],
): Promise<void> {
  const msg = getChatMessages(messageId)[0];
  if (!msg || msg.role !== 'assistant') return;
  const pending = takePendingLastEnumAttrValues();
  const existing = readReplicaStateFromMessage(messageId);
  const fallback = collectReplicaStateFromChat({ maxMessageId: messageId });
  const snapshot = applyLastEnumToReplicaSnapshot(
    buildReplicaStateFromTasks(tasks),
    pending,
    existing,
    fallback,
  );
  const data = (msg.data ?? {}) as Record<string, unknown>;
  await setChatMessages(
    [
      {
        message_id: messageId,
        data: { ...data, [POST_PROCESS_REPLICA_STATE_KEY]: snapshot },
      },
    ],
    { refresh: 'none' },
  );
}

export async function clearReplicaStateMessageKeys(messageId: number): Promise<void> {
  const msg = getChatMessages(messageId)[0];
  if (!msg) return;
  const data = { ...(msg.data ?? {}) } as Record<string, unknown>;
  if (!(POST_PROCESS_REPLICA_STATE_KEY in data)) return;
  delete data[POST_PROCESS_REPLICA_STATE_KEY];
  await setChatMessages([{ message_id: messageId, data }], { refresh: 'none' });
}

/** 顺序扫描 assistant 楼，合并出当前聊天应有的副本状态 */
export function collectReplicaStateFromChat(options: ReconcileReplicaOptions = {}): ReplicaStateSnapshot {
  const lastId = getLastMessageId();
  if (lastId < 0) return {};

  const maxId =
    options.maxMessageId != null && options.maxMessageId >= 0
      ? Math.min(options.maxMessageId, lastId)
      : lastId;

  let msgs;
  try {
    msgs = getChatMessages(`0-${maxId}`);
  } catch {
    return {};
  }

  const snapshots: ReplicaStateSnapshot[] = [];
  for (const msg of msgs) {
    if (msg.role !== 'assistant') continue;
    if (options.excludeMessageId != null && msg.message_id === options.excludeMessageId) continue;
    const snapshot = readReplicaStateFromMessage(msg.message_id);
    if (snapshot) snapshots.push(snapshot);
  }
  return mergeReplicaStateSnapshots(snapshots);
}

function hasReplicaFamilyRoot(tasks: PostProcessTask[]): boolean {
  return tasks.some(isReplicaFamilyRootTemplate);
}

/** 按聊天历史重放副本任务列表；快照激活时仅写 chat，否则写回全局 */
export async function reconcileReplicaTasksFromChat(options: ReconcileReplicaOptions = {}): Promise<void> {
  if (reconcileInFlight) return;
  reconcileInFlight = true;
  try {
    const baseSettings = loadSettings();
    const settings = resolveEffectiveSettings(baseSettings);
    if (!hasReplicaFamilyRoot(settings.tasks)) return;

    const snapshot = collectReplicaStateFromChat(options);
    const nextTasks = applyReplicaStateToTasks(settings.tasks, snapshot);

    if (_.isEqual(nextTasks, settings.tasks)) return;

    settings.tasks = nextTasks;
    await persistRuntimeTaskChanges(baseSettings, settings);
  } finally {
    reconcileInFlight = false;
  }
}

/**
 * 重跑专用：历史快照（排除本楼）+ 本楼清快照前回退合并后重放成员。
 * 不向本轮 relay 注入 lastEnum 种子；auto 副本族仍只认本轮 ReplicaEnum。
 */
export async function reconcileReplicaTasksForRerun(messageId: number): Promise<void> {
  const currentSnap = readReplicaStateFromMessage(messageId);
  const history = collectReplicaStateFromChat({ excludeMessageId: messageId, reason: 'rerun' });
  const merged = mergeReplicaStateForRerun(history, currentSnap);

  if (reconcileInFlight) return;
  reconcileInFlight = true;
  try {
    const baseSettings = loadSettings();
    const settings = resolveEffectiveSettings(baseSettings);
    if (!hasReplicaFamilyRoot(settings.tasks)) return;

    const nextTasks = applyReplicaStateToTasks(settings.tasks, merged);
    if (!_.isEqual(nextTasks, settings.tasks)) {
      settings.tasks = nextTasks;
      await persistRuntimeTaskChanges(baseSettings, settings);
    }
  } finally {
    reconcileInFlight = false;
  }
}

export function scheduleReplicaReconcile(reason: string, delayMs = 500): void {
  pendingReconcile = { reason };
  if (reconcileTimer) clearTimeout(reconcileTimer);
  reconcileTimer = setTimeout(() => {
    reconcileTimer = null;
    const pending = pendingReconcile;
    pendingReconcile = null;
    if (!pending) return;
    void reconcileReplicaTasksFromChat({ reason: pending.reason });
  }, delayMs);
}

export function stopReplicaReconcileTimers(): void {
  if (reconcileTimer) {
    clearTimeout(reconcileTimer);
    reconcileTimer = null;
  }
  pendingReconcile = null;
}

/** 注册 init / MESSAGE_DELETED 时的副本重放（与世界书 reconcile 串联） */
export function registerReplicaReconcile(): EventOnReturn {
  const runInit = () => void reconcileReplicaTasksFromChat({ reason: 'init' });
  setTimeout(runInit, 1400);
  setTimeout(runInit, 3700);

  const offDeleted = eventOn(tavern_events.MESSAGE_DELETED, () => {
    scheduleReplicaReconcile('message_deleted', 600);
  });

  return {
    stop: () => {
      stopReplicaReconcileTimers();
      offDeleted.stop();
    },
  };
}
