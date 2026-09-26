import { dbSnapshotToWorld } from './adapter';
import {
  WORLD_EVOLUTION_DB_TABLES,
  cloneDbValue,
  rowKey,
  type WorldEvolutionDbRow,
  type WorldEvolutionDbSnapshot,
  type WorldEvolutionDbTable,
  type WorldEvolutionDbVisibility,
} from './types';

const ENTITY_TABLES = ['npc', 'organization', 'location', 'society', 'environment'] as const;
type EntityTable = (typeof ENTITY_TABLES)[number];
const VISIBILITIES = new Set<WorldEvolutionDbVisibility>([
  'backstage',
  'ai_context',
  'protagonist_known',
  'revealed',
]);
const REFERENCE_TABLES: Record<string, readonly EntityTable[]> = {
  locationId: ['location'],
  organizationIds: ['organization'],
  memberIds: ['npc'],
  actorIds: ['npc'],
  relationIds: ENTITY_TABLES,
  relatedIds: ENTITY_TABLES,
};

type RecordValue = Record<string, unknown>;
type RowMap = Map<string, Map<string, WorldEvolutionDbRow>>;

export type WorldEvolutionDbConsistencyIssue = {
  code:
    | 'meta'
    | 'row'
    | 'duplicate'
    | 'reference'
    | 'revision'
    | 'floor_run'
    | 'checkpoint'
    | 'projection';
  path: string;
  message: string;
};

export class WorldEvolutionDbConsistencyError extends Error {
  public readonly issues: WorldEvolutionDbConsistencyIssue[];

  public constructor(issues: WorldEvolutionDbConsistencyIssue[]) {
    super(`世界演变数据库一致性校验失败：${issues[0]?.message ?? '未知错误'}`);
    this.name = 'WorldEvolutionDbConsistencyError';
    this.issues = issues;
  }
}

export type WorldEvolutionDbConsistencyOptions = {
  /**
   * 重放器已经计算出的期望行。提供后会进行逐行比较，用于防止“重放完成但
   * materialized rows 没有真正对应上”的静默漂移。
   */
  expectedRows?: Record<WorldEvolutionDbTable, WorldEvolutionDbRow[]>;
};

function isRecord(value: unknown): value is RecordValue {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function add(
  issues: WorldEvolutionDbConsistencyIssue[],
  code: WorldEvolutionDbConsistencyIssue['code'],
  path: string,
  message: string,
): void {
  issues.push({ code, path, message });
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map(key => [key, canonicalize(value[key])]),
  );
}

function canonicalRows(rows: WorldEvolutionDbRow[]): string {
  return JSON.stringify(
    rows
      .map(row => cloneDbValue(row))
      .sort((left, right) => left.id.localeCompare(right.id))
      .map(canonicalize),
  );
}

function rowName(row: WorldEvolutionDbRow): string {
  return row.name ?? row.title ?? row.id;
}

function collectReferences(value: unknown, path: string, output: Array<{ id: string; field: string; path: string }>): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectReferences(item, `${path}[${index}]`, output));
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, item] of Object.entries(value)) {
    if (REFERENCE_TABLES[key]) {
      const values = key.endsWith('Ids') ? (Array.isArray(item) ? item : [item]) : [item];
      values.forEach((id, index) => {
        if (typeof id === 'string' && id.trim()) {
          output.push({ id, field: key, path: `${path}.${key}[${index}]` });
        }
      });
    }
    collectReferences(item, `${path}.${key}`, output);
  }
}

function buildRowMap(snapshot: WorldEvolutionDbSnapshot, issues: WorldEvolutionDbConsistencyIssue[]): RowMap {
  const byTable = new Map<string, Map<string, WorldEvolutionDbRow>>();
  const entityIds = new Map<string, string>();
  for (const table of WORLD_EVOLUTION_DB_TABLES) {
    const rows = snapshot.rows[table] ?? [];
    const tableMap = new Map<string, WorldEvolutionDbRow>();
    byTable.set(table, tableMap);
    for (const [index, row] of rows.entries()) {
      const path = `rows.${table}[${index}]`;
      if (tableMap.has(row.id)) add(issues, 'duplicate', path, `表 ${table} 存在重复 ID：${row.id}`);
      tableMap.set(row.id, row);
      if (!row.id.trim()) add(issues, 'row', `${path}.id`, 'ID 不能为空');
      if (row.chatKey !== snapshot.meta.chatKey) add(issues, 'row', path, 'chatKey 与数据库分区不一致');
      if (row.table !== table) add(issues, 'row', path, `table 字段应为 ${table}`);
      if (row.key !== rowKey(snapshot.meta.chatKey, table, row.id)) {
        add(issues, 'row', `${path}.key`, '行 key 与 chatKey/table/id 不一致');
      }
      if (!Number.isSafeInteger(row.revision) || row.revision < 0 || row.revision > snapshot.meta.revision) {
        add(issues, 'row', `${path}.revision`, `行 revision 无效：${row.revision}`);
      }
      if (!VISIBILITIES.has(row.visibility)) add(issues, 'row', `${path}.visibility`, '可见性无效');
      if (!isRecord(row.data)) add(issues, 'row', `${path}.data`, 'data 必须是对象');
      if (ENTITY_TABLES.includes(table as EntityTable) && !row.name?.trim()) {
        add(issues, 'row', `${path}.name`, '实体行必须有完整名称');
      }
      if (table === 'event' && !row.title?.trim() && typeof row.data?.summary !== 'string') {
        add(issues, 'row', `${path}.title`, '事件行缺少摘要');
      }
      if (table === 'plan' && !row.title?.trim() && typeof row.data?.title !== 'string') {
        add(issues, 'row', `${path}.title`, '计划行缺少标题');
      }
      if (ENTITY_TABLES.includes(table as EntityTable)) {
        const previousTable = entityIds.get(row.id);
        if (previousTable && previousTable !== table) {
          add(issues, 'duplicate', path, `实体 ID 同时存在于 ${previousTable} 和 ${table}：${row.id}`);
        }
        entityIds.set(row.id, table);
      }
    }
  }
  return byTable;
}

function validateReferences(
  rows: Record<WorldEvolutionDbTable, WorldEvolutionDbRow[]>,
  rowMap: RowMap,
  issues: WorldEvolutionDbConsistencyIssue[],
  prefix = 'rows',
): void {
  for (const table of WORLD_EVOLUTION_DB_TABLES) {
    for (const [index, row] of (rows[table] ?? []).entries()) {
      const refs: Array<{ id: string; field: string; path: string }> = [];
      collectReferences(row.data, `${prefix}.${table}[${index}].data`, refs);
      for (const [field, value] of Object.entries(row.data)) {
        if (!REFERENCE_TABLES[field]) continue;
        const values = field.endsWith('Ids') ? value : [value];
        if (!Array.isArray(values)) {
          add(issues, 'reference', `${prefix}.${table}[${index}].data.${field}`, '引用字段必须是 ID 数组');
          continue;
        }
        for (const [valueIndex, id] of values.entries()) {
          if (typeof id !== 'string' || !id.trim()) {
            add(
              issues,
              'reference',
              `${prefix}.${table}[${index}].data.${field}[${valueIndex}]`,
              '引用 ID 必须是非空文本',
            );
          }
        }
      }
      for (const reference of refs) {
        const candidates = REFERENCE_TABLES[reference.field] ?? [];
        const target = candidates
          .map(targetTable => rowMap.get(targetTable)?.get(reference.id))
          .find(Boolean);
        if (!target) {
          add(issues, 'reference', reference.path, `引用了不存在或类型不匹配的对象：${reference.id}`);
        }
      }
    }
  }
}

function validateProjection(snapshot: WorldEvolutionDbSnapshot, issues: WorldEvolutionDbConsistencyIssue[]): void {
  let world: ReturnType<typeof dbSnapshotToWorld>;
  try {
    world = dbSnapshotToWorld(snapshot);
  } catch (error) {
    add(issues, 'projection', 'projection', `世界投影生成失败：${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  if (world.revision !== snapshot.meta.revision) {
    add(issues, 'projection', 'world.revision', '世界投影 revision 与数据库 meta 不一致');
  }

  const entityRows = ENTITY_TABLES.flatMap(table => snapshot.rows[table].map(row => ({ table, row })));
  const projectedEntityIds = new Set(Object.keys(world.entities));
  for (const { table, row } of entityRows) {
    const projected = world.entities[row.id];
    if (!projected) {
      add(issues, 'projection', `entities.${row.id}`, `实体 ${table}/${row.id} 没有投影`);
      continue;
    }
    if (projected.name !== rowName(row)) add(issues, 'projection', `entities.${row.id}.name`, '实体名称投影不一致');
    if (JSON.stringify(canonicalize(projected.state)) !== JSON.stringify(canonicalize(row.data))) {
      add(issues, 'projection', `entities.${row.id}.state`, '实体 data 投影不一致');
    }
    projectedEntityIds.delete(row.id);
  }
  for (const orphan of projectedEntityIds) {
    add(issues, 'projection', `entities.${orphan}`, '世界投影包含数据库不存在的实体');
  }

  for (const row of snapshot.rows.event) {
    const projected = world.events.find(event => event.id === row.id);
    if (!projected) {
      add(issues, 'projection', `events.${row.id}`, '事件没有投影');
      continue;
    }
    const expectedSummary = row.title ?? String(row.data.summary ?? row.id);
    if (projected.summary !== expectedSummary) add(issues, 'projection', `events.${row.id}.summary`, '事件摘要投影不一致');
    const actorIds = Array.isArray(row.data.actorIds) ? row.data.actorIds : [];
    if (actorIds.length) {
      const expectedActors = actorIds.map(id => {
        const entity = entityRows.find(item => item.row.id === id)?.row;
        return entity ? rowName(entity) : id;
      });
      if (JSON.stringify(projected.actors) !== JSON.stringify(expectedActors)) {
        add(issues, 'projection', `events.${row.id}.actors`, '事件参与者 ID 与名称投影不一致');
      }
    }
    if (typeof row.data.locationId === 'string') {
      const location = snapshot.rows.location.find(item => item.id === row.data.locationId);
      if (location && row.data.location !== rowName(location)) {
        add(issues, 'projection', `events.${row.id}.location`, '事件地点 ID 与名称投影不一致');
      }
    }
  }
  for (const row of snapshot.rows.plan) {
    const projected = world.scheduledEvents.find(event => event.id === row.id);
    if (!projected) {
      add(issues, 'projection', `plans.${row.id}`, '计划没有投影');
      continue;
    }
    const expectedTitle = row.title ?? String(row.data.title ?? row.id);
    if (projected.title !== expectedTitle) add(issues, 'projection', `plans.${row.id}.title`, '计划标题投影不一致');
    const actorIds = Array.isArray(row.data.actorIds) ? row.data.actorIds : [];
    if (actorIds.length) {
      const expectedActors = actorIds.map(id => {
        const entity = entityRows.find(item => item.row.id === id)?.row;
        return entity ? rowName(entity) : id;
      });
      if (JSON.stringify(projected.actors) !== JSON.stringify(expectedActors)) {
        add(issues, 'projection', `plans.${row.id}.actors`, '计划参与者 ID 与名称投影不一致');
      }
    }
  }
}

function validateRevisions(snapshot: WorldEvolutionDbSnapshot, issues: WorldEvolutionDbConsistencyIssue[]): void {
  const seen = new Set<number>();
  for (const [index, revision] of snapshot.revisions.entries()) {
    const path = `revisions[${index}]`;
    if (revision.chatKey !== snapshot.meta.chatKey) add(issues, 'revision', path, 'revision chatKey 不一致');
    if (revision.key !== `${snapshot.meta.chatKey}\0${revision.revision}`) {
      add(issues, 'revision', `${path}.key`, 'revision key 不一致');
    }
    if (seen.has(revision.revision)) add(issues, 'duplicate', path, `重复 revision：${revision.revision}`);
    seen.add(revision.revision);
    if (!Number.isSafeInteger(revision.revision) || revision.revision <= 0 || revision.revision > snapshot.meta.revision) {
      add(issues, 'revision', `${path}.revision`, 'revision 数值无效');
    }
    for (const [operationIndex, operation] of revision.operations.entries()) {
      const operationPath = `${path}.operations[${operationIndex}]`;
      if (operation.op === 'upsert') {
        if (operation.row.revision !== revision.revision) {
          add(issues, 'revision', `${operationPath}.row.revision`, '操作行 revision 与所属 revision 不一致');
        }
        if (operation.row.id !== operation.id || operation.row.table !== operation.table) {
          add(issues, 'revision', operationPath, 'upsert 操作目标与行身份不一致');
        }
      }
    }
  }
  if (snapshot.revisions.length && Math.max(...snapshot.revisions.map(revision => revision.revision)) > snapshot.meta.revision) {
    add(issues, 'meta', 'meta.revision', 'meta revision 小于历史 revision');
  }
}

function validateFloorRuns(snapshot: WorldEvolutionDbSnapshot, issues: WorldEvolutionDbConsistencyIssue[]): void {
  const revisions = new Map(snapshot.revisions.map(revision => [revision.revision, revision]));
  const seen = new Set<string>();
  for (const [index, run] of snapshot.floorRuns.entries()) {
    const path = `floorRuns[${index}]`;
    const uniqueKey = `${run.messageId}\0${run.messageFingerprint}`;
    if (seen.has(uniqueKey)) add(issues, 'duplicate', path, `重复楼层运行记录：${uniqueKey}`);
    seen.add(uniqueKey);
    if (run.chatKey !== snapshot.meta.chatKey) add(issues, 'floor_run', path, 'floor_run chatKey 不一致');
    if (run.resultRevision !== undefined) {
      const revision = revisions.get(run.resultRevision);
      if (!revision) add(issues, 'floor_run', `${path}.resultRevision`, '结果 revision 不存在');
      if (run.status === 'done' && revision?.status !== 'valid') {
        add(issues, 'floor_run', path, 'done floor_run 必须指向 valid revision');
      }
      if (run.status === 'stale' && revision?.status !== 'stale') {
        add(issues, 'floor_run', path, 'stale floor_run 必须指向 stale revision');
      }
      if (run.baseRevision > run.resultRevision) {
        add(issues, 'floor_run', path, 'baseRevision 不能大于 resultRevision');
      }
    } else if (run.status === 'done' || run.status === 'stale') {
      add(issues, 'floor_run', path, `${run.status} floor_run 缺少 resultRevision`);
    }
  }
}

export function inspectWorldEvolutionDbSnapshot(
  snapshot: WorldEvolutionDbSnapshot,
  options: WorldEvolutionDbConsistencyOptions = {},
): WorldEvolutionDbConsistencyIssue[] {
  const issues: WorldEvolutionDbConsistencyIssue[] = [];
  if (snapshot.meta.key !== snapshot.meta.chatKey || snapshot.meta.chatKey.length === 0) {
    add(issues, 'meta', 'meta', '数据库 meta 的 chatKey/key 无效');
  }
  if (!Number.isSafeInteger(snapshot.meta.revision) || snapshot.meta.revision < 0) {
    add(issues, 'meta', 'meta.revision', 'meta revision 必须是非负安全整数');
  }
  const rowMap = buildRowMap(snapshot, issues);
  validateReferences(snapshot.rows, rowMap, issues);
  validateRevisions(snapshot, issues);
  validateFloorRuns(snapshot, issues);
  validateProjection(snapshot, issues);
  for (const [index, checkpoint] of snapshot.checkpoints.entries()) {
    const path = `checkpoints[${index}]`;
    if (checkpoint.chatKey !== snapshot.meta.chatKey) add(issues, 'checkpoint', path, 'checkpoint chatKey 不一致');
    if (!Number.isSafeInteger(checkpoint.revision) || checkpoint.revision < 0 || checkpoint.revision > snapshot.meta.revision) {
      add(issues, 'checkpoint', `${path}.revision`, 'checkpoint revision 无效');
    }
    const checkpointMap = buildRowMap(
      { ...snapshot, rows: checkpoint.rows, meta: { ...snapshot.meta, revision: checkpoint.revision } },
      issues,
    );
    validateReferences(checkpoint.rows, checkpointMap, issues, `${path}.rows`);
  }
  if (options.expectedRows) {
    for (const table of WORLD_EVOLUTION_DB_TABLES) {
      if (canonicalRows(snapshot.rows[table]) !== canonicalRows(options.expectedRows[table])) {
        add(issues, 'revision', `rows.${table}`, 'materialized 行与确定性重放结果不一致');
      }
    }
  }
  return issues;
}

export function assertWorldEvolutionDbConsistency(
  snapshot: WorldEvolutionDbSnapshot,
  options: WorldEvolutionDbConsistencyOptions = {},
): void {
  const issues = inspectWorldEvolutionDbSnapshot(snapshot, options);
  if (issues.length) throw new WorldEvolutionDbConsistencyError(issues);
}
