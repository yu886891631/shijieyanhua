import assert from 'node:assert/strict';
import type { PostProcessTask, ScriptSettings } from './schema';
import {
  applyReplicaFamilyCleanup,
  canonicalizeLastManualKeepMap,
  canonicalSpecKey,
  computeAutoKeepSet,
  computeManualDialogDefaultSelection,
  createDefaultReplicaFamilyCleanup,
  ensureReplicaFamilyCleanupDefaults,
  incrementReplicaOpportunityCounts,
  incrementReplicaRunCounts,
  incrementReplicaScheduleWaitCounts,
  listAllAttrValuesForEnumSpec,
  listReplicaFamilyCleanupCandidates,
  migrateActivityRatioToMinTries,
  migrateLastManualKeepByRootToSpec,
  pruneFloorTagKeysForReplica,
  migrateFloorTagKeysForReplica,
  reconcileOpportunityCountsWithRuns,
  shouldTriggerCleanup,
  tickCleanupRound,
} from './replica-family-cleanup';

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`, e);
    process.exitCode = 1;
  }
}

function withAccessibleMessageFloor(messageId: number, fn: () => void): void {
  const g = globalThis as Record<string, unknown>;
  const prev = {
    getChatMessages: g.getChatMessages,
    getVariables: g.getVariables,
  };
  g.getChatMessages = (id: number) => {
    if (id === messageId) {
      return [{ role: 'assistant', message: 'reply', message_id: messageId }];
    }
    return [];
  };
  g.getVariables = (opt: { type: string; message_id?: number }) => {
    if (opt.type === 'message' && opt.message_id === messageId) return {};
    throw new Error('floor inaccessible');
  };
  try {
    fn();
  } finally {
    g.getChatMessages = prev.getChatMessages;
    g.getVariables = prev.getVariables;
  }
}

function baseTask(overrides: Partial<PostProcessTask> = {}): PostProcessTask {
  return {
    id: 'root',
    name: 'root',
    enabled: true,
    stage: 2,
    syncAsReplicaFamily: true,
    replicaFamilySpec: 'item@id',
    replicaFamilyEnumSpec: 'item@id',
    replicaFamilyScheduleMode: 'manual',
    promptGroups: [],
    extractInjectTags: [],
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

function baseSettings(overrides: Partial<ScriptSettings> = {}): ScriptSettings {
  const root = baseTask();
  const rep1 = baseTask({
    id: 'rep-1',
    name: 'rep 1',
    syncAsReplicaFamily: false,
    replicaFamilyRootId: 'root',
    replicaFamilyAttrValue: '1',
    replicaFamilyLaunched: true,
    replicaFamilySpec: 'item@id',
  });
  const rep2 = baseTask({
    id: 'rep-2',
    name: 'rep 2',
    syncAsReplicaFamily: false,
    replicaFamilyRootId: 'root',
    replicaFamilyAttrValue: '2',
    replicaFamilyLaunched: false,
    replicaFamilySpec: 'item@id',
  });
  return {
    enabled: true,
    tasks: [root, rep1, rep2],
    replicaFamilyCleanup: {
      enabled: true,
      cycleRounds: 4,
      minActivityTries: 1,
      mode: 'auto',
      roundsSinceCleanup: 0,
      // 仅 rep-1 有成功/试过；rep-2 无记录则不靠活跃保留（仍可被 launched/保护保留）
      cycleRunCounts: { 'rep-1': 2 },
      cycleOpportunityCounts: { 'rep-1': 2 },
      cycleScheduleWaitCounts: {},
      lastManualKeepBySpec: {},
      lastCleanupRound: 0,
    },
    ...overrides,
  } as ScriptSettings;
}

test('computeAutoKeepSet keeps launched manual and active replicas by spec', () => {
  const settings = baseSettings();
  const keep = computeAutoKeepSet(settings);
  assert.deepEqual(Object.keys(keep), ['item@id']);
  assert.deepEqual(keep['item@id'], ['1']);
});

test('computeAutoKeepSet protects newly created members in same cleanup round', () => {
  const settings = baseSettings();
  const keep = computeAutoKeepSet(settings, ['rep-2']);
  assert.deepEqual(keep['item@id']!.sort(), ['1', '2']);
});

test('computeAutoKeepSet ignores lastManualKeepBySpec when not launched or active', () => {
  const settings = baseSettings({
    replicaFamilyCleanup: {
      ...baseSettings().replicaFamilyCleanup!,
      lastManualKeepBySpec: { 'item@id': ['2'] },
    },
  });
  const keep = computeAutoKeepSet(settings);
  assert.deepEqual(keep['item@id'], ['1']);
});

test('computeManualDialogDefaultSelection includes last manual keep', () => {
  const settings = baseSettings({
    replicaFamilyCleanup: {
      ...baseSettings().replicaFamilyCleanup!,
      lastManualKeepBySpec: { 'item@id': ['2'] },
    },
  });
  const keep = computeManualDialogDefaultSelection(settings);
  assert.deepEqual(keep['item@id']!.sort(), ['1', '2']);
});

test('computeManualDialogDefaultSelection protects newly created members', () => {
  const settings = baseSettings();
  const keep = computeManualDialogDefaultSelection(settings, ['rep-2']);
  assert.deepEqual(keep['item@id']!.sort(), ['1', '2']);
});

test('listReplicaFamilyCleanupCandidates groups by spec and dedupes attr', () => {
  const settings = baseSettings({
    replicaFamilyCleanup: {
      ...baseSettings().replicaFamilyCleanup!,
      lastManualKeepBySpec: { 'item@id': ['2'] },
    },
  });
  const groups = listReplicaFamilyCleanupCandidates(settings);
  assert.equal(groups.length, 1);
  assert.equal(groups[0]!.spec, 'item@id');
  assert.equal(groups[0]!.members.length, 2);
  const rep2 = groups[0]!.members.find(m => m.attrValue === '2');
  assert.equal(rep2?.defaultSelected, true);
  assert.equal(rep2?.memberId, '2');
});

test('listReplicaFamilyCleanupCandidates marks protected new members as defaultSelected', () => {
  const settings = baseSettings();
  const groups = listReplicaFamilyCleanupCandidates(settings, ['rep-2']);
  const rep2 = groups[0]!.members.find(m => m.attrValue === '2');
  assert.equal(rep2?.defaultSelected, true);
});

test('tickCleanupRound and shouldTriggerCleanup', () => {
  const settings = baseSettings();
  for (let i = 0; i < 3; i++) tickCleanupRound(settings);
  assert.equal(shouldTriggerCleanup(settings), false);
  tickCleanupRound(settings);
  assert.equal(shouldTriggerCleanup(settings), true);
});

test('applyReplicaFamilyCleanup removes unkept replica tasks by spec', () => {
  withAccessibleMessageFloor(0, () => {
    const g = globalThis as Record<string, unknown>;
    g.updateVariablesWith = (fn: (v: Record<string, unknown>) => Record<string, unknown>) => fn({});
    const settings = baseSettings();
    const next = applyReplicaFamilyCleanup(settings, { 'item@id': ['1'] }, 0);
    assert.equal(next.tasks.filter(t => t.replicaFamilyRootId === 'root').length, 1);
    assert.equal(next.tasks.find(t => t.replicaFamilyAttrValue === '2'), undefined);
    assert.equal(next.replicaFamilyCleanup.roundsSinceCleanup, 0);
  });
});

test('applyReplicaFamilyCleanup ignores specs absent from keep map', () => {
  withAccessibleMessageFloor(0, () => {
    const g = globalThis as Record<string, unknown>;
    g.updateVariablesWith = (fn: (v: Record<string, unknown>) => Record<string, unknown>) => fn({});
    const worldRoot = baseTask({
      id: 'world',
      name: '世界时局与经济简报',
      replicaFamilySpec: '世界状态摘要@world',
      replicaFamilyEnumSpec: '世界状态摘要@world',
      replicaFamilyBaseName: '世界时局与经济简报',
    });
    const worldA = baseTask({
      id: 'world-a',
      name: '世界 A',
      syncAsReplicaFamily: false,
      replicaFamilyRootId: 'world',
      replicaFamilyAttrValue: '阿斯塔利亚',
      replicaFamilySpec: '世界状态摘要@world',
    });
    const worldB = baseTask({
      ...worldA,
      id: 'world-b',
      name: '世界 B',
      replicaFamilyAttrValue: '另一世界',
    });
    const settings = baseSettings({
      tasks: [...baseSettings().tasks, worldRoot, worldA, worldB],
    });
    const next = applyReplicaFamilyCleanup(settings, { '世界状态摘要@world': ['阿斯塔利亚'] }, 0);
    assert.equal(next.tasks.filter(t => t.replicaFamilyRootId === 'root').length, 2);
    assert.equal(next.tasks.filter(t => t.replicaFamilyRootId === 'world').length, 1);
    assert.ok(next.tasks.find(t => t.replicaFamilyAttrValue === '阿斯塔利亚'));
    assert.equal(next.tasks.find(t => t.replicaFamilyAttrValue === '另一世界'), undefined);
  });
});

test('applyReplicaFamilyCleanup without persist leaves lastManualKeepBySpec unchanged', () => {
  withAccessibleMessageFloor(0, () => {
    const g = globalThis as Record<string, unknown>;
    g.updateVariablesWith = (fn: (v: Record<string, unknown>) => Record<string, unknown>) => fn({});
    const settings = baseSettings({
      replicaFamilyCleanup: {
        ...baseSettings().replicaFamilyCleanup!,
        lastManualKeepBySpec: { 'item@id': ['9'] },
      },
    });
    applyReplicaFamilyCleanup(settings, { 'item@id': ['1'] }, 0);
    assert.deepEqual(settings.replicaFamilyCleanup!.lastManualKeepBySpec, { 'item@id': ['9'] });
  });
});

test('applyReplicaFamilyCleanup with persist writes only user selection', () => {
  withAccessibleMessageFloor(0, () => {
    const g = globalThis as Record<string, unknown>;
    g.updateVariablesWith = (fn: (v: Record<string, unknown>) => Record<string, unknown>) => fn({});
    const settings = baseSettings({
      replicaFamilyCleanup: {
        ...baseSettings().replicaFamilyCleanup!,
        lastManualKeepBySpec: { 'item@id': ['9'] },
      },
    });
    applyReplicaFamilyCleanup(settings, { 'item@id': ['1'] }, 0, {
      persistManualKeepBySpec: { 'item@id': ['1'] },
    });
    assert.deepEqual(settings.replicaFamilyCleanup!.lastManualKeepBySpec, { 'item@id': ['1'] });
  });
});

test('dual family same spec: active attr kept on both; inactive removed from both', () => {
  withAccessibleMessageFloor(0, () => {
    const g = globalThis as Record<string, unknown>;
    let pruneCalls: Array<{ spec: string; attrs: string[] }> = [];
    g.updateVariablesWith = (fn: (v: Record<string, unknown>) => Record<string, unknown>) => fn({});

    const rootA = baseTask({ id: 'root-a', name: '族A', replicaFamilyBaseName: '族A' });
    const rootB = baseTask({ id: 'root-b', name: '族B', replicaFamilyBaseName: '族B' });
    const a1 = baseTask({
      id: 'a-1',
      syncAsReplicaFamily: false,
      replicaFamilyRootId: 'root-a',
      replicaFamilyAttrValue: '1',
      replicaFamilyLaunched: true,
      extractInjectTags: ['item@id'],
    });
    const a2 = baseTask({
      id: 'a-2',
      syncAsReplicaFamily: false,
      replicaFamilyRootId: 'root-a',
      replicaFamilyAttrValue: '2',
      replicaFamilyLaunched: false,
      extractInjectTags: ['item@id'],
    });
    const b1 = baseTask({
      id: 'b-1',
      syncAsReplicaFamily: false,
      replicaFamilyRootId: 'root-b',
      replicaFamilyAttrValue: '1',
      replicaFamilyLaunched: false,
      extractInjectTags: ['note@name'],
    });
    const b2 = baseTask({
      id: 'b-2',
      syncAsReplicaFamily: false,
      replicaFamilyRootId: 'root-b',
      replicaFamilyAttrValue: '2',
      replicaFamilyLaunched: false,
      extractInjectTags: ['note@name'],
    });
    const settings = baseSettings({
      tasks: [rootA, rootB, a1, a2, b1, b2],
      replicaFamilyCleanup: {
        enabled: true,
        cycleRounds: 4,
        minActivityTries: 1,
        mode: 'auto',
        roundsSinceCleanup: 0,
        cycleRunCounts: { 'a-1': 2 },
        cycleOpportunityCounts: { 'a-1': 2 },
        lastManualKeepBySpec: {},
        lastCleanupRound: 0,
      },
    });

    const keep = computeAutoKeepSet(settings);
    assert.deepEqual(keep['item@id'], ['1']);

    const origPrune = pruneFloorTagKeysForReplica;
    // spy via re-apply path: count updateVariablesWith for item@id and note@name
    let vars: Record<string, unknown> = {
      post_process_tags: {
        item_id: { '1': 'a', '2': 'b' },
        note_name: { '1': 'n1', '2': 'n2' },
        'item@id=2': 'flat',
        'note@name=2': 'flat-n',
      },
    };
    g.updateVariablesWith = (
      fn: (v: Record<string, unknown>) => Record<string, unknown>,
      _opts: unknown,
    ) => {
      vars = fn(vars);
      return vars;
    };

    const next = applyReplicaFamilyCleanup(settings, keep, 0);
    assert.ok(next.tasks.find(t => t.id === 'a-1'));
    assert.ok(next.tasks.find(t => t.id === 'b-1'));
    assert.equal(next.tasks.find(t => t.id === 'a-2'), undefined);
    assert.equal(next.tasks.find(t => t.id === 'b-2'), undefined);

    const tags = vars.post_process_tags as Record<string, unknown>;
    assert.deepEqual(tags.item_id, { '1': 'a' });
    assert.deepEqual(tags.note_name, { '1': 'n1' });
    assert.equal(tags['item@id=2'], undefined);
    assert.equal(tags['note@name=2'], undefined);
    void origPrune;
    void pruneCalls;
  });
});

test('settings-style delete keeps sibling-family unique attrs', () => {
  withAccessibleMessageFloor(0, () => {
    const g = globalThis as Record<string, unknown>;
    g.updateVariablesWith = (fn: (v: Record<string, unknown>) => Record<string, unknown>) => fn({});
    const rootA = baseTask({ id: 'root-a', name: '族A' });
    const rootB = baseTask({ id: 'root-b', name: '族B' });
    const a1 = baseTask({
      id: 'a-1',
      syncAsReplicaFamily: false,
      replicaFamilyRootId: 'root-a',
      replicaFamilyAttrValue: '1',
      replicaFamilyLaunched: true,
    });
    const aShared = baseTask({
      id: 'a-s',
      syncAsReplicaFamily: false,
      replicaFamilyRootId: 'root-a',
      replicaFamilyAttrValue: 'shared',
      replicaFamilyLaunched: true,
    });
    const bShared = baseTask({
      id: 'b-s',
      syncAsReplicaFamily: false,
      replicaFamilyRootId: 'root-b',
      replicaFamilyAttrValue: 'shared',
      replicaFamilyLaunched: true,
    });
    const bOnly = baseTask({
      id: 'b-3',
      syncAsReplicaFamily: false,
      replicaFamilyRootId: 'root-b',
      replicaFamilyAttrValue: '3',
      replicaFamilyLaunched: true,
    });
    const settings = baseSettings({
      tasks: [rootA, rootB, a1, aShared, bShared, bOnly],
    });
    const all = listAllAttrValuesForEnumSpec(settings, 'item@id');
    assert.deepEqual(all, ['1', '3', 'shared']);
    const keep = all.filter(a => a !== 'shared');
    const next = applyReplicaFamilyCleanup(settings, { 'item@id': keep }, 0);
    assert.ok(next.tasks.find(t => t.replicaFamilyAttrValue === '1'));
    assert.ok(next.tasks.find(t => t.replicaFamilyAttrValue === '3'));
    assert.equal(next.tasks.find(t => t.replicaFamilyAttrValue === 'shared'), undefined);
  });
});

test('migrateLastManualKeepByRootToSpec unions attrs by enumSpec', () => {
  const settings = baseSettings({
    replicaFamilyCleanup: {
      ...baseSettings().replicaFamilyCleanup!,
      lastManualKeepBySpec: {},
      lastManualKeepByRoot: { root: ['2', '9'] },
    } as ScriptSettings['replicaFamilyCleanup'],
  });
  migrateLastManualKeepByRootToSpec(settings);
  assert.deepEqual(settings.replicaFamilyCleanup!.lastManualKeepBySpec['item@id']!.sort(), ['2', '9']);
  assert.equal(settings.replicaFamilyCleanup!.lastManualKeepByRoot, undefined);
});

test('canonicalSpecKey lowercases and trims', () => {
  assert.equal(canonicalSpecKey('  Item@ID  '), 'item@id');
});

test('manual default selection finds lastManualKeep despite casing mismatch', () => {
  const settings = baseSettings({
    replicaFamilyCleanup: {
      ...baseSettings().replicaFamilyCleanup!,
      lastManualKeepBySpec: { 'Item@ID': ['2'] },
    },
  });
  const keep = computeManualDialogDefaultSelection(settings);
  assert.deepEqual(keep['item@id']!.sort(), ['1', '2']);
  const groups = listReplicaFamilyCleanupCandidates(settings);
  assert.equal(groups[0]!.spec, 'item@id');
  assert.equal(groups[0]!.members.find(m => m.attrValue === '2')?.defaultSelected, true);
});

test('canonicalizeLastManualKeepMap merges case variants', () => {
  const merged = canonicalizeLastManualKeepMap({
    'Item@ID': ['2'],
    'item@id': ['9', '2'],
    'NPC@id': ['a'],
  });
  assert.deepEqual(Object.keys(merged).sort(), ['item@id', 'npc@id']);
  assert.deepEqual(merged['item@id']!.sort(), ['2', '9']);
  assert.deepEqual(merged['npc@id'], ['a']);
});

test('persistManualKeepBySpec writes canonical keys only', () => {
  withAccessibleMessageFloor(0, () => {
    const g = globalThis as Record<string, unknown>;
    g.updateVariablesWith = (fn: (v: Record<string, unknown>) => Record<string, unknown>) => fn({});
    const settings = baseSettings({
      replicaFamilyCleanup: {
        ...baseSettings().replicaFamilyCleanup!,
        lastManualKeepBySpec: { 'Item@ID': ['9'] },
      },
    });
    applyReplicaFamilyCleanup(settings, { 'ITEM@ID': ['1'] }, 0, {
      persistManualKeepBySpec: { 'Item@ID': ['1'] },
    });
    assert.deepEqual(settings.replicaFamilyCleanup!.lastManualKeepBySpec, { 'item@id': ['1'] });
  });
});

test('ensureReplicaFamilyCleanupDefaults canonicalizes mixed-case keep map', () => {
  const settings = baseSettings({
    replicaFamilyCleanup: {
      ...baseSettings().replicaFamilyCleanup!,
      lastManualKeepBySpec: { 'Item@ID': ['2'], 'item@id': ['3'] },
    },
  });
  ensureReplicaFamilyCleanupDefaults(settings);
  assert.deepEqual(settings.replicaFamilyCleanup!.lastManualKeepBySpec, {
    'item@id': ['2', '3'],
  });
});

test('pruneFloorTagKeysForReplica removes nested and flat keys for unkept attrs', () => {
  withAccessibleMessageFloor(0, () => {
    const g = globalThis as Record<string, unknown>;
    let vars: Record<string, unknown> = {
      post_process_tags: {
        item_id: { '1': 'keep-me', '2': 'drop-me' },
        'item@id=1': 'flat-keep',
        'item@id=2': 'flat-drop',
      },
    };
    g.updateVariablesWith = (
      fn: (v: Record<string, unknown>) => Record<string, unknown>,
      _opts: unknown,
    ) => {
      vars = fn(vars);
      return vars;
    };
    pruneFloorTagKeysForReplica('item@id', ['2'], 0);
    const tags = vars.post_process_tags as Record<string, unknown>;
    assert.deepEqual(tags.item_id, { '1': 'keep-me' });
    assert.equal(tags['item@id=1'], 'flat-keep');
    assert.equal(tags['item@id=2'], undefined);
  });
});

test('pruneFloorTagKeysForReplica skips inaccessible message floor', () => {
  const g = globalThis as Record<string, unknown>;
  let vars: Record<string, unknown> = {
    post_process_tags: { 'item@id=2': 'flat-drop' },
  };
  let updateCalled = false;
  g.getChatMessages = () => [];
  g.updateVariablesWith = (
    fn: (v: Record<string, unknown>) => Record<string, unknown>,
    _opts: unknown,
  ) => {
    updateCalled = true;
    vars = fn(vars);
    return vars;
  };
  pruneFloorTagKeysForReplica('item@id', ['2'], 0);
  assert.equal(updateCalled, false);
  assert.equal((vars.post_process_tags as Record<string, unknown>)['item@id=2'], 'flat-drop');
});

test('migrateFloorTagKeysForReplica moves nested and flat keys', () => {
  withAccessibleMessageFloor(0, () => {
    const g = globalThis as Record<string, unknown>;
    let vars: Record<string, unknown> = {
      post_process_tags: {
        item_id: { '断剑': 'content-a', '药剂': 'keep' },
        'item@id=断剑': 'flat-a',
        'item@id=药剂': 'flat-keep',
      },
    };
    g.updateVariablesWith = (
      fn: (v: Record<string, unknown>) => Record<string, unknown>,
      _opts: unknown,
    ) => {
      vars = fn(vars);
      return vars;
    };
    const ok = migrateFloorTagKeysForReplica('item@id', '断剑', '锈剑', 0);
    assert.equal(ok, true);
    const tags = vars.post_process_tags as Record<string, unknown>;
    assert.deepEqual(tags.item_id, { '锈剑': 'content-a', '药剂': 'keep' });
    assert.equal(tags['item@id=锈剑'], 'flat-a');
    assert.equal(tags['item@id=断剑'], undefined);
    assert.equal(tags['item@id=药剂'], 'flat-keep');
  });
});

test('migrateFloorTagKeysForReplica skips when target exists', () => {
  withAccessibleMessageFloor(0, () => {
    const g = globalThis as Record<string, unknown>;
    let vars: Record<string, unknown> = {
      post_process_tags: {
        item_id: { a: 'from', b: 'to-keep' },
        'item@id=a': 'flat-from',
        'item@id=b': 'flat-to',
      },
    };
    g.updateVariablesWith = (
      fn: (v: Record<string, unknown>) => Record<string, unknown>,
      _opts: unknown,
    ) => {
      vars = fn(vars);
      return vars;
    };
    const ok = migrateFloorTagKeysForReplica('item@id', 'a', 'b', 0);
    assert.equal(ok, false);
    const tags = vars.post_process_tags as Record<string, unknown>;
    assert.deepEqual(tags.item_id, { a: 'from', b: 'to-keep' });
    assert.equal(tags['item@id=a'], 'flat-from');
    assert.equal(tags['item@id=b'], 'flat-to');
  });
});

test('incrementReplicaRunCounts accumulates per member', () => {
  const settings = baseSettings();
  incrementReplicaRunCounts(settings, ['rep-1', 'rep-1']);
  assert.equal(settings.replicaFamilyCleanup!.cycleRunCounts['rep-1'], 4);
  // 不变量：opportunity ≥ run
  assert.equal(settings.replicaFamilyCleanup!.cycleOpportunityCounts['rep-1'], 4);
});

test('incrementReplicaOpportunityCounts marks try without success', () => {
  const settings = baseSettings({
    replicaFamilyCleanup: {
      ...baseSettings().replicaFamilyCleanup!,
      cycleRunCounts: {},
      cycleOpportunityCounts: {},
    },
  });
  incrementReplicaOpportunityCounts(settings, ['rep-2']);
  assert.equal(settings.replicaFamilyCleanup!.cycleOpportunityCounts['rep-2'], 1);
  assert.equal(settings.replicaFamilyCleanup!.cycleRunCounts['rep-2'], undefined);
  const keep = computeAutoKeepSet(settings);
  assert.deepEqual(keep['item@id']!.sort(), ['1', '2']);
});

test('reconcileOpportunityCountsWithRuns seeds from runCount', () => {
  const settings = baseSettings({
    replicaFamilyCleanup: {
      ...baseSettings().replicaFamilyCleanup!,
      cycleRunCounts: { 'rep-2': 3 },
      cycleOpportunityCounts: {},
    },
  });
  reconcileOpportunityCountsWithRuns(settings.replicaFamilyCleanup!);
  assert.equal(settings.replicaFamilyCleanup!.cycleOpportunityCounts['rep-2'], 3);
  const keep = computeAutoKeepSet(settings);
  assert.ok(keep['item@id']!.includes('2'));
});

test('applyReplicaFamilyCleanup clears opportunity counts', () => {
  withAccessibleMessageFloor(0, () => {
    const g = globalThis as Record<string, unknown>;
    g.updateVariablesWith = (fn: (v: Record<string, unknown>) => Record<string, unknown>) => fn({});
    const settings = baseSettings({
      replicaFamilyCleanup: {
        ...baseSettings().replicaFamilyCleanup!,
        cycleOpportunityCounts: { 'rep-1': 2, 'rep-2': 1 },
      },
    });
    const next = applyReplicaFamilyCleanup(settings, { 'item@id': ['1'] }, 0);
    assert.deepEqual(next.replicaFamilyCleanup.cycleOpportunityCounts, {});
    assert.deepEqual(next.replicaFamilyCleanup.cycleRunCounts, {});
  });
});

test('createDefaultReplicaFamilyCleanup enables auto mode when replica family exists', () => {
  const defaults = createDefaultReplicaFamilyCleanup(true);
  assert.equal(defaults.enabled, true);
  assert.equal(defaults.mode, 'auto');
  assert.deepEqual(defaults.cycleOpportunityCounts, {});
  assert.deepEqual(defaults.cycleScheduleWaitCounts, {});
});

test('createDefaultReplicaFamilyCleanup stays disabled when no replica family', () => {
  const defaults = createDefaultReplicaFamilyCleanup(false);
  assert.equal(defaults.enabled, false);
  assert.equal(defaults.mode, 'manual');
});

test('ensureReplicaFamilyCleanupDefaults upgrades untouched factory defaults', () => {
  const settings = baseSettings({
    replicaFamilyCleanup: createDefaultReplicaFamilyCleanup(false),
  });
  ensureReplicaFamilyCleanupDefaults(settings);
  assert.equal(settings.replicaFamilyCleanup!.enabled, true);
  assert.equal(settings.replicaFamilyCleanup!.mode, 'auto');
});

test('listReplicaFamilyCleanupCandidates exposes opportunityCount', () => {
  const settings = baseSettings({
    replicaFamilyCleanup: {
      ...baseSettings().replicaFamilyCleanup!,
      cycleRunCounts: {},
      cycleOpportunityCounts: { 'rep-2': 1 },
    },
  });
  const groups = listReplicaFamilyCleanupCandidates(settings);
  const rep2 = groups[0]!.members.find(m => m.attrValue === '2');
  assert.equal(rep2?.opportunityCount, 1);
  assert.equal(rep2?.runCount, 0);
  assert.equal(rep2?.defaultSelected, true);
});

test('minActivityTries=2 requires two opportunities', () => {
  const settings = baseSettings({
    replicaFamilyCleanup: {
      ...baseSettings().replicaFamilyCleanup!,
      minActivityTries: 2,
      cycleRunCounts: {},
      cycleOpportunityCounts: { 'rep-2': 1 },
    },
  });
  assert.deepEqual(computeAutoKeepSet(settings)['item@id'], ['1']);
  settings.replicaFamilyCleanup!.cycleOpportunityCounts['rep-2'] = 2;
  assert.deepEqual(computeAutoKeepSet(settings)['item@id']!.sort(), ['1', '2']);
});

test('minActivityTries=0 keeps inactive by activity gate', () => {
  const settings = baseSettings({
    replicaFamilyCleanup: {
      ...baseSettings().replicaFamilyCleanup!,
      minActivityTries: 0,
      cycleRunCounts: {},
      cycleOpportunityCounts: {},
    },
  });
  assert.deepEqual(computeAutoKeepSet(settings)['item@id']!.sort(), ['1', '2']);
});

test('migrateActivityRatioToMinTries maps ratio to tries', () => {
  const zero = {
    ...createDefaultReplicaFamilyCleanup(false),
    activityRatio: 0,
    minActivityTries: 1,
  };
  migrateActivityRatioToMinTries(zero);
  assert.equal(zero.minActivityTries, 0);
  assert.equal(zero.activityRatio, undefined);

  const half = {
    ...createDefaultReplicaFamilyCleanup(false),
    activityRatio: 0.5,
    minActivityTries: 1,
  };
  migrateActivityRatioToMinTries(half);
  assert.equal(half.minActivityTries, 1);
  assert.equal(half.activityRatio, undefined);
});

test('schedule wait keeps member without opportunity', () => {
  const settings = baseSettings({
    replicaFamilyCleanup: {
      ...baseSettings().replicaFamilyCleanup!,
      minActivityTries: 1,
      cycleRunCounts: {},
      cycleOpportunityCounts: {},
      cycleScheduleWaitCounts: { 'rep-2': 1 },
    },
  });
  assert.deepEqual(computeAutoKeepSet(settings)['item@id']!.sort(), ['1', '2']);
});

test('no wait and no opportunity is inactive', () => {
  const settings = baseSettings({
    replicaFamilyCleanup: {
      ...baseSettings().replicaFamilyCleanup!,
      cycleRunCounts: {},
      cycleOpportunityCounts: {},
      cycleScheduleWaitCounts: {},
    },
  });
  assert.deepEqual(computeAutoKeepSet(settings)['item@id'], ['1']);
});

test('incrementReplicaScheduleWaitCounts and apply clears waits', () => {
  withAccessibleMessageFloor(0, () => {
    const g = globalThis as Record<string, unknown>;
    g.updateVariablesWith = (fn: (v: Record<string, unknown>) => Record<string, unknown>) => fn({});
    const settings = baseSettings({
      replicaFamilyCleanup: {
        ...baseSettings().replicaFamilyCleanup!,
        cycleScheduleWaitCounts: {},
      },
    });
    incrementReplicaScheduleWaitCounts(settings, ['rep-2', 'rep-2']);
    assert.equal(settings.replicaFamilyCleanup!.cycleScheduleWaitCounts['rep-2'], 2);
    const next = applyReplicaFamilyCleanup(settings, { 'item@id': ['1'] }, 0);
    assert.deepEqual(next.replicaFamilyCleanup.cycleScheduleWaitCounts, {});
  });
});

