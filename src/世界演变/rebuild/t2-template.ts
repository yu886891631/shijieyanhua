/** T2 纯模板协议；不连接 SQLite、聊天存档、API 或世界书。 */
import { z } from 'zod';

export type T2Json = null | boolean | number | string | T2Json[] | { [key: string]: T2Json };
export interface T2Reference {
  tableId: string;
  rowId: string;
}
export interface T2WorldTime {
  calendarId: string;
  ordinalMinute: number;
  display: string;
}
export type T2Cell = null | boolean | number | string | string[] | T2Reference | T2Reference[] | T2WorldTime;
export interface T2Visibility {
  user: boolean;
  evolutionAi: boolean;
  mainAi: boolean;
}
export type T2Inherited<T> = { state: 'inherit' } | { state: 'disabled' } | { state: 'value'; value: T };
export interface T2Frequency {
  unit: 'eligible-story-round';
  every: number;
  offset: number;
}
export interface T2Budget {
  maxRows: number;
  maxNewRows: number;
  maxRequests: number;
  maxContextChars: number;
}
export interface T2ContextSettings {
  maxRows: number;
  maxChars: number;
  includeArchived: boolean;
  lastAssistantMessages: number;
  sources: ('story' | 'mvu' | 'database' | 'worldbook')[];
}
export interface T2ApiReference {
  presetId: string;
}
export interface T2PhaseSettings {
  enabled: boolean;
  frequency: T2Inherited<T2Frequency>;
  budget: T2Inherited<T2Budget>;
  context: T2Inherited<T2ContextSettings>;
  api: T2Inherited<T2ApiReference>;
}
export type T2FieldType =
  | 'text'
  | 'integer'
  | 'number'
  | 'decimal'
  | 'boolean'
  | 'enum'
  | 'string-list'
  | 'reference'
  | 'reference-list'
  | 'world-time';
export type T2FieldControl =
  | 'single-line'
  | 'multiline'
  | 'integer'
  | 'number'
  | 'decimal'
  | 'toggle'
  | 'select'
  | 'string-list'
  | 'reference'
  | 'reference-list'
  | 'world-time';
export interface T2Field {
  id: string;
  sqlName: string;
  name: string;
  description: string;
  type: T2FieldType;
  nullable: boolean;
  required: boolean;
  readonly: boolean;
  hiddenUi: boolean;
  permissions: { manualWrite: boolean; aiWrite: boolean };
  visibility: T2Visibility;
  defaultValue?: T2Cell;
  constraints: {
    min?: number;
    max?: number;
    maxLength?: number;
    maxItems?: number;
    enumValues?: string[];
    /** AI cannot leave these terminal states. Manual corrections remain permitted. */
    terminalValues?: string[];
    precision?: number;
    scale?: number;
    reference?: { tableIds: string[]; onDelete: 'restrict' | 'clear' };
    calendarId?: string;
  };
  control: T2FieldControl;
  /** Optional DIY meaning, independent of SQL/display names. Old templates may omit it. */
  semantic?: 'none' | 'deadline' | 'fact-time';
}
export interface T2WritePermissions {
  insert: boolean;
  update: boolean;
  archive: boolean;
  delete: boolean;
}
export type T2Purpose = 'society' | 'environment' | 'location' | 'npc' | 'organization' | 'plan' | 'event' | 'custom';
export interface T2Table {
  id: string;
  sqlName: string;
  name: string;
  description: string;
  groupId: 'macro' | 'micro';
  purpose: T2Purpose;
  fields: T2Field[];
  visibility: T2Visibility;
  permissions: { manual: T2WritePermissions; ai: T2WritePermissions };
  locked: boolean;
  rules: { initialize: string; insert: string; update: string; archive: string; delete: string };
  runtime: {
    enabled: boolean;
    frequency: T2Inherited<T2Frequency>;
    budget: T2Inherited<T2Budget>;
    api: T2Inherited<T2ApiReference>;
  };
  context: { settings: T2Inherited<T2ContextSettings>; fieldIds: string[]; relatedTableIds: string[] };
  export: {
    enabled: boolean;
    mode: 'per-row' | 'index' | 'constant';
    fieldIds: string[];
    titleFieldId: string | null;
    keyFieldIds: string[];
    prefix: 'WorldEvolution-';
    maxChars: number;
    includeArchived: boolean;
  };
}
export interface T2Template {
  format: 'world-evolution-template';
  schemaVersion: 1;
  dataVersion: 1;
  templateVersion: number;
  id: string;
  name: string;
  description: string;
  groups: { id: 'macro' | 'micro'; name: string; description: string }[];
  calendars: { id: string; name: string; epoch: string; minutesPerDay: number }[];
  defaults: {
    frequency: T2Frequency;
    budget: T2Budget;
    context: T2ContextSettings;
    api: Exclude<T2Inherited<T2ApiReference>, { state: 'inherit' }>;
  };
  phases: { macro: T2PhaseSettings; micro: T2PhaseSettings };
  hardLimits: T2Budget;
  tables: T2Table[];
}
export interface T2Row {
  meta: {
    id: string;
    locked: boolean;
    lockedFieldIds: string[];
    archived: boolean;
    visibility: T2Visibility;
    source: { kind: 'manual' | 'story' | 'mvu' | 'database' | 'evolution' | 'import'; detail: string };
    createdAtRevision: number;
    updatedAtRevision: number;
  };
  values: Record<string, T2Cell>;
}
/** 仅数据快照载荷；完整提交/聊天存档封套由 T4/T10 定义。 */
export interface T2WorldData {
  format: 'world-evolution-data';
  dataVersion: 1;
  schemaVersion: 1;
  worldId: string;
  branchId: string;
  revision: number;
  templateId: string;
  templateVersion: number;
  tables: Record<string, T2Row[]>;
}

export const T2_SCHEMA_VERSION = 1;
export const T2_DATA_VERSION = 1;
export const T2_ID_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;
export const T2_COMPLEX_CELL_MAX_CHARS = 256_000;
export const T2_SYSTEM_SQL_COLUMNS = Object.freeze([
  '__we_row_id',
  '__we_locked',
  '__we_locked_fields',
  '__we_archived',
  '__we_visibility',
  '__we_source',
  '__we_created_revision',
  '__we_updated_revision',
  '__we_presence',
] as const);

/** 不调用 getter/toJSON；提前拒绝不属于 JSON 的对象及循环，并限制资源。 */
export function cloneT2Json(input: unknown): T2Json {
  const active = new Set<object>();
  let nodes = 0;
  let characters = 0;
  function clone(value: unknown, depth: number): T2Json {
    if (++nodes > 100_000 || depth > 64) throw new Error('T2 JSON exceeds size/depth limits.');
    if (typeof value === 'string') {
      characters += value.length;
      if (value.length > 1_000_000 || characters > 4_000_000) throw new Error('T2 JSON exceeds character limits.');
      return value;
    }
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'number' && Number.isFinite(value) && !Object.is(value, -0)) return value;
    if (typeof value !== 'object') throw new Error('T2 requires finite plain JSON values.');
    if (active.has(value)) throw new Error('T2 JSON cannot contain cycles.');
    if (Object.getOwnPropertySymbols(value).length) throw new Error('T2 JSON cannot contain symbol keys.');
    const proto = Object.getPrototypeOf(value);
    if (Array.isArray(value) ? proto !== Array.prototype : proto !== Object.prototype && proto !== null)
      throw new Error('T2 JSON requires plain objects/arrays.');
    active.add(value);
    try {
      const descriptors = Object.getOwnPropertyDescriptors(value);
      if (Array.isArray(value)) {
        const result: T2Json[] = [];
        if (Object.keys(descriptors).length !== value.length + 1)
          throw new Error('T2 JSON arrays cannot have extra fields.');
        for (let i = 0; i < value.length; i += 1) {
          const descriptor = descriptors[String(i)];
          if (!descriptor || !('value' in descriptor) || !descriptor.enumerable)
            throw new Error('T2 JSON arrays require dense plain values.');
          result.push(clone(descriptor.value, depth + 1));
        }
        return result;
      }
      const result: { [key: string]: T2Json } = {};
      for (const [key, descriptor] of Object.entries(descriptors)) {
        characters += key.length;
        if (key.length > 1_000 || characters > 4_000_000) throw new Error('T2 JSON exceeds character/key limits.');
        if (key === '__proto__' || key === 'constructor' || key === 'prototype')
          throw new Error('T2 JSON rejects unsafe property keys.');
        if (!('value' in descriptor) || !descriptor.enumerable)
          throw new Error('T2 JSON cannot contain accessors/non-enumerable values.');
        Object.defineProperty(result, key, {
          value: clone(descriptor.value, depth + 1),
          enumerable: true,
          configurable: true,
          writable: true,
        });
      }
      return result;
    } finally {
      active.delete(value);
    }
  }
  return clone(input, 0);
}

const idSchema = z
  .string()
  .regex(T2_ID_PATTERN)
  .refine(value => value !== 'constructor' && value !== 'prototype', 'Unsafe identifier.');
const nonnegative = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const positive = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const label = z.string().min(1).max(160);
const description = z.string().max(10_000);
const visibilitySchema = z.strictObject({ user: z.boolean(), evolutionAi: z.boolean(), mainAi: z.boolean() });
const frequencySchema = z.strictObject({
  unit: z.literal('eligible-story-round'),
  every: positive,
  offset: nonnegative,
});
const budgetSchema = z.strictObject({
  maxRows: nonnegative.max(10_000),
  maxNewRows: nonnegative.max(1_000),
  maxRequests: nonnegative.max(100),
  maxContextChars: nonnegative.max(2_000_000),
});
const contextSchema = z.strictObject({
  maxRows: nonnegative.max(10_000),
  maxChars: nonnegative.max(2_000_000),
  includeArchived: z.boolean(),
  lastAssistantMessages: nonnegative.max(1_000),
  sources: z.array(z.enum(['story', 'mvu', 'database', 'worldbook'])).max(4),
});
const apiSchema = z.strictObject({ presetId: idSchema });
function inherited<T extends z.ZodType>(schema: T) {
  return z.discriminatedUnion('state', [
    z.strictObject({ state: z.literal('inherit') }),
    z.strictObject({ state: z.literal('disabled') }),
    z.strictObject({ state: z.literal('value'), value: schema }),
  ]);
}
const defaultApiSchema = z.discriminatedUnion('state', [
  z.strictObject({ state: z.literal('disabled') }),
  z.strictObject({ state: z.literal('value'), value: apiSchema }),
]);
const phaseSchema = z.strictObject({
  enabled: z.boolean(),
  frequency: inherited(frequencySchema),
  budget: inherited(budgetSchema),
  context: inherited(contextSchema),
  api: inherited(apiSchema),
});
const constraintsSchema = z.strictObject({
  min: z.number().finite().optional(),
  max: z.number().finite().optional(),
  maxLength: positive.max(1_000_000).optional(),
  maxItems: positive.max(10_000).optional(),
  enumValues: z.array(z.string().min(1).max(160)).min(1).max(1_000).optional(),
  terminalValues: z.array(z.string().min(1).max(160)).max(1_000).optional(),
  precision: positive.max(15).optional(),
  scale: nonnegative.max(15).optional(),
  reference: z
    .strictObject({ tableIds: z.array(idSchema).min(1).max(256), onDelete: z.enum(['restrict', 'clear']) })
    .optional(),
  calendarId: idSchema.optional(),
});
const fieldSchema = z.strictObject({
  id: idSchema,
  sqlName: z.string().regex(/^f_[a-z][a-z0-9_]{0,61}$/),
  name: label,
  description,
  semantic: z.enum(['none', 'deadline', 'fact-time']).optional(),
  type: z.enum([
    'text',
    'integer',
    'number',
    'decimal',
    'boolean',
    'enum',
    'string-list',
    'reference',
    'reference-list',
    'world-time',
  ]),
  nullable: z.boolean(),
  required: z.boolean(),
  readonly: z.boolean(),
  hiddenUi: z.boolean(),
  permissions: z.strictObject({ manualWrite: z.boolean(), aiWrite: z.boolean() }),
  visibility: visibilitySchema,
  defaultValue: z.unknown().optional(),
  constraints: constraintsSchema,
  control: z.enum([
    'single-line',
    'multiline',
    'integer',
    'number',
    'decimal',
    'toggle',
    'select',
    'string-list',
    'reference',
    'reference-list',
    'world-time',
  ]),
});
const writeSchema = z.strictObject({
  insert: z.boolean(),
  update: z.boolean(),
  archive: z.boolean(),
  delete: z.boolean(),
});
const tableSchema = z.strictObject({
  id: idSchema,
  sqlName: z.string().regex(/^we_[a-z][a-z0-9_]{0,60}$/),
  name: label,
  description,
  groupId: z.enum(['macro', 'micro']),
  purpose: z.enum(['society', 'environment', 'location', 'npc', 'organization', 'plan', 'event', 'custom']),
  fields: z.array(fieldSchema).min(1).max(256),
  visibility: visibilitySchema,
  permissions: z.strictObject({ manual: writeSchema, ai: writeSchema }),
  locked: z.boolean(),
  rules: z.strictObject({
    initialize: description,
    insert: description,
    update: description,
    archive: description,
    delete: description,
  }),
  runtime: z.strictObject({
    enabled: z.boolean(),
    frequency: inherited(frequencySchema),
    budget: inherited(budgetSchema),
    api: inherited(apiSchema),
  }),
  context: z.strictObject({
    settings: inherited(contextSchema),
    fieldIds: z.array(idSchema).max(256),
    relatedTableIds: z.array(idSchema).max(256),
  }),
  export: z.strictObject({
    enabled: z.boolean(),
    mode: z.enum(['per-row', 'index', 'constant']),
    fieldIds: z.array(idSchema).max(256),
    titleFieldId: idSchema.nullable(),
    keyFieldIds: z.array(idSchema).max(256),
    prefix: z.literal('WorldEvolution-'),
    maxChars: positive.max(1_000_000),
    includeArchived: z.boolean(),
  }),
});
const templateSchema = z.strictObject({
  format: z.literal('world-evolution-template'),
  schemaVersion: z.literal(1),
  dataVersion: z.literal(1),
  templateVersion: positive,
  id: idSchema,
  name: label,
  description,
  groups: z.array(z.strictObject({ id: z.enum(['macro', 'micro']), name: label, description })).length(2),
  calendars: z
    .array(z.strictObject({ id: idSchema, name: label, epoch: label, minutesPerDay: positive }))
    .min(1)
    .max(32),
  defaults: z.strictObject({
    frequency: frequencySchema,
    budget: budgetSchema,
    context: contextSchema,
    api: defaultApiSchema,
  }),
  phases: z.strictObject({ macro: phaseSchema, micro: phaseSchema }),
  hardLimits: budgetSchema,
  tables: z.array(tableSchema).min(1).max(256),
});

function requireUnique(values: readonly string[], path: string): void {
  if (new Set(values).size !== values.length) throw new Error(`T2 duplicate IDs/mappings at ${path}.`);
}

const CONTROL_BY_TYPE: Record<T2FieldType, readonly T2FieldControl[]> = {
  text: ['single-line', 'multiline'],
  integer: ['integer'],
  number: ['number'],
  decimal: ['decimal'],
  boolean: ['toggle'],
  enum: ['select'],
  'string-list': ['string-list'],
  reference: ['reference'],
  'reference-list': ['reference-list'],
  'world-time': ['world-time'],
};

function validateField(field: T2Field, template: T2Template | null, path: string): void {
  const c = field.constraints;
  if (!CONTROL_BY_TYPE[field.type].includes(field.control))
    throw new Error(`T2 control/type mismatch at ${path}.control.`);
  if (field.readonly && (field.permissions.manualWrite || field.permissions.aiWrite))
    throw new Error(`T2 readonly fields cannot allow writes at ${path}.permissions.`);
  const allowed: Record<T2FieldType, readonly string[]> = {
    text: ['maxLength'],
    integer: ['min', 'max'],
    number: ['min', 'max'],
    decimal: ['precision', 'scale'],
    boolean: [],
    enum: ['enumValues', 'terminalValues'],
    'string-list': ['maxItems', 'maxLength', 'enumValues'],
    reference: ['reference'],
    'reference-list': ['reference', 'maxItems'],
    'world-time': ['calendarId'],
  };
  for (const key of Object.keys(c))
    if (!allowed[field.type].includes(key))
      throw new Error(`T2 constraint ${key} is not supported for ${field.type} at ${path}.`);
  if (c.min !== undefined && c.max !== undefined && c.min > c.max)
    throw new Error(`T2 inverted range at ${path}.constraints.`);
  if (field.type === 'integer' && [c.min, c.max].some(n => n !== undefined && !Number.isSafeInteger(n)))
    throw new Error(`T2 integer range must be safe integers at ${path}.`);
  if (field.type === 'number' && [c.min, c.max].some(n => n !== undefined && Math.abs(n) > Number.MAX_SAFE_INTEGER))
    throw new Error(`T2 number range must remain within safe magnitude at ${path}.`);
  if (c.enumValues) requireUnique(c.enumValues, `${path}.enumValues`);
  if (field.type === 'enum' && !c.enumValues) throw new Error(`T2 enum requires enumValues at ${path}.`);
  if (c.terminalValues) {
    requireUnique(c.terminalValues, `${path}.terminalValues`);
    if (c.terminalValues.some(v => !c.enumValues?.includes(v)))
      throw new Error(`T2 terminal state must be an enum value at ${path}.`);
  }
  if (field.semantic && field.semantic !== 'none' && field.type !== 'world-time')
    throw new Error(`T2 time semantics require world-time at ${path}.`);
  if (field.type === 'decimal' && (c.precision === undefined || c.scale === undefined || c.scale > c.precision))
    throw new Error(`T2 decimal requires valid precision and scale at ${path}.`);
  if (field.type === 'reference' || field.type === 'reference-list') {
    if (!c.reference) throw new Error(`T2 reference requires target tables at ${path}.`);
    requireUnique(c.reference.tableIds, `${path}.reference.tableIds`);
    for (const tableId of c.reference.tableIds)
      if (template && !template.tables.some(table => table.id === tableId))
        throw new Error(`T2 dangling reference table ${tableId} at ${path}.`);
    if (c.reference.onDelete === 'clear' && field.type === 'reference' && !field.nullable && field.required)
      throw new Error(`T2 required non-null reference cannot clear on delete at ${path}.`);
  }
  if (
    field.type === 'world-time' &&
    (!c.calendarId || (template && !template.calendars.some(calendar => calendar.id === c.calendarId)))
  )
    throw new Error(`T2 world-time requires a defined calendar at ${path}.`);
  if (Object.hasOwn(field, 'defaultValue')) validateDefault(field, field.defaultValue as T2Cell, path);
}

/** 单字段本地约束检查；目标表/历法存在性仍须完整模板校验。 */
export function normalizeT2FieldShape(input: unknown): T2Field {
  const field = fieldSchema.parse(cloneT2Json(input)) as T2Field;
  validateField(field, null, 'field');
  return field;
}

export interface T2FieldEncoding {
  control: T2FieldControl;
  sqlite: 'TEXT' | 'INTEGER' | 'REAL';
  json: string;
  nullRule: 'explicit-null-if-nullable';
  missingRule: 'presence-sidecar-not-null';
  precision: string;
}

/** SQL 物理表示描述，不生成或执行 SQL；列表和对象仍需应用层完整校验。 */
export function describeT2FieldEncoding(input: T2Field): T2FieldEncoding {
  const field = normalizeT2FieldShape(input);
  const entries: Record<T2FieldType, Pick<T2FieldEncoding, 'sqlite' | 'json' | 'precision'>> = {
    text: { sqlite: 'TEXT', json: 'string', precision: 'UTF-16 code-unit length' },
    integer: { sqlite: 'INTEGER', json: 'number', precision: 'JavaScript safe integer only' },
    number: { sqlite: 'REAL', json: 'number', precision: 'finite IEEE-754 binary64; not exact decimal arithmetic' },
    decimal: {
      sqlite: 'INTEGER',
      json: 'fixed-scale decimal string',
      precision: `precision ${field.constraints.precision ?? 0}, scale ${field.constraints.scale ?? 0}; exact scaled safe integer, no numeric coercion`,
    },
    boolean: { sqlite: 'INTEGER', json: 'boolean', precision: '0 or 1 only' },
    enum: { sqlite: 'TEXT', json: 'allowed string', precision: 'exact enum spelling' },
    'string-list': {
      sqlite: 'TEXT',
      json: 'string[] encoded as JSON',
      precision: 'ordered unique members; application validation',
    },
    reference: {
      sqlite: 'TEXT',
      json: '{tableId,rowId} encoded as JSON',
      precision: 'stable composite identity; application foreign-key validation',
    },
    'reference-list': {
      sqlite: 'TEXT',
      json: '{tableId,rowId}[] encoded as JSON',
      precision: 'ordered unique references; application foreign-key validation',
    },
    'world-time': {
      sqlite: 'TEXT',
      json: '{calendarId,ordinalMinute,display} encoded as JSON',
      precision: 'safe integer minutes; compare only within the same calendar',
    },
  };
  return {
    control: field.control,
    ...entries[field.type],
    nullRule: 'explicit-null-if-nullable',
    missingRule: 'presence-sidecar-not-null',
  };
}

/** 行存在性由值模块检查；模板默认值不能凭空引用某个业务行。 */
function validateDefault(field: T2Field, value: T2Cell, path: string): void {
  const c = field.constraints;
  function fail(): never {
    throw new Error(`T2 invalid defaultValue at ${path}.defaultValue.`);
  }
  if (value === null) {
    if (!field.nullable) fail();
    return;
  }
  switch (field.type) {
    case 'text':
      if (typeof value !== 'string' || value.length > (c.maxLength ?? 20_000)) fail();
      break;
    case 'integer':
    case 'number':
      if (
        typeof value !== 'number' ||
        !Number.isFinite(value) ||
        Math.abs(value) > Number.MAX_SAFE_INTEGER ||
        Object.is(value, -0) ||
        (field.type === 'integer' && !Number.isSafeInteger(value)) ||
        (c.min !== undefined && value < c.min) ||
        (c.max !== undefined && value > c.max)
      )
        fail();
      break;
    case 'decimal': {
      if (typeof value !== 'string') fail();
      const scale = c.scale as number;
      const matcher = scale === 0 ? /^-?(0|[1-9]\d*)$/ : new RegExp(`^-?(0|[1-9]\\d*)\\.\\d{${scale}}$`);
      if (
        !matcher.test(value) ||
        /^-0(?:\.0+)?$/.test(value) ||
        value.replace(/[-.]/g, '').replace(/^0+/, '').length > (c.precision as number)
      )
        fail();
      break;
    }
    case 'boolean':
      if (typeof value !== 'boolean') fail();
      break;
    case 'enum':
      if (typeof value !== 'string' || !c.enumValues?.includes(value)) fail();
      break;
    case 'string-list':
      if (
        !Array.isArray(value) ||
        value.some(
          item =>
            typeof item !== 'string' ||
            item.length > (c.maxLength ?? 20_000) ||
            (c.enumValues !== undefined && !c.enumValues.includes(item)),
        ) ||
        value.length > (c.maxItems ?? 1_000) ||
        new Set<unknown>(value).size !== value.length ||
        JSON.stringify(value).length > T2_COMPLEX_CELL_MAX_CHARS
      )
        fail();
      break;
    case 'reference':
      fail();
      break;
    case 'reference-list':
      if (!Array.isArray(value) || value.length !== 0) fail();
      break;
    case 'world-time':
      if (
        typeof value !== 'object' ||
        Array.isArray(value) ||
        !('calendarId' in value) ||
        Object.keys(value).length !== 3 ||
        value.calendarId !== c.calendarId ||
        !Number.isSafeInteger(value.ordinalMinute) ||
        typeof value.display !== 'string' ||
        !value.display.trim() ||
        value.display.length > 160
      )
        fail();
      break;
  }
}

/** 无默认补种、无静默丢弃未知字段、无类型强制转换。返回独立规范对象。 */
export function normalizeT2Template(input: unknown): T2Template {
  const result = templateSchema.parse(cloneT2Json(input)) as T2Template;
  requireUnique(
    result.groups.map(group => group.id),
    'groups',
  );
  requireUnique(
    result.calendars.map(calendar => calendar.id),
    'calendars',
  );
  requireUnique(
    result.tables.map(table => table.id),
    'tables',
  );
  requireUnique(
    result.tables.map(table => table.sqlName),
    'tables.sqlName',
  );
  requireUnique(result.defaults.context.sources, 'defaults.context.sources');
  for (const phase of ['macro', 'micro'] as const)
    if (result.phases[phase].context.state === 'value')
      requireUnique(result.phases[phase].context.value.sources, `phases.${phase}.context.sources`);
  for (const [index, table] of result.tables.entries()) {
    if (!result.groups.some(group => group.id === table.groupId))
      throw new Error(`T2 unknown group at tables.${index}.groupId.`);
    requireUnique(
      table.fields.map(field => field.id),
      `tables.${index}.fields`,
    );
    requireUnique(
      table.fields.map(field => field.sqlName),
      `tables.${index}.fields.sqlName`,
    );
    for (const [fieldIndex, field] of table.fields.entries())
      validateField(field, result, `tables.${index}.fields.${fieldIndex}`);
    if (table.context.settings.state === 'value')
      requireUnique(table.context.settings.value.sources, `tables.${index}.context.sources`);
    for (const [selection, values] of [
      ['context.fieldIds', table.context.fieldIds],
      ['export.fieldIds', table.export.fieldIds],
      ['export.keyFieldIds', table.export.keyFieldIds],
    ] as const) {
      requireUnique(values, `tables.${index}.${selection}`);
      for (const value of values)
        if (!table.fields.some(field => field.id === value))
          throw new Error(`T2 unknown field ${value} at tables.${index}.${selection}.`);
    }
    if (table.export.titleFieldId !== null && !table.fields.some(field => field.id === table.export.titleFieldId))
      throw new Error(`T2 unknown title field at tables.${index}.export.titleFieldId.`);
    requireUnique(table.context.relatedTableIds, `tables.${index}.context.relatedTableIds`);
    for (const value of table.context.relatedTableIds)
      if (!result.tables.some(other => other.id === value))
        throw new Error(`T2 unknown context table at tables.${index}.context.relatedTableIds.`);
  }
  return result;
}

export function serializeT2Template(input: unknown): string {
  return JSON.stringify(normalizeT2Template(input));
}

export interface T2ResolvedSetting<T> {
  state: 'value' | 'disabled';
  source: 'global' | 'phase' | 'table' | 'disabled';
  value: T | null;
}
export interface T2ResolvedTableSettings {
  tableId: string;
  enabled: boolean;
  frequency: T2ResolvedSetting<T2Frequency>;
  budget: T2ResolvedSetting<T2Budget>;
  context: T2ResolvedSetting<T2ContextSettings>;
  api: T2ResolvedSetting<T2ApiReference>;
  hardLimits: T2Budget;
  notes: string[];
}
function resolveSetting<T>(choice: T2Inherited<T>, phaseChoice: T2Inherited<T>, defaultValue: T): T2ResolvedSetting<T> {
  if (choice.state === 'disabled') return { state: 'disabled', source: 'disabled', value: null };
  if (choice.state === 'value') return { state: 'value', source: 'table', value: choice.value };
  if (phaseChoice.state === 'disabled') return { state: 'disabled', source: 'phase', value: null };
  if (phaseChoice.state === 'value') return { state: 'value', source: 'phase', value: phaseChoice.value };
  return { state: 'value', source: 'global', value: defaultValue };
}
/** 只计算上限和来源；不生成运行计划，也不消费真实请求额度。 */
export function resolveT2TableSettings(input: T2Template, tableId: string): T2ResolvedTableSettings {
  const template = normalizeT2Template(input);
  const table = template.tables.find(item => item.id === tableId);
  if (!table) throw new Error(`T2 unknown table ${tableId}.`);
  const phase = template.phases[table.groupId];
  const frequency = resolveSetting(table.runtime.frequency, phase.frequency, template.defaults.frequency);
  const budget = resolveSetting(table.runtime.budget, phase.budget, template.defaults.budget);
  const context = resolveSetting(table.context.settings, phase.context, template.defaults.context);
  const api: T2ResolvedSetting<T2ApiReference> =
    table.runtime.api.state === 'inherit'
      ? phase.api.state === 'disabled'
        ? { state: 'disabled', source: 'phase', value: null }
        : phase.api.state === 'value'
          ? { state: 'value', source: 'phase', value: phase.api.value }
          : template.defaults.api.state === 'disabled'
            ? { state: 'disabled', source: 'global', value: null }
            : { state: 'value', source: 'global', value: template.defaults.api.value }
      : table.runtime.api.state === 'disabled'
        ? { state: 'disabled', source: 'disabled', value: null }
        : { state: 'value', source: 'table', value: table.runtime.api.value };
  const notes: string[] = [];
  if (budget.value)
    for (const key of Object.keys(template.hardLimits) as (keyof T2Budget)[]) {
      if (budget.value[key] > template.hardLimits[key]) notes.push(`${key}受整轮硬上限限制`);
      budget.value[key] = Math.min(budget.value[key], template.hardLimits[key]);
    }
  if (budget.value && budget.value.maxNewRows > budget.value.maxRows) {
    budget.value.maxNewRows = budget.value.maxRows;
    notes.push('新增行数不能超过本表总修改行数');
  }
  if (context.value) {
    context.value.maxRows = Math.min(context.value.maxRows, template.hardLimits.maxRows);
    context.value.maxChars = Math.min(
      context.value.maxChars,
      template.hardLimits.maxContextChars,
      budget.value?.maxContextChars ?? template.hardLimits.maxContextChars,
    );
  }
  if (!phase.enabled) notes.push('阶段已关闭，表级设置不能重新启用该阶段');
  return {
    tableId,
    enabled: phase.enabled && table.runtime.enabled,
    frequency,
    budget,
    context,
    api,
    hardLimits: template.hardLimits,
    notes,
  };
}

/** round 是有效剧情账本轮次，非消息索引、尝试或重试次数；成功无变化仍记成功。 */
export function isT2TableDue(
  frequency: T2Frequency | null,
  eligibleRound: number,
  lastSuccessfulRound: number | null,
): boolean {
  if (
    !Number.isSafeInteger(eligibleRound) ||
    eligibleRound < 0 ||
    (lastSuccessfulRound !== null &&
      (!Number.isSafeInteger(lastSuccessfulRound) || lastSuccessfulRound < 0 || lastSuccessfulRound > eligibleRound))
  )
    throw new Error('T2 invalid successful-round marker.');
  if (frequency === null) return false;
  const spec = frequencySchema.parse(cloneT2Json(frequency));
  if (lastSuccessfulRound === eligibleRound || eligibleRound < spec.offset) return false;
  return lastSuccessfulRound === null || eligibleRound - lastSuccessfulRound >= spec.every;
}

export interface T2TemplateChange {
  kind: 'compatible' | 'migration-required';
  path: string;
  reason: string;
}
export interface T2TemplateComparison {
  compatible: boolean;
  changes: T2TemplateChange[];
}
/** 结构变化仅报告，绝不执行迁移或为历史补字段。 */
export function compareT2Templates(beforeInput: T2Template, afterInput: T2Template): T2TemplateComparison {
  const before = normalizeT2Template(beforeInput);
  const after = normalizeT2Template(afterInput);
  const changes: T2TemplateChange[] = [];
  function add(kind: T2TemplateChange['kind'], path: string, reason: string): void {
    changes.push({ kind, path, reason });
  }
  if (before.id !== after.id) add('migration-required', 'id', '模板身份变化');
  if (JSON.stringify(before.calendars) !== JSON.stringify(after.calendars))
    add('migration-required', 'calendars', '历法定义变化需要时间预检');
  for (const table of before.tables) {
    const next = after.tables.find(item => item.id === table.id);
    const path = `tables.${table.id}`;
    if (!next) {
      add('migration-required', path, '删除表需要数据与引用处理');
      continue;
    }
    if (table.sqlName !== next.sqlName || table.groupId !== next.groupId || table.purpose !== next.purpose)
      add('migration-required', path, '映射/组/用途变化需要预检');
    if (table.name !== next.name || table.description !== next.description)
      add('compatible', path, '显示说明变化不改变稳定身份');
    for (const field of table.fields) {
      const nextField = next.fields.find(item => item.id === field.id);
      const fieldPath = `${path}.fields.${field.id}`;
      if (!nextField) {
        add('migration-required', fieldPath, '删除字段需要历史保留与映射');
        continue;
      }
      if (
        field.sqlName !== nextField.sqlName ||
        field.type !== nextField.type ||
        (field.nullable && !nextField.nullable) ||
        (!field.required && nextField.required) ||
        JSON.stringify(field.constraints) !== JSON.stringify(nextField.constraints)
      )
        add('migration-required', fieldPath, '类型/映射/约束收紧或关系变化需要数据预检');
      else if (JSON.stringify(field) !== JSON.stringify(nextField))
        add('compatible', fieldPath, '显示、权限、默认或约束放宽变化只影响后续配置，不覆盖旧值');
    }
    for (const field of next.fields)
      if (!table.fields.some(item => item.id === field.id))
        add(
          field.required ? 'migration-required' : 'compatible',
          `${path}.fields.${field.id}`,
          field.required ? '新增必填字段须显式迁移，不能靠默认覆盖存量' : '新增可选字段；旧行保持未提供',
        );
    if (
      JSON.stringify(table.runtime) !== JSON.stringify(next.runtime) ||
      JSON.stringify(table.context) !== JSON.stringify(next.context) ||
      JSON.stringify(table.export) !== JSON.stringify(next.export) ||
      JSON.stringify(table.permissions) !== JSON.stringify(next.permissions) ||
      table.locked !== next.locked ||
      JSON.stringify(table.visibility) !== JSON.stringify(next.visibility) ||
      JSON.stringify(table.rules) !== JSON.stringify(next.rules)
    )
      add('compatible', `${path}.settings`, '配置变化需新模板版本和运行过期检查，不迁移业务值');
  }
  for (const table of after.tables)
    if (!before.tables.some(item => item.id === table.id))
      add('compatible', `tables.${table.id}`, '新增空表，不补种数据');
  if (
    JSON.stringify(before.defaults) !== JSON.stringify(after.defaults) ||
    JSON.stringify(before.phases) !== JSON.stringify(after.phases) ||
    JSON.stringify(before.hardLimits) !== JSON.stringify(after.hardLimits)
  )
    add('compatible', 'defaults', '继承/阶段/硬上限变化影响下次运行');
  if (
    before.name !== after.name ||
    before.description !== after.description ||
    JSON.stringify(before.groups) !== JSON.stringify(after.groups) ||
    before.tables.map(table => table.id).join('|') !== after.tables.map(table => table.id).join('|')
  )
    add('compatible', 'display', '显示说明/排列变化不改变稳定身份');
  if (JSON.stringify(before) !== JSON.stringify(after) && after.templateVersion <= before.templateVersion)
    add('migration-required', 'templateVersion', '任意模板变更必须递增模板版本');
  return { compatible: changes.every(change => change.kind === 'compatible'), changes };
}
