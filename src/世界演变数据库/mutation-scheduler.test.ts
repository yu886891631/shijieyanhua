import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WorldEvolutionMutationScheduler } from './mutation-scheduler';

test('世界演变 mutation scheduler 合并同一聊天的删除事件并串行重建', async () => {
  const callbacks = new Map<number, () => void>();
  const calls: string[] = [];
  let timerId = 0;
  const scheduler = new WorldEvolutionMutationScheduler({
    debounceMs: 0,
    setTimer: callback => {
      const id = ++timerId;
      callbacks.set(id, callback);
      return id as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimer: timer => callbacks.delete(timer as unknown as number),
    rebuild: async (chatKey, messageId) => {
      calls.push(`${chatKey}:${messageId}`);
    },
  });

  scheduler.schedule({ chatKey: 'chat', messageId: 3, kind: 'message_deleted' });
  scheduler.schedule({ chatKey: 'chat', messageId: 1, kind: 'message_swiped' });
  for (const [id, callback] of [...callbacks]) {
    callbacks.delete(id);
    callback();
  }
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, ['chat:1', 'chat:3']);
});

test('世界演变 mutation scheduler 重建期间的新事件不会被旧 generation 丢弃', async () => {
  const callbacks = new Map<number, () => void>();
  const calls: number[] = [];
  let timerId = 0;
  let release!: () => void;
  const blocked = new Promise<void>(resolve => {
    release = resolve;
  });
  const scheduler = new WorldEvolutionMutationScheduler({
    debounceMs: 0,
    setTimer: callback => {
      const id = ++timerId;
      callbacks.set(id, callback);
      return id as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimer: timer => callbacks.delete(timer as unknown as number),
    rebuild: async (_chatKey, messageId) => {
      calls.push(messageId);
      if (messageId === 1) await blocked;
    },
  });

  scheduler.schedule({ chatKey: 'chat', messageId: 1, kind: 'message_deleted' });
  for (const [id, callback] of [...callbacks]) {
    callbacks.delete(id);
    callback();
  }
  await Promise.resolve();
  scheduler.schedule({ chatKey: 'chat', messageId: 2, kind: 'message_deleted' });
  for (const [id, callback] of [...callbacks]) {
    callbacks.delete(id);
    callback();
  }
  release();
  await new Promise(resolve => setImmediate(resolve));
  for (const [id, callback] of [...callbacks]) {
    callbacks.delete(id);
    callback();
  }
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, [1, 2]);
});
