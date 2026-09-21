import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyProgressSnapshot,
  collectCompletingTaskIds,
  createProgressDisplayState,
  displayStatusSymbol,
  markDisplayItemLeaving,
  orderedDisplayItems,
  removeDisplayItem,
  type TaskProgressSnapshot,
} from './task-progress-display';

function snapshot(
  tasks: TaskProgressSnapshot['tasks'],
  stageNo = 1,
): TaskProgressSnapshot {
  return { headline: `阶段${stageNo}`, stageNo, tasks };
}

test('shows all running tasks without count cap', () => {
  let state = createProgressDisplayState();
  const snap = snapshot(
    Array.from({ length: 6 }, (_, i) => ({
      taskId: `t${i}`,
      taskName: `任务${i}`,
      status: i < 3 ? ('running' as const) : ('pending' as const),
    })),
  );
  state = applyProgressSnapshot(state, snap);
  const items = orderedDisplayItems(state, snap);
  assert.equal(items.length, 6);
  assert.equal(items.filter(i => i.displayPhase === 'running').length, 3);
  assert.equal(items.filter(i => i.displayPhase === 'pending').length, 3);
});

test('running to done enters completing with green check symbol', () => {
  let state = createProgressDisplayState();
  const running = snapshot([{ taskId: 't1', taskName: 'A', status: 'running' }]);
  state = applyProgressSnapshot(state, running);
  const done = snapshot([{ taskId: 't1', taskName: 'A', status: 'done' }]);
  const prev = state;
  state = applyProgressSnapshot(state, done);
  const item = state.items.get('t1');
  assert.equal(item?.displayPhase, 'completing');
  assert.equal(displayStatusSymbol(item!), '✔');
  assert.deepEqual(collectCompletingTaskIds(prev, state), ['t1']);
});

test('stage change clears previous display items', () => {
  let state = createProgressDisplayState();
  state = applyProgressSnapshot(
    state,
    snapshot([{ taskId: 't1', taskName: 'A', status: 'running' }], 1),
  );
  state = applyProgressSnapshot(
    state,
    snapshot([{ taskId: 't2', taskName: 'B', status: 'pending' }], 2),
  );
  assert.equal(state.items.has('t1'), false);
  assert.equal(state.items.get('t2')?.displayPhase, 'pending');
});

test('leaving then remove drops item from ordered list', () => {
  let state = createProgressDisplayState();
  const snap = snapshot([{ taskId: 't1', taskName: 'A', status: 'done' }]);
  state = applyProgressSnapshot(state, snap);
  state = markDisplayItemLeaving(state, 't1');
  assert.equal(state.items.get('t1')?.displayPhase, 'leaving');
  state = removeDisplayItem(state, 't1');
  assert.equal(orderedDisplayItems(state, snap).length, 0);
});

test('failed task uses cross symbol while completing', () => {
  let state = createProgressDisplayState();
  state = applyProgressSnapshot(
    state,
    snapshot([{ taskId: 't1', taskName: 'A', status: 'running' }]),
  );
  state = applyProgressSnapshot(
    state,
    snapshot([{ taskId: 't1', taskName: 'A', status: 'failed', detail: 'err' }]),
  );
  const item = state.items.get('t1');
  assert.equal(item?.displayPhase, 'completing');
  assert.equal(displayStatusSymbol(item!), '✗');
});

test('dismissed terminal is not recreated by later done snapshots', () => {
  let state = createProgressDisplayState();
  const snap = snapshot([{ taskId: 't1', taskName: 'A', status: 'done' }]);
  state = applyProgressSnapshot(state, snap);
  assert.equal(state.items.get('t1')?.displayPhase, 'completing');
  state = markDisplayItemLeaving(state, 't1');
  state = removeDisplayItem(state, 't1');
  assert.equal(state.items.has('t1'), false);
  assert.equal(state.dismissed.has('t1'), true);

  const prev = state;
  state = applyProgressSnapshot(state, snap);
  assert.equal(state.items.has('t1'), false);
  assert.deepEqual(collectCompletingTaskIds(prev, state), []);
});

console.log('task-progress-display.test.ts: all passed');
