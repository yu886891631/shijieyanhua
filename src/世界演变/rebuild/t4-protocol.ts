/** T4 isolated archive protocol. Hashes detect corruption, not signatures or host CAS. */
import { z } from 'zod';
import {
  cloneT2Json,
  describeT2FieldEncoding,
  normalizeT2Template,
  T2_ID_PATTERN,
  T2_SYSTEM_SQL_COLUMNS,
  type T2Json,
  type T2Row,
  type T2Template,
  type T2WorldData,
} from './t2-template';
import { normalizeT2WorldData } from './t2-values';
import type { T3Limits, T3Policy } from './t3-engine';
import { countT3Parameters, parseT3Sql } from './t3-sql';
import { applyT5Controls, t5ControlsSchema, type T5Control } from './t5-controls';
import { normalizeT9Ledger, t9LedgerSchema, type T9Ledger } from './t9-ledger';
import { t13EvidenceSchema, type T13Evidence } from './t13-evidence';

export interface T4Scope {
  mode: 't4-sandbox' | 't10-host';
  chatId: string;
  worldId: string;
  branchId: string;
}
export interface T4State {
  template: T2Template;
  data: T2WorldData;
}
export interface T4Anchor {
  chatId: string;
  messageId: string;
  swipeId: string;
  inputFingerprint: string;
}
export interface T4Context {
  inputFingerprint: string;
  promptFingerprint: string;
  modelFingerprint: string;
  parametersFingerprint: string;
}
export interface T4Step {
  batchId: string;
  sql: string;
  parameters: T2Json[];
  policy: T3Policy;
  limits?: Partial<T3Limits>;
  beforeFingerprint: string;
  afterFingerprint: string;
}
export interface T4Change {
  tableId: string;
  rowId: string;
  kind: 'insert' | 'update' | 'delete';
}
export interface T4Commit {
  format: 'world-evolution-commit';
  version: 1;
  scope: T4Scope;
  runId: string;
  commitId: string;
  parentCommitId: string | null;
  seq: number;
  baseRevision: number;
  kind: 'manual' | 'model' | 'migration' | 'restore';
  sourceCommitId: string | null;
  anchor: T4Anchor;
  context: T4Context;
  beforeStateFingerprint: string;
  afterStateFingerprint: string;
  templateFingerprint: string;
  schemaFingerprint: string;
  steps: T4Step[];
  /** Optional T5 manual-only controls; absent in older sealed commits. Not mixed with SQL. */
  controls?: T5Control[];
  /** Optional model-only bookkeeping; absent in T4–T8 archives. Never credentials. */
  evolution?: T9Ledger;
  /** T13 explicitly confirmed import/clear provenance, covered by this commit's hash. */
  transfer?: T13Evidence;
  changes: T4Change[];
  snapshot: {
    throughCommitId: string;
    throughSeq: number;
    beforeFingerprint: string;
    afterFingerprint: string;
    state: T4State;
  };
  fingerprint: string;
}
export type T4Origin =
  | { kind: 'new' }
  | {
      kind: 'copy' | 'branch';
      sourceScope: T4Scope;
      sourceCommitId: string | null;
      sourceSeq: number;
      sourceStateFingerprint: string;
      anchorMapping: { source: T4Anchor; target: T4Anchor }[];
      /** Immutable, bounded prefix only; never a shared mutable source head. */
      sourceHistory: T4Archive;
    };
export interface T4Archive {
  format: 'world-evolution-archive';
  version: 1;
  scope: T4Scope;
  origin: T4Origin;
  genesis: T4State;
  genesisFingerprint: string;
  commits: T4Commit[];
}

export const T4_MAX_COMMITS = 32;
export const T4_MAX_STEPS = 64;
export class T4ProtocolError extends Error {
  constructor(
    readonly code: 'INPUT' | 'INTEGRITY' | 'SCOPE' | 'CHAIN' | 'CRYPTO',
    message: string,
  ) {
    super(message);
    this.name = 'T4ProtocolError';
  }
}
const ID = z
  .string()
  .regex(T2_ID_PATTERN)
  .refine(value => !['constructor', 'prototype'].includes(value));
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const integer = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const scopeSchema = z.strictObject({
  mode: z.enum(['t4-sandbox', 't10-host']),
  chatId: ID.refine(value => value.startsWith('sandbox-') || value.startsWith('chat-')),
  worldId: ID,
  branchId: ID,
});
const anchorSchema = z.strictObject({
  chatId: scopeSchema.shape.chatId,
  messageId: ID,
  swipeId: ID,
  inputFingerprint: hash,
});
const contextSchema = z.strictObject({
  inputFingerprint: hash,
  promptFingerprint: hash,
  modelFingerprint: hash,
  parametersFingerprint: hash,
});
const stateSchema = z.strictObject({ template: z.unknown(), data: z.unknown() });
const grantSchema = z.strictObject({ tableId: ID, rowIds: z.array(ID).max(5000), fieldIds: z.array(ID).max(256) });
const policySchema = z.strictObject({
  actor: z.enum(['manual', 'ai']),
  stage: z.enum(['macro', 'micro']).nullable(),
  read: z.array(grantSchema).max(256),
  write: z.array(grantSchema).max(256),
  insertTableIds: z.array(ID).max(256),
});
const limitsSchema = z.strictObject({
  maxStatements: integer.min(1).max(32).optional(),
  maxAffectedRows: integer.max(10000).optional(),
  maxNewRows: integer.max(1000).optional(),
  maxQueryRows: integer.max(100).optional(),
  maxResultChars: integer.min(1).max(1000000).optional(),
});
const stepSchema = z.strictObject({
  batchId: z
    .string()
    .regex(/^[a-z][a-z0-9_-]{0,31}$/)
    .refine(value => !['constructor', 'prototype'].includes(value)),
  sql: z.string().min(1).max(20000),
  parameters: z.array(z.unknown()).max(8192),
  policy: policySchema,
  limits: limitsSchema.optional(),
  beforeFingerprint: hash,
  afterFingerprint: hash,
});
const changeSchema = z.strictObject({ tableId: ID, rowId: ID, kind: z.enum(['insert', 'update', 'delete']) });
const commitSchema = z.strictObject({
  format: z.literal('world-evolution-commit'),
  version: z.literal(1),
  scope: scopeSchema,
  runId: ID,
  commitId: ID,
  parentCommitId: ID.nullable(),
  seq: integer.min(1),
  baseRevision: integer,
  kind: z.enum(['manual', 'model', 'migration', 'restore']),
  sourceCommitId: ID.nullable(),
  anchor: anchorSchema,
  context: contextSchema,
  beforeStateFingerprint: hash,
  afterStateFingerprint: hash,
  templateFingerprint: hash,
  schemaFingerprint: hash,
  steps: z.array(stepSchema).max(T4_MAX_STEPS),
  controls: t5ControlsSchema.optional(),
  evolution: t9LedgerSchema.optional(),
  transfer: t13EvidenceSchema.optional(),
  changes: z.array(changeSchema).max(10000),
  snapshot: z.strictObject({
    throughCommitId: ID,
    throughSeq: integer.min(1),
    beforeFingerprint: hash,
    afterFingerprint: hash,
    state: stateSchema,
  }),
  fingerprint: hash,
});
const inheritedOriginSchema = z.strictObject({
  kind: z.enum(['copy', 'branch']),
  sourceScope: scopeSchema,
  sourceCommitId: ID.nullable(),
  sourceSeq: integer,
  sourceStateFingerprint: hash,
  anchorMapping: z.array(z.strictObject({ source: anchorSchema, target: anchorSchema })).max(1000),
  sourceHistory: z.unknown(),
});
const originSchema = z.union([z.strictObject({ kind: z.literal('new') }), inheritedOriginSchema]);
const archiveSchema = z.strictObject({
  format: z.literal('world-evolution-archive'),
  version: z.literal(1),
  scope: scopeSchema,
  origin: originSchema,
  genesis: stateSchema,
  genesisFingerprint: hash,
  commits: z.array(z.unknown()).max(T4_MAX_COMMITS),
});
function requireProtocol(condition: unknown, code: T4ProtocolError['code'], message: string): asserts condition {
  if (!condition) throw new T4ProtocolError(code, message);
}
function exactUnique(values: readonly string[], message: string): void {
  requireProtocol(new Set(values).size === values.length, 'INPUT', message);
}
function same(left: unknown, right: unknown): boolean {
  return canonicalT4Json(left) === canonicalT4Json(right);
}
function parse<T>(operation: () => T): T {
  try {
    return operation();
  } catch (error) {
    if (error instanceof T4ProtocolError) throw error;
    throw new T4ProtocolError('INPUT', 'T4 数据不是受支持的有限、纯 JSON 协议。');
  }
}

/** Safe canonical JSON: key order is irrelevant; arrays, missing keys and explicit null remain distinct. */
export function canonicalT4Json(input: unknown): string {
  const value = parse(() => cloneT2Json(input));
  function encode(item: T2Json): string {
    if (item === null || typeof item !== 'object') return JSON.stringify(item);
    if (Array.isArray(item)) return `[${item.map(encode).join(',')}]`;
    return `{${Object.keys(item)
      .sort()
      .map(key => `${JSON.stringify(key)}:${encode(item[key])}`)
      .join(',')}}`;
  }
  return encode(value);
}
/** Browser WebCrypto only. No Node crypto fallback or network hash provider. */
export async function fingerprintT4(input: unknown): Promise<string> {
  const frozen = canonicalT4Json(input);
  requireProtocol(
    typeof globalThis.crypto?.subtle?.digest === 'function',
    'CRYPTO',
    '当前运行环境缺少 SHA-256 校验能力。',
  );
  try {
    const bytes = new TextEncoder().encode(frozen);
    const result = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(result), value => value.toString(16).padStart(2, '0')).join('');
  } catch {
    throw new T4ProtocolError('CRYPTO', 'SHA-256 校验失败；不能绕过指纹确认。');
  }
}
export function normalizeT4Scope(input: unknown): T4Scope {
  return parse(() => {
    const scope = scopeSchema.parse(cloneT2Json(input));
    requireProtocol(
      scope.chatId.startsWith(scope.mode === 't4-sandbox' ? 'sandbox-' : 'chat-'),
      'SCOPE',
      '存档模式与聊天身份不匹配。',
    );
    return scope;
  });
}
export function normalizeT4Anchor(input: unknown): T4Anchor {
  return parse(() => anchorSchema.parse(cloneT2Json(input)));
}
export function normalizeT4Context(input: unknown): T4Context {
  return parse(() => contextSchema.parse(cloneT2Json(input)));
}
export function normalizeT4State(input: unknown): T4State {
  return parse(() => {
    const shape = stateSchema.parse(cloneT2Json(input));
    const template = normalizeT2Template(shape.template);
    return { template, data: normalizeT2WorldData(template, shape.data) };
  });
}
function assertStateScope(state: T4State, scope: T4Scope): void {
  requireProtocol(
    state.data.worldId === scope.worldId && state.data.branchId === scope.branchId,
    'SCOPE',
    '存档世界或分支身份不匹配。',
  );
}
function rowContent(row: T2Row): unknown {
  const { createdAtRevision: _created, updatedAtRevision: _updated, ...meta } = row.meta;
  return { meta, values: row.values };
}
/** Stable identities determine changes. Revision stamps are bookkeeping, not business edits. */
export function diffT4States(baseInput: T4State, afterInput: T4State): T4Change[] {
  const base = normalizeT4State(baseInput),
    after = normalizeT4State(afterInput);
  requireProtocol(
    base.data.worldId === after.data.worldId && base.data.branchId === after.data.branchId,
    'SCOPE',
    '不能跨世界比较可变草稿。',
  );
  const changes: T4Change[] = [];
  for (const tableId of [...new Set([...Object.keys(base.data.tables), ...Object.keys(after.data.tables)])].sort()) {
    const previous = new Map((base.data.tables[tableId] ?? []).map(row => [row.meta.id, row]));
    const next = new Map((after.data.tables[tableId] ?? []).map(row => [row.meta.id, row]));
    for (const rowId of [...new Set([...previous.keys(), ...next.keys()])].sort()) {
      const one = previous.get(rowId),
        two = next.get(rowId);
      if (!one) changes.push({ tableId, rowId, kind: 'insert' });
      else if (!two) changes.push({ tableId, rowId, kind: 'delete' });
      else if (!same(rowContent(one), rowContent(two))) changes.push({ tableId, rowId, kind: 'update' });
    }
  }
  return changes;
}
/** One whole submission advances one data revision, even for a successful no-change run. */
export function stampT4State(baseInput: T4State, draftInput: T4State): T4State {
  const base = normalizeT4State(baseInput),
    draft = normalizeT4State(draftInput);
  requireProtocol(
    base.data.worldId === draft.data.worldId && base.data.branchId === draft.data.branchId,
    'SCOPE',
    '草稿不能更改世界或分支身份。',
  );
  requireProtocol(
    draft.data.revision === base.data.revision && base.data.revision < Number.MAX_SAFE_INTEGER,
    'CHAIN',
    '草稿基准版本不匹配或已达到版本上限。',
  );
  const changes = new Set(diffT4States(base, draft).map(change => `${change.tableId}/${change.rowId}`));
  draft.data.revision = base.data.revision + 1;
  for (const [tableId, rows] of Object.entries(draft.data.tables)) {
    const previous = new Map((base.data.tables[tableId] ?? []).map(row => [row.meta.id, row]));
    for (const row of rows) {
      const old = previous.get(row.meta.id);
      row.meta.createdAtRevision = old?.meta.createdAtRevision ?? draft.data.revision;
      row.meta.updatedAtRevision =
        !old || changes.has(`${tableId}/${row.meta.id}`) ? draft.data.revision : old.meta.updatedAtRevision;
    }
  }
  return normalizeT4State(draft);
}
/** The immutable template hash includes UI/rules/permissions; physical schema excludes display-only labels. */
export async function fingerprintT4Template(input: T2Template): Promise<string> {
  return fingerprintT4(normalizeT2Template(input));
}
export async function fingerprintT4Schema(input: T2Template): Promise<string> {
  const template = normalizeT2Template(input);
  return fingerprintT4({
    format: 'world-evolution-sql-schema',
    version: 1,
    metadata: [...T2_SYSTEM_SQL_COLUMNS],
    calendars: template.calendars
      .map(({ id, epoch, minutesPerDay }) => ({ id, epoch, minutesPerDay }))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    tables: template.tables
      .map(table => ({
        id: table.id,
        sqlName: table.sqlName,
        fields: table.fields.map(field => ({
          id: field.id,
          sqlName: field.sqlName,
          type: field.type,
          nullable: field.nullable,
          required: field.required,
          constraints: field.constraints,
          sqlite: describeT2FieldEncoding(field).sqlite,
        })),
      }))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  });
}
/** Only structural SQL validation; actual replay permissions and intermediate data belong to the runner. */
export function normalizeT4Step(input: unknown, templateInput?: T2Template): T4Step {
  return parse(() => {
    const result = stepSchema.parse(cloneT2Json(input)) as T4Step;
    const statements = parseT3Sql(result.sql);
    requireProtocol(
      countT3Parameters(statements) === result.parameters.length,
      'INPUT',
      '固定 SQL 日志的参数数量不匹配。',
    );
    requireProtocol(
      result.policy.actor === 'manual' ? result.policy.stage === null : result.policy.stage !== null,
      'INPUT',
      '固定 SQL 的修改者与阶段不匹配。',
    );
    for (const direction of ['read', 'write'] as const) {
      exactUnique(
        result.policy[direction].map(grant => grant.tableId),
        'SQL 日志包含重复表授权。',
      );
      for (const grant of result.policy[direction]) {
        exactUnique(grant.rowIds, 'SQL 日志包含重复行授权。');
        exactUnique(grant.fieldIds, 'SQL 日志包含重复字段授权。');
      }
    }
    exactUnique(result.policy.insertTableIds, 'SQL 日志包含重复新增表授权。');
    if (templateInput) {
      const template = normalizeT2Template(templateInput);
      for (const direction of ['read', 'write'] as const)
        for (const grant of result.policy[direction]) {
          const table = template.tables.find(item => item.id === grant.tableId);
          requireProtocol(
            table && grant.fieldIds.every(id => table.fields.some(field => field.id === id)),
            'INPUT',
            '固定授权包含未知表或字段。',
          );
        }
      requireProtocol(
        result.policy.insertTableIds.every(id => template.tables.some(table => table.id === id)),
        'INPUT',
        '固定新增授权包含未知表。',
      );
      for (const statement of statements) {
        const table = template.tables.find(item => item.sqlName === statement.table);
        requireProtocol(table, 'INPUT', '固定 SQL 包含模板之外的表。');
        const columns =
          statement.kind === 'delete'
            ? []
            : statement.kind === 'update'
              ? statement.assignments.map(item => item.column)
              : statement.columns;
        requireProtocol(
          columns.every(
            column =>
              table.fields.some(field => field.sqlName === column) ||
              (statement.kind === 'select' && column === '__we_row_id'),
          ),
          'INPUT',
          '固定 SQL 包含受保护或未声明的字段。',
        );
      }
    }
    return result;
  });
}
export function normalizeT4Origin(input: unknown, scopeInput: T4Scope): T4Origin {
  return parse(() => {
    const origin = originSchema.parse(cloneT2Json(input)) as T4Origin;
    const scope = normalizeT4Scope(scopeInput);
    if (origin.kind === 'new') return origin;
    requireProtocol(
      normalizeT4Scope(origin.sourceScope).mode === scope.mode,
      'SCOPE',
      '来源与目标必须使用同一存档模式。',
    );
    requireProtocol(
      origin.sourceCommitId === null ? origin.sourceSeq === 0 : origin.sourceSeq > 0,
      'CHAIN',
      '来源提交与来源序号不匹配。',
    );
    requireProtocol(origin.sourceScope.branchId !== scope.branchId, 'SCOPE', '副本或分支不能共享可变分支身份。');
    requireProtocol(
      origin.kind === 'copy'
        ? origin.sourceScope.worldId !== scope.worldId
        : origin.sourceScope.worldId === scope.worldId,
      'SCOPE',
      '独立复制需新世界，同世界分支需保留世界身份。',
    );
    const sourceKeys: string[] = [],
      targetKeys: string[] = [];
    for (const mapping of origin.anchorMapping) {
      requireProtocol(
        mapping.source.chatId === origin.sourceScope.chatId &&
          mapping.target.chatId === scope.chatId &&
          mapping.source.inputFingerprint === mapping.target.inputFingerprint,
        'SCOPE',
        '复制消息锚点的聊天身份或输入指纹不匹配。',
      );
      sourceKeys.push(`${mapping.source.messageId}/${mapping.source.swipeId}`);
      targetKeys.push(`${mapping.target.messageId}/${mapping.target.swipeId}`);
    }
    exactUnique(sourceKeys, '来源消息锚点重复。');
    exactUnique(targetKeys, '目标消息锚点重复。');
    return origin;
  });
}
export async function createT4Archive(
  scopeInput: T4Scope,
  stateInput: T4State,
  originInput: T4Origin = { kind: 'new' },
): Promise<T4Archive> {
  const scope = normalizeT4Scope(scopeInput),
    genesis = normalizeT4State(stateInput);
  assertStateScope(genesis, scope);
  const origin = normalizeT4Origin(originInput, scope);
  return validateT4Archive({
    format: 'world-evolution-archive',
    version: 1,
    scope,
    origin,
    genesis,
    genesisFingerprint: await fingerprintT4(genesis),
    commits: [],
  });
}
/** Freeze before the first await; caller mutation cannot change the sealed payload. */
export async function sealT4Commit(input: Omit<T4Commit, 'fingerprint'>): Promise<T4Commit> {
  const value = parse(() => commitSchema.omit({ fingerprint: true }).parse(cloneT2Json(input)));
  return { ...value, fingerprint: await fingerprintT4(value) } as T4Commit;
}
function privateStateFromSnapshot(base: T4State, snapshot: T4State): T4State {
  const privateState = normalizeT4State(snapshot);
  privateState.data.revision = base.data.revision;
  for (const [tableId, rows] of Object.entries(privateState.data.tables)) {
    const previous = new Map((base.data.tables[tableId] ?? []).map(row => [row.meta.id, row]));
    for (const row of rows) {
      const old = previous.get(row.meta.id);
      row.meta.createdAtRevision = old?.meta.createdAtRevision ?? base.data.revision;
      row.meta.updatedAtRevision = old?.meta.updatedAtRevision ?? base.data.revision;
    }
  }
  return normalizeT4State(privateState);
}
/** Validate a full checkpoint without executing included SQL, invoking a model, or using the current template. */
export async function validateT4Commit(
  input: unknown,
  baseInput: T4State,
  scopeInput: T4Scope,
  parentCommitId: string | null,
  seq: number,
): Promise<T4Commit> {
  const value = parse(() => commitSchema.parse(cloneT2Json(input))) as T4Commit;
  const base = normalizeT4State(baseInput),
    scope = normalizeT4Scope(scopeInput);
  assertStateScope(base, scope);
  requireProtocol(same(value.scope, scope), 'SCOPE', '提交范围不匹配。');
  requireProtocol(
    value.seq === seq &&
      value.parentCommitId === parentCommitId &&
      value.commitId !== parentCommitId &&
      value.baseRevision === base.data.revision,
    'CHAIN',
    '提交父节点、序号或基准版本不连续。',
  );
  requireProtocol(
    value.anchor.chatId === scope.chatId && value.anchor.inputFingerprint === value.context.inputFingerprint,
    'SCOPE',
    '提交缺少匹配的本聊天消息锚点。',
  );
  const { fingerprint, ...unsigned } = value;
  requireProtocol((await fingerprintT4(unsigned)) === fingerprint, 'INTEGRITY', '提交内容指纹损坏。');
  const after = normalizeT4State(value.snapshot.state);
  assertStateScope(after, scope);
  requireProtocol(
    base.data.revision < Number.MAX_SAFE_INTEGER && after.data.revision === base.data.revision + 1,
    'CHAIN',
    '一次提交必须恰好推进一个版本。',
  );
  const beforeHash = await fingerprintT4(base),
    afterHash = await fingerprintT4(after);
  requireProtocol(
    value.beforeStateFingerprint === beforeHash && value.afterStateFingerprint === afterHash,
    'INTEGRITY',
    '提交前后状态指纹不匹配。',
  );
  requireProtocol(
    value.snapshot.throughCommitId === value.commitId &&
      value.snapshot.throughSeq === value.seq &&
      value.snapshot.beforeFingerprint === beforeHash &&
      value.snapshot.afterFingerprint === afterHash,
    'CHAIN',
    '快照截止位置与提交不匹配；不能重复应用其 SQL。',
  );
  requireProtocol(
    value.templateFingerprint === (await fingerprintT4Template(after.template)) &&
      value.schemaFingerprint === (await fingerprintT4Schema(after.template)),
    'INTEGRITY',
    '提交模板或物理结构指纹不匹配。',
  );
  requireProtocol(same(value.changes, diffT4States(base, after)), 'INTEGRITY', '提交变化清单与完整快照不一致。');
  // Stamps must match one whole commit; hashes alone are not enough to establish these semantics.
  const privateState = privateStateFromSnapshot(base, after);
  requireProtocol(same(stampT4State(base, privateState), after), 'CHAIN', '行创建/更新版本不符合统一提交规则。');
  const sqlKind = value.kind === 'manual' || value.kind === 'model';
  const controlled = value.controls !== undefined;
  if (value.transfer) {
    requireProtocol(
      value.kind === 'migration' && !controlled && !value.evolution,
      'INPUT',
      '导入证据只允许独立迁移提交。',
    );
    requireProtocol(
      (await fingerprintT4(value.transfer.material)) === value.transfer.materialFingerprint,
      'INTEGRITY',
      '迁移原始材料指纹损坏。',
    );
    requireProtocol(
      value.transfer.mapping.every(m => after.data.tables[m.tableId]?.some(row => row.meta.id === m.rowId)),
      'INPUT',
      '迁移来源映射与已保存行不一致。',
    );
    if (value.transfer.ledger) normalizeT9Ledger(value.transfer.ledger, after);
    if (value.transfer.action === 'clear')
      requireProtocol(
        value.transfer.ledger === null && Object.values(after.data.tables).every(rows => rows.length === 0),
        'INPUT',
        '清空必须形成空世界并重置进度。',
      );
  }
  if (value.evolution) {
    requireProtocol(value.kind === 'model' && !controlled, 'INPUT', '整轮账本只允许模型统一提交。');
    normalizeT9Ledger(value.evolution, after);
    const processed = new Set(value.evolution.processedTableIds);
    const stepTables = new Set(
      value.steps.flatMap(s => [...s.policy.write.map(g => g.tableId), ...s.policy.insertTableIds]),
    );
    requireProtocol(
      [...processed].every(id => stepTables.has(id)) && [...stepTables].every(id => processed.has(id)),
      'INPUT',
      '完成表名单与固定阶段日志不一致。',
    );
    let micro = false;
    for (const step of value.steps) {
      if (step.policy.stage === 'micro') micro = true;
      requireProtocol(!(micro && step.policy.stage === 'macro'), 'INPUT', '宏观日志不能出现在微观之后。');
    }
    if (!value.steps.length) requireProtocol(same(base, privateState), 'INPUT', '无请求整轮不能伪造业务变化。');
  }
  requireProtocol(
    !controlled || (value.kind === 'manual' && value.steps.length === 0),
    'INPUT',
    '元数据控制仅允许独立的人工提交。',
  );
  if (value.kind === 'migration') {
    requireProtocol(
      after.template.id === base.template.id && after.template.templateVersion > base.template.templateVersion,
      'CHAIN',
      '模板迁移必须保持模板身份并显式递增模板版本。',
    );
  }
  requireProtocol(
    value.kind === 'restore' || value.sourceCommitId === null,
    'INPUT',
    '只有历史恢复提交可以引用来源提交。',
  );
  requireProtocol(
    sqlKind ? controlled || value.steps.length > 0 || !!value.evolution : value.steps.length === 0,
    'INPUT',
    'SQL 提交必须带固定日志；快照迁移或恢复不得混入另一条执行路径。',
  );
  if (sqlKind) {
    requireProtocol(same(base.template, after.template), 'CHAIN', 'SQL 提交不能隐式修改模板。');
    if (controlled) {
      requireProtocol(
        same(applyT5Controls(base, value.controls), privateState),
        'INTEGRITY',
        '受控元数据与快照不一致。',
      );
      return { ...value, snapshot: { ...value.snapshot, state: after } };
    }
    exactUnique(
      value.steps.map(step => step.batchId),
      '同一提交的 SQL 批次身份重复。',
    );
    let expected = beforeHash;
    for (const stepInput of value.steps) {
      const step = normalizeT4Step(stepInput, base.template);
      requireProtocol(
        step.beforeFingerprint === expected && step.policy.actor === (value.kind === 'manual' ? 'manual' : 'ai'),
        'CHAIN',
        'SQL 日志顺序、基准指纹或修改者不匹配。',
      );
      expected = step.afterFingerprint;
    }
    requireProtocol(
      expected === (await fingerprintT4(privateState)),
      'INTEGRITY',
      '最后 SQL 草稿与正式快照的业务状态不匹配。',
    );
  }
  return { ...value, snapshot: { ...value.snapshot, state: after } };
}
// One exact-content memo only: never keyed by revision/head, never a mutable shared object.
// All CAS, current-anchor and commit permission checks still run at the gateway boundary.
let validatedArchiveMemo: { input: string; output: string } | null = null;
export async function validateT4Archive(input: unknown): Promise<T4Archive> {
  const frozen = parse(() => cloneT2Json(input));
  const identity = canonicalT4Json(frozen);
  if (typeof globalThis.crypto?.subtle?.digest !== 'function')
    throw new T4ProtocolError('CRYPTO', '无法校验存档指纹。');
  if (validatedArchiveMemo?.input === identity) return JSON.parse(validatedArchiveMemo.output) as T4Archive;
  const result = await validateT4ArchiveUncached(frozen);
  validatedArchiveMemo = { input: identity, output: JSON.stringify(result) };
  return result;
}
/** First version: bounded full JSON checkpoints, 32 commits; existing strict JSON budget still applies. */
async function validateT4ArchiveUncached(input: unknown): Promise<T4Archive> {
  const shape = parse(() => archiveSchema.parse(cloneT2Json(input)));
  const scope = normalizeT4Scope(shape.scope),
    genesis = normalizeT4State(shape.genesis);
  assertStateScope(genesis, scope);
  const origin = normalizeT4Origin(shape.origin, scope);
  if (origin.kind !== 'new') {
    const history = await validateT4Archive(origin.sourceHistory);
    const head = history.commits.at(-1),
      sourceState = head?.snapshot.state ?? history.genesis;
    requireProtocol(
      same(history.scope, origin.sourceScope) &&
        (head?.commitId ?? null) === origin.sourceCommitId &&
        history.commits.length === origin.sourceSeq,
      'CHAIN',
      '复制或分支的只读来源历史不是指定截止点的完整前缀。',
    );
    requireProtocol(
      (await fingerprintT4(sourceState)) === origin.sourceStateFingerprint,
      'INTEGRITY',
      '只读来源历史状态指纹不匹配。',
    );
    for (const dependency of history.commits) {
      requireProtocol(
        origin.anchorMapping.some(mapping => same(mapping.source, dependency.anchor)),
        'SCOPE',
        '复制或分支必须为全部历史消息依赖提供可核验的本聊天锚点映射。',
      );
    }
    const reversed = normalizeT4State(genesis);
    reversed.data.worldId = origin.sourceScope.worldId;
    reversed.data.branchId = origin.sourceScope.branchId;
    requireProtocol(same(reversed, sourceState), 'INTEGRITY', '复制或分支不能在继承初始快照时偷偷改动业务数据。');
    origin.sourceHistory = history;
  }
  requireProtocol((await fingerprintT4(genesis)) === shape.genesisFingerprint, 'INTEGRITY', '初始快照指纹损坏。');
  const commits: T4Commit[] = [];
  let base = genesis,
    parent: string | null = null;
  const identities = new Set<string>(),
    runs = new Set<string>();
  for (const [index, inputCommit] of shape.commits.entries()) {
    const commit = await validateT4Commit(inputCommit, base, scope, parent, index + 1);
    requireProtocol(!identities.has(commit.commitId), 'CHAIN', '存档包含重复提交身份。');
    requireProtocol(!runs.has(commit.runId), 'CHAIN', '存档包含重复运行身份。');
    if (commit.kind === 'restore') {
      const restored =
        commit.sourceCommitId === null
          ? genesis
          : commits.find(item => item.commitId === commit.sourceCommitId)?.snapshot.state;
      requireProtocol(restored, 'CHAIN', '恢复来源必须是本分支已有提交或初始快照。');
      const draft = normalizeT4State(restored);
      draft.data.revision = base.data.revision;
      requireProtocol(
        same(stampT4State(base, draft), commit.snapshot.state),
        'INTEGRITY',
        '恢复快照与指明的历史来源不一致。',
      );
    }
    identities.add(commit.commitId);
    runs.add(commit.runId);
    commits.push(commit);
    base = commit.snapshot.state;
    parent = commit.commitId;
  }
  return { ...shape, scope, origin, genesis, commits };
}
