import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WorldEvolutionFloorQueue, waitForStableSnapshot } from './floor-queue';

test('floor queue runs tasks serially and deduplicates pending floors', async () => {
  const active: number[] = [];
  const seenAttempts: Array<[number, number]> = [];
  const queue = new WorldEvolutionFloorQueue(
    async task => {
      active.push(task.messageId);
      assert.equal(active.length, 1);
      seenAttempts.push([task.messageId, task.attempt]);
      await new Promise(resolve => setTimeout(resolve, 2));
      active.pop();
      return { status: 'done', messageId: task.messageId };
    },
    { retryDelayMs: 0 },
  );

  const first = queue.schedule('chat', 1, 'generation-ended');
  const duplicate = queue.schedule('chat', 1, 'workflow-completed');
  const second = queue.schedule('chat', 2, 'workflow-completed');

  assert.strictEqual(first, duplicate);
  assert.deepEqual(await Promise.all([first, second]), [
    { status: 'done', messageId: 1 },
    { status: 'done', messageId: 2 },
  ]);
  assert.deepEqual(seenAttempts, [
    [1, 1],
    [2, 1],
  ]);
});

test('floor queue retries failures and eventually returns the last result', async () => {
  let calls = 0;
  const queue = new WorldEvolutionFloorQueue(
    async task => {
      calls += 1;
      return calls < 3
        ? { status: 'failed', messageId: task.messageId, error: `temporary-${calls}` }
        : { status: 'done', messageId: task.messageId };
    },
    { maxRetries: 2, retryDelayMs: 0 },
  );

  assert.deepEqual(await queue.schedule('chat', 7, 'retry'), { status: 'done', messageId: 7 });
  assert.equal(calls, 3);
});

test('cancel removes a pending floor without cancelling the running floor', async () => {
  let release!: () => void;
  const hold = new Promise<void>(resolve => {
    release = resolve;
  });
  const queue = new WorldEvolutionFloorQueue(async task => {
    if (task.messageId === 1) await hold;
    return { status: 'done', messageId: task.messageId };
  });

  const first = queue.schedule('chat', 1, 'workflow-completed');
  const second = queue.schedule('chat', 2, 'workflow-completed');
  assert.equal(queue.cancel('chat', 2), true);
  release();
  assert.deepEqual(await first, { status: 'done', messageId: 1 });
  assert.deepEqual(await second, { status: 'cancelled', messageId: 2 });
});

test('stable snapshot waits for consecutive equal reads', async () => {
  const values = ['draft', 'final', 'final', 'final'];
  let index = 0;
  const result = await waitForStableSnapshot({
    read: () => values[Math.min(index++, values.length - 1)],
    pollMs: 0,
    stableSamples: 2,
    timeoutMs: 100,
  });
  assert.equal(result, 'final');
});
