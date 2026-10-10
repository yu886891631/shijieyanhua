/**
 * T2 值/行/物理单元格契约。仅纯 JSON 转换和校验；不执行 SQL，不访问宿主，
 * 不建立持久化身份，不保存世界，也不会调用模型或世界书。
 */
import {
  cloneT2Json,
  normalizeT2FieldShape,
  normalizeT2Template,
  resolveT2TableSettings,
  T2_COMPLEX_CELL_MAX_CHARS,
  T2_ID_PATTERN,
  type T2Cell,
  type T2Field,
  type T2Json,
  type T2Row,
  type T2Template,
  type T2Table,
  type T2WorldData,
} from './t2-template';

export type T2SqlValue = null | number | string;
/** presence 是 T3 schema 的伴随存在标记；SQL NULL 本身不能区分缺失与显式 NULL。 */
export type T2PhysicalCell = Readonly<{ present: false; value: null }> | Readonly<{ present: true; value: T2SqlValue }>;

function fail(path: string, message: string): never {
  throw new Error(`${path}: ${message}`);
}

function plainRecord(input: unknown, path: string): Record<string, T2Json> {
  const value = cloneT2Json(input);
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(path, '需要普通 JSON 对象');
  return value;
}

function exactKeys(
  value: Record<string, T2Json>,
  allowed: readonly string[],
  required: readonly string[],
  path: string,
): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`${path}.${key}`, '不支持或受保护的字段');
  for (const key of required) if (!Object.hasOwn(value, key)) fail(`${path}.${key}`, '缺少必需字段');
}

function identity(input: unknown, path: string): string {
  if (typeof input !== 'string' || !T2_ID_PATTERN.test(input) || input === 'constructor' || input === 'prototype')
    fail(path, '需要稳定小写标识符');
  return input;
}

function safeInteger(value: unknown, path: string, nonnegative = false): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || Object.is(value, -0) || (nonnegative && value < 0)) {
    fail(path, '需要可无损往返的安全整数');
  }
  return value;
}

function reference(value: T2Json, field: T2Field, path: string): { tableId: string; rowId: string } {
  const object = plainRecord(value, path);
  exactKeys(object, ['tableId', 'rowId'], ['tableId', 'rowId'], path);
  const tableId = identity(object.tableId, `${path}.tableId`);
  const rowId = identity(object.rowId, `${path}.rowId`);
  if (!field.constraints.reference?.tableIds.includes(tableId)) fail(path, '引用表不在允许的目标范围内');
  return { tableId, rowId };
}

/** 固定 scale 的规范字符串，计算采用 BigInt；最终物理整数限制在 JS 安全范围内。 */
export function encodeT2Decimal(value: unknown, field: T2Field): number {
  field = normalizeT2FieldShape(field);
  const path = `field.${field.id}`;
  const scale = field.constraints.scale;
  const precision = field.constraints.precision;
  if (
    field.type !== 'decimal' ||
    !Number.isSafeInteger(scale) ||
    !Number.isSafeInteger(precision) ||
    scale === undefined ||
    precision === undefined ||
    scale < 0 ||
    precision < 1 ||
    scale > precision ||
    precision > 15
  )
    fail(path, '小数字段的 precision/scale 无效');
  const pattern = scale === 0 ? /^-?(?:0|[1-9]\d*)$/ : new RegExp(`^-?(?:0|[1-9]\\d*)\\.\\d{${scale}}$`);
  if (typeof value !== 'string' || !pattern.test(value)) fail(path, `小数必须为固定 ${scale} 位的规范字符串`);
  const scaled = BigInt(value.replace('.', ''));
  if (scaled === 0n && value.startsWith('-')) fail(path, '不能使用负零');
  const digits = value.replace(/[-.]/g, '').replace(/^0+(?=\d)/, '').length;
  if (digits > precision) fail(path, '超过声明精度');
  if (scaled > BigInt(Number.MAX_SAFE_INTEGER) || scaled < BigInt(Number.MIN_SAFE_INTEGER))
    fail(path, '缩放后超过安全整数范围');
  return Number(scaled);
}

export function decodeT2Decimal(value: unknown, field: T2Field): string {
  field = normalizeT2FieldShape(field);
  const integer = safeInteger(value, `field.${field.id}.physical`);
  const scale = field.constraints.scale;
  if (field.type !== 'decimal' || scale === undefined || !Number.isSafeInteger(scale) || scale < 0 || scale > 15) {
    fail(`field.${field.id}`, '小数字段 scale 无效');
  }
  const sign = integer < 0 ? '-' : '';
  const digits = BigInt(integer < 0 ? -integer : integer)
    .toString()
    .padStart(scale + 1, '0');
  const result = scale === 0 ? `${sign}${digits}` : `${sign}${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
  encodeT2Decimal(result, field);
  return result;
}

/** 不转换字符串数字，不补默认值，不纠正已有数据；所有失败均保留原输入不变。 */
export function validateT2Cell(field: T2Field, input: unknown, template?: T2Template): T2Cell {
  field = normalizeT2FieldShape(field);
  const path = `field.${field.id}`;
  const value = cloneT2Json(input);
  if (value === null) {
    if (!field.nullable) fail(path, '不允许 NULL');
    return null;
  }
  const constraints = field.constraints;
  const checkNumeric = (numeric: number): void => {
    if (constraints.min !== undefined && numeric < constraints.min) fail(path, '小于字段下限');
    if (constraints.max !== undefined && numeric > constraints.max) fail(path, '大于字段上限');
  };
  const checkText = (text: unknown): string => {
    if (typeof text !== 'string') fail(path, '需要字符串');
    if (text.length > (constraints.maxLength ?? 20000)) fail(path, '文本长度超限');
    return text;
  };
  const checkList = (): T2Json[] => {
    if (!Array.isArray(value)) fail(path, '需要数组');
    if (value.length > (constraints.maxItems ?? 1000)) fail(path, '数组成员数量超限');
    return value;
  };
  const checkComplex = <T extends T2Cell>(item: T): T => {
    if (JSON.stringify(item).length > T2_COMPLEX_CELL_MAX_CHARS) fail(path, '复合值的物理 JSON 文本超限');
    return item;
  };
  switch (field.type) {
    case 'text':
      return checkText(value);
    case 'integer': {
      const integer = safeInteger(value, path);
      checkNumeric(integer);
      return integer;
    }
    case 'number': {
      if (
        typeof value !== 'number' ||
        !Number.isFinite(value) ||
        Math.abs(value) > Number.MAX_SAFE_INTEGER ||
        Object.is(value, -0)
      ) {
        fail(path, '需要有限、非负零且处于安全范围的数字');
      }
      checkNumeric(value);
      return value;
    }
    case 'decimal': {
      encodeT2Decimal(value, field);
      return value as string;
    }
    case 'boolean': {
      if (typeof value !== 'boolean') fail(path, '需要布尔值，不接受 0/1 或字符串');
      return value;
    }
    case 'enum': {
      const text = checkText(value);
      if (!constraints.enumValues?.includes(text)) fail(path, '枚举选项不在允许范围内');
      return text;
    }
    case 'string-list': {
      const strings = checkList().map(checkText);
      if (constraints.enumValues && strings.some(text => !constraints.enumValues?.includes(text)))
        fail(path, '列表成员不在允许的选项范围内');
      if (new Set(strings).size !== strings.length) fail(path, '数组成员不能重复');
      return checkComplex(strings);
    }
    case 'reference':
      return reference(value, field, path);
    case 'reference-list': {
      const refs = checkList().map((entry, index) => reference(entry, field, `${path}[${index}]`));
      if (new Set(refs.map(t2CandidateKey)).size !== refs.length) fail(path, '引用成员不能重复');
      return checkComplex(refs);
    }
    case 'world-time': {
      const object = plainRecord(value, path);
      exactKeys(object, ['calendarId', 'ordinalMinute', 'display'], ['calendarId', 'ordinalMinute', 'display'], path);
      const calendarId = identity(object.calendarId, `${path}.calendarId`);
      if (calendarId !== constraints.calendarId) fail(path, '世界时间使用了错误的纪元');
      if (template && !template.calendars.some(calendar => calendar.id === calendarId))
        fail(path, '世界时间纪元不存在');
      const ordinalMinute = safeInteger(object.ordinalMinute, `${path}.ordinalMinute`);
      const display = checkText(object.display);
      if (!display.trim()) fail(path, '世界时间必须有可读的显示文本');
      if (display.length > 160) fail(path, '世界时间显示文本最多 160 字符');
      return { calendarId, ordinalMinute, display };
    }
    default:
      return fail(path, '不支持的字段类型');
  }
}

/** 候选身份只使用稳定表/行 ID；同名不合并，分隔符也不会产生冲突。 */
export function t2CandidateKey(value: { tableId: string; rowId: string }): string {
  const candidate = plainRecord(value, 'candidate');
  exactKeys(candidate, ['tableId', 'rowId'], ['tableId', 'rowId'], 'candidate');
  return JSON.stringify([
    identity(candidate.tableId, 'candidate.tableId'),
    identity(candidate.rowId, 'candidate.rowId'),
  ]);
}

export function encodeT2Cell(field: T2Field, input: unknown, template?: T2Template): T2PhysicalCell {
  field = normalizeT2FieldShape(field);
  if (input === undefined) {
    if (field.required) fail(`field.${field.id}`, '必填字段不能缺失');
    return { present: false, value: null };
  }
  const value = validateT2Cell(field, input, template);
  if (value === null) return { present: true, value: null };
  switch (field.type) {
    case 'boolean':
      return { present: true, value: value ? 1 : 0 };
    case 'decimal':
      return { present: true, value: encodeT2Decimal(value, field) };
    case 'string-list':
    case 'reference':
    case 'reference-list':
    case 'world-time':
      return { present: true, value: JSON.stringify(value) };
    default:
      return { present: true, value: value as string | number };
  }
}

export function decodeT2Cell(field: T2Field, input: unknown, template?: T2Template): T2Cell | undefined {
  field = normalizeT2FieldShape(field);
  const cell = plainRecord(input, `field.${field.id}.physical`);
  exactKeys(cell, ['present', 'value'], ['present', 'value'], `field.${field.id}.physical`);
  if (cell.present === false) {
    if (cell.value !== null || field.required) fail(`field.${field.id}`, '缺失标记与字段约束不一致');
    return undefined;
  }
  if (cell.present !== true) fail(`field.${field.id}`, '存在标记必须为布尔值');
  if (cell.value === null) return validateT2Cell(field, null, template);
  let value: unknown = cell.value;
  switch (field.type) {
    case 'boolean':
      if (value !== 0 && value !== 1) fail(`field.${field.id}`, '布尔物理整数只能为 0 或 1');
      value = value === 1;
      break;
    case 'decimal':
      value = decodeT2Decimal(value, field);
      break;
    case 'string-list':
    case 'reference':
    case 'reference-list':
    case 'world-time':
      if (typeof value !== 'string') fail(`field.${field.id}`, '复合值的物理表示必须为 JSON 文本');
      if (value.length > T2_COMPLEX_CELL_MAX_CHARS) fail(`field.${field.id}`, '复合值的物理 JSON 文本超限');
      try {
        value = JSON.parse(value);
      } catch {
        fail(`field.${field.id}`, '物理 JSON 文本损坏');
      }
      break;
  }
  return validateT2Cell(field, value, template);
}

export function compareT2WorldTime(left: unknown, right: unknown): number {
  const one = plainRecord(left, 'world-time.left');
  const two = plainRecord(right, 'world-time.right');
  for (const item of [one, two]) {
    exactKeys(
      item,
      ['calendarId', 'ordinalMinute', 'display'],
      ['calendarId', 'ordinalMinute', 'display'],
      'world-time',
    );
    identity(item.calendarId, 'world-time.calendarId');
    safeInteger(item.ordinalMinute, 'world-time.ordinalMinute');
    if (typeof item.display !== 'string' || !item.display.trim() || item.display.length > 160)
      fail('world-time.display', '需要不超过 160 字符的显示文本');
  }
  if (one.calendarId !== two.calendarId) fail('world-time', '不能比较不同纪元；未定义跨纪元映射');
  return one.ordinalMinute === two.ordinalMinute
    ? 0
    : (one.ordinalMinute as number) < (two.ordinalMinute as number)
      ? -1
      : 1;
}

export type T2FieldControlDescriptor = Readonly<{
  fieldId: string;
  label: string;
  description: string;
  control: T2Field['control'];
  inputType: 'text' | 'number' | 'checkbox' | 'select' | 'textarea' | 'reference' | 'list' | 'world-time';
  required: boolean;
  nullable: boolean;
  readonly: boolean;
  hiddenUi: boolean;
  hasDefault: boolean;
  defaultValue?: T2Cell;
  constraintText: string;
  options?: string[];
}>;

/** 输入控件的安全文本描述；不是组件、不生成 HTML，也不表示草稿已经保存。 */
export function describeT2FieldControl(
  input: T2Field,
  options: { rowLocked?: boolean; fieldLocked?: boolean; actor?: 'manual' | 'ai' } = {},
): T2FieldControlDescriptor {
  const field = normalizeT2FieldShape(input);
  const optionValues = plainRecord(options, 'control.options');
  exactKeys(optionValues, ['rowLocked', 'fieldLocked', 'actor'], [], 'control.options');
  const actor = optionValues.actor ?? 'manual';
  if (actor !== 'manual' && actor !== 'ai') fail('control.actor', '不支持的修改者');
  for (const flag of ['rowLocked', 'fieldLocked']) {
    if (Object.hasOwn(optionValues, flag) && typeof optionValues[flag] !== 'boolean')
      fail(`control.${flag}`, '需要布尔值');
  }
  const notes = [field.required ? '必填（必须提供字段）' : '可缺失', field.nullable ? '允许 NULL' : '不允许 NULL'];
  if (field.constraints.min !== undefined) notes.push(`下限 ${field.constraints.min}`);
  if (field.constraints.max !== undefined) notes.push(`上限 ${field.constraints.max}`);
  if (field.constraints.maxLength !== undefined) notes.push(`最长 ${field.constraints.maxLength} 字符`);
  if (field.constraints.maxItems !== undefined) notes.push(`最多 ${field.constraints.maxItems} 项`);
  if (field.type === 'decimal')
    notes.push(`固定 ${field.constraints.scale} 位小数；精度 ${field.constraints.precision}；缩放整数不能超过安全范围`);
  if (field.type === 'world-time') notes.push(`纪元 ${field.constraints.calendarId}；使用自定义序分钟，不转换为公历`);
  if (field.constraints.reference)
    notes.push(
      `引用 ${field.constraints.reference.tableIds.join(' / ')}；删除策略 ${field.constraints.reference.onDelete === 'restrict' ? '阻止有引用的删除' : '明确同步清除引用'}`,
    );
  const inputType: T2FieldControlDescriptor['inputType'] =
    field.control === 'multiline'
      ? 'textarea'
      : field.type === 'text' || field.type === 'decimal'
        ? 'text'
        : field.type === 'integer' || field.type === 'number'
          ? 'number'
          : field.type === 'boolean'
            ? 'checkbox'
            : field.type === 'enum'
              ? 'select'
              : field.type === 'reference'
                ? 'reference'
                : field.type === 'world-time'
                  ? 'world-time'
                  : 'list';
  const hasDefault = Object.hasOwn(field, 'defaultValue');
  return {
    fieldId: field.id,
    label: field.name,
    description: field.description,
    control: field.control,
    inputType,
    required: field.required,
    nullable: field.nullable,
    readonly:
      field.readonly ||
      optionValues.rowLocked === true ||
      optionValues.fieldLocked === true ||
      !(actor === 'manual' ? field.permissions.manualWrite : field.permissions.aiWrite),
    hiddenUi: field.hiddenUi,
    hasDefault,
    ...(hasDefault ? { defaultValue: validateT2Cell(field, field.defaultValue) } : {}),
    constraintText: notes.join('；'),
    ...(field.type === 'enum' ? { options: [...(field.constraints.enumValues ?? [])] } : {}),
  };
}

function bool(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') fail(path, '需要布尔值');
  return value;
}

function visibility(value: unknown, path: string): T2Row['meta']['visibility'] {
  const item = plainRecord(value, path);
  exactKeys(item, ['user', 'evolutionAi', 'mainAi'], ['user', 'evolutionAi', 'mainAi'], path);
  return {
    user: bool(item.user, `${path}.user`),
    evolutionAi: bool(item.evolutionAi, `${path}.evolutionAi`),
    mainAi: bool(item.mainAi, `${path}.mainAi`),
  };
}

function normalizeRow(template: T2Template, table: T2Table, input: unknown, revision: number, path: string): T2Row {
  const row = plainRecord(input, path);
  exactKeys(row, ['meta', 'values'], ['meta', 'values'], path);
  const meta = plainRecord(row.meta, `${path}.meta`);
  const keys = [
    'id',
    'locked',
    'lockedFieldIds',
    'archived',
    'visibility',
    'source',
    'createdAtRevision',
    'updatedAtRevision',
  ];
  exactKeys(meta, keys, keys, `${path}.meta`);
  const rowId = identity(meta.id, `${path}.meta.id`);
  if (
    !Array.isArray(meta.lockedFieldIds) ||
    meta.lockedFieldIds.some(id => typeof id !== 'string' || !table.fields.some(field => field.id === id))
  )
    fail(`${path}.meta.lockedFieldIds`, '锁定字段不存在');
  const lockedFieldIds = meta.lockedFieldIds as string[];
  if (new Set(lockedFieldIds).size !== lockedFieldIds.length) fail(`${path}.meta.lockedFieldIds`, '锁定字段不能重复');
  const source = plainRecord(meta.source, `${path}.meta.source`);
  exactKeys(source, ['kind', 'detail'], ['kind', 'detail'], `${path}.meta.source`);
  if (!['manual', 'story', 'mvu', 'database', 'evolution', 'import'].includes(source.kind as string))
    fail(`${path}.meta.source.kind`, '不支持的来源种类');
  if (typeof source.detail !== 'string' || source.detail.length > 10000)
    fail(`${path}.meta.source.detail`, '来源说明需要长度受控的文本');
  const createdAtRevision = safeInteger(meta.createdAtRevision, `${path}.meta.createdAtRevision`, true);
  const updatedAtRevision = safeInteger(meta.updatedAtRevision, `${path}.meta.updatedAtRevision`, true);
  if (createdAtRevision > updatedAtRevision || updatedAtRevision > revision)
    fail(`${path}.meta`, '创建/更新版本必须处于当前数据版本内');
  const supplied = plainRecord(row.values, `${path}.values`);
  const values: Record<string, T2Cell> = {};
  for (const key of Object.keys(supplied))
    if (!table.fields.some(field => field.id === key)) fail(`${path}.values.${key}`, '字段不存在或是系统元数据');
  for (const field of table.fields) {
    if (!Object.hasOwn(supplied, field.id)) {
      if (field.required) fail(`${path}.values.${field.id}`, '缺少必填字段；恢复不会自动填入默认值');
    } else {
      try {
        values[field.id] = validateT2Cell(field, supplied[field.id], template);
      } catch (error) {
        fail(`${path}.values.${field.id}`, error instanceof Error ? error.message : '值校验失败');
      }
    }
  }
  return {
    meta: {
      id: rowId,
      locked: bool(meta.locked, `${path}.meta.locked`),
      lockedFieldIds: [...lockedFieldIds],
      archived: bool(meta.archived, `${path}.meta.archived`),
      visibility: visibility(meta.visibility, `${path}.meta.visibility`),
      source: { kind: source.kind as T2Row['meta']['source']['kind'], detail: source.detail },
      createdAtRevision,
      updatedAtRevision,
    },
    values,
  };
}

/** 全快照校验，所有表/行/引用一起检查；不补表、补种、应用default或更新来源。 */
export function normalizeT2WorldData(templateInput: T2Template, input: unknown): T2WorldData {
  const template = normalizeT2Template(templateInput);
  const data = plainRecord(input, 'world');
  const keys = [
    'format',
    'dataVersion',
    'schemaVersion',
    'worldId',
    'branchId',
    'revision',
    'templateId',
    'templateVersion',
    'tables',
  ];
  exactKeys(data, keys, keys, 'world');
  if (data.format !== 'world-evolution-data' || data.dataVersion !== 1 || data.schemaVersion !== 1)
    fail('world', '不支持的世界数据版本');
  if (data.templateId !== template.id || data.templateVersion !== template.templateVersion)
    fail('world.template', '模板身份/版本不匹配；必须明确迁移，不能猜测修复');
  const worldId = identity(data.worldId, 'world.worldId');
  const branchId = identity(data.branchId, 'world.branchId');
  const revision = safeInteger(data.revision, 'world.revision', true);
  const suppliedTables = plainRecord(data.tables, 'world.tables');
  exactKeys(
    suppliedTables,
    template.tables.map(table => table.id),
    template.tables.map(table => table.id),
    'world.tables',
  );
  let totalRows = 0;
  const tables: Record<string, T2Row[]> = {};
  for (const table of template.tables) {
    const rows = suppliedTables[table.id];
    if (!Array.isArray(rows) || rows.length > 5000)
      fail(`world.tables.${table.id}`, '记录必须是数组且每表最多 5000 行');
    totalRows += rows.length;
    if (totalRows > 10000) fail('world.tables', '总记录数超过 10000 行');
    const normalized = rows.map((row, index) =>
      normalizeRow(template, table, row, revision, `world.tables.${table.id}[${index}]`),
    );
    if (new Set(normalized.map(row => row.meta.id)).size !== normalized.length)
      fail(`world.tables.${table.id}`, '行身份重复');
    tables[table.id] = normalized;
  }
  const normalized: T2WorldData = {
    format: 'world-evolution-data',
    dataVersion: 1,
    schemaVersion: 1,
    worldId,
    branchId,
    revision,
    templateId: template.id,
    templateVersion: template.templateVersion,
    tables,
  };
  for (const table of template.tables)
    for (const row of normalized.tables[table.id])
      for (const field of table.fields) {
        const value = row.values[field.id];
        const refs =
          field.type === 'reference' && value != null
            ? [value as { tableId: string; rowId: string }]
            : field.type === 'reference-list' && value != null
              ? (value as { tableId: string; rowId: string }[])
              : [];
        for (const ref of refs)
          if (!normalized.tables[ref.tableId]?.some(target => target.meta.id === ref.rowId))
            fail(`world.tables.${table.id}.${row.meta.id}.${field.id}`, `悬空引用 ${ref.tableId}/${ref.rowId}`);
      }
  return normalized;
}

export const validateT2WorldData = normalizeT2WorldData;

/** 明确创建无seed的空草稿；不代表已经保存到当前聊天。 */
export function createT2EmptyWorld(templateInput: T2Template, worldId: string, branchId: string): T2WorldData {
  const template = normalizeT2Template(templateInput);
  return normalizeT2WorldData(template, {
    format: 'world-evolution-data',
    dataVersion: 1,
    schemaVersion: 1,
    worldId,
    branchId,
    revision: 0,
    templateId: template.id,
    templateVersion: template.templateVersion,
    tables: Object.fromEntries(template.tables.map(table => [table.id, []])),
  });
}

/** 只准备新行的业务值与受控初始元数据；已有行修改必须另走提交服务，不能调用此函数补种。 */
export function prepareT2NewRow(
  templateInput: T2Template,
  tableId: string,
  rowId: string,
  suppliedValues: unknown,
  options: { revision?: number; source?: T2Row['meta']['source']; visibility?: T2Row['meta']['visibility'] } = {},
): T2Row {
  const template = normalizeT2Template(templateInput);
  const table = template.tables.find(item => item.id === tableId);
  if (!table) fail('new-row.tableId', '表不存在');
  identity(rowId, 'new-row.rowId');
  const values = plainRecord(suppliedValues, 'new-row.values');
  for (const key of Object.keys(values))
    if (!table.fields.some(field => field.id === key)) fail(`new-row.values.${key}`, '字段不存在或是系统元数据');
  for (const field of table.fields)
    if (!Object.hasOwn(values, field.id) && Object.hasOwn(field, 'defaultValue'))
      values[field.id] = cloneT2Json(field.defaultValue);
  const settings = plainRecord(options, 'new-row.options');
  exactKeys(settings, ['revision', 'source', 'visibility'], [], 'new-row.options');
  const revision = settings.revision === undefined ? 0 : safeInteger(settings.revision, 'new-row.revision', true);
  return normalizeRow(
    template,
    table,
    {
      meta: {
        id: rowId,
        locked: false,
        lockedFieldIds: [],
        archived: false,
        visibility: settings.visibility ?? { user: true, evolutionAi: true, mainAi: true },
        source: settings.source ?? { kind: 'manual', detail: '手动准备的新行草稿' },
        createdAtRevision: revision,
        updatedAtRevision: revision,
      },
      values,
    },
    revision,
    'new-row',
  );
}

export type T2DeleteImpact = Readonly<{
  source: { tableId: string; rowId: string; fieldId: string };
  target: { tableId: string; rowId: string };
  strategy: 'restrict' | 'clear';
  requiresExplicitEdit: true;
}>;

/** 删除影响报告不修改任何值。clear 也是另一个受权限/类型/整批校验的显式修改，不是级联豁免。 */
export function findT2DeleteImpacts(
  templateInput: T2Template,
  dataInput: T2WorldData,
  target: { tableId: string; rowId: string },
): T2DeleteImpact[] {
  const template = normalizeT2Template(templateInput);
  const data = normalizeT2WorldData(template, dataInput);
  const key = t2CandidateKey(target);
  if (!data.tables[target.tableId]?.some(row => row.meta.id === target.rowId))
    fail('delete.target', '待删除记录不存在');
  const impacts: T2DeleteImpact[] = [];
  for (const table of template.tables)
    for (const row of data.tables[table.id])
      for (const field of table.fields) {
        const value = row.values[field.id];
        const refs =
          field.type === 'reference' && value != null
            ? [value as { tableId: string; rowId: string }]
            : field.type === 'reference-list' && value != null
              ? (value as { tableId: string; rowId: string }[])
              : [];
        if (refs.some(ref => t2CandidateKey(ref) === key))
          impacts.push({
            source: { tableId: table.id, rowId: row.meta.id, fieldId: field.id },
            target: { ...target },
            strategy: field.constraints.reference?.onDelete ?? 'restrict',
            requiresExplicitEdit: true,
          });
      }
  return impacts;
}

export type T2ReadAudience = 'user' | 'evolutionAi' | 'mainAi';

/** UI隐藏与归档不会自动改变可读性；调用方必须再应用候选/归档选择规则。 */
export function canReadT2Field(
  tableInput: T2Table,
  rowInput: T2Row,
  fieldId: string,
  audience: T2ReadAudience,
): boolean {
  const table = cloneT2Json(tableInput) as unknown as T2Table;
  const row = cloneT2Json(rowInput) as unknown as T2Row;
  if (!['user', 'evolutionAi', 'mainAi'].includes(audience)) fail('read.audience', '未知读取者');
  const field = table.fields.find(item => item.id === fieldId);
  if (!field) fail('read.fieldId', '字段不存在');
  return (
    table.visibility[audience] === true && row.meta.visibility[audience] === true && field.visibility[audience] === true
  );
}

export type T2WriteRequest = Readonly<{
  actor: 'manual' | 'ai';
  operation: 'insert' | 'update' | 'archive' | 'delete';
  tableId: string;
  rowId?: string;
  fieldIds: readonly string[];
  stage?: 'macro' | 'micro';
}>;
export type T2WritePolicy = Readonly<{ allowed: boolean; reasons: readonly string[] }>;

/** 仅权限意图检查；不授权SQL读取、不执行修改、不替代类型/引用/版本/预算及T4提交校验。 */
export function evaluateT2Write(
  templateInput: T2Template,
  dataInput: T2WorldData,
  requestInput: T2WriteRequest,
): T2WritePolicy {
  const template = normalizeT2Template(templateInput);
  const data = normalizeT2WorldData(template, dataInput);
  const request = plainRecord(requestInput, 'write.request');
  exactKeys(
    request,
    ['actor', 'operation', 'tableId', 'rowId', 'fieldIds', 'stage'],
    ['actor', 'operation', 'tableId', 'fieldIds'],
    'write.request',
  );
  if (request.actor !== 'manual' && request.actor !== 'ai') fail('write.actor', '未知修改者');
  if (!['insert', 'update', 'archive', 'delete'].includes(request.operation as string))
    fail('write.operation', '未知写操作');
  if (
    !Array.isArray(request.fieldIds) ||
    request.fieldIds.some(id => typeof id !== 'string') ||
    new Set(request.fieldIds).size !== request.fieldIds.length
  )
    fail('write.fieldIds', '字段列表无效或重复');
  identity(request.tableId, 'write.tableId');
  if (request.rowId !== undefined) identity(request.rowId, 'write.rowId');
  const table = template.tables.find(item => item.id === request.tableId);
  if (!table) fail('write.tableId', '表不存在');
  const operation = request.operation as T2WriteRequest['operation'];
  const row =
    request.rowId === undefined ? undefined : data.tables[table.id].find(item => item.meta.id === request.rowId);
  const reasons: string[] = [];
  if (table.locked) reasons.push('表已锁定；需独立解除锁定，不能借业务写入更改锁字段');
  if (!table.permissions[request.actor === 'manual' ? 'manual' : 'ai'][operation])
    reasons.push('表不允许该修改者执行此操作');
  if (operation !== 'insert' && !row) reasons.push('待修改记录不存在');
  if (operation === 'insert' && request.rowId !== undefined && row) reasons.push('新增行身份已存在');
  if (row?.meta.locked) reasons.push('行已锁定；普通业务写入不能同时解除锁定');
  if (request.actor === 'ai') {
    const settings = resolveT2TableSettings(template, table.id);
    if (!settings.enabled || settings.frequency.state === 'disabled')
      reasons.push('表或所属阶段的自动更新已关闭；读取权限仍独立保留');
    if (request.stage !== table.groupId) reasons.push('AI写入不属于当前宏观/微观阶段');
    if (row?.meta.archived) reasons.push('AI不能改变或自动复活已归档对象');
  } else if (request.stage !== undefined && request.stage !== 'macro' && request.stage !== 'micro')
    fail('write.stage', '未知阶段');
  if (row && (operation === 'archive' || operation === 'delete') && row.meta.lockedFieldIds.length)
    reasons.push('包含锁定字段的行不能绕过锁定而归档或删除');
  for (const fieldId of request.fieldIds as string[]) {
    const field = table.fields.find(item => item.id === fieldId);
    if (!field) {
      reasons.push(`字段 ${fieldId} 不存在或属于系统元数据`);
      continue;
    }
    if (field.readonly || !field.permissions[request.actor === 'manual' ? 'manualWrite' : 'aiWrite'])
      reasons.push(`字段 ${fieldId} 对该修改者只读`);
    if (row?.meta.lockedFieldIds.includes(fieldId)) reasons.push(`字段 ${fieldId} 已锁定`);
  }
  return { allowed: reasons.length === 0, reasons };
}
