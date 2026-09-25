import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createEmptyWorld } from './types';
import { markInterruptedRuns, normalizeWorld, trimWorldHistory } from './store';

test('legacy world backups receive checkpoint and worldbook sync defaults', () => {
  const world = normalizeWorld('chat-legacy', {
    revision: 3,
    entities: {
      'npc:林青': {
        id: 'npc:林青',
        type: 'npc',
        name: '林青',
        state: { goal: '寻找信使' },
        visibility: 'ai_context',
        updatedAt: 1,
      },
    },
    events: [],
    scheduledEvents: [],
    revisions: [],
    processedMessageKeys: ['3'],
    runRecords: [],
  });

  assert.equal(world.chatKey, 'chat-legacy');
  assert.equal(world.revision, 3);
  assert.deepEqual(world.checkpoints, []);
  assert.deepEqual(world.worldbookSync, { status: 'never' });
  assert.equal(world.entities['npc:林青'].state.goal, '寻找信使');
});

test('normalizeWorld rejects malformed checkpoint entries while preserving valid ones', () => {
  const base = createEmptyWorld('chat-checkpoint');
  const checkpoint = {
    id: 'CP-1',
    revision: 1,
    messageId: 4,
    reason: 'auto',
    createdAt: 10,
    entities: {},
    events: [],
    scheduledEvents: [],
    processedMessageKeys: ['4:abc'],
  };
  const world = normalizeWorld('chat-checkpoint', {
    ...base,
    checkpoints: [checkpoint, { id: 'bad' }],
    worldbookSync: {
      status: 'failed',
      worldbookName: 'World Book',
      error: 'network',
    },
  });

  assert.equal(world.checkpoints.length, 1);
  assert.equal(world.checkpoints[0].id, 'CP-1');
  assert.equal(world.worldbookSync.status, 'failed');
  assert.equal(world.worldbookSync.worldbookName, 'World Book');
});

test('trimWorldHistory bounds checkpoints together with other history', () => {
  const world = createEmptyWorld('chat-trim');
  world.checkpoints = Array.from({ length: 60 }, (_, index) => ({
    id: `CP-${index}`,
    revision: index,
    messageId: index,
    reason: 'manual' as const,
    createdAt: index,
    entities: {},
    events: [],
    scheduledEvents: [],
    processedMessageKeys: [],
  }));

  const trimmed = trimWorldHistory(world);
  assert.equal(trimmed.checkpoints.length, 50);
  assert.equal(trimmed.checkpoints[0].id, 'CP-10');
});

test('markInterruptedRuns makes queued and running floors explicitly retryable', () => {
  const world = createEmptyWorld('chat-recovery');
  world.runRecords = [
    {
      key: 'chat-recovery\u00001',
      chatKey: 'chat-recovery',
      messageId: 1,
      source: 'auto',
      status: 'queued',
      attempt: 0,
      enqueuedAt: 1,
      candidateNames: [],
      changedEntityIds: [],
      eventIds: [],
    },
    {
      key: 'chat-recovery\u00002',
      chatKey: 'chat-recovery',
      messageId: 2,
      source: 'auto',
      status: 'running',
      attempt: 1,
      enqueuedAt: 1,
      candidateNames: [],
      changedEntityIds: [],
      eventIds: [],
    },
    {
      key: 'chat-recovery\u00003',
      chatKey: 'chat-recovery',
      messageId: 3,
      source: 'auto',
      status: 'done',
      attempt: 1,
      enqueuedAt: 1,
      candidateNames: [],
      changedEntityIds: [],
      eventIds: [],
    },
  ];

  const recovered = markInterruptedRuns(world, 100);
  assert.equal(recovered.changed, true);
  assert.deepEqual(
    recovered.world.runRecords.map(record => [record.status, record.error]),
    [
      ['failed', '页面刷新或脚本重载时任务中断，可从面板重试'],
      ['failed', '页面刷新或脚本重载时任务中断，可从面板重试'],
      ['done', undefined],
    ],
  );
  assert.equal(recovered.world.runRecords[0].finishedAt, 100);
});
