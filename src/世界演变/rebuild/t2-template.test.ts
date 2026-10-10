import assert from 'node:assert/strict';
import test from 'node:test';
import { createDefaultT2Template, createMinimalT2Template } from './t2-defaults';
import {
  cloneT2Json,
  compareT2Templates,
  describeT2FieldEncoding,
  isT2TableDue,
  normalizeT2FieldShape,
  normalizeT2Template,
  resolveT2TableSettings,
  serializeT2Template,
  T2_SYSTEM_SQL_COLUMNS,
  type T2Field,
  type T2Template,
} from './t2-template';
import { validateT2Cell } from './t2-values';

const table = (template: T2Template, id = 'npc') => template.tables.find(item => item.id === id)!;
const field = (template: T2Template, id = 'name') => table(template).fields.find(item => item.id === id)!;

test('规范模板往返独立复制，输入与示例工厂均不被校验器更改', () => {
  const input = createDefaultT2Template();
  const before = JSON.stringify(input);
  const output = normalizeT2Template(input);
  assert.deepEqual(normalizeT2Template(JSON.parse(serializeT2Template(output))), input);
  output.tables[0].fields[0].description = '只修改独立结果';
  assert.equal(JSON.stringify(input), before);
  assert.notEqual(output.tables[0], input.tables[0]);
});

test('协议版本、字段类型、隐式转换、未知配置、凭据与种子入口均严格拒绝', () => {
  const mutations: ((spec: T2Template) => void)[] = [
    spec => {
      (spec as unknown as { schemaVersion: number }).schemaVersion = 2;
    },
    spec => {
      (spec as unknown as { dataVersion: number }).dataVersion = 0;
    },
    spec => {
      spec.templateVersion = 0;
    },
    spec => {
      (field(spec) as unknown as { type: string }).type = 'sql';
    },
    spec => {
      (field(spec) as unknown as { required: string }).required = 'true';
    },
    spec => {
      Object.assign(spec, { rows: [] });
    },
    spec => {
      Object.assign(spec, { seed: [] });
    },
    spec => {
      Object.assign(table(spec).runtime, { surprise: true });
    },
    spec => {
      spec.defaults.api = {
        state: 'value',
        value: Object.assign({ presetId: 'my-api' }, { apiKey: 'not-a-real-key' }),
      };
    },
  ];
  for (const mutate of mutations) {
    const spec = createDefaultT2Template();
    mutate(spec);
    const before = JSON.stringify(spec);
    assert.throws(() => normalizeT2Template(spec));
    assert.equal(JSON.stringify(spec), before);
  }
  for (const value of [null, [], {}, 'template', undefined]) assert.throws(() => normalizeT2Template(value));
});

test('表/字段稳定身份、SQL映射、组、历法、枚举和选择列表均不得重复', () => {
  const mutations: ((spec: T2Template) => void)[] = [
    spec => {
      spec.tables[1].id = spec.tables[0].id;
    },
    spec => {
      spec.tables[1].sqlName = spec.tables[0].sqlName;
    },
    spec => {
      table(spec).fields[1].id = table(spec).fields[0].id;
    },
    spec => {
      table(spec).fields[1].sqlName = table(spec).fields[0].sqlName;
    },
    spec => {
      spec.groups[1].id = spec.groups[0].id;
    },
    spec => {
      spec.calendars.push({ ...spec.calendars[0] });
    },
    spec => {
      field(spec, 'status').constraints.enumValues!.push('活跃');
    },
    spec => {
      table(spec).context.fieldIds.push(table(spec).context.fieldIds[0]);
    },
    spec => {
      table(spec).export.fieldIds.push(table(spec).export.fieldIds[0]);
    },
    spec => {
      table(spec).export.keyFieldIds.push('name');
    },
    spec => {
      table(spec).context.relatedTableIds.push(table(spec).context.relatedTableIds[0]);
    },
    spec => {
      field(spec, 'location').constraints.reference!.tableIds.push('location');
    },
    spec => {
      spec.defaults.context.sources = ['story', 'story'];
    },
    spec => {
      spec.phases.micro.context = { state: 'value', value: { ...spec.defaults.context, sources: ['mvu', 'mvu'] } };
    },
    spec => {
      table(spec).context.settings = {
        state: 'value',
        value: { ...spec.defaults.context, sources: ['story', 'story'] },
      };
    },
  ];
  for (const mutate of mutations) {
    const spec = createDefaultT2Template();
    mutate(spec);
    assert.throws(() => normalizeT2Template(spec), /duplicate/);
  }
});

test('悬空引用表、历法、上下文字段、关系及导出标题/关键词不得通过', () => {
  const mutations: ((spec: T2Template) => void)[] = [
    spec => {
      field(spec, 'location').constraints.reference!.tableIds = ['unknown'];
    },
    spec => {
      field(spec, 'last_action_time').constraints.calendarId = 'unknown';
    },
    spec => {
      table(spec).context.fieldIds = ['unknown'];
    },
    spec => {
      table(spec).context.relatedTableIds = ['unknown'];
    },
    spec => {
      table(spec).export.fieldIds = ['unknown'];
    },
    spec => {
      table(spec).export.titleFieldId = 'unknown';
    },
    spec => {
      table(spec).export.keyFieldIds = ['unknown'];
    },
  ];
  for (const mutate of mutations) {
    const spec = createDefaultT2Template();
    mutate(spec);
    assert.throws(() => normalizeT2Template(spec), /dangling|defined calendar|unknown/);
  }
});

test('业务映射与系统列分开，SQL字符和危险身份不能混入结构', () => {
  const spec = createDefaultT2Template();
  assert.equal(T2_SYSTEM_SQL_COLUMNS.length, 9);
  assert.equal(new Set(T2_SYSTEM_SQL_COLUMNS).size, 9);
  for (const sqlName of [...T2_SYSTEM_SQL_COLUMNS, 'f_name; DROP TABLE we_npc', 'f_name"']) {
    const changed = createDefaultT2Template();
    field(changed).sqlName = sqlName;
    assert.throws(() => normalizeT2Template(changed));
  }
  for (const id of ['constructor', 'prototype', '__proto__', '中文身份', 'name space']) {
    spec.id = id;
    assert.throws(() => normalizeT2Template(spec));
  }
});

test('类型约束/控件不一致、倒置范围和伪只读写权限一律拒绝', () => {
  const mutations: ((spec: T2Template) => void)[] = [
    spec => {
      field(spec).control = 'toggle';
    },
    spec => {
      field(spec).constraints.min = 1;
    },
    spec => {
      field(spec).readonly = true;
    },
    spec => {
      field(spec, 'status').constraints = {};
    },
    spec => {
      field(spec, 'location').constraints = {};
    },
    spec => {
      field(spec, 'last_action_time').constraints = {};
    },
    spec => {
      const f = table(spec, 'society').fields.find(item => item.id === 'order')!;
      f.constraints = { min: 2, max: 1 };
    },
    spec => {
      const f = table(spec, 'society').fields.find(item => item.id === 'order')!;
      f.constraints.min = 0.1;
    },
    spec => {
      const f = table(spec, 'environment').fields.find(item => item.id === 'temperature')!;
      f.constraints.max = 1e100;
    },
    spec => {
      const f = field(spec, 'location');
      f.nullable = false;
      f.constraints.reference!.onDelete = 'clear';
    },
  ];
  for (const mutate of mutations) {
    const spec = createDefaultT2Template();
    mutate(spec);
    assert.throws(() => normalizeT2Template(spec));
  }
});

test('默认值使用与真实单元格相同的类型、长度、精度、枚举和空值边界', () => {
  const base = field(createDefaultT2Template(), 'editor_note');
  const definitions: T2Field[] = [
    { ...base, constraints: {}, defaultValue: 'x'.repeat(20_001) },
    { ...base, nullable: false, defaultValue: null },
    { ...base, type: 'number', control: 'number', constraints: {}, defaultValue: 1e100 },
    { ...base, type: 'decimal', control: 'decimal', constraints: { precision: 16, scale: 2 }, defaultValue: '1.00' },
    { ...base, type: 'decimal', control: 'decimal', constraints: { precision: 4, scale: 5 }, defaultValue: '1.00000' },
    { ...base, type: 'decimal', control: 'decimal', constraints: { precision: 3, scale: 2 }, defaultValue: '1.234' },
    { ...base, type: 'boolean', control: 'toggle', constraints: {}, defaultValue: 0 },
    { ...base, type: 'enum', control: 'select', constraints: { enumValues: ['甲'] }, defaultValue: '乙' },
    { ...base, type: 'string-list', control: 'string-list', constraints: {}, defaultValue: ['甲', '甲'] },
    { ...base, type: 'string-list', control: 'string-list', constraints: { enumValues: ['甲'] }, defaultValue: ['乙'] },
    { ...base, type: 'string-list', control: 'string-list', constraints: {}, defaultValue: ['x'.repeat(20_001)] },
    {
      ...base,
      type: 'reference',
      control: 'reference',
      constraints: { reference: { tableIds: ['npc'], onDelete: 'restrict' } },
      defaultValue: { tableId: 'npc', rowId: 'invented' },
    },
    {
      ...base,
      type: 'world-time',
      control: 'world-time',
      constraints: { calendarId: 'era' },
      defaultValue: { calendarId: 'era', ordinalMinute: 0, display: ' ' },
    },
  ];
  for (const definition of definitions) assert.throws(() => normalizeT2FieldShape(definition));
  const spec = createDefaultT2Template();
  for (const item of spec.tables)
    for (const definition of item.fields) {
      if (Object.hasOwn(definition, 'defaultValue'))
        assert.deepEqual(validateT2Cell(definition, definition.defaultValue, spec), definition.defaultValue);
    }
});

test('JSON对象上的getter/toJSON不执行，循环/非JSON/稀疏数组和危险键不接受', () => {
  let calls = 0;
  const getter = Object.defineProperty({}, 'id', {
    enumerable: true,
    get() {
      calls += 1;
      return 'evil';
    },
  });
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  for (const input of [
    getter,
    {
      toJSON() {
        calls += 1;
        return {};
      },
    },
    cyclic,
    new Date(0),
    new Map(),
    undefined,
    -0,
    NaN,
    Infinity,
    1n,
    () => {},
    Array(2),
    JSON.parse('{"__proto__":{}}'),
  ]) {
    assert.throws(() => cloneT2Json(input));
  }
  assert.equal(calls, 0);
  const symbol = { [Symbol('bad')]: true };
  assert.throws(() => cloneT2Json(symbol));
  assert.throws(() => cloneT2Json(Object.defineProperty({}, 'invisible', { value: 1 })));
  assert.deepEqual(cloneT2Json(Object.assign(Object.create(null), { valid: true })), { valid: true });
});

test('JSON入口限制深度、节点与文本资源，不在超限失败时执行内容', () => {
  let deep: unknown = null;
  for (let i = 0; i < 65; i += 1) deep = { next: deep };
  assert.throws(() => cloneT2Json(deep), /depth/);
  assert.throws(() => cloneT2Json('x'.repeat(1_000_001)), /character/);
  assert.throws(() => cloneT2Json(Array.from({ length: 100_001 }, () => null)), /size/);
  assert.throws(() => cloneT2Json({ ['k'.repeat(1001)]: true }), /key/);
});

test('精确小数的模板描述、JSON字符串与物理INTEGER保持一致', () => {
  const base = field(createDefaultT2Template());
  const decimal: T2Field = { ...base, type: 'decimal', control: 'decimal', constraints: { precision: 15, scale: 2 } };
  assert.equal(describeT2FieldEncoding(decimal).sqlite, 'INTEGER');
  assert.match(describeT2FieldEncoding(decimal).json, /string/);
  assert.match(describeT2FieldEncoding(decimal).precision, /scaled safe integer/);
  assert.equal(describeT2FieldEncoding(base).missingRule, 'presence-sidecar-not-null');
});

test('继承链以本表、阶段、全局为序，明确关闭和零预算不等于继承', () => {
  const spec = createDefaultT2Template();
  const npc = table(spec);
  assert.equal(resolveT2TableSettings(spec, 'npc').frequency.source, 'global');
  spec.phases.micro.frequency = { state: 'value', value: { unit: 'eligible-story-round', every: 4, offset: 2 } };
  assert.equal(resolveT2TableSettings(spec, 'npc').frequency.source, 'phase');
  npc.runtime.frequency = { state: 'value', value: { unit: 'eligible-story-round', every: 2, offset: 3 } };
  assert.equal(resolveT2TableSettings(spec, 'npc').frequency.value?.every, 2);
  npc.runtime.frequency = { state: 'disabled' };
  assert.equal(resolveT2TableSettings(spec, 'npc').frequency.value, null);
  npc.runtime.budget = { state: 'value', value: { maxRows: 0, maxNewRows: 0, maxRequests: 0, maxContextChars: 0 } };
  assert.equal(resolveT2TableSettings(spec, 'npc').budget.state, 'value');
  assert.equal(resolveT2TableSettings(spec, 'npc').budget.value?.maxRows, 0);
  spec.phases.micro.enabled = false;
  npc.runtime.enabled = true;
  assert.equal(resolveT2TableSettings(spec, 'npc').enabled, false);
});

test('阶段关闭的单项设置可被表级具体值覆盖，但整个阶段关闭不可绕过', () => {
  const spec = createDefaultT2Template();
  const npc = table(spec);
  spec.phases.micro.frequency = { state: 'disabled' };
  assert.equal(resolveT2TableSettings(spec, 'npc').frequency.source, 'phase');
  assert.equal(resolveT2TableSettings(spec, 'npc').frequency.state, 'disabled');
  npc.runtime.frequency = { state: 'value', value: { ...spec.defaults.frequency } };
  assert.equal(resolveT2TableSettings(spec, 'npc').frequency.state, 'value');
  spec.phases.micro.enabled = false;
  assert.equal(resolveT2TableSettings(spec, 'npc').enabled, false);
  assert.match(resolveT2TableSettings(spec, 'npc').notes.join(' '), /不能重新启用/);
});

test('API继承只解释预设身份，不读取预设或凭据；阶段和表关闭来源明确', () => {
  const spec = createDefaultT2Template();
  assert.equal(resolveT2TableSettings(spec, 'npc').api.source, 'global');
  spec.defaults.api = { state: 'value', value: { presetId: 'global-api' } };
  assert.equal(resolveT2TableSettings(spec, 'npc').api.value?.presetId, 'global-api');
  spec.phases.micro.api = { state: 'value', value: { presetId: 'micro-api' } };
  assert.equal(resolveT2TableSettings(spec, 'npc').api.value?.presetId, 'micro-api');
  table(spec).runtime.api = { state: 'value', value: { presetId: 'table-api' } };
  assert.equal(resolveT2TableSettings(spec, 'npc').api.value?.presetId, 'table-api');
  table(spec).runtime.api = { state: 'disabled' };
  assert.equal(resolveT2TableSettings(spec, 'npc').api.source, 'disabled');
  table(spec).runtime.api = { state: 'inherit' };
  spec.phases.micro.api = { state: 'disabled' };
  assert.equal(resolveT2TableSettings(spec, 'npc').api.source, 'phase');
});

test('预算解析受整轮硬上限、修改行数和上下文上限约束，不修改模板', () => {
  const spec = createDefaultT2Template();
  table(spec).runtime.budget = {
    state: 'value',
    value: { maxRows: 2, maxNewRows: 10, maxRequests: 30, maxContextChars: 1000 },
  };
  table(spec).context.settings = {
    state: 'value',
    value: { ...spec.defaults.context, maxRows: 1000, maxChars: 100_000 },
  };
  spec.hardLimits.maxRequests = 1;
  const before = JSON.stringify(spec);
  const settings = resolveT2TableSettings(spec, 'npc');
  assert.deepEqual(settings.budget.value, { maxRows: 2, maxNewRows: 2, maxRequests: 1, maxContextChars: 1000 });
  assert.equal(settings.context.value?.maxRows, spec.hardLimits.maxRows);
  assert.equal(settings.context.value?.maxChars, 1000);
  assert.match(settings.notes.join(' '), /硬上限/);
  assert.equal(JSON.stringify(spec), before);
  assert.throws(() => resolveT2TableSettings(spec, 'not-a-table'), /unknown/);
});

test('频率计数从首次合格轮开始，成功无变化计进度，失败重试不自行前进', () => {
  const frequency = { unit: 'eligible-story-round' as const, every: 3, offset: 2 };
  assert.equal(isT2TableDue(frequency, 1, null), false);
  assert.equal(isT2TableDue(frequency, 2, null), true);
  assert.equal(isT2TableDue(frequency, 7, null), true);
  assert.equal(isT2TableDue(frequency, 2, 2), false);
  assert.equal(isT2TableDue(frequency, 4, 2), false);
  assert.equal(isT2TableDue(frequency, 5, 2), true);
  assert.equal(isT2TableDue(frequency, 5, 2), true, '失败重试仍使用旧成功标记');
  assert.equal(isT2TableDue(frequency, 5, 5), false, '成功无变化也推进标记');
  assert.equal(isT2TableDue(null, 5, null), false);
  for (const [round, previous] of [
    [-1, null],
    [1.5, null],
    [2, 3],
    [3, -1],
  ] as const)
    assert.throws(() => isT2TableDue(frequency, round, previous));
  assert.throws(() => isT2TableDue({ ...frequency, every: 0 }, 3, null));
  let calls = 0;
  const evil = Object.defineProperty({ ...frequency }, 'every', {
    enumerable: true,
    get() {
      calls += 1;
      return 1;
    },
  });
  assert.throws(() => isT2TableDue(evil, 3, null));
  assert.equal(calls, 0);
});

test('显示、说明、权限、默认值变更可兼容，但仍必须递增模板版本', () => {
  const before = createDefaultT2Template();
  const after = normalizeT2Template(before);
  after.templateVersion = 2;
  table(after).name = '角色名册';
  field(after).name = '姓名全称';
  field(after, 'knowledge').defaultValue = '只用于以后新增';
  table(after).runtime.enabled = false;
  assert.equal(compareT2Templates(before, after).compatible, true);
  assert.equal(field(after).sqlName, field(before).sqlName);
  after.templateVersion = 1;
  assert.equal(compareT2Templates(before, after).compatible, false);
  assert.ok(compareT2Templates(before, after).changes.some(change => change.path === 'templateVersion'));
  assert.deepEqual(compareT2Templates(before, before), { compatible: true, changes: [] });
});

test('SQL映射、字段类型、约束收紧、历法或删除结构必须预检迁移', () => {
  const mutations: ((spec: T2Template) => void)[] = [
    spec => {
      table(spec).sqlName = 'we_other_npc';
    },
    spec => {
      table(spec).groupId = 'macro';
    },
    spec => {
      field(spec).sqlName = 'f_other_name';
    },
    spec => {
      field(spec).constraints.maxLength = 80;
    },
    spec => {
      field(spec, 'location').nullable = false;
      delete field(spec, 'location').defaultValue;
    },
    spec => {
      spec.calendars[0].minutesPerDay = 1000;
    },
    spec => {
      const index = table(spec).fields.findIndex(item => item.id === 'editor_note');
      table(spec).fields.splice(index, 1);
    },
  ];
  const before = createDefaultT2Template();
  for (const mutate of mutations) {
    const after = normalizeT2Template(before);
    after.templateVersion = 2;
    mutate(after);
    assert.equal(compareT2Templates(before, after).compatible, false);
  }
  assert.equal(compareT2Templates(before, { ...createMinimalT2Template(), templateVersion: 2 }).compatible, false);
});

test('新增可选字段不补旧值，新增必填字段必须明确迁移', () => {
  const before = createDefaultT2Template();
  const after = normalizeT2Template(before);
  after.templateVersion = 2;
  const added: T2Field = {
    ...field(after, 'knowledge'),
    id: 'custom_note',
    sqlName: 'f_custom_note',
    required: false,
    defaultValue: '新增时采用',
  };
  table(after).fields.push(added);
  assert.equal(compareT2Templates(before, after).compatible, true);
  added.required = true;
  assert.equal(compareT2Templates(before, after).compatible, false);
  assert.equal(
    table(before).fields.some(item => item.id === 'custom_note'),
    false,
  );
});
