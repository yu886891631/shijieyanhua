import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createCustomT2Fixture,
  createDefaultT2Fixture,
  createDefaultT2Template,
  createMinimalT2Fixture,
  createMinimalT2Template,
  T2_DEFAULT_TABLE_IDS,
} from './t2-defaults';
import { normalizeT2Template, resolveT2TableSettings, serializeT2Template, type T2Template } from './t2-template';
import { createT2EmptyWorld, normalizeT2WorldData, t2CandidateKey } from './t2-values';

test('default template defines three macro and four micro business tables without business rows', () => {
  const template = createDefaultT2Template();
  assert.deepEqual(
    template.tables.map(item => item.id),
    [...T2_DEFAULT_TABLE_IDS],
  );
  assert.deepEqual(
    template.tables.filter(item => item.groupId === 'macro').map(item => item.purpose),
    ['society', 'environment', 'location'],
  );
  assert.deepEqual(
    template.tables.filter(item => item.groupId === 'micro').map(item => item.purpose),
    ['npc', 'organization', 'plan', 'event'],
  );
  assert.equal(Object.hasOwn(template, 'rows'), false);
  assert.equal(Object.hasOwn(template, 'seed'), false);
  assert.equal(Object.hasOwn(template, 'data'), false);
  assert.equal(
    template.tables.every(item => item.fields.length >= 13),
    true,
  );
});

test('default and minimal templates survive JSON serialization as normative protocol objects', () => {
  for (const template of [createDefaultT2Template(), createMinimalT2Template()]) {
    assert.deepEqual(normalizeT2Template(JSON.parse(serializeT2Template(template))), template);
    assert.equal(template.schemaVersion, 1);
    assert.equal(template.dataVersion, 1);
    assert.equal(template.templateVersion, 1);
  }
});

test('each table carries useful field descriptions and all five lifecycle rules', () => {
  for (const item of createDefaultT2Template().tables) {
    assert.ok(item.description.length >= 15);
    assert.ok(item.fields.every(field => field.name.length > 0 && field.description.length >= 10));
    for (const rule of Object.values(item.rules)) assert.ok(rule.length >= 20, `${item.id}: incomplete lifecycle rule`);
    assert.equal(item.permissions.ai.delete, false);
    assert.equal(item.permissions.manual.delete, true);
    assert.ok(item.rules.delete.includes('引用'));
  }
});

test('default conditions precede micro actions and confirmed facts are not advertised as predictions', () => {
  const template = createDefaultT2Template();
  for (const item of template.tables.filter(table => table.groupId === 'macro')) {
    assert.ok(item.rules.update.includes('上次已提交'));
    assert.ok(item.rules.update.includes('已确认剧情事实'));
  }
  for (const item of template.tables.filter(table => table.groupId === 'micro' && table.purpose !== 'event')) {
    assert.ok(item.rules.update.includes('本轮最新宏观'));
    assert.ok(item.rules.update.includes('同一对象不重复行动'));
  }
  const event = template.tables.find(item => item.id === 'event')!;
  assert.equal(event.permissions.ai.update, false);
  assert.ok(event.rules.insert.includes('已发生'));
  assert.ok(event.rules.insert.includes('预测、计划'));
});

test('secret visibility is separate from hidden UI and export selections contain no secret fields', () => {
  const template = createDefaultT2Template();
  const npc = template.tables.find(item => item.id === 'npc')!;
  const privateGoal = npc.fields.find(item => item.id === 'private_goal')!;
  const editorNote = npc.fields.find(item => item.id === 'editor_note')!;
  assert.deepEqual(privateGoal.visibility, { user: true, evolutionAi: true, mainAi: false });
  assert.equal(privateGoal.hiddenUi, false);
  assert.equal(npc.context.fieldIds.includes(privateGoal.id), true);
  assert.equal(editorNote.hiddenUi, true);
  assert.deepEqual(editorNote.visibility, { user: true, evolutionAi: false, mainAi: false });
  assert.equal(editorNote.permissions.manualWrite, true);
  assert.equal(editorNote.permissions.aiWrite, false);
  assert.equal(npc.context.fieldIds.includes(editorNote.id), false);
  for (const item of template.tables) {
    const publicIds = new Set(item.fields.filter(field => field.visibility.mainAi).map(field => field.id));
    assert.ok(item.export.fieldIds.every(id => publicIds.has(id)));
    assert.ok(item.export.keyFieldIds.every(id => publicIds.has(id)));
    assert.ok(item.export.titleFieldId === null || publicIds.has(item.export.titleFieldId));
  }
});

test('API defaults are disabled preset references and templates have no credential payloads', () => {
  const template = createDefaultT2Template();
  assert.deepEqual(template.defaults.api, { state: 'disabled' });
  for (const item of template.tables) {
    assert.deepEqual(item.runtime.api, { state: 'inherit' });
    assert.equal(resolveT2TableSettings(template, item.id).api.state, 'disabled');
  }
  const forbidden = new Set(['apiKey', 'password', 'token', 'authorization', 'baseUrl']);
  const inspect = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      assert.equal(forbidden.has(key), false, `credential property ${key}`);
      inspect(child);
    }
  };
  inspect(template);
});

test('frequency and budget settings identify inherited and concrete sources without sentinel numbers', () => {
  const template = createDefaultT2Template();
  const environment = resolveT2TableSettings(template, 'environment');
  const npc = resolveT2TableSettings(template, 'npc');
  assert.equal(environment.frequency.source, 'table');
  assert.deepEqual(environment.frequency.value, { unit: 'eligible-story-round', every: 3, offset: 1 });
  assert.equal(npc.frequency.source, 'global');
  assert.equal(npc.budget.source, 'table');
  assert.equal(npc.budget.value?.maxRows, 12);
  assert.equal(npc.budget.value?.maxRequests, 2);
  assert.equal(resolveT2TableSettings(template, 'society').budget.source, 'global');
});

test('creating an empty world adopts structure only and never inserts fixture rows', () => {
  for (const template of [createDefaultT2Template(), createMinimalT2Template()]) {
    const world = createT2EmptyWorld(template, 'empty-world', 'empty-branch');
    assert.equal(world.revision, 0);
    assert.deepEqual(
      Object.keys(world.tables),
      template.tables.map(item => item.id),
    );
    assert.ok(Object.values(world.tables).every(rows => rows.length === 0));
    assert.equal(JSON.stringify(world).includes('林澄'), false);
    assert.equal(JSON.stringify(world).includes('雾港社区'), false);
  }
});

test('minimal environment and NPC starter has no dangling relationship or context tables', () => {
  const template = createMinimalT2Template();
  const ids = new Set(template.tables.map(item => item.id));
  assert.deepEqual([...ids], ['environment', 'npc']);
  for (const item of template.tables) {
    assert.ok(item.context.relatedTableIds.every(id => ids.has(id)));
    for (const field of item.fields)
      assert.ok(!field.constraints.reference || field.constraints.reference.tableIds.every(id => ids.has(id)));
  }
  const fixture = createMinimalT2Fixture();
  assert.equal(fixture.data.tables.environment.length, 1);
  assert.equal(fixture.data.tables.npc.length, 1);
  assert.deepEqual(normalizeT2WorldData(template, fixture.data), fixture.data);
});

test('explicit seven-table fixtures validate all stable references including same-batch plan/event references', () => {
  const { template, data } = createDefaultT2Fixture();
  assert.deepEqual(normalizeT2WorldData(template, JSON.parse(JSON.stringify(data))), data);
  assert.equal(data.tables.npc.length, 2);
  assert.equal(data.tables.plan.length, 2);
  assert.deepEqual(data.tables.plan[1].values.result_events, [{ tableId: 'event', rowId: 'reinforcement-finished' }]);
  assert.deepEqual(data.tables.event[0].values.related_plans, [{ tableId: 'plan', rowId: 'warehouse-reinforcement' }]);
});

test('same full name does not collapse two independent candidate row identities', () => {
  const { data } = createDefaultT2Fixture();
  const one = data.tables.npc[0];
  const two = data.tables.npc[1];
  assert.equal(one.values.name, two.values.name);
  assert.notEqual(one.meta.id, two.meta.id);
  assert.notEqual(
    t2CandidateKey({ tableId: 'npc', rowId: one.meta.id }),
    t2CandidateKey({ tableId: 'npc', rowId: two.meta.id }),
  );
  assert.notEqual(
    t2CandidateKey({ tableId: 'npc', rowId: one.meta.id }),
    t2CandidateKey({ tableId: 'organization', rowId: one.meta.id }),
  );
});

test('completed plans are archived but retained and past event facts keep valid links', () => {
  const { template, data } = createDefaultT2Fixture();
  const completed = data.tables.plan.find(item => item.meta.id === 'warehouse-reinforcement')!;
  assert.equal(completed.values.status, '完成');
  assert.equal(completed.meta.archived, true);
  assert.equal(data.tables.event[0].values.facts, '巡守会完成仓库入口沙袋加固。');
  const rules = template.tables.find(item => item.id === 'plan')!.rules;
  assert.ok(rules.archive.includes('禁止自动物理删除'));
  assert.deepEqual(normalizeT2WorldData(template, data), data);
});

test('fixture/template instances share no mutable nested lists or row values', () => {
  const first = createDefaultT2Fixture();
  first.template.tables[0].name = '用户更名';
  first.template.tables[0].fields[0].description = '用户说明';
  (first.data.tables.society[0].values.tags as string[]).push('用户标签');
  first.data.tables.npc[0].values.name = '用户改名';
  const second = createDefaultT2Fixture();
  assert.equal(second.template.tables[0].name, '社会');
  assert.notEqual(second.template.tables[0].fields[0].description, '用户说明');
  assert.equal((second.data.tables.society[0].values.tags as string[]).includes('用户标签'), false);
  assert.equal(second.data.tables.npc[0].values.name, '林澄');
  assert.deepEqual(createDefaultT2Template(), second.template);
});

test('defaults never overwrite supplied values or backfill missing optional fields on restoration', () => {
  const { template, data } = createDefaultT2Fixture();
  const npc = template.tables.find(item => item.id === 'npc')!;
  npc.fields.find(item => item.id === 'knowledge')!.required = false;
  data.tables.npc[0].values.goals = '用户明确修改的目标';
  data.tables.npc[0].values.relationships = [];
  delete data.tables.npc[0].values.knowledge;
  const restored = normalizeT2WorldData(template, data);
  assert.equal(restored.tables.npc[0].values.goals, '用户明确修改的目标');
  assert.deepEqual(restored.tables.npc[0].values.relationships, []);
  assert.equal(Object.hasOwn(restored.tables.npc[0].values, 'knowledge'), false);
  assert.equal(Object.hasOwn(data.tables.npc[0].values, 'knowledge'), false);
});

test('custom eighth table is normative business data with exact decimals and explicit false values', () => {
  const { template, data } = createCustomT2Fixture();
  assert.equal(template.tables.length, 8);
  const market = template.tables.find(item => item.id === 'market')!;
  assert.equal(market.purpose, 'custom');
  assert.equal(market.groupId, 'macro');
  assert.equal(data.tables.market[0].values.unit_price, '12.30');
  assert.equal(data.tables.market[0].values.open, false);
  assert.deepEqual(normalizeT2WorldData(template, data), data);
  assert.equal(createDefaultT2Template().tables.length, 7);
  assert.equal(Object.hasOwn(createDefaultT2Fixture().data.tables, 'market'), false);
});

test('display renames preserve stable table, field and row relationship identities', () => {
  const { template, data } = createDefaultT2Fixture();
  const changed: T2Template = JSON.parse(JSON.stringify(template));
  changed.templateVersion = 2;
  const npc = changed.tables.find(item => item.id === 'npc')!;
  npc.name = '角色名册';
  npc.fields.find(item => item.id === 'name')!.name = '人物全称';
  data.templateVersion = 2;
  const restored = normalizeT2WorldData(normalizeT2Template(changed), data);
  assert.equal(restored.tables.npc[0].meta.id, 'lin-watch');
  assert.deepEqual(restored.tables.npc[0].values.location, { tableId: 'location', rowId: 'north-gate' });
  assert.equal(npc.sqlName, 'we_npc');
  assert.equal(npc.fields.find(item => item.id === 'name')!.sqlName, 'f_name');
});
