import assert from 'node:assert/strict';
import { test } from 'node:test';
import lodash from 'lodash';

(globalThis as typeof globalThis & { _: typeof lodash })._ = lodash;

import type { PostProcessTask } from './schema';
import {
  buildMacroRelayFromReplicaState,
  resolveWorkflowPlaceholderMacro,
} from './placeholder-macros';
import {
  clearPendingLastEnumAttrValues,
  recordPendingLastEnumAttrValues,
  takePendingLastEnumAttrValues,
} from './replica-enum-pending';
import { buildDirectedEnumRegistryKey, ENUM_REGISTRY_MARKER } from './replica-enum-parse';
import { prepareStageTasksWithReplicaSync } from './replica-family';
import type { RelayTagMap } from './utils';

function rootTask(overrides: Partial<PostProcessTask> = {}): PostProcessTask {
  return {
    id: 'root-1',
    name: '副本族处理',
    enabled: true,
    stage: 2,
    promptGroups: [{ name: '', role: 'user', content: 'do {{item@id}}', enabled: true }],
    extractInjectTags: ['item@id'],
    mergeStrategy: 'concat',
    maxRetries: 3,
    minLength: 0,
    apiPresetName: '',
    plotWorldbookMode: 'inherit',
    contextMode: 'inherit',
    structuredOutputMode: 'off',
    syncAsReplicaFamily: true,
    replicaFamilySpec: 'item@id',
    replicaFamilyEnumSpec: 'item@id',
    replicaFamilyBaseName: '副本族处理',
    replicaFamilyScheduleMode: 'auto',
    ...overrides,
  } as PostProcessTask;
}

function memberTask(attr: string, overrides: Partial<PostProcessTask> = {}): PostProcessTask {
  return {
    ...rootTask(),
    id: `rep-${attr}`,
    name: `副本族处理 ${attr}`,
    syncAsReplicaFamily: false,
    replicaFamilyRootId: 'root-1',
    replicaFamilyAttrValue: attr,
    ...overrides,
  } as PostProcessTask;
}

test('buildMacroRelayFromReplicaState writes directed keys per root', () => {
  const tasks = [rootTask(), memberTask('1'), memberTask('2')];
  const relay = buildMacroRelayFromReplicaState(tasks, {
    'root-1': { attrValues: ['1', '2'], lastEnumAttrValues: ['1'] },
  });
  const key = buildDirectedEnumRegistryKey('root-1', 'item', 'id', '1');
  assert.deepEqual(relay.get(key), [ENUM_REGISTRY_MARKER]);
  assert.equal(relay.has('item@id=1'), false);
  assert.equal(relay.has(buildDirectedEnumRegistryKey('root-1', 'item', 'id', '2')), false);
});

test('buildMacroRelayFromReplicaState isolates two roots sharing spec', () => {
  const rootA = rootTask({ id: 'root-a', name: '族A', replicaFamilyBaseName: '族A' });
  const rootB = rootTask({ id: 'root-b', name: '族B', replicaFamilyBaseName: '族B' });
  const relay = buildMacroRelayFromReplicaState([rootA, rootB], {
    'root-a': { attrValues: ['1'], lastEnumAttrValues: ['1'] },
    'root-b': { attrValues: ['2'], lastEnumAttrValues: ['2'] },
  });
  assert.deepEqual(relay.get(buildDirectedEnumRegistryKey('root-a', 'item', 'id', '1')), [
    ENUM_REGISTRY_MARKER,
  ]);
  assert.deepEqual(relay.get(buildDirectedEnumRegistryKey('root-b', 'item', 'id', '2')), [
    ENUM_REGISTRY_MARKER,
  ]);
  assert.equal(relay.has('item@id=1'), false);
});

test('resolveWorkflowPlaceholderMacro last-launched auto uses lastEnum', () => {
  const tasks = [rootTask(), memberTask('1'), memberTask('2')];
  const history: RelayTagMap = new Map([
    ['item@id=1', ['A']],
    ['item@id=2', ['B']],
  ]);
  const out = resolveWorkflowPlaceholderMacro('total:last-launched:item@id', 0, {
    tasks,
    historyMap: history,
    replicaState: {
      'root-1': { attrValues: ['1', '2'], lastEnumAttrValues: ['1'] },
    },
  });
  assert.ok(out.includes('<item id="1">'));
  assert.ok(out.includes('A'));
  assert.ok(!out.includes('<item id="2">'));
});

test('resolveWorkflowPlaceholderMacro last-launched auto empty without lastEnum', () => {
  const tasks = [rootTask(), memberTask('1'), memberTask('2')];
  const history: RelayTagMap = new Map([
    ['item@id=1', ['A']],
    ['item@id=2', ['B']],
  ]);
  const out = resolveWorkflowPlaceholderMacro('total:last-launched:item@id', 0, {
    tasks,
    historyMap: history,
    replicaState: { 'root-1': { attrValues: ['1', '2'] } },
  });
  assert.equal(out, '');
});

test('resolveWorkflowPlaceholderMacro last-launched manual uses launchedAttrValues', () => {
  const tasks = [
    rootTask({ replicaFamilyScheduleMode: 'manual' }),
    memberTask('1'),
    memberTask('2'),
  ];
  const history: RelayTagMap = new Map([
    ['item@id=1', ['A']],
    ['item@id=2', ['B']],
  ]);
  const out = resolveWorkflowPlaceholderMacro('total:last-launched:item@id', 0, {
    tasks,
    historyMap: history,
    replicaState: {
      'root-1': {
        attrValues: ['1', '2'],
        launchedAttrValues: ['1'],
      },
    },
  });
  assert.ok(out.includes('<item id="1">'));
  assert.ok(!out.includes('<item id="2">'));
});

test('resolveWorkflowPlaceholderMacro last-launched ignores relay-only content', () => {
  const tasks = [rootTask(), memberTask('1')];
  const history: RelayTagMap = new Map();
  const out = resolveWorkflowPlaceholderMacro('total:last-launched:item@id', 0, {
    tasks,
    historyMap: history,
    replicaState: {
      'root-1': { attrValues: ['1'], lastEnumAttrValues: ['1'] },
    },
  });
  // history 空则即使 snapshot 有名单也无正文
  assert.equal(out, '');
});

test('resolveWorkflowPlaceholderMacro replica:launched joins suffixes', () => {
  const tasks = [
    rootTask({ replicaFamilyScheduleMode: 'manual', replicaFamilyBaseName: '副本族处理' }),
    memberTask('1', { replicaFamilyLaunched: true }),
    memberTask('2', { replicaFamilyLaunched: true }),
  ];
  const out = resolveWorkflowPlaceholderMacro('replica:launched:副本族处理', 0, {
    tasks,
    historyMap: new Map(),
    replicaState: {},
  });
  assert.equal(out, '1、2');
});

test('prepareStageTasksWithReplicaSync records pending lastEnum', () => {
  clearPendingLastEnumAttrValues();
  const root = rootTask();
  const relay: RelayTagMap = new Map([
    ['item@id=1', [ENUM_REGISTRY_MARKER]],
    ['item@id=2', [ENUM_REGISTRY_MARKER]],
  ]);
  prepareStageTasksWithReplicaSync([root], [root], relay);
  const pending = takePendingLastEnumAttrValues();
  assert.deepEqual(pending['root-1'], ['1', '2']);
});

test('recordPendingLastEnumAttrValues ignores empty', () => {
  clearPendingLastEnumAttrValues();
  recordPendingLastEnumAttrValues('root-1', []);
  assert.deepEqual(takePendingLastEnumAttrValues(), {});
});
