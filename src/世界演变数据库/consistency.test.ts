import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  assertWorldEvolutionDbConsistency,
  WorldEvolutionDbConsistencyError,
} from './consistency';
import { commitRevisionSnapshot } from './replay';
import { importDbSnapshot } from './store';
import {
  createEmptyDbSnapshot,
  rowKey,
  type WorldEvolutionDbRow,
} from './types';

const chatKey = 'm5-consistency';

function npc(id: string, name: string, revision = 0): WorldEvolutionDbRow {
  return {
    key: rowKey(chatKey, 'npc', id),
    id,
    chatKey,
    table: 'npc',
    name,
    visibility: 'ai_context',
    revision,
    data: { current_goal: '观察局势' },
    createdAt: 1,
    updatedAt: 1,
  };
}

function validSnapshot() {
  const source = createEmptyDbSnapshot(chatKey);
  source.rows.npc.push(npc('npc:林遥', '林遥'));
  return commitRevisionSnapshot(source, {
    chatKey,
    messageId: 10,
    messageFingerprint: 'floor-10',
    source: 'auto',
    baseRevision: 0,
    operations: [{
      op: 'upsert',
      table: 'event',
      id: 'EV-10-1',
      row: {
        key: rowKey(chatKey, 'event', 'EV-10-1'),
        id: 'EV-10-1',
        chatKey,
        table: 'event',
        title: '林遥观察港口',
        visibility: 'ai_context',
        revision: 0,
        data: {
          type: 'npc_action',
          summary: '林遥观察港口',
          actorIds: ['npc:林遥'],
          actors: ['林遥'],
        },
        createdAt: 1,
        updatedAt: 1,
      },
    }],
  }).snapshot;
}

test('M5 一致性校验接受正常 materialized rows 和世界投影', () => {
  assert.doesNotThrow(() => assertWorldEvolutionDbConsistency(validSnapshot()));
});

test('M5 拒绝断裂引用和跨表重复实体 ID', () => {
  const snapshot = validSnapshot();
  snapshot.rows.event[0]!.data.actorIds = ['npc:不存在'];
  snapshot.rows.location.push({
    ...npc('npc:林遥', '同名实体'),
    key: rowKey(chatKey, 'location', 'npc:林遥'),
    table: 'location',
  });
  assert.throws(
    () => assertWorldEvolutionDbConsistency(snapshot),
    (error: unknown) =>
      error instanceof WorldEvolutionDbConsistencyError &&
      error.issues.some(issue => issue.code === 'reference') &&
      error.issues.some(issue => issue.code === 'duplicate'),
  );
});

test('M5 拒绝 ID 已更新但名称投影未更新的事件', () => {
  const snapshot = validSnapshot();
  snapshot.rows.event[0]!.data.actors = ['错误名称'];
  assert.throws(
    () => assertWorldEvolutionDbConsistency(snapshot),
    (error: unknown) =>
      error instanceof WorldEvolutionDbConsistencyError &&
      error.issues.some(issue => issue.path.endsWith('.actors') && issue.code === 'projection'),
  );
});

test('M5 拒绝 materialized rows 偏离确定性重放结果', () => {
  const snapshot = validSnapshot();
  const expected = structuredClone(snapshot.rows);
  snapshot.rows.npc[0]!.data.current_goal = '被篡改的状态';
  assert.throws(
    () => assertWorldEvolutionDbConsistency(snapshot, { expectedRows: expected }),
    (error: unknown) =>
      error instanceof WorldEvolutionDbConsistencyError &&
      error.issues.some(issue => issue.code === 'revision' && issue.path === 'rows.npc'),
  );
});

test('M5 导入无效备份时在清空当前聊天前拒绝', async () => {
  const originalIndexedDb = globalThis.indexedDB;
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: undefined });
  try {
    const invalid = validSnapshot();
    invalid.rows.event[0]!.data.actorIds = ['npc:missing'];
    await assert.rejects(
      importDbSnapshot(chatKey, JSON.stringify(invalid)),
      /世界演变数据库一致性校验失败/,
    );
  } finally {
    Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: originalIndexedDb });
  }
});
