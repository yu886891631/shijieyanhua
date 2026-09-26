import type { WorldEvolutionInput, WorldEvolutionSettings } from '../世界演变/types';
import {
  cloneDbValue,
  rowKey,
  type WorldEvolutionDbOperation,
  type WorldEvolutionDbRow,
  type WorldEvolutionDbSnapshot,
  type WorldEvolutionDbTable,
  type WorldEvolutionDbVisibility,
} from './types';

const ENTITY_TABLES = ['npc', 'organization', 'location', 'society', 'environment'] as const;
type EntityTable = (typeof ENTITY_TABLES)[number];
const VISIBILITIES = ['backstage', 'ai_context', 'protagonist_known', 'revealed'] as const;
const MAX_RESPONSE_LENGTH = 48_000;
const MAX_TEXT_LENGTH = 2_000;
const MAX_ID_LENGTH = 120;
const MAX_OPERATIONS = 32;
const MAX_CHANGES_LENGTH = 8_000;
const REFERENCE_FIELDS = new Set(['locationId', 'organizationIds', 'memberIds', 'relationIds', 'relatedIds', 'actorIds']);
const REFERENCE_TABLES: Record<string, readonly EntityTable[]> = {
  locationId: ['location'],
  organizationIds: ['organization'],
  memberIds: ['npc'],
  actorIds: ['npc'],
  relationIds: ENTITY_TABLES,
  relatedIds: ENTITY_TABLES,
};
const FORBIDDEN_KEYS = new Set([
  '__proto__', 'prototype', 'constructor', 'id', 'key', 'chatKey', 'table', 'revision',
  'sourceMessageId', 'createdAt', 'updatedAt', 'deletedAt', 'visibility', 'name', 'title',
]);

type RecordValue = Record<string, unknown>;

export type WorldEvolutionAiOperations = {
  baseRevision: number;
  operations: Array<
    | { op: 'upsert'; table: EntityTable; id: string; name: string; changes: RecordValue; visibility?: WorldEvolutionDbVisibility }
    | { op: 'append'; table: 'event' | 'plan'; id?: string; data: RecordValue }
    | { op: 'update_status'; table: 'event' | 'plan'; id: string; status: string }
    | { op: 'delete'; table: EntityTable; id: string; name: string }
  >;
};

export type ValidatedAiOperations = {
  operations: WorldEvolutionDbOperation[];
  changedEntityIds: string[];
  eventIds: string[];
};

function record(value: unknown, label: string): RecordValue {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`);
  return value as RecordValue;
}

function keys(value: RecordValue, allowed: readonly string[], label: string): void {
  const invalid = Object.keys(value).find(key => !allowed.includes(key));
  if (invalid) throw new Error(`${label}包含未允许字段：${invalid}`);
}

function text(value: unknown, label: string, max = MAX_TEXT_LENGTH): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || value.includes('\0')) {
    throw new Error(`${label}必须是 1-${max} 字的非空文本`);
  }
  return value.trim();
}

function optionalText(value: unknown, label: string, max = MAX_TEXT_LENGTH): string | undefined {
  return value === undefined ? undefined : text(value, label, max);
}

function visibility(value: unknown, label: string): WorldEvolutionDbVisibility {
  if (!VISIBILITIES.includes(value as WorldEvolutionDbVisibility)) throw new Error(`${label}无效`);
  return value as WorldEvolutionDbVisibility;
}

function entityTable(value: unknown, label: string): EntityTable {
  if (!ENTITY_TABLES.includes(value as EntityTable)) throw new Error(`${label}不是实体表`);
  return value as EntityTable;
}

function dataValue(value: unknown, label: string, depth = 0): void {
  if (depth > 5) throw new Error(`${label}嵌套过深`);
  if (typeof value === 'string') {
    if (value.length > MAX_TEXT_LENGTH) throw new Error(`${label}文本过长`);
  } else if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${label}不是有限数字`);
  } else if (Array.isArray(value)) {
    if (value.length > 50) throw new Error(`${label}数组过长`);
    value.forEach((item, index) => dataValue(item, `${label}[${index}]`, depth + 1));
  } else if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value);
    if (entries.length > 32) throw new Error(`${label}字段过多`);
    for (const [key, item] of entries) {
      if (!key || key.length > 80 || ['__proto__', 'prototype', 'constructor'].includes(key)) {
        throw new Error(`${label}包含保留字段：${key}`);
      }
      dataValue(item, `${label}.${key}`, depth + 1);
    }
  } else if (value !== null && typeof value !== 'boolean') {
    throw new Error(`${label}包含不可序列化的值`);
  }
}

function dataRecord(value: unknown, label: string): RecordValue {
  const result = record(value, label);
  if (Object.keys(result).length === 0) throw new Error(`${label}不能为空`);
  if (JSON.stringify(result).length > MAX_CHANGES_LENGTH) throw new Error(`${label}超过大小限制`);
  dataValue(result, label);
  return result;
}

function referenceIds(value: unknown, label: string, many: boolean): string[] {
  if (many) {
    if (!Array.isArray(value) || value.length > 50) throw new Error(`${label}必须是 ID 数组`);
    const ids = value.map((item, index) => text(item, `${label}[${index}]`, MAX_ID_LENGTH));
    if (new Set(ids).size !== ids.length) throw new Error(`${label}包含重复 ID`);
    return ids;
  }
  return [text(value, label, MAX_ID_LENGTH)];
}

function stableId(table: EntityTable, name: string): string {
  const slug = name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');
  return `${table === 'society' ? 'social' : table}:${slug || 'entity'}`;
}

function generatedId(table: 'event' | 'plan', input: WorldEvolutionInput, index: number): string {
  return `${table === 'event' ? 'EV' : 'PL'}-${input.messageId}-${index + 1}`;
}

function findRow(snapshot: WorldEvolutionDbSnapshot, table: WorldEvolutionDbTable, id: string): WorldEvolutionDbRow | undefined {
  return snapshot.rows[table].find(row => row.id === id);
}

type Reference = { id: string; field: string };

function readReferences(value: RecordValue | unknown[], label: string, references: Reference[]): void {
  for (const [key, item] of Object.entries(value)) {
    if (REFERENCE_FIELDS.has(key)) {
      references.push(...referenceIds(item, `${label}.${key}`, key.endsWith('Ids')).map(id => ({ id, field: key })));
    } else if (item !== null && typeof item === 'object') {
      readReferences(item as RecordValue | unknown[], `${label}.${key}`, references);
    }
  }
}

export function parseWorldEvolutionOperations(raw: string): WorldEvolutionAiOperations {
  if (raw.length > MAX_RESPONSE_LENGTH) throw new Error('世界演变 AI 响应超过大小限制');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.trim());
  } catch {
    throw new Error('世界演变 AI 必须返回单个合法 JSON 对象，不允许标签或 Markdown');
  }
  const root = record(parsed, '世界演变 AI 响应');
  keys(root, ['baseRevision', 'operations'], '世界演变 AI 响应');
  if (!Number.isSafeInteger(root.baseRevision) || (root.baseRevision as number) < 0) {
    throw new Error('baseRevision 必须是非负整数');
  }
  if (!Array.isArray(root.operations) || root.operations.length > MAX_OPERATIONS) {
    throw new Error(`operations 必须是最多 ${MAX_OPERATIONS} 项的数组`);
  }
  return root as WorldEvolutionAiOperations;
}

export function validateWorldEvolutionOperations(
  snapshot: WorldEvolutionDbSnapshot,
  parsed: WorldEvolutionAiOperations,
  input: WorldEvolutionInput,
  settings: WorldEvolutionSettings,
  now = Date.now(),
): ValidatedAiOperations {
  // Validate injected/mock results through the same root boundary as raw AI responses.
  parsed = parseWorldEvolutionOperations(JSON.stringify(parsed));
  if (parsed.baseRevision !== snapshot.meta.revision) {
    throw new Error(`世界演变 baseRevision 冲突：AI 基于 ${parsed.baseRevision}，当前是 ${snapshot.meta.revision}`);
  }
  if (snapshot.meta.chatKey !== input.chatKey) throw new Error('世界演变聊天标识不一致');
  const candidateNames = new Set(input.candidateNames);
  const operations: WorldEvolutionDbOperation[] = [];
  const changedEntityIds: string[] = [];
  const eventIds: string[] = [];
  const touched = new Set<string>();
  const deleted = new Set<string>();
  const references: Reference[] = [];
  const knownIds = new Map(ENTITY_TABLES.flatMap(table => snapshot.rows[table].map(row => [row.id, table] as const)));
  const allowedCount = Math.max(0, settings.maxNpcPerRun) + Math.max(0, settings.maxOtherEntitiesPerRun);
  const limits = { npc: settings.maxNpcPerRun, other: settings.maxOtherEntitiesPerRun, event: allowedCount, plan: allowedCount };
  const counts = { npc: 0, other: 0, event: 0, plan: 0 };

  for (const [index, value] of parsed.operations.entries()) {
    const label = `operations[${index}]`;
    const operation = record(value, label);
    const op = operation.op;
    const table = operation.table;
    if (op !== 'upsert' && op !== 'append' && op !== 'update_status' && op !== 'delete') {
      throw new Error(`${label}.op 不合法`);
    }
    if (op === 'upsert' || op === 'delete') {
      const entity = entityTable(table, `${label}.table`);
      keys(operation, op === 'upsert'
        ? ['op', 'table', 'id', 'name', 'changes', 'visibility']
        : ['op', 'table', 'id', 'name'], label);
      const id = text(operation.id, `${label}.id`, MAX_ID_LENGTH);
      const name = text(operation.name, `${label}.name`, 120);
      const previous = findRow(snapshot, entity, id);
      if (!candidateNames.has(name)) throw new Error(`${label}修改了非候选对象：${name}`);
      const candidate = input.queryContext?.candidates.find(item => item.name === name);
      if (candidate && ENTITY_TABLES.includes(candidate.table as EntityTable) && candidate.table !== entity) {
        throw new Error(`${label}的表与候选类型不一致`);
      }
      if (previous ? previous.name !== name : op === 'delete' || id !== stableId(entity, name)) {
        throw new Error(`${label}的本库稳定 ID 与候选名称不匹配：${id}`);
      }
      if (ENTITY_TABLES.some(other => other !== entity && findRow(snapshot, other, id))) {
        throw new Error(`${label}的实体 ID 已被其他表使用：${id}`);
      }
      if (!previous && snapshot.rows[entity].some(row => row.name === name)) {
        throw new Error(`${label}必须沿用同名对象已有的本库 ID`);
      }
      const key = `${entity}\0${id}`;
      if (touched.has(key)) throw new Error(`${label}重复操作对象：${id}`);
      touched.add(key);
      counts[entity === 'npc' ? 'npc' : 'other'] += 1;
      if (op === 'delete') {
        if (!previous || previous.visibility !== 'backstage') {
          throw new Error(`${label}只能删除已有且仍为 backstage 的候选对象`);
        }
        deleted.add(id);
        operations.push({ op: 'delete', table: entity, id });
        changedEntityIds.push(id);
        continue;
      }
      const changes = dataRecord(operation.changes, `${label}.changes`);
      if (previous?.visibility === 'protagonist_known' || previous?.visibility === 'revealed') {
        throw new Error(`${label}不能由后台 AI 改写主角已知或公开的实体`);
      }
      const reserved = Object.keys(changes).find(key => FORBIDDEN_KEYS.has(key));
      if (reserved) throw new Error(`${label}.changes 包含保留字段：${reserved}`);
      readReferences(changes, `${label}.changes`, references);
      const nextVisibility = operation.visibility === undefined
        ? previous?.visibility ?? 'ai_context'
        : visibility(operation.visibility, `${label}.visibility`);
      if (
        previous?.visibility === 'backstage' && nextVisibility !== 'backstage' ||
        nextVisibility === 'protagonist_known' || nextVisibility === 'revealed'
      ) {
        throw new Error(`${label}不能自动将对象升级为主角已知或公开`);
      }
      const row: WorldEvolutionDbRow = previous
        ? cloneDbValue(previous)
        : {
            key: rowKey(input.chatKey, entity, id), id, chatKey: input.chatKey, table: entity,
            name, visibility: nextVisibility, revision: snapshot.meta.revision + 1,
            data: {}, createdAt: now, updatedAt: now,
          };
      row.visibility = nextVisibility;
      row.sourceMessageId = input.messageId;
      row.updatedAt = now;
      row.data = { ...row.data, ...cloneDbValue(changes) };
      operations.push({ op: 'upsert', table: entity, id, row });
      knownIds.set(id, entity);
      changedEntityIds.push(id);
      continue;
    }
    if (table !== 'event' && table !== 'plan') throw new Error(`${label}.table 不是事件或计划表`);
    keys(operation, op === 'append'
      ? ['op', 'table', 'id', 'data']
      : ['op', 'table', 'id', 'status'], label);
    if (op === 'update_status') {
      const id = text(operation.id, `${label}.id`, MAX_ID_LENGTH);
      const previous = findRow(snapshot, table, id);
      if (!previous) throw new Error(`${label}引用了不存在的 ${table}：${id}`);
      const actors = Array.isArray(previous.data.actorIds) ? previous.data.actorIds : [];
      const legacyActors = Array.isArray(previous.data.actors) ? previous.data.actors : [];
      const related = actors.some(actor => ENTITY_TABLES.some(entity =>
        snapshot.rows[entity].some(row => row.id === actor && row.name && candidateNames.has(row.name)),
      )) || legacyActors.some(actor => typeof actor === 'string' && candidateNames.has(actor)) ||
        candidateNames.has(previous.title ?? '');
      if (!related) throw new Error(`${label}事件或计划不属于本轮候选范围`);
      if (table === 'plan' && !['pending', 'completed', 'cancelled'].includes(String(operation.status)) ||
          table === 'event' && !['active', 'resolved', 'cancelled'].includes(String(operation.status))) {
        throw new Error(`${label}.status 无效`);
      }
      const initialStatus = previous.status ?? previous.data.status ?? (table === 'event' ? 'active' : 'pending');
      if (initialStatus !== (table === 'event' ? 'active' : 'pending') || operation.status === initialStatus) {
        throw new Error(`${label}不能重新开启或重复提交已结束的状态`);
      }
      counts[table] += 1;
      const key = `${table}\0${id}`;
      if (touched.has(key)) throw new Error(`${label}重复操作对象：${id}`);
      touched.add(key);
      const row = cloneDbValue(previous);
      row.data.status = operation.status;
      row.status = operation.status as string;
      row.sourceMessageId = input.messageId;
      row.updatedAt = now;
      operations.push({ op: 'upsert', table, id, row });
      continue;
    }
    counts[table] += 1;
    const id = optionalText(operation.id, `${label}.id`, MAX_ID_LENGTH) ?? generatedId(table, input, index);
    const key = `${table}\0${id}`;
    if (touched.has(key) || findRow(snapshot, table, id)) throw new Error(`${label}重复或已存在的 ID：${id}`);
    touched.add(key);
    const data = dataRecord(operation.data, `${label}.data`);
    keys(data, table === 'event'
      ? ['eventType', 'summary', 'details', 'actorIds', 'locationId', 'eventTime', 'visibility']
      : ['title', 'trigger', 'actorIds', 'dueTime', 'visibility'], `${label}.data`);
    const title = text(data[table === 'event' ? 'summary' : 'title'], `${label}.data.${table === 'event' ? 'summary' : 'title'}`);
    for (const field of table === 'event' ? ['eventType', 'details', 'eventTime'] : ['trigger', 'dueTime']) {
      if (data[field] !== undefined) text(data[field], `${label}.data.${field}`);
    }
    readReferences(data, `${label}.data`, references);
    const rowVisibility = data.visibility === undefined ? 'ai_context' : visibility(data.visibility, `${label}.data.visibility`);
    if (rowVisibility === 'protagonist_known' || rowVisibility === 'revealed') {
      throw new Error(`${label}不能自动把后台事件或计划标记为主角已知`);
    }
    const content = { ...data };
    delete content.visibility;
    const row: WorldEvolutionDbRow = {
      key: rowKey(input.chatKey, table, id), id, chatKey: input.chatKey, table,
      title, visibility: rowVisibility, sourceMessageId: input.messageId,
      revision: snapshot.meta.revision + 1, data: cloneDbValue(content),
      createdAt: now, updatedAt: now,
    };
    if (table === 'event') {
      row.data.type = row.data.eventType ?? 'world_change';
      row.data.status = 'active';
      row.status = 'active';
      eventIds.push(id);
    } else {
      row.data.status = 'pending';
      row.status = 'pending';
    }
    operations.push({ op: 'upsert', table, id, row });
  }
  for (const [kind, count] of Object.entries(counts) as Array<[keyof typeof counts, number]>) {
    if (count > limits[kind]) throw new Error(`${kind} 操作 ${count} 条超过本轮上限 ${limits[kind]}`);
  }
  for (const { id, field } of references) {
    const table = knownIds.get(id);
    if (!table || deleted.has(id) || !REFERENCE_TABLES[field]?.includes(table)) {
      throw new Error(`操作引用了不存在、类型不匹配或已删除的本库对象：${id}`);
    }
  }
  if (deleted.size) {
    const replacements = new Map(
      operations
        .filter((operation): operation is Extract<WorldEvolutionDbOperation, { op: 'upsert' }> => operation.op === 'upsert')
        .map(operation => [`${operation.table}\0${operation.id}`, operation.row]),
    );
    for (const table of [...ENTITY_TABLES, 'event', 'plan'] as WorldEvolutionDbTable[]) {
      for (const row of snapshot.rows[table]) {
        if (deleted.has(row.id)) continue;
        const existingRefs: Reference[] = [];
        const finalRow = replacements.get(`${table}\0${row.id}`) ?? row;
        readReferences(finalRow.data, `${table}/${row.id}`, existingRefs);
        if (existingRefs.some(ref => deleted.has(ref.id))) throw new Error(`删除对象仍被 ${table}/${row.id} 引用`);
      }
    }
  }
  // Resolve references against the final batch, including rows created later in the response.
  for (const operation of operations) {
    if (operation.op !== 'upsert') continue;
    const rowRefs: Reference[] = [];
    readReferences(operation.row.data, `${operation.table}/${operation.id}`, rowRefs);
    for (const { id, field } of rowRefs) {
      const table = knownIds.get(id);
      if (!table || deleted.has(id) || !REFERENCE_TABLES[field]?.includes(table)) {
        throw new Error(`记录引用了不存在、类型不匹配或已删除的本库对象：${id}`);
      }
    }
    if (Array.isArray(operation.row.data.actorIds)) {
      operation.row.data.actors = operation.row.data.actorIds.map(id => {
        const created = operations.find(item => item.op === 'upsert' && item.id === id && ENTITY_TABLES.includes(item.table as EntityTable));
        if (created?.op === 'upsert') return created.row.name ?? id;
        return ENTITY_TABLES.flatMap(table => snapshot.rows[table]).find(row => row.id === id)?.name ?? id;
      });
    }
    if (operation.table === 'event') {
      if (typeof operation.row.data.eventTime === 'string') operation.row.data.time = operation.row.data.eventTime;
      if (typeof operation.row.data.locationId === 'string') {
        const locationId = operation.row.data.locationId;
        const created = operations.find(item => item.op === 'upsert' && item.table === 'location' && item.id === locationId);
        operation.row.data.location = created?.op === 'upsert'
          ? created.row.name
          : snapshot.rows.location.find(row => row.id === locationId)?.name;
      }
    }
  }
  return { operations, changedEntityIds, eventIds };
}
