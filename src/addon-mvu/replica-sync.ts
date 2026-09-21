import type { AddonData } from './schema';
import { getWorldMap } from './schema';

export const WORLD_REPLICA_SPEC = '世界状态摘要@world';

type ReplicaApi = {
  listTasks: () => Array<{
    id: string;
    syncAsReplicaFamily?: boolean;
    replicaFamilyRootId?: string;
    replicaFamilySpec?: string;
    replicaFamilyEnumSpec?: string;
    replicaFamilyScheduleMode?: 'auto' | 'manual';
    replicaFamilyAttrValue?: string;
    replicaFamilyBaseName?: string;
    name?: string;
  }>;
  listReplicaFamilyMembers: (rootId: string) => Array<{
    id: string;
    replicaFamilyRootId?: string;
    replicaFamilyAttrValue?: string;
    replicaFamilyLaunched?: boolean;
    name?: string;
  }>;
  updateReplicaFamilyScheduleMode: (rootId: string, mode: 'auto' | 'manual') => Promise<unknown>;
  updateReplicaMemberSchedule: (memberId: string, patch: { launched?: boolean }) => Promise<unknown>;
  ensureReplicaFamilyMember: (
    rootId: string,
    attrValue: string,
    options?: { launched?: boolean },
  ) => Promise<unknown>;
  replaceTasks: (tasks: unknown[]) => Promise<void>;
};

function getReplicaApi(): ReplicaApi | null {
  try {
    const api = _.get(window.parent, 'AcuPostProcessAPI') as ReplicaApi | undefined;
    if (api && typeof api.listTasks === 'function') return api;
  } catch {
    /* cross-origin */
  }
  return null;
}

function specMatches(spec: string | undefined): boolean {
  return String(spec ?? '')
    .trim()
    .toLowerCase() === WORLD_REPLICA_SPEC.toLowerCase();
}

export function findWorldReplicaRoot(
  api: ReplicaApi | null = getReplicaApi(),
): ReturnType<ReplicaApi['listTasks']>[number] | null {
  if (!api) return null;
  const tasks = api.listTasks();
  return (
    tasks.find(
      t =>
        !t.replicaFamilyRootId &&
        (specMatches(t.replicaFamilySpec) || specMatches(t.replicaFamilyEnumSpec)),
    ) ?? null
  );
}

/**
 * 按世界 降临||平行演化 同步副本族成员 launched。
 * 若 schedule 非 manual，先切到 manual。
 * 不自动创建缺失成员；返回警告文案。
 */
export async function syncReplicaLaunched(data: AddonData): Promise<string[]> {
  const warnings: string[] = [];
  const api = getReplicaApi();
  if (!api) {
    warnings.push('AcuPostProcessAPI 未就绪，跳过副本族同步');
    return warnings;
  }

  const root = findWorldReplicaRoot(api);
  if (!root) {
    warnings.push(`未找到规格为 ${WORLD_REPLICA_SPEC} 的世界副本族`);
    return warnings;
  }

  if (root.replicaFamilyScheduleMode !== 'manual') {
    try {
      await api.updateReplicaFamilyScheduleMode(root.id, 'manual');
    } catch (e) {
      warnings.push(`切换副本族为 manual 失败: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const members = api.listReplicaFamilyMembers(root.id).filter(m => m.replicaFamilyRootId);
  const byAttr = new Map(members.map(m => [String(m.replicaFamilyAttrValue ?? '').trim(), m]));

  for (const [world, entry] of Object.entries(getWorldMap(data))) {
    const launched = entry?.降临 === true || entry?.平行演化 === true;
    const member = byAttr.get(world);
    if (!member) {
      warnings.push(`未找到世界副本: ${world}`);
      continue;
    }
    if (member.replicaFamilyLaunched === launched) continue;
    try {
      await api.updateReplicaMemberSchedule(member.id, { launched });
    } catch (e) {
      warnings.push(`更新副本 ${world} launched 失败: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return warnings;
}

/**
 * 确保世界对应的副本族成员存在（手动创建世界时调用）。
 * 会切到 manual，并按 launched 写入。
 */
export async function ensureWorldReplicaMember(worldName: string, launched: boolean): Promise<string[]> {
  const warnings: string[] = [];
  const name = worldName.trim();
  if (!name) {
    warnings.push('世界名不能为空，跳过副本创建');
    return warnings;
  }

  const api = getReplicaApi();
  if (!api) {
    warnings.push('AcuPostProcessAPI 未就绪，跳过副本创建');
    return warnings;
  }
  if (typeof api.ensureReplicaFamilyMember !== 'function') {
    warnings.push('AcuPostProcessAPI 不支持 ensureReplicaFamilyMember，请更新工作流助手');
    return warnings;
  }

  const root = findWorldReplicaRoot(api);
  if (!root) {
    warnings.push(`未找到规格为 ${WORLD_REPLICA_SPEC} 的世界副本族，跳过副本创建`);
    return warnings;
  }

  if (root.replicaFamilyScheduleMode !== 'manual') {
    try {
      await api.updateReplicaFamilyScheduleMode(root.id, 'manual');
    } catch (e) {
      warnings.push(`切换副本族为 manual 失败: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  try {
    await api.ensureReplicaFamilyMember(root.id, name, { launched });
  } catch (e) {
    warnings.push(`创建世界副本失败: ${e instanceof Error ? e.message : String(e)}`);
  }
  return warnings;
}

/** 世界改名时更新副本成员 attrValue 与展示名 */
export async function renameReplicaWorldAttr(oldWorld: string, newWorld: string): Promise<string[]> {
  const warnings: string[] = [];
  if (oldWorld === newWorld) return warnings;
  const api = getReplicaApi();
  if (!api) {
    warnings.push('AcuPostProcessAPI 未就绪，跳过副本族改名');
    return warnings;
  }
  const root = findWorldReplicaRoot(api);
  if (!root) return warnings;

  const all = api.listTasks() as Array<Record<string, unknown>>;
  const baseName = String(root.replicaFamilyBaseName ?? root.name ?? '世界副本').trim();
  let changed = false;
  const next = all.map(t => {
    if (t.replicaFamilyRootId === root.id && t.replicaFamilyAttrValue === oldWorld) {
      changed = true;
      return {
        ...t,
        replicaFamilyAttrValue: newWorld,
        name: `${baseName} ${newWorld}`,
      };
    }
    return t;
  });
  if (!changed) {
    warnings.push(`未找到世界副本: ${oldWorld}`);
    return warnings;
  }
  try {
    await api.replaceTasks(next);
  } catch (e) {
    warnings.push(`副本族改名失败: ${e instanceof Error ? e.message : String(e)}`);
  }
  return warnings;
}

/** 删除世界时移除对应副本族成员 */
export async function removeReplicaWorldMember(world: string): Promise<string[]> {
  const warnings: string[] = [];
  const trimmed = world.trim();
  if (!trimmed) return warnings;
  const api = getReplicaApi();
  if (!api) {
    warnings.push('AcuPostProcessAPI 未就绪，跳过副本族删除');
    return warnings;
  }
  const root = findWorldReplicaRoot(api);
  if (!root) return warnings;

  const all = api.listTasks() as Array<Record<string, unknown>>;
  const next = all.filter(
    t => !(t.replicaFamilyRootId === root.id && t.replicaFamilyAttrValue === trimmed),
  );
  if (next.length === all.length) {
    warnings.push(`未找到世界副本: ${trimmed}`);
    return warnings;
  }
  try {
    await api.replaceTasks(next);
  } catch (e) {
    warnings.push(`副本族删除失败: ${e instanceof Error ? e.message : String(e)}`);
  }
  return warnings;
}
