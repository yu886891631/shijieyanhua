import { z } from 'zod';
import {
  TaskWorkflowPresetEntrySchema,
  TaskWorkflowPresetSnapshotSchema,
  type PostProcessTask,
  type TaskWorkflowPresetEntry,
  type TaskWorkflowPresetSnapshot,
} from './schema';

const API_FIELDS = [
  'apiPresetName',
  'apiPresetFallbackNames',
  'apiPrimaryMaxConcurrency',
  'apiFallbackMaxConcurrencies',
] as const;

const IDENTITY_FIELDS = [
  'id',
  'replicaFamilyRootId',
  'replicaFamilyAttrValue',
  'syncAsReplicaFamily',
] as const;

const REPLICA_SCHEDULE_FIELDS = [
  'replicaFamilyScheduleMode',
  'replicaFamilyLaunched',
] as const;

export function buildTaskWorkflowSnapshot(task: PostProcessTask): TaskWorkflowPresetSnapshot {
  const raw = structuredClone(task) as Record<string, unknown>;
  for (const key of [...API_FIELDS, ...IDENTITY_FIELDS, ...REPLICA_SCHEDULE_FIELDS, 'taskWorkflowPresets']) {
    delete raw[key];
  }
  return TaskWorkflowPresetSnapshotSchema.parse(raw);
}

export function applyTaskWorkflowSnapshot(task: PostProcessTask, snapshot: TaskWorkflowPresetSnapshot): PostProcessTask {
  const parsed = TaskWorkflowPresetSnapshotSchema.parse(snapshot);
  const apiPreserve = {
    apiPresetName: task.apiPresetName,
    apiPresetFallbackNames: task.apiPresetFallbackNames,
    apiPrimaryMaxConcurrency: task.apiPrimaryMaxConcurrency,
    apiFallbackMaxConcurrencies: task.apiFallbackMaxConcurrencies,
  };
  const schedulePreserve = {
    replicaFamilyScheduleMode: task.replicaFamilyScheduleMode,
    replicaFamilyLaunched: task.replicaFamilyLaunched,
  };
  return {
    ...task,
    ...parsed,
    id: task.id,
    syncAsReplicaFamily: task.syncAsReplicaFamily,
    replicaFamilyRootId: task.replicaFamilyRootId,
    replicaFamilyAttrValue: task.replicaFamilyAttrValue,
    taskWorkflowPresets: task.taskWorkflowPresets ?? [],
    ...apiPreserve,
    ...schedulePreserve,
  };
}

export function listTaskWorkflowPresetNames(task: PostProcessTask): string[] {
  return (task.taskWorkflowPresets ?? []).map(p => p.name);
}

export function saveTaskWorkflowPresetOnTask(task: PostProcessTask, name: string): PostProcessTask {
  const trimmed = String(name ?? '').trim();
  if (!trimmed) throw new Error('工作流预设名称不能为空');
  const snapshot = buildTaskWorkflowSnapshot(task);
  const entry: TaskWorkflowPresetEntry = {
    name: trimmed,
    savedAt: Date.now(),
    snapshot,
  };
  const presets = [...(task.taskWorkflowPresets ?? [])];
  const idx = presets.findIndex(p => p.name === trimmed);
  if (idx >= 0) presets[idx] = entry;
  else presets.push(entry);
  return { ...task, taskWorkflowPresets: presets };
}

export function applyTaskWorkflowPresetOnTask(task: PostProcessTask, name: string): PostProcessTask {
  const trimmed = String(name ?? '').trim();
  const entry = (task.taskWorkflowPresets ?? []).find(p => p.name === trimmed);
  if (!entry) throw new Error(`工作流预设不存在: ${trimmed}`);
  return applyTaskWorkflowSnapshot(task, entry.snapshot);
}

export function deleteTaskWorkflowPresetOnTask(task: PostProcessTask, name: string): PostProcessTask {
  const trimmed = String(name ?? '').trim();
  const presets = (task.taskWorkflowPresets ?? []).filter(p => p.name !== trimmed);
  if (presets.length === (task.taskWorkflowPresets ?? []).length) {
    throw new Error(`工作流预设不存在: ${trimmed}`);
  }
  return { ...task, taskWorkflowPresets: presets };
}

export const TaskWorkflowPresetsExportSchema = z.object({
  kind: z.literal('task-workflow-presets'),
  version: z.literal(1),
  taskName: z.string().optional(),
  presets: z.array(TaskWorkflowPresetEntrySchema).min(1),
});

export type TaskWorkflowPresetsExport = z.infer<typeof TaskWorkflowPresetsExportSchema>;

export function exportTaskWorkflowPresetsJson(task: PostProcessTask, name?: string): string {
  const trimmed = String(name ?? '').trim();
  const all = task.taskWorkflowPresets ?? [];
  const presets = trimmed
    ? all.filter(p => p.name === trimmed).map(p => TaskWorkflowPresetEntrySchema.parse(p))
    : all.map(p => TaskWorkflowPresetEntrySchema.parse(p));
  if (!presets.length) {
    throw new Error(trimmed ? `工作流预设不存在: ${trimmed}` : '当前任务没有可导出的工作流预设');
  }
  const payload: TaskWorkflowPresetsExport = {
    kind: 'task-workflow-presets',
    version: 1,
    taskName: task.name,
    presets,
  };
  return JSON.stringify(payload, null, 2);
}

function parsePresetEntries(raw: unknown): TaskWorkflowPresetEntry[] {
  const exportParsed = TaskWorkflowPresetsExportSchema.safeParse(raw);
  if (exportParsed.success) {
    return exportParsed.data.presets;
  }
  const single = TaskWorkflowPresetEntrySchema.safeParse(raw);
  if (single.success) return [single.data];
  if (Array.isArray(raw)) {
    const entries = raw.map(item => TaskWorkflowPresetEntrySchema.parse(item));
    if (entries.length) return entries;
  }
  throw new Error('无法识别的工作流预设 JSON 格式');
}

export function parseImportedTaskWorkflowPresets(raw: unknown): TaskWorkflowPresetEntry[] {
  return parsePresetEntries(raw);
}

export function importTaskWorkflowPresetsFromJson(
  task: PostProcessTask,
  raw: unknown,
  _fileName?: string,
): PostProcessTask {
  const entries = parsePresetEntries(raw);
  return mergeTaskWorkflowPresetsOnTask(task, entries);
}

export function mergeTaskWorkflowPresetsOnTask(
  task: PostProcessTask,
  entries: TaskWorkflowPresetEntry[],
): PostProcessTask {
  const presets = [...(task.taskWorkflowPresets ?? [])];
  for (const entry of entries) {
    const parsed = TaskWorkflowPresetEntrySchema.parse(entry);
    const idx = presets.findIndex(p => p.name === parsed.name);
    if (idx >= 0) presets[idx] = parsed;
    else presets.push(parsed);
  }
  return { ...task, taskWorkflowPresets: presets };
}
