/** T3 临时 SQLite 投影；JSON 是唯一持久化来源，数据库不连接任何宿主。 */
import type { Database, SqlJsStatic, SqlValue } from 'sql.js';
import {
  cloneT2Json,
  describeT2FieldEncoding,
  normalizeT2Template,
  T2_COMPLEX_CELL_MAX_CHARS,
  T2_ID_PATTERN,
  T2_SYSTEM_SQL_COLUMNS,
  type T2Field,
  type T2Row,
  type T2Table,
  type T2Template,
  type T2WorldData,
} from './t2-template';
import { decodeT2Cell, encodeT2Cell, normalizeT2WorldData } from './t2-values';

const MAX_SAFE = Number.MAX_SAFE_INTEGER;
const SYSTEM_COLUMNS = new Set<string>(T2_SYSTEM_SQL_COLUMNS);

/** sql.js绑定字符串以UTF-8/C字符串编码。拒绝截断/替换而非接受有损业务值。 */
export function assertT3SqlValue(value: unknown): asserts value is string | number | null {
  if (value === null) return;
  if (typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= MAX_SAFE && !Object.is(value, -0))
    return;
  if (typeof value === 'string') {
    if (value.includes('\u0000') || new TextDecoder().decode(new TextEncoder().encode(value)) !== value)
      throw new Error('T3 SQLite绑定拒绝NUL/孤立UTF-16代理，避免静默编码损失。');
    return;
  }
  throw new Error('T3 SQLite绑定只接受有限数值、文本或NULL，不接受BLOB/对象。');
}

/** 只接受协议中的规范物理名称；不是对任意 SQL/用户输入的“转义后授权”。 */
export function quoteT3Identifier(name: string): string {
  if (
    typeof name !== 'string' ||
    (!/^we_[a-z][a-z0-9_]{0,60}$/.test(name) && !/^f_[a-z][a-z0-9_]{0,61}$/.test(name) && !SYSTEM_COLUMNS.has(name))
  )
    throw new Error('T3 不允许未知或非规范的 SQL 标识符。');
  return `"${name}"`;
}

/** 只用于已规范化模板枚举约束。UTF-8 十六进制避免引号/NUL进入DDL。 */
function trustedTextLiteral(value: string): string {
  assertT3SqlValue(value);
  const bytes = new TextEncoder().encode(value);
  return `CAST(X'${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')}' AS TEXT)`;
}

function fieldDefinition(field: T2Field): string {
  const name = quoteT3Identifier(field.sqlName);
  const storage = describeT2FieldEncoding(field).sqlite;
  const checks: string[] = [`typeof(${name}) = '${storage === 'REAL' ? 'real' : storage.toLowerCase()}'`];
  switch (field.type) {
    case 'integer':
    case 'number':
      checks.push(`${name} BETWEEN ${-MAX_SAFE} AND ${MAX_SAFE}`);
      if (field.constraints.min !== undefined) checks.push(`${name} >= ${field.constraints.min}`);
      if (field.constraints.max !== undefined) checks.push(`${name} <= ${field.constraints.max}`);
      break;
    case 'decimal': {
      const maximum = 10 ** (field.constraints.precision as number) - 1;
      checks.push(`${name} BETWEEN ${-maximum} AND ${maximum}`);
      break;
    }
    case 'boolean':
      checks.push(`${name} IN (0, 1)`);
      break;
    case 'text':
      checks.push(`length(${name}) <= ${field.constraints.maxLength ?? 20_000}`);
      break;
    case 'enum':
      checks.push(`${name} IN (${field.constraints.enumValues!.map(trustedTextLiteral).join(', ')})`);
      break;
    case 'string-list':
    case 'reference-list':
      checks.push(`length(${name}) <= ${T2_COMPLEX_CELL_MAX_CHARS}`, `json_valid(${name}) = 1`);
      checks.push(`json_type(${name}) = 'array'`);
      checks.push(`json_array_length(${name}) <= ${field.constraints.maxItems ?? 1_000}`);
      break;
    case 'reference':
    case 'world-time':
      checks.push(`length(${name}) <= ${T2_COMPLEX_CELL_MAX_CHARS}`, `json_valid(${name}) = 1`);
      checks.push(`json_type(${name}) = 'object'`);
      break;
  }
  // 可选而非nullable字段的SQL NULL是“未提供”；presence旁路区分显式NULL。
  const notNull = field.required && !field.nullable ? ' NOT NULL' : '';
  return `${name} ${storage}${notNull} CHECK (${name} IS NULL OR (${checks.join(' AND ')}))`;
}

function tableDefinition(table: T2Table): string {
  const columns = [
    '"__we_row_id" TEXT NOT NULL PRIMARY KEY CHECK (length("__we_row_id") BETWEEN 1 AND 64 AND substr("__we_row_id", 1, 1) GLOB \'[a-z]\' AND "__we_row_id" NOT GLOB \'*[^a-z0-9_-]*\' AND "__we_row_id" NOT IN (\'constructor\', \'prototype\'))',
    '"__we_locked" INTEGER NOT NULL CHECK ("__we_locked" IN (0, 1))',
    '"__we_locked_fields" TEXT NOT NULL CHECK (json_valid("__we_locked_fields") = 1 AND json_type("__we_locked_fields") = \'array\')',
    '"__we_archived" INTEGER NOT NULL CHECK ("__we_archived" IN (0, 1))',
    '"__we_visibility" TEXT NOT NULL CHECK (json_valid("__we_visibility") = 1 AND json_type("__we_visibility") = \'object\')',
    '"__we_source" TEXT NOT NULL CHECK (json_valid("__we_source") = 1 AND json_type("__we_source") = \'object\')',
    `"__we_created_revision" INTEGER NOT NULL CHECK ("__we_created_revision" BETWEEN 0 AND ${MAX_SAFE})`,
    `"__we_updated_revision" INTEGER NOT NULL CHECK ("__we_updated_revision" BETWEEN "__we_created_revision" AND ${MAX_SAFE})`,
    '"__we_presence" TEXT NOT NULL CHECK (json_valid("__we_presence") = 1 AND json_type("__we_presence") = \'array\')',
    ...table.fields.map(fieldDefinition),
  ];
  return `CREATE TABLE ${quoteT3Identifier(table.sqlName)} (${columns.join(', ')}) STRICT`;
}

/** Trusted derived DDL for template exchange; never accepts or executes imported DDL. */
export function describeT3SchemaDdl(input: T2Template): string {
  return normalizeT2Template(input)
    .tables.map(table => `${tableDefinition(table)};`)
    .join('\n');
}

/** 用于受控新行/已校验的载入。引用完整性仍须导出时整图校验，不能当作独立提交。 */
export function insertT3Row(db: Database, tableInput: T2Table, rowInput: T2Row): void {
  const table = cloneT2Json(tableInput) as unknown as T2Table;
  const row = cloneT2Json(rowInput) as unknown as T2Row;
  if (!row || Array.isArray(row) || !row.meta || !row.values || Array.isArray(row.values))
    throw new Error('T3 新行必须包含受控元数据和业务值。');
  assertRowMetadata(table, row);
  for (const fieldId of Object.keys(row.values))
    if (!table.fields.some(field => field.id === fieldId)) throw new Error('T3 新行包含未知业务字段。');
  const physical = table.fields.map(field => encodeT2Cell(field, row.values[field.id]));
  const presence = table.fields.filter((_, index) => physical[index].present).map(field => field.id);
  const values: SqlValue[] = [
    row.meta.id,
    row.meta.locked ? 1 : 0,
    JSON.stringify(row.meta.lockedFieldIds),
    row.meta.archived ? 1 : 0,
    JSON.stringify(row.meta.visibility),
    JSON.stringify(row.meta.source),
    row.meta.createdAtRevision,
    row.meta.updatedAtRevision,
    JSON.stringify(presence),
    ...physical.map(cell => cell.value),
  ];
  values.forEach(assertT3SqlValue);
  const names = [...T2_SYSTEM_SQL_COLUMNS, ...table.fields.map(field => field.sqlName)];
  const sql = `INSERT INTO ${quoteT3Identifier(table.sqlName)} (${names.map(quoteT3Identifier).join(', ')}) VALUES (${names.map(() => '?').join(', ')})`;
  const statement = db.prepare(sql);
  try {
    statement.run(values);
  } finally {
    statement.free();
  }
}

/** 单行内部辅助防御；不涉及图引用/权限，后续完整导出仍不可省略。 */
function assertRowMetadata(table: T2Table, row: T2Row): void {
  function exact(input: unknown, keys: readonly string[]): input is Record<string, unknown> {
    return (
      input !== null &&
      typeof input === 'object' &&
      !Array.isArray(input) &&
      Object.keys(input).length === keys.length &&
      keys.every(key => Object.hasOwn(input, key))
    );
  }
  const metaKeys = [
    'id',
    'locked',
    'lockedFieldIds',
    'archived',
    'visibility',
    'source',
    'createdAtRevision',
    'updatedAtRevision',
  ];
  if (!exact(row, ['meta', 'values']) || !exact(row.meta, metaKeys))
    throw new Error('T3 新行包含未知元数据或缺少受控字段。');
  const meta = row.meta;
  if (typeof meta.id !== 'string' || !T2_ID_PATTERN.test(meta.id) || ['constructor', 'prototype'].includes(meta.id))
    throw new Error('T3 新行身份不合法。');
  if (typeof meta.locked !== 'boolean' || typeof meta.archived !== 'boolean')
    throw new Error('T3 锁定/归档元数据必须是布尔值。');
  if (
    !Array.isArray(meta.lockedFieldIds) ||
    new Set(meta.lockedFieldIds).size !== meta.lockedFieldIds.length ||
    meta.lockedFieldIds.some(id => typeof id !== 'string' || !table.fields.some(field => field.id === id))
  )
    throw new Error('T3 锁定字段元数据不合法。');
  if (
    !exact(meta.visibility, ['user', 'evolutionAi', 'mainAi']) ||
    Object.values(meta.visibility).some(value => typeof value !== 'boolean')
  )
    throw new Error('T3 可读权限元数据不合法。');
  if (
    !exact(meta.source, ['kind', 'detail']) ||
    !['manual', 'story', 'mvu', 'database', 'evolution', 'import'].includes(meta.source.kind) ||
    typeof meta.source.detail !== 'string' ||
    meta.source.detail.length > 10_000
  )
    throw new Error('T3 来源元数据不合法。');
  if (
    !Number.isSafeInteger(meta.createdAtRevision) ||
    !Number.isSafeInteger(meta.updatedAtRevision) ||
    meta.createdAtRevision < 0 ||
    meta.updatedAtRevision < meta.createdAtRevision
  )
    throw new Error('T3 修订元数据不合法。');
}

/** 不接受SQLite二进制导入；只由已校验JSON建立临时内存数据库。失败必关闭。 */
export function createT3Database(SQL: SqlJsStatic, templateInput: T2Template, dataInput: T2WorldData): Database {
  const template = normalizeT2Template(templateInput);
  const data = normalizeT2WorldData(template, dataInput);
  const db = new SQL.Database();
  try {
    db.run('PRAGMA foreign_keys = ON');
    db.run('BEGIN');
    for (const table of template.tables) db.run(tableDefinition(table));
    for (const table of template.tables) for (const row of data.tables[table.id]) insertT3Row(db, table, row);
    db.run('COMMIT');
    const recovered = exportT3World(db, template, data);
    if (JSON.stringify(recovered) !== JSON.stringify(data))
      throw new Error('T3 SQLite往返改变了JSON数据；拒绝静默编码或精度损失。');
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

/** 验证模板生成的精确DDL、列与唯一自动PK索引；没有外来表/触发器/视图/临时库。 */
export function assertT3Schema(db: Database, templateInput: T2Template): void {
  const template = normalizeT2Template(templateInput);
  const attached = db.exec('PRAGMA database_list')[0]?.values ?? [];
  // 读取sqlite_temp_schema会懒创建空temp库；允许空temp但拒绝所有临时对象和其他附加库。
  if (attached.some(row => row[1] !== 'main' && row[1] !== 'temp')) throw new Error('T3 拒绝附加SQLite库。');
  const temporary = db.exec('SELECT name FROM sqlite_temp_schema')[0]?.values ?? [];
  if (temporary.length) throw new Error('T3 拒绝临时SQLite对象。');
  const rows = db.exec('SELECT type, name, tbl_name, sql FROM main.sqlite_schema ORDER BY type, name')[0]?.values ?? [];
  const expected = new Map<string, { type: string; table: string; sql: string | null }>();
  for (const table of template.tables) {
    expected.set(table.sqlName, { type: 'table', table: table.sqlName, sql: tableDefinition(table) });
    expected.set(`sqlite_autoindex_${table.sqlName}_1`, { type: 'index', table: table.sqlName, sql: null });
  }
  if (rows.length !== expected.size) throw new Error('T3 SQLite结构包含缺失或未知对象。');
  for (const [type, name, tableName, sql] of rows) {
    const item = typeof name === 'string' ? expected.get(name) : undefined;
    if (!item || item.type !== type || item.table !== tableName || item.sql !== sql)
      throw new Error('T3 SQLite结构与规范模板DDL不一致。');
  }
  for (const table of template.tables) {
    const columns = db.exec(`PRAGMA main.table_xinfo(${quoteT3Identifier(table.sqlName)})`)[0]?.values ?? [];
    const expectedNames = [...T2_SYSTEM_SQL_COLUMNS, ...table.fields.map(field => field.sqlName)];
    if (
      columns.length !== expectedNames.length ||
      columns.some((column, index) => column[0] !== index || column[1] !== expectedNames[index] || column[6] !== 0)
    )
      throw new Error('T3 SQLite列结构与模板不一致。');
  }
}

function parseMetadata(value: SqlValue, name: string): unknown {
  if (typeof value !== 'string' || value.length > T2_COMPLEX_CELL_MAX_CHARS)
    throw new Error(`T3 ${name}元数据不是受限JSON文本。`);
  return JSON.parse(value);
}

/** 完整图导出，不补种默认值；保护元数据也走T2检查。仅在调用者事务中生成待提交JSON。 */
export function exportT3World(db: Database, templateInput: T2Template, baseIdentityInput: T2WorldData): T2WorldData {
  const template = normalizeT2Template(templateInput);
  const base = normalizeT2WorldData(template, baseIdentityInput);
  assertT3Schema(db, template);
  const result: T2WorldData = { ...base, tables: {} };
  for (const table of template.tables) {
    const names = [...T2_SYSTEM_SQL_COLUMNS, ...table.fields.map(field => field.sqlName)];
    // rowid只用于内部恢复数组插入顺序；用户SQL解析器不允许访问该隐式系统列。
    const statement = db.prepare(
      `SELECT ${names.map(quoteT3Identifier).join(', ')} FROM ${quoteT3Identifier(table.sqlName)} ORDER BY rowid ASC`,
    );
    const rows: T2Row[] = [];
    try {
      while (statement.step()) {
        const physical = statement.get();
        if (![0, 1].includes(physical[1] as number) || ![0, 1].includes(physical[3] as number))
          throw new Error('T3 锁定/归档元数据不是合法0/1。');
        const presence = parseMetadata(physical[8], '__we_presence');
        if (
          !Array.isArray(presence) ||
          presence.some(id => typeof id !== 'string' || !table.fields.some(field => field.id === id)) ||
          new Set(presence).size !== presence.length
        )
          throw new Error('T3 字段存在性旁路无效或包含未知字段。');
        const row: T2Row = {
          meta: {
            id: physical[0] as string,
            locked: physical[1] === 1,
            lockedFieldIds: parseMetadata(physical[2], '__we_locked_fields') as string[],
            archived: physical[3] === 1,
            visibility: parseMetadata(physical[4], '__we_visibility') as T2Row['meta']['visibility'],
            source: parseMetadata(physical[5], '__we_source') as T2Row['meta']['source'],
            createdAtRevision: physical[6] as number,
            updatedAtRevision: physical[7] as number,
          },
          values: {},
        };
        for (const [index, field] of table.fields.entries()) {
          const value = decodeT2Cell(
            field,
            { present: presence.includes(field.id), value: physical[index + 9] },
            template,
          );
          if (value !== undefined) row.values[field.id] = value;
        }
        rows.push(row);
      }
    } finally {
      statement.free();
    }
    result.tables[table.id] = rows;
  }
  return normalizeT2WorldData(template, result);
}
