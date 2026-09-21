import assert from 'node:assert/strict';
import type { PostProcessTask } from './schema';
import {
  REPLICA_PROGRESS_GROUP_PREFIX,
  buildReplicaAggregatedStatus,
  buildStageProgressDisplayItems,
  type ReplicaMemberProgressState,
} from './replica-family';

function rootTask(overrides: Partial<PostProcessTask> = {}): PostProcessTask {
  return {
    id: 'root-1',
    name: '副本族处理',
    enabled: true,
    stage: 2,
    promptGroups: [{ name: '', role: 'user', content: '{{item@name}}', enabled: true }],
    extractInjectTags: ['item@name'],
    mergeStrategy: 'concat',
    maxRetries: 3,
    minLength: 0,
    apiPresetName: '',
    plotWorldbookMode: 'inherit',
    contextMode: 'inherit',
    structuredOutputMode: 'off',
    syncAsReplicaFamily: true,
    replicaFamilySpec: 'item@name',
    replicaFamilyBaseName: '副本族处理',
    ...overrides,
  };
}

function replica(attr: string, overrides: Partial<PostProcessTask> = {}): PostProcessTask {
  return {
    ...rootTask({ syncAsReplicaFamily: false }),
    id: `rep-${attr}`,
    name: `副本族处理 ${attr}`,
    replicaFamilyRootId: 'root-1',
    replicaFamilyAttrValue: attr,
    replicaFamilySpec: 'item@name',
    syncAsReplicaFamily: false,
    ...overrides,
  };
}

function ordinaryTask(overrides: Partial<PostProcessTask> = {}): PostProcessTask {
  return {
    id: 'ordinary-1',
    name: '枚举 item',
    enabled: true,
    stage: 1,
    promptGroups: [],
    extractInjectTags: ['result'],
    mergeStrategy: 'concat',
    maxRetries: 3,
    minLength: 0,
    apiPresetName: '',
    plotWorldbookMode: 'inherit',
    contextMode: 'inherit',
    structuredOutputMode: 'off',
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

test('three replica members collapse to one HUD row with base name', () => {
  const allTasks = [rootTask(), replica('甲'), replica('乙'), replica('丙')];
  const stageTasks = [replica('甲'), replica('乙'), replica('丙')];
  const items = buildStageProgressDisplayItems(stageTasks, allTasks);
  assert.equal(items.length, 1);
  assert.equal(items[0]!.taskId, `${REPLICA_PROGRESS_GROUP_PREFIX}root-1`);
  assert.equal(items[0]!.taskName, '副本族处理');
  assert.equal(items[0]!.status, 'pending');
});

test('aggregate status reflects member running and completion', () => {
  const stageTasks = [replica('甲'), replica('乙')];
  const allTasks = [rootTask(), ...stageTasks];
  const states = new Map<string, ReplicaMemberProgressState>([
    ['rep-甲', { status: 'done' }],
    ['rep-乙', { status: 'running' }],
  ]);
  const items = buildStageProgressDisplayItems(stageTasks, allTasks, states);
  assert.equal(items[0]!.status, 'running');
  assert.equal(items[0]!.detail, '1/2');

  states.set('rep-乙', { status: 'done' });
  const doneItems = buildStageProgressDisplayItems(stageTasks, allTasks, states);
  assert.equal(doneItems[0]!.status, 'done');
  assert.equal(doneItems[0]!.detail, undefined);
});

test('any failed member marks group failed', () => {
  assert.equal(buildReplicaAggregatedStatus(['done', 'failed']), 'failed');
  const stageTasks = [replica('甲'), replica('乙')];
  const states = new Map<string, ReplicaMemberProgressState>([
    ['rep-甲', { status: 'done' }],
    ['rep-乙', { status: 'failed', detail: 'API 错误' }],
  ]);
  const items = buildStageProgressDisplayItems(stageTasks, [rootTask(), ...stageTasks], states);
  assert.equal(items[0]!.status, 'failed');
  assert.equal(items[0]!.detail, 'API 错误');
});

test('ordinary task and replica family in same stage', () => {
  const ord = ordinaryTask({ stage: 2 });
  const reps = [replica('甲'), replica('乙')];
  const items = buildStageProgressDisplayItems([ord, ...reps], [ord, rootTask(), ...reps]);
  assert.equal(items.length, 2);
  assert.equal(items[0]!.taskId, 'ordinary-1');
  assert.equal(items[0]!.taskName, '枚举 item');
  assert.equal(items[1]!.taskId, `${REPLICA_PROGRESS_GROUP_PREFIX}root-1`);
  assert.equal(items[1]!.taskName, '副本族处理');
});

test('single replica member still uses shared prefix only', () => {
  const stageTasks = [replica('甲')];
  const items = buildStageProgressDisplayItems(stageTasks, [rootTask(), ...stageTasks]);
  assert.equal(items.length, 1);
  assert.equal(items[0]!.taskName, '副本族处理');
  assert.equal(items[0]!.detail, undefined);
});

if (process.exitCode) process.exit(process.exitCode);
