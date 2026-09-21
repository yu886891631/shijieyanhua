import {
  addPromptAutoSegment,
  addPromptAutoSlot,
  addPromptGroup,
  clearChatScope,
  createTask,
  deleteTask,
  duplicateTask,
  getActivePresetName,
  getChatScopeState,
  getEffectiveSettings,
  getLastRunStatus,
  getRunStatusForFloor,
  getTask,
  listApiPresetNames,
  listReplicaFamilyMembers,
  listTasks,
  movePromptGroup,
  moveTask,
  moveTaskToIndex,
  promoteChatScopeToPreset,
  removePromptAutoSegment,
  removePromptAutoSlot,
  removePromptGroup,
  renameTask,
  replaceTasks,
  resetTaskScheduleState,
  resolveTaskApiPresetName,
  saveChatSnapshotAsGlobalPreset,
  setChatScopeActiveView,
  setTaskEnabled,
  updatePresetFields,
  updatePromptAutoSegment,
  updatePromptAutoSlot,
  updatePromptGroup,
  updateTask,
  updateTaskApiPreset,
  updateTaskApiPresetRouting,
  updateTaskApiPresetMode,
  updateTaskContext,
  updateTaskExecutionOptions,
  updateTaskExtractTags,
  updateTaskPlotWorldbook,
  updateTaskSchedule,
  updateTaskStage,
  updateReplicaFamilyScheduleMode,
  updateReplicaMemberSchedule,
  ensureReplicaFamilyMember,
  listReplicaFamilySchedule,
  getReplicaFamilyCleanupConfigFromStore,
  updateReplicaFamilyCleanupConfigInStore,
  listReplicaFamilyCleanupCandidatesFromStore,
  applyReplicaFamilyCleanupInStore,
  resetReplicaFamilyCleanupCycleInStore,
  listTaskWorkflowPresets,
  saveTaskWorkflowPreset,
  applyTaskWorkflowPreset,
  deleteTaskWorkflowPreset,
  validateReplicaFamily,
  type PresetFieldsPatch,
  type TaskApiPresetRoutingPatch,
  type TaskExecutionOptionsPatch,
  type TaskSchedulePatch,
  type TaskWriteSource,
} from '../tasks/task-store';
import { buildEffectivePromptGroups } from '../tasks/prompt-auto-segments';
import { rerunCurrentFloor, triggerTask, type TriggerTaskOptions } from '../tasks/trigger';
import {
  getLastPromptMessages,
  getLastPlaceholderVars,
} from '../tasks/runtime';
import { sanitizeSettingsForExternalApi } from '../settings-security';
import type {
  ApiPresetMode,
  ChatTaskScopeState,
  PlotWorldbookConfig,
  PlotWorldbookMode,
  PostProcessTask,
  ReplicaFamilyScheduleMode,
  ScriptSettings,
  TaskContextConfig,
} from '../tasks/schema';
import type { ReplicaCleanupCandidateGroup } from '../tasks/replica-family-cleanup';
import { PromptAutoSegmentSchema, PromptAutoSlotSchema, PromptGroupSchema } from '../tasks/schema';
import type { z } from 'zod';

type PromptGroup = z.infer<typeof PromptGroupSchema>;
export type PromptAutoSlotPatch = Partial<z.infer<typeof PromptAutoSlotSchema>>;
export type PromptAutoSegmentPatch = Partial<z.infer<typeof PromptAutoSegmentSchema>>;

export type { TaskExecutionOptionsPatch, TaskSchedulePatch, TaskApiPresetRoutingPatch, TriggerTaskOptions };

export interface AcuPostProcessTaskAPI {
  listTasks(): PostProcessTask[];
  getTask(id: string): PostProcessTask | null;
  createTask(input?: Partial<PostProcessTask>): Promise<PostProcessTask>;
  updateTask(id: string, patch: Partial<PostProcessTask>): Promise<PostProcessTask>;
  deleteTask(id: string): Promise<boolean>;
  replaceTasks(tasks: PostProcessTask[]): Promise<void>;
  getChatScopeState(): ChatTaskScopeState | null;
  clearChatScope(): Promise<void>;
  promoteChatScopeToPreset(name?: string): Promise<string | null>;
  saveChatSnapshotAsGlobalPreset(name?: string): Promise<string | null>;
  setChatScopeActiveView(
    input: { view: 'snapshot' } | { view: 'global'; presetName: string },
  ): Promise<ChatTaskScopeState | null>;
  updatePresetFields(fields: PresetFieldsPatch): Promise<void>;
  updateTaskPlotWorldbook(
    taskId: string,
    input: { mode?: PlotWorldbookMode; config?: PlotWorldbookConfig },
  ): Promise<PostProcessTask>;
  updateTaskContext(
    taskId: string,
    input: { mode?: 'inherit' | 'custom'; config?: TaskContextConfig },
  ): Promise<PostProcessTask>;
  updatePromptGroup(taskId: string, index: number, patch: Partial<PromptGroup>): Promise<PostProcessTask>;
  updateTaskStage(taskId: string, stage: number): Promise<PostProcessTask>;
  updateTaskSchedule(taskId: string, patch: TaskSchedulePatch): Promise<PostProcessTask>;
  updateTaskExtractTags(taskId: string, tags: string[]): Promise<PostProcessTask>;
  updateTaskExecutionOptions(taskId: string, patch: TaskExecutionOptionsPatch): Promise<PostProcessTask>;
  updateTaskApiPreset(taskId: string, presetName: string): Promise<PostProcessTask>;
  updateTaskApiPresetRouting(taskId: string, patch: TaskApiPresetRoutingPatch): Promise<PostProcessTask>;
  updateTaskApiPresetMode(taskId: string, mode: ApiPresetMode): Promise<PostProcessTask>;
  addPromptGroup(taskId: string, group?: Partial<PromptGroup>): Promise<PostProcessTask>;
  removePromptGroup(taskId: string, index: number): Promise<PostProcessTask>;
  movePromptGroup(taskId: string, index: number, delta: -1 | 1): Promise<PostProcessTask>;
  addPromptAutoSlot(taskId: string, order?: number): Promise<PostProcessTask>;
  removePromptAutoSlot(taskId: string, slotIndex: number): Promise<PostProcessTask>;
  updatePromptAutoSlot(taskId: string, slotIndex: number, patch: PromptAutoSlotPatch): Promise<PostProcessTask>;
  addPromptAutoSegment(taskId: string, slotId: string, partial?: PromptAutoSegmentPatch): Promise<PostProcessTask>;
  removePromptAutoSegment(taskId: string, segmentId: string): Promise<PostProcessTask>;
  updatePromptAutoSegment(
    taskId: string,
    segmentId: string,
    patch: PromptAutoSegmentPatch,
  ): Promise<PostProcessTask>;
  setTaskEnabled(taskId: string, enabled: boolean): Promise<PostProcessTask>;
  renameTask(taskId: string, name: string): Promise<PostProcessTask>;
  duplicateTask(taskId: string, options?: { afterTaskId?: string }): Promise<PostProcessTask>;
  moveTask(taskId: string, delta: -1 | 1): Promise<void>;
  moveTaskToIndex(taskId: string, toIndex: number): Promise<void>;
  rerunCurrentFloor(): Promise<void>;
  triggerTask(taskId: string, options?: TriggerTaskOptions): Promise<void>;
  getEffectiveSettings(): ScriptSettings;
  getActivePresetName(): string;
  getLastPromptMessages(): ReturnType<typeof getLastPromptMessages>;
  getLastPlaceholderVars(): ReturnType<typeof getLastPlaceholderVars>;
  buildEffectivePromptGroups(taskId: string): PromptGroup[];
  validateReplicaFamily(taskId: string): ReturnType<typeof validateReplicaFamily>;
  listReplicaFamilyMembers(rootId: string): PostProcessTask[];
  updateReplicaFamilyScheduleMode(rootId: string, mode: ReplicaFamilyScheduleMode): Promise<PostProcessTask>;
  updateReplicaMemberSchedule(
    memberId: string,
    patch: { launched?: boolean },
  ): Promise<PostProcessTask>;
  ensureReplicaFamilyMember(
    rootId: string,
    attrValue: string,
    options?: { launched?: boolean },
  ): Promise<PostProcessTask>;
  listReplicaFamilySchedule(rootId: string): ReturnType<typeof listReplicaFamilySchedule>;
  getReplicaFamilyCleanupConfig(): ReturnType<typeof getReplicaFamilyCleanupConfigFromStore>;
  updateReplicaFamilyCleanupConfig(
    patch: Partial<ScriptSettings['replicaFamilyCleanup']>,
  ): ReturnType<typeof updateReplicaFamilyCleanupConfigInStore>;
  listReplicaFamilyCleanupCandidates(): ReplicaCleanupCandidateGroup[];
  applyReplicaFamilyCleanup(keepBySpec: Record<string, string[]>, messageId?: number): Promise<void>;
  resetReplicaFamilyCleanupCycle(): Promise<void>;
  listTaskWorkflowPresets(taskId: string): string[];
  saveTaskWorkflowPreset(taskId: string, name: string): Promise<PostProcessTask>;
  applyTaskWorkflowPreset(taskId: string, name: string): Promise<PostProcessTask>;
  deleteTaskWorkflowPreset(taskId: string, name: string): Promise<PostProcessTask>;
  getLastRunStatus(): ReturnType<typeof getLastRunStatus>;
  getRunStatusForFloor(messageId: number): ReturnType<typeof getRunStatusForFloor>;
  listApiPresets(): string[];
  resolveTaskApiPresetName(taskId: string): string;
  resetTaskScheduleState(taskId?: string): Promise<void>;
}

function apiCall<T>(fn: (source: TaskWriteSource) => T | Promise<T>): T | Promise<T> {
  return fn('api');
}

export const acuPostProcessTaskApi: AcuPostProcessTaskAPI = {
  listTasks: () => listTasks(),
  getTask: (id: string) => getTask(id),
  createTask: (input?: Partial<PostProcessTask>) => apiCall(() => createTask(input, 'api')) as Promise<PostProcessTask>,
  updateTask: (id: string, patch: Partial<PostProcessTask>) =>
    apiCall(() => updateTask(id, patch, 'api')) as Promise<PostProcessTask>,
  deleteTask: (id: string) => apiCall(() => deleteTask(id, 'api')) as Promise<boolean>,
  replaceTasks: (tasks: PostProcessTask[]) => apiCall(() => replaceTasks(tasks, 'api')) as Promise<void>,
  getChatScopeState: () => getChatScopeState(),
  clearChatScope: () => apiCall(() => clearChatScope('api')) as Promise<void>,
  promoteChatScopeToPreset: (name?: string) =>
    apiCall(() => promoteChatScopeToPreset(name)) as Promise<string | null>,
  saveChatSnapshotAsGlobalPreset: (name?: string) =>
    apiCall(() => saveChatSnapshotAsGlobalPreset(name)) as Promise<string | null>,
  setChatScopeActiveView: input =>
    apiCall(() => setChatScopeActiveView(input)) as Promise<ChatTaskScopeState | null>,
  updatePresetFields: (fields: PresetFieldsPatch) =>
    apiCall(() => updatePresetFields(fields, 'api')) as Promise<void>,
  updateTaskPlotWorldbook: (taskId, input) =>
    apiCall(() => updateTaskPlotWorldbook(taskId, input, 'api')) as Promise<PostProcessTask>,
  updateTaskContext: (taskId, input) =>
    apiCall(() => updateTaskContext(taskId, input, 'api')) as Promise<PostProcessTask>,
  updatePromptGroup: (taskId, index, patch) =>
    apiCall(() => updatePromptGroup(taskId, index, patch, 'api')) as Promise<PostProcessTask>,
  updateTaskStage: (taskId, stage) =>
    apiCall(() => updateTaskStage(taskId, stage, 'api')) as Promise<PostProcessTask>,
  updateTaskSchedule: (taskId, patch) =>
    apiCall(() => updateTaskSchedule(taskId, patch, 'api')) as Promise<PostProcessTask>,
  updateTaskExtractTags: (taskId, tags) =>
    apiCall(() => updateTaskExtractTags(taskId, tags, 'api')) as Promise<PostProcessTask>,
  updateTaskExecutionOptions: (taskId, patch) =>
    apiCall(() => updateTaskExecutionOptions(taskId, patch, 'api')) as Promise<PostProcessTask>,
  updateTaskApiPreset: (taskId, presetName) =>
    apiCall(() => updateTaskApiPreset(taskId, presetName, 'api')) as Promise<PostProcessTask>,
  updateTaskApiPresetRouting: (taskId, patch) =>
    apiCall(() => updateTaskApiPresetRouting(taskId, patch, 'api')) as Promise<PostProcessTask>,
  updateTaskApiPresetMode: (taskId, mode) =>
    apiCall(() => updateTaskApiPresetMode(taskId, mode, 'api')) as Promise<PostProcessTask>,
  addPromptGroup: (taskId, group) =>
    apiCall(() => addPromptGroup(taskId, group, 'api')) as Promise<PostProcessTask>,
  removePromptGroup: (taskId, index) =>
    apiCall(() => removePromptGroup(taskId, index, 'api')) as Promise<PostProcessTask>,
  movePromptGroup: (taskId, index, delta) =>
    apiCall(() => movePromptGroup(taskId, index, delta, 'api')) as Promise<PostProcessTask>,
  addPromptAutoSlot: (taskId, order) =>
    apiCall(() => addPromptAutoSlot(taskId, order, 'api')) as Promise<PostProcessTask>,
  removePromptAutoSlot: (taskId, slotIndex) =>
    apiCall(() => removePromptAutoSlot(taskId, slotIndex, 'api')) as Promise<PostProcessTask>,
  updatePromptAutoSlot: (taskId, slotIndex, patch) =>
    apiCall(() => updatePromptAutoSlot(taskId, slotIndex, patch, 'api')) as Promise<PostProcessTask>,
  addPromptAutoSegment: (taskId, slotId, partial) =>
    apiCall(() => addPromptAutoSegment(taskId, slotId, partial, 'api')) as Promise<PostProcessTask>,
  removePromptAutoSegment: (taskId, segmentId) =>
    apiCall(() => removePromptAutoSegment(taskId, segmentId, 'api')) as Promise<PostProcessTask>,
  updatePromptAutoSegment: (taskId, segmentId, patch) =>
    apiCall(() => updatePromptAutoSegment(taskId, segmentId, patch, 'api')) as Promise<PostProcessTask>,
  setTaskEnabled: (taskId, enabled) =>
    apiCall(() => setTaskEnabled(taskId, enabled, 'api')) as Promise<PostProcessTask>,
  renameTask: (taskId, name) => apiCall(() => renameTask(taskId, name, 'api')) as Promise<PostProcessTask>,
  duplicateTask: (taskId, options) =>
    apiCall(() => duplicateTask(taskId, options, 'api')) as Promise<PostProcessTask>,
  moveTask: (taskId, delta) => apiCall(() => moveTask(taskId, delta, 'api')) as Promise<void>,
  moveTaskToIndex: (taskId, toIndex) =>
    apiCall(() => moveTaskToIndex(taskId, toIndex, 'api')) as Promise<void>,
  rerunCurrentFloor: () => rerunCurrentFloor(),
  triggerTask: (taskId, options) => triggerTask(taskId, options),
  getEffectiveSettings: () => sanitizeSettingsForExternalApi(getEffectiveSettings()),
  getActivePresetName: () => getActivePresetName(),
  getLastPromptMessages: () => getLastPromptMessages(),
  getLastPlaceholderVars: () => getLastPlaceholderVars(),
  buildEffectivePromptGroups: (taskId: string) => {
    const task = getTask(taskId);
    if (!task) throw new Error(`任务不存在: ${taskId}`);
    return buildEffectivePromptGroups(task);
  },
  validateReplicaFamily: (taskId: string) => validateReplicaFamily(taskId),
  listReplicaFamilyMembers: (rootId: string) => listReplicaFamilyMembers(rootId),
  updateReplicaFamilyScheduleMode: (rootId, mode) =>
    apiCall(() => updateReplicaFamilyScheduleMode(rootId, mode, 'api')) as Promise<PostProcessTask>,
  updateReplicaMemberSchedule: (memberId, patch) =>
    apiCall(() => updateReplicaMemberSchedule(memberId, patch, 'api')) as Promise<PostProcessTask>,
  ensureReplicaFamilyMember: (rootId, attrValue, options) =>
    apiCall(() => ensureReplicaFamilyMember(rootId, attrValue, options, 'api')) as Promise<PostProcessTask>,
  listReplicaFamilySchedule: (rootId: string) => listReplicaFamilySchedule(rootId),
  getReplicaFamilyCleanupConfig: () => getReplicaFamilyCleanupConfigFromStore(),
  updateReplicaFamilyCleanupConfig: patch =>
    apiCall(() => updateReplicaFamilyCleanupConfigInStore(patch, 'api')) as ReturnType<
      typeof updateReplicaFamilyCleanupConfigInStore
    >,
  listReplicaFamilyCleanupCandidates: () => listReplicaFamilyCleanupCandidatesFromStore(),
  applyReplicaFamilyCleanup: (keepBySpec, messageId) =>
    apiCall(() =>
      applyReplicaFamilyCleanupInStore(keepBySpec, messageId ?? getLastMessageId(), 'api'),
    ) as Promise<void>,
  resetReplicaFamilyCleanupCycle: () =>
    apiCall(() => resetReplicaFamilyCleanupCycleInStore('api')) as Promise<void>,
  listTaskWorkflowPresets: (taskId: string) => listTaskWorkflowPresets(taskId),
  saveTaskWorkflowPreset: (taskId, name) =>
    apiCall(() => saveTaskWorkflowPreset(taskId, name, 'api')) as Promise<PostProcessTask>,
  applyTaskWorkflowPreset: (taskId, name) =>
    apiCall(() => applyTaskWorkflowPreset(taskId, name, 'api')) as Promise<PostProcessTask>,
  deleteTaskWorkflowPreset: (taskId, name) =>
    apiCall(() => deleteTaskWorkflowPreset(taskId, name, 'api')) as Promise<PostProcessTask>,
  getLastRunStatus: () => getLastRunStatus(),
  getRunStatusForFloor: (messageId: number) => getRunStatusForFloor(messageId),
  listApiPresets: () => listApiPresetNames(),
  resolveTaskApiPresetName: (taskId: string) => resolveTaskApiPresetName(taskId),
  resetTaskScheduleState: (taskId?: string) =>
    apiCall(() => resetTaskScheduleState(taskId, 'api')) as Promise<void>,
};

export function mountAcuPostProcessAPI(): void {
  try {
    (window.parent as Window & { AcuPostProcessAPI?: AcuPostProcessTaskAPI }).AcuPostProcessAPI =
      acuPostProcessTaskApi;
  } catch (error) {
    console.warn('[工作流助手] 挂载 AcuPostProcessAPI 失败:', error);
  }
  (window as unknown as Record<string, unknown>).__acuPpTaskApi = acuPostProcessTaskApi;
}
