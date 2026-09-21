import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSerialGate, RunCancelledError, yieldToMain } from './run-control';

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

test('yieldToMain throws immediately when signal is already aborted', async () => {
  const controller = new AbortController();
  controller.abort();
  let yieldCalls = 0;
  const original = (globalThis as typeof globalThis & { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  (globalThis as typeof globalThis & { scheduler?: { yield?: () => Promise<void> } }).scheduler = {
    yield: async () => {
      yieldCalls += 1;
    },
  };
  try {
    await assert.rejects(() => yieldToMain(controller.signal), error => error instanceof RunCancelledError);
    assert.equal(yieldCalls, 0);
  } finally {
    (globalThis as typeof globalThis & { scheduler?: typeof original }).scheduler = original;
  }
});

test('yieldToMain rejects as soon as the signal aborts during wait', async () => {
  const controller = new AbortController();
  let releaseYield!: () => void;
  const original = (globalThis as typeof globalThis & { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  (globalThis as typeof globalThis & { scheduler?: { yield?: () => Promise<void> } }).scheduler = {
    yield: () =>
      new Promise<void>(resolve => {
        releaseYield = resolve;
      }),
  };
  try {
    const pending = yieldToMain(controller.signal);
    await delay(0);
    controller.abort();
    await assert.rejects(() => pending, error => error instanceof RunCancelledError);
  } finally {
    releaseYield?.();
    (globalThis as typeof globalThis & { scheduler?: typeof original }).scheduler = original;
  }
});

test('createSerialGate never overlaps critical sections', async () => {
  const gate = createSerialGate();
  let active = 0;
  let maxActive = 0;
  const order: number[] = [];

  await Promise.all(
    [1, 2, 3, 4].map(id =>
      gate.run(async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        order.push(id);
        await delay(5);
        active -= 1;
      }),
    ),
  );

  assert.equal(maxActive, 1);
  assert.deepEqual(order, [1, 2, 3, 4]);
});

test('createSerialGate abort while waiting still releases the queue', async () => {
  const gate = createSerialGate();
  const controller = new AbortController();
  let firstStarted = false;
  let firstReleased = false;

  const first = gate.run(async () => {
    firstStarted = true;
    await delay(30);
    firstReleased = true;
  });

  const waiting = gate.run(async () => {
    throw new Error('cancelled waiter should not run fn');
  }, controller.signal);

  await delay(0);
  assert.equal(firstStarted, true);
  controller.abort();
  await assert.rejects(() => waiting, error => error instanceof RunCancelledError);
  await first;
  assert.equal(firstReleased, true);

  let ranAfter = false;
  await gate.run(async () => {
    ranAfter = true;
  });
  assert.equal(ranAfter, true);
});

test('createSerialGate still releases when fn throws', async () => {
  const gate = createSerialGate();
  await assert.rejects(
    () =>
      gate.run(async () => {
        throw new Error('boom');
      }),
    /boom/,
  );

  let ran = false;
  await gate.run(async () => {
    ran = true;
  });
  assert.equal(ran, true);
});
