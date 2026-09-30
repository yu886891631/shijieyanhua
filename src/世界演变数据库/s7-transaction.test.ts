import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WorldEvolutionFloorQueue } from '../世界演变/floor-queue';
import { WorldEvolutionRevisionConflictError, commitRevisionSnapshot } from './replay';
import { isDbMessageProcessed } from './adapter';
import {
  createEmptyDbSnapshot,
  rowKey,
  type WorldEvolutionDbRow,
  type WorldEvolutionDbSnapshot,
} from './types';

const chatKey = 's7-transaction-test';

function npc(id: string, name: string, revision = 0): WorldEvolutionDbRow {
  return {
    key: rowKey(chatKey, 'npc', id),
    id,
    chatKey,
    table: 'npc',
    name,
    visibility: 'backstage',
    revision,
    data: { goal: name === '林遥' ? '观察港口' : '等待' },
    createdAt: revision || 1,
    updatedAt: revision || 1,
  };
}

function commitNpc(snapshot: WorldEvolutionDbSnapshot, messageId: number, name: string, now: number) {
  return commitRevisionSnapshot(snapshot, {
    chatKey,
    messageId,
    messageFingerprint: `floor-${messageId}`,
    source: 'auto',
    baseRevision: snapshot.meta.revision,
    operations: [{
      op: 'upsert',
      table: 'npc',
      id: `npc:${name}`,
      row: npc(`npc:${name}`, name),
    }],
    now,
  });
}

test('S7：revision 冲突在提交前失败，原快照和 revision 链保持不变', () => {
  const source = createEmptyDbSnapshot(chatKey);
  const first = commitNpc(source, 10, '林遥', 10);
  const beforeConflict = structuredClone(first.snapshot);

  assert.throws(
    () => commitRevisionSnapshot(first.snapshot, {
      chatKey,
      messageId: 20,
      messageFingerprint: 'floor-20',
      source: 'retry',
      baseRevision: 0,
      operations: [{
        op: 'upsert',
        table: 'npc',
        id: 'npc:远山',
        row: npc('npc:远山', '远山'),
      }],
    }),
    WorldEvolutionRevisionConflictError,
  );
  assert.deepEqual(first.snapshot, beforeConflict);
  assert.equal(first.snapshot.meta.revision, 1);
  assert.equal(first.snapshot.revisions.length, 1);
});

test('S7：暂时失败后重试只提交一个 revision，不重复写入已成功操作', async () => {
  let attempts = 0;
  let snapshot = createEmptyDbSnapshot(chatKey);
  const queue = new WorldEvolutionFloorQueue(
    async task => {
      attempts += 1;
      if (attempts === 1) {
        return { status: 'failed', messageId: task.messageId, error: '模拟网络失败' };
      }
      const committed = commitNpc(snapshot, task.messageId, '林遥', 100 + attempts);
      snapshot = committed.snapshot;
      return { status: 'done', messageId: task.messageId };
    },
    { maxRetries: 1, retryDelayMs: 0 },
  );

  assert.deepEqual(await queue.schedule(chatKey, 11, 'retry'), { status: 'done', messageId: 11 });
  assert.equal(attempts, 2);
  assert.equal(snapshot.meta.revision, 1);
  assert.equal(snapshot.revisions.length, 1);
  assert.equal(snapshot.rows.npc.length, 1);
});

test('S7：取消尚未开始的楼层不会运行提交器，也不会产生 revision', async () => {
  let release!: () => void;
  const hold = new Promise<void>(resolve => {
    release = resolve;
  });
  let snapshot = createEmptyDbSnapshot(chatKey);
  let commitAttempts = 0;
  const queue = new WorldEvolutionFloorQueue(async task => {
    if (task.messageId === 1) {
      await hold;
      return { status: 'done', messageId: task.messageId };
    }
    commitAttempts += 1;
    snapshot = commitNpc(snapshot, task.messageId, '远山', 200).snapshot;
    return { status: 'done', messageId: task.messageId };
  });

  const running = queue.schedule(chatKey, 1, 'workflow-completed');
  const cancelled = queue.schedule(chatKey, 2, 'workflow-completed');
  assert.equal(queue.cancel(chatKey, 2), true);
  release();

  assert.deepEqual(await running, { status: 'done', messageId: 1 });
  assert.deepEqual(await cancelled, { status: 'cancelled', messageId: 2 });
  assert.equal(commitAttempts, 0);
  assert.equal(snapshot.meta.revision, 0);
  assert.equal(snapshot.revisions.length, 0);
});

test('S7：重复请求同一楼层在成功记录仍为 done 时保持幂等', () => {
  const first = commitNpc(createEmptyDbSnapshot(chatKey), 21, '林遥', 300);
  const run = first.snapshot.floorRuns.find(item => item.messageId === 21);
  assert.equal(run?.status, 'done');
  assert.equal(run?.messageFingerprint, 'floor-21');
  assert.equal(isDbMessageProcessed(first.snapshot, 21, 'floor-21'), true);

  // 二次请求应在引擎入口被识别为已处理，而不是把历史 done 标记为 skipped。
  // 这里直接锁定账本不变量：成功 revision 的 floor_run 必须继续保持 done。
  assert.equal(first.snapshot.revisions.length, 1);
  assert.equal(first.snapshot.meta.revision, 1);
  assert.equal(first.snapshot.floorRuns.filter(item => item.status === 'done').length, 1);
});
