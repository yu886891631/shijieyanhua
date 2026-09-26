import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dbSnapshotToWorld } from './adapter';
import { parseWorldEvolutionOperations, validateWorldEvolutionOperations } from './ai-operations';
import { createEmptyDbSnapshot } from './types';
import type {
  WorldEvolutionInput,
  WorldEvolutionSettings,
} from '../世界演变/types';

const settings: WorldEvolutionSettings = {
  enabled: true,
  autoRun: true,
  maxRetries: 1,
  retryDelayMs: 0,
  stablePollMs: 0,
  stableSamples: 1,
  maxNpcPerRun: 2,
  maxOtherEntitiesPerRun: 1,
  worldbookName: '',
  worldbookAutoSync: false,
  manualCandidates: [],
  modelInstruction: '',
};

const input: WorldEvolutionInput = {
  chatKey: 'adapter-test',
  messageId: 12,
  latestMessage: '楼层正文',
  mvuSnapshot: null,
  mvuChangeSummary: '',
  databaseSummary: '',
  databaseSnapshot: null,
  candidateNames: ['林遥'],
};

test('AI operations 转换为可提交的数据库行操作，并能投影回旧读取模型', () => {
  const snapshot = createEmptyDbSnapshot(input.chatKey);
  const parsed = parseWorldEvolutionOperations(JSON.stringify({
    baseRevision: 0,
    operations: [
      {
        op: 'upsert',
        table: 'npc',
        id: 'npc:林遥',
        name: '林遥',
        changes: { current_goal: '调查旧港口' },
        visibility: 'ai_context',
      },
      {
        op: 'append',
        table: 'event',
        data: { eventType: 'npc_action', actorIds: ['npc:林遥'], summary: '林遥开始调查旧港口' },
      },
      {
        op: 'append',
        table: 'plan',
        data: { title: '旧港口回报', actorIds: ['npc:林遥'] },
      },
    ],
  }));

  const result = validateWorldEvolutionOperations(
    snapshot,
    parsed,
    input,
    settings,
  );

  assert.deepEqual(result.changedEntityIds, ['npc:林遥']);
  assert.equal(result.eventIds.length, 1);
  assert.deepEqual(result.operations.map(operation => operation.table), ['npc', 'event', 'plan']);
  const projected = dbSnapshotToWorld({
    ...snapshot,
    meta: { ...snapshot.meta, revision: 1 },
    rows: {
      ...snapshot.rows,
      npc: [result.operations[0]!.op === 'upsert' ? result.operations[0]!.row : undefined].filter(Boolean) as never[],
    },
  });
  assert.equal(projected.entities['npc:林遥']?.state.current_goal, '调查旧港口');
});

test('旧面板投影会读取新数据库的世界书状态与楼层诊断字段', () => {
  const snapshot = createEmptyDbSnapshot(input.chatKey);
  snapshot.meta.worldbookSync = {
    status: 'synced',
    worldbookName: 'WorldEvolution',
    lastSuccessAt: 123,
  };
  snapshot.floorRuns.push({
    key: 'run',
    id: 'run',
    chatKey: input.chatKey,
    messageId: 12,
    messageFingerprint: 'fp',
    source: 'manual',
    status: 'done',
    baseRevision: 0,
    resultRevision: 1,
    operationCount: 2,
    attempt: 2,
    enqueuedAt: 1,
    startedAt: 2,
    finishedAt: 3,
    candidateNames: ['林遥'],
    changedEntityIds: ['npc:林遥'],
    eventIds: ['EV-1'],
    createdAt: 1,
    updatedAt: 3,
  });

  const world = dbSnapshotToWorld(snapshot);
  assert.deepEqual(world.worldbookSync, snapshot.meta.worldbookSync);
  assert.deepEqual(world.runRecords[0], {
    key: 'run',
    chatKey: input.chatKey,
    messageId: 12,
    messageFingerprint: 'fp',
    source: 'manual',
    status: 'done',
    attempt: 2,
    enqueuedAt: 1,
    startedAt: 2,
    finishedAt: 3,
    candidateNames: ['林遥'],
    changedEntityIds: ['npc:林遥'],
    eventIds: ['EV-1'],
    error: undefined,
  });
});
