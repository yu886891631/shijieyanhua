import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyOperations,
  buildInverseOperations,
  commitRevisionSnapshot,
  createCheckpointSnapshot,
  rebuildAfterDeletingFloor,
  rebuildFromCheckpoint,
  replayRevisions,
  selectCheckpoint,
} from './replay';
import {
  checkpointKey,
  createEmptyDbSnapshot,
  revisionKey,
  rowKey,
  type WorldEvolutionDbOperation,
  type WorldEvolutionDbRevision,
  type WorldEvolutionDbRow,
} from './types';

const chatKey = 'chat-m2';

function npc(id: string, name: string, revision: number): WorldEvolutionDbRow {
  return {
    key: rowKey(chatKey, 'npc', id),
    id,
    chatKey,
    table: 'npc',
    name,
    visibility: 'backstage',
    revision,
    data: { name },
    createdAt: revision,
    updatedAt: revision,
  };
}

function revision(
  number: number,
  messageId: number,
  operations: WorldEvolutionDbOperation[],
  inverseOperations: WorldEvolutionDbOperation[],
): WorldEvolutionDbRevision {
  return {
    key: revisionKey(chatKey, number),
    id: `revision-${number}`,
    chatKey,
    revision: number,
    parentRevision: number - 1,
    messageId,
    messageFingerprint: `fingerprint-${messageId}`,
    source: 'auto',
    status: 'valid',
    operations,
    inverseOperations,
    createdAt: number,
    updatedAt: number,
  };
}

test('forward operations and generated inverse restore the exact previous rows', () => {
  const initial = createEmptyDbSnapshot(chatKey).rows;
  initial.npc.push(npc('a', 'Alpha', 0));
  const operations: WorldEvolutionDbOperation[] = [
    { op: 'upsert', table: 'npc', id: 'a', row: npc('a', 'Alpha 2', 1) },
    { op: 'upsert', table: 'npc', id: 'b', row: npc('b', 'Beta', 1) },
  ];
  const inverse = buildInverseOperations(initial, operations);
  const changed = applyOperations(initial, operations);
  assert.equal(changed.npc.length, 2);
  assert.deepEqual(applyOperations(changed, inverse), initial);
});

test('deterministic replay produces the same result for the same revision chain', () => {
  const empty = createEmptyDbSnapshot(chatKey).rows;
  const first = revision(1, 10, [{ op: 'upsert', table: 'npc', id: 'a', row: npc('a', 'Alpha', 1) }], [
    { op: 'delete', table: 'npc', id: 'a' },
  ]);
  const second = revision(2, 20, [{ op: 'upsert', table: 'npc', id: 'a', row: npc('a', 'Alpha 2', 2) }], [
    { op: 'upsert', table: 'npc', id: 'a', row: npc('a', 'Alpha', 1) },
  ]);
  assert.deepEqual(replayRevisions(empty, [first, second]), replayRevisions(empty, [first, second]));
});

test('checkpoint rebuild can skip a deleted middle floor without calling AI', () => {
  const empty = createEmptyDbSnapshot(chatKey).rows;
  const first = revision(1, 10, [{ op: 'upsert', table: 'npc', id: 'a', row: npc('a', 'Alpha', 1) }], [
    { op: 'delete', table: 'npc', id: 'a' },
  ]);
  const second = revision(2, 20, [{ op: 'upsert', table: 'npc', id: 'b', row: npc('b', 'Beta', 2) }], [
    { op: 'delete', table: 'npc', id: 'b' },
  ]);
  const third = revision(3, 30, [{ op: 'upsert', table: 'npc', id: 'c', row: npc('c', 'Gamma', 3) }], [
    { op: 'delete', table: 'npc', id: 'c' },
  ]);
  const checkpointRows = replayRevisions(empty, [first]);
  const checkpoint = {
    key: checkpointKey(chatKey, 'cp-1'),
    id: 'cp-1',
    chatKey,
    revision: 1,
    messageId: 10,
    messageFingerprint: 'fingerprint-10',
    reason: 'auto' as const,
    rows: checkpointRows,
    createdAt: 1,
  };
  const rebuilt = rebuildFromCheckpoint(checkpoint, [second, third], new Set([20]));
  assert.deepEqual(rebuilt.npc.map(row => row.id).sort(), ['a', 'c']);
});

test('replay rejects a broken parent revision chain', () => {
  const empty = createEmptyDbSnapshot(chatKey).rows;
  const broken = revision(2, 20, [], []);
  broken.parentRevision = 0;
  assert.throws(() => replayRevisions(empty, [broken]), /revision 链不连续/);
});

test('selectCheckpoint returns the nearest checkpoint strictly before the affected revision', () => {
  const rows = createEmptyDbSnapshot(chatKey).rows;
  const checkpoints = [1, 5, 9].map(number => ({
    key: checkpointKey(chatKey, `cp-${number}`),
    id: `cp-${number}`,
    chatKey,
    revision: number,
    messageId: number,
    reason: 'auto' as const,
    rows,
    createdAt: number,
  }));
  assert.equal(selectCheckpoint(checkpoints, 9)?.revision, 5);
});

test('commitRevisionSnapshot increments revision and records an inverse operation', () => {
  const source = createEmptyDbSnapshot(chatKey);
  const result = commitRevisionSnapshot(source, {
    chatKey,
    messageId: 10,
    messageFingerprint: 'floor-10',
    source: 'auto',
    baseRevision: 0,
    operations: [{ op: 'upsert', table: 'npc', id: 'a', row: npc('a', 'Alpha', 0) }],
    now: 100,
  });
  assert.equal(result.snapshot.meta.revision, 1);
  assert.equal(result.revision.parentRevision, 0);
  assert.equal(result.snapshot.rows.npc[0]?.revision, 1);
  assert.deepEqual(result.revision.inverseOperations, [{ op: 'delete', table: 'npc', id: 'a' }]);
  assert.equal(result.snapshot.floorRuns[0]?.status, 'done');
});

test('rebuildAfterDeletingFloor marks affected history stale and replays later operations', () => {
  const empty = createEmptyDbSnapshot(chatKey);
  const first = commitRevisionSnapshot(empty, {
    chatKey,
    messageId: 10,
    messageFingerprint: 'floor-10',
    source: 'auto',
    baseRevision: 0,
    operations: [{ op: 'upsert', table: 'npc', id: 'a', row: npc('a', 'Alpha', 0) }],
    now: 1,
  });
  const checkpointed = {
    ...first.snapshot,
    checkpoints: [createCheckpointSnapshot(first.snapshot, { chatKey, messageId: 10, reason: 'auto', now: 2 })],
  };
  const second = commitRevisionSnapshot(checkpointed, {
    chatKey,
    messageId: 20,
    messageFingerprint: 'floor-20',
    source: 'auto',
    baseRevision: 1,
    operations: [{ op: 'upsert', table: 'npc', id: 'b', row: npc('b', 'Beta', 0) }],
    now: 3,
  });
  const third = commitRevisionSnapshot(second.snapshot, {
    chatKey,
    messageId: 30,
    messageFingerprint: 'floor-30',
    source: 'auto',
    baseRevision: 2,
    operations: [{ op: 'upsert', table: 'npc', id: 'c', row: npc('c', 'Gamma', 0) }],
    now: 4,
  });
  const rebuilt = rebuildAfterDeletingFloor(third.snapshot, 20);
  assert.deepEqual(rebuilt.rows.npc.map(row => row.id).sort(), ['a', 'c']);
  assert.deepEqual(rebuilt.revisions.map(revision => revision.status), ['valid', 'stale', 'stale']);
  assert.deepEqual(rebuilt.floorRuns.map(run => run.status).sort(), ['done', 'stale', 'stale']);
  assert.doesNotThrow(() => commitRevisionSnapshot(rebuilt, {
    chatKey,
    messageId: 40,
    messageFingerprint: 'floor-40',
    source: 'auto',
    baseRevision: rebuilt.meta.revision,
    operations: [{ op: 'upsert', table: 'npc', id: 'd', row: npc('d', 'Delta', 0) }],
    now: 5,
  }));
});
