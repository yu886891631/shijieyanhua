import assert from 'node:assert/strict';
import { test } from 'node:test';
import { commitRevisionSnapshot, WorldEvolutionRevisionConflictError } from './replay';
import { parseWorldEvolutionOperations, validateWorldEvolutionOperations } from './ai-operations';
import {
  createEmptyDbSnapshot, rowKey,
  type WorldEvolutionDbRow, type WorldEvolutionDbSnapshot,
} from './types';
import {
  DEFAULT_WORLD_EVOLUTION_SETTINGS,
  type WorldEvolutionInput,
} from '../世界演变/types';

const chatKey = 'm4-test';
const settings = { ...DEFAULT_WORLD_EVOLUTION_SETTINGS, maxNpcPerRun: 2, maxOtherEntitiesPerRun: 1 };
const input: WorldEvolutionInput = {
  chatKey, messageId: 14, latestMessage: '林遥离开了旧港口。',
  mvuSnapshot: null, mvuChangeSummary: '', databaseSnapshot: null, databaseSummary: '',
  candidateNames: ['林遥', '旧港口', '远山'],
  queryContext: {
    candidates: [
      { table: 'npc', rowId: 'external-77', name: '林遥', priority: 1, source: 'shujuku', evidence: [] },
      { table: 'location', rowId: 'location:旧港口', name: '旧港口', priority: 1, source: 'rotation', evidence: [] },
    ],
    candidateRows: [], tables: [], currentFloor: { messageId: 14, text: '' },
    mvuSnapshot: null, workflowSnapshot: null, shujukuSnapshot: null,
  },
};

function row(table: 'npc' | 'location' | 'event' | 'plan', id: string, name: string, visibility: WorldEvolutionDbRow['visibility'] = 'backstage'): WorldEvolutionDbRow {
  return {
    key: rowKey(chatKey, table, id), id, chatKey, table,
    ...(table === 'event' || table === 'plan' ? { title: name } : { name }),
    visibility, revision: 0, data: {},
    createdAt: 1, updatedAt: 1,
  };
}

function fixture(): WorldEvolutionDbSnapshot {
  const snapshot = createEmptyDbSnapshot(chatKey);
  snapshot.rows.npc.push(row('npc', 'npc:林遥', '林遥'));
  snapshot.rows.location.push(row('location', 'location:旧港口', '旧港口', 'ai_context'));
  return snapshot;
}

const upsert = {
  op: 'upsert', table: 'npc', id: 'npc:林遥', name: '林遥',
  changes: { current_goal: '调查码头' },
};

function validate(snapshot: WorldEvolutionDbSnapshot, operations: unknown[], baseRevision = snapshot.meta.revision) {
  const parsed = parseWorldEvolutionOperations(JSON.stringify({ baseRevision, operations }));
  return validateWorldEvolutionOperations(snapshot, parsed, input, settings, 100);
}

test('合法批次提交一次 revision，记录逆操作并确定性重放事件与计划', () => {
  const before = fixture();
  const proposed = validate(before, [
    upsert,
    { op: 'append', table: 'event', data: { summary: '开始行动', actorIds: ['npc:林遥'], locationId: 'location:旧港口' } },
    { op: 'append', table: 'plan', data: { title: '查找证人', actorIds: ['npc:林遥'] } },
  ]);
  const committed = commitRevisionSnapshot(before, {
    chatKey, messageId: 14, messageFingerprint: 'fp', source: 'auto',
    baseRevision: 0, operations: proposed.operations, now: 100,
  });
  assert.deepEqual(proposed.changedEntityIds, ['npc:林遥']);
  assert.deepEqual(proposed.eventIds, ['EV-14-2']);
  assert.deepEqual(committed.snapshot.rows.event[0]?.data.actors, ['林遥']);
  assert.deepEqual(committed.snapshot.rows.plan[0]?.data.actors, ['林遥']);
  assert.equal(committed.snapshot.meta.revision, 1);
  assert.equal(committed.revision.operations.length, 3);
  assert.equal(committed.revision.inverseOperations.length, 3);
  assert.equal(before.rows.event.length, 0);
});

test('拒绝旧协议、Markdown、未允许字段和超长响应', () => {
  assert.throws(() => parseWorldEvolutionOperations('```json\n{"baseRevision":0,"operations":[]}\n```'), /单个合法 JSON/);
  assert.throws(() => parseWorldEvolutionOperations('{"baseRevision":0,"updates":[],"operations":[]}'), /未允许字段/);
  assert.throws(() => parseWorldEvolutionOperations(JSON.stringify({ baseRevision: 0, operations: Array(33).fill(upsert) })), /最多 32/);
  assert.throws(() => parseWorldEvolutionOperations('x'.repeat(48_001)), /超过大小限制/);
  assert.throws(() => validate(fixture(), [{ ...upsert, row: {} }]), /未允许字段/);
  assert.throws(() => validate(fixture(), [{ ...upsert, changes: { current_goal: 'a'.repeat(2_001) } }]), /文本过长/);
  assert.throws(() => validate(fixture(), [{ ...upsert, changes: { revision: 7 } }]), /保留字段/);
});

test('外部表 ID、虚构稳定 ID、非候选姓名与候选表错配不能写入', () => {
  assert.throws(() => validate(fixture(), [{ ...upsert, id: 'external-77' }]), /本库稳定 ID/);
  assert.throws(() => validate(fixture(), [{ ...upsert, name: '陌生人', id: 'npc:陌生人' }]), /非候选对象/);
  assert.throws(() => validate(fixture(), [{ ...upsert, table: 'organization' }]), /候选类型不一致/);
  assert.throws(() => validate(fixture(), [{ ...upsert, id: 'npc:新ID' }]), /本库稳定 ID/);
});

test('重复 ID、错误引用、超出上限以及非法状态整批拒绝', () => {
  assert.throws(() => validate(fixture(), [upsert, upsert]), /重复操作/);
  assert.throws(() => validate(fixture(), [
    upsert, { op: 'append', table: 'event', id: 'EV-X', data: { summary: '一' } },
    { op: 'append', table: 'event', id: 'EV-X', data: { summary: '二' } },
  ]), /重复或已存在/);
  assert.throws(() => validate(fixture(), [
    upsert, { op: 'append', table: 'plan', data: { title: '找人', actorIds: ['external-77'] } },
  ]), /不存在、类型不匹配或已删除/);
  assert.throws(() => validate(fixture(), [
    upsert, { op: 'append', table: 'event', data: { summary: '地点不是人', actorIds: ['location:旧港口'] } },
  ]), /类型不匹配/);
  assert.throws(() => validate(fixture(), [
    upsert, { op: 'upsert', table: 'npc', id: 'npc:远山', name: '远山', changes: { goal: '一' } },
    { op: 'upsert', table: 'npc', id: 'npc:第三位', name: '第三位', changes: { goal: '二' } },
  ]), /非候选对象/);
  const moreCandidates = { ...input, candidateNames: [...input.candidateNames, '第三位'] };
  assert.throws(() => validateWorldEvolutionOperations(fixture(),
    parseWorldEvolutionOperations(JSON.stringify({ baseRevision: 0, operations: [
      upsert, { op: 'upsert', table: 'npc', id: 'npc:远山', name: '远山', changes: { goal: '一' } },
      { op: 'upsert', table: 'npc', id: 'npc:第三位', name: '第三位', changes: { goal: '二' } },
    ] })), moreCandidates, settings), /超过本轮上限/);
  assert.throws(() => validate(fixture(), [{ op: 'update_status', table: 'plan', id: 'missing', status: 'completed' }]), /不存在/);
});

test('后台内容不会被自动提升为主角已知；删除仅限未引用的 backstage 实体', () => {
  assert.throws(() => validate(fixture(), [{ ...upsert, visibility: 'revealed' }]), /不能自动/);
  assert.throws(() => validate(fixture(), [{ ...upsert, visibility: 'ai_context' }]), /不能自动/);
  assert.throws(() => validate(fixture(), [
    { op: 'append', table: 'event', data: { summary: '揭露', visibility: 'protagonist_known' } },
  ]), /不能自动/);
  assert.throws(() => validate(fixture(), [
    { op: 'delete', table: 'location', id: 'location:旧港口', name: '旧港口' },
  ]), /只能删除/);
  const known = fixture();
  known.rows.npc[0]!.visibility = 'protagonist_known';
  assert.throws(() => validate(known, [upsert]), /不能由后台 AI 改写/);
  const referenced = fixture();
  referenced.rows.plan.push({ ...row('plan', 'plan:1', '等待'), data: { actorIds: ['npc:林遥'] } });
  assert.throws(() => validate(referenced, [
    { op: 'delete', table: 'npc', id: 'npc:林遥', name: '林遥' },
  ]), /仍被 plan/);
  const removable = fixture();
  removable.rows.location[0]!.data = { relatedIds: ['npc:林遥'] };
  assert.deepEqual(validate(removable, [
    { op: 'upsert', table: 'location', id: 'location:旧港口', name: '旧港口', changes: { relatedIds: [] } },
    { op: 'delete', table: 'npc', id: 'npc:林遥', name: '林遥' },
  ]).operations.map(operation => operation.op), ['upsert', 'delete']);
  assert.deepEqual(validate(fixture(), [
    { op: 'delete', table: 'npc', id: 'npc:林遥', name: '林遥' },
  ]).operations, [{ op: 'delete', table: 'npc', id: 'npc:林遥' }]);
});

test('已存在实体沿用本库 ID；事件/计划状态只对本轮相关未完成记录转换', () => {
  const snapshot = fixture();
  snapshot.rows.npc[0]!.id = 'npc:stable-1';
  snapshot.rows.npc[0]!.key = rowKey(chatKey, 'npc', 'npc:stable-1');
  snapshot.rows.plan.push({
    ...row('plan', 'PL-1', '找人'), data: { actorIds: ['npc:stable-1'], status: 'pending' }, status: 'pending',
  });
  const proposal = validate(snapshot, [
    { ...upsert, id: 'npc:stable-1', changes: { current_goal: '进入港口' } },
    { op: 'update_status', table: 'plan', id: 'PL-1', status: 'completed' },
  ]);
  assert.equal(proposal.operations.length, 2);
  assert.equal(proposal.operations[1]?.op === 'upsert' && proposal.operations[1].row.data.status, 'completed');
  assert.throws(() => validate(snapshot, [
    { ...upsert, id: 'npc:林遥' },
  ]), /沿用同名对象已有/);
  assert.throws(() => validate(snapshot, [
    { op: 'update_status', table: 'plan', id: 'PL-1', status: 'invalid' },
  ]), /status 无效/);
});

test('无效批次不改变快照；生成后 revision 推进时提交层拒绝旧基线', () => {
  const before = fixture();
  const original = structuredClone(before);
  assert.throws(() => validate(before, [
    upsert, { op: 'append', table: 'event', data: { summary: '无效引用', actorIds: ['npc:不存在'] } },
  ]), /不存在/);
  assert.deepEqual(before, original);
  const first = validate(before, [upsert]);
  const committed = commitRevisionSnapshot(before, {
    chatKey, messageId: 15, messageFingerprint: 'another-floor', source: 'manual',
    baseRevision: 0, operations: first.operations,
  });
  assert.throws(() => validate(committed.snapshot, [upsert], 0), /baseRevision 冲突/);
  assert.throws(() => commitRevisionSnapshot(committed.snapshot, {
    chatKey, messageId: 14, messageFingerprint: 'fp', source: 'auto',
    baseRevision: 0, operations: first.operations,
  }), WorldEvolutionRevisionConflictError);
  assert.equal(committed.snapshot.meta.revision, 1);
  assert.equal(committed.snapshot.revisions.length, 1);
});
