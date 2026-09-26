import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertWorldEvolutionDbConsistency } from './consistency';
import {
  LEGACY_WORLD_EVOLUTION_VERSION,
  buildLegacyMigrationPreview,
  isLegacyWorldEvolutionBackup,
} from './migration';
import { createEmptyDbSnapshot } from './types';

const chatKey = 'm8-migration';

function legacyBackup() {
  return {
    chatKey,
    revision: 3,
    entities: {
      'npc:林遥': {
        id: 'npc:林遥',
        type: 'npc',
        name: '林遥',
        state: { currentGoal: '观察港口' },
        visibility: 'ai_context',
        sourceMessageId: 12,
        updatedAt: 100,
      },
      'org:灯塔会': {
        id: 'org:灯塔会',
        type: 'organization',
        name: '灯塔会',
        state: { stance: '谨慎' },
        visibility: 'backstage',
        updatedAt: 101,
      },
    },
    events: [{
      id: 'EV-legacy-1',
      type: 'npc_action',
      actors: ['林遥'],
      summary: '林遥观察港口',
      sourceMessageId: 12,
      createdAt: 102,
    }],
    scheduledEvents: [{
      id: 'PL-legacy-1',
      title: '灯塔会召开会议',
      actors: ['org:灯塔会'],
      status: 'pending',
      createdAt: 103,
    }],
    revisions: [{
      revision: 1,
      messageId: 10,
      messageFingerprint: 'floor-10',
      source: 'auto',
      createdAt: 10,
    }],
    processedMessageKeys: ['10:floor-10'],
    runRecords: [{
      key: 'run-10',
      messageId: 10,
      messageFingerprint: 'floor-10',
      status: 'done',
      source: 'auto',
      candidateNames: ['林遥'],
      changedEntityIds: ['npc:林遥'],
      eventIds: ['EV-legacy-1'],
    }],
    checkpoints: [],
  };
}

test('M8 能识别并预览 A0.0.5 备份', () => {
  const legacy = legacyBackup();
  assert.equal(isLegacyWorldEvolutionBackup(legacy), true);
  const preview = buildLegacyMigrationPreview(chatKey, legacy, createEmptyDbSnapshot(chatKey));
  assert.equal(preview.sourceVersion, LEGACY_WORLD_EVOLUTION_VERSION);
  assert.equal(preview.canMigrate, true);
  assert.equal(preview.counts.entities, 2);
  assert.equal(preview.counts.events, 1);
  assert.equal(preview.counts.plans, 1);
  assert.equal(preview.snapshot.rows.npc[0]?.name, '林遥');
  assert.equal(preview.snapshot.rows.organization[0]?.name, '灯塔会');
  assert.equal(preview.snapshot.rows.event[0]?.title, '林遥观察港口');
  assert.equal(preview.snapshot.rows.plan[0]?.title, '灯塔会召开会议');
});

test('M8 迁移结果满足新数据库一致性与可回放约束', () => {
  const preview = buildLegacyMigrationPreview(chatKey, legacyBackup(), createEmptyDbSnapshot(chatKey));
  assert.equal(preview.canMigrate, true);
  assert.doesNotThrow(() => assertWorldEvolutionDbConsistency(preview.snapshot));
  assert.equal(preview.snapshot.meta.revision, 4);
  assert.equal(preview.snapshot.revisions.at(-1)?.source, 'migration');
  assert.equal(preview.snapshot.floorRuns.find(run => run.status === 'done')?.resultRevision, 4);
});

test('M8 已有数据库时只生成冲突报告，不覆盖现有数据', () => {
  const existing = createEmptyDbSnapshot(chatKey);
  existing.meta.revision = 1;
  const preview = buildLegacyMigrationPreview(chatKey, legacyBackup(), existing);
  assert.equal(preview.canMigrate, false);
  assert.equal(preview.conflicts.some(conflict => conflict.code === 'existing_data'), true);
});

test('M8 不支持的旧实体类型会阻止迁移', () => {
  const legacy = legacyBackup();
  legacy.entities['unknown'] = { id: 'unknown', type: 'vehicle', name: '旧车' };
  const preview = buildLegacyMigrationPreview(chatKey, legacy, createEmptyDbSnapshot(chatKey));
  assert.equal(preview.canMigrate, false);
  assert.equal(preview.conflicts.some(conflict => conflict.code === 'unsupported_type'), true);
});
