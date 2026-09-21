import type { AddonData } from './schema';
import { getWorldMap, normalizeAddonData } from './schema';
import {
  getAddonArchive,
  makeSingularityKey,
  remapArchiveWorldKeys,
  removeArchiveWorldKeys,
  writeAddonArchive,
  type AddonArchive,
} from './archive';
import {
  clearAllSingularityDescents,
  findDeactivatedActiveSingularity,
  findNewlyActivatedSingularity,
  setSingularityFlag,
} from './singularity';
import {
  syncReplicaLaunched,
  renameReplicaWorldAttr,
  removeReplicaWorldMember,
  ensureWorldReplicaMember,
} from './replica-sync';

export type ControlResult = {
  data: AddonData;
  archive: AddonArchive;
  warnings: string[];
};

function ensureWorld(data: AddonData, world: string): void {
  if (!(world in getWorldMap(data))) {
    throw new Error(`世界不存在: ${world}`);
  }
}

/** 激活特异点：快照整树 → 全局互斥 → 写 activeKey */
export function activateSingularity(data: AddonData, archive: AddonArchive, world: string, name: string): ControlResult {
  ensureWorld(data, world);
  const key = makeSingularityKey(world, name);
  const warnings: string[] = [];
  let nextData = _.cloneDeep(data);
  let nextArchive = _.cloneDeep(archive);

  if (nextArchive.activeKey && nextArchive.activeKey !== key) {
    const snap = nextArchive.snapshots[nextArchive.activeKey];
    if (snap) {
      nextData = _.cloneDeep(snap);
    } else {
      warnings.push(`缺少旧特异点快照: ${nextArchive.activeKey}`);
    }
  }

  nextArchive.snapshots[key] = _.cloneDeep(nextData);
  clearAllSingularityDescents(nextData, { world, name });
  setSingularityFlag(nextData, world, name, true);
  nextArchive.activeKey = key;

  return { data: normalizeAddonData(nextData), archive: nextArchive, warnings };
}

/** 关闭当前特异点：从快照整树还原 */
export function deactivateSingularity(data: AddonData, archive: AddonArchive, world: string, name: string): ControlResult {
  const key = makeSingularityKey(world, name);
  const warnings: string[] = [];
  let nextData = _.cloneDeep(data);
  const nextArchive = _.cloneDeep(archive);

  if (nextArchive.activeKey === key) {
    const snap = nextArchive.snapshots[key];
    if (snap) {
      nextData = _.cloneDeep(snap);
      setSingularityFlag(nextData, world, name, false);
    } else {
      warnings.push(`缺少特异点快照，仅关闭降临旗标: ${key}`);
      setSingularityFlag(nextData, world, name, false);
    }
    nextArchive.activeKey = null;
  } else {
    setSingularityFlag(nextData, world, name, false);
  }

  return { data: normalizeAddonData(nextData), archive: nextArchive, warnings };
}

/**
 * patch 后特异点状态机：对比 old/new，处理 false→true / true→false。
 * 返回需写回的 data + archive；若无特异点相关变化则 data 与传入 newData 一致。
 */
export function reconcileSingularityAfterPatch(
  oldData: AddonData,
  newData: AddonData,
  archive: AddonArchive,
): ControlResult {
  const warnings: string[] = [];
  let data = _.cloneDeep(newData);
  let nextArchive = _.cloneDeep(archive);

  const deactivated = findDeactivatedActiveSingularity(oldData, data, nextArchive.activeKey);
  if (deactivated) {
    const result = deactivateSingularity(data, nextArchive, deactivated.world, deactivated.name);
    data = result.data;
    nextArchive = result.archive;
    warnings.push(...result.warnings);
  }

  const activated = findNewlyActivatedSingularity(oldData, data);
  if (activated) {
    const result = activateSingularity(data, nextArchive, activated.world, activated.name);
    data = result.data;
    nextArchive = result.archive;
    warnings.push(...result.warnings);
  } else if (!deactivated) {
    const ons = listTrueSingularities(data);
    if (ons.length > 1) {
      const keep = nextArchive.activeKey
        ? ons.find(s => makeSingularityKey(s.world, s.name) === nextArchive.activeKey) ?? ons[0]!
        : ons[0]!;
      clearAllSingularityDescents(data, keep);
      nextArchive.activeKey = makeSingularityKey(keep.world, keep.name);
      if (!nextArchive.snapshots[nextArchive.activeKey]) {
        nextArchive.snapshots[nextArchive.activeKey] = _.cloneDeep(oldData);
      }
      warnings.push('检测到多个特异点同时降临，已自动互斥');
    } else if (ons.length === 1) {
      nextArchive.activeKey = makeSingularityKey(ons[0]!.world, ons[0]!.name);
    }
  }

  return { data: normalizeAddonData(data), archive: nextArchive, warnings };
}

function listTrueSingularities(data: AddonData): { world: string; name: string }[] {
  const out: { world: string; name: string }[] = [];
  for (const [world, entry] of Object.entries(getWorldMap(data))) {
    const map = _.get(entry, '时代快讯.岁月史书.特异点') as Record<string, { 降临?: boolean }> | undefined;
    if (!map) continue;
    for (const [name, item] of Object.entries(map)) {
      if (item?.降临 === true) out.push({ world, name });
    }
  }
  return out;
}

export function setWorldDescent(data: AddonData, world: string, value: boolean): AddonData {
  ensureWorld(data, world);
  const next = _.cloneDeep(data);
  if (value) {
    for (const name of Object.keys(getWorldMap(next))) {
      _.set(next, `世界.${name}.降临`, name === world);
    }
  } else {
    _.set(next, `世界.${world}.降临`, false);
  }
  return normalizeAddonData(next);
}

export function setWorldParallel(data: AddonData, world: string, value: boolean): AddonData {
  ensureWorld(data, world);
  const next = _.cloneDeep(data);
  _.set(next, `世界.${world}.平行演化`, value);
  return normalizeAddonData(next);
}

export function createWorld(data: AddonData, name: string): AddonData {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('世界名不能为空');
  if (trimmed in getWorldMap(data)) throw new Error(`世界已存在: ${trimmed}`);
  return normalizeAddonData({
    ...data,
    世界: { ...getWorldMap(data), [trimmed]: {} },
  });
}

export function renameWorld(
  data: AddonData,
  archive: AddonArchive,
  oldName: string,
  newName: string,
): ControlResult {
  const nextOld = oldName.trim();
  const nextNew = newName.trim();
  if (!nextOld || !nextNew) throw new Error('世界名不能为空');
  const worlds = getWorldMap(data);
  if (!(nextOld in worlds)) throw new Error(`世界不存在: ${nextOld}`);
  if (nextNew !== nextOld && nextNew in worlds) throw new Error(`世界已存在: ${nextNew}`);

  const nextData = _.cloneDeep(data);
  if (nextNew !== nextOld) {
    nextData.世界[nextNew] = nextData.世界[nextOld]!;
    delete nextData.世界[nextOld];
  }
  const nextArchive = nextNew === nextOld ? _.cloneDeep(archive) : remapArchiveWorldKeys(archive, nextOld, nextNew);
  return { data: normalizeAddonData(nextData), archive: nextArchive, warnings: [] };
}

export function deleteWorld(data: AddonData, archive: AddonArchive, name: string): ControlResult {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('世界名不能为空');
  if (!(trimmed in getWorldMap(data))) throw new Error(`世界不存在: ${trimmed}`);

  const nextData = _.cloneDeep(data);
  delete nextData.世界[trimmed];
  const nextArchive = removeArchiveWorldKeys(archive, trimmed);
  return { data: normalizeAddonData(nextData), archive: nextArchive, warnings: [] };
}

/** 将控制结果写回楼层，并同步副本族 */
export async function commitControlResult(
  message_id: number,
  result: ControlResult,
  writeData: (id: number, data: AddonData) => void,
): Promise<ControlResult> {
  writeData(message_id, result.data);
  writeAddonArchive(message_id, result.archive);
  const syncWarnings = await syncReplicaLaunched(result.data);
  return { ...result, warnings: [...result.warnings, ...syncWarnings] };
}

export async function applySetSingularityDescent(
  message_id: number,
  world: string,
  name: string,
  value: boolean,
  getData: (id: number) => AddonData,
  writeData: (id: number, data: AddonData) => void,
): Promise<ControlResult> {
  const data = getData(message_id);
  const archive = getAddonArchive(message_id);
  const result = value
    ? activateSingularity(data, archive, world, name)
    : deactivateSingularity(data, archive, world, name);
  return commitControlResult(message_id, result, writeData);
}

export async function applySetWorldDescent(
  message_id: number,
  world: string,
  value: boolean,
  getData: (id: number) => AddonData,
  writeData: (id: number, data: AddonData) => void,
): Promise<ControlResult> {
  const data = setWorldDescent(getData(message_id), world, value);
  const archive = getAddonArchive(message_id);
  return commitControlResult(message_id, { data, archive, warnings: [] }, writeData);
}

export async function applySetWorldParallel(
  message_id: number,
  world: string,
  value: boolean,
  getData: (id: number) => AddonData,
  writeData: (id: number, data: AddonData) => void,
): Promise<ControlResult> {
  const data = setWorldParallel(getData(message_id), world, value);
  const archive = getAddonArchive(message_id);
  return commitControlResult(message_id, { data, archive, warnings: [] }, writeData);
}

export async function applyCreateWorld(
  message_id: number,
  name: string,
  getData: (id: number) => AddonData,
  writeData: (id: number, data: AddonData) => void,
): Promise<ControlResult> {
  const data = createWorld(getData(message_id), name);
  const archive = getAddonArchive(message_id);
  writeData(message_id, data);
  writeAddonArchive(message_id, archive);
  const world = getWorldMap(data)[name.trim()];
  const launched = world?.降临 === true || world?.平行演化 === true;
  const ensureWarnings = await ensureWorldReplicaMember(name.trim(), launched);
  const syncWarnings = await syncReplicaLaunched(data);
  return { data, archive, warnings: [...ensureWarnings, ...syncWarnings] };
}

export async function applyRenameWorld(
  message_id: number,
  oldName: string,
  newName: string,
  getData: (id: number) => AddonData,
  writeData: (id: number, data: AddonData) => void,
): Promise<ControlResult> {
  const result = renameWorld(getData(message_id), getAddonArchive(message_id), oldName, newName);
  writeData(message_id, result.data);
  writeAddonArchive(message_id, result.archive);
  const renameWarnings = await renameReplicaWorldAttr(oldName.trim(), newName.trim());
  const syncWarnings = await syncReplicaLaunched(result.data);
  return { ...result, warnings: [...result.warnings, ...renameWarnings, ...syncWarnings] };
}

export async function applyDeleteWorld(
  message_id: number,
  name: string,
  getData: (id: number) => AddonData,
  writeData: (id: number, data: AddonData) => void,
): Promise<ControlResult> {
  const result = deleteWorld(getData(message_id), getAddonArchive(message_id), name);
  writeData(message_id, result.data);
  writeAddonArchive(message_id, result.archive);
  const removeWarnings = await removeReplicaWorldMember(name.trim());
  const syncWarnings = await syncReplicaLaunched(result.data);
  return { ...result, warnings: [...result.warnings, ...removeWarnings, ...syncWarnings] };
}
