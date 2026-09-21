import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BUILTIN_PRESETS } from './example-presets';
import { REPLICA_ENUM_PROMPT_GROUP_NAME } from './replica-enum-prompt-rules';
import { PostProcessPresetSchema } from './schema';

test('all builtin presets parse with PostProcessPresetSchema', () => {
  for (const preset of BUILTIN_PRESETS) {
    const parsed = PostProcessPresetSchema.parse(preset);
    assert.equal(parsed.name, preset.name);
  }
});

test('正文润色示例 preset has content extract and body replace rule', () => {
  const preset = BUILTIN_PRESETS.find(p => p.name === '正文润色示例');
  assert.ok(preset, 'preset should exist');

  assert.deepEqual(preset.chatExtractTags?.assistant, ['content']);
  assert.equal(preset.chatBodyTagReplaceRules?.length, 1);
  assert.equal(preset.chatBodyTagReplaceRules?.[0]?.targetTag, 'content');
  assert.equal(preset.chatBodyTagReplaceRules?.[0]?.template, '{{content}}');

  const task = preset.tasks.find(t => t.name === '正文润色');
  assert.ok(task);
  assert.deepEqual(task.extractInjectTags, ['content']);
  assert.equal(task.stage, 1);
});

test('副本族与动态占位符示例 preset configures replica family task', () => {
  const preset = BUILTIN_PRESETS.find(p => p.name === '副本族与动态占位符示例');
  assert.ok(preset, 'preset should exist');

  const enumTask = preset.tasks.find(t => t.id === 'example-enum-item');
  assert.ok(enumTask);
  assert.equal(enumTask.enabled, true);
  assert.equal(enumTask.stage, 1);
  const rulesGroup = enumTask.promptGroups.find(g => g.name === REPLICA_ENUM_PROMPT_GROUP_NAME);
  assert.ok(rulesGroup, 'should have ReplicaEnum rules prompt group');
  assert.equal(rulesGroup.role, 'system');
  assert.ok(rulesGroup.content.includes('item@name'));
  assert.ok(rulesGroup.content.includes('副本族旁注'));
  assert.ok(rulesGroup.content.includes('断剑'));
  assert.ok(rulesGroup.content.includes('renames'));
  assert.ok(rulesGroup.content.includes('<ReplicaEnum>'));
  assert.equal(enumTask.promptGroups.length, 3);
  assert.ok(enumTask.promptGroups.some(g => g.content.includes('ReplicaEnum 输出规则') && g.name === ''));

  const replicaTask = preset.tasks.find(t => t.id === 'example-replica-family');
  assert.ok(replicaTask);
  assert.equal(replicaTask.enabled, true);
  assert.equal(replicaTask.stage, 2);
  assert.deepEqual(replicaTask.extractInjectTags, ['item@name']);
  assert.equal(replicaTask.syncAsReplicaFamily, true);
  assert.equal(replicaTask.replicaFamilySpec, 'item@name');
  assert.equal(replicaTask.replicaFamilyEnumSpec, 'item@name');
  assert.equal(replicaTask.replicaFamilyBaseName, '副本族处理');
  assert.ok(replicaTask.promptGroups.some(g => g.content.includes('{{replica:val}}')));
  assert.ok(replicaTask.promptGroups.some(g => g.content.includes('{{item@name}}')));
  assert.ok(replicaTask.promptGroups.some(g => g.content.includes('<item name')));

  const asideTask = preset.tasks.find(t => t.id === 'example-replica-family-aside');
  assert.ok(asideTask);
  assert.equal(asideTask.enabled, true);
  assert.equal(asideTask.stage, 2);
  assert.deepEqual(asideTask.extractInjectTags, ['note@name']);
  assert.equal(asideTask.syncAsReplicaFamily, true);
  assert.equal(asideTask.replicaFamilySpec, 'item@name');
  assert.equal(asideTask.replicaFamilyEnumSpec, 'item@name');
  assert.equal(asideTask.replicaFamilyBaseName, '副本族旁注');
  assert.ok(asideTask.promptGroups.some(g => g.content.includes('{{item@name}}')));
  assert.ok(asideTask.promptGroups.some(g => g.content.includes('<note name')));

  const aggregateTask = preset.tasks.find(t => t.id === 'example-aggregate-launched');
  assert.ok(aggregateTask);
  assert.equal(aggregateTask.enabled, true);
  assert.equal(aggregateTask.stage, 3);
  assert.equal(aggregateTask.syncAsReplicaFamily, undefined);
  assert.ok(aggregateTask.promptGroups.some(g => g.content.includes('total:launched:item@name')));
  assert.ok(aggregateTask.promptGroups.some(g => g.content.includes('total:launched:item@name:副本族处理')));
  assert.ok(aggregateTask.promptGroups.some(g => g.content.includes('replica:launched:副本族处理')));

  assert.equal(preset.tagVariableInjectTemplate, '{{total:launched:item@name}}');
  assert.equal(preset.finalInjectTemplate, 'FLOOR_INJECT:{{total:launched:item@name}}');
  assert.equal(preset.chatWorldbookWriteRules?.[0]?.template, '{{total:launched:item@name}}');
});

console.log('example-presets.test.ts: all passed');
