import { findApiPreset, normalizeApiPresetFallbackNames, resolveTaskApiPreset } from '../api/resolve';
import { alignFallbackMaxConcurrencies, normalizeRouteMaxConcurrency } from '../api/route-concurrency-limits';
import { buildPresetFromSettings } from '../settings-security';
import { loadSettings, saveSettings } from '../settings';
import {
  buildChatSnapshotFromSettings,
  clearChatTaskScope,
  ensureChatOverride,
  getChatScopeDropdownValue,
  hasChatSnapshot,
  readChatTaskScope,
  repairChatScopeBoundPreset,
  setChatScopeActiveView as setChatScopeActiveViewInScope,
  writeChatTaskScope,
  isChatOverrideActive,
} from './chat-task-scope';
import { applyPresetFieldsToSettings, resolveEffectiveSettings } from './effective-settings';
import { emitChatScopeChanged, emitTasksChanged } from './events';
import { persistRuntimeTaskChanges } from './persist-runtime-tasks';
import { pruneWorldbookForRemovedReplicas } from './prune-applied-for-replica';
import { resolveLastRunStatus, resolveRunStatusForFloor } from './run-status';
import {
  PostProcessPresetSchema,
  PostProcessTaskSchema,
  ChatTaskScopeStateSchema,
  CHAT_SNAPSHOT_PRESET_NAME,
  type ApiPresetMode,
  type ChatTaskScopeState,
  type PostProcessTask,
  type ReplicaFamilyScheduleMode,
  type ScriptSettings,
} from './schema';
import { newTaskId, cloneTaskForInsert } from './task-clone';
import {
  assertReplicaMemberPatchAllowed,
  buildReplicaFromRoot,
  copyApiRoutingFieldsFrom,
  disableReplicaFamilyOnTasks,
  enableReplicaFamilyOnTask,
  getReplicaFamilyBaseNameFromTask,
  getReplicaTasks,
  isReplicaFamilyMember,
  listReplicaFamilyScheduleEntries,
  mirrorAllReplicaFamilies,
  promoteReplicaApiPatchToCustom,
  scanDynamicAttrPlaceholders,
  syncReplicaFamily,
  validateReplicaFamilyEligibility,
  stripReplicaFamilyMembers,
} from './replica-family';
import { normalizeReplicaAttrValue, pickReplicaByAttrIdentity } from './replica-attr-identity';
import {
  applyReplicaFamilyCleanup,
  getReplicaFamilyCleanupConfig,
  listReplicaFamilyCleanupCandidates,
  resetReplicaFamilyCleanupCycle,
  updateReplicaFamilyCleanupConfig,
  type ReplicaCleanupCandidateGroup,
  type RemovedReplicaCleanupInfo,
} from './replica-family-cleanup';
import {
  applyTaskWorkflowPresetOnTask,
  deleteTaskWorkflowPresetOnTask,
  listTaskWorkflowPresetNames,
  saveTaskWorkflowPresetOnTask,
} from './task-workflow-preset';
import {
  appendPromptGroup,
  movePromptGroupAt,
  removePromptGroupAt,
} from './prompt-group-ops';
import {
  appendPromptAutoSegment,
  appendPromptAutoSlot,
  removePromptAutoSegmentAt,
  removePromptAutoSlotAt,
} from './prompt-auto-segment-ops';
import { mergeTaskSchedule, parseTaskSchedule, type TaskSchedulePatch } from './task-schedule-merge';
import {
  mergeTaskExecutionOptions,
  normalizeExtractInjectTags,
  type TaskExecutionOptionsPatch,
} from './task-extract-tags-merge';
import type { PlotWorldbookConfig, PlotWorldbookMode, TaskContextConfig } from './schema';
import type { z } from 'zod';
import { PromptGroupSchema, PromptAutoSegmentSchema, PromptAutoSlotSchema } from './schema';

type PromptGroup = z.infer<typeof PromptGroupSchema>;
type PromptAutoSlot = z.infer<typeof PromptAutoSlotSchema>;
type PromptAutoSegment = z.infer<typeof PromptAutoSegmentSchema>;

export type TaskWriteSource = 'api' | 'ui';

export type { TaskSchedulePatch } from './task-schedule-merge';
export type { TaskExecutionOptionsPatch } from './task-extract-tags-merge';

export type PresetFieldsPatch = Partial<{
  contextTurnCount: number;
  contextExtractRules: ScriptSettings['contextExtractRules'];
  contextExcludeRules: ScriptSettings['contextExcludeRules'];
  plotWorldbookConfig: PlotWorldbookConfig;
  taskPlotWorldbookOverridesEnabled: boolean;
  taskContextOverridesEnabled: boolean;
  memoryRecallRecentCount: number;
  finalInjectTemplate: string;
  userInputEndInjectTemplate: string;
  tagVariableInjectTemplate: string;
  chatExtractTags: ScriptSettings['chatExtractTags'];
  chatBodyTagReplaceRules: ScriptSettings['chatBodyTagReplaceRules'];
  chatWorldbookWriteRules: ScriptSettings['chatWorldbookWriteRules'];
}>;

function defaultTaskFields(): PostProcessTask {
  return PostProcessTaskSchema.parse({
    id: newTaskId(),
    name: '新任务',
    enabled: true,
    stage: 1,
    extractInjectTags: ['result'],
    mergeStrategy: 'concat',
    maxRetries: 3,
    minLength: 0,
    apiPresetName: '',
    apiPresetFallbackNames: [],
    apiPrimaryMaxConcurrency: 5,
    apiFallbackMaxConcurrencies: [],
    plotWorldbookMode: 'inherit',
    contextMode: 'inherit',
    promptGroups: [{ name: '', role: 'user', content: '当前 AI 回复：$7', enabled: true }],
    promptAutoSlots: [],
    promptAutoSegments: [],
  });
}

function cleanupTaskRuntimeState(settings: ScriptSettings, taskId: string): void {
  delete settings.scheduleState[taskId];
  delete settings.taskApiPresetOverridesById[taskId];
}

async function persistSnapshotTasks(
  settings: ScriptSettings,
  tasks: PostProcessTask[],
  source: TaskWriteSource,
): Promise<ChatTaskScopeState> {
  const { scope, created } = await ensureChatOverride(settings, source);
  const snapshot = PostProcessPresetSchema.parse({
    ...scope.snapshot!,
    tasks: _.cloneDeep(tasks),
  });
  const next = ChatTaskScopeStateSchema.parse({
    ...scope,
    snapshot,
    // 快照写回后视图回到 snapshot，避免与数据错位
    activeView: 'snapshot',
    boundGlobalPresetName: '',
    updatedAt: Date.now(),
    source,
  });
  await writeChatTaskScope(next);
  if (created) {
    await emitChatScopeChanged('chat_override', next.originPresetName, { createdSnapshot: true });
  }
  return next;
}

async function persistGlobalTasks(settings: ScriptSettings, tasks: PostProcessTask[]): Promise<void> {
  settings.tasks = _.cloneDeep(tasks);
  saveSettings(settings);
}

/** 浏览绑定全局预设时的写回目标名（UI / API / runtime 共用检测） */
function getBoundGlobalPresetNameForWrite(): string | null {
  const scope = readChatTaskScope();
  if (!isChatOverrideActive(scope) || scope?.activeView !== 'global') return null;
  const name = scope.boundGlobalPresetName?.trim() ?? '';
  return name || null;
}

function persistBoundGlobalTasks(settings: ScriptSettings, tasks: PostProcessTask[], boundName: string): void {
  const idx = settings.presets.findIndex(p => p.name === boundName);
  if (idx < 0) {
    throw new Error(`绑定的全局预设不存在: ${boundName}`);
  }
  const prev = settings.presets[idx]!;
  settings.presets[idx] = PostProcessPresetSchema.parse({
    ...prev,
    name: boundName,
    tasks: _.cloneDeep(tasks),
  });
  if (settings.activePresetName.trim() === boundName) {
    settings.tasks = _.cloneDeep(tasks);
  }
  saveSettings(settings);
}

function persistBoundGlobalPresetFields(
  settings: ScriptSettings,
  fields: PresetFieldsPatch,
  boundName: string,
): void {
  const idx = settings.presets.findIndex(p => p.name === boundName);
  if (idx < 0) {
    throw new Error(`绑定的全局预设不存在: ${boundName}`);
  }
  const prev = settings.presets[idx]!;
  settings.presets[idx] = PostProcessPresetSchema.parse({
    ...prev,
    ..._.cloneDeep(fields),
    name: boundName,
  });
  if (settings.activePresetName.trim() === boundName) {
    Object.assign(settings, _.cloneDeep(fields));
  }
  saveSettings(settings);
}

async function writeTasks(
  settings: ScriptSettings,
  tasks: PostProcessTask[],
  source: TaskWriteSource,
): Promise<void> {
  const boundName = getBoundGlobalPresetNameForWrite();
  if (boundName) {
    persistBoundGlobalTasks(settings, tasks, boundName);
    // API/runtime：写绑定槽后再覆盖快照并切回 snapshot 视图；UI 手改只写全局
    if (source === 'api') {
      await forkEffectiveIntoChatSnapshot(source);
    }
    return;
  }
  const useSnapshot = source === 'api' || isChatOverrideActive(readChatTaskScope());
  if (useSnapshot) {
    await persistSnapshotTasks(settings, tasks, source);
  } else {
    await persistGlobalTasks(settings, tasks);
  }
}

export function listTasks(): PostProcessTask[] {
  const settings = loadSettings();
  return _.cloneDeep(resolveEffectiveSettings(settings).tasks);
}

export function getTask(id: string): PostProcessTask | null {
  return listTasks().find(t => t.id === id) ?? null;
}

export async function createTask(
  input?: Partial<PostProcessTask>,
  source: TaskWriteSource = 'api',
): Promise<PostProcessTask> {
  const settings = loadSettings();
  const tasks = listTasks();
  const task = PostProcessTaskSchema.parse({
    ...defaultTaskFields(),
    ...input,
    id: input?.id?.trim() || newTaskId(),
  });
  tasks.push(task);
  await writeTasks(settings, tasks, source);
  await emitTasksChanged('create', source, task.id);
  return task;
}

export async function updateTask(
  id: string,
  patch: Partial<PostProcessTask>,
  source: TaskWriteSource = 'api',
): Promise<PostProcessTask> {
  const settings = loadSettings();
  const tasks = listTasks();
  const index = tasks.findIndex(t => t.id === id);
  if (index < 0) {
    throw new Error(`任务不存在: ${id}`);
  }
  assertReplicaMemberPatchAllowed(tasks[index]!, patch);
  const effectivePatch = promoteReplicaApiPatchToCustom(tasks[index]!, patch);
  const updated = PostProcessTaskSchema.parse({
    ...tasks[index],
    ...effectivePatch,
    id,
  });
  tasks[index] = updated;
  const mirrored = mirrorAllReplicaFamilies(tasks);
  await writeTasks(settings, mirrored, source);
  await emitTasksChanged('update', source, id);
  return mirrored.find(t => t.id === id) ?? updated;
}

export async function deleteTask(id: string, source: TaskWriteSource = 'api'): Promise<boolean> {
  const settings = loadSettings();
  const tasks = listTasks();
  if (!tasks.some(t => t.id === id)) return false;
  const next = tasks.filter(t => t.id !== id);
  cleanupTaskRuntimeState(settings, id);
  saveSettings(settings);
  await writeTasks(settings, next, source);
  await emitTasksChanged('delete', source, id);
  return true;
}

export async function replaceTasks(
  tasks: PostProcessTask[],
  source: TaskWriteSource = 'api',
): Promise<void> {
  const settings = loadSettings();
  const parsed = tasks.map(t => PostProcessTaskSchema.parse(t));
  const mirrored = mirrorAllReplicaFamilies(parsed);
  await writeTasks(settings, mirrored, source);
  await emitTasksChanged('replace', source);
}

export function getChatScopeState(): ChatTaskScopeState | null {
  return readChatTaskScope();
}

export function getChatPresetDropdownValue(): string {
  const scope = readChatTaskScope();
  if (!hasChatSnapshot(scope)) {
    return String(loadSettings().activePresetName ?? '').trim();
  }
  return getChatScopeDropdownValue(scope);
}

export async function setChatScopeActiveView(
  input: { view: 'snapshot' } | { view: 'global'; presetName: string },
): Promise<ChatTaskScopeState | null> {
  const settings = loadSettings();
  const next = await setChatScopeActiveViewInScope(input, settings.presets);
  if (next) {
    await emitChatScopeChanged('chat_override', next.originPresetName);
    await emitTasksChanged('preset', 'ui');
  }
  return next;
}

export async function repairChatScopeIfNeeded(): Promise<void> {
  const settings = loadSettings();
  const before = readChatTaskScope();
  if (!before || before.activeView !== 'global') return;
  const next = await repairChatScopeBoundPreset(settings.presets);
  if (next && next.activeView === 'snapshot' && before.activeView === 'global') {
    await emitChatScopeChanged('chat_override', next.originPresetName);
    await emitTasksChanged('preset', 'ui');
  }
}

/**
 * 用当前 effective（下拉所看内容）覆盖聊天快照并切到 snapshot 视图。
 * 供 UI「覆盖快照」显式调用；浏览全局时的普通编辑不应再走这里。
 * API/runtime 写回绑定全局后也会调用：此时会把 originPresetName 更新为绑定全局名。
 */
export async function forkEffectiveIntoChatSnapshot(source: TaskWriteSource = 'ui'): Promise<void> {
  const settings = loadSettings();
  const scope = readChatTaskScope();
  if (!scope?.snapshot) return;
  const effective = resolveEffectiveSettings(settings);
  const snapshot = buildChatSnapshotFromSettings(effective);
  const boundName =
    scope.activeView === 'global' ? scope.boundGlobalPresetName?.trim() || '' : '';
  const originPresetName = boundName || scope.originPresetName;
  await writeChatTaskScope(
    ChatTaskScopeStateSchema.parse({
      ...scope,
      snapshot,
      originPresetName,
      activeView: 'snapshot',
      boundGlobalPresetName: '',
      updatedAt: Date.now(),
      source,
    }),
  );
  await emitChatScopeChanged('chat_override', originPresetName);
  await emitTasksChanged('preset', source);
}

/**
 * 将 UI 展示态整份保存到指定全局预设名（有快照且浏览全局时的「保存」）。
 * 不改 activePresetName，不动聊天快照。
 */
export function saveNamedGlobalPresetFromDisplay(display: ScriptSettings, presetName: string): boolean {
  const name = presetName.trim();
  if (!name || name === CHAT_SNAPSHOT_PRESET_NAME) return false;
  const settings = loadSettings();
  const idx = settings.presets.findIndex(p => p.name === name);
  if (idx < 0) return false;
  const preset = PostProcessPresetSchema.parse(buildPresetFromSettings(display, name));
  settings.presets[idx] = preset;
  if (settings.activePresetName.trim() === name) {
    applyPresetFieldsToSettings(settings, preset);
  }
  saveSettings(settings);
  return true;
}

export async function clearChatScope(source: TaskWriteSource = 'api'): Promise<void> {
  const prev = readChatTaskScope();
  await clearChatTaskScope();
  // 清除后从活动预设重水合顶层工作副本，避免展示叠写残留
  const settings = loadSettings();
  const activeName = settings.activePresetName?.trim() ?? '';
  const activePreset = activeName ? settings.presets.find(p => p.name === activeName) : undefined;
  if (activePreset) {
    applyPresetFieldsToSettings(settings, activePreset);
    saveSettings(settings);
  }
  await emitChatScopeChanged('inherit_global', prev?.originPresetName);
  await emitTasksChanged('clear', source);
}

/** 桥接兼容：另存为全局并清除聊天快照 */
export async function promoteChatScopeToPreset(name?: string): Promise<string | null> {
  const scope = readChatTaskScope();
  if (!scope?.snapshot) return null;
  const settings = loadSettings();
  const presetName = name?.trim() || `聊天快照-${new Date().toLocaleString('zh-CN')}`;
  if (!presetName || presetName === CHAT_SNAPSHOT_PRESET_NAME) return null;
  if (settings.presets.some(p => p.name === presetName)) return null;

  const preset = PostProcessPresetSchema.parse({
    ...scope.snapshot,
    name: presetName,
    tasks: stripReplicaFamilyMembers(scope.snapshot.tasks),
  });
  settings.presets.push(_.cloneDeep(preset));
  settings.activePresetName = presetName;
  settings.tasks = _.cloneDeep(preset.tasks);
  settings.finalInjectTemplate = preset.finalInjectTemplate;
  settings.userInputEndInjectTemplate = preset.userInputEndInjectTemplate ?? '';
  settings.tagVariableInjectTemplate = preset.tagVariableInjectTemplate;
  settings.chatExtractTags = _.cloneDeep(preset.chatExtractTags ?? { user: [], assistant: [] });
  settings.chatBodyTagReplaceRules = _.cloneDeep(preset.chatBodyTagReplaceRules ?? []);
  settings.chatWorldbookWriteRules = _.cloneDeep(preset.chatWorldbookWriteRules ?? []);
  settings.contextTurnCount = preset.contextTurnCount;
  settings.contextExtractRules = _.cloneDeep(preset.contextExtractRules);
  settings.contextExcludeRules = _.cloneDeep(preset.contextExcludeRules);
  settings.plotWorldbookConfig = _.cloneDeep(preset.plotWorldbookConfig);
  settings.taskPlotWorldbookOverridesEnabled = preset.taskPlotWorldbookOverridesEnabled ?? false;
  settings.taskContextOverridesEnabled = preset.taskContextOverridesEnabled ?? false;
  settings.memoryRecallRecentCount = preset.memoryRecallRecentCount ?? 10;
  saveSettings(settings);
  await clearChatTaskScope();
  await emitChatScopeChanged('inherit_global', scope.originPresetName);
  return presetName;
}

/** UI：从聊天快照另存为新全局预设，保留快照与当前视图 */
export async function saveChatSnapshotAsGlobalPreset(name?: string): Promise<string | null> {
  const scope = readChatTaskScope();
  if (!scope?.snapshot) return null;
  const settings = loadSettings();
  const presetName = name?.trim() || `聊天快照-${new Date().toLocaleString('zh-CN')}`;
  if (!presetName || presetName === CHAT_SNAPSHOT_PRESET_NAME) return null;
  if (settings.presets.some(p => p.name === presetName)) return null;

  const preset = PostProcessPresetSchema.parse({
    ...scope.snapshot,
    name: presetName,
    tasks: stripReplicaFamilyMembers(scope.snapshot.tasks),
  });
  settings.presets.push(_.cloneDeep(preset));
  saveSettings(settings);
  await emitTasksChanged('preset', 'ui');
  return presetName;
}

/** 将当前 effective 预设字段同步回聊天快照（UI 编辑上下文等字段时） */
export async function syncEffectivePresetFieldsToChatScope(
  fields: Partial<ReturnType<typeof buildChatSnapshotFromSettings>>,
  source: TaskWriteSource = 'ui',
): Promise<void> {
  if (!isChatOverrideActive(readChatTaskScope())) return;
  const settings = loadSettings();
  const { scope } = await ensureChatOverride(settings, source);
  const snapshot = PostProcessPresetSchema.parse({
    ...scope.snapshot!,
    ...fields,
  });
  await writeChatTaskScope(
    ChatTaskScopeStateSchema.parse({
      ...scope,
      snapshot,
      activeView: 'snapshot',
      boundGlobalPresetName: '',
      updatedAt: Date.now(),
      source,
    }),
  );
}

export function hasActiveChatTaskScope(): boolean {
  return isChatOverrideActive(readChatTaskScope());
}

export async function updatePresetFields(
  fields: PresetFieldsPatch,
  source: TaskWriteSource = 'api',
): Promise<void> {
  const settings = loadSettings();
  const boundName = getBoundGlobalPresetNameForWrite();
  if (boundName) {
    persistBoundGlobalPresetFields(settings, fields, boundName);
    if (source === 'api') {
      await forkEffectiveIntoChatSnapshot(source);
    } else {
      await emitTasksChanged('preset', source);
    }
    return;
  }

  const useSnapshot = source === 'api' || isChatOverrideActive(readChatTaskScope());

  if (useSnapshot) {
    const { scope, created } = await ensureChatOverride(settings, source);
    const mergedSnapshot = {
      ...scope.snapshot!,
      ..._.cloneDeep(fields),
    };
    const snapshot = PostProcessPresetSchema.parse(mergedSnapshot);
    const next = ChatTaskScopeStateSchema.parse({
      ...scope,
      snapshot,
      activeView: 'snapshot',
      boundGlobalPresetName: '',
      updatedAt: Date.now(),
      source,
    });
    await writeChatTaskScope(next);
    if (created) {
      await emitChatScopeChanged('chat_override', next.originPresetName, { createdSnapshot: true });
    }
  } else {
    Object.assign(settings, _.cloneDeep(fields));
    saveSettings(settings);
  }
  await emitTasksChanged('preset', source);
}

export async function updateTaskPlotWorldbook(
  id: string,
  input: { mode?: PlotWorldbookMode; config?: PlotWorldbookConfig },
  source: TaskWriteSource = 'api',
): Promise<PostProcessTask> {
  const patch: Partial<PostProcessTask> = {};
  if (input.mode !== undefined) patch.plotWorldbookMode = input.mode;
  if (input.config !== undefined) patch.plotWorldbookConfig = input.config;
  return updateTask(id, patch, source);
}

export async function updateTaskContext(
  id: string,
  input: { mode?: 'inherit' | 'custom'; config?: TaskContextConfig },
  source: TaskWriteSource = 'api',
): Promise<PostProcessTask> {
  const patch: Partial<PostProcessTask> = {};
  if (input.mode !== undefined) patch.contextMode = input.mode;
  if (input.config !== undefined) patch.contextConfig = input.config;
  return updateTask(id, patch, source);
}

export async function updatePromptGroup(
  id: string,
  index: number,
  patch: Partial<PromptGroup>,
  source: TaskWriteSource = 'api',
): Promise<PostProcessTask> {
  const task = getTask(id);
  if (!task) throw new Error(`任务不存在: ${id}`);
  if (index < 0 || index >= task.promptGroups.length) {
    throw new Error(`提示词段索引无效: ${index}`);
  }
  const groups = _.cloneDeep(task.promptGroups);
  groups[index] = { ...groups[index], ...patch };
  return updateTask(id, { promptGroups: groups }, source);
}

export async function updateTaskStage(
  id: string,
  stage: number,
  source: TaskWriteSource = 'api',
): Promise<PostProcessTask> {
  if (!Number.isInteger(stage) || stage < 1) {
    throw new Error(`执行阶段无效: ${stage}（须为 >= 1 的整数）`);
  }
  return updateTask(id, { stage }, source);
}

export async function updateTaskSchedule(
  id: string,
  patch: TaskSchedulePatch,
  source: TaskWriteSource = 'api',
): Promise<PostProcessTask> {
  const task = getTask(id);
  if (!task) throw new Error(`任务不存在: ${id}`);
  const schedule = parseTaskSchedule(mergeTaskSchedule(task.schedule, patch));
  return updateTask(id, { schedule }, source);
}

export async function duplicateTask(
  id: string,
  options?: { afterTaskId?: string },
  source: TaskWriteSource = 'api',
): Promise<PostProcessTask> {
  const tasks = listTasks();
  const sourceTask = tasks.find(t => t.id === id);
  if (!sourceTask) throw new Error(`任务不存在: ${id}`);
  if (isReplicaFamilyMember(sourceTask)) {
    throw new Error('副本为原本镜像，请编辑「原本」');
  }
  const cloned = cloneTaskForInsert(sourceTask, tasks);
  const next = [...tasks];
  const afterId = options?.afterTaskId ?? id;
  const insertAt = next.findIndex(t => t.id === afterId);
  if (insertAt >= 0) next.splice(insertAt + 1, 0, cloned);
  else next.push(cloned);
  const settings = loadSettings();
  await writeTasks(settings, next, source);
  await emitTasksChanged('create', source, cloned.id);
  return cloned;
}

export async function moveTask(
  id: string,
  delta: -1 | 1,
  source: TaskWriteSource = 'api',
): Promise<void> {
  const tasks = listTasks();
  const index = tasks.findIndex(t => t.id === id);
  if (index < 0) throw new Error(`任务不存在: ${id}`);
  if (isReplicaFamilyMember(tasks[index]!)) {
    throw new Error('副本为原本镜像，请编辑「原本」');
  }
  const target = index + delta;
  if (target < 0 || target >= tasks.length) return;
  const next = [...tasks];
  const [item] = next.splice(index, 1);
  next.splice(target, 0, item);
  const settings = loadSettings();
  await writeTasks(settings, next, source);
  await emitTasksChanged('replace', source);
}

export async function moveTaskToIndex(
  id: string,
  toIndex: number,
  source: TaskWriteSource = 'api',
): Promise<void> {
  const tasks = listTasks();
  const index = tasks.findIndex(t => t.id === id);
  if (index < 0) throw new Error(`任务不存在: ${id}`);
  if (isReplicaFamilyMember(tasks[index]!)) {
    throw new Error('副本为原本镜像，请编辑「原本」');
  }
  if (toIndex < 0 || toIndex >= tasks.length) {
    throw new Error(`目标索引无效: ${toIndex}`);
  }
  const next = [...tasks];
  const [item] = next.splice(index, 1);
  next.splice(toIndex, 0, item);
  const settings = loadSettings();
  await writeTasks(settings, next, source);
  await emitTasksChanged('replace', source);
}

export async function updateTaskExtractTags(
  id: string,
  tags: string[],
  source: TaskWriteSource = 'api',
): Promise<PostProcessTask> {
  const normalized = normalizeExtractInjectTags(tags);
  return updateTask(id, { extractInjectTags: normalized }, source);
}

export async function updateTaskExecutionOptions(
  id: string,
  patch: TaskExecutionOptionsPatch,
  source: TaskWriteSource = 'api',
): Promise<PostProcessTask> {
  const task = getTask(id);
  if (!task) throw new Error(`任务不存在: ${id}`);
  const merged = mergeTaskExecutionOptions(task, patch);
  return updateTask(id, merged, source);
}

export type TaskApiPresetRoutingPatch = {
  primary?: string;
  fallbacks?: string[];
  primaryMaxConcurrency?: number;
  fallbackMaxConcurrencies?: number[];
};

export async function updateTaskApiPreset(
  id: string,
  presetName: string,
  source: TaskWriteSource = 'api',
): Promise<PostProcessTask> {
  return updateTaskApiPresetRouting(id, { primary: presetName }, source);
}

export async function updateTaskApiPresetRouting(
  id: string,
  patch: TaskApiPresetRoutingPatch,
  source: TaskWriteSource = 'api',
): Promise<PostProcessTask> {
  const task = getTask(id);
  if (!task) throw new Error(`任务不存在: ${id}`);
  const settings = loadSettings();
  const nextPrimary = patch.primary !== undefined ? String(patch.primary ?? '').trim() : task.apiPresetName;
  const resolvedPrimary = resolveTaskApiPreset(settings, id, nextPrimary);
  const nextFallbacks =
    patch.fallbacks !== undefined
      ? normalizeApiPresetFallbackNames(patch.fallbacks, resolvedPrimary)
      : (task.apiPresetFallbackNames ?? []);

  if (nextPrimary && !findApiPreset(settings, nextPrimary)) {
    console.warn(`[工作流助手] API 预设「${nextPrimary}」不存在，仍将写入任务配置`);
  }
  for (const name of nextFallbacks) {
    if (!findApiPreset(settings, name)) {
      console.warn(`[工作流助手] 备用 API 预设「${name}」不存在，仍将写入任务配置`);
    }
  }

  const nextPrimaryMaxConcurrency =
    patch.primaryMaxConcurrency !== undefined
      ? normalizeRouteMaxConcurrency(patch.primaryMaxConcurrency)
      : normalizeRouteMaxConcurrency(task.apiPrimaryMaxConcurrency);
  const nextFallbackMaxConcurrencies = alignFallbackMaxConcurrencies(
    nextFallbacks,
    patch.fallbackMaxConcurrencies !== undefined
      ? patch.fallbackMaxConcurrencies
      : task.apiFallbackMaxConcurrencies,
    nextPrimaryMaxConcurrency,
  );

  return updateTask(
    id,
    {
      apiPresetName: nextPrimary,
      apiPresetFallbackNames: nextFallbacks,
      apiPrimaryMaxConcurrency: nextPrimaryMaxConcurrency,
      apiFallbackMaxConcurrencies: nextFallbackMaxConcurrencies,
      ...(isReplicaFamilyMember(task) ? { apiPresetMode: 'custom' as const } : {}),
    },
    source,
  );
}

export async function updateTaskApiPresetMode(
  id: string,
  mode: ApiPresetMode,
  source: TaskWriteSource = 'api',
): Promise<PostProcessTask> {
  const task = getTask(id);
  if (!task) throw new Error(`任务不存在: ${id}`);
  if (!isReplicaFamilyMember(task)) {
    throw new Error('仅副本族成员可设置 apiPresetMode');
  }
  if (mode !== 'inheritRoot' && mode !== 'custom') {
    throw new Error(`无效的 apiPresetMode: ${mode}`);
  }

  const root = listTasks().find(t => t.id === task.replicaFamilyRootId);
  if (!root) throw new Error('副本族原本不存在');

  if (mode === 'inheritRoot') {
    // 立即写回原本路由，避免仅改 mode 后到 mirror 之间的竞态窗口
    return updateTask(
      id,
      {
        apiPresetMode: 'inheritRoot',
        ...copyApiRoutingFieldsFrom(root),
      },
      source,
    );
  }

  // 切到 custom：若尚未自定义，用原本当前路由种子初始化（与 UI 一致）
  if (task.apiPresetMode !== 'custom') {
    return updateTask(
      id,
      {
        apiPresetMode: 'custom',
        ...copyApiRoutingFieldsFrom(root),
      },
      source,
    );
  }

  return updateTask(id, { apiPresetMode: 'custom' }, source);
}

export async function addPromptGroup(
  id: string,
  group?: Partial<PromptGroup>,
  source: TaskWriteSource = 'api',
): Promise<PostProcessTask> {
  const task = getTask(id);
  if (!task) throw new Error(`任务不存在: ${id}`);
  const groups = appendPromptGroup(task.promptGroups, group);
  return updateTask(id, { promptGroups: groups }, source);
}

export async function removePromptGroup(
  id: string,
  index: number,
  source: TaskWriteSource = 'api',
): Promise<PostProcessTask> {
  const task = getTask(id);
  if (!task) throw new Error(`任务不存在: ${id}`);
  const groups = removePromptGroupAt(task.promptGroups, index);
  return updateTask(id, { promptGroups: groups }, source);
}

export async function movePromptGroup(
  id: string,
  index: number,
  delta: -1 | 1,
  source: TaskWriteSource = 'api',
): Promise<PostProcessTask> {
  const task = getTask(id);
  if (!task) throw new Error(`任务不存在: ${id}`);
  const groups = movePromptGroupAt(task.promptGroups, index, delta);
  return updateTask(id, { promptGroups: groups }, source);
}

export async function addPromptAutoSlot(
  id: string,
  order?: number,
  source: TaskWriteSource = 'api',
): Promise<PostProcessTask> {
  const task = getTask(id);
  if (!task) throw new Error(`任务不存在: ${id}`);
  const slots = appendPromptAutoSlot(task.promptAutoSlots ?? [], order);
  return updateTask(id, { promptAutoSlots: slots }, source);
}

export async function removePromptAutoSlot(
  id: string,
  slotIndex: number,
  source: TaskWriteSource = 'api',
): Promise<PostProcessTask> {
  const task = getTask(id);
  if (!task) throw new Error(`任务不存在: ${id}`);
  const result = removePromptAutoSlotAt(task.promptAutoSlots ?? [], task.promptAutoSegments ?? [], slotIndex);
  return updateTask(
    id,
    { promptAutoSlots: result.slots, promptAutoSegments: result.segments },
    source,
  );
}

export async function updatePromptAutoSlot(
  id: string,
  slotIndex: number,
  patch: Partial<PromptAutoSlot>,
  source: TaskWriteSource = 'api',
): Promise<PostProcessTask> {
  const task = getTask(id);
  if (!task) throw new Error(`任务不存在: ${id}`);
  const slots = _.cloneDeep(task.promptAutoSlots ?? []);
  if (slotIndex < 0 || slotIndex >= slots.length) {
    throw new Error(`插入位索引无效: ${slotIndex}`);
  }
  const current = slots[slotIndex]!;
  slots[slotIndex] = PromptAutoSlotSchema.parse({
    ...current,
    ...patch,
    id: current.id,
  });
  return updateTask(id, { promptAutoSlots: slots }, source);
}

export async function addPromptAutoSegment(
  id: string,
  slotId: string,
  partial?: Partial<PromptAutoSegment>,
  source: TaskWriteSource = 'api',
): Promise<PostProcessTask> {
  const task = getTask(id);
  if (!task) throw new Error(`任务不存在: ${id}`);
  if (!(task.promptAutoSlots ?? []).some(s => s.id === slotId)) {
    throw new Error(`插入位不存在: ${slotId}`);
  }
  const segments = appendPromptAutoSegment(task.promptAutoSegments ?? [], slotId, partial);
  return updateTask(id, { promptAutoSegments: segments }, source);
}

export async function removePromptAutoSegment(
  id: string,
  segmentId: string,
  source: TaskWriteSource = 'api',
): Promise<PostProcessTask> {
  const task = getTask(id);
  if (!task) throw new Error(`任务不存在: ${id}`);
  const segments = task.promptAutoSegments ?? [];
  const index = segments.findIndex(s => s.id === segmentId);
  if (index < 0) throw new Error(`自动段不存在: ${segmentId}`);
  const next = removePromptAutoSegmentAt(segments, index);
  return updateTask(id, { promptAutoSegments: next }, source);
}

export async function updatePromptAutoSegment(
  id: string,
  segmentId: string,
  patch: Partial<PromptAutoSegment>,
  source: TaskWriteSource = 'api',
): Promise<PostProcessTask> {
  const task = getTask(id);
  if (!task) throw new Error(`任务不存在: ${id}`);
  const segments = _.cloneDeep(task.promptAutoSegments ?? []);
  const index = segments.findIndex(s => s.id === segmentId);
  if (index < 0) throw new Error(`自动段不存在: ${segmentId}`);
  const current = segments[index]!;
  if (patch.slotId !== undefined && patch.slotId !== current.slotId) {
    throw new Error('不允许修改自动段所属插入位');
  }
  segments[index] = PromptAutoSegmentSchema.parse({
    ...current,
    ...patch,
    id: current.id,
    slotId: current.slotId,
  });
  return updateTask(id, { promptAutoSegments: segments }, source);
}

export function getEffectiveSettings(): ScriptSettings {
  return _.cloneDeep(resolveEffectiveSettings(loadSettings()));
}

export function getActivePresetName(): string {
  return String(getEffectiveSettings().activePresetName ?? '').trim();
}

export function validateReplicaFamily(taskId: string) {
  const task = getTask(taskId);
  if (!task) throw new Error(`任务不存在: ${taskId}`);
  return validateReplicaFamilyEligibility(task);
}

export function listReplicaFamilyMembers(rootId: string): PostProcessTask[] {
  const root = getTask(rootId);
  if (!root) throw new Error(`任务不存在: ${rootId}`);
  const members = getReplicaTasks(rootId, listTasks());
  return [root, ...members];
}

export async function setTaskEnabled(
  id: string,
  enabled: boolean,
  source: TaskWriteSource = 'api',
): Promise<PostProcessTask> {
  const tasks = listTasks();
  const task = tasks.find(t => t.id === id);
  if (!task) throw new Error(`任务不存在: ${id}`);

  if (enabled) {
    if (scanDynamicAttrPlaceholders(task).length) {
      const validation = validateReplicaFamilyEligibility(task);
      if (!validation.ok) throw new Error(validation.error);
      const enabledRoot = enableReplicaFamilyOnTask({ ...task, enabled: true });
      let next = tasks.map(t => (t.id === id ? enabledRoot : t));
      next = syncReplicaFamily(enabledRoot, [], next);
      await replaceTasks(next, source);
      return enabledRoot;
    }
    return updateTask(id, { enabled: true }, source);
  }

  if (task.syncAsReplicaFamily || task.replicaFamilyRootId) {
    const next = disableReplicaFamilyOnTasks(task, tasks);
    await replaceTasks(next, source);
    const rootId = task.replicaFamilyRootId ?? id;
    return next.find(t => t.id === rootId) ?? task;
  }

  return updateTask(id, { enabled: false }, source);
}

export async function renameTask(
  id: string,
  name: string,
  source: TaskWriteSource = 'api',
): Promise<PostProcessTask> {
  const task = getTask(id);
  if (!task) throw new Error(`任务不存在: ${id}`);
  if (isReplicaFamilyMember(task)) {
    throw new Error('副本为原本镜像，请编辑「原本」');
  }
  const normalized = String(name ?? '').trim();
  if (!normalized) {
    throw new Error('任务名称不能为空');
  }
  return updateTask(id, { name: normalized }, source);
}

export function getLastRunStatus(): ScriptSettings['lastRunStatus'] {
  return resolveLastRunStatus();
}

export function getRunStatusForFloor(
  messageId: number,
): ScriptSettings['lastRunStatus'] | null {
  return resolveRunStatusForFloor(messageId);
}

export function listApiPresetNames(): string[] {
  return loadSettings().apiPresets.map(p => p.name);
}

export function resolveTaskApiPresetName(taskId: string): string {
  const settings = loadSettings();
  const effective = resolveEffectiveSettings(settings);
  const task = effective.tasks.find(t => t.id === taskId);
  if (!task) throw new Error(`任务不存在: ${taskId}`);
  return resolveTaskApiPreset(settings, taskId, task.apiPresetName);
}

export async function resetTaskScheduleState(
  taskId?: string,
  source: TaskWriteSource = 'api',
): Promise<void> {
  const settings = loadSettings();
  if (taskId !== undefined) {
    const trimmed = taskId.trim();
    if (!trimmed) throw new Error('任务 ID 不能为空');
    delete settings.scheduleState[trimmed];
  } else {
    settings.scheduleState = {};
  }
  saveSettings(settings);
  await emitTasksChanged('schedule_reset', source, taskId?.trim());
}

export async function updateReplicaFamilyScheduleMode(
  rootId: string,
  mode: ReplicaFamilyScheduleMode,
  source: TaskWriteSource = 'api',
): Promise<PostProcessTask> {
  const task = getTask(rootId);
  if (!task) throw new Error(`任务不存在: ${rootId}`);
  if (!task.syncAsReplicaFamily) throw new Error('任务不是副本族根模板');
  return updateTask(rootId, { replicaFamilyScheduleMode: mode }, source);
}

export async function updateReplicaMemberSchedule(
  memberId: string,
  patch: { launched?: boolean },
  source: TaskWriteSource = 'api',
): Promise<PostProcessTask> {
  const member = getTask(memberId);
  if (!member) throw new Error(`任务不存在: ${memberId}`);
  if (!member.replicaFamilyRootId) throw new Error('任务不是副本族成员');
  const next: Partial<PostProcessTask> = {};
  if (patch.launched !== undefined) next.replicaFamilyLaunched = patch.launched;
  return updateTask(memberId, next, source);
}

/**
 * 确保副本族存在指定 attrValue 的成员；已存在则按需更新 launched。
 * 新建时通过 buildReplicaFromRoot 显式传入 launched，覆盖 manual 默认 true。
 */
export async function ensureReplicaFamilyMember(
  rootId: string,
  attrValue: string,
  options: { launched?: boolean } = {},
  source: TaskWriteSource = 'api',
): Promise<PostProcessTask> {
  const trimmed = normalizeReplicaAttrValue(String(attrValue ?? ''));
  if (!trimmed) throw new Error('副本属性值不能为空');

  const root = getTask(rootId);
  if (!root) throw new Error(`任务不存在: ${rootId}`);
  if (root.replicaFamilyRootId) throw new Error('任务不是副本族根模板');

  const all = listTasks();
  const existing = pickReplicaByAttrIdentity(getReplicaTasks(rootId, all), trimmed);
  if (existing) {
    if (options.launched !== undefined && existing.replicaFamilyLaunched !== options.launched) {
      return updateReplicaMemberSchedule(existing.id, { launched: options.launched }, source);
    }
    return existing;
  }

  const baseName = getReplicaFamilyBaseNameFromTask(root);
  const created = buildReplicaFromRoot(
    { ...root, syncAsReplicaFamily: true },
    trimmed,
    baseName,
    all,
    { launched: options.launched ?? false },
  );

  const rootIdx = all.findIndex(t => t.id === rootId);
  if (rootIdx === -1) throw new Error(`任务不存在: ${rootId}`);
  const memberCount = getReplicaTasks(rootId, all).length;
  const next = all.map(t => (t.id === rootId ? { ...t, syncAsReplicaFamily: true } : t));
  next.splice(rootIdx + 1 + memberCount, 0, created);
  await replaceTasks(next, source);

  const saved =
    getTask(created.id) ??
    listTasks().find(t => t.replicaFamilyRootId === rootId && (t.replicaFamilyAttrValue ?? '') === trimmed);
  if (!saved) throw new Error(`创建副本成员失败: ${trimmed}`);
  return saved;
}

export function getReplicaFamilyCleanupConfigFromStore() {
  return getReplicaFamilyCleanupConfig(loadSettings());
}

export async function updateReplicaFamilyCleanupConfigInStore(
  patch: Parameters<typeof updateReplicaFamilyCleanupConfig>[1],
  source: TaskWriteSource = 'api',
): Promise<ReturnType<typeof getReplicaFamilyCleanupConfig>> {
  const settings = loadSettings();
  const next = updateReplicaFamilyCleanupConfig(settings, patch);
  saveSettings(settings);
  await emitTasksChanged('update', source);
  return next;
}

export function listReplicaFamilyCleanupCandidatesFromStore(): ReplicaCleanupCandidateGroup[] {
  return listReplicaFamilyCleanupCandidates(loadSettings());
}

export async function applyReplicaFamilyCleanupInStore(
  keepBySpec: Record<string, string[]>,
  messageId: number,
  _source: TaskWriteSource = 'api',
): Promise<void> {
  const baseSettings = loadSettings();
  const effectiveSettings = resolveEffectiveSettings(baseSettings);
  const removedOut: RemovedReplicaCleanupInfo[] = [];
  const next = applyReplicaFamilyCleanup(effectiveSettings, keepBySpec, messageId, {
    persistManualKeepBySpec: keepBySpec,
    removedOut,
  });
  Object.assign(effectiveSettings, next);
  await persistRuntimeTaskChanges(baseSettings, effectiveSettings);
  await pruneWorldbookForRemovedReplicas(removedOut, effectiveSettings.chatWorldbookWriteRules ?? []);
}

export async function resetReplicaFamilyCleanupCycleInStore(
  source: TaskWriteSource = 'api',
): Promise<void> {
  const settings = loadSettings();
  resetReplicaFamilyCleanupCycle(settings);
  saveSettings(settings);
  await emitTasksChanged('update', source);
}

export function listReplicaFamilySchedule(rootId: string) {
  return listReplicaFamilyScheduleEntries(rootId, listTasks());
}

export function listTaskWorkflowPresets(taskId: string): string[] {
  const task = getTask(taskId);
  if (!task) throw new Error(`任务不存在: ${taskId}`);
  return listTaskWorkflowPresetNames(task);
}

export async function saveTaskWorkflowPreset(
  taskId: string,
  name: string,
  source: TaskWriteSource = 'api',
): Promise<PostProcessTask> {
  const task = getTask(taskId);
  if (!task) throw new Error(`任务不存在: ${taskId}`);
  const next = saveTaskWorkflowPresetOnTask(task, name);
  return updateTask(taskId, { taskWorkflowPresets: next.taskWorkflowPresets }, source);
}

export async function applyTaskWorkflowPreset(
  taskId: string,
  name: string,
  source: TaskWriteSource = 'api',
): Promise<PostProcessTask> {
  const settings = loadSettings();
  const tasks = listTasks();
  const index = tasks.findIndex(t => t.id === taskId);
  if (index < 0) throw new Error(`任务不存在: ${taskId}`);
  const next = applyTaskWorkflowPresetOnTask(tasks[index]!, name);
  tasks[index] = next;
  const mirrored = mirrorAllReplicaFamilies(tasks);
  await writeTasks(settings, mirrored, source);
  await emitTasksChanged('update', source, taskId);
  return mirrored.find(t => t.id === taskId) ?? next;
}

export async function deleteTaskWorkflowPreset(
  taskId: string,
  name: string,
  source: TaskWriteSource = 'api',
): Promise<PostProcessTask> {
  const task = getTask(taskId);
  if (!task) throw new Error(`任务不存在: ${taskId}`);
  const next = deleteTaskWorkflowPresetOnTask(task, name);
  return updateTask(taskId, { taskWorkflowPresets: next.taskWorkflowPresets }, source);
}
