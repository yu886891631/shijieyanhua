import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PostProcessTask } from './schema';
import {
  applyLastEnumToReplicaSnapshot,
  applyReplicaStateToTasks,
  buildReplicaStateFromTasks,
  mergeReplicaStateForRerun,
  mergeReplicaStateSnapshots,
  normalizeReplicaStateSnapshot,
} from './replica-state';

function rootTask(overrides: Partial<PostProcessTask> = {}): PostProcessTask {
  return {
    id: 'root',
    name: '物品',
    enabled: true,
    stage: 1,
    promptGroups: [],
    syncAsReplicaFamily: true,
    replicaFamilySpec: 'item@name',
    replicaFamilyBaseName: '物品',
    replicaFamilyScheduleMode: 'auto',
    ...overrides,
  } as PostProcessTask;
}

function memberTask(attrValue: string, overrides: Partial<PostProcessTask> = {}): PostProcessTask {
  return {
    id: `member-${attrValue}`,
    name: `物品 ${attrValue}`,
    enabled: true,
    stage: 1,
    promptGroups: [],
    replicaFamilyRootId: 'root',
    replicaFamilyAttrValue: attrValue,
    replicaFamilySpec: 'item@name',
    ...overrides,
  } as PostProcessTask;
}

test('buildReplicaStateFromTasks collects attrValues and launched', () => {
  const tasks = [
    rootTask({ replicaFamilyScheduleMode: 'manual' }),
    memberTask('剑', { replicaFamilyLaunched: true }),
    memberTask('盾', { replicaFamilyLaunched: false }),
  ];
  const snap = buildReplicaStateFromTasks(tasks);
  assert.deepEqual(snap.root?.attrValues, ['剑', '盾']);
  assert.deepEqual(snap.root?.launchedAttrValues, ['剑']);
});

test('buildReplicaStateFromTasks omits launched list when none launched', () => {
  const tasks = [rootTask(), memberTask('剑'), memberTask('盾')];
  const snap = buildReplicaStateFromTasks(tasks);
  assert.equal(snap.root?.launchedAttrValues, undefined);
});

test('mergeReplicaStateSnapshots later overrides earlier per root', () => {
  const merged = mergeReplicaStateSnapshots([
    { root: { attrValues: ['剑'] } },
    { root: { attrValues: ['剑', '盾'] } },
    { other: { attrValues: ['甲'] } },
  ]);
  assert.deepEqual(merged.root?.attrValues, ['剑', '盾']);
  assert.deepEqual(merged.other?.attrValues, ['甲']);
});

test('applyReplicaStateToTasks removes members absent from snapshot', () => {
  const tasks = [rootTask(), memberTask('剑'), memberTask('盾')];
  const next = applyReplicaStateToTasks(tasks, { root: { attrValues: ['剑'] } });
  const members = next.filter(t => t.replicaFamilyRootId === 'root');
  assert.deepEqual(
    members.map(m => m.replicaFamilyAttrValue),
    ['剑'],
  );
});

test('applyReplicaStateToTasks adds missing members from snapshot', () => {
  const tasks = [rootTask(), memberTask('剑')];
  const next = applyReplicaStateToTasks(tasks, { root: { attrValues: ['剑', '盾'] } });
  const attrs = next
    .filter(t => t.replicaFamilyRootId === 'root')
    .map(m => m.replicaFamilyAttrValue)
    .sort();
  assert.deepEqual(attrs, ['剑', '盾']);
});

test('applyReplicaStateToTasks empty snapshot preserves members', () => {
  const tasks = [rootTask(), memberTask('剑'), memberTask('盾')];
  const next = applyReplicaStateToTasks(tasks, {});
  assert.equal(next.filter(t => t.replicaFamilyRootId === 'root').length, 2);
});

test('applyReplicaStateToTasks empty attrValues preserves members', () => {
  const tasks = [rootTask(), memberTask('剑')];
  const next = applyReplicaStateToTasks(tasks, { root: { attrValues: [] } });
  assert.equal(next.filter(t => t.replicaFamilyRootId === 'root').length, 1);
});

test('mergeReplicaStateForRerun ignores history empty attrValues', () => {
  const history = { root: { attrValues: [] as string[] } };
  const merged = mergeReplicaStateForRerun(history, null);
  assert.equal(merged.root, undefined);
});

test('rerun empty history state does not wipe UI world member', () => {
  const tasks = [
    rootTask({
      name: '世界时局与经济简报',
      replicaFamilySpec: '世界状态摘要@world',
      replicaFamilyBaseName: '世界时局与经济简报',
      replicaFamilyScheduleMode: 'manual',
    }),
    memberTask('阿斯塔利亚', {
      name: '世界时局与经济简报 阿斯塔利亚',
      replicaFamilySpec: '世界状态摘要@world',
      replicaFamilyLaunched: true,
    }),
  ];
  const history = { root: { attrValues: [] as string[] } };
  const merged = mergeReplicaStateForRerun(history, null);
  const next = applyReplicaStateToTasks(tasks, merged);
  assert.ok(next.find(t => t.replicaFamilyAttrValue === '阿斯塔利亚'));
});

test('mergeReplicaStateForRerun keeps current when history empty', () => {
  const current = {
    root: {
      attrValues: ['阿斯塔利亚'],
      launchedAttrValues: ['阿斯塔利亚'],
      lastEnumAttrValues: ['阿斯塔利亚'],
    },
  };
  const merged = mergeReplicaStateForRerun({}, current);
  assert.deepEqual(merged.root?.attrValues, ['阿斯塔利亚']);
  assert.deepEqual(merged.root?.launchedAttrValues, ['阿斯塔利亚']);
  assert.deepEqual(merged.root?.lastEnumAttrValues, ['阿斯塔利亚']);
});

test('mergeReplicaStateForRerun prefers history members over current', () => {
  const history = { root: { attrValues: ['剑'], launchedAttrValues: ['剑'] } };
  const current = {
    root: {
      attrValues: ['剑', '盾'],
      launchedAttrValues: ['剑', '盾'],
      lastEnumAttrValues: ['盾'],
    },
  };
  const merged = mergeReplicaStateForRerun(history, current);
  assert.deepEqual(merged.root?.attrValues, ['剑']);
  assert.deepEqual(merged.root?.launchedAttrValues, ['剑']);
  assert.deepEqual(merged.root?.lastEnumAttrValues, ['盾']);
});

test('mergeReplicaStateForRerun history with members keeps own lastEnum', () => {
  const history = {
    root: { attrValues: ['剑'], launchedAttrValues: ['剑'], lastEnumAttrValues: ['剑'] },
  };
  const current = {
    root: { attrValues: ['盾'], lastEnumAttrValues: ['盾'] },
  };
  const merged = mergeReplicaStateForRerun(history, current);
  assert.deepEqual(merged.root?.attrValues, ['剑']);
  assert.deepEqual(merged.root?.lastEnumAttrValues, ['剑']);
});

test('rerun merge then apply keeps manual launched members when history empty', () => {
  const tasks = [
    rootTask({
      name: '世界时局',
      replicaFamilySpec: '世界状态摘要@world',
      replicaFamilyBaseName: '世界时局',
      replicaFamilyScheduleMode: 'manual',
    }),
    memberTask('阿斯塔利亚', {
      name: '世界时局 阿斯塔利亚',
      replicaFamilySpec: '世界状态摘要@world',
      replicaFamilyLaunched: true,
    }),
  ];
  const current = {
    root: { attrValues: ['阿斯塔利亚'], launchedAttrValues: ['阿斯塔利亚'] },
  };
  const merged = mergeReplicaStateForRerun({}, current);
  const next = applyReplicaStateToTasks(tasks, merged);
  const member = next.find(t => t.replicaFamilyAttrValue === '阿斯塔利亚');
  assert.ok(member);
  assert.equal(member?.replicaFamilyLaunched, true);
});

test('applyReplicaStateToTasks restores launched flags in manual mode', () => {
  const tasks = [
    rootTask({ replicaFamilyScheduleMode: 'manual' }),
    memberTask('剑', { replicaFamilyLaunched: false }),
  ];
  const next = applyReplicaStateToTasks(tasks, {
    root: { attrValues: ['剑'], launchedAttrValues: ['剑'] },
  });
  const member = next.find(t => t.replicaFamilyAttrValue === '剑');
  assert.equal(member?.replicaFamilyLaunched, true);
});

test('normalizeReplicaStateSnapshot drops invalid entries', () => {
  const snap = normalizeReplicaStateSnapshot({
    root: { attrValues: ['剑'] },
    bad: { notAttr: 1 },
    nope: 'x',
  });
  assert.ok(snap);
  assert.deepEqual(Object.keys(snap!), ['root']);
});

test('normalizeReplicaStateSnapshot keeps lastEnumAttrValues', () => {
  const snap = normalizeReplicaStateSnapshot({
    root: { attrValues: ['剑'], lastEnumAttrValues: ['剑', '盾'] },
  });
  assert.deepEqual(snap?.root?.lastEnumAttrValues, ['剑', '盾']);
});

test('mergeReplicaStateSnapshots preserves earlier lastEnum when later omits', () => {
  const merged = mergeReplicaStateSnapshots([
    { root: { attrValues: ['剑'], lastEnumAttrValues: ['剑'] } },
    { root: { attrValues: ['剑', '盾'] } },
  ]);
  assert.deepEqual(merged.root?.attrValues, ['剑', '盾']);
  assert.deepEqual(merged.root?.lastEnumAttrValues, ['剑']);
});

test('mergeReplicaStateSnapshots later lastEnum overrides earlier', () => {
  const merged = mergeReplicaStateSnapshots([
    { root: { attrValues: ['剑'], lastEnumAttrValues: ['剑'] } },
    { root: { attrValues: ['剑'], lastEnumAttrValues: ['盾'] } },
  ]);
  assert.deepEqual(merged.root?.lastEnumAttrValues, ['盾']);
});

test('applyLastEnumToReplicaSnapshot prefers pending over existing', () => {
  const out = applyLastEnumToReplicaSnapshot(
    { root: { attrValues: ['剑', '盾'] } },
    { root: ['剑'] },
    { root: { attrValues: ['剑'], lastEnumAttrValues: ['盾'] } },
    null,
  );
  assert.deepEqual(out.root?.lastEnumAttrValues, ['剑']);
});

test('applyLastEnumToReplicaSnapshot keeps existing when pending empty', () => {
  const out = applyLastEnumToReplicaSnapshot(
    { root: { attrValues: ['剑'] } },
    {},
    { root: { attrValues: ['剑'], lastEnumAttrValues: ['旧'] } },
    null,
  );
  assert.deepEqual(out.root?.lastEnumAttrValues, ['旧']);
});

test('normalizeReplicaStateSnapshot returns null for non-object', () => {
  assert.equal(normalizeReplicaStateSnapshot(null), null);
  assert.equal(normalizeReplicaStateSnapshot([1, 2]), null);
});

console.log('replica-state.test.ts: all passed');
