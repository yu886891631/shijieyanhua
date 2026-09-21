import assert from 'node:assert/strict';
import type { PostProcessTask } from './schema';
import {
  applyTaskWorkflowPresetOnTask,
  applyTaskWorkflowSnapshot,
  buildTaskWorkflowSnapshot,
  exportTaskWorkflowPresetsJson,
  importTaskWorkflowPresetsFromJson,
  mergeTaskWorkflowPresetsOnTask,
  saveTaskWorkflowPresetOnTask,
} from './task-workflow-preset';

function baseTask(): PostProcessTask {
  return {
    id: 'task-1',
    name: '测试任务',
    enabled: true,
    stage: 1,
    promptGroups: [{ name: 'g1', role: 'user', content: 'hello', enabled: true }],
    extractInjectTags: ['result'],
    mergeStrategy: 'concat',
    maxRetries: 3,
    minLength: 0,
    apiPresetName: 'my-api',
    apiPresetFallbackNames: ['fb1'],
    apiPrimaryMaxConcurrency: 2,
    apiFallbackMaxConcurrencies: [1],
    plotWorldbookMode: 'inherit',
    contextMode: 'inherit',
    structuredOutputMode: 'off',
    replicaFamilyScheduleMode: 'manual',
    taskWorkflowPresets: [],
  };
}

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`, e);
    process.exitCode = 1;
  }
}

test('snapshot excludes API fields, identity and replica schedule', () => {
  const task = baseTask();
  const snap = buildTaskWorkflowSnapshot(task);
  assert.equal((snap as Record<string, unknown>).apiPresetName, undefined);
  assert.equal((snap as Record<string, unknown>).id, undefined);
  assert.equal((snap as Record<string, unknown>).taskWorkflowPresets, undefined);
  assert.equal((snap as Record<string, unknown>).replicaFamilyScheduleMode, undefined);
  assert.equal(snap.promptGroups?.[0]?.content, 'hello');
});

test('snapshot includes recommendedModel and apply restores it', () => {
  const task = { ...baseTask(), recommendedModel: 'deepseek-chat' };
  const snap = buildTaskWorkflowSnapshot(task);
  assert.equal(snap.recommendedModel, 'deepseek-chat');

  const target = { ...baseTask(), recommendedModel: '' };
  const applied = applyTaskWorkflowSnapshot(target, snap);
  assert.equal(applied.recommendedModel, 'deepseek-chat');
  assert.equal(applied.apiPresetName, 'my-api');
});

test('apply preset keeps API fields, id and replica schedule mode', () => {
  const task = baseTask();
  const saved = saveTaskWorkflowPresetOnTask(task, 'v1');
  const modified = {
    ...saved,
    stage: 9,
    replicaFamilyScheduleMode: 'auto' as const,
    apiPresetName: 'changed-api',
    promptGroups: [{ name: 'g1', role: 'user', content: 'changed', enabled: true }],
  };
  const restored = applyTaskWorkflowPresetOnTask(modified, 'v1');
  assert.equal(restored.id, 'task-1');
  assert.equal(restored.apiPresetName, 'changed-api');
  assert.equal(restored.apiPresetFallbackNames?.[0], 'fb1');
  assert.equal(restored.apiPrimaryMaxConcurrency, 2);
  assert.equal(restored.stage, 1);
  assert.equal(restored.replicaFamilyScheduleMode, 'auto');
  assert.equal(restored.promptGroups?.[0]?.content, 'hello');
});

test('export and import round-trip', () => {
  const task = baseTask();
  const saved = saveTaskWorkflowPresetOnTask(task, 'v1');
  const json = exportTaskWorkflowPresetsJson(saved, 'v1');
  const imported = importTaskWorkflowPresetsFromJson(baseTask(), JSON.parse(json));
  assert.equal(imported.taskWorkflowPresets?.length, 1);
  assert.equal(imported.taskWorkflowPresets?.[0]?.name, 'v1');
  assert.equal(imported.taskWorkflowPresets?.[0]?.snapshot.stage, 1);
});

test('merge presets overwrites same name', () => {
  const task = saveTaskWorkflowPresetOnTask(baseTask(), 'v1');
  const entry = task.taskWorkflowPresets![0]!;
  const updated = {
    ...entry,
    snapshot: { ...entry.snapshot, stage: 5 },
  };
  const merged = mergeTaskWorkflowPresetsOnTask(task, [updated]);
  assert.equal(merged.taskWorkflowPresets?.length, 1);
  assert.equal(merged.taskWorkflowPresets?.[0]?.snapshot.stage, 5);
});

if (process.exitCode) process.exit(process.exitCode);
