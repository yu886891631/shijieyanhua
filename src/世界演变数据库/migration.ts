import {
  WORLD_EVOLUTION_DB_TABLES,
  cloneDbValue,
  createEmptyDbSnapshot,
  revisionKey,
  rowKey,
  type WorldEvolutionDbCheckpoint,
  type WorldEvolutionDbFloorRun,
  type WorldEvolutionDbOperation,
  type WorldEvolutionDbRevision,
  type WorldEvolutionDbRow,
  type WorldEvolutionDbSnapshot,
  type WorldEvolutionDbTable,
} from './types';
import { inspectWorldEvolutionDbSnapshot } from './consistency';

export const LEGACY_WORLD_EVOLUTION_VERSION = 'A0.0.5';

type RecordValue = Record<string, unknown>;

type LegacyEntity = {
  id?: unknown;
  type?: unknown;
  name?: unknown;
  state?: unknown;
  visibility?: unknown;
  updatedAt?: unknown;
  sourceMessageId?: unknown;
};

type LegacyEvent = {
  id?: unknown;
  type?: unknown;
  actors?: unknown;
  summary?: unknown;
  details?: unknown;
  time?: unknown;
  location?: unknown;
  visibility?: unknown;
  sourceMessageId?: unknown;
  createdAt?: unknown;
};

type LegacyScheduledEvent = {
  id?: unknown;
  title?: unknown;
  trigger?: unknown;
  actors?: unknown;
  visibility?: unknown;
  status?: unknown;
  createdAt?: unknown;
};

type LegacyRevision = {
  revision?: unknown;
  messageId?: unknown;
  messageFingerprint?: unknown;
  source?: unknown;
  createdAt?: unknown;
};

type LegacyRunRecord = {
  key?: unknown;
  messageId?: unknown;
  messageFingerprint?: unknown;
  source?: unknown;
  status?: unknown;
  attempt?: unknown;
  enqueuedAt?: unknown;
  startedAt?: unknown;
  finishedAt?: unknown;
  candidateNames?: unknown;
  changedEntityIds?: unknown;
  eventIds?: unknown;
  error?: unknown;
};

type LegacyCheckpoint = {
  id?: unknown;
  revision?: unknown;
  messageId?: unknown;
  messageFingerprint?: unknown;
  reason?: unknown;
  createdAt?: unknown;
  entities?: unknown;
  events?: unknown;
  scheduledEvents?: unknown;
};

export type LegacyWorldEvolutionBackup = {
  chatKey?: unknown;
  revision?: unknown;
  entities?: unknown;
  events?: unknown;
  scheduledEvents?: unknown;
  revisions?: unknown;
  checkpoints?: unknown;
  processedMessageKeys?: unknown;
  runRecords?: unknown;
  worldbookSync?: unknown;
  updatedAt?: unknown;
};

export type WorldEvolutionMigrationConflict = {
  severity: 'error' | 'warning';
  code:
    | 'invalid_shape'
    | 'unsupported_type'
    | 'duplicate_id'
    | 'duplicate_name'
    | 'existing_data'
    | 'reference'
    | 'malformed_record';
  path: string;
  message: string;
};

export type WorldEvolutionMigrationCounts = {
  entities: number;
  npc: number;
  organization: number;
  location: number;
  society: number;
  environment: number;
  events: number;
  plans: number;
  revisions: number;
  checkpoints: number;
  floorRuns: number;
};

export type WorldEvolutionMigrationPreview = {
  sourceVersion: string;
  chatKey: string;
  sourceRevision: number;
  counts: WorldEvolutionMigrationCounts;
  conflicts: WorldEvolutionMigrationConflict[];
  canMigrate: boolean;
  snapshot: WorldEvolutionDbSnapshot;
};

function isRecord(value: unknown): value is RecordValue {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        .map(item => item.trim())
    : [];
}

function visibility(value: unknown): WorldEvolutionDbRow['visibility'] {
  return value === 'backstage' || value === 'protagonist_known' || value === 'revealed' ? value : 'ai_context';
}

function entityTable(type: unknown): WorldEvolutionDbTable | undefined {
  if (type === 'npc' || type === 'organization' || type === 'location' || type === 'environment') return type;
  if (type === 'social') return 'society';
  return undefined;
}

function nowOr(value: unknown, fallback: number): number {
  const timestamp = asNumber(value, fallback);
  return timestamp > 0 ? timestamp : fallback;
}

function addConflict(
  conflicts: WorldEvolutionMigrationConflict[],
  severity: WorldEvolutionMigrationConflict['severity'],
  code: WorldEvolutionMigrationConflict['code'],
  path: string,
  message: string,
): void {
  conflicts.push({ severity, code, path, message });
}

export function isLegacyWorldEvolutionBackup(value: unknown): value is LegacyWorldEvolutionBackup {
  if (!isRecord(value)) return false;
  return (
    'entities' in value ||
    'scheduledEvents' in value ||
    'processedMessageKeys' in value ||
    ('events' in value && !('rows' in value))
  );
}

function rowsFromLegacy(
  chatKey: string,
  source: LegacyWorldEvolutionBackup,
  revision: number,
  conflicts: WorldEvolutionMigrationConflict[],
): Record<WorldEvolutionDbTable, WorldEvolutionDbRow[]> {
  const rows = createEmptyDbSnapshot(chatKey).rows;
  const entities = isRecord(source.entities) ? source.entities : {};
  const names = new Map<string, string>();
  for (const [entityId, rawEntity] of Object.entries(entities)) {
    if (!isRecord(rawEntity)) {
      addConflict(conflicts, 'warning', 'malformed_record', `entities.${entityId}`, '实体不是对象，已跳过');
      continue;
    }
    const entity = rawEntity as LegacyEntity;
    const id = asString(entity.id, entityId);
    const table = entityTable(entity.type);
    if (!id) {
      addConflict(conflicts, 'error', 'malformed_record', `entities.${entityId}.id`, '实体 ID 为空');
      continue;
    }
    if (!table) {
      addConflict(conflicts, 'error', 'unsupported_type', `entities.${entityId}.type`, `不支持的实体类型：${String(entity.type)}`);
      continue;
    }
    const name = asString(entity.name, id);
    const previousTable = rows[table].find(row => row.id === id);
    if (previousTable) {
      addConflict(conflicts, 'error', 'duplicate_id', `entities.${entityId}`, `同一表内重复实体 ID：${id}`);
      continue;
    }
    const sameName = names.get(name);
    if (sameName && sameName !== id) {
      addConflict(conflicts, 'warning', 'duplicate_name', `entities.${entityId}.name`, `实体名称与 ${sameName} 重复：${name}`);
    }
    names.set(name, id);
    const updatedAt = nowOr(entity.updatedAt, Date.now());
    rows[table].push({
      key: rowKey(chatKey, table, id),
      id,
      chatKey,
      table,
      name,
      visibility: visibility(entity.visibility),
      sourceMessageId: typeof entity.sourceMessageId === 'number' ? entity.sourceMessageId : undefined,
      revision,
      data: {
        ...(isRecord(entity.state) ? cloneDbValue(entity.state) : {}),
        legacyEntityType: entity.type,
        legacyEntityId: id,
      },
      createdAt: updatedAt,
      updatedAt,
    });
  }

  const events = Array.isArray(source.events) ? source.events : [];
  for (const [index, rawEvent] of events.entries()) {
    if (!isRecord(rawEvent)) {
      addConflict(conflicts, 'warning', 'malformed_record', `events[${index}]`, '事件不是对象，已跳过');
      continue;
    }
    const event = rawEvent as LegacyEvent;
    const id = asString(event.id, `EV-legacy-${index + 1}`);
    const createdAt = nowOr(event.createdAt, Date.now());
    const actors = asStringArray(event.actors);
    rows.event.push({
      key: rowKey(chatKey, 'event', id),
      id,
      chatKey,
      table: 'event',
      title: asString(event.summary, id),
      visibility: visibility(event.visibility),
      sourceMessageId: typeof event.sourceMessageId === 'number' ? event.sourceMessageId : undefined,
      revision,
      data: {
        type: asString(event.type, 'world_change'),
        actors,
        summary: asString(event.summary, id),
        ...(typeof event.details === 'string' ? { details: event.details } : {}),
        ...(typeof event.time === 'string' ? { time: event.time } : {}),
        ...(typeof event.location === 'string' ? { location: event.location } : {}),
        legacyEvent: true,
      },
      createdAt,
      updatedAt: createdAt,
    });
  }

  const plans = Array.isArray(source.scheduledEvents) ? source.scheduledEvents : [];
  for (const [index, rawPlan] of plans.entries()) {
    if (!isRecord(rawPlan)) {
      addConflict(conflicts, 'warning', 'malformed_record', `scheduledEvents[${index}]`, '计划不是对象，已跳过');
      continue;
    }
    const plan = rawPlan as LegacyScheduledEvent;
    const id = asString(plan.id, `PL-legacy-${index + 1}`);
    const createdAt = nowOr(plan.createdAt, Date.now());
    rows.plan.push({
      key: rowKey(chatKey, 'plan', id),
      id,
      chatKey,
      table: 'plan',
      title: asString(plan.title, id),
      visibility: visibility(plan.visibility),
      status: asString(plan.status, 'pending'),
      revision,
      data: {
        title: asString(plan.title, id),
        trigger: asString(plan.trigger) || undefined,
        actors: asStringArray(plan.actors),
        status: asString(plan.status, 'pending'),
        legacyScheduledEvent: true,
      },
      createdAt,
      updatedAt: createdAt,
    });
  }
  return rows;
}

function checkpointRows(chatKey: string, checkpoint: LegacyCheckpoint, conflicts: WorldEvolutionMigrationConflict[]): Record<WorldEvolutionDbTable, WorldEvolutionDbRow[]> {
  const nested = {
    chatKey,
    revision: asNumber(checkpoint.revision),
    entities: checkpoint.entities,
    events: checkpoint.events,
    scheduledEvents: checkpoint.scheduledEvents,
  } satisfies LegacyWorldEvolutionBackup;
  return rowsFromLegacy(chatKey, nested, asNumber(checkpoint.revision), conflicts);
}

function floorRunsFromLegacy(
  chatKey: string,
  source: LegacyWorldEvolutionBackup,
  migrationRevision: number,
  conflicts: WorldEvolutionMigrationConflict[],
): WorldEvolutionDbFloorRun[] {
  const result: WorldEvolutionDbFloorRun[] = [];
  const rawRuns = Array.isArray(source.runRecords) ? source.runRecords : [];
  for (const [index, rawRun] of rawRuns.entries()) {
    if (!isRecord(rawRun)) {
      addConflict(conflicts, 'warning', 'malformed_record', `runRecords[${index}]`, '楼层运行记录不是对象，已跳过');
      continue;
    }
    const run = rawRun as LegacyRunRecord;
    const messageId = asNumber(run.messageId, -1);
    if (messageId < 0) {
      addConflict(conflicts, 'warning', 'malformed_record', `runRecords[${index}].messageId`, '楼层 ID 无效，已跳过');
      continue;
    }
    const fingerprint = asString(run.messageFingerprint, `legacy-${messageId}`);
    const status = run.status === 'queued' || run.status === 'running' || run.status === 'done' || run.status === 'skipped' || run.status === 'cancelled' ? run.status : 'failed';
    const updatedAt = nowOr(run.finishedAt ?? run.startedAt ?? run.enqueuedAt, Date.now());
    result.push({
      key: `${chatKey}\0${messageId}\0${fingerprint}`,
      id: asString(run.key, `floor-${chatKey}-${messageId}-${fingerprint}`),
      chatKey,
      messageId,
      messageFingerprint: fingerprint,
      source: run.source === 'manual' || run.source === 'retry' ? run.source : 'auto',
      status,
      baseRevision: Math.max(0, migrationRevision - 1),
      resultRevision: status === 'done' ? migrationRevision : undefined,
      operationCount: 0,
      error: asString(run.error) || undefined,
      attempt: Math.max(1, asNumber(run.attempt, 1)),
      enqueuedAt: nowOr(run.enqueuedAt, updatedAt),
      startedAt: typeof run.startedAt === 'number' ? run.startedAt : undefined,
      finishedAt: typeof run.finishedAt === 'number' ? run.finishedAt : undefined,
      candidateNames: asStringArray(run.candidateNames),
      changedEntityIds: asStringArray(run.changedEntityIds),
      eventIds: asStringArray(run.eventIds),
      createdAt: updatedAt,
      updatedAt,
    });
  }
  const processed = asStringArray(source.processedMessageKeys);
  for (const [index, key] of processed.entries()) {
    const separator = key.indexOf(':');
    const messageId = separator > 0 ? Number.parseInt(key.slice(0, separator), 10) : Number.NaN;
    if (!Number.isFinite(messageId)) continue;
    const fingerprint = separator > 0 ? key.slice(separator + 1) : `legacy-${messageId}`;
    if (result.some(run => run.messageId === messageId && run.messageFingerprint === fingerprint)) continue;
    result.push({
      key: `${chatKey}\0${messageId}\0${fingerprint}`,
      id: `floor-${chatKey}-${messageId}-${fingerprint}`,
      chatKey,
      messageId,
      messageFingerprint: fingerprint,
      source: 'auto',
      status: 'done',
      baseRevision: Math.max(0, migrationRevision - 1),
      resultRevision: migrationRevision,
      operationCount: 0,
      attempt: 1,
      candidateNames: [],
      changedEntityIds: [],
      eventIds: [],
      createdAt: Date.now() + index,
      updatedAt: Date.now() + index,
    });
  }
  return result;
}

function revisionsFromLegacy(
  chatKey: string,
  source: LegacyWorldEvolutionBackup,
  rows: Record<WorldEvolutionDbTable, WorldEvolutionDbRow[]>,
  migrationRevision: number,
): WorldEvolutionDbRevision[] {
  const rawRevisions = Array.isArray(source.revisions) ? source.revisions : [];
  const byRevision = new Map<number, LegacyRevision>();
  for (const raw of rawRevisions) {
    if (!isRecord(raw)) continue;
    const revision = asNumber((raw as LegacyRevision).revision, 0);
    if (revision > 0 && !byRevision.has(revision)) byRevision.set(revision, raw as LegacyRevision);
  }
  const revisions: WorldEvolutionDbRevision[] = [];
  for (let revision = 1; revision < migrationRevision; revision += 1) {
    const legacy = byRevision.get(revision);
    const messageId = asNumber(legacy?.messageId, -1);
    revisions.push({
      key: revisionKey(chatKey, revision),
      id: `migration-legacy-revision-${revision}`,
      chatKey,
      revision,
      parentRevision: revision - 1,
      messageId,
      messageFingerprint: asString(legacy?.messageFingerprint, `legacy-revision-${revision}`),
      source: legacy?.source === 'manual' ? 'manual' : 'migration',
      status: 'valid',
      operations: [],
      inverseOperations: [],
      createdAt: nowOr(legacy?.createdAt, Date.now() + revision),
      updatedAt: nowOr(legacy?.createdAt, Date.now() + revision),
    });
  }
  const operations: WorldEvolutionDbOperation[] = WORLD_EVOLUTION_DB_TABLES.flatMap(table =>
    rows[table].map(row => ({ op: 'upsert' as const, table, id: row.id, row: cloneDbValue({ ...row, revision: migrationRevision }) })),
  );
  revisions.push({
    key: revisionKey(chatKey, migrationRevision),
    id: `migration-${LEGACY_WORLD_EVOLUTION_VERSION}-${Date.now()}`,
    chatKey,
    revision: migrationRevision,
    parentRevision: migrationRevision - 1,
    messageId: -1,
    messageFingerprint: `migration:${LEGACY_WORLD_EVOLUTION_VERSION}`,
    source: 'migration',
    status: 'valid',
    operations,
    inverseOperations: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  return revisions;
}

function checkpointsFromLegacy(
  chatKey: string,
  source: LegacyWorldEvolutionBackup,
  conflicts: WorldEvolutionMigrationConflict[],
): WorldEvolutionDbCheckpoint[] {
  const raw = Array.isArray(source.checkpoints) ? source.checkpoints : [];
  return raw.flatMap((value, index) => {
    if (!isRecord(value)) {
      addConflict(conflicts, 'warning', 'malformed_record', `checkpoints[${index}]`, 'checkpoint 不是对象，已跳过');
      return [];
    }
    const checkpoint = value as LegacyCheckpoint;
    const id = asString(checkpoint.id, `legacy-checkpoint-${index + 1}`);
    const revision = Math.max(0, asNumber(checkpoint.revision));
    const rows = checkpointRows(chatKey, checkpoint, conflicts);
    return [{
      key: `${chatKey}\0${id}`,
      id,
      chatKey,
      revision,
      messageId: asNumber(checkpoint.messageId, -1),
      messageFingerprint: asString(checkpoint.messageFingerprint) || undefined,
      reason: 'migration' as const,
      rows: WORLD_EVOLUTION_DB_TABLES.reduce((result, table) => {
        result[table] = rows[table].map(row => ({ ...row, revision: Math.min(row.revision, revision) }));
        return result;
      }, rows),
      createdAt: nowOr(checkpoint.createdAt, Date.now() + index),
    }];
  });
}

export function buildLegacyMigrationPreview(
  chatKey: string,
  input: unknown,
  existing?: WorldEvolutionDbSnapshot,
): WorldEvolutionMigrationPreview {
  const conflicts: WorldEvolutionMigrationConflict[] = [];
  if (!isLegacyWorldEvolutionBackup(input)) {
    const empty = createEmptyDbSnapshot(chatKey);
    return {
      sourceVersion: LEGACY_WORLD_EVOLUTION_VERSION,
      chatKey,
      sourceRevision: 0,
      counts: { entities: 0, npc: 0, organization: 0, location: 0, society: 0, environment: 0, events: 0, plans: 0, revisions: 0, checkpoints: 0, floorRuns: 0 },
      conflicts: [{ severity: 'error', code: 'invalid_shape', path: '$', message: '不是可识别的 A0.0.5 世界演变备份' }],
      canMigrate: false,
      snapshot: empty,
    };
  }
  const source = input;
  const sourceRevision = Math.max(
    0,
    asNumber(source.revision),
    ...(Array.isArray(source.revisions) ? source.revisions.filter(isRecord).map(item => asNumber(item.revision)) : []),
    ...(Array.isArray(source.checkpoints) ? source.checkpoints.filter(isRecord).map(item => asNumber(item.revision)) : []),
  );
  const rows = rowsFromLegacy(chatKey, source, Math.max(1, sourceRevision + 1), conflicts);
  const migrationRevision = Math.max(1, sourceRevision + 1);
  const revisions = revisionsFromLegacy(chatKey, source, rows, migrationRevision);
  const floorRuns = floorRunsFromLegacy(chatKey, source, migrationRevision, conflicts);
  const checkpoints = checkpointsFromLegacy(chatKey, source, conflicts).map(checkpoint => ({
    ...checkpoint,
    revision: Math.min(checkpoint.revision, migrationRevision),
    rows: checkpoint.rows,
  }));
  if (existing && (
    existing.meta.revision > 0 ||
    WORLD_EVOLUTION_DB_TABLES.some(table => existing.rows[table].length > 0) ||
    existing.revisions.length > 0 ||
    existing.floorRuns.length > 0 ||
    existing.checkpoints.length > 0 ||
    existing.projections.length > 0
  )) {
    addConflict(conflicts, 'error', 'existing_data', '$', '当前聊天已有世界演变数据库记录；迁移不会覆盖现有数据');
  }
  const snapshot = createEmptyDbSnapshot(chatKey);
  snapshot.meta.revision = migrationRevision;
  const lastMessageId = floorRuns.reduce<number | undefined>(
    (max, run) => (max === undefined || run.messageId > max ? run.messageId : max),
    undefined,
  );
  snapshot.meta.lastMessageId = lastMessageId;
  snapshot.meta.lastMessageFingerprint = floorRuns.find(run => run.messageId === snapshot.meta.lastMessageId)?.messageFingerprint;
  snapshot.meta.worldbookSync = { status: 'pending' };
  snapshot.rows = rows;
  snapshot.floorRuns = floorRuns;
  snapshot.revisions = revisions;
  snapshot.checkpoints = checkpoints;
  const counts: WorldEvolutionMigrationCounts = {
    entities: WORLD_EVOLUTION_DB_TABLES.slice(0, 5).reduce((sum, table) => sum + rows[table].length, 0),
    npc: rows.npc.length,
    organization: rows.organization.length,
    location: rows.location.length,
    society: rows.society.length,
    environment: rows.environment.length,
    events: rows.event.length,
    plans: rows.plan.length,
    revisions: revisions.length,
    checkpoints: checkpoints.length,
    floorRuns: floorRuns.length,
  };
  snapshot.rows = WORLD_EVOLUTION_DB_TABLES.reduce((result, table) => {
    result[table] = result[table].map(row => ({ ...row, revision: migrationRevision }));
    return result;
  }, rows);
  const consistencyIssues = inspectWorldEvolutionDbSnapshot(snapshot);
  for (const issue of consistencyIssues) {
    const code: WorldEvolutionMigrationConflict['code'] =
      issue.code === 'duplicate'
        ? 'duplicate_id'
        : issue.code === 'reference'
          ? 'reference'
          : 'malformed_record';
    addConflict(conflicts, 'error', code, issue.path, issue.message);
  }
  return {
    sourceVersion: LEGACY_WORLD_EVOLUTION_VERSION,
    chatKey,
    sourceRevision,
    counts,
    conflicts,
    canMigrate: !conflicts.some(conflict => conflict.severity === 'error'),
    snapshot,
  };
}
