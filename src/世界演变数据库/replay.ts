import {
  WORLD_EVOLUTION_DB_TABLES,
  cloneDbValue,
  createEmptyDbSnapshot,
  revisionKey,
  rowKey,
  type WorldEvolutionDbCheckpoint,
  type WorldEvolutionDbFloorRun,
  type WorldEvolutionDbMeta,
  type WorldEvolutionDbOperation,
  type WorldEvolutionDbRevision,
  type WorldEvolutionDbRow,
  type WorldEvolutionDbSnapshot,
  type WorldEvolutionDbTable,
} from './types';
import { assertWorldEvolutionDbConsistency } from './consistency';

export type WorldEvolutionReplayRows = Record<WorldEvolutionDbTable, WorldEvolutionDbRow[]>;

export class WorldEvolutionRevisionConflictError extends Error {
  public readonly expectedRevision: number;
  public readonly actualRevision: number;

  public constructor(expectedRevision: number, actualRevision: number) {
    super(`revision 冲突：期望 ${expectedRevision}，实际 ${actualRevision}`);
    this.name = 'WorldEvolutionRevisionConflictError';
    this.expectedRevision = expectedRevision;
    this.actualRevision = actualRevision;
  }
}

export type CommitRevisionInput = {
  chatKey: string;
  messageId: number;
  messageFingerprint: string;
  source: 'auto' | 'manual' | 'retry' | 'rebuild';
  baseRevision: number;
  operations: WorldEvolutionDbOperation[];
  now?: number;
  revisionId?: string;
};

export type CommitRevisionResult = {
  snapshot: WorldEvolutionDbSnapshot;
  revision: WorldEvolutionDbRevision;
  inverseOperations: WorldEvolutionDbOperation[];
};

function cloneRows(rows: WorldEvolutionReplayRows): WorldEvolutionReplayRows {
  const result = createEmptyDbSnapshot('').rows;
  for (const table of WORLD_EVOLUTION_DB_TABLES) result[table] = cloneDbValue(rows[table] ?? []);
  return result;
}

function baselineRows(snapshot: WorldEvolutionDbSnapshot): WorldEvolutionReplayRows {
  const touched = new Set<string>();
  for (const revision of snapshot.revisions) {
    for (const operation of revision.operations) touched.add(`${operation.table}\0${operation.id}`);
  }
  const result = cloneRows(snapshot.rows);
  for (const table of WORLD_EVOLUTION_DB_TABLES) {
    result[table] = result[table].filter(row => !touched.has(`${table}\0${row.id}`));
  }
  return result;
}

export function assertSnapshotReplayConsistency(snapshot: WorldEvolutionDbSnapshot): void {
  // 删除/滑动楼层后，后续 revision 会被标记为 stale，但 materialized rows
  // 仍保留它们的确定性结果，等待后续楼层重新确认；此时不能只重放 valid
  // revision，否则会把这段暂存状态误判成漂移。
  if (snapshot.revisions.some(revision => revision.status === 'stale')) {
    assertWorldEvolutionDbConsistency(snapshot);
    return;
  }
  const replayed = replayRevisions(baselineRows(snapshot), snapshot.revisions, {
    baseRevision: 0,
    allowGaps: false,
  });
  assertWorldEvolutionDbConsistency(snapshot, { expectedRows: replayed });
}

function findRow(rows: WorldEvolutionReplayRows, table: WorldEvolutionDbTable, id: string): WorldEvolutionDbRow | undefined {
  return rows[table].find(row => row.id === id && !row.deletedAt);
}

export function applyOperations(
  source: WorldEvolutionReplayRows,
  operations: readonly WorldEvolutionDbOperation[],
): WorldEvolutionReplayRows {
  const rows = cloneRows(source);
  for (const operation of operations) {
    const tableRows = rows[operation.table];
    const index = tableRows.findIndex(row => row.id === operation.id);
    if (operation.op === 'delete') {
      if (index >= 0) tableRows.splice(index, 1);
      continue;
    }
    const row = cloneDbValue(operation.row);
    if (row.table !== operation.table || row.id !== operation.id) {
      throw new Error(`操作目标不一致：${operation.table}/${operation.id}`);
    }
    row.key = rowKey(row.chatKey, operation.table, operation.id);
    if (index >= 0) tableRows[index] = row;
    else tableRows.push(row);
  }
  return rows;
}

export function buildInverseOperations(
  source: WorldEvolutionReplayRows,
  operations: readonly WorldEvolutionDbOperation[],
): WorldEvolutionDbOperation[] {
  let working = cloneRows(source);
  const inverse: WorldEvolutionDbOperation[] = [];
  for (const operation of operations) {
    const previous = findRow(working, operation.table, operation.id);
    inverse.unshift(
      previous
        ? { op: 'upsert', table: operation.table, id: operation.id, row: cloneDbValue(previous) }
        : { op: 'delete', table: operation.table, id: operation.id },
    );
    working = applyOperations(working, [operation]);
  }
  return inverse;
}

export function replayRevisions(
  baseRows: WorldEvolutionReplayRows,
  revisions: readonly WorldEvolutionDbRevision[],
  options: {
    skipMessageIds?: ReadonlySet<number>;
    throughRevision?: number;
    baseRevision?: number;
    allowGaps?: boolean;
  } = {},
): WorldEvolutionReplayRows {
  const allOrdered = [...revisions]
    .filter(revision => options.throughRevision === undefined || revision.revision <= options.throughRevision)
    .sort((left, right) => left.revision - right.revision);
  const ordered = allOrdered
    .filter(revision => revision.status === 'valid')
    .filter(revision => !options.skipMessageIds?.has(revision.messageId));
  let rows = cloneRows(baseRows);
  let expectedParent = options.baseRevision ?? 0;
  for (const revision of ordered) {
    const skippedBetween = allOrdered.filter(
      candidate => candidate.revision > expectedParent && candidate.revision < revision.revision,
    );
    const staleGap = skippedBetween.length > 0 && skippedBetween.every(candidate => candidate.status !== 'valid');
    const hasGap = revision.revision !== expectedParent + 1;
    if (
      !options.allowGaps &&
      ((revision.parentRevision !== expectedParent && !staleGap) ||
        (hasGap && !staleGap))
    ) {
      throw new Error(
        `revision 链不连续：${revision.revision} 的 parent=${revision.parentRevision}，预期 ${expectedParent}`,
      );
    }
    rows = applyOperations(rows, revision.operations);
    expectedParent = revision.revision;
  }
  return rows;
}

export function rebuildFromCheckpoint(
  checkpoint: WorldEvolutionDbCheckpoint,
  revisions: readonly WorldEvolutionDbRevision[],
  skipMessageIds: ReadonlySet<number> = new Set(),
): WorldEvolutionReplayRows {
  return replayRevisions(checkpoint.rows, revisions.filter(revision => revision.revision > checkpoint.revision), {
    skipMessageIds,
    baseRevision: checkpoint.revision,
    allowGaps: skipMessageIds.size > 0,
  });
}

export function selectCheckpoint(
  checkpoints: readonly WorldEvolutionDbCheckpoint[],
  beforeRevision: number,
): WorldEvolutionDbCheckpoint | undefined {
  return [...checkpoints]
    .filter(checkpoint => checkpoint.revision < beforeRevision)
    .sort((left, right) => right.revision - left.revision)[0];
}

function normalizeCommitOperations(
  operations: readonly WorldEvolutionDbOperation[],
  chatKey: string,
  revision: number,
): WorldEvolutionDbOperation[] {
  return operations.map(operation => {
    if (operation.op === 'delete') return cloneDbValue(operation);
    const row = cloneDbValue(operation.row);
    row.chatKey = chatKey;
    row.table = operation.table;
    row.id = operation.id;
    row.key = rowKey(chatKey, operation.table, operation.id);
    row.revision = revision;
    row.deletedAt = undefined;
    return { op: 'upsert', table: operation.table, id: operation.id, row };
  });
}

export function commitRevisionSnapshot(
  source: WorldEvolutionDbSnapshot,
  input: CommitRevisionInput,
): CommitRevisionResult {
  if (source.meta.chatKey !== input.chatKey) {
    throw new Error(`chatKey 不一致：${source.meta.chatKey} !== ${input.chatKey}`);
  }
  if (source.meta.revision !== input.baseRevision) {
    throw new WorldEvolutionRevisionConflictError(input.baseRevision, source.meta.revision);
  }
  const now = input.now ?? Date.now();
  const revisionNumber = source.meta.revision + 1;
  const parentRevision =
    [...source.revisions]
      .filter(revision => revision.status === 'valid' && revision.revision <= source.meta.revision)
      .sort((left, right) => right.revision - left.revision)[0]?.revision ?? 0;
  const operations = normalizeCommitOperations(input.operations, input.chatKey, revisionNumber);
  const inverseOperations = buildInverseOperations(source.rows, operations);
  const rows = applyOperations(source.rows, operations);
  const revision: WorldEvolutionDbRevision = {
    key: revisionKey(input.chatKey, revisionNumber),
    id: input.revisionId ?? `revision-${input.chatKey}-${revisionNumber}`,
    chatKey: input.chatKey,
    revision: revisionNumber,
    parentRevision,
    messageId: input.messageId,
    messageFingerprint: input.messageFingerprint,
    source: input.source,
    status: 'valid',
    operations,
    inverseOperations,
    createdAt: now,
    updatedAt: now,
  };
  const nextMeta: WorldEvolutionDbMeta = {
    ...cloneDbValue(source.meta),
    revision: revisionNumber,
    lastMessageId: input.messageId,
    lastMessageFingerprint: input.messageFingerprint,
    updatedAt: now,
  };
  const floorRun: WorldEvolutionDbFloorRun = {
    key: `${input.chatKey}\0${input.messageId}\0${input.messageFingerprint}`,
    id: `floor-${input.chatKey}-${input.messageId}-${input.messageFingerprint}`,
    chatKey: input.chatKey,
    messageId: input.messageId,
    messageFingerprint: input.messageFingerprint,
    source: input.source,
    status: 'done',
    baseRevision: input.baseRevision,
    resultRevision: revisionNumber,
    operationCount: operations.length,
    candidateNames: [],
    changedEntityIds: [],
    eventIds: [],
    createdAt: now,
    updatedAt: now,
  };
  const result = {
    snapshot: {
      meta: nextMeta,
      rows,
      floorRuns: [
        ...source.floorRuns.filter(
          run => run.messageId !== input.messageId || run.messageFingerprint !== input.messageFingerprint,
        ),
        floorRun,
      ],
      revisions: [...source.revisions, revision],
      checkpoints: cloneDbValue(source.checkpoints),
      projections: cloneDbValue(source.projections),
    },
    revision,
    inverseOperations,
  };
  assertSnapshotReplayConsistency(result.snapshot);
  return result;
}

export type CheckpointInput = {
  chatKey: string;
  messageId: number;
  messageFingerprint?: string;
  reason: WorldEvolutionDbCheckpoint['reason'];
  id?: string;
  now?: number;
};

export function createCheckpointSnapshot(
  source: WorldEvolutionDbSnapshot,
  input: CheckpointInput,
): WorldEvolutionDbCheckpoint {
  const now = input.now ?? Date.now();
  const id = input.id ?? `checkpoint-${input.chatKey}-${source.meta.revision}`;
  return {
    key: `${input.chatKey}\0${id}`,
    id,
    chatKey: input.chatKey,
    revision: source.meta.revision,
    messageId: input.messageId,
    messageFingerprint: input.messageFingerprint,
    reason: input.reason,
    rows: cloneRows(source.rows),
    createdAt: now,
  };
}

export function rebuildAfterDeletingFloor(
  source: WorldEvolutionDbSnapshot,
  messageId: number,
): WorldEvolutionDbSnapshot {
  assertSnapshotReplayConsistency(source);
  const affected = source.revisions.filter(revision => revision.messageId === messageId);
  if (affected.length === 0) return cloneDbValue(source);
  const firstAffectedRevision = Math.min(...affected.map(revision => revision.revision));
  const checkpoint = selectCheckpoint(source.checkpoints, firstAffectedRevision);
  const baseRows = checkpoint ? checkpoint.rows : baselineRows(source);
  const revisions = checkpoint
    ? source.revisions.filter(revision => revision.revision > checkpoint.revision)
    : source.revisions;
  const rows = replayRevisions(baseRows, revisions, {
    skipMessageIds: new Set([messageId]),
    baseRevision: checkpoint?.revision ?? 0,
    allowGaps: true,
  });
  const nextRevisions = source.revisions.map(revision =>
    revision.revision >= firstAffectedRevision
      ? { ...revision, status: 'stale' as const, updatedAt: Date.now() }
      : revision,
  );
  const nextFloorRuns = source.floorRuns.map(run =>
    run.resultRevision !== undefined && run.resultRevision >= firstAffectedRevision
      ? { ...run, status: 'stale' as const, updatedAt: Date.now(), error: `楼层 ${messageId} 删除后待重新确认` }
      : run,
  );
  const result = {
    ...cloneDbValue(source),
    rows,
    floorRuns: nextFloorRuns,
    revisions: nextRevisions,
  };
  assertWorldEvolutionDbConsistency(result, { expectedRows: rows });
  return result;
}
