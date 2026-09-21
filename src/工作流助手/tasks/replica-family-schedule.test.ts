import assert from 'node:assert/strict';
import type { PostProcessTask } from './schema';
import { ENUM_REGISTRY_MARKER } from './replica-enum-parse';
import {
  buildReplicaFromRoot,
  mergeReplicaFamilyFromRelay,
  prepareStageTasksWithReplicaSync,
  resetNewlyCreatedReplicaLaunched,
  shouldRunReplicaAtRuntime,
} from './replica-family';

function baseTask(overrides: Partial<PostProcessTask> = {}): PostProcessTask {
  return {
    id: 'root-1',
    name: '处理 item',
    enabled: true,
    stage: 2,
    promptGroups: [{ name: '', role: 'user', content: 'do {{item@id}}', enabled: true }],
    extractInjectTags: ['item@id'],
    mergeStrategy: 'concat',
    maxRetries: 3,
    minLength: 0,
    apiPresetName: 'primary',
    apiPresetFallbackNames: [],
    plotWorldbookMode: 'inherit',
    contextMode: 'inherit',
    structuredOutputMode: 'off',
    syncAsReplicaFamily: true,
    replicaFamilySpec: 'item@id',
    replicaFamilyEnumSpec: 'item@id',
    replicaFamilyScheduleMode: 'auto',
    ...overrides,
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

test('auto mode shouldRunReplicaAtRuntime returns true for any replica', () => {
  const root = baseTask({ replicaFamilyScheduleMode: 'auto' });
  const rep = buildReplicaFromRoot(root, '1', '处理 item', [root]);
  assert.equal(shouldRunReplicaAtRuntime(rep, root), true);
});

test('manual mode requires launched', () => {
  const root = baseTask({ replicaFamilyScheduleMode: 'manual' });
  const rep = buildReplicaFromRoot(root, '1', '处理 item', [root], { launched: false });
  assert.equal(shouldRunReplicaAtRuntime(rep, root), false);
  const launched = { ...rep, replicaFamilyLaunched: true };
  assert.equal(shouldRunReplicaAtRuntime(launched, root), true);
});

test('merge preserves all orphans when relay shrinks', () => {
  const root = baseTask();
  let merged = mergeReplicaFamilyFromRelay(root, ['1', '2'], [root]);
  let tasks = merged.tasks;
  merged = mergeReplicaFamilyFromRelay(root, ['1'], tasks);
  tasks = merged.tasks;
  assert.ok(tasks.some(t => t.replicaFamilyAttrValue === '2'));
  assert.equal(tasks.filter(t => t.replicaFamilyRootId === root.id).length, 2);
});

test('merge only adds missing attr without duplicating existing', () => {
  const root = baseTask();
  let merged = mergeReplicaFamilyFromRelay(root, ['1'], [root]);
  const firstId = merged.tasks.find(t => t.replicaFamilyAttrValue === '1')!.id;
  merged = mergeReplicaFamilyFromRelay(root, ['1', '2'], merged.tasks);
  const same = merged.tasks.find(t => t.replicaFamilyAttrValue === '1')!;
  assert.equal(same.id, firstId);
  assert.ok(merged.tasks.some(t => t.replicaFamilyAttrValue === '2'));
  assert.equal(merged.newlyCreatedIds.length, 1);
});

test('manual new synced replicas default launched true', () => {
  const root = baseTask({ replicaFamilyScheduleMode: 'manual' });
  const merged = mergeReplicaFamilyFromRelay(root, ['9'], [root]);
  const rep = merged.tasks.find(t => t.replicaFamilyAttrValue === '9')!;
  assert.equal(rep.replicaFamilyLaunched, true);
});

test('auto new synced replicas default launched false', () => {
  const root = baseTask({ replicaFamilyScheduleMode: 'auto' });
  const merged = mergeReplicaFamilyFromRelay(root, ['9'], [root]);
  const rep = merged.tasks.find(t => t.replicaFamilyAttrValue === '9')!;
  assert.equal(rep.replicaFamilyLaunched, false);
});

function relayMap(entries: Record<string, string>) {
  return new Map(Object.entries(entries).map(([k, v]) => [k, [v]]));
}

test('prepareStageTasksWithReplicaSync manual filters by launched only', () => {
  const root = baseTask({ replicaFamilyScheduleMode: 'manual' });
  let merged = mergeReplicaFamilyFromRelay(root, ['1', '2'], [root]);
  let tasks = merged.tasks;
  const rep1 = tasks.find(t => t.replicaFamilyAttrValue === '1')!;
  tasks = tasks.map(t => {
    if (t.id === rep1.id) return { ...t, replicaFamilyLaunched: true };
    return { ...t, replicaFamilyLaunched: false };
  });
  const relay = relayMap({
    'item@id=1': ENUM_REGISTRY_MARKER,
    'item@id=2': ENUM_REGISTRY_MARKER,
  });
  const { tasks: runtime } = prepareStageTasksWithReplicaSync([root], tasks, relay);
  assert.equal(runtime.length, 1);
  assert.equal(runtime[0]!.replicaFamilyAttrValue, '1');
});

test('prepareStageTasksWithReplicaSync auto runs only relay replicas', () => {
  const root = baseTask({ replicaFamilyScheduleMode: 'auto' });
  let merged = mergeReplicaFamilyFromRelay(root, ['1', '2', '3'], [root]);
  const relay = relayMap({
    'item@id=1': ENUM_REGISTRY_MARKER,
    'item@id=2': ENUM_REGISTRY_MARKER,
  });
  const { tasks: runtime } = prepareStageTasksWithReplicaSync([root], merged.tasks, relay);
  assert.equal(runtime.length, 2);
  assert.ok(runtime.every(r => ['1', '2'].includes(r.replicaFamilyAttrValue ?? '')));
});

test('prepareStageTasksWithReplicaSync auto runs only current-round relay markers', () => {
  const root = baseTask({ replicaFamilyScheduleMode: 'auto' });
  const merged = mergeReplicaFamilyFromRelay(root, ['1', '2'], [root]);
  const { tasks: runtime, skippedRoots } = prepareStageTasksWithReplicaSync(
    [root],
    merged.tasks,
    relayMap({
      'item@id=1': ENUM_REGISTRY_MARKER,
    }),
  );
  assert.equal(skippedRoots.length, 0);
  assert.equal(runtime.length, 1);
  assert.equal(runtime[0]!.replicaFamilyAttrValue, '1');
});

test('prepareStageTasksWithReplicaSync auto skips when relay empty (no lastEnum fallback)', () => {
  const root = baseTask({ replicaFamilyScheduleMode: 'auto' });
  const merged = mergeReplicaFamilyFromRelay(root, ['1', '2'], [root]);
  const { tasks: runtime, skippedRoots } = prepareStageTasksWithReplicaSync(
    [root],
    merged.tasks,
    new Map(),
  );
  assert.equal(runtime.length, 0);
  assert.equal(skippedRoots.length, 1);
  assert.equal(skippedRoots[0]!.root.id, root.id);
  assert.equal(skippedRoots[0]!.skipReason, '副本族：上一阶段 relay 无可用属性实例');
});

test('prepareStageTasksWithReplicaSync manual skip reason when none launched', () => {
  const root = baseTask({ replicaFamilyScheduleMode: 'manual' });
  let tasks = mergeReplicaFamilyFromRelay(root, ['阿斯塔利亚'], [root]).tasks;
  tasks = tasks.map(t =>
    t.replicaFamilyAttrValue === '阿斯塔利亚' ? { ...t, replicaFamilyLaunched: false } : t,
  );
  const { tasks: runtime, skippedRoots } = prepareStageTasksWithReplicaSync([root], tasks, new Map());
  assert.equal(runtime.length, 0);
  assert.equal(skippedRoots.length, 1);
  assert.equal(skippedRoots[0]!.skipReason, '副本族：手动调度下无已启动副本');
});

test('prepareStageTasksWithReplicaSync manual keeps launched orphans without relay', () => {
  const root = baseTask({ replicaFamilyScheduleMode: 'manual' });
  let tasks = mergeReplicaFamilyFromRelay(root, ['阿斯塔利亚'], [root]).tasks;
  tasks = tasks.map(t =>
    t.replicaFamilyAttrValue === '阿斯塔利亚' ? { ...t, replicaFamilyLaunched: true } : t,
  );
  const { tasks: runtime, skippedRoots } = prepareStageTasksWithReplicaSync([root], tasks, new Map());
  assert.equal(skippedRoots.length, 0);
  assert.equal(runtime.length, 1);
  assert.equal(runtime[0]!.replicaFamilyAttrValue, '阿斯塔利亚');
});

test('resetNewlyCreatedReplicaLaunched sets launched false', () => {
  const root = baseTask({ replicaFamilyScheduleMode: 'manual' });
  const merged = mergeReplicaFamilyFromRelay(root, ['1'], [root]);
  const rep = merged.tasks.find(t => t.replicaFamilyAttrValue === '1')!;
  assert.equal(rep.replicaFamilyLaunched, true);
  const next = resetNewlyCreatedReplicaLaunched(merged.tasks, merged.newlyCreatedIds);
  const updated = next.find(t => t.id === rep.id)!;
  assert.equal(updated.replicaFamilyLaunched, false);
});

test('prepareStage auto runs existing member whose stored attr uses another middle-dot', () => {
  const root = baseTask({
    replicaFamilySpec: 'npc@act',
    replicaFamilyEnumSpec: 'npc@act',
    extractInjectTags: ['npc@act'],
    promptGroups: [{ name: '', role: 'user', content: '{{npc@act}}', enabled: true }],
  });
  const merged = mergeReplicaFamilyFromRelay(root, ['波尔特・瓦伦'], [root]);
  const memberId = merged.tasks.find(t => t.replicaFamilyRootId)!.id;
  const tasks = merged.tasks.map(t =>
    t.id === memberId ? { ...t, replicaFamilyAttrValue: '波尔特・瓦伦' } : t,
  );
  const { tasks: runtime, newlyCreatedReplicaIds } = prepareStageTasksWithReplicaSync(
    [root],
    tasks,
    relayMap({ 'npc@act=波尔特·瓦伦': ENUM_REGISTRY_MARKER }),
  );
  assert.equal(newlyCreatedReplicaIds.length, 0);
  assert.equal(runtime.length, 1);
  assert.equal(runtime[0]!.id, memberId);
});

test('prepareStage auto runs only one member when both middle-dot variants exist', () => {
  const root = baseTask({
    replicaFamilySpec: 'npc@act',
    replicaFamilyEnumSpec: 'npc@act',
    extractInjectTags: ['npc@act'],
    promptGroups: [{ name: '', role: 'user', content: '{{npc@act}}', enabled: true }],
  });
  const merged = mergeReplicaFamilyFromRelay(root, ['波尔特·瓦伦'], [root]);
  const first = merged.tasks.find(t => t.replicaFamilyRootId)!;
  const duplicate = {
    ...first,
    id: 'dup-dot',
    replicaFamilyAttrValue: '波尔特・瓦伦',
    replicaFamilyLaunched: true,
  };
  const { tasks: runtime } = prepareStageTasksWithReplicaSync(
    [root],
    [...merged.tasks, duplicate],
    relayMap({ 'npc@act=波尔特·瓦伦': ENUM_REGISTRY_MARKER }),
  );
  assert.equal(runtime.length, 1);
  assert.equal(runtime[0]!.id, first.id);
});

if (process.exitCode) process.exit(process.exitCode);
