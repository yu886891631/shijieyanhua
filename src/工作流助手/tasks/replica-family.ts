import {
  buildCompositeKey,
  buildExtractSpecKey,
  getPlotPlaceholderTagNames,
  sortAttrValues,
  type RelayTagMap,
} from './utils';
import _ from 'lodash';
import {
  parseDynamicAttrPlaceholder,
  parseExtractTagSpec,
} from './tag-extract';
import { collectEnumRegistryAttrValues } from './replica-enum-parse';
import {
  normalizeReplicaAttrValue,
  pickReplicaByAttrIdentity,
  replicaAttrIdentityEquals,
} from './replica-attr-identity';
import { recordPendingLastEnumAttrValues } from './replica-enum-pending';
import { newTaskId } from './task-clone';
import { iterTaskPromptContents } from './prompt-auto-segments';
import { PostProcessTaskSchema, type PostProcessTask, type ReplicaFamilyScheduleMode } from './schema';
import type { ReplicaStateSnapshot } from './replica-state';
import type { TaskProgressItem, TaskProgressStatus } from '../ui/task-progress-display';

const REPLICA_NAME_SUFFIX_RE = / \{.+\}$/;

export function stripReplicaNameSuffix(name: string, baseNameHint?: string): string {
  if (baseNameHint?.trim()) return baseNameHint.trim();
  return String(name ?? '').replace(REPLICA_NAME_SUFFIX_RE, '').trim() || '未命名任务';
}

export function getReplicaFamilyBaseNameFromTask(task: PostProcessTask): string {
  if (task.replicaFamilyBaseName?.trim()) return task.replicaFamilyBaseName.trim();
  return stripReplicaNameSuffix(task.name);
}

export function getReplicaFamilyScheduleMode(root: PostProcessTask): ReplicaFamilyScheduleMode {
  return root.replicaFamilyScheduleMode ?? 'auto';
}

export function isReplicaLaunched(task: PostProcessTask): boolean {
  return task.replicaFamilyLaunched === true;
}

export function shouldRunReplicaAtRuntime(replica: PostProcessTask, root: PostProcessTask): boolean {
  if (!replica.enabled) return false;
  const mode = getReplicaFamilyScheduleMode(root);
  if (mode === 'auto') return true;
  return isReplicaLaunched(replica);
}

/** auto：每个正规化 attr 最多选一个成员；manual：全部已过 shouldRun 的成员 */
export function selectRunnableReplicasForRelay(
  replicas: PostProcessTask[],
  root: PostProcessTask,
  relayAttrValues: string[],
): PostProcessTask[] {
  const eligible = replicas.filter(r => shouldRunReplicaAtRuntime(r, root));
  if (getReplicaFamilyScheduleMode(root) !== 'auto') return eligible;

  const claimedIds = new Set<string>();
  const runnable: PostProcessTask[] = [];
  const uniqueRelay = sortAttrValues([
    ...new Set(relayAttrValues.map(v => normalizeReplicaAttrValue(v)).filter(Boolean)),
  ]);
  for (const attrValue of uniqueRelay) {
    const remaining = eligible.filter(r => !claimedIds.has(r.id));
    const picked = pickReplicaByAttrIdentity(remaining, attrValue);
    if (!picked) continue;
    claimedIds.add(picked.id);
    runnable.push(picked);
  }
  return runnable;
}

export function scanDynamicAttrPlaceholders(task: PostProcessTask): string[] {
  const specs = new Set<string>();
  for (const content of iterTaskPromptContents(task)) {
    for (const name of getPlotPlaceholderTagNames(content)) {
      const dyn = parseDynamicAttrPlaceholder(name);
      if (dyn) specs.add(buildExtractSpecKey(dyn.tagName, dyn.attrName));
    }
  }
  return [...specs];
}

export function validateReplicaFamilyEligibility(task: PostProcessTask): { ok: true; spec: string } | { ok: false; error: string } {
  const specs = scanDynamicAttrPlaceholders(task);
  if (!specs.length) {
    return {
      ok: false,
      error: '启用「同步为副本族」要求提示词中含且仅含一种动态属性占位符（如 {{item@id}}，无 = 值）。',
    };
  }
  if (specs.length > 1) {
    return {
      ok: false,
      error: `提示词中含多种动态属性占位符（${specs.join('、')}），副本族仅支持一种。`,
    };
  }
  return { ok: true, spec: specs[0]! };
}

export function substituteDynamicPlaceholder(text: string, spec: string, attrValue: string): string {
  const parsed = parseExtractTagSpec(spec);
  if (!parsed?.attrName) return text;
  const dynamicToken = `{{${parsed.tagName}@${parsed.attrName}}}`;
  const preciseToken = `{{${buildCompositeKey(parsed.tagName, parsed.attrName, attrValue)}}}`;
  return String(text ?? '').split(dynamicToken).join(preciseToken);
}

/** 修剪 overrides：去掉已不存在的段 id，以及与原本当前 inserted 相同的项（视为跟随原本） */
export function prunePromptAutoSegmentInsertedOverrides(
  overrides: Record<string, boolean> | undefined,
  rootSegments: PostProcessTask['promptAutoSegments'] | undefined,
): Record<string, boolean> | undefined {
  if (!overrides || !Object.keys(overrides).length) return undefined;
  const byId = new Map((rootSegments ?? []).map(s => [s.id, s]));
  const next: Record<string, boolean> = {};
  for (const [id, inserted] of Object.entries(overrides)) {
    const rootSeg = byId.get(id);
    if (!rootSeg) continue;
    if (inserted === rootSeg.inserted) continue;
    next[id] = inserted;
  }
  return Object.keys(next).length ? next : undefined;
}

/**
 * 写入/清除单段启用覆盖：next 与原本相同则删除该 key，否则写入；结果经 prune。
 */
export function patchPromptAutoSegmentInsertedOverride(
  overrides: Record<string, boolean> | undefined,
  rootSegments: PostProcessTask['promptAutoSegments'] | undefined,
  segId: string,
  nextInserted: boolean,
): Record<string, boolean> | undefined {
  const draft: Record<string, boolean> = { ...(overrides ?? {}) };
  const rootSeg = (rootSegments ?? []).find(s => s.id === segId);
  if (rootSeg && nextInserted === rootSeg.inserted) {
    delete draft[segId];
  } else {
    draft[segId] = nextInserted;
  }
  return prunePromptAutoSegmentInsertedOverrides(draft, rootSegments);
}

/** 从原本克隆自动段，并按副本 overrides 覆盖 inserted */
export function cloneAutoSegmentsFromRoot(
  root: PostProcessTask,
  spec: string,
  attrValue: string,
  overrides?: Record<string, boolean>,
): PostProcessTask['promptAutoSegments'] {
  return (root.promptAutoSegments ?? []).map(s => ({
    ...s,
    content: substituteDynamicPlaceholder(s.content, spec, attrValue),
    inserted: overrides?.[s.id] !== undefined ? overrides[s.id]! : s.inserted,
  }));
}

function clonePromptGroupsFromRoot(root: PostProcessTask, spec: string, attrValue: string): PostProcessTask['promptGroups'] {
  return (root.promptGroups ?? []).map(g => ({
    ...g,
    content: substituteDynamicPlaceholder(g.content, spec, attrValue),
  }));
}

function substituteStructuredOutputRules(
  rules: PostProcessTask['structuredOutputRules'],
  spec: string,
  attrValue: string,
): PostProcessTask['structuredOutputRules'] {
  if (!rules) return rules;
  return {
    mvu: rules.mvu !== undefined ? substituteDynamicPlaceholder(rules.mvu, spec, attrValue) : undefined,
    addon: rules.addon !== undefined ? substituteDynamicPlaceholder(rules.addon, spec, attrValue) : undefined,
  };
}

function resolveReplicaPlotWorldbookFields(
  replica: PostProcessTask,
  root: PostProcessTask,
): Pick<PostProcessTask, 'plotWorldbookMode' | 'plotWorldbookConfig'> {
  const mode = replica.plotWorldbookMode ?? root.plotWorldbookMode ?? 'inherit';
  if (mode === 'custom') {
    return {
      plotWorldbookMode: mode,
      plotWorldbookConfig: replica.plotWorldbookConfig ?? root.plotWorldbookConfig,
    };
  }
  return {
    plotWorldbookMode: mode,
    plotWorldbookConfig: undefined,
  };
}

type ReplicaApiFields = Pick<
  PostProcessTask,
  | 'apiPresetMode'
  | 'apiPresetName'
  | 'apiPresetFallbackNames'
  | 'apiPrimaryMaxConcurrency'
  | 'apiFallbackMaxConcurrencies'
>;

/** 副本 API：custom 保留本副本路由；否则沿用原本 */
function resolveReplicaApiFields(replica: PostProcessTask, root: PostProcessTask): ReplicaApiFields {
  const mode = replica.apiPresetMode === 'custom' ? 'custom' : 'inheritRoot';
  if (mode === 'custom') {
    return {
      apiPresetMode: 'custom',
      ...copyApiRoutingFieldsFrom(replica),
    };
  }
  return {
    apiPresetMode: 'inheritRoot',
    ...copyApiRoutingFieldsFrom(root),
  };
}

/** 拷贝任务 API 路由四字段（深拷贝数组） */
export function copyApiRoutingFieldsFrom(
  source: Pick<
    PostProcessTask,
    | 'apiPresetName'
    | 'apiPresetFallbackNames'
    | 'apiPrimaryMaxConcurrency'
    | 'apiFallbackMaxConcurrencies'
  >,
): Pick<
  PostProcessTask,
  | 'apiPresetName'
  | 'apiPresetFallbackNames'
  | 'apiPrimaryMaxConcurrency'
  | 'apiFallbackMaxConcurrencies'
> {
  return {
    apiPresetName: source.apiPresetName ?? '',
    apiPresetFallbackNames: _.cloneDeep(source.apiPresetFallbackNames ?? []),
    apiPrimaryMaxConcurrency: source.apiPrimaryMaxConcurrency ?? 5,
    apiFallbackMaxConcurrencies: _.cloneDeep(source.apiFallbackMaxConcurrencies ?? []),
  };
}

const REPLICA_API_ROUTING_PATCH_KEYS = [
  'apiPresetName',
  'apiPresetFallbackNames',
  'apiPrimaryMaxConcurrency',
  'apiFallbackMaxConcurrencies',
] as const;

/** 副本 patch 含路由字段且未显式指定 inheritRoot 时，自动升为 custom，避免下次镜像被盖掉 */
export function promoteReplicaApiPatchToCustom(
  task: PostProcessTask,
  patch: Partial<PostProcessTask>,
): Partial<PostProcessTask> {
  if (!isReplicaFamilyMember(task)) return patch;
  if (patch.apiPresetMode === 'inheritRoot') return patch;
  if (patch.apiPresetMode === 'custom') return patch;
  const touchesRouting = REPLICA_API_ROUTING_PATCH_KEYS.some(k => Object.prototype.hasOwnProperty.call(patch, k));
  if (!touchesRouting) return patch;
  return { ...patch, apiPresetMode: 'custom' };
}

/** 将副本镜像为原本的实时副本：同步工作流字段；API 在 inheritRoot 时跟随原本，custom 时保留副本路由；保留副本身份字段，提示词动态占位符精确化 */
export function syncReplicaFromRoot(replica: PostProcessTask, root: PostProcessTask): PostProcessTask {
  const attrValue = replica.replicaFamilyAttrValue ?? '';
  if (!attrValue) return replica;
  const spec = root.replicaFamilySpec ?? scanDynamicAttrPlaceholders(root)[0] ?? '';
  const plotWorldbook = resolveReplicaPlotWorldbookFields(replica, root);
  const apiFields = resolveReplicaApiFields(replica, root);
  const insertedOverrides = prunePromptAutoSegmentInsertedOverrides(
    replica.promptAutoSegmentInsertedOverrides,
    root.promptAutoSegments,
  );

  return PostProcessTaskSchema.parse({
    ..._.cloneDeep(root),
    id: replica.id,
    name: `${getReplicaFamilyBaseNameFromTask(root)} ${attrValue}`,
    syncAsReplicaFamily: false,
    replicaFamilyRootId: root.id,
    replicaFamilyAttrValue: attrValue,
    replicaFamilyLaunched: replica.replicaFamilyLaunched,
    replicaFamilyScheduleMode: undefined,
    enabled: replica.enabled,
    taskWorkflowPresets: [],
    promptGroups: clonePromptGroupsFromRoot(root, spec, attrValue),
    promptAutoSegments: cloneAutoSegmentsFromRoot(root, spec, attrValue, insertedOverrides),
    promptAutoSegmentInsertedOverrides: insertedOverrides,
    structuredOutputRules: substituteStructuredOutputRules(root.structuredOutputRules, spec, attrValue),
    ...plotWorldbook,
    ...apiFields,
  });
}

/** 将全部副本族成员的副本与对应原本对齐（含 orphan 存量副本） */
export function mirrorAllReplicaFamilies(tasks: PostProcessTask[]): PostProcessTask[] {
  const roots = tasks.filter(isReplicaFamilyRootTemplate);
  if (!roots.length) return tasks;

  const rootById = new Map(roots.map(r => [r.id, r]));
  let changed = false;
  const next = tasks.map(t => {
    if (!t.replicaFamilyRootId) return t;
    const root = rootById.get(t.replicaFamilyRootId);
    if (!root) return t;
    const synced = syncReplicaFromRoot(t, root);
    if (_.isEqual(synced, t)) return t;
    changed = true;
    return synced;
  });
  return changed ? next : tasks;
}

export function buildReplicaFromRoot(
  root: PostProcessTask,
  attrValue: string,
  baseName: string,
  allTasks: PostProcessTask[],
  schedule?: { launched?: boolean },
): PostProcessTask {
  const isManual = getReplicaFamilyScheduleMode(root) === 'manual';
  const defaultLaunched = isManual;
  const skeleton = PostProcessTaskSchema.parse({
    id: newTaskId(),
    name: `${baseName} ${attrValue}`,
    enabled: true,
    stage: root.stage,
    promptGroups: [],
    replicaFamilyRootId: root.id,
    replicaFamilyAttrValue: attrValue,
    replicaFamilyLaunched: schedule?.launched ?? defaultLaunched,
  });

  let cloned = syncReplicaFromRoot(skeleton, root);
  const existingIds = new Set(allTasks.map(t => t.id));
  if (existingIds.has(cloned.id)) {
    cloned = { ...cloned, id: newTaskId() };
  }
  return cloned;
}

export function getReplicaTasks(rootId: string, allTasks: PostProcessTask[]): PostProcessTask[] {
  return allTasks.filter(t => t.replicaFamilyRootId === rootId);
}

export type RenameReplicaMemberResult = {
  tasks: PostProcessTask[];
  /** 是否成功改名 */
  renamed: boolean;
  /** 跳过/失败原因（未改名时） */
  skipReason?: string;
  memberId?: string;
};

/**
 * 将副本族成员的 identity（replicaFamilyAttrValue）从 from 改为 to，保留 id / launched 等，并 remirror。
 * 同族已存在 to 时跳过；找不到 from 时跳过。
 */
export function renameReplicaFamilyMemberAttr(
  root: PostProcessTask,
  fromAttr: string,
  toAttr: string,
  allTasks: PostProcessTask[],
): RenameReplicaMemberResult {
  const from = normalizeReplicaAttrValue(fromAttr);
  const to = normalizeReplicaAttrValue(toAttr);
  if (!from || !to || from === to) {
    return { tasks: allTasks, renamed: false, skipReason: '无效改名' };
  }
  const members = getReplicaTasks(root.id, allTasks);
  const source = pickReplicaByAttrIdentity(members, from);
  if (!source) {
    return { tasks: allTasks, renamed: false, skipReason: `未找到属性值「${from}」的副本` };
  }
  const conflict = members.find(
    m => m.id !== source.id && replicaAttrIdentityEquals(m.replicaFamilyAttrValue ?? '', to),
  );
  if (conflict) {
    return {
      tasks: allTasks,
      renamed: false,
      skipReason: `目标属性值「${to}」已存在`,
      memberId: source.id,
    };
  }

  const withNewAttr: PostProcessTask = {
    ...source,
    replicaFamilyAttrValue: to,
  };
  const synced = syncReplicaFromRoot(withNewAttr, root);
  const tasks = allTasks.map(t => (t.id === source.id ? synced : t));
  return { tasks, renamed: true, memberId: source.id };
}

export function deleteReplicaFamilyTasks(rootId: string, allTasks: PostProcessTask[]): PostProcessTask[] {
  return allTasks.filter(t => t.replicaFamilyRootId !== rootId);
}

export type MergeReplicaFamilyResult = {
  tasks: PostProcessTask[];
  newlyCreatedIds: string[];
};

/** 增量同步：保留全部现有副本，仅新增 relay 中缺失的 attr 对应副本 */
export function mergeReplicaFamilyFromRelay(
  root: PostProcessTask,
  relayAttrValues: string[],
  allTasks: PostProcessTask[],
): MergeReplicaFamilyResult {
  const baseName = getReplicaFamilyBaseNameFromTask(root);
  const spec = root.replicaFamilySpec ?? scanDynamicAttrPlaceholders(root)[0] ?? '';
  const relayNormalized = sortAttrValues([
    ...new Set(relayAttrValues.map(v => normalizeReplicaAttrValue(v)).filter(Boolean)),
  ]);
  const newlyCreatedIds: string[] = [];

  const withoutReplicas = allTasks.filter(t => t.replicaFamilyRootId !== root.id);
  const rootIdx = withoutReplicas.findIndex(t => t.id === root.id);
  if (rootIdx === -1) return { tasks: allTasks, newlyCreatedIds };

  const existingReplicas = getReplicaTasks(root.id, allTasks);
  const claimedIds = new Set<string>();

  const updatedRoot: PostProcessTask = {
    ...withoutReplicas[rootIdx]!,
    syncAsReplicaFamily: true,
    enabled: root.enabled,
    replicaFamilySpec: spec,
    replicaFamilyBaseName: baseName,
    name: baseName,
    replicaFamilyScheduleMode: root.replicaFamilyScheduleMode ?? 'auto',
  };

  const nextReplicas: PostProcessTask[] = [];

  for (const attrValue of relayNormalized) {
    const remaining = existingReplicas.filter(r => !claimedIds.has(r.id));
    const existing = pickReplicaByAttrIdentity(remaining, attrValue);
    if (existing) {
      nextReplicas.push(syncReplicaFromRoot(existing, updatedRoot));
      claimedIds.add(existing.id);
    } else {
      const created = buildReplicaFromRoot(updatedRoot, attrValue, baseName, allTasks);
      newlyCreatedIds.push(created.id);
      nextReplicas.push(created);
    }
  }

  for (const orphan of existingReplicas) {
    if (claimedIds.has(orphan.id)) continue;
    nextReplicas.push(syncReplicaFromRoot(orphan, updatedRoot));
  }

  nextReplicas.sort((a, b) =>
    (a.replicaFamilyAttrValue ?? '').localeCompare(b.replicaFamilyAttrValue ?? '', undefined, {
      numeric: true,
      sensitivity: 'base',
    }),
  );

  const tasks = [...withoutReplicas];
  tasks[rootIdx] = updatedRoot;
  tasks.splice(rootIdx + 1, 0, ...nextReplicas);
  return { tasks, newlyCreatedIds };
}

/** @deprecated 请使用 mergeReplicaFamilyFromRelay */
export function syncReplicaFamily(
  root: PostProcessTask,
  attrValues: string[],
  allTasks: PostProcessTask[],
): PostProcessTask[] {
  return mergeReplicaFamilyFromRelay(root, attrValues, allTasks).tasks;
}

export function isReplicaFamilyRootTemplate(task: PostProcessTask): boolean {
  return !!task.syncAsReplicaFamily && !task.replicaFamilyRootId;
}

export function isReplicaFamilyMember(task: PostProcessTask): boolean {
  return !!task.replicaFamilyRootId;
}

/** 去掉副本族成员，保留根模板与普通任务（全局预设「原貌」） */
export function stripReplicaFamilyMembers(tasks: PostProcessTask[]): PostProcessTask[] {
  return tasks.filter(t => !isReplicaFamilyMember(t));
}

export const REPLICA_MEMBER_WRITABLE_KEYS = new Set<keyof PostProcessTask>([
  'replicaFamilyLaunched',
  'enabled',
  'plotWorldbookMode',
  'plotWorldbookConfig',
  'apiPresetMode',
  'apiPresetName',
  'apiPresetFallbackNames',
  'apiPrimaryMaxConcurrency',
  'apiFallbackMaxConcurrencies',
  'promptAutoSegmentInsertedOverrides',
]);

const REPLICA_MEMBER_PATCH_DENIED_MSG = '副本为原本镜像，请编辑「原本」';

export function assertReplicaMemberPatchAllowed(
  task: PostProcessTask,
  patch: Partial<PostProcessTask>,
): void {
  if (!isReplicaFamilyMember(task)) return;
  for (const key of Object.keys(patch) as (keyof PostProcessTask)[]) {
    if (key === 'id') continue;
    if (!REPLICA_MEMBER_WRITABLE_KEYS.has(key)) {
      throw new Error(REPLICA_MEMBER_PATCH_DENIED_MSG);
    }
  }
}

export function expandEnabledTasksForRuntime(tasks: PostProcessTask[]): PostProcessTask[] {
  return tasks.filter(t => {
    if (!t.enabled) return false;
    if (isReplicaFamilyRootTemplate(t)) return false;
    return true;
  });
}

export function getReplicaFamilyGroupId(task: PostProcessTask): string | null {
  if (task.replicaFamilyRootId) return task.replicaFamilyRootId;
  if (task.syncAsReplicaFamily) return task.id;
  return null;
}

export function getReplicaFamilyBaseName(task: PostProcessTask, allTasks: PostProcessTask[]): string {
  const rootId = task.replicaFamilyRootId ?? (task.syncAsReplicaFamily ? task.id : null);
  if (!rootId) return task.name;
  const root = allTasks.find(t => t.id === rootId);
  return getReplicaFamilyBaseNameFromTask(root ?? task);
}

export function getReplicaDisplaySuffix(task: PostProcessTask): string | null {
  if (task.replicaFamilyAttrValue) return task.replicaFamilyAttrValue;
  return null;
}

export const REPLICA_PROGRESS_GROUP_PREFIX = 'replica-group:';

export function getReplicaProgressGroupId(task: PostProcessTask): string | null {
  if (!task.replicaFamilyRootId) return null;
  return `${REPLICA_PROGRESS_GROUP_PREFIX}${task.replicaFamilyRootId}`;
}

export type ReplicaMemberProgressState = {
  status: TaskProgressStatus;
  detail?: string;
};

export function buildReplicaAggregatedStatus(memberStatuses: TaskProgressStatus[]): TaskProgressStatus {
  if (!memberStatuses.length) return 'pending';
  if (memberStatuses.some(s => s === 'running')) return 'running';
  if (memberStatuses.some(s => s === 'failed')) return 'failed';
  if (memberStatuses.every(s => s === 'skipped')) return 'skipped';
  if (memberStatuses.every(s => s === 'done' || s === 'skipped')) return 'done';
  return 'pending';
}

export function buildReplicaGroupDetail(memberStatuses: TaskProgressStatus[]): string | undefined {
  if (memberStatuses.length <= 1) return undefined;
  const finished = memberStatuses.filter(s => s === 'done' || s === 'skipped').length;
  if (finished >= memberStatuses.length) return undefined;
  return `${finished}/${memberStatuses.length}`;
}

export function buildStageProgressDisplayItems(
  stageTasks: PostProcessTask[],
  allTasks: PostProcessTask[],
  memberStates: Map<string, ReplicaMemberProgressState> = new Map(),
): TaskProgressItem[] {
  const seenGroups = new Set<string>();
  const items: TaskProgressItem[] = [];

  for (const task of stageTasks) {
    const groupId = getReplicaProgressGroupId(task);
    if (groupId) {
      if (seenGroups.has(groupId)) continue;
      seenGroups.add(groupId);
      const members = stageTasks.filter(t => getReplicaProgressGroupId(t) === groupId);
      const memberStatuses = members.map(m => memberStates.get(m.id)?.status ?? 'pending');
      const status = buildReplicaAggregatedStatus(memberStatuses);
      let detail = buildReplicaGroupDetail(memberStatuses);
      if (status === 'failed') {
        const failed = members.find(m => memberStates.get(m.id)?.status === 'failed');
        detail = failed ? memberStates.get(failed.id)?.detail : detail;
      } else if (status === 'skipped') {
        const skipped = members.find(m => memberStates.get(m.id)?.status === 'skipped');
        detail = skipped ? memberStates.get(skipped.id)?.detail : detail;
      }
      items.push({
        taskId: groupId,
        taskName: getReplicaFamilyBaseName(task, allTasks),
        status,
        detail,
      });
      continue;
    }

    const state = memberStates.get(task.id);
    items.push({
      taskId: task.id,
      taskName: task.name,
      status: state?.status ?? 'pending',
      detail: state?.detail,
    });
  }

  return items;
}

export function getReplicaAttrSpecForTask(
  task: PostProcessTask,
): { tagName: string; attrName: string } | undefined {
  if (!task.replicaFamilyRootId || !task.replicaFamilySpec) return undefined;
  const parsed = parseExtractTagSpec(task.replicaFamilySpec);
  if (!parsed?.attrName) return undefined;
  return { tagName: parsed.tagName, attrName: parsed.attrName };
}

export function getReplicaFamilyEnumSpecKey(root: PostProcessTask): string {
  return (
    root.replicaFamilyEnumSpec?.trim() ||
    root.replicaFamilySpec?.trim() ||
    scanDynamicAttrPlaceholders(root)[0] ||
    ''
  ).trim();
}

export function resolveReplicaEnumTaskRef(
  taskRef: string,
  allTasks: PostProcessTask[],
): { rootId: string; specKey: string } | null {
  const root = findReplicaFamilyRootByRef(taskRef, allTasks);
  if (!root) return null;
  const specKey = getReplicaFamilyEnumSpecKey(root);
  if (!specKey) return null;
  return { rootId: root.id, specKey };
}

export function collectAttrValuesForReplicaRoot(
  root: PostProcessTask,
  relayMap: RelayTagMap,
): string[] {
  const enumSpecStr = getReplicaFamilyEnumSpecKey(root);
  if (!enumSpecStr) return [];
  const parsed = parseExtractTagSpec(enumSpecStr);
  if (!parsed?.attrName) return [];
  return collectEnumRegistryAttrValues(relayMap, parsed, root.id);
}

export function listReplicaFamilyScheduleEntries(
  rootId: string,
  allTasks: PostProcessTask[],
): Array<{
  id: string;
  name: string;
  attrValue: string;
  launched: boolean;
}> {
  return getReplicaTasks(rootId, allTasks).map(r => ({
    id: r.id,
    name: r.name,
    attrValue: r.replicaFamilyAttrValue ?? '',
    launched: isReplicaLaunched(r),
  }));
}

export const REPLICA_LAUNCHED_PLACEHOLDER_PREFIX = 'replica:launched:';

export function parseReplicaLaunchedPlaceholder(name: string): string | null {
  const trimmed = name.trim();
  const lower = trimmed.toLowerCase();
  const prefix = REPLICA_LAUNCHED_PLACEHOLDER_PREFIX.toLowerCase();
  if (!lower.startsWith(prefix)) return null;
  const ref = trimmed.slice(REPLICA_LAUNCHED_PLACEHOLDER_PREFIX.length).trim();
  return ref || null;
}

export function isReplicaLaunchedPlaceholder(name: string): boolean {
  return parseReplicaLaunchedPlaceholder(name) != null;
}

export function findReplicaFamilyRootByRef(ref: string, allTasks: PostProcessTask[]): PostProcessTask | undefined {
  const trimmed = ref.trim();
  if (!trimmed) return undefined;

  const direct = allTasks.find(t => t.id === trimmed || t.name === trimmed);
  if (direct) {
    if (isReplicaFamilyRootTemplate(direct)) return direct;
    if (direct.replicaFamilyRootId) {
      return allTasks.find(t => t.id === direct.replicaFamilyRootId);
    }
  }

  return allTasks.find(
    t =>
      isReplicaFamilyRootTemplate(t) &&
      (t.replicaFamilyBaseName?.trim() === trimmed || t.name === trimmed),
  );
}

/** 按 replicaFamilyEnumSpec / replicaFamilySpec 匹配全部副本族原本 */
export function findReplicaFamilyRootsByAttrSpec(
  spec: { tagName: string; attrName: string },
  allTasks: PostProcessTask[],
): PostProcessTask[] {
  const key = buildExtractSpecKey(spec.tagName, spec.attrName).toLowerCase();
  return allTasks.filter(t => {
    if (!isReplicaFamilyRootTemplate(t)) return false;
    const rootSpec = getReplicaFamilyEnumSpecKey(t).toLowerCase();
    return rootSpec === key;
  });
}

/** @deprecated 请使用 findReplicaFamilyRootsByAttrSpec；仅返回第一个匹配根 */
export function findReplicaFamilyRootByAttrSpec(
  spec: { tagName: string; attrName: string },
  allTasks: PostProcessTask[],
): PostProcessTask | undefined {
  return findReplicaFamilyRootsByAttrSpec(spec, allTasks)[0];
}

function resolveRootsForAttrSpec(
  spec: { tagName: string; attrName: string },
  allTasks: PostProcessTask[],
  taskRef?: string,
): PostProcessTask[] {
  if (taskRef?.trim()) {
    const root = findReplicaFamilyRootByRef(taskRef, allTasks);
    if (!root) return [];
    const expected = buildExtractSpecKey(spec.tagName, spec.attrName).toLowerCase();
    if (getReplicaFamilyEnumSpecKey(root).toLowerCase() !== expected) return [];
    return [root];
  }
  return findReplicaFamilyRootsByAttrSpec(spec, allTasks);
}

/** 跨匹配副本族并集本轮 launched 后缀（按 attrValue 去重排序） */
export function listLaunchedAttrValuesForSpec(
  spec: { tagName: string; attrName: string },
  allTasks: PostProcessTask[],
  relayMap: RelayTagMap,
  taskRef?: string,
): string[] {
  const roots = resolveRootsForAttrSpec(spec, allTasks, taskRef);
  const values: string[] = [];
  for (const root of roots) {
    values.push(...listLaunchedReplicaSuffixes(root, allTasks, relayMap));
  }
  return sortAttrValues([...new Set(values)]);
}

/** 跨匹配副本族并集楼层 last-launched 后缀（按 attrValue 去重排序） */
export function listLastLaunchedAttrValuesForSpec(
  spec: { tagName: string; attrName: string },
  allTasks: PostProcessTask[],
  snapshot: ReplicaStateSnapshot,
  taskRef?: string,
): string[] {
  const roots = resolveRootsForAttrSpec(spec, allTasks, taskRef);
  const values: string[] = [];
  for (const root of roots) {
    values.push(...listLastLaunchedAttrValues(root, snapshot));
  }
  return sortAttrValues([...new Set(values)]);
}

/**
 * 按根回退后再并集：每个匹配根「本轮非空用本轮，否则用该根 last-launched」，
 * 再跨根按 attrValue 去重排序（可指定 task）。
 */
export function listLaunchedAttrValuesForSpecWithFallback(
  spec: { tagName: string; attrName: string },
  allTasks: PostProcessTask[],
  relayMap: RelayTagMap,
  snapshot: ReplicaStateSnapshot,
  taskRef?: string,
): string[] {
  const roots = resolveRootsForAttrSpec(spec, allTasks, taskRef);
  const values: string[] = [];
  for (const root of roots) {
    const current = listLaunchedReplicaSuffixes(root, allTasks, relayMap);
    if (current.length) values.push(...current);
    else values.push(...listLastLaunchedAttrValues(root, snapshot));
  }
  return sortAttrValues([...new Set(values)]);
}

export function listLaunchedReplicaSuffixes(
  root: PostProcessTask,
  allTasks: PostProcessTask[],
  relayMap: RelayTagMap,
): string[] {
  const replicas = getReplicaTasks(root.id, allTasks);
  const attrValues = collectAttrValuesForReplicaRoot(root, relayMap);
  const runnable = selectRunnableReplicasForRelay(replicas, root, attrValues);

  const suffixes = runnable
    .map(r => getReplicaDisplaySuffix(r))
    .filter((s): s is string => !!s);
  return sortAttrValues([...new Set(suffixes)]);
}

/**
 * 楼层快照中「上次启动」属性值列表。
 * manual → launchedAttrValues；auto → lastEnumAttrValues；所选为空则回退另一字段。
 */
export function listLastLaunchedAttrValues(
  root: PostProcessTask,
  snapshot: ReplicaStateSnapshot,
): string[] {
  const state = snapshot[root.id];
  if (!state) return [];
  const launched = (state.launchedAttrValues ?? []).map(v => String(v).trim()).filter(Boolean);
  const enums = (state.lastEnumAttrValues ?? []).map(v => String(v).trim()).filter(Boolean);
  const mode = getReplicaFamilyScheduleMode(root);
  const primary = mode === 'manual' ? launched : enums;
  const fallback = mode === 'manual' ? enums : launched;
  const chosen = primary.length ? primary : fallback;
  return sortAttrValues([...new Set(chosen)]);
}

/** 本轮 runnable 优先；整表为空则回退楼层 last-launched 名单 */
export function listLaunchedAttrValuesWithFallback(
  root: PostProcessTask,
  allTasks: PostProcessTask[],
  relayMap: RelayTagMap,
  snapshot: ReplicaStateSnapshot,
): string[] {
  const current = listLaunchedReplicaSuffixes(root, allTasks, relayMap);
  if (current.length) return current;
  return listLastLaunchedAttrValues(root, snapshot);
}

export function resolveReplicaLaunchedPlaceholder(
  ref: string,
  allTasks: PostProcessTask[],
  relayMap: RelayTagMap,
  snapshot: ReplicaStateSnapshot = {},
): string {
  const root = findReplicaFamilyRootByRef(ref, allTasks);
  if (!root) return '';
  return listLaunchedAttrValuesWithFallback(root, allTasks, relayMap, snapshot).join('、');
}

export type SkippedReplicaRoot = {
  root: PostProcessTask;
  skipReason: string;
};

export type PrepareStageReplicaSyncResult = {
  tasks: PostProcessTask[];
  allTasks: PostProcessTask[];
  skippedRoots: SkippedReplicaRoot[];
  newlyCreatedReplicaIds: string[];
};

/** 副本族无可运行成员时的跳过原因（按调度模式区分） */
export function describeReplicaFamilySkipReason(
  root: PostProcessTask,
  replicas: PostProcessTask[],
  relayAttrValues: string[],
): string {
  const mode = getReplicaFamilyScheduleMode(root);
  if (mode === 'manual') {
    if (!replicas.length) return '副本族：无可用副本成员';
    return '副本族：手动调度下无已启动副本';
  }
  if (!relayAttrValues.length) return '副本族：上一阶段 relay 无可用属性实例';
  if (!replicas.length) return '副本族：无可用副本成员';
  return '副本族：relay 枚举与可运行副本无交集';
}

export function prepareStageTasksWithReplicaSync(
  stageTasks: PostProcessTask[],
  allTasks: PostProcessTask[],
  relayMap: RelayTagMap,
): PrepareStageReplicaSyncResult {
  let updatedAll = [...allTasks];
  const skippedRoots: SkippedReplicaRoot[] = [];
  const runtimeTasks: PostProcessTask[] = [];
  const handledRoots = new Set<string>();
  const newlyCreatedReplicaIds: string[] = [];

  for (const task of stageTasks) {
    if (task.replicaFamilyRootId) continue;

    if (isReplicaFamilyRootTemplate(task)) {
      if (handledRoots.has(task.id)) continue;
      handledRoots.add(task.id);
      const root = updatedAll.find(t => t.id === task.id) ?? task;
      const attrValues = collectAttrValuesForReplicaRoot(root, relayMap);
      if (attrValues.length) {
        recordPendingLastEnumAttrValues(root.id, attrValues);
      }
      const merged = mergeReplicaFamilyFromRelay(root, attrValues, updatedAll);
      updatedAll = merged.tasks;
      newlyCreatedReplicaIds.push(...merged.newlyCreatedIds);
      const syncedRoot = updatedAll.find(t => t.id === root.id) ?? root;
      const replicas = getReplicaTasks(syncedRoot.id, updatedAll);
      const runnable = selectRunnableReplicasForRelay(replicas, syncedRoot, attrValues);

      if (!runnable.length) {
        skippedRoots.push({
          root: syncedRoot,
          skipReason: describeReplicaFamilySkipReason(syncedRoot, replicas, attrValues),
        });
        continue;
      }
      runtimeTasks.push(...runnable);
      continue;
    }

    runtimeTasks.push(task);
  }

  return {
    tasks: runtimeTasks,
    allTasks: updatedAll,
    skippedRoots,
    newlyCreatedReplicaIds,
  };
}

export function resetNewlyCreatedReplicaLaunched(
  allTasks: PostProcessTask[],
  newlyCreatedIds: string[],
): PostProcessTask[] {
  if (!newlyCreatedIds.length) return allTasks;
  const idSet = new Set(newlyCreatedIds);
  return allTasks.map(t => (idSet.has(t.id) ? { ...t, replicaFamilyLaunched: false } : t));
}

export function enableReplicaFamilyOnTask(task: PostProcessTask): PostProcessTask {
  const validation = validateReplicaFamilyEligibility(task);
  if (!validation.ok) {
    throw new Error(validation.error);
  }
  const baseName = getReplicaFamilyBaseNameFromTask(task);
  return {
    ...task,
    enabled: true,
    syncAsReplicaFamily: true,
    replicaFamilySpec: validation.spec,
    replicaFamilyEnumSpec: validation.spec,
    replicaFamilyBaseName: baseName,
    replicaFamilyScheduleMode: task.replicaFamilyScheduleMode ?? 'auto',
    name: baseName,
  };
}

export function disableReplicaFamilyOnTasks(task: PostProcessTask, allTasks: PostProcessTask[]): PostProcessTask[] {
  const rootId = task.replicaFamilyRootId ?? (task.syncAsReplicaFamily ? task.id : null);
  if (!rootId) {
    return allTasks.map(t => (t.id === task.id ? { ...t, enabled: false, syncAsReplicaFamily: false } : t));
  }

  let tasks = deleteReplicaFamilyTasks(rootId, allTasks);
  tasks = tasks.map(t => {
    if (t.id !== rootId) return t;
    return {
      ...t,
      enabled: false,
      syncAsReplicaFamily: false,
      replicaFamilySpec: undefined,
      replicaFamilyEnumSpec: undefined,
      replicaFamilyBaseName: undefined,
      replicaFamilyScheduleMode: undefined,
    };
  });
  return tasks;
}

export function clearReplicaFamilyFieldsOnClone(task: PostProcessTask): PostProcessTask {
  return {
    ...task,
    syncAsReplicaFamily: false,
    replicaFamilyRootId: undefined,
    replicaFamilyAttrValue: undefined,
    replicaFamilySpec: undefined,
    replicaFamilyEnumSpec: undefined,
    replicaFamilyBaseName: undefined,
    replicaFamilyScheduleMode: undefined,
    replicaFamilyLaunched: undefined,
    promptAutoSegmentInsertedOverrides: undefined,
  };
}

export function hasReplicaFamilyTasks(tasks: PostProcessTask[]): boolean {
  return tasks.some(t => t.syncAsReplicaFamily);
}
