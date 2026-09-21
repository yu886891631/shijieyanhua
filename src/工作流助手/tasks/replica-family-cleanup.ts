import { buildAttrGroupKey, buildCompositeKey, parseExtractTagSpec, sortAttrValues } from './tag-extract';
import {
  getReplicaFamilyEnumSpecKey,
  getReplicaFamilyScheduleMode,
  getReplicaTasks,
  hasReplicaFamilyTasks,
  isReplicaLaunched,
  isReplicaFamilyRootTemplate,
} from './replica-family';
import { countAssistantRounds } from './schedule';
import type { PostProcessTask, ScriptSettings } from './schema';
import type { TagContainerRaw } from './tag-variables-nested';
import { isAccessibleMessageFloor } from './message-floor';

const TAG_DATA_ROOT_KEY = 'post_process_tags';

export type ReplicaFamilyCleanupConfig = ScriptSettings['replicaFamilyCleanup'];

export type ReplicaCleanupCandidate = {
  /** 稳定键：attrValue（同 spec 下去重后） */
  memberId: string;
  attrValue: string;
  name: string;
  launched: boolean;
  runCount: number;
  /** 本周期调度放行（试过）次数取 max */
  opportunityCount: number;
  /** 本周期调度等待（已进 runnable 未放行）次数取 max */
  scheduleWaitCount: number;
  defaultSelected: boolean;
};

export type ReplicaCleanupCandidateGroup = {
  spec: string;
  members: ReplicaCleanupCandidate[];
};

type AttrAgg = {
  attrValue: string;
  runCountMax: number;
  opportunityCountMax: number;
  scheduleWaitCountMax: number;
  anyLaunched: boolean;
  anyProtected: boolean;
  displayName: string;
};

type SpecBucket = {
  /** canonical：trim + lowerCase，用作 keep / 记忆 map 键 */
  spec: string;
  roots: PostProcessTask[];
  byAttr: Map<string, AttrAgg>;
};

/** 清理 keep / 记忆用的规范 spec 键 */
export function canonicalSpecKey(spec: string): string {
  return String(spec ?? '')
    .trim()
    .toLowerCase();
}

function specKeysEqual(a: string, b: string): boolean {
  return canonicalSpecKey(a) === canonicalSpecKey(b);
}

/** 合并大小写变体键，attrs 并集；返回新 map */
export function canonicalizeLastManualKeepMap(
  map: Record<string, string[]> | undefined,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (!map || typeof map !== 'object') return out;
  for (const [rawKey, attrs] of Object.entries(map)) {
    const key = canonicalSpecKey(rawKey);
    if (!key || !Array.isArray(attrs)) continue;
    const merged = [
      ...(out[key] ?? []),
      ...attrs.map(a => String(a ?? '').trim()).filter(Boolean),
    ];
    out[key] = sortAttrValues([...new Set(merged)]);
  }
  return out;
}

function getLastManualKeepForSpec(
  state: ReplicaFamilyCleanupConfig,
  spec: string,
): string[] {
  const map = state.lastManualKeepBySpec ?? {};
  const key = findKeepKeyForSpec(map, spec);
  if (!key) return [];
  // 同 canonical 下可能仍有未规范化的多键：并集
  const canonical = canonicalSpecKey(spec);
  const attrs = new Set<string>();
  for (const [k, list] of Object.entries(map)) {
    if (canonicalSpecKey(k) !== canonical || !Array.isArray(list)) continue;
    for (const a of list) {
      const t = String(a ?? '').trim();
      if (t) attrs.add(t);
    }
  }
  return sortAttrValues([...attrs]);
}

function findKeepKeyForSpec(keepBySpec: Record<string, string[]>, spec: string): string | undefined {
  const canonical = canonicalSpecKey(spec);
  if (!canonical) return undefined;
  if (Object.prototype.hasOwnProperty.call(keepBySpec, canonical)) return canonical;
  for (const key of Object.keys(keepBySpec)) {
    if (canonicalSpecKey(key) === canonical) return key;
  }
  return undefined;
}

export function createDefaultReplicaFamilyCleanup(hasReplicaFamily: boolean): ReplicaFamilyCleanupConfig {
  return {
    enabled: hasReplicaFamily,
    cycleRounds: 10,
    minActivityTries: 1,
    mode: hasReplicaFamily ? 'auto' : 'manual',
    roundsSinceCleanup: 0,
    cycleRunCounts: {},
    cycleOpportunityCounts: {},
    cycleScheduleWaitCounts: {},
    lastManualKeepBySpec: {},
    lastCleanupRound: 0,
  };
}

export function isReplicaFamilyCleanupAtFactoryDefaults(state: ReplicaFamilyCleanupConfig): boolean {
  return (
    !state.enabled &&
    state.mode === 'manual' &&
    state.cycleRounds === 10 &&
    (state.minActivityTries ?? 1) === 1 &&
    (state.roundsSinceCleanup ?? 0) === 0 &&
    (state.lastCleanupRound ?? 0) === 0 &&
    Object.keys(state.cycleRunCounts ?? {}).length === 0 &&
    Object.keys(state.cycleOpportunityCounts ?? {}).length === 0 &&
    Object.keys(state.cycleScheduleWaitCounts ?? {}).length === 0 &&
    Object.keys(state.lastManualKeepBySpec ?? {}).length === 0 &&
    Object.keys(state.lastManualKeepByRoot ?? {}).length === 0 &&
    state.activityRatio === undefined
  );
}

/** 维持 opportunity ≥ runCount（升级回填 + 不变量） */
export function reconcileOpportunityCountsWithRuns(state: ReplicaFamilyCleanupConfig): void {
  if (!state.cycleOpportunityCounts) state.cycleOpportunityCounts = {};
  if (!state.cycleRunCounts) state.cycleRunCounts = {};
  const ids = new Set([
    ...Object.keys(state.cycleRunCounts),
    ...Object.keys(state.cycleOpportunityCounts),
  ]);
  for (const id of ids) {
    const run = state.cycleRunCounts[id] ?? 0;
    const opp = state.cycleOpportunityCounts[id] ?? 0;
    if (run > opp) state.cycleOpportunityCounts[id] = run;
  }
}

/** 将遗留 activityRatio 迁入 minActivityTries */
export function migrateActivityRatioToMinTries(state: ReplicaFamilyCleanupConfig): void {
  const legacy = state.activityRatio;
  if (legacy !== undefined) {
    // 旧档带 activityRatio：按规则写入（zod 可能已填默认 min=1，仍以 ratio 为准）
    state.minActivityTries = legacy <= 0 ? 0 : 1;
    delete state.activityRatio;
  }
  if (typeof state.minActivityTries !== 'number' || !Number.isFinite(state.minActivityTries) || state.minActivityTries < 0) {
    state.minActivityTries = 1;
  } else {
    state.minActivityTries = Math.floor(state.minActivityTries);
  }
}

/** 将遗留 lastManualKeepByRoot 并入 lastManualKeepBySpec 后删除旧键 */
export function migrateLastManualKeepByRootToSpec(settings: ScriptSettings): void {
  const state = settings.replicaFamilyCleanup;
  if (!state) return;
  if (!state.lastManualKeepBySpec) state.lastManualKeepBySpec = {};
  const legacy = state.lastManualKeepByRoot;
  if (!legacy || typeof legacy !== 'object') {
    delete state.lastManualKeepByRoot;
    state.lastManualKeepBySpec = canonicalizeLastManualKeepMap(state.lastManualKeepBySpec);
    return;
  }
  const bySpec = { ...state.lastManualKeepBySpec };
  for (const [rootId, attrs] of Object.entries(legacy)) {
    if (!Array.isArray(attrs)) continue;
    const root = settings.tasks.find(t => t.id === rootId);
    if (!root) continue;
    const spec = canonicalSpecKey(getReplicaFamilyEnumSpecKey(root));
    if (!spec) continue;
    const merged = [...(bySpec[spec] ?? []), ...attrs.map(a => String(a ?? '').trim()).filter(Boolean)];
    bySpec[spec] = sortAttrValues([...new Set(merged)]);
  }
  state.lastManualKeepBySpec = canonicalizeLastManualKeepMap(bySpec);
  delete state.lastManualKeepByRoot;
}

/** 有副本族任务时默认启用清理周期 + 自动清理；无副本族时保持关闭 + 手动。 */
export function ensureReplicaFamilyCleanupDefaults(settings: ScriptSettings): ReplicaFamilyCleanupConfig {
  const hasReplica = hasReplicaFamilyTasks(settings.tasks);
  if (!settings.replicaFamilyCleanup) {
    settings.replicaFamilyCleanup = createDefaultReplicaFamilyCleanup(hasReplica);
    return settings.replicaFamilyCleanup;
  }
  migrateLastManualKeepByRootToSpec(settings);
  migrateActivityRatioToMinTries(settings.replicaFamilyCleanup);
  settings.replicaFamilyCleanup.lastManualKeepBySpec = canonicalizeLastManualKeepMap(
    settings.replicaFamilyCleanup.lastManualKeepBySpec,
  );
  if (!settings.replicaFamilyCleanup.cycleOpportunityCounts) {
    settings.replicaFamilyCleanup.cycleOpportunityCounts = {};
  }
  if (!settings.replicaFamilyCleanup.cycleScheduleWaitCounts) {
    settings.replicaFamilyCleanup.cycleScheduleWaitCounts = {};
  }
  reconcileOpportunityCountsWithRuns(settings.replicaFamilyCleanup);
  if (hasReplica && isReplicaFamilyCleanupAtFactoryDefaults(settings.replicaFamilyCleanup)) {
    settings.replicaFamilyCleanup.enabled = true;
    settings.replicaFamilyCleanup.mode = 'auto';
  }
  return settings.replicaFamilyCleanup;
}

function ensureCleanupState(settings: ScriptSettings): ReplicaFamilyCleanupConfig {
  return ensureReplicaFamilyCleanupDefaults(settings);
}

export { hasReplicaFamilyTasks };

export function getReplicaFamilyCleanupConfig(settings: ScriptSettings): ReplicaFamilyCleanupConfig {
  return { ...ensureCleanupState(settings) };
}

export function updateReplicaFamilyCleanupConfig(
  settings: ScriptSettings,
  patch: Partial<ReplicaFamilyCleanupConfig>,
): ReplicaFamilyCleanupConfig {
  const state = ensureCleanupState(settings);
  Object.assign(state, patch);
  return { ...state };
}

export function incrementReplicaRunCounts(settings: ScriptSettings, executedMemberIds: string[]): void {
  if (!executedMemberIds.length) return;
  const state = ensureCleanupState(settings);
  for (const id of executedMemberIds) {
    state.cycleRunCounts[id] = (state.cycleRunCounts[id] ?? 0) + 1;
  }
  reconcileOpportunityCountsWithRuns(state);
}

export function incrementReplicaOpportunityCounts(
  settings: ScriptSettings,
  opportunityMemberIds: string[],
): void {
  if (!opportunityMemberIds.length) return;
  const state = ensureCleanupState(settings);
  for (const id of opportunityMemberIds) {
    state.cycleOpportunityCounts[id] = (state.cycleOpportunityCounts[id] ?? 0) + 1;
  }
}

export function incrementReplicaScheduleWaitCounts(
  settings: ScriptSettings,
  scheduleWaitMemberIds: string[],
): void {
  if (!scheduleWaitMemberIds.length) return;
  const state = ensureCleanupState(settings);
  for (const id of scheduleWaitMemberIds) {
    state.cycleScheduleWaitCounts[id] = (state.cycleScheduleWaitCounts[id] ?? 0) + 1;
  }
}

export function tickCleanupRound(settings: ScriptSettings): void {
  const state = ensureCleanupState(settings);
  if (!state.enabled) return;
  state.roundsSinceCleanup = (state.roundsSinceCleanup ?? 0) + 1;
}

export function shouldTriggerCleanup(settings: ScriptSettings): boolean {
  const state = ensureCleanupState(settings);
  if (!state.enabled) return false;
  if (!hasReplicaFamilyTasks(settings.tasks)) return false;
  return (state.roundsSinceCleanup ?? 0) >= state.cycleRounds;
}

function isMemberProtectedThisRound(memberId: string, protectMemberIds?: readonly string[]): boolean {
  if (!protectMemberIds?.length) return false;
  return protectMemberIds.includes(memberId);
}

function buildSpecBuckets(
  settings: ScriptSettings,
  protectMemberIds?: readonly string[],
): SpecBucket[] {
  const state = ensureCleanupState(settings);
  const bySpec = new Map<string, SpecBucket>();

  for (const root of settings.tasks) {
    if (!isReplicaFamilyRootTemplate(root)) continue;
    const spec = canonicalSpecKey(getReplicaFamilyEnumSpecKey(root));
    if (!spec) continue;
    let bucket = bySpec.get(spec);
    if (!bucket) {
      bucket = { spec, roots: [], byAttr: new Map() };
      bySpec.set(spec, bucket);
    }
    bucket.roots.push(root);

    for (const member of getReplicaTasks(root.id, settings.tasks)) {
      const attr = (member.replicaFamilyAttrValue ?? '').trim();
      if (!attr) continue;
      const runCount = state.cycleRunCounts[member.id] ?? 0;
      const opportunityCount = state.cycleOpportunityCounts[member.id] ?? 0;
      const scheduleWaitCount = state.cycleScheduleWaitCounts[member.id] ?? 0;
      const existing = bucket.byAttr.get(attr);
      const launched =
        getReplicaFamilyScheduleMode(root) === 'manual' && isReplicaLaunched(member);
      const protectedMember = isMemberProtectedThisRound(member.id, protectMemberIds);
      if (!existing) {
        bucket.byAttr.set(attr, {
          attrValue: attr,
          runCountMax: runCount,
          opportunityCountMax: opportunityCount,
          scheduleWaitCountMax: scheduleWaitCount,
          anyLaunched: launched,
          anyProtected: protectedMember,
          displayName: member.name,
        });
      } else {
        existing.runCountMax = Math.max(existing.runCountMax, runCount);
        existing.opportunityCountMax = Math.max(existing.opportunityCountMax, opportunityCount);
        existing.scheduleWaitCountMax = Math.max(existing.scheduleWaitCountMax, scheduleWaitCount);
        existing.anyLaunched = existing.anyLaunched || launched;
        existing.anyProtected = existing.anyProtected || protectedMember;
      }
    }
  }

  return [...bySpec.values()];
}

function isAttrKeepByScheduleAndActivity(
  agg: AttrAgg,
  minActivityTries: number,
): boolean {
  if (agg.anyProtected) return true;
  if (agg.anyLaunched) return true;
  if (agg.scheduleWaitCountMax > 0) return true;
  return agg.opportunityCountMax >= minActivityTries;
}

function isAttrManualDialogDefault(
  agg: AttrAgg,
  minActivityTries: number,
  lastManualKeep: string[],
): boolean {
  if (agg.anyProtected) return true;
  if (lastManualKeep.includes(agg.attrValue)) return true;
  return isAttrKeepByScheduleAndActivity(agg, minActivityTries);
}

function collectKeepAttrsForBucket(
  bucket: SpecBucket,
  shouldKeep: (agg: AttrAgg) => boolean,
): string[] {
  const keep: string[] = [];
  for (const agg of bucket.byAttr.values()) {
    if (shouldKeep(agg)) keep.push(agg.attrValue);
  }
  return sortAttrValues(keep);
}

/** 每个有副本族根的 enumSpec 都有键（可为空数组） */
export function computeAutoKeepSet(
  settings: ScriptSettings,
  protectMemberIds?: readonly string[],
): Record<string, string[]> {
  const state = ensureCleanupState(settings);
  const result: Record<string, string[]> = {};
  for (const bucket of buildSpecBuckets(settings, protectMemberIds)) {
    result[bucket.spec] = collectKeepAttrsForBucket(bucket, agg =>
      isAttrKeepByScheduleAndActivity(agg, state.minActivityTries ?? 1),
    );
  }
  return result;
}

export function computeManualDialogDefaultSelection(
  settings: ScriptSettings,
  protectMemberIds?: readonly string[],
): Record<string, string[]> {
  const state = ensureCleanupState(settings);
  const result: Record<string, string[]> = {};
  for (const bucket of buildSpecBuckets(settings, protectMemberIds)) {
    const lastManualKeep = getLastManualKeepForSpec(state, bucket.spec);
    result[bucket.spec] = collectKeepAttrsForBucket(bucket, agg =>
      isAttrManualDialogDefault(agg, state.minActivityTries ?? 1, lastManualKeep),
    );
  }
  return result;
}

/** @deprecated 使用 computeManualDialogDefaultSelection */
export function computeDefaultSelection(
  settings: ScriptSettings,
  protectMemberIds?: readonly string[],
): Record<string, string[]> {
  return computeManualDialogDefaultSelection(settings, protectMemberIds);
}

export function listReplicaFamilyCleanupCandidates(
  settings: ScriptSettings,
  protectMemberIds?: readonly string[],
): ReplicaCleanupCandidateGroup[] {
  const state = ensureCleanupState(settings);
  const groups: ReplicaCleanupCandidateGroup[] = [];
  for (const bucket of buildSpecBuckets(settings, protectMemberIds)) {
    const lastManualKeep = getLastManualKeepForSpec(state, bucket.spec);
    const members: ReplicaCleanupCandidate[] = sortAttrValues([...bucket.byAttr.keys()]).map(attr => {
      const agg = bucket.byAttr.get(attr)!;
      return {
        memberId: attr,
        attrValue: attr,
        name: agg.displayName,
        launched: agg.anyLaunched,
        runCount: agg.runCountMax,
        opportunityCount: agg.opportunityCountMax,
        scheduleWaitCount: agg.scheduleWaitCountMax,
        defaultSelected: isAttrManualDialogDefault(
          agg,
          state.minActivityTries ?? 1,
          lastManualKeep,
        ),
      };
    });
    groups.push({ spec: bucket.spec, members });
  }
  return groups;
}

function readTagContainerRaw(variables: Record<string, unknown>): TagContainerRaw {
  const raw = variables[TAG_DATA_ROOT_KEY];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return { ...(raw as TagContainerRaw) };
}

export function pruneFloorTagKeysForReplica(
  spec: string,
  attrValuesToRemove: string[],
  messageId: number,
): void {
  if (!attrValuesToRemove.length) return;
  if (!isAccessibleMessageFloor(messageId)) return;
  const parsed = parseExtractTagSpec(spec);
  if (!parsed?.attrName) return;
  const groupKey = buildAttrGroupKey(parsed.tagName, parsed.attrName);
  const removeSet = new Set(attrValuesToRemove);

  updateVariablesWith(
    variables => {
      const raw = readTagContainerRaw(variables);
      const existing = raw[groupKey];
      if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
        const merged = { ...(existing as Record<string, string>) };
        for (const k of Object.keys(merged)) {
          if (removeSet.has(k)) delete merged[k];
        }
        if (Object.keys(merged).length) {
          raw[groupKey] = merged;
        } else {
          delete raw[groupKey];
        }
      }
      for (const attrValue of attrValuesToRemove) {
        delete raw[buildCompositeKey(parsed.tagName, parsed.attrName!, attrValue)];
      }
      variables[TAG_DATA_ROOT_KEY] = raw;
      return variables;
    },
    { type: 'message', message_id: messageId },
  );
}

/**
 * 将当前楼 post_process_tags 中某 spec 的 attrValue 从 from 迁到 to（nested + flat）。
 * 目标键已存在时跳过（不覆盖）；返回是否发生了迁移。
 */
export function readFloorTagContainerRaw(messageId: number): TagContainerRaw {
  if (!isAccessibleMessageFloor(messageId)) return {};
  try {
    const variables = getVariables({ type: 'message', message_id: messageId });
    return readTagContainerRaw(variables);
  } catch {
    return {};
  }
}

function attrValueExistsInTagContainer(
  raw: TagContainerRaw,
  groupKey: string,
  flatKey: string,
  attrValue: string,
): boolean {
  const existing = raw[groupKey];
  if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
    if (Object.prototype.hasOwnProperty.call(existing as Record<string, string>, attrValue)) {
      return true;
    }
  }
  return Object.prototype.hasOwnProperty.call(raw, flatKey);
}

/** 只读 preflight：from 存在且 to 已在 nested/flat 任一处存在则不可迁移 */
export function canMigrateFloorTagKeysForReplica(
  spec: string,
  fromAttr: string,
  toAttr: string,
  messageId: number,
): boolean {
  const from = String(fromAttr ?? '').trim();
  const to = String(toAttr ?? '').trim();
  if (!from || !to || from === to) return true;
  if (!isAccessibleMessageFloor(messageId)) return true;
  const parsed = parseExtractTagSpec(spec);
  if (!parsed?.attrName) return true;

  const raw = readFloorTagContainerRaw(messageId);
  const groupKey = buildAttrGroupKey(parsed.tagName, parsed.attrName);
  const flatFrom = buildCompositeKey(parsed.tagName, parsed.attrName, from);
  const flatTo = buildCompositeKey(parsed.tagName, parsed.attrName, to);

  const fromExists =
    attrValueExistsInTagContainer(raw, groupKey, flatFrom, from) ||
    Object.prototype.hasOwnProperty.call(raw, flatFrom);
  if (!fromExists) return true;

  return !attrValueExistsInTagContainer(raw, groupKey, flatTo, to) && !Object.prototype.hasOwnProperty.call(raw, flatTo);
}

/** 只读：当前楼 post_process_tags 是否含 from 键 */
export function floorTagFromExistsForReplica(
  spec: string,
  fromAttr: string,
  messageId: number,
): boolean {
  const from = String(fromAttr ?? '').trim();
  if (!from || !isAccessibleMessageFloor(messageId)) return false;
  const parsed = parseExtractTagSpec(spec);
  if (!parsed?.attrName) return false;
  const raw = readFloorTagContainerRaw(messageId);
  const groupKey = buildAttrGroupKey(parsed.tagName, parsed.attrName);
  const flatFrom = buildCompositeKey(parsed.tagName, parsed.attrName, from);
  return (
    attrValueExistsInTagContainer(raw, groupKey, flatFrom, from) ||
    Object.prototype.hasOwnProperty.call(raw, flatFrom)
  );
}

export function migrateFloorTagKeysForReplica(
  spec: string,
  fromAttr: string,
  toAttr: string,
  messageId: number,
): boolean {
  const from = String(fromAttr ?? '').trim();
  const to = String(toAttr ?? '').trim();
  if (!from || !to || from === to) return false;
  if (!isAccessibleMessageFloor(messageId)) return false;
  const parsed = parseExtractTagSpec(spec);
  if (!parsed?.attrName) return false;
  const groupKey = buildAttrGroupKey(parsed.tagName, parsed.attrName);
  const flatFrom = buildCompositeKey(parsed.tagName, parsed.attrName, from);
  const flatTo = buildCompositeKey(parsed.tagName, parsed.attrName, to);
  let migrated = false;

  updateVariablesWith(
    variables => {
      const raw = readTagContainerRaw(variables);
      let changed = false;

      const existing = raw[groupKey];
      if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
        const merged = { ...(existing as Record<string, string>) };
        if (Object.prototype.hasOwnProperty.call(merged, from)) {
          if (!Object.prototype.hasOwnProperty.call(merged, to)) {
            merged[to] = merged[from]!;
            delete merged[from];
            changed = true;
          }
        }
        if (Object.keys(merged).length) {
          raw[groupKey] = merged;
        } else {
          delete raw[groupKey];
        }
      }

      if (Object.prototype.hasOwnProperty.call(raw, flatFrom)) {
        if (!Object.prototype.hasOwnProperty.call(raw, flatTo)) {
          raw[flatTo] = raw[flatFrom];
          delete raw[flatFrom];
          changed = true;
        }
      }

      if (changed) {
        variables[TAG_DATA_ROOT_KEY] = raw;
        migrated = true;
      }
      return variables;
    },
    { type: 'message', message_id: messageId },
  );

  return migrated;
}

/** 将 cleanup 记忆中某 spec 的 attrValue from→to */
export function remapLastManualKeepAttrValue(
  settings: ScriptSettings,
  spec: string,
  fromAttr: string,
  toAttr: string,
): void {
  const from = String(fromAttr ?? '').trim();
  const to = String(toAttr ?? '').trim();
  if (!from || !to || from === to) return;
  const state = ensureReplicaFamilyCleanupDefaults(settings);
  const key = findKeepKeyForSpec(state.lastManualKeepBySpec ?? {}, spec);
  if (!key) return;
  const list = state.lastManualKeepBySpec![key];
  if (!Array.isArray(list) || !list.length) return;
  const next = sortAttrValues([
    ...new Set(list.map(v => (String(v).trim() === from ? to : v)).filter(Boolean)),
  ]);
  if (!next.length) {
    delete state.lastManualKeepBySpec![key];
  } else {
    state.lastManualKeepBySpec![key] = next;
  }
  state.lastManualKeepBySpec = canonicalizeLastManualKeepMap(state.lastManualKeepBySpec);
}

function collectExtractSpecsFromMembers(members: PostProcessTask[]): string[] {
  const specs = new Set<string>();
  for (const member of members) {
    for (const tag of member.extractInjectTags ?? []) {
      const parsed = parseExtractTagSpec(String(tag ?? '').trim());
      if (!parsed?.attrName) continue;
      specs.add(canonicalSpecKey(`${parsed.tagName}@${parsed.attrName}`));
    }
  }
  return [...specs];
}

export type RemovedReplicaCleanupInfo = {
  rootId: string;
  spec: string;
  attrValues: string[];
};

export type ApplyReplicaFamilyCleanupOptions = {
  persistManualKeepBySpec?: Record<string, string[]>;
  /** 输出：本次清理实际移除的副本（供世界书条目/账本联动清理） */
  removedOut?: RemovedReplicaCleanupInfo[];
};

export function applyReplicaFamilyCleanup(
  settings: ScriptSettings,
  keepAttrValuesBySpec: Record<string, string[]>,
  messageId: number,
  options?: ApplyReplicaFamilyCleanupOptions,
): ScriptSettings {
  const state = ensureCleanupState(settings);
  let tasks = [...settings.tasks];
  const buckets = buildSpecBuckets(settings);

  for (const bucket of buckets) {
    const keepKey = findKeepKeyForSpec(keepAttrValuesBySpec, bucket.spec);
    // 未出现在 keep 表中的 spec 视为「本次不处理」
    if (keepKey === undefined) continue;
    const keepSet = new Set(keepAttrValuesBySpec[keepKey] ?? []);
    const removedAttrs = new Set<string>();
    const removeMemberIds: string[] = [];
    const removedMembers: PostProcessTask[] = [];

    for (const root of bucket.roots) {
      for (const member of getReplicaTasks(root.id, tasks)) {
        const attr = (member.replicaFamilyAttrValue ?? '').trim();
        if (!attr || keepSet.has(attr)) continue;
        removedAttrs.add(attr);
        removeMemberIds.push(member.id);
        removedMembers.push(member);
      }
    }

    if (!removeMemberIds.length) continue;

    const removedAttrList = sortAttrValues([...removedAttrs]);
    pruneFloorTagKeysForReplica(bucket.spec, removedAttrList, messageId);

    const extractSpecs = collectExtractSpecsFromMembers(removedMembers).filter(
      s => !specKeysEqual(s, bucket.spec),
    );
    for (const extractSpec of extractSpecs) {
      pruneFloorTagKeysForReplica(extractSpec, removedAttrList, messageId);
    }

    tasks = tasks.filter(t => !removeMemberIds.includes(t.id));
    for (const id of removeMemberIds) {
      delete state.cycleRunCounts[id];
      delete state.cycleOpportunityCounts[id];
      delete state.cycleScheduleWaitCounts[id];
    }

    const primaryRootId = bucket.roots[0]?.id ?? '';
    options?.removedOut?.push({
      rootId: primaryRootId,
      spec: bucket.spec,
      attrValues: removedAttrList,
    });
    for (const extractSpec of extractSpecs) {
      options?.removedOut?.push({
        rootId: primaryRootId,
        spec: extractSpec,
        attrValues: removedAttrList,
      });
    }
  }

  if (options?.persistManualKeepBySpec) {
    const patched = { ...(state.lastManualKeepBySpec ?? {}) };
    for (const [spec, attrs] of Object.entries(options.persistManualKeepBySpec)) {
      const key = canonicalSpecKey(spec);
      if (!key) continue;
      patched[key] = [...attrs];
    }
    state.lastManualKeepBySpec = canonicalizeLastManualKeepMap(patched);
  }

  state.roundsSinceCleanup = 0;
  state.cycleRunCounts = {};
  state.cycleOpportunityCounts = {};
  state.cycleScheduleWaitCounts = {};
  state.lastCleanupRound = countAssistantRounds();

  return { ...settings, tasks };
}

/** 某 enumSpec 下各族全部现有 attr 的并集 */
export function listAllAttrValuesForEnumSpec(settings: ScriptSettings, enumSpec: string): string[] {
  const target = canonicalSpecKey(enumSpec);
  if (!target) return [];
  const attrs = new Set<string>();
  for (const bucket of buildSpecBuckets(settings)) {
    if (bucket.spec !== target) continue;
    for (const attr of bucket.byAttr.keys()) attrs.add(attr);
  }
  return sortAttrValues([...attrs]);
}

export function resetReplicaFamilyCleanupCycle(settings: ScriptSettings): void {
  const state = ensureCleanupState(settings);
  state.roundsSinceCleanup = 0;
  state.cycleRunCounts = {};
  state.cycleOpportunityCounts = {};
  state.cycleScheduleWaitCounts = {};
}
