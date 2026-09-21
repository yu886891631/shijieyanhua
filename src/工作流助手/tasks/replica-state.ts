import {
  getReplicaFamilyScheduleMode,
  getReplicaTasks,
  isReplicaFamilyRootTemplate,
  mergeReplicaFamilyFromRelay,
} from './replica-family';
import type { PostProcessTask } from './schema';
import { sortAttrValues } from './tag-extract';

export const POST_PROCESS_REPLICA_STATE_KEY = '_post_process_replica_state';

export type ReplicaRootState = {
  attrValues: string[];
  launchedAttrValues?: string[];
  /** 最近一轮从 relay <ReplicaEnum> 同步到该原本的属性值（供宏侧重建 auto 过滤） */
  lastEnumAttrValues?: string[];
};

export type ReplicaStateSnapshot = Record<string, ReplicaRootState>;

function isValidReplicaRootState(value: unknown): value is ReplicaRootState {
  if (!value || typeof value !== 'object') return false;
  return Array.isArray((value as ReplicaRootState).attrValues);
}

function copyOptionalStringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const list = value.map(v => String(v ?? '').trim()).filter(Boolean);
  return list.length ? list : undefined;
}

/** 将 message.data 中的原始对象解析为规范化快照（丢弃非法项） */
export function normalizeReplicaStateSnapshot(raw: unknown): ReplicaStateSnapshot | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const snapshot: ReplicaStateSnapshot = {};
  for (const [rootId, state] of Object.entries(raw as Record<string, unknown>)) {
    if (isValidReplicaRootState(state)) {
      const launchedAttrValues = copyOptionalStringList(state.launchedAttrValues);
      const lastEnumAttrValues = copyOptionalStringList(state.lastEnumAttrValues);
      snapshot[rootId] = {
        attrValues: [...state.attrValues],
        ...(launchedAttrValues ? { launchedAttrValues } : {}),
        ...(lastEnumAttrValues ? { lastEnumAttrValues } : {}),
      };
    }
  }
  return snapshot;
}

/** 从当前 tasks 构建本楼副本状态快照（每个 root 的 attrValue 列表 + launched 列表） */
export function buildReplicaStateFromTasks(tasks: PostProcessTask[]): ReplicaStateSnapshot {
  const snapshot: ReplicaStateSnapshot = {};
  for (const root of tasks) {
    if (!isReplicaFamilyRootTemplate(root)) continue;
    const members = getReplicaTasks(root.id, tasks);
    const attrValues: string[] = [];
    const launchedAttrValues: string[] = [];
    for (const member of members) {
      const attr = member.replicaFamilyAttrValue ?? '';
      if (!attr) continue;
      attrValues.push(attr);
      if (member.replicaFamilyLaunched === true) launchedAttrValues.push(attr);
    }
    // 无成员时不写入空 attrValues，避免污染楼层快照、重跑时被当成「清光名单」
    if (!attrValues.length) continue;
    snapshot[root.id] = {
      attrValues,
      ...(launchedAttrValues.length ? { launchedAttrValues } : {}),
    };
  }
  return snapshot;
}

/** 合并多楼快照：后者整包覆盖前者；lastEnum 若后者未带则保留前者；空 attrValues 不覆盖已有成员名单 */
export function mergeReplicaStateSnapshots(snapshots: ReplicaStateSnapshot[]): ReplicaStateSnapshot {
  const merged: ReplicaStateSnapshot = {};
  for (const snapshot of snapshots) {
    for (const [rootId, state] of Object.entries(snapshot)) {
      if (!state.attrValues?.length) {
        // 仅补 lastEnum，不写入空成员名单
        const prev = merged[rootId];
        if (state.lastEnumAttrValues?.length) {
          if (prev) {
            if (!prev.lastEnumAttrValues?.length) {
              merged[rootId] = { ...prev, lastEnumAttrValues: [...state.lastEnumAttrValues] };
            }
          }
        }
        continue;
      }
      const prev = merged[rootId];
      const lastEnumAttrValues = state.lastEnumAttrValues?.length
        ? [...state.lastEnumAttrValues]
        : prev?.lastEnumAttrValues?.length
          ? [...prev.lastEnumAttrValues]
          : undefined;
      merged[rootId] = {
        attrValues: [...state.attrValues],
        launchedAttrValues: state.launchedAttrValues?.length
          ? [...state.launchedAttrValues]
          : undefined,
        ...(lastEnumAttrValues ? { lastEnumAttrValues } : {}),
      };
    }
  }
  return merged;
}

function cloneRootState(state: ReplicaRootState): ReplicaRootState {
  return {
    attrValues: [...state.attrValues],
    ...(state.launchedAttrValues?.length ? { launchedAttrValues: [...state.launchedAttrValues] } : {}),
    ...(state.lastEnumAttrValues?.length ? { lastEnumAttrValues: [...state.lastEnumAttrValues] } : {}),
  };
}

/**
 * 重跑专用：以排除本楼后的历史快照为基；
 * 若某 root 在 history 中缺失或 attrValues 为空，则用本楼清快照前的状态回退，
 * 避免仅存在于本楼的手动副本族成员被删光。
 * history 已有成员时，仅在缺 lastEnum 时从 current 补。
 */
export function mergeReplicaStateForRerun(
  history: ReplicaStateSnapshot,
  currentFloor: ReplicaStateSnapshot | null | undefined,
): ReplicaStateSnapshot {
  const merged: ReplicaStateSnapshot = {};
  for (const [rootId, state] of Object.entries(history)) {
    // 历史空名单视为无效，不写入（否则会在 current 也空时清掉 UI/MVU 成员）
    if (!state.attrValues?.length) continue;
    merged[rootId] = cloneRootState(state);
  }
  if (!currentFloor) return merged;

  for (const [rootId, current] of Object.entries(currentFloor)) {
    if (!current.attrValues?.length && !current.lastEnumAttrValues?.length) continue;
    const hist = merged[rootId];
    if (!hist?.attrValues?.length) {
      if (current.attrValues?.length) merged[rootId] = cloneRootState(current);
      continue;
    }
    if (!hist.lastEnumAttrValues?.length && current.lastEnumAttrValues?.length) {
      merged[rootId] = {
        ...hist,
        lastEnumAttrValues: [...current.lastEnumAttrValues],
      };
    }
  }
  return merged;
}

/**
 * 将本轮 pending enum 与已有快照中的 lastEnum 合并进由 tasks 构建的快照。
 * pending 优先；否则保留 existing / fallback 中的 lastEnum，避免空跑冲掉。
 */
export function applyLastEnumToReplicaSnapshot(
  base: ReplicaStateSnapshot,
  pending: Record<string, string[]>,
  existing?: ReplicaStateSnapshot | null,
  fallback?: ReplicaStateSnapshot | null,
): ReplicaStateSnapshot {
  const out: ReplicaStateSnapshot = {};
  for (const [rootId, state] of Object.entries(base)) {
    const pendingValues = pending[rootId];
    const lastEnumAttrValues = pendingValues?.length
      ? [...pendingValues]
      : existing?.[rootId]?.lastEnumAttrValues?.length
        ? [...existing[rootId].lastEnumAttrValues!]
        : fallback?.[rootId]?.lastEnumAttrValues?.length
          ? [...fallback[rootId].lastEnumAttrValues!]
          : undefined;
    out[rootId] = {
      ...state,
      ...(lastEnumAttrValues ? { lastEnumAttrValues } : {}),
    };
  }
  return out;
}

/** 将某 root 快照中的 attrValue 列表 from→to（去重排序） */
export function remapReplicaRootAttrValueInSnapshot(
  snapshot: ReplicaStateSnapshot,
  rootId: string,
  fromAttr: string,
  toAttr: string,
): ReplicaStateSnapshot {
  const from = String(fromAttr ?? '').trim();
  const to = String(toAttr ?? '').trim();
  const state = snapshot[rootId];
  if (!state || !from || !to || from === to) return snapshot;

  const remapList = (list?: string[]): string[] | undefined => {
    if (!list?.length) return list;
    const next = sortAttrValues([...new Set(list.map(v => (v === from ? to : v)).filter(Boolean))]);
    return next.length ? next : undefined;
  };

  const attrValues = remapList(state.attrValues) ?? [];
  if (!attrValues.length) {
    const { [rootId]: _removed, ...rest } = snapshot;
    return rest;
  }

  const launchedAttrValues = remapList(state.launchedAttrValues);
  const lastEnumAttrValues = remapList(state.lastEnumAttrValues);

  return {
    ...snapshot,
    [rootId]: {
      attrValues,
      ...(launchedAttrValues ? { launchedAttrValues } : {}),
      ...(lastEnumAttrValues ? { lastEnumAttrValues } : {}),
    },
  };
}

/** 依据快照期望的 attrValue 列表，将 tasks 中副本成员重放为一致状态 */
export function applyReplicaStateToTasks(
  tasks: PostProcessTask[],
  snapshot: ReplicaStateSnapshot,
): PostProcessTask[] {
  let next = [...tasks];
  for (const root of tasks) {
    if (!isReplicaFamilyRootTemplate(root)) continue;
    const state = snapshot[root.id];
    // 快照未收录或空名单：保留现有成员（UI/MVU 手动创建的世界副本等）
    if (!state?.attrValues?.length) continue;
    const desired = state.attrValues;
    const launchedSet = new Set(state.launchedAttrValues ?? []);

    const currentRoot = next.find(t => t.id === root.id) ?? root;
    const keepSet = new Set(desired);
    next = next.filter(t => {
      if (t.replicaFamilyRootId !== root.id) return true;
      return keepSet.has(t.replicaFamilyAttrValue ?? '');
    });
    next = mergeReplicaFamilyFromRelay(currentRoot, desired, next).tasks;

    const isManual = getReplicaFamilyScheduleMode(currentRoot) === 'manual';
    if (isManual) {
      next = next.map(t => {
        if (t.replicaFamilyRootId !== root.id) return t;
        const attr = t.replicaFamilyAttrValue ?? '';
        return { ...t, replicaFamilyLaunched: launchedSet.has(attr) };
      });
    }
  }
  return next;
}
