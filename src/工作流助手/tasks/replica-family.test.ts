import assert from 'node:assert/strict';
import { test } from 'node:test';
import lodash from 'lodash';

(globalThis as typeof globalThis & { _: typeof lodash })._ = lodash;

import type { PostProcessTask } from './schema';
import {
  applyTaskWorkflowPresetOnTask,
  saveTaskWorkflowPresetOnTask,
} from './task-workflow-preset';
import {
  assertReplicaMemberPatchAllowed,
  cloneAutoSegmentsFromRoot,
  expandEnabledTasksForRuntime,
  findReplicaFamilyRootByAttrSpec,
  findReplicaFamilyRootsByAttrSpec,
  findReplicaFamilyRootByRef,
  isReplicaFamilyMember,
  isReplicaFamilyRootTemplate,
  listLaunchedAttrValuesForSpec,
  listLaunchedAttrValuesForSpecWithFallback,
  listLaunchedReplicaSuffixes,
  listLastLaunchedAttrValues,
  listLastLaunchedAttrValuesForSpec,
  listLaunchedAttrValuesWithFallback,
  mergeReplicaFamilyFromRelay,
  mirrorAllReplicaFamilies,
  promoteReplicaApiPatchToCustom,
  renameReplicaFamilyMemberAttr,
  stripReplicaFamilyMembers,
  prunePromptAutoSegmentInsertedOverrides,
  patchPromptAutoSegmentInsertedOverride,
  resolveReplicaLaunchedPlaceholder,
  scanDynamicAttrPlaceholders,
  substituteDynamicPlaceholder,
  syncReplicaFamily,
  syncReplicaFromRoot,
  validateReplicaFamilyEligibility,
} from './replica-family';
import type { RelayTagMap } from './utils';

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
    apiPresetName: '',
    plotWorldbookMode: 'inherit',
    contextMode: 'inherit',
    structuredOutputMode: 'off',
    syncAsReplicaFamily: true,
    replicaFamilySpec: 'item@id',
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

test('validate single dynamic spec', () => {
  const r = validateReplicaFamilyEligibility(baseTask());
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.spec, 'item@id');
});

test('validate rejects multiple dynamic specs', () => {
  const r = validateReplicaFamilyEligibility(
    baseTask({
      promptGroups: [{ name: '', role: 'user', content: '{{item@id}}{{npc@name}}', enabled: true }],
    }),
  );
  assert.equal(r.ok, false);
});

test('substitute dynamic to precise', () => {
  const out = substituteDynamicPlaceholder('x {{item@id}} y', 'item@id', '2');
  assert.equal(out, 'x {{item@id=2}} y');
});

test('syncReplicaFamily creates replicas with default launched false in auto mode', () => {
  const root = baseTask();
  const all = syncReplicaFamily(root, ['1', '2'], [root]);
  assert.equal(all.filter(t => t.replicaFamilyRootId === 'root-1').length, 2);
  const rep = all.find(t => t.replicaFamilyAttrValue === '2');
  assert.ok(rep?.promptGroups[0]?.content.includes('{{item@id=2}}'));
  assert.equal(rep?.replicaFamilyLaunched, false);
});

test('merge preserves all replicas when relay shrinks', () => {
  const root = baseTask();
  let merged = mergeReplicaFamilyFromRelay(root, ['1', '2'], [root]);
  merged = mergeReplicaFamilyFromRelay(root, ['1'], merged.tasks);
  assert.ok(merged.tasks.some(t => t.replicaFamilyAttrValue === '2'));
});

test('expandEnabledTasksForRuntime skips root template', () => {
  const root = baseTask();
  const rep = syncReplicaFamily(root, ['1'], [root]).find(t => t.replicaFamilyRootId === 'root-1')!;
  const expanded = expandEnabledTasksForRuntime([root, rep]);
  assert.equal(expanded.length, 1);
  assert.equal(expanded[0]!.id, rep.id);
});

test('isReplicaFamilyRootTemplate', () => {
  assert.equal(isReplicaFamilyRootTemplate(baseTask()), true);
  assert.equal(isReplicaFamilyRootTemplate(baseTask({ syncAsReplicaFamily: false })), false);
});

test('scanDynamicAttrPlaceholders', () => {
  assert.deepEqual(scanDynamicAttrPlaceholders(baseTask()), ['item@id']);
});

test('scanDynamicAttrPlaceholders ignores total: placeholders', () => {
  assert.deepEqual(
    scanDynamicAttrPlaceholders(
      baseTask({
        promptGroups: [
          { name: '', role: 'user', content: 'only {{total:item@id}} here', enabled: true },
        ],
      }),
    ),
    [],
  );
});

test('validate rejects when only total: placeholder is present', () => {
  const r = validateReplicaFamilyEligibility(
    baseTask({
      promptGroups: [{ name: '', role: 'user', content: '{{total:item@id}}', enabled: true }],
    }),
  );
  assert.equal(r.ok, false);
});

test('validate accepts item@id even when total:item@id also present', () => {
  const r = validateReplicaFamilyEligibility(
    baseTask({
      promptGroups: [
        {
          name: '',
          role: 'user',
          content: 'list {{total:item@id}} then member uses {{item@id}}',
          enabled: true,
        },
      ],
    }),
  );
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.spec, 'item@id');
});

test('substituteDynamicPlaceholder leaves total: untouched', () => {
  const out = substituteDynamicPlaceholder(
    'all={{total:item@id}} one={{item@id}}',
    'item@id',
    '2',
  );
  assert.equal(out, 'all={{total:item@id}} one={{item@id=2}}');
});

test('syncReplicaFromRoot mirrors workflow fields and preserves identity', () => {
  const root = baseTask({
    stage: 5,
    apiPresetName: 'root-api',
    extractInjectTags: ['item@id', 'result'],
    promptGroups: [{ name: '', role: 'user', content: 'handle {{item@id}} here', enabled: true }],
  });
  const replica = {
    id: 'rep-1',
    name: '处理 item 1',
    enabled: false,
    stage: 2,
    promptGroups: [{ name: '', role: 'user', content: 'stale {{item@id=1}}', enabled: true }],
    extractInjectTags: ['old'],
    mergeStrategy: 'concat' as const,
    maxRetries: 3,
    minLength: 0,
    apiPresetName: 'old-api',
    plotWorldbookMode: 'inherit' as const,
    contextMode: 'inherit' as const,
    structuredOutputMode: 'off' as const,
    replicaFamilyRootId: 'root-1',
    replicaFamilyAttrValue: '1',
    replicaFamilyLaunched: true,
    replicaFamilySpec: 'item@id',
  };
  const synced = syncReplicaFromRoot(replica, root);
  assert.equal(synced.id, 'rep-1');
  assert.equal(synced.name, '处理 item 1');
  assert.equal(synced.stage, 5);
  assert.equal(synced.apiPresetName, 'root-api');
  assert.deepEqual(synced.extractInjectTags, ['item@id', 'result']);
  assert.equal(synced.enabled, false);
  assert.equal(synced.replicaFamilyLaunched, true);
  assert.equal(synced.promptGroups[0]?.content, 'handle {{item@id=1}} here');
});

test('mirrorAllReplicaFamilies syncs orphan replicas when root changes', () => {
  const root = baseTask({ promptGroups: [{ name: '', role: 'user', content: 'v1 {{item@id}}', enabled: true }] });
  let merged = mergeReplicaFamilyFromRelay(root, ['1', '2'], [root]);
  merged = mergeReplicaFamilyFromRelay(root, ['1'], merged.tasks);
  const orphan = merged.tasks.find(t => t.replicaFamilyAttrValue === '2')!;
  assert.ok(orphan.promptGroups[0]?.content.includes('v1'));

  const updatedRoot = {
    ...merged.tasks.find(t => t.id === 'root-1')!,
    promptGroups: [{ name: '', role: 'user', content: 'v2 {{item@id}}', enabled: true }],
  };
  const tasks = merged.tasks.map(t => (t.id === 'root-1' ? updatedRoot : t));
  const mirrored = mirrorAllReplicaFamilies(tasks);
  const syncedOrphan = mirrored.find(t => t.id === orphan.id)!;
  assert.equal(syncedOrphan.promptGroups[0]?.content, 'v2 {{item@id=2}}');
});

test('mirrorAllReplicaFamilies keeps unrelated replica families isolated', () => {
  const rootA = baseTask({ id: 'root-a', replicaFamilySpec: 'item@id' });
  const rootB = baseTask({
    id: 'root-b',
    name: 'npc task',
    replicaFamilySpec: 'npc@id',
    promptGroups: [{ name: '', role: 'user', content: 'npc {{npc@id}}', enabled: true }],
    extractInjectTags: ['npc@id'],
  });
  const repA = syncReplicaFromRoot(
    {
      id: 'rep-a',
      name: '处理 item 1',
      enabled: true,
      stage: 2,
      promptGroups: [],
      extractInjectTags: [],
      mergeStrategy: 'concat',
      maxRetries: 3,
      minLength: 0,
      apiPresetName: '',
      plotWorldbookMode: 'inherit',
      contextMode: 'inherit',
      structuredOutputMode: 'off',
      replicaFamilyRootId: 'root-a',
      replicaFamilyAttrValue: '1',
    },
    rootA,
  );
  const repB = syncReplicaFromRoot(
    {
      id: 'rep-b',
      name: 'npc task x',
      enabled: true,
      stage: 2,
      promptGroups: [],
      extractInjectTags: [],
      mergeStrategy: 'concat',
      maxRetries: 3,
      minLength: 0,
      apiPresetName: '',
      plotWorldbookMode: 'inherit',
      contextMode: 'inherit',
      structuredOutputMode: 'off',
      replicaFamilyRootId: 'root-b',
      replicaFamilyAttrValue: 'x',
    },
    rootB,
  );
  const updatedRootA = {
    ...rootA,
    stage: 9,
    promptGroups: [{ name: '', role: 'user', content: 'new {{item@id}}', enabled: true }],
  };
  const mirrored = mirrorAllReplicaFamilies([updatedRootA, rootB, repA, repB]);
  assert.equal(mirrored.find(t => t.id === 'rep-a')?.stage, 9);
  assert.equal(mirrored.find(t => t.id === 'rep-b')?.stage, 2);
  assert.ok(mirrored.find(t => t.id === 'rep-a')?.promptGroups[0]?.content.includes('{{item@id=1}}'));
  assert.ok(mirrored.find(t => t.id === 'rep-b')?.promptGroups[0]?.content.includes('{{npc@id=x}}'));
});

test('apply workflow preset on root then mirror updates replicas', () => {
  const root = baseTask({ apiPresetName: 'api-v1' });
  let tasks = syncReplicaFamily(root, ['1'], [root]);
  const rootIdx = tasks.findIndex(t => t.id === 'root-1');
  tasks[rootIdx] = saveTaskWorkflowPresetOnTask(tasks[rootIdx]!, 'preset-a');
  tasks[rootIdx] = {
    ...tasks[rootIdx]!,
    stage: 9,
    apiPresetName: 'api-v2',
    promptGroups: [{ name: '', role: 'user', content: 'changed {{item@id}}', enabled: true }],
  };
  tasks[rootIdx] = applyTaskWorkflowPresetOnTask(tasks[rootIdx]!, 'preset-a');
  tasks = mirrorAllReplicaFamilies(tasks);
  const replica = tasks.find(t => t.replicaFamilyAttrValue === '1');
  assert.equal(replica?.stage, 2);
  assert.equal(replica?.apiPresetName, 'api-v2');
  assert.equal(replica?.promptGroups[0]?.content, 'do {{item@id=1}}');
});

test('isReplicaFamilyMember identifies replica tasks', () => {
  assert.equal(isReplicaFamilyMember(baseTask()), false);
  assert.equal(
    isReplicaFamilyMember({
      ...baseTask({ syncAsReplicaFamily: false }),
      replicaFamilyRootId: 'root-1',
      replicaFamilyAttrValue: '1',
    }),
    true,
  );
});

test('stripReplicaFamilyMembers keeps roots and plain tasks', () => {
  const root = baseTask({ id: 'root-1', syncAsReplicaFamily: true, name: '族' });
  const member = {
    ...baseTask({ syncAsReplicaFamily: false }),
    id: 'rep-1',
    name: '族 1',
    replicaFamilyRootId: 'root-1',
    replicaFamilyAttrValue: '1',
  };
  const plain = baseTask({ id: 'plain', name: '普通' });
  const next = stripReplicaFamilyMembers([root, member, plain]);
  assert.equal(next.length, 2);
  assert.ok(next.every(t => !t.replicaFamilyRootId));
  assert.ok(next.some(t => t.id === 'root-1'));
  assert.ok(next.some(t => t.id === 'plain'));
});

test('assertReplicaMemberPatchAllowed blocks workflow fields', () => {
  const member = {
    ...baseTask({ syncAsReplicaFamily: false }),
    id: 'rep-1',
    replicaFamilyRootId: 'root-1',
    replicaFamilyAttrValue: '1',
  };
  assert.throws(
    () => assertReplicaMemberPatchAllowed(member, { stage: 9 }),
    /副本为原本镜像/,
  );
  assert.throws(
    () =>
      assertReplicaMemberPatchAllowed(member, {
        promptGroups: [{ name: '', role: 'user', content: 'x', enabled: true }],
      }),
    /副本为原本镜像/,
  );
  assert.doesNotThrow(() =>
    assertReplicaMemberPatchAllowed(member, { replicaFamilyLaunched: true }),
  );
  assert.doesNotThrow(() => assertReplicaMemberPatchAllowed(member, { enabled: false }));
  assert.doesNotThrow(() =>
    assertReplicaMemberPatchAllowed(member, {
      plotWorldbookMode: 'custom',
      plotWorldbookConfig: {
        source: 'manual',
        manualSelection: ['MemberBook'],
        enabledEntries: { MemberBook: [1] },
      },
    }),
  );
  assert.doesNotThrow(() =>
    assertReplicaMemberPatchAllowed(member, { plotWorldbookMode: 'inheritRoot' }),
  );
  assert.doesNotThrow(() =>
    assertReplicaMemberPatchAllowed(member, {
      apiPresetMode: 'custom',
      apiPresetName: 'replica-api',
      apiPresetFallbackNames: ['fb'],
      apiPrimaryMaxConcurrency: 3,
      apiFallbackMaxConcurrencies: [2],
    }),
  );
});

test('promoteReplicaApiPatchToCustom upgrades bare routing patches', () => {
  const member = {
    ...baseTask({ syncAsReplicaFamily: false }),
    id: 'rep-1',
    replicaFamilyRootId: 'root-1',
    replicaFamilyAttrValue: '1',
    apiPresetMode: 'inheritRoot' as const,
  };
  const promoted = promoteReplicaApiPatchToCustom(member, { apiPresetName: 'solo' });
  assert.equal(promoted.apiPresetMode, 'custom');
  assert.equal(promoted.apiPresetName, 'solo');

  const keepInherit = promoteReplicaApiPatchToCustom(member, {
    apiPresetMode: 'inheritRoot',
    apiPresetName: 'ignored-by-mirror',
  });
  assert.equal(keepInherit.apiPresetMode, 'inheritRoot');

  const root = baseTask();
  assert.deepEqual(promoteReplicaApiPatchToCustom(root, { apiPresetName: 'x' }), {
    apiPresetName: 'x',
  });
});

test('syncReplicaFromRoot preserves custom plotWorldbookConfig on member', () => {
  const root = baseTask({
    plotWorldbookMode: 'custom' as const,
    plotWorldbookConfig: {
      source: 'manual' as const,
      manualSelection: ['RootBook'],
      enabledEntries: { RootBook: [1] },
    },
    promptGroups: [{ name: '', role: 'user', content: 'handle {{item@id}} here', enabled: true }],
  });
  const memberConfig = {
    source: 'manual' as const,
    manualSelection: ['MemberBook'],
    enabledEntries: { MemberBook: [2] },
  };
  const replica = {
    id: 'rep-1',
    name: '处理 item 1',
    enabled: true,
    stage: 2,
    promptGroups: [{ name: '', role: 'user', content: 'stale', enabled: true }],
    plotWorldbookMode: 'custom' as const,
    plotWorldbookConfig: memberConfig,
    replicaFamilyRootId: 'root-1',
    replicaFamilyAttrValue: '1',
    replicaFamilyLaunched: false,
  };
  const synced = syncReplicaFromRoot(replica, root);
  assert.equal(synced.plotWorldbookMode, 'custom');
  assert.deepEqual(synced.plotWorldbookConfig, memberConfig);
});

test('syncReplicaFromRoot preserves inheritRoot mode and clears config', () => {
  const root = baseTask({
    plotWorldbookMode: 'custom' as const,
    plotWorldbookConfig: {
      source: 'manual' as const,
      manualSelection: ['RootBook'],
      enabledEntries: { RootBook: [1] },
    },
    promptGroups: [{ name: '', role: 'user', content: 'handle {{item@id}} here', enabled: true }],
  });
  const replica = {
    id: 'rep-1',
    name: '处理 item 1',
    enabled: true,
    stage: 2,
    promptGroups: [{ name: '', role: 'user', content: 'stale', enabled: true }],
    plotWorldbookMode: 'inheritRoot' as const,
    plotWorldbookConfig: {
      source: 'manual' as const,
      manualSelection: ['Stale'],
      enabledEntries: {},
    },
    replicaFamilyRootId: 'root-1',
    replicaFamilyAttrValue: '1',
    replicaFamilyLaunched: false,
  };
  const synced = syncReplicaFromRoot(replica, root);
  assert.equal(synced.plotWorldbookMode, 'inheritRoot');
  assert.equal(synced.plotWorldbookConfig, undefined);
});

test('syncReplicaFromRoot inherits API routing when apiPresetMode is inheritRoot', () => {
  const root = baseTask({
    apiPresetName: 'root-api',
    apiPresetFallbackNames: ['root-fb'],
    apiPrimaryMaxConcurrency: 7,
    apiFallbackMaxConcurrencies: [3],
    promptGroups: [{ name: '', role: 'user', content: 'handle {{item@id}} here', enabled: true }],
  });
  const replica = {
    id: 'rep-1',
    name: '处理 item 1',
    enabled: true,
    stage: 2,
    promptGroups: [{ name: '', role: 'user', content: 'stale', enabled: true }],
    apiPresetMode: 'inheritRoot' as const,
    apiPresetName: 'old-api',
    apiPresetFallbackNames: ['old-fb'],
    apiPrimaryMaxConcurrency: 1,
    apiFallbackMaxConcurrencies: [1],
    replicaFamilyRootId: 'root-1',
    replicaFamilyAttrValue: '1',
    replicaFamilyLaunched: false,
  };
  const synced = syncReplicaFromRoot(replica, root);
  assert.equal(synced.apiPresetMode, 'inheritRoot');
  assert.equal(synced.apiPresetName, 'root-api');
  assert.deepEqual(synced.apiPresetFallbackNames, ['root-fb']);
  assert.equal(synced.apiPrimaryMaxConcurrency, 7);
  assert.deepEqual(synced.apiFallbackMaxConcurrencies, [3]);
});

test('syncReplicaFromRoot preserves custom API routing on member', () => {
  const root = baseTask({
    apiPresetName: 'root-api',
    apiPresetFallbackNames: ['root-fb'],
    apiPrimaryMaxConcurrency: 7,
    apiFallbackMaxConcurrencies: [3],
    promptGroups: [{ name: '', role: 'user', content: 'handle {{item@id}} here', enabled: true }],
  });
  const replica = {
    id: 'rep-1',
    name: '处理 item 1',
    enabled: true,
    stage: 2,
    promptGroups: [{ name: '', role: 'user', content: 'stale', enabled: true }],
    apiPresetMode: 'custom' as const,
    apiPresetName: 'replica-api',
    apiPresetFallbackNames: ['replica-fb'],
    apiPrimaryMaxConcurrency: 2,
    apiFallbackMaxConcurrencies: [4],
    replicaFamilyRootId: 'root-1',
    replicaFamilyAttrValue: '1',
    replicaFamilyLaunched: false,
  };
  const synced = syncReplicaFromRoot(replica, root);
  assert.equal(synced.apiPresetMode, 'custom');
  assert.equal(synced.apiPresetName, 'replica-api');
  assert.deepEqual(synced.apiPresetFallbackNames, ['replica-fb']);
  assert.equal(synced.apiPrimaryMaxConcurrency, 2);
  assert.deepEqual(synced.apiFallbackMaxConcurrencies, [4]);
});

function relayMap(entries: Record<string, string>): RelayTagMap {
  return new Map(Object.entries(entries).map(([k, v]) => [k, [v]]));
}

test('findReplicaFamilyRootByRef by name and member id', () => {
  const root = baseTask({ name: '副本族处理', replicaFamilyBaseName: '副本族处理' });
  const merged = mergeReplicaFamilyFromRelay(root, ['1'], [root]);
  const rep = merged.tasks.find(t => t.replicaFamilyAttrValue === '1')!;
  assert.equal(findReplicaFamilyRootByRef('副本族处理', merged.tasks)?.id, root.id);
  assert.equal(findReplicaFamilyRootByRef(rep.id, merged.tasks)?.id, root.id);
});

test('listLaunchedReplicaSuffixes manual only launched', () => {
  const root = baseTask({
    name: '副本族处理',
    replicaFamilyBaseName: '副本族处理',
    replicaFamilyScheduleMode: 'manual',
  });
  let tasks = mergeReplicaFamilyFromRelay(root, ['1', '2'], [root]).tasks;
  const rep1 = tasks.find(t => t.replicaFamilyAttrValue === '1')!;
  const rep2 = tasks.find(t => t.replicaFamilyAttrValue === '2')!;
  tasks = tasks.map(t => {
    if (t.id === rep1.id) return { ...t, replicaFamilyLaunched: true };
    if (t.id === rep2.id) return { ...t, replicaFamilyLaunched: false };
    return t;
  });
  const syncedRoot = tasks.find(t => t.id === root.id)!;
  assert.deepEqual(listLaunchedReplicaSuffixes(syncedRoot, tasks, new Map()), ['1']);
});

test('listLaunchedReplicaSuffixes auto filters by relay enum', () => {
  const root = baseTask({ replicaFamilyScheduleMode: 'auto' });
  const tasks = mergeReplicaFamilyFromRelay(root, ['1', '2'], [root]).tasks;
  const syncedRoot = tasks.find(t => t.id === root.id)!;
  const relay = relayMap({ 'item@id=1': '\u0000' });
  assert.deepEqual(listLaunchedReplicaSuffixes(syncedRoot, tasks, relay), ['1']);
});

test('resolveReplicaLaunchedPlaceholder joins with dunhao', () => {
  const root = baseTask({
    name: '副本族处理',
    replicaFamilyBaseName: '副本族处理',
    replicaFamilyScheduleMode: 'manual',
  });
  let tasks = mergeReplicaFamilyFromRelay(root, ['1', '2'], [root]).tasks;
  tasks = tasks.map(t =>
    t.replicaFamilyAttrValue === '1' || t.replicaFamilyAttrValue === '2'
      ? { ...t, replicaFamilyLaunched: true }
      : t,
  );
  assert.equal(
    resolveReplicaLaunchedPlaceholder('副本族处理', tasks, new Map()),
    '1、2',
  );
});

test('resolveReplicaLaunchedPlaceholder returns empty for unknown root', () => {
  assert.equal(resolveReplicaLaunchedPlaceholder('不存在', [], new Map()), '');
});

test('findReplicaFamilyRootByAttrSpec matches enumSpec or spec', () => {
  const root = baseTask({
    replicaFamilySpec: 'item@id',
    replicaFamilyEnumSpec: 'item@id',
  });
  assert.equal(findReplicaFamilyRootByAttrSpec({ tagName: 'item', attrName: 'id' }, [root])?.id, root.id);
  assert.equal(findReplicaFamilyRootByAttrSpec({ tagName: 'npc', attrName: 'name' }, [root]), undefined);
});

test('findReplicaFamilyRootsByAttrSpec returns all matching roots', () => {
  const rootA = baseTask({
    id: 'root-a',
    name: '族A',
    replicaFamilyBaseName: '族A',
    replicaFamilySpec: 'item@id',
    replicaFamilyEnumSpec: 'item@id',
  });
  const rootB = baseTask({
    id: 'root-b',
    name: '族B',
    replicaFamilyBaseName: '族B',
    replicaFamilySpec: 'item@id',
    replicaFamilyEnumSpec: 'item@id',
  });
  const roots = findReplicaFamilyRootsByAttrSpec({ tagName: 'item', attrName: 'id' }, [rootA, rootB]);
  assert.deepEqual(roots.map(r => r.id).sort(), ['root-a', 'root-b']);
});

test('listLaunchedAttrValuesForSpec unions and can narrow by task', () => {
  const rootA = baseTask({
    id: 'root-a',
    name: '族A',
    replicaFamilyBaseName: '族A',
    replicaFamilyScheduleMode: 'manual',
    replicaFamilyEnumSpec: 'item@id',
  });
  const rootB = baseTask({
    id: 'root-b',
    name: '族B',
    replicaFamilyBaseName: '族B',
    replicaFamilyScheduleMode: 'manual',
    replicaFamilyEnumSpec: 'item@id',
  });
  let tasks = mergeReplicaFamilyFromRelay(rootA, ['1'], [rootA, rootB]).tasks;
  tasks = mergeReplicaFamilyFromRelay(rootB, ['2'], tasks).tasks;
  tasks = tasks.map(t =>
    t.replicaFamilyRootId ? { ...t, replicaFamilyLaunched: true } : t,
  );
  assert.deepEqual(
    listLaunchedAttrValuesForSpec({ tagName: 'item', attrName: 'id' }, tasks, new Map()),
    ['1', '2'],
  );
  assert.deepEqual(
    listLaunchedAttrValuesForSpec({ tagName: 'item', attrName: 'id' }, tasks, new Map(), '族A'),
    ['1'],
  );
  assert.deepEqual(
    listLastLaunchedAttrValuesForSpec(
      { tagName: 'item', attrName: 'id' },
      tasks,
      {
        'root-a': { attrValues: ['1'], lastEnumAttrValues: ['1'] },
        'root-b': { attrValues: ['2'], lastEnumAttrValues: ['2'] },
      },
      '族B',
    ),
    ['2'],
  );
});

test('listLaunchedAttrValuesForSpecWithFallback per-root merges current and last', () => {
  const rootA = baseTask({
    id: 'root-a',
    name: '族A',
    replicaFamilyBaseName: '族A',
    replicaFamilyScheduleMode: 'manual',
    replicaFamilyEnumSpec: 'item@id',
  });
  const rootB = baseTask({
    id: 'root-b',
    name: '族B',
    replicaFamilyBaseName: '族B',
    replicaFamilyScheduleMode: 'manual',
    replicaFamilyEnumSpec: 'item@id',
  });
  let tasks = mergeReplicaFamilyFromRelay(rootA, ['1'], [rootA, rootB]).tasks;
  tasks = mergeReplicaFamilyFromRelay(rootB, ['2'], tasks).tasks;
  // 仅族A 本轮 launched；族B 本轮未启动 → 应回退族B 的 last
  tasks = tasks.map(t => {
    if (t.replicaFamilyRootId === 'root-a') return { ...t, replicaFamilyLaunched: true };
    if (t.replicaFamilyRootId === 'root-b') return { ...t, replicaFamilyLaunched: false };
    return t;
  });
  assert.deepEqual(
    listLaunchedAttrValuesForSpecWithFallback(
      { tagName: 'item', attrName: 'id' },
      tasks,
      new Map(),
      {
        'root-a': { attrValues: ['1'], lastEnumAttrValues: ['9'] },
        'root-b': { attrValues: ['2'], lastEnumAttrValues: ['2'] },
      },
    ),
    ['1', '2'],
  );
});

test('findReplicaFamilyRootByAttrSpec prefers enumSpec over spec', () => {
  const root = baseTask({
    replicaFamilySpec: 'item@id',
    replicaFamilyEnumSpec: 'npc@name',
  });
  assert.equal(findReplicaFamilyRootByAttrSpec({ tagName: 'npc', attrName: 'name' }, [root])?.id, root.id);
  assert.equal(findReplicaFamilyRootByAttrSpec({ tagName: 'item', attrName: 'id' }, [root]), undefined);
});

test('listLaunchedReplicaSuffixes used by total:launched filters manual', () => {
  const root = baseTask({
    replicaFamilyScheduleMode: 'manual',
    replicaFamilyEnumSpec: 'item@id',
  });
  let tasks = mergeReplicaFamilyFromRelay(root, ['1', '2'], [root]).tasks;
  tasks = tasks.map(t =>
    t.replicaFamilyAttrValue === '1'
      ? { ...t, replicaFamilyLaunched: true }
      : t.replicaFamilyAttrValue === '2'
        ? { ...t, replicaFamilyLaunched: false }
        : t,
  );
  const syncedRoot = tasks.find(t => t.id === root.id)!;
  assert.deepEqual(listLaunchedReplicaSuffixes(syncedRoot, tasks, new Map()), ['1']);
  assert.equal(findReplicaFamilyRootByAttrSpec({ tagName: 'item', attrName: 'id' }, tasks)?.id, root.id);
});

test('listLastLaunchedAttrValues manual prefers launchedAttrValues', () => {
  const root = baseTask({ replicaFamilyScheduleMode: 'manual' });
  assert.deepEqual(
    listLastLaunchedAttrValues(root, {
      [root.id]: {
        attrValues: ['1', '2'],
        launchedAttrValues: ['1'],
        lastEnumAttrValues: ['2'],
      },
    }),
    ['1'],
  );
});

test('listLastLaunchedAttrValues auto prefers lastEnumAttrValues', () => {
  const root = baseTask({ replicaFamilyScheduleMode: 'auto' });
  assert.deepEqual(
    listLastLaunchedAttrValues(root, {
      [root.id]: {
        attrValues: ['1', '2'],
        launchedAttrValues: ['1'],
        lastEnumAttrValues: ['2'],
      },
    }),
    ['2'],
  );
});

test('listLastLaunchedAttrValues falls back when primary empty', () => {
  const manual = baseTask({ id: 'm', replicaFamilyScheduleMode: 'manual' });
  assert.deepEqual(
    listLastLaunchedAttrValues(manual, {
      m: { attrValues: ['2'], lastEnumAttrValues: ['2'] },
    }),
    ['2'],
  );
  const auto = baseTask({ id: 'a', replicaFamilyScheduleMode: 'auto' });
  assert.deepEqual(
    listLastLaunchedAttrValues(auto, {
      a: { attrValues: ['1'], launchedAttrValues: ['1'] },
    }),
    ['1'],
  );
});

test('listLaunchedAttrValuesWithFallback prefers current then last', () => {
  const root = baseTask({
    replicaFamilyScheduleMode: 'manual',
    replicaFamilyEnumSpec: 'item@id',
  });
  let tasks = mergeReplicaFamilyFromRelay(root, ['1', '2'], [root]).tasks;
  tasks = tasks.map(t =>
    t.replicaFamilyAttrValue === '1'
      ? { ...t, replicaFamilyLaunched: true }
      : t.replicaFamilyAttrValue === '2'
        ? { ...t, replicaFamilyLaunched: false }
        : t,
  );
  const syncedRoot = tasks.find(t => t.id === root.id)!;
  assert.deepEqual(
    listLaunchedAttrValuesWithFallback(syncedRoot, tasks, new Map(), {
      [root.id]: { attrValues: ['1', '2'], launchedAttrValues: ['2'] },
    }),
    ['1'],
  );

  tasks = tasks.map(t =>
    t.replicaFamilyRootId ? { ...t, replicaFamilyLaunched: false } : t,
  );
  assert.deepEqual(
    listLaunchedAttrValuesWithFallback(syncedRoot, tasks, new Map(), {
      [root.id]: { attrValues: ['1', '2'], launchedAttrValues: ['2'] },
    }),
    ['2'],
  );
});

test('resolveReplicaLaunchedPlaceholder falls back to last-launched list', () => {
  const root = baseTask({
    name: '副本族处理',
    replicaFamilyBaseName: '副本族处理',
    replicaFamilyScheduleMode: 'manual',
  });
  let tasks = mergeReplicaFamilyFromRelay(root, ['1', '2'], [root]).tasks;
  tasks = tasks.map(t =>
    t.replicaFamilyRootId ? { ...t, replicaFamilyLaunched: false } : t,
  );
  assert.equal(
    resolveReplicaLaunchedPlaceholder('副本族处理', tasks, new Map(), {
      [root.id]: { attrValues: ['1', '2'], launchedAttrValues: ['2'] },
    }),
    '2',
  );
});

test('prunePromptAutoSegmentInsertedOverrides drops unknown segment ids', () => {
  const pruned = prunePromptAutoSegmentInsertedOverrides(
    { keep: true, gone: false },
    [{ id: 'keep', slotId: 's', name: 'a', role: 'system', content: '', inserted: false, sortOrder: 0 }],
  );
  assert.deepEqual(pruned, { keep: true });
});

test('prunePromptAutoSegmentInsertedOverrides drops keys equal to root inserted', () => {
  const rootSegs = [
    { id: 'a', slotId: 's', name: 'A', role: 'system' as const, content: '', inserted: false, sortOrder: 0 },
    { id: 'b', slotId: 's', name: 'B', role: 'system' as const, content: '', inserted: true, sortOrder: 1 },
  ];
  const pruned = prunePromptAutoSegmentInsertedOverrides(
    { a: false, b: false, gone: true },
    rootSegs,
  );
  assert.deepEqual(pruned, { b: false });
});

test('patchPromptAutoSegmentInsertedOverride clears when matching root', () => {
  const rootSegs = [
    { id: 'a', slotId: 's', name: 'A', role: 'system' as const, content: '', inserted: false, sortOrder: 0 },
  ];
  const on = patchPromptAutoSegmentInsertedOverride(undefined, rootSegs, 'a', true);
  assert.deepEqual(on, { a: true });
  const off = patchPromptAutoSegmentInsertedOverride(on, rootSegs, 'a', false);
  assert.equal(off, undefined);
});

test('cloneAutoSegmentsFromRoot applies inserted overrides by id', () => {
  const root = baseTask({
    promptAutoSegments: [
      {
        id: 'seg-on',
        slotId: 'slot-1',
        name: 'A',
        role: 'system',
        content: 'hello {{item@id}}',
        inserted: false,
        sortOrder: 0,
      },
      {
        id: 'seg-off',
        slotId: 'slot-1',
        name: 'B',
        role: 'system',
        content: 'bye',
        inserted: true,
        sortOrder: 1,
      },
    ],
  });
  const cloned = cloneAutoSegmentsFromRoot(root, 'item@id', '1', {
    'seg-on': true,
    'seg-off': false,
  });
  assert.equal(cloned.find(s => s.id === 'seg-on')?.inserted, true);
  assert.equal(cloned.find(s => s.id === 'seg-off')?.inserted, false);
  assert.equal(cloned.find(s => s.id === 'seg-on')?.content, 'hello {{item@id=1}}');
});

test('syncReplicaFromRoot applies and preserves promptAutoSegmentInsertedOverrides', () => {
  const root = baseTask({
    promptAutoSlots: [{ id: 'slot-1', name: '风味', order: 0 }],
    promptAutoSegments: [
      {
        id: 'seg-a',
        slotId: 'slot-1',
        name: 'A',
        role: 'system',
        content: 'root {{item@id}}',
        inserted: false,
        sortOrder: 0,
      },
      {
        id: 'seg-b',
        slotId: 'slot-1',
        name: 'B',
        role: 'system',
        content: 'other',
        inserted: true,
        sortOrder: 1,
      },
    ],
  });
  const replica = {
    id: 'rep-1',
    name: '处理 item 1',
    enabled: true,
    stage: 2,
    promptGroups: [],
    replicaFamilyRootId: 'root-1',
    replicaFamilyAttrValue: '1',
    replicaFamilyLaunched: false,
    promptAutoSegmentInsertedOverrides: { 'seg-a': true, 'seg-b': false, 'stale': true },
  };
  const synced = syncReplicaFromRoot(replica, root);
  assert.deepEqual(synced.promptAutoSegmentInsertedOverrides, { 'seg-a': true, 'seg-b': false });
  assert.equal(synced.promptAutoSegments.find(s => s.id === 'seg-a')?.inserted, true);
  assert.equal(synced.promptAutoSegments.find(s => s.id === 'seg-b')?.inserted, false);
  assert.equal(synced.promptAutoSegments.find(s => s.id === 'seg-a')?.content, 'root {{item@id=1}}');

  const again = syncReplicaFromRoot(synced, {
    ...root,
    promptGroups: [{ name: '', role: 'user', content: 'v2 {{item@id}}', enabled: true }],
  });
  assert.deepEqual(again.promptAutoSegmentInsertedOverrides, { 'seg-a': true, 'seg-b': false });
  assert.equal(again.promptAutoSegments.find(s => s.id === 'seg-a')?.inserted, true);
});

test('syncReplicaFromRoot prunes overrides when root deletes a segment', () => {
  const root = baseTask({
    promptAutoSegments: [
      {
        id: 'seg-a',
        slotId: 'slot-1',
        name: 'A',
        role: 'system',
        content: 'x',
        inserted: false,
        sortOrder: 0,
      },
    ],
  });
  const replica = {
    id: 'rep-1',
    name: '处理 item 1',
    enabled: true,
    stage: 2,
    promptGroups: [],
    replicaFamilyRootId: 'root-1',
    replicaFamilyAttrValue: '1',
    promptAutoSegmentInsertedOverrides: { 'seg-a': true, 'seg-gone': false },
  };
  const synced = syncReplicaFromRoot(replica, root);
  assert.deepEqual(synced.promptAutoSegmentInsertedOverrides, { 'seg-a': true });

  const rootWithoutSeg = baseTask({ promptAutoSegments: [] });
  const pruned = syncReplicaFromRoot(synced, rootWithoutSeg);
  assert.equal(pruned.promptAutoSegmentInsertedOverrides, undefined);
  assert.deepEqual(pruned.promptAutoSegments, []);
});

test('syncReplicaFromRoot clears sticky overrides that equal root inserted', () => {
  const root = baseTask({
    promptAutoSegments: [
      {
        id: 'seg-a',
        slotId: 'slot-1',
        name: 'A',
        role: 'system',
        content: 'x',
        inserted: true,
        sortOrder: 0,
      },
    ],
  });
  const replica = {
    id: 'rep-1',
    name: '处理 item 1',
    enabled: true,
    stage: 2,
    promptGroups: [],
    replicaFamilyRootId: 'root-1',
    replicaFamilyAttrValue: '1',
    // 粘住但与原本相同
    promptAutoSegmentInsertedOverrides: { 'seg-a': true },
  };
  const synced = syncReplicaFromRoot(replica, root);
  assert.equal(synced.promptAutoSegmentInsertedOverrides, undefined);
  assert.equal(synced.promptAutoSegments.find(s => s.id === 'seg-a')?.inserted, true);
});

test('assertReplicaMemberPatchAllowed allows promptAutoSegmentInsertedOverrides', () => {
  const member = {
    id: 'rep-1',
    replicaFamilyRootId: 'root-1',
    replicaFamilyAttrValue: '1',
  } as PostProcessTask;
  assert.doesNotThrow(() =>
    assertReplicaMemberPatchAllowed(member, { promptAutoSegmentInsertedOverrides: { a: true } }),
  );
  assert.throws(() => assertReplicaMemberPatchAllowed(member, { promptGroups: [] }));
});

test('renameReplicaFamilyMemberAttr keeps id launched and remirrors name', () => {
  const root = baseTask({
    syncAsReplicaFamily: true,
    replicaFamilyBaseName: '处理 item',
    replicaFamilySpec: 'item@id',
  });
  let tasks = mergeReplicaFamilyFromRelay(root, ['断剑'], [root]).tasks;
  const member = tasks.find(t => t.replicaFamilyAttrValue === '断剑')!;
  const memberId = member.id;
  tasks = tasks.map(t =>
    t.id === memberId ? { ...t, replicaFamilyLaunched: true, apiPresetMode: 'custom' as const, apiPresetName: '专属' } : t,
  );
  const liveRoot = tasks.find(t => t.id === root.id)!;
  const result = renameReplicaFamilyMemberAttr(liveRoot, '断剑', '锈剑', tasks);
  assert.equal(result.renamed, true);
  const renamed = result.tasks.find(t => t.id === memberId)!;
  assert.equal(renamed.replicaFamilyAttrValue, '锈剑');
  assert.equal(renamed.name, '处理 item 锈剑');
  assert.equal(renamed.replicaFamilyLaunched, true);
  assert.equal(renamed.apiPresetMode, 'custom');
  assert.equal(renamed.apiPresetName, '专属');
  assert.ok(renamed.promptGroups[0]?.content.includes('{{item@id=锈剑}}'));
});

test('renameReplicaFamilyMemberAttr skips when to exists', () => {
  const root = baseTask({ syncAsReplicaFamily: true, replicaFamilyBaseName: '处理 item' });
  const tasks = mergeReplicaFamilyFromRelay(root, ['1', '2'], [root]).tasks;
  const liveRoot = tasks.find(t => t.id === root.id)!;
  const result = renameReplicaFamilyMemberAttr(liveRoot, '1', '2', tasks);
  assert.equal(result.renamed, false);
  assert.ok(result.skipReason?.includes('已存在'));
  assert.equal(tasks.find(t => t.replicaFamilyAttrValue === '1')?.replicaFamilyAttrValue, '1');
});

test('rename then merge with new value does not create duplicate', () => {
  const root = baseTask({ syncAsReplicaFamily: true, replicaFamilyBaseName: '处理 item' });
  let tasks = mergeReplicaFamilyFromRelay(root, ['断剑'], [root]).tasks;
  const memberId = tasks.find(t => t.replicaFamilyAttrValue === '断剑')!.id;
  const liveRoot = tasks.find(t => t.id === root.id)!;
  tasks = renameReplicaFamilyMemberAttr(liveRoot, '断剑', '锈剑', tasks).tasks;
  const merged = mergeReplicaFamilyFromRelay(
    tasks.find(t => t.id === root.id)!,
    ['锈剑'],
    tasks,
  );
  assert.equal(merged.newlyCreatedIds.length, 0);
  assert.equal(merged.tasks.filter(t => t.replicaFamilyRootId === root.id).length, 1);
  assert.equal(merged.tasks.find(t => t.id === memberId)?.replicaFamilyAttrValue, '锈剑');
});

test('merge reuses member when enum middle-dot variant differs', () => {
  const root = baseTask({
    replicaFamilySpec: 'npc@act',
    replicaFamilyEnumSpec: 'npc@act',
    promptGroups: [{ name: '', role: 'user', content: 'do {{npc@act}}', enabled: true }],
  });
  const merged = mergeReplicaFamilyFromRelay(root, ['波尔特・瓦伦'], [root]);
  const member = merged.tasks.find(t => t.replicaFamilyRootId === root.id)!;
  assert.equal(member.replicaFamilyAttrValue, '波尔特·瓦伦');
  const patched = merged.tasks.map(t =>
    t.id === member.id ? { ...t, replicaFamilyAttrValue: '波尔特・瓦伦' } : t,
  );
  const again = mergeReplicaFamilyFromRelay(
    patched.find(t => t.id === root.id)!,
    ['波尔特·瓦伦'],
    patched,
  );
  assert.equal(again.newlyCreatedIds.length, 0);
  assert.equal(again.tasks.filter(t => t.replicaFamilyRootId === root.id).length, 1);
  assert.equal(again.tasks.find(t => t.id === member.id)?.id, member.id);
});

test('renameReplicaFamilyMemberAttr no-ops when from and to are the same identity', () => {
  const root = baseTask();
  const tasks = mergeReplicaFamilyFromRelay(root, ['波尔特・瓦伦'], [root]).tasks;
  const liveRoot = tasks.find(t => t.id === root.id)!;
  const result = renameReplicaFamilyMemberAttr(liveRoot, '波尔特・瓦伦', '波尔特·瓦伦', tasks);
  assert.equal(result.renamed, false);
});

if (process.exitCode) process.exit(process.exitCode);
