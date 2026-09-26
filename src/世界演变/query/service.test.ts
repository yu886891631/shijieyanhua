import assert from 'node:assert/strict';
import { test } from 'node:test';
import { queryWorldEvolutionCandidates } from './service';
import { createEmptyDbSnapshot } from '../../世界演变数据库/types';

test('M3 candidate query merges read-only sources deterministically and preserves row boundaries', () => {
  const database = createEmptyDbSnapshot('m3-test');
  database.rows.npc.push({
    key: 'm3-test\\0npc\\0npc-林遥',
    id: 'npc-林遥',
    chatKey: 'm3-test',
    table: 'npc',
    name: '林遥',
    visibility: 'ai_context',
    revision: 2,
    data: { goal: '调查旧港口' },
    createdAt: 1,
    updatedAt: 2,
  });
  database.rows.plan.push({
    key: 'm3-test\\0plan\\0plan-1',
    id: 'plan-1',
    chatKey: 'm3-test',
    table: 'plan',
    name: '旧港口回报',
    visibility: 'backstage',
    status: 'pending',
    revision: 2,
    data: { actors: ['林遥'] },
    createdAt: 1,
    updatedAt: 2,
  });

  const result = queryWorldEvolutionCandidates({
    messageId: 7,
    messageText: '<ReplicaEnum>{"enums":[{"spec":"npc@act","values":["林遥","苏晚"],"task":"前台角色"}]}</ReplicaEnum> 林遥到了北门。',
    databaseSnapshot: database,
    mvuSnapshot: { characters: [{ id: 'suwan', name: '苏晚', location: '北门' }] },
    previousMvuSnapshot: { characters: [{ id: 'suwan', name: '苏晚', location: '南门' }] },
    workflowSnapshot: { extractedTags: [{ name: '林遥' }] },
    shujukuSnapshot: { 联系方式表: { rows: [{ id: 'suwan', name: '苏晚', phone: '123' }] } },
    manualCandidates: ['顾行舟'],
    maxNpcCandidates: 4,
    maxOtherCandidates: 2,
  });

  assert.deepEqual(result.candidates.map(candidate => candidate.name), ['顾行舟', '林遥', '苏晚']);
  assert.equal(result.candidates.find(candidate => candidate.name === '林遥')?.source, 'replica_enum');
  assert.ok(result.candidates.find(candidate => candidate.name === '苏晚')?.evidence.some(item => item.includes('MVU')));
  assert.ok(result.tables.some(table => table.table === 'npc'));
  assert.ok(result.candidateRows.some(row => row.table === '联系方式表' && row.rowId === 'suwan'));
  assert.equal(result.currentFloor.messageId, 7);
});

test('M3 query does not mutate database or external snapshots', () => {
  const database = createEmptyDbSnapshot('m3-readonly');
  const before = structuredClone(database);
  const mvu = { rows: [{ name: '甲' }] };
  const external = { table: [{ name: '乙' }] };
  queryWorldEvolutionCandidates({
    messageId: 1,
    messageText: '甲',
    databaseSnapshot: database,
    mvuSnapshot: mvu,
    shujukuSnapshot: external,
    maxNpcCandidates: 2,
    maxOtherCandidates: 1,
  });
  assert.deepEqual(database, before);
  assert.deepEqual(mvu, { rows: [{ name: '甲' }] });
  assert.deepEqual(external, { table: [{ name: '乙' }] });
});

test('M3 MVU adapter recognizes name-keyed NPC collections', () => {
  const database = createEmptyDbSnapshot('m3-mvu-keyed');
  const result = queryWorldEvolutionCandidates({
    messageId: 2,
    messageText: '后台状态已更新',
    databaseSnapshot: database,
    mvuSnapshot: {
      stat_data: {
        角色表: {
          角色甲: { location: '东门', goal: '巡逻' },
        },
      },
    },
    previousMvuSnapshot: {
      stat_data: {
        角色表: {
          角色甲: { location: '西门', goal: '巡逻' },
        },
      },
    },
    maxNpcCandidates: 2,
    maxOtherCandidates: 0,
  });

  assert.equal(result.candidates[0]?.name, '角色甲');
  assert.equal(result.candidates[0]?.source, 'mvu');
  assert.ok(result.candidates[0]?.evidence.some(item => item.includes('不同')));
});
