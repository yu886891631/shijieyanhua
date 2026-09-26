export const WORLD_EVOLUTION_DB_VERSION = 'A0.1.0-alpha.8';

export type WorldEvolutionDbTable =
  | 'npc'
  | 'organization'
  | 'location'
  | 'society'
  | 'environment'
  | 'event'
  | 'plan';

export type WorldEvolutionProjectionTable = 'index' | WorldEvolutionDbTable;

export const WORLD_EVOLUTION_DB_TABLES: WorldEvolutionDbTable[] = [
  'npc',
  'organization',
  'location',
  'society',
  'environment',
  'event',
  'plan',
];

export const WORLD_EVOLUTION_DB_TABLE_LABELS: Record<WorldEvolutionDbTable, string> = {
  npc: 'NPC',
  organization: '组织',
  location: '地点',
  society: '社会',
  environment: '环境',
  event: '事件',
  plan: '计划',
};

export type WorldEvolutionDbVisibility =
  | 'backstage'
  | 'ai_context'
  | 'protagonist_known'
  | 'revealed';

export type WorldEvolutionDbWorldbookSyncState = {
  status: 'never' | 'pending' | 'synced' | 'failed';
  worldbookName?: string;
  lastAttemptAt?: number;
  lastSuccessAt?: number;
  error?: string;
};

export type WorldEvolutionDbProjectionStatus = 'synced' | 'pending' | 'failed' | 'orphaned';

export type WorldEvolutionDbWorldbookProjection = {
  key: string;
  chatKey: string;
  bookName: string;
  projectionKey: string;
  table: WorldEvolutionProjectionTable;
  rowId: string;
  uid?: number | string;
  contentFingerprint: string;
  sourceRevision: number;
  status: WorldEvolutionDbProjectionStatus;
  error?: string;
  updatedAt: number;
};

export type WorldEvolutionDbRow = {
  key: string;
  id: string;
  chatKey: string;
  table: WorldEvolutionDbTable;
  name?: string;
  title?: string;
  visibility: WorldEvolutionDbVisibility;
  status?: string;
  sourceMessageId?: number;
  revision: number;
  data: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
};

export type WorldEvolutionDbMeta = {
  key: string;
  chatKey: string;
  revision: number;
  lastMessageId?: number;
  lastMessageFingerprint?: string;
  worldbookSync: WorldEvolutionDbWorldbookSyncState;
  updatedAt: number;
};

export type WorldEvolutionDbFloorRun = {
  key: string;
  id: string;
  chatKey: string;
  messageId: number;
  messageFingerprint: string;
  source: 'auto' | 'manual' | 'retry' | 'rebuild';
  status: 'queued' | 'running' | 'done' | 'skipped' | 'failed' | 'cancelled' | 'stale';
  baseRevision: number;
  resultRevision?: number;
  operationCount: number;
  error?: string;
  attempt?: number;
  enqueuedAt?: number;
  startedAt?: number;
  finishedAt?: number;
  candidateNames: string[];
  changedEntityIds: string[];
  eventIds: string[];
  createdAt: number;
  updatedAt: number;
};

export type WorldEvolutionDbOperation =
  | {
      op: 'upsert';
      table: WorldEvolutionDbTable;
      id: string;
      row: WorldEvolutionDbRow;
    }
  | {
      op: 'delete';
      table: WorldEvolutionDbTable;
      id: string;
    };

export type WorldEvolutionDbRevisionStatus = 'valid' | 'stale' | 'reverted';

export type WorldEvolutionDbRevision = {
  key: string;
  id: string;
  chatKey: string;
  revision: number;
  parentRevision: number;
  messageId: number;
  messageFingerprint: string;
  source: 'auto' | 'manual' | 'retry' | 'rebuild' | 'migration';
  status: WorldEvolutionDbRevisionStatus;
  operations: WorldEvolutionDbOperation[];
  inverseOperations: WorldEvolutionDbOperation[];
  createdAt: number;
  updatedAt: number;
  revertedByRevision?: number;
};

export type WorldEvolutionDbCheckpointReason = 'auto' | 'manual' | 'rebuild' | 'migration';

export type WorldEvolutionDbCheckpoint = {
  key: string;
  id: string;
  chatKey: string;
  revision: number;
  messageId: number;
  messageFingerprint?: string;
  reason: WorldEvolutionDbCheckpointReason;
  rows: Record<WorldEvolutionDbTable, WorldEvolutionDbRow[]>;
  createdAt: number;
};

export type WorldEvolutionDbSnapshot = {
  meta: WorldEvolutionDbMeta;
  rows: Record<WorldEvolutionDbTable, WorldEvolutionDbRow[]>;
  floorRuns: WorldEvolutionDbFloorRun[];
  revisions: WorldEvolutionDbRevision[];
  checkpoints: WorldEvolutionDbCheckpoint[];
  projections: WorldEvolutionDbWorldbookProjection[];
};

export type WorldEvolutionDbMigrationBackup = {
  key: string;
  chatKey: string;
  sourceVersion: string;
  importedAt: number;
  rawJson: string;
  sourceRevision: number;
  checksum: string;
};

export type WorldEvolutionDbTableName =
  | WorldEvolutionDbTable
  | 'floor_run'
  | 'evolution_revision'
  | 'evolution_checkpoint'
  | 'worldbook_projection';

export function rowKey(chatKey: string, table: WorldEvolutionDbTable, id: string): string {
  return `${chatKey}\0${table}\0${id}`;
}

export function floorRunKey(chatKey: string, messageId: number, fingerprint: string): string {
  return `${chatKey}\0${messageId}\0${fingerprint}`;
}

export function revisionKey(chatKey: string, revision: number): string {
  return `${chatKey}\0${revision}`;
}

export function checkpointKey(chatKey: string, id: string): string {
  return `${chatKey}\0${id}`;
}

export function worldbookProjectionKey(chatKey: string, bookName: string, projectionKey: string): string {
  return `${chatKey}\0${bookName}\0${projectionKey}`;
}

export function createEmptyDbMeta(chatKey: string): WorldEvolutionDbMeta {
  return {
    key: chatKey,
    chatKey,
    revision: 0,
    worldbookSync: { status: 'never' },
    updatedAt: Date.now(),
  };
}

export function createEmptyDbSnapshot(chatKey: string): WorldEvolutionDbSnapshot {
  return {
    meta: createEmptyDbMeta(chatKey),
    rows: {
      npc: [],
      organization: [],
      location: [],
      society: [],
      environment: [],
      event: [],
      plan: [],
    },
    floorRuns: [],
    revisions: [],
    checkpoints: [],
    projections: [],
  };
}

export function cloneDbValue<T>(value: T): T {
  return structuredClone(value);
}
