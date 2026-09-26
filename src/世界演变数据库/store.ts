import {
  WORLD_EVOLUTION_DB_TABLES,
  cloneDbValue,
  createEmptyDbSnapshot,
  createEmptyDbMeta,
  checkpointKey,
  floorRunKey,
  revisionKey,
  rowKey,
  worldbookProjectionKey,
  type WorldEvolutionDbCheckpoint,
  type WorldEvolutionDbFloorRun,
  type WorldEvolutionDbMeta,
  type WorldEvolutionDbRow,
  type WorldEvolutionDbRevision,
  type WorldEvolutionDbOperation,
  type WorldEvolutionDbSnapshot,
  type WorldEvolutionDbTable,
  type WorldEvolutionDbTableName,
  type WorldEvolutionDbWorldbookSyncState,
  type WorldEvolutionDbWorldbookProjection,
  type WorldEvolutionDbMigrationBackup,
  type WorldEvolutionProjectionTable,
} from './types';
import {
  commitRevisionSnapshot,
  createCheckpointSnapshot,
  rebuildAfterDeletingFloor,
  WorldEvolutionRevisionConflictError,
  type CommitRevisionInput,
} from './replay';
import { assertWorldEvolutionDbConsistency } from './consistency';
import {
  buildLegacyMigrationPreview,
  isLegacyWorldEvolutionBackup,
  type WorldEvolutionMigrationPreview,
} from './migration';

const DB_NAME = 'acu-world-evolution-db';
const DB_VERSION = 4;
const META_STORE = 'world_meta';
const FLOOR_RUN_STORE = 'floor_run';
const REVISION_STORE = 'evolution_revision';
const CHECKPOINT_STORE = 'evolution_checkpoint';
const PROJECTION_STORE = 'worldbook_projection';
const MIGRATION_BACKUP_STORE = 'migration_backup';

const tableStores = [...WORLD_EVOLUTION_DB_TABLES] as string[];
const stores = [
  META_STORE,
  ...tableStores,
  FLOOR_RUN_STORE,
  REVISION_STORE,
  CHECKPOINT_STORE,
  PROJECTION_STORE,
  MIGRATION_BACKUP_STORE,
];
const chatWriteTails = new Map<string, Promise<void>>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      for (const storeName of stores) {
        if (!database.objectStoreNames.contains(storeName)) {
          const store = database.createObjectStore(storeName, { keyPath: 'key' });
          store.createIndex('chatKey', 'chatKey', { unique: false });
          store.createIndex('updatedAt', 'updatedAt', { unique: false });
        }
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('世界演变数据库打开失败'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('世界演变数据库事务失败'));
    transaction.onabort = () => reject(transaction.error ?? new Error('世界演变数据库事务已中止'));
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('世界演变数据库请求失败'));
  });
}

async function withChatWriteLock<T>(chatKey: string, work: () => Promise<T>): Promise<T> {
  const previous = chatWriteTails.get(chatKey) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>(resolve => {
    release = resolve;
  });
  chatWriteTails.set(chatKey, current);
  await previous;
  try {
    return await work();
  } finally {
    release();
    if (chatWriteTails.get(chatKey) === current) chatWriteTails.delete(chatKey);
  }
}

function normalizeMeta(chatKey: string, value: unknown): WorldEvolutionDbMeta {
  if (!isRecord(value)) return createEmptyDbMeta(chatKey);
  const rawSync = isRecord(value.worldbookSync) ? value.worldbookSync : {};
  const worldbookSync: WorldEvolutionDbWorldbookSyncState = {
    status:
      rawSync.status === 'pending' ||
      rawSync.status === 'synced' ||
      rawSync.status === 'failed' ||
      rawSync.status === 'never'
        ? rawSync.status
        : 'never',
    worldbookName: typeof rawSync.worldbookName === 'string' ? rawSync.worldbookName : undefined,
    lastAttemptAt: typeof rawSync.lastAttemptAt === 'number' ? rawSync.lastAttemptAt : undefined,
    lastSuccessAt: typeof rawSync.lastSuccessAt === 'number' ? rawSync.lastSuccessAt : undefined,
    error: typeof rawSync.error === 'string' ? rawSync.error : undefined,
  };
  return {
    key: chatKey,
    chatKey,
    revision: Number.isInteger(value.revision) ? Number(value.revision) : 0,
    lastMessageId: typeof value.lastMessageId === 'number' ? value.lastMessageId : undefined,
    lastMessageFingerprint:
      typeof value.lastMessageFingerprint === 'string' ? value.lastMessageFingerprint : undefined,
    worldbookSync,
    updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : Date.now(),
  };
}

function normalizeRow(table: WorldEvolutionDbTable, chatKey: string, value: unknown): WorldEvolutionDbRow | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.data !== 'object' || Array.isArray(value.data)) {
    return null;
  }
  return {
    key: typeof value.key === 'string' ? value.key : rowKey(chatKey, table, value.id),
    id: value.id,
    chatKey,
    table,
    name: typeof value.name === 'string' ? value.name : undefined,
    title: typeof value.title === 'string' ? value.title : undefined,
    visibility:
      value.visibility === 'backstage' ||
      value.visibility === 'protagonist_known' ||
      value.visibility === 'revealed'
        ? value.visibility
        : 'ai_context',
    status: typeof value.status === 'string' ? value.status : undefined,
    sourceMessageId: typeof value.sourceMessageId === 'number' ? value.sourceMessageId : undefined,
    revision: Number.isInteger(value.revision) ? Number(value.revision) : 0,
    data: cloneDbValue(value.data as Record<string, unknown>),
    createdAt: typeof value.createdAt === 'number' ? value.createdAt : Date.now(),
    updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : Date.now(),
    deletedAt: typeof value.deletedAt === 'number' ? value.deletedAt : undefined,
  };
}

function normalizeFloorRun(chatKey: string, value: unknown): WorldEvolutionDbFloorRun | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.messageId !== 'number') return null;
  return {
    key:
      typeof value.key === 'string'
        ? value.key
        : floorRunKey(chatKey, value.messageId, typeof value.messageFingerprint === 'string' ? value.messageFingerprint : ''),
    id: value.id,
    chatKey,
    messageId: value.messageId,
    messageFingerprint: typeof value.messageFingerprint === 'string' ? value.messageFingerprint : '',
    source:
      value.source === 'manual' || value.source === 'retry' || value.source === 'rebuild' ? value.source : 'auto',
    status:
      value.status === 'queued' ||
      value.status === 'running' ||
      value.status === 'done' ||
      value.status === 'skipped' ||
      value.status === 'cancelled' ||
      value.status === 'stale'
        ? value.status
        : 'failed',
    baseRevision: Number.isInteger(value.baseRevision) ? Number(value.baseRevision) : 0,
    resultRevision: typeof value.resultRevision === 'number' ? value.resultRevision : undefined,
    operationCount: typeof value.operationCount === 'number' ? value.operationCount : 0,
    error: typeof value.error === 'string' ? value.error : undefined,
    attempt: typeof value.attempt === 'number' ? value.attempt : undefined,
    enqueuedAt: typeof value.enqueuedAt === 'number' ? value.enqueuedAt : undefined,
    startedAt: typeof value.startedAt === 'number' ? value.startedAt : undefined,
    finishedAt: typeof value.finishedAt === 'number' ? value.finishedAt : undefined,
    candidateNames: Array.isArray(value.candidateNames)
      ? value.candidateNames.filter(item => typeof item === 'string')
      : [],
    changedEntityIds: Array.isArray(value.changedEntityIds)
      ? value.changedEntityIds.filter(item => typeof item === 'string')
      : [],
    eventIds: Array.isArray(value.eventIds)
      ? value.eventIds.filter(item => typeof item === 'string')
      : [],
    createdAt: typeof value.createdAt === 'number' ? value.createdAt : Date.now(),
    updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : Date.now(),
  };
}

function normalizeOperation(chatKey: string, value: unknown): WorldEvolutionDbOperation | null {
  if (!isRecord(value) || (value.op !== 'upsert' && value.op !== 'delete') || typeof value.table !== 'string') {
    return null;
  }
  if (!WORLD_EVOLUTION_DB_TABLES.includes(value.table as WorldEvolutionDbTable)) return null;
  const table = value.table as WorldEvolutionDbTable;
  if (typeof value.id !== 'string' || !value.id) return null;
  if (value.op === 'delete') return { op: 'delete', table, id: value.id };
  const row = normalizeRow(table, chatKey, value.row);
  return row ? { op: 'upsert', table, id: value.id, row } : null;
}

function normalizeRevision(chatKey: string, value: unknown): WorldEvolutionDbRevision | null {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.revision !== 'number' ||
    typeof value.messageId !== 'number' ||
    typeof value.messageFingerprint !== 'string'
  ) {
    return null;
  }
  const operations = Array.isArray(value.operations)
    ? value.operations.map(operation => normalizeOperation(chatKey, operation)).filter((operation): operation is WorldEvolutionDbOperation => operation !== null)
    : [];
  const inverseOperations = Array.isArray(value.inverseOperations)
    ? value.inverseOperations
        .map(operation => normalizeOperation(chatKey, operation))
        .filter((operation): operation is WorldEvolutionDbOperation => operation !== null)
    : [];
  const source =
    value.source === 'manual' || value.source === 'retry' || value.source === 'rebuild' || value.source === 'migration'
      ? value.source
      : 'auto';
  const status =
    value.status === 'stale' || value.status === 'reverted' ? value.status : 'valid';
  return {
    key: typeof value.key === 'string' ? value.key : revisionKey(chatKey, Number(value.revision)),
    id: value.id,
    chatKey,
    revision: Number(value.revision),
    parentRevision: Number.isInteger(value.parentRevision) ? Number(value.parentRevision) : Math.max(0, Number(value.revision) - 1),
    messageId: Number(value.messageId),
    messageFingerprint: String(value.messageFingerprint),
    source,
    status,
    operations,
    inverseOperations,
    createdAt: typeof value.createdAt === 'number' ? value.createdAt : Date.now(),
    updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : Date.now(),
    revertedByRevision: typeof value.revertedByRevision === 'number' ? value.revertedByRevision : undefined,
  };
}

function normalizeCheckpoint(chatKey: string, value: unknown): WorldEvolutionDbCheckpoint | null {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.revision !== 'number' ||
    typeof value.messageId !== 'number' ||
    !isRecord(value.rows)
  ) {
    return null;
  }
  const rows = createEmptyDbSnapshot(chatKey).rows;
  for (const table of WORLD_EVOLUTION_DB_TABLES) {
    rows[table] = (Array.isArray(value.rows[table]) ? value.rows[table] : [])
      .map(row => normalizeRow(table, chatKey, row))
      .filter((row): row is WorldEvolutionDbRow => row !== null && !row.deletedAt);
  }
  const reason =
    value.reason === 'manual' || value.reason === 'rebuild' || value.reason === 'migration'
      ? value.reason
      : 'auto';
  return {
    key: typeof value.key === 'string' ? value.key : checkpointKey(chatKey, value.id),
    id: value.id,
    chatKey,
    revision: Number(value.revision),
    messageId: Number(value.messageId),
    messageFingerprint: typeof value.messageFingerprint === 'string' ? value.messageFingerprint : undefined,
    reason,
    rows,
    createdAt: typeof value.createdAt === 'number' ? value.createdAt : Date.now(),
  };
}

function normalizeProjection(chatKey: string, value: unknown): WorldEvolutionDbWorldbookProjection | null {
  if (
    !isRecord(value) ||
    typeof value.bookName !== 'string' ||
    typeof value.projectionKey !== 'string' ||
    typeof value.rowId !== 'string' ||
    typeof value.contentFingerprint !== 'string'
  ) {
    return null;
  }
  const table =
    value.table === 'index' || WORLD_EVOLUTION_DB_TABLES.includes(value.table as WorldEvolutionDbTable)
      ? (value.table as WorldEvolutionProjectionTable)
      : null;
  if (!table) return null;
  const status =
    value.status === 'pending' || value.status === 'failed' || value.status === 'orphaned'
      ? value.status
      : 'synced';
  return {
    key: worldbookProjectionKey(chatKey, value.bookName, value.projectionKey),
    chatKey,
    bookName: value.bookName,
    projectionKey: value.projectionKey,
    table,
    rowId: value.rowId,
    uid: typeof value.uid === 'number' || typeof value.uid === 'string' ? value.uid : undefined,
    contentFingerprint: value.contentFingerprint,
    sourceRevision: Number.isInteger(value.sourceRevision) ? Number(value.sourceRevision) : 0,
    status,
    error: typeof value.error === 'string' ? value.error : undefined,
    updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : Date.now(),
  };
}

async function getByChatKey<T>(store: IDBObjectStore, chatKey: string): Promise<T[]> {
  const index = store.index('chatKey');
  const result = await requestResult(index.getAll(IDBKeyRange.only(chatKey)));
  return result as T[];
}

export async function loadDbSnapshot(chatKey: string): Promise<WorldEvolutionDbSnapshot> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(stores, 'readonly');
    const metaPromise = requestResult(transaction.objectStore(META_STORE).get(chatKey));
    const rowPromises = WORLD_EVOLUTION_DB_TABLES.map(async table => ({
      table,
      values: await getByChatKey<unknown>(transaction.objectStore(table), chatKey),
    }));
    const floorRunsPromise = getByChatKey<unknown>(transaction.objectStore(FLOOR_RUN_STORE), chatKey);
    const revisionsPromise = getByChatKey<unknown>(transaction.objectStore(REVISION_STORE), chatKey);
    const checkpointsPromise = getByChatKey<unknown>(transaction.objectStore(CHECKPOINT_STORE), chatKey);
    const projectionsPromise = getByChatKey<unknown>(transaction.objectStore(PROJECTION_STORE), chatKey);
    await transactionDone(transaction);
    const snapshot = createEmptyDbSnapshot(chatKey);
    snapshot.meta = normalizeMeta(chatKey, await metaPromise);
    for (const { table, values } of await Promise.all(rowPromises)) {
      snapshot.rows[table] = values
        .map(value => normalizeRow(table, chatKey, value))
        .filter((row): row is WorldEvolutionDbRow => row !== null && !row.deletedAt);
    }
    snapshot.floorRuns = (await floorRunsPromise)
      .map(value => normalizeFloorRun(chatKey, value))
      .filter((row): row is WorldEvolutionDbFloorRun => row !== null)
      .sort((left, right) => right.updatedAt - left.updatedAt);
    snapshot.revisions = (await revisionsPromise)
      .map(value => normalizeRevision(chatKey, value))
      .filter((row): row is WorldEvolutionDbRevision => row !== null)
      .sort((left, right) => left.revision - right.revision);
    snapshot.checkpoints = (await checkpointsPromise)
      .map(value => normalizeCheckpoint(chatKey, value))
      .filter((row): row is WorldEvolutionDbCheckpoint => row !== null)
      .sort((left, right) => left.revision - right.revision);
    snapshot.projections = (await projectionsPromise)
      .map(value => normalizeProjection(chatKey, value))
      .filter((row): row is WorldEvolutionDbWorldbookProjection => row !== null)
      .sort((left, right) => left.updatedAt - right.updatedAt);
    return snapshot;
  } finally {
    database.close();
  }
}

export async function saveDbMeta(chatKey: string, patch: Partial<WorldEvolutionDbMeta>): Promise<WorldEvolutionDbMeta> {
  const current = (await loadDbSnapshot(chatKey)).meta;
  const next: WorldEvolutionDbMeta = {
    ...current,
    ...cloneDbValue(patch),
    key: chatKey,
    chatKey,
    updatedAt: Date.now(),
  };
  const database = await openDatabase();
  try {
    const transaction = database.transaction(META_STORE, 'readwrite');
    transaction.objectStore(META_STORE).put(next);
    await transactionDone(transaction);
    return next;
  } finally {
    database.close();
  }
}

export async function updateDbWorldbookSyncState(
  chatKey: string,
  state: WorldEvolutionDbWorldbookSyncState,
): Promise<WorldEvolutionDbMeta> {
  return withChatWriteLock(chatKey, async () => saveDbMeta(chatKey, { worldbookSync: cloneDbValue(state) }));
}

export async function loadWorldbookProjectionLedger(
  chatKey: string,
  bookName?: string,
): Promise<WorldEvolutionDbWorldbookProjection[]> {
  const snapshot = await loadDbSnapshot(chatKey);
  const normalizedBookName = bookName?.trim();
  return snapshot.projections.filter(
    projection => !normalizedBookName || projection.bookName === normalizedBookName,
  );
}

export async function replaceWorldbookProjectionLedger(
  chatKey: string,
  bookName: string,
  records: WorldEvolutionDbWorldbookProjection[],
): Promise<WorldEvolutionDbWorldbookProjection[]> {
  const normalizedBookName = bookName.trim();
  if (!normalizedBookName) return [];
  return withChatWriteLock(chatKey, async () => {
    const current = await loadDbSnapshot(chatKey);
    const kept = current.projections.filter(
      projection => projection.bookName !== normalizedBookName,
    );
    const next = records.map(record => ({
      ...cloneDbValue(record),
      key: worldbookProjectionKey(chatKey, normalizedBookName, record.projectionKey),
      chatKey,
      bookName: normalizedBookName,
      updatedAt: record.updatedAt || Date.now(),
    }));
    const database = await openDatabase();
    try {
      const transaction = database.transaction(PROJECTION_STORE, 'readwrite');
      const store = transaction.objectStore(PROJECTION_STORE);
      for (const projection of current.projections) {
        if (projection.bookName === normalizedBookName) store.delete(projection.key);
      }
      for (const projection of next) store.put(projection);
      await transactionDone(transaction);
      return [...kept, ...next];
    } finally {
      database.close();
    }
  });
}

export async function upsertDbRow(
  chatKey: string,
  table: WorldEvolutionDbTable,
  input: Partial<WorldEvolutionDbRow> & Pick<WorldEvolutionDbRow, 'id'>,
): Promise<WorldEvolutionDbRow> {
  const snapshot = await loadDbSnapshot(chatKey);
  const previous = snapshot.rows[table].find(row => row.id === input.id);
  const now = Date.now();
  const row: WorldEvolutionDbRow = {
    key: rowKey(chatKey, table, input.id),
    id: input.id,
    chatKey,
    table,
    name: input.name ?? previous?.name,
    title: input.title ?? previous?.title,
    visibility: input.visibility ?? previous?.visibility ?? 'ai_context',
    status: input.status ?? previous?.status,
    sourceMessageId: input.sourceMessageId ?? previous?.sourceMessageId,
    revision: input.revision ?? previous?.revision ?? snapshot.meta.revision,
    data: { ...(previous?.data ?? {}), ...(input.data ?? {}) },
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
    deletedAt: undefined,
  };
  const database = await openDatabase();
  try {
    const transaction = database.transaction([table], 'readwrite');
    transaction.objectStore(table).put(row);
    await transactionDone(transaction);
    return row;
  } finally {
    database.close();
  }
}

export async function deleteDbRow(chatKey: string, table: WorldEvolutionDbTable, id: string): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction([table], 'readwrite');
    transaction.objectStore(table).delete(rowKey(chatKey, table, id));
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

export async function recordFloorRun(
  chatKey: string,
  input: Omit<WorldEvolutionDbFloorRun, 'key' | 'chatKey' | 'updatedAt'>,
): Promise<WorldEvolutionDbFloorRun> {
  const row: WorldEvolutionDbFloorRun = {
    ...cloneDbValue(input),
    key: floorRunKey(chatKey, input.messageId, input.messageFingerprint),
    chatKey,
    updatedAt: Date.now(),
  };
  const database = await openDatabase();
  try {
    const transaction = database.transaction([FLOOR_RUN_STORE], 'readwrite');
    transaction.objectStore(FLOOR_RUN_STORE).put(row);
    await transactionDone(transaction);
    return row;
  } finally {
    database.close();
  }
}

export async function updateDbFloorRunRecord(
  chatKey: string,
  messageId: number,
  messageFingerprint: string,
  updater: (
    record: WorldEvolutionDbFloorRun | undefined,
  ) => WorldEvolutionDbFloorRun | undefined,
): Promise<WorldEvolutionDbFloorRun | undefined> {
  return withChatWriteLock(chatKey, async () => {
    const snapshot = await loadDbSnapshot(chatKey);
    const existing = snapshot.floorRuns.find(
      run => run.messageId === messageId && run.messageFingerprint === messageFingerprint,
    );
    const next = updater(existing ? cloneDbValue(existing) : undefined);
    const database = await openDatabase();
    try {
      const transaction = database.transaction(FLOOR_RUN_STORE, 'readwrite');
      const store = transaction.objectStore(FLOOR_RUN_STORE);
      if (next) {
        store.put({
          ...cloneDbValue(next),
          key: floorRunKey(chatKey, messageId, messageFingerprint),
          id: next.id || `floor-${chatKey}-${messageId}-${messageFingerprint}`,
          chatKey,
          messageId,
          messageFingerprint,
          updatedAt: Date.now(),
        });
      } else if (existing) {
        store.delete(existing.key);
      }
      await transactionDone(transaction);
      return next;
    } finally {
      database.close();
    }
  });
}

export async function updateDbFloorRun(
  chatKey: string,
  messageId: number,
  messageFingerprint: string,
  patch: Partial<Omit<WorldEvolutionDbFloorRun, 'key' | 'chatKey' | 'id' | 'messageId' | 'messageFingerprint'>>,
): Promise<WorldEvolutionDbFloorRun> {
  return withChatWriteLock(chatKey, async () => {
    const snapshot = await loadDbSnapshot(chatKey);
    const existing = snapshot.floorRuns.find(
      run => run.messageId === messageId && run.messageFingerprint === messageFingerprint,
    );
    const now = Date.now();
    const row: WorldEvolutionDbFloorRun = {
      key: floorRunKey(chatKey, messageId, messageFingerprint),
      id: existing?.id ?? `floor-${chatKey}-${messageId}-${messageFingerprint}`,
      chatKey,
      messageId,
      messageFingerprint,
      source: patch.source ?? existing?.source ?? 'auto',
      status: patch.status ?? existing?.status ?? 'queued',
      baseRevision: patch.baseRevision ?? existing?.baseRevision ?? snapshot.meta.revision,
      resultRevision: patch.resultRevision ?? existing?.resultRevision,
      operationCount: patch.operationCount ?? existing?.operationCount ?? 0,
      error: patch.error ?? existing?.error,
      attempt: patch.attempt ?? existing?.attempt,
      enqueuedAt: patch.enqueuedAt ?? existing?.enqueuedAt,
      startedAt: patch.startedAt ?? existing?.startedAt,
      finishedAt: patch.finishedAt ?? existing?.finishedAt,
      candidateNames: patch.candidateNames ?? existing?.candidateNames ?? [],
      changedEntityIds: patch.changedEntityIds ?? existing?.changedEntityIds ?? [],
      eventIds: patch.eventIds ?? existing?.eventIds ?? [],
      createdAt: existing?.createdAt ?? patch.enqueuedAt ?? now,
      updatedAt: now,
    };
    const database = await openDatabase();
    try {
      const transaction = database.transaction(FLOOR_RUN_STORE, 'readwrite');
      transaction.objectStore(FLOOR_RUN_STORE).put(row);
      await transactionDone(transaction);
      return row;
    } finally {
      database.close();
    }
  });
}

function manualFingerprint(table: WorldEvolutionDbTable | 'checkpoint', id: string): string {
  return `manual:${table}:${id}:${Date.now()}`;
}

export async function updateDbRowManually(
  chatKey: string,
  table: WorldEvolutionDbTable,
  id: string,
  patch: Partial<Pick<WorldEvolutionDbRow, 'name' | 'title' | 'visibility' | 'status' | 'data'>>,
): Promise<WorldEvolutionDbSnapshot> {
  const source = await loadDbSnapshot(chatKey);
  const previous = source.rows[table].find(row => row.id === id);
  if (!previous) throw new Error(`记录不存在：${table}/${id}`);
  const row: WorldEvolutionDbRow = {
    ...cloneDbValue(previous),
    ...cloneDbValue(patch),
    data: { ...previous.data, ...(patch.data ?? {}) },
    updatedAt: Date.now(),
  };
  return (await commitDbRevision({
    chatKey,
    messageId: -1,
    messageFingerprint: manualFingerprint(table, id),
    source: 'manual',
    baseRevision: source.meta.revision,
    operations: [{ op: 'upsert', table, id, row }],
  })).snapshot;
}

export async function deleteDbRowManually(
  chatKey: string,
  table: WorldEvolutionDbTable,
  id: string,
): Promise<WorldEvolutionDbSnapshot> {
  const source = await loadDbSnapshot(chatKey);
  if (!source.rows[table].some(row => row.id === id)) throw new Error(`记录不存在：${table}/${id}`);
  return (await commitDbRevision({
    chatKey,
    messageId: -1,
    messageFingerprint: manualFingerprint(table, id),
    source: 'manual',
    baseRevision: source.meta.revision,
    operations: [{ op: 'delete', table, id }],
  })).snapshot;
}

export async function rollbackDbToCheckpoint(
  chatKey: string,
  checkpointId: string,
): Promise<WorldEvolutionDbSnapshot> {
  const source = await loadDbSnapshot(chatKey);
  const checkpoint = source.checkpoints.find(item => item.id === checkpointId);
  if (!checkpoint) throw new Error(`checkpoint 不存在：${checkpointId}`);
  const operations: WorldEvolutionDbOperation[] = [];
  for (const table of WORLD_EVOLUTION_DB_TABLES) {
    const currentById = new Map(source.rows[table].map(row => [row.id, row]));
    const targetById = new Map(checkpoint.rows[table].map(row => [row.id, row]));
    for (const id of currentById.keys()) {
      if (!targetById.has(id)) operations.push({ op: 'delete', table, id });
    }
    for (const [id, row] of targetById) {
      if (JSON.stringify(currentById.get(id)) !== JSON.stringify(row)) {
        operations.push({ op: 'upsert', table, id, row });
      }
    }
  }
  return (await commitDbRevision({
    chatKey,
    messageId: -1,
    messageFingerprint: manualFingerprint('checkpoint', checkpoint.id),
    source: 'manual',
    baseRevision: source.meta.revision,
    operations,
  })).snapshot;
}

export async function commitDbRevision(
  input: CommitRevisionInput,
): Promise<Awaited<ReturnType<typeof commitRevisionSnapshot>>> {
  return withChatWriteLock(input.chatKey, async () => {
    const source = await loadDbSnapshot(input.chatKey);
    const committed = commitRevisionSnapshot(source, input);
    const database = await openDatabase();
    try {
      const transaction = database.transaction(stores, 'readwrite');
      const completed = transactionDone(transaction);
      try {
        // A separate script frame has its own JS lock; the IDB transaction is the final CAS boundary.
        const latestMeta = normalizeMeta(input.chatKey, await requestResult(transaction.objectStore(META_STORE).get(input.chatKey)));
        if (latestMeta.revision !== input.baseRevision) {
          throw new WorldEvolutionRevisionConflictError(input.baseRevision, latestMeta.revision);
        }
        for (const operation of committed.revision.operations) {
          if (operation.op === 'delete') {
            transaction.objectStore(operation.table).delete(rowKey(input.chatKey, operation.table, operation.id));
          } else {
            transaction.objectStore(operation.table).put(operation.row);
          }
        }
        transaction.objectStore(META_STORE).put(committed.snapshot.meta);
        transaction.objectStore(REVISION_STORE).put(committed.revision);
        const floorRun = committed.snapshot.floorRuns.find(
          run => run.messageId === input.messageId && run.messageFingerprint === input.messageFingerprint,
        );
        if (floorRun) transaction.objectStore(FLOOR_RUN_STORE).put(floorRun);
        await completed;
        return committed;
      } catch (error) {
        try { transaction.abort(); } catch { /* The transaction may already have aborted. */ }
        await completed.catch(() => undefined);
        throw error;
      }
    } finally {
      database.close();
    }
  });
}

export async function createDbCheckpoint(
  chatKey: string,
  input: Omit<Parameters<typeof createCheckpointSnapshot>[1], 'chatKey'>,
): Promise<ReturnType<typeof createCheckpointSnapshot>> {
  return withChatWriteLock(chatKey, async () => {
    const source = await loadDbSnapshot(chatKey);
    const checkpoint = createCheckpointSnapshot(source, { ...input, chatKey });
    const database = await openDatabase();
    try {
      const transaction = database.transaction([CHECKPOINT_STORE], 'readwrite');
      transaction.objectStore(CHECKPOINT_STORE).put(checkpoint);
      await transactionDone(transaction);
      return checkpoint;
    } finally {
      database.close();
    }
  });
}

export async function rebuildDbAfterDeletingFloor(chatKey: string, messageId: number): Promise<WorldEvolutionDbSnapshot> {
  return withChatWriteLock(chatKey, async () => {
    const source = await loadDbSnapshot(chatKey);
    const rebuilt = rebuildAfterDeletingFloor(source, messageId);
    const database = await openDatabase();
    try {
      const transaction = database.transaction(stores, 'readwrite');
      for (const table of WORLD_EVOLUTION_DB_TABLES) {
        const store = transaction.objectStore(table);
        const existing = source.rows[table];
        const next = rebuilt.rows[table];
        const nextById = new Map(next.map(row => [row.id, row]));
        for (const row of existing) {
          const replacement = nextById.get(row.id);
          if (replacement) store.put(replacement);
          else store.delete(row.key);
        }
        for (const row of next) {
          if (!existing.some(previous => previous.id === row.id)) store.put(row);
        }
      }
      for (const revision of rebuilt.revisions) transaction.objectStore(REVISION_STORE).put(revision);
      for (const floorRun of rebuilt.floorRuns) transaction.objectStore(FLOOR_RUN_STORE).put(floorRun);
      await transactionDone(transaction);
      return rebuilt;
    } finally {
      database.close();
    }
  });
}

export async function clearDbChat(chatKey: string): Promise<void> {
  const snapshot = await loadDbSnapshot(chatKey);
  const database = await openDatabase();
  try {
    const transaction = database.transaction(stores, 'readwrite');
    for (const table of WORLD_EVOLUTION_DB_TABLES) {
      const store = transaction.objectStore(table);
      for (const row of snapshot.rows[table]) store.delete(row.key);
    }
    for (const row of snapshot.floorRuns) transaction.objectStore(FLOOR_RUN_STORE).delete(row.key);
    for (const row of snapshot.revisions) transaction.objectStore(REVISION_STORE).delete(row.key);
    for (const row of snapshot.checkpoints) transaction.objectStore(CHECKPOINT_STORE).delete(row.key);
    for (const row of snapshot.projections) transaction.objectStore(PROJECTION_STORE).delete(row.key);
    transaction.objectStore(MIGRATION_BACKUP_STORE).delete(chatKey);
    transaction.objectStore(META_STORE).delete(chatKey);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

export async function exportDbSnapshot(chatKey: string): Promise<string> {
  return JSON.stringify(await loadDbSnapshot(chatKey), null, 2);
}

function migrationChecksum(rawJson: string): string {
  let hash = 2166136261;
  for (let index = 0; index < rawJson.length; index += 1) {
    hash ^= rawJson.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export async function previewLegacyDbMigration(
  chatKey: string,
  input: unknown,
): Promise<WorldEvolutionMigrationPreview> {
  const existing = await loadDbSnapshot(chatKey);
  return buildLegacyMigrationPreview(chatKey, input, existing);
}

export async function loadLegacyMigrationBackup(
  chatKey: string,
): Promise<WorldEvolutionDbMigrationBackup | undefined> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(MIGRATION_BACKUP_STORE, 'readonly');
    return await requestResult<WorldEvolutionDbMigrationBackup | undefined>(
      transaction.objectStore(MIGRATION_BACKUP_STORE).get(chatKey),
    );
  } finally {
    database.close();
  }
}

export async function migrateLegacyDbSnapshot(
  chatKey: string,
  input: unknown,
): Promise<WorldEvolutionDbSnapshot> {
  if (!isLegacyWorldEvolutionBackup(input)) {
    throw new Error('不是可识别的 A0.0.5 世界演变备份');
  }
  return withChatWriteLock(chatKey, async () => {
    const current = await loadDbSnapshot(chatKey);
    const preview = buildLegacyMigrationPreview(chatKey, input, current);
    if (!preview.canMigrate) {
      const errors = preview.conflicts
        .filter(conflict => conflict.severity === 'error')
        .map(conflict => `${conflict.path}: ${conflict.message}`)
        .join('；');
      throw new Error(`A0.0.5 迁移未通过预检：${errors}`);
    }
    const next = preview.snapshot;
    assertWorldEvolutionDbConsistency(next);
    const rawJson = JSON.stringify(input);
    const backup: WorldEvolutionDbMigrationBackup = {
      key: chatKey,
      chatKey,
      sourceVersion: 'A0.0.5',
      importedAt: Date.now(),
      rawJson,
      sourceRevision: preview.sourceRevision,
      checksum: migrationChecksum(rawJson),
    };
    const database = await openDatabase();
    try {
      const transaction = database.transaction(stores, 'readwrite');
      const completed = transactionDone(transaction);
      try {
        const latestMeta = normalizeMeta(
          chatKey,
          await requestResult(transaction.objectStore(META_STORE).get(chatKey)),
        );
        if (latestMeta.revision > 0) {
          throw new Error('当前聊天在事务提交前已出现数据，迁移已中止以避免覆盖');
        }
        transaction.objectStore(META_STORE).put(next.meta);
        for (const table of WORLD_EVOLUTION_DB_TABLES) {
          for (const row of next.rows[table]) transaction.objectStore(table).put(row);
        }
        for (const row of next.floorRuns) transaction.objectStore(FLOOR_RUN_STORE).put(row);
        for (const row of next.revisions) transaction.objectStore(REVISION_STORE).put(row);
        for (const row of next.checkpoints) transaction.objectStore(CHECKPOINT_STORE).put(row);
        for (const row of next.projections) transaction.objectStore(PROJECTION_STORE).put(row);
        transaction.objectStore(MIGRATION_BACKUP_STORE).put(backup);
        await completed;
        return next;
      } catch (error) {
        try {
          transaction.abort();
        } catch {
          // The transaction may already have aborted.
        }
        await completed.catch(() => undefined);
        throw error;
      }
    } finally {
      database.close();
    }
  });
}

export async function importDbSnapshot(chatKey: string, text: string): Promise<WorldEvolutionDbSnapshot> {
  const parsed = JSON.parse(text) as Partial<WorldEvolutionDbSnapshot>;
  if (!isRecord(parsed) || !isRecord(parsed.rows)) {
    if (isLegacyWorldEvolutionBackup(parsed)) {
      throw new Error('检测到 A0.0.5 旧版备份，请使用“迁移旧版备份”而不是“导入数据库”');
    }
    throw new Error('导入文件不是世界演变数据库备份');
  }
  const current = createEmptyDbSnapshot(chatKey);
  current.meta = normalizeMeta(chatKey, parsed.meta);
  for (const table of WORLD_EVOLUTION_DB_TABLES) {
    current.rows[table] = (Array.isArray(parsed.rows?.[table]) ? parsed.rows[table] : [])
      .map(row => normalizeRow(table, chatKey, row))
      .filter((row): row is WorldEvolutionDbRow => row !== null);
  }
  current.floorRuns = (Array.isArray(parsed.floorRuns) ? parsed.floorRuns : [])
    .map(row => normalizeFloorRun(chatKey, row))
    .filter((row): row is WorldEvolutionDbFloorRun => row !== null);
  current.revisions = (Array.isArray(parsed.revisions) ? parsed.revisions : [])
    .map(row => normalizeRevision(chatKey, row))
    .filter((row): row is WorldEvolutionDbRevision => row !== null);
  current.checkpoints = (Array.isArray(parsed.checkpoints) ? parsed.checkpoints : [])
    .map(row => normalizeCheckpoint(chatKey, row))
    .filter((row): row is WorldEvolutionDbCheckpoint => row !== null);
  current.projections = (Array.isArray(parsed.projections) ? parsed.projections : [])
    .map(row => normalizeProjection(chatKey, row))
    .filter((row): row is WorldEvolutionDbWorldbookProjection => row !== null);

  assertWorldEvolutionDbConsistency(current);
  await clearDbChat(chatKey);
  const database = await openDatabase();
  try {
    const transaction = database.transaction(stores, 'readwrite');
    transaction.objectStore(META_STORE).put(current.meta);
    for (const table of WORLD_EVOLUTION_DB_TABLES) {
      for (const row of current.rows[table]) transaction.objectStore(table).put(row);
    }
    for (const row of current.floorRuns) transaction.objectStore(FLOOR_RUN_STORE).put(row);
    for (const row of current.revisions) transaction.objectStore(REVISION_STORE).put(row);
    for (const row of current.checkpoints) transaction.objectStore(CHECKPOINT_STORE).put(row);
    for (const row of current.projections) transaction.objectStore(PROJECTION_STORE).put(row);
    await transactionDone(transaction);
    return current;
  } finally {
    database.close();
  }
}

export function isDbTableName(value: string): value is WorldEvolutionDbTableName {
  return (
    value === FLOOR_RUN_STORE ||
    value === REVISION_STORE ||
    value === CHECKPOINT_STORE ||
    value === PROJECTION_STORE ||
    WORLD_EVOLUTION_DB_TABLES.includes(value as WorldEvolutionDbTable)
  );
}
