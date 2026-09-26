import { createEmptyWorld } from '../世界演变/types';
import type {
  WorldEvolutionEntityType,
  WorldEvolutionRunRecord,
  WorldEvolutionWorld,
} from '../世界演变/types';
import {
  cloneDbValue,
  type WorldEvolutionDbRow,
  type WorldEvolutionDbSnapshot,
  type WorldEvolutionDbTable,
} from './types';

const ENTITY_TABLES: Array<[WorldEvolutionEntityType, WorldEvolutionDbTable]> = [
  ['npc', 'npc'],
  ['organization', 'organization'],
  ['location', 'location'],
  ['social', 'society'],
  ['environment', 'environment'],
];

function rowName(row: WorldEvolutionDbRow): string {
  return row.name ?? row.title ?? row.id;
}

function entityRows(snapshot: WorldEvolutionDbSnapshot) {
  return ENTITY_TABLES.flatMap(([type, table]) =>
    snapshot.rows[table].map(row => ({ row, type })),
  );
}

export function dbSnapshotToWorld(snapshot: WorldEvolutionDbSnapshot): WorldEvolutionWorld {
  const world = createEmptyWorld(snapshot.meta.chatKey);
  world.revision = snapshot.meta.revision;
  world.worldbookSync = cloneDbValue(snapshot.meta.worldbookSync);
  for (const { row, type } of entityRows(snapshot)) {
    world.entities[row.id] = {
      id: row.id,
      type,
      name: rowName(row),
      state: cloneDbValue(row.data),
      visibility: row.visibility,
      updatedAt: row.updatedAt,
      sourceMessageId: row.sourceMessageId,
    };
  }
  world.events = snapshot.rows.event.map(row => ({
    id: row.id,
    type: typeof row.data.type === 'string' ? row.data.type : 'world_change',
    actors: Array.isArray(row.data.actors) ? row.data.actors.filter((item): item is string => typeof item === 'string') : [],
    summary: row.title ?? String(row.data.summary ?? row.id),
    details: typeof row.data.details === 'string' ? row.data.details : undefined,
    time: typeof row.data.time === 'string' ? row.data.time : undefined,
    location: typeof row.data.location === 'string' ? row.data.location : undefined,
    visibility: row.visibility,
    sourceMessageId: row.sourceMessageId ?? 0,
    createdAt: row.createdAt,
  }));
  world.scheduledEvents = snapshot.rows.plan.map(row => ({
    id: row.id,
    title: row.title ?? String(row.data.title ?? row.id),
    trigger: typeof row.data.trigger === 'string' ? row.data.trigger : undefined,
    actors: Array.isArray(row.data.actors) ? row.data.actors.filter((item): item is string => typeof item === 'string') : [],
    visibility: row.visibility,
    status:
      row.data.status === 'completed' || row.data.status === 'cancelled'
        ? row.data.status
        : 'pending',
    createdAt: row.createdAt,
  }));
  world.processedMessageKeys = snapshot.floorRuns
    .filter(run => run.status === 'done')
    .map(run => `${run.messageId}:${run.messageFingerprint}`);
  world.runRecords = snapshot.floorRuns.map<WorldEvolutionRunRecord>(run => ({
    key: run.key,
    chatKey: run.chatKey,
    messageId: run.messageId,
    messageFingerprint: run.messageFingerprint,
    source: run.source === 'rebuild' ? 'auto' : run.source,
    status:
      run.status === 'queued' ||
      run.status === 'running' ||
      run.status === 'done' ||
      run.status === 'skipped' ||
      run.status === 'failed' ||
      run.status === 'cancelled'
        ? run.status
        : run.status === 'stale'
          ? 'cancelled'
          : 'failed',
    attempt: run.attempt ?? 1,
    enqueuedAt: run.enqueuedAt ?? run.createdAt,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt ?? (run.status === 'done' || run.status === 'failed' ? run.updatedAt : undefined),
    candidateNames: [...run.candidateNames],
    changedEntityIds: [...run.changedEntityIds],
    eventIds: [...run.eventIds],
    error: run.error,
  }));
  world.revisions = snapshot.revisions.map(revision => ({
    revision: revision.revision,
    messageId: revision.messageId,
    messageFingerprint: revision.messageFingerprint,
    source: revision.source === 'manual' ? 'manual' : 'auto',
    changedEntityIds: revision.operations
      .filter(operation => operation.op === 'upsert' && ENTITY_TABLES.some(([, table]) => table === operation.table))
      .map(operation => operation.id),
    createdEventIds: revision.operations
      .filter(operation => operation.op === 'upsert' && (operation.table === 'event' || operation.table === 'plan'))
      .map(operation => operation.id),
    createdAt: revision.createdAt,
  }));
  world.checkpoints = snapshot.checkpoints.map(checkpoint => ({
    id: checkpoint.id,
    revision: checkpoint.revision,
    messageId: checkpoint.messageId,
    messageFingerprint: checkpoint.messageFingerprint,
    reason: checkpoint.reason === 'migration' ? 'auto' : checkpoint.reason === 'rebuild' ? 'rollback' : checkpoint.reason,
    createdAt: checkpoint.createdAt,
    entities: dbSnapshotToWorld({
      meta: { ...snapshot.meta, revision: checkpoint.revision },
      rows: checkpoint.rows,
      floorRuns: [],
      revisions: [],
      checkpoints: [],
      projections: [],
    }).entities,
    events: dbSnapshotToWorld({
      meta: { ...snapshot.meta, revision: checkpoint.revision },
      rows: checkpoint.rows,
      floorRuns: [],
      revisions: [],
      checkpoints: [],
      projections: [],
    }).events,
    scheduledEvents: dbSnapshotToWorld({
      meta: { ...snapshot.meta, revision: checkpoint.revision },
      rows: checkpoint.rows,
      floorRuns: [],
      revisions: [],
      checkpoints: [],
      projections: [],
    }).scheduledEvents,
    processedMessageKeys: [],
  }));
  return world;
}

export function isDbMessageProcessed(
  snapshot: WorldEvolutionDbSnapshot,
  messageId: number,
  messageFingerprint: string,
): boolean {
  return snapshot.floorRuns.some(
    run => run.messageId === messageId && run.status === 'done' && run.messageFingerprint === messageFingerprint,
  );
}
