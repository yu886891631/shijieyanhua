import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createCustomT2Fixture,
  createDefaultT2Fixture,
  createMinimalT2Fixture,
  createMinimalT2Template,
} from './t2-defaults';
import { normalizeT2Template, type T2Row, type T2Template, type T2WorldData } from './t2-template';
import {
  canReadT2Field,
  createT2EmptyWorld,
  evaluateT2Write,
  findT2DeleteImpacts,
  normalizeT2WorldData,
  prepareT2NewRow,
  validateT2Cell,
  type T2WriteRequest,
} from './t2-values';

const npcTable = (template: T2Template) => template.tables.find(item => item.id === 'npc')!;
const npcRow = (data: T2WorldData) => data.tables.npc[0];
const request = (overrides: Partial<T2WriteRequest> = {}): T2WriteRequest => ({
  actor: 'manual',
  operation: 'update',
  tableId: 'npc',
  rowId: 'lin-watch',
  fieldIds: ['goals'],
  ...overrides,
});

test('整库往返保留资料、版本、元数据、空值及同批引用，不修改原输入', () => {
  const { template, data } = createDefaultT2Fixture();
  const before = JSON.stringify(data);
  const normalized = normalizeT2WorldData(template, JSON.parse(before));
  assert.deepEqual(normalized, data);
  normalized.tables.npc[0].values.goals = '仅更改结果副本';
  assert.equal(JSON.stringify(data), before);
  assert.deepEqual(normalizeT2WorldData(template, data).tables.plan[1].values.result_events, [
    { tableId: 'event', rowId: 'reinforcement-finished' },
  ]);
});

test('严格拒绝未知世界/模板版本、遗漏表和额外表，不猜测恢复或补种', () => {
  const mutations: ((data: T2WorldData) => void)[] = [
    data => {
      (data as unknown as { dataVersion: number }).dataVersion = 2;
    },
    data => {
      data.templateId = 'different-template';
    },
    data => {
      data.templateVersion += 1;
    },
    data => {
      delete data.tables.npc;
    },
    data => {
      data.tables.extra = [];
    },
    data => {
      Object.assign(data, { sql: 'DROP TABLE' });
    },
    data => {
      data.revision = -1;
    },
    data => {
      data.worldId = 'constructor';
    },
  ];
  for (const mutate of mutations) {
    const { template, data } = createDefaultT2Fixture();
    mutate(data);
    const before = JSON.stringify(data);
    assert.throws(() => normalizeT2WorldData(template, data));
    assert.equal(JSON.stringify(data), before);
  }
});

test('未提供可选字段保持缺失；已提供空串/NULL/false/0/[]不被默认值覆盖', () => {
  const { template, data } = createCustomT2Fixture();
  const npc = npcTable(template);
  npc.fields.find(item => item.id === 'knowledge')!.required = false;
  delete npcRow(data).values.knowledge;
  npcRow(data).values.goals = '';
  npcRow(data).values.location = null;
  data.tables.society[0].values.order = 0;
  data.tables.market[0].values.open = false;
  data.tables.market[0].values.goods = [];
  const normalized = normalizeT2WorldData(template, data);
  assert.equal(Object.hasOwn(npcRow(normalized).values, 'knowledge'), false);
  assert.equal(npcRow(normalized).values.goals, '');
  assert.equal(npcRow(normalized).values.location, null);
  assert.equal(normalized.tables.society[0].values.order, 0);
  assert.equal(normalized.tables.market[0].values.open, false);
  assert.deepEqual(normalized.tables.market[0].values.goods, []);
});

test('已有行漏必填、类型错误或未知业务字段整库拒绝，即使字段有默认值', () => {
  for (const mutate of [
    (row: T2Row) => {
      delete row.values.goals;
    },
    (row: T2Row) => {
      row.values.goals = false;
    },
    (row: T2Row) => {
      row.values.__we_row_id = 'injected';
    },
  ]) {
    const { template, data } = createDefaultT2Fixture();
    mutate(npcRow(data));
    assert.throws(() => normalizeT2WorldData(template, data), /必填|字符串|元数据/);
  }
});

test('新行草稿只在真正缺失时采用静态默认，falsy与NULL明确保留', () => {
  const { template } = createCustomT2Fixture();
  const market = template.tables.find(item => item.id === 'market')!;
  market.fields.find(item => item.id === 'open')!.defaultValue = true;
  const defaults = prepareT2NewRow(template, 'market', 'new-market', { name: '市场' });
  assert.equal(defaults.values.open, true);
  assert.equal(defaults.values.unit_price, '0.00');
  const explicit = prepareT2NewRow(
    template,
    'market',
    'new-market',
    { name: '', open: false, goods: [], location: null, summary: '', unit_price: '0.00' },
    { revision: 7 },
  );
  assert.equal(explicit.values.name, '');
  assert.equal(explicit.values.open, false);
  assert.deepEqual(explicit.values.goods, []);
  assert.equal(explicit.values.location, null);
  assert.equal(explicit.values.summary, '');
  assert.equal(explicit.meta.createdAtRevision, 7);
  assert.equal(explicit.meta.updatedAtRevision, 7);
  assert.equal(explicit.meta.locked, false);
  assert.throws(() => prepareT2NewRow(template, 'market', 'new-market', {}), /必填/);
  assert.throws(
    () => prepareT2NewRow(template, 'market', 'new-market', { name: '市场', __we_locked: false }),
    /元数据/,
  );
});

test('新增草稿的引用仍需整批检验，草稿准备不是引用授权或保存', () => {
  const { template, data } = createDefaultT2Fixture();
  const draft = prepareT2NewRow(
    template,
    'npc',
    'new-npc',
    { name: '新角色', location: { tableId: 'location', rowId: 'missing-location' } },
    { revision: data.revision },
  );
  assert.equal(draft.meta.source.kind, 'manual');
  data.tables.npc.push(draft);
  assert.throws(() => normalizeT2WorldData(template, data), /悬空引用/);
});

test('相同表内行ID重复拒绝，不同表相同行ID不会按名称合并', () => {
  const { template, data } = createDefaultT2Fixture();
  data.tables.npc.push(JSON.parse(JSON.stringify(data.tables.npc[0])));
  assert.throws(() => normalizeT2WorldData(template, data), /行身份重复/);
  const { template: minimal, data: small } = createMinimalT2Fixture();
  small.tables.environment[0].meta.id = small.tables.npc[0].meta.id;
  assert.equal(normalizeT2WorldData(minimal, small).tables.environment[0].meta.id, small.tables.npc[0].meta.id);
});

test('悬空单引用或多引用不能通过；归档对象依然是有效的引用目标', () => {
  const { template, data } = createDefaultT2Fixture();
  assert.equal(normalizeT2WorldData(template, data).tables.plan[1].meta.archived, true);
  npcRow(data).values.location = { tableId: 'location', rowId: 'not-here' };
  assert.throws(() => normalizeT2WorldData(template, data), /悬空引用/);
  npcRow(data).values.location = null;
  npcRow(data).values.relationships = [{ tableId: 'npc', rowId: 'not-here' }];
  assert.throws(() => normalizeT2WorldData(template, data), /悬空引用/);
});

test('行元信息必须完整且受限，修订次序、锁列表和来源都不静默修复', () => {
  const mutations: ((row: T2Row) => void)[] = [
    row => {
      row.meta.createdAtRevision = 2;
    },
    row => {
      row.meta.updatedAtRevision = 2;
    },
    row => {
      row.meta.lockedFieldIds = ['missing'];
    },
    row => {
      row.meta.lockedFieldIds = ['goals', 'goals'];
    },
    row => {
      Object.assign(row.meta.source, { secret: true });
    },
    row => {
      Object.assign(row.meta, { messageIndex: 514 });
    },
    row => {
      (row.meta as unknown as { locked: number }).locked = 0;
    },
  ];
  for (const mutate of mutations) {
    const { template, data } = createDefaultT2Fixture();
    mutate(npcRow(data));
    assert.throws(() => normalizeT2WorldData(template, data));
  }
});

test('空世界只建立声明表，缺表恢复和空库采用模板是两种不同动作', () => {
  const template = createMinimalT2Template();
  const data = createT2EmptyWorld(template, 'new-world', 'main-branch');
  assert.equal(data.revision, 0);
  assert.deepEqual(data.tables, { environment: [], npc: [] });
  Reflect.deleteProperty(data.tables, 'environment');
  assert.throws(() => normalizeT2WorldData(template, data), /必需字段/);
});

test('删除影响报告分别标记restrict/clear，绝不自动删除或清引用', () => {
  const { template, data } = createDefaultT2Fixture();
  npcTable(template).fields.find(item => item.id === 'location')!.constraints.reference!.onDelete = 'clear';
  const before = JSON.stringify(data);
  const impacts = findT2DeleteImpacts(template, data, { tableId: 'location', rowId: 'north-gate' });
  assert.ok(impacts.length > 0);
  assert.ok(impacts.some(item => item.strategy === 'clear' && item.source.tableId === 'npc'));
  assert.ok(impacts.some(item => item.strategy === 'restrict'));
  assert.ok(impacts.every(item => item.requiresExplicitEdit));
  assert.equal(JSON.stringify(data), before);
  assert.throws(() => findT2DeleteImpacts(template, data, { tableId: 'location', rowId: 'no-target' }), /不存在/);
});

test('表/行/字段可见性取交集，UI隐藏、归档与读取是独立的', () => {
  const { template, data } = createDefaultT2Fixture();
  const table = npcTable(template);
  const row = npcRow(data);
  assert.equal(canReadT2Field(table, row, 'private_goal', 'evolutionAi'), true);
  assert.equal(canReadT2Field(table, row, 'private_goal', 'mainAi'), false);
  assert.equal(canReadT2Field(table, row, 'editor_note', 'user'), true);
  assert.equal(canReadT2Field(table, row, 'editor_note', 'evolutionAi'), false);
  row.meta.archived = true;
  row.meta.locked = true;
  table.runtime.enabled = false;
  assert.equal(canReadT2Field(table, row, 'goals', 'evolutionAi'), true);
  row.meta.visibility.evolutionAi = false;
  assert.equal(canReadT2Field(table, row, 'goals', 'evolutionAi'), false);
  row.meta.visibility.evolutionAi = true;
  table.visibility.evolutionAi = false;
  assert.equal(canReadT2Field(table, row, 'goals', 'evolutionAi'), false);
  assert.throws(() => canReadT2Field(table, row, 'not-a-field', 'user'), /不存在/);
});

test('人工和AI操作权限独立，AI默认无物理删除权限', () => {
  const { template, data } = createDefaultT2Fixture();
  assert.equal(evaluateT2Write(template, data, request()).allowed, true);
  assert.equal(evaluateT2Write(template, data, request({ actor: 'ai', stage: 'micro' })).allowed, true);
  assert.equal(
    evaluateT2Write(template, data, request({ actor: 'ai', stage: 'micro', operation: 'delete', fieldIds: [] }))
      .allowed,
    false,
  );
  assert.equal(evaluateT2Write(template, data, request({ operation: 'delete', fieldIds: [] })).allowed, true);
  assert.equal(evaluateT2Write(template, data, request({ actor: 'ai', stage: 'macro' })).allowed, false);
  assert.equal(
    evaluateT2Write(template, data, request({ actor: 'ai', stage: 'micro', fieldIds: ['editor_note'] })).allowed,
    false,
  );
  assert.equal(evaluateT2Write(template, data, request({ fieldIds: ['editor_note'] })).allowed, true);
});

test('表/行/字段锁均阻止相应写入，但不改变允许读取的条件', () => {
  const { template, data } = createDefaultT2Fixture();
  const table = npcTable(template);
  const row = npcRow(data);
  table.locked = true;
  assert.equal(evaluateT2Write(template, data, request()).allowed, false);
  table.locked = false;
  row.meta.locked = true;
  assert.equal(evaluateT2Write(template, data, request()).allowed, false);
  row.meta.locked = false;
  row.meta.lockedFieldIds = ['goals'];
  assert.equal(evaluateT2Write(template, data, request()).allowed, false);
  assert.equal(evaluateT2Write(template, data, request({ fieldIds: ['knowledge'] })).allowed, true);
  for (const operation of ['archive', 'delete'] as const)
    assert.equal(evaluateT2Write(template, data, request({ operation, fieldIds: [] })).allowed, false);
  assert.equal(canReadT2Field(table, row, 'goals', 'evolutionAi'), true);
});

test('readonly字段和系统元字段不能通过普通业务意图改写', () => {
  const { template, data } = createDefaultT2Fixture();
  const goals = npcTable(template).fields.find(item => item.id === 'goals')!;
  goals.readonly = true;
  goals.permissions = { manualWrite: false, aiWrite: false };
  assert.equal(evaluateT2Write(template, data, request()).allowed, false);
  assert.equal(evaluateT2Write(template, data, request({ fieldIds: ['__we_locked', 'meta'] })).allowed, false);
  assert.throws(() => evaluateT2Write(template, data, request({ fieldIds: ['goals', 'goals'] })), /重复/);
});

test('表或阶段自动更新关闭均禁止AI写，但仍允许独立的人工编辑和读取', () => {
  for (const disable of [
    (spec: T2Template) => {
      npcTable(spec).runtime.enabled = false;
    },
    (spec: T2Template) => {
      npcTable(spec).runtime.frequency = { state: 'disabled' };
    },
    (spec: T2Template) => {
      spec.phases.micro.enabled = false;
    },
    (spec: T2Template) => {
      spec.phases.micro.frequency = { state: 'disabled' };
    },
  ]) {
    const { template, data } = createDefaultT2Fixture();
    disable(template);
    const ai = evaluateT2Write(template, data, request({ actor: 'ai', stage: 'micro' }));
    assert.equal(ai.allowed, false);
    assert.match(ai.reasons.join(' '), /关闭/);
    assert.equal(evaluateT2Write(template, data, request()).allowed, true);
    assert.equal(canReadT2Field(npcTable(template), npcRow(data), 'goals', 'evolutionAi'), true);
  }
});

test('归档对象不会自动复活，重复新增和修改缺失行得到明确拒绝', () => {
  const { template, data } = createDefaultT2Fixture();
  npcRow(data).meta.archived = true;
  assert.equal(evaluateT2Write(template, data, request({ actor: 'ai', stage: 'micro' })).allowed, false);
  assert.equal(evaluateT2Write(template, data, request({ operation: 'insert' })).allowed, false);
  assert.equal(evaluateT2Write(template, data, request({ rowId: 'missing' })).allowed, false);
  assert.equal(
    evaluateT2Write(template, data, request({ rowId: 'fresh', operation: 'insert', fieldIds: ['name'] })).allowed,
    true,
  );
  assert.throws(
    () => evaluateT2Write(template, data, request({ rowId: 'constructor', operation: 'insert' })),
    /标识符/,
  );
});

test('复合值资源上限同时约束校验与编码，合法值不会到解码时才失败', () => {
  const definition = {
    ...npcTable(createDefaultT2Fixture().template).fields.find(item => item.id === 'editor_note')!,
    type: 'string-list' as const,
    control: 'string-list' as const,
    constraints: { maxLength: 30_000, maxItems: 20 },
    defaultValue: [],
  };
  assert.throws(
    () =>
      validateT2Cell(
        definition,
        Array.from({ length: 20 }, (_, i) => `${i}${'x'.repeat(20_000)}`),
      ),
    /物理 JSON 文本超限/,
  );
  const malformed = { ...definition, defaultValue: Array.from({ length: 20 }, (_, i) => `${i}${'x'.repeat(20_000)}`) };
  assert.throws(() => validateT2Cell(malformed, []), /defaultValue/);
});

test('纯模板、资料、权限和样例全过程不访问聊天、存储、API或世界书', t => {
  const names = [
    'fetch',
    'indexedDB',
    'localStorage',
    'sessionStorage',
    'window',
    'document',
    'parent',
    'TavernHelper',
    'SillyTavern',
    'Mvu',
    'generate',
    'generateRaw',
    'getVariables',
    'replaceVariables',
    'getChatMessages',
    'setChatMessages',
    'getWorldbook',
    'replaceWorldbook',
    'eventOn',
  ];
  const accessed: string[] = [];
  const originals = names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
  t.after(() => {
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  });
  for (const name of names)
    Object.defineProperty(globalThis, name, {
      configurable: true,
      get() {
        accessed.push(name);
        throw new Error(`禁止访问 ${name}`);
      },
    });
  const { template, data } = createDefaultT2Fixture();
  normalizeT2Template(template);
  normalizeT2WorldData(template, data);
  createT2EmptyWorld(template, 'empty', 'branch');
  prepareT2NewRow(template, 'npc', 'new-row', { name: '仅草稿' });
  evaluateT2Write(template, data, request());
  findT2DeleteImpacts(template, data, { tableId: 'location', rowId: 'north-gate' });
  createCustomT2Fixture();
  createMinimalT2Fixture();
  assert.deepEqual(accessed, []);
});
