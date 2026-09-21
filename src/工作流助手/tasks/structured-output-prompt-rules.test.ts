import assert from 'node:assert/strict';
import { PostProcessTaskSchema } from './schema';
import {
  ADDON_JSON_PATCH_PROMPT_GROUP_NAME,
  buildMvuJsonPatchPromptGroupContent,
  captureStructuredOutputRulesFromTask,
  MVU_JSON_PATCH_PROMPT_GROUP_NAME,
  syncStructuredOutputPromptGroup,
} from './structured-output-prompt-rules';

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`, e);
    process.exitCode = 1;
  }
}

function makeTask(overrides: Record<string, unknown> = {}) {
  return PostProcessTaskSchema.parse({
    id: 't1',
    name: 'test',
    promptGroups: [{ name: '', role: 'user', content: 'hello', enabled: true }],
    ...overrides,
  });
}

test('sync adds MVU auto prompt group with default content', () => {
  const task = makeTask();
  syncStructuredOutputPromptGroup(task, 'mvu_json_patch');
  assert.equal(task.promptGroups.length, 2);
  const auto = task.promptGroups[1]!;
  assert.equal(auto.name, MVU_JSON_PATCH_PROMPT_GROUP_NAME);
  assert.equal(auto.role, 'system');
  assert.match(auto.content, /"analysis"/);
  assert.match(auto.content, /"patch"/);
  assert.ok(!/mvu_json_patch_v1/.test(auto.content));
});

test('sync off removes auto groups but keeps cache', () => {
  const task = makeTask({ structuredOutputMode: 'mvu_json_patch' });
  syncStructuredOutputPromptGroup(task, 'mvu_json_patch');
  const custom = 'CUSTOM MVU RULES';
  task.promptGroups[1]!.content = custom;
  captureStructuredOutputRulesFromTask(task);
  syncStructuredOutputPromptGroup(task, 'off');
  assert.equal(task.promptGroups.length, 1);
  assert.equal(task.structuredOutputRules?.mvu, custom);
});

test('sync back to mvu restores cached custom rules', () => {
  const task = makeTask();
  const custom = 'MY SAVED MVU JSON RULES';
  task.structuredOutputRules = { mvu: custom };
  syncStructuredOutputPromptGroup(task, 'mvu_json_patch');
  assert.equal(task.promptGroups[1]!.content, custom);
});

test('mvu to addon replaces auto group name', () => {
  const task = makeTask();
  syncStructuredOutputPromptGroup(task, 'mvu_json_patch');
  task.promptGroups[1]!.content = 'mvu-custom';
  syncStructuredOutputPromptGroup(task, 'addon_json_patch');
  assert.equal(task.promptGroups.length, 2);
  assert.equal(task.promptGroups[1]!.name, ADDON_JSON_PATCH_PROMPT_GROUP_NAME);
  assert.equal(task.structuredOutputRules?.mvu, 'mvu-custom');
  assert.match(task.promptGroups[1]!.content, /"analysis"/);
  assert.match(task.promptGroups[1]!.content, /"patch"/);
  assert.match(task.promptGroups[1]!.content, /addon_data/);
  assert.ok(!/addon_json_patch_v1/.test(task.promptGroups[1]!.content));
  assert.ok(!/位面/.test(task.promptGroups[1]!.content));
});

test('sync preserves existing auto group index', () => {
  const task = makeTask({
    promptGroups: [
      { name: 'a', role: 'user', content: '1', enabled: true },
      { name: 'b', role: 'user', content: '2', enabled: true },
      { name: 'c', role: 'user', content: '3', enabled: true },
    ],
  });
  syncStructuredOutputPromptGroup(task, 'mvu_json_patch');
  // 移到中间
  const auto = task.promptGroups.pop()!;
  task.promptGroups.splice(1, 0, auto);
  assert.equal(task.promptGroups[1]!.name, MVU_JSON_PATCH_PROMPT_GROUP_NAME);
  syncStructuredOutputPromptGroup(task, 'mvu_json_patch');
  assert.equal(task.promptGroups[1]!.name, MVU_JSON_PATCH_PROMPT_GROUP_NAME);
  assert.equal(task.promptGroups.map(p => p.name).join(','), `a,${MVU_JSON_PATCH_PROMPT_GROUP_NAME},b,c`);
});

test('mvu to addon preserves custom index', () => {
  const task = makeTask({
    promptGroups: [
      { name: 'a', role: 'user', content: '1', enabled: true },
      { name: 'b', role: 'user', content: '2', enabled: true },
    ],
  });
  syncStructuredOutputPromptGroup(task, 'mvu_json_patch');
  const auto = task.promptGroups.pop()!;
  task.promptGroups.splice(0, 0, auto);
  syncStructuredOutputPromptGroup(task, 'addon_json_patch');
  assert.equal(task.promptGroups[0]!.name, ADDON_JSON_PATCH_PROMPT_GROUP_NAME);
  assert.equal(task.promptGroups.map(p => p.name).join(','), `${ADDON_JSON_PATCH_PROMPT_GROUP_NAME},a,b`);
});

test('renamed auto group is not removed on sync', () => {
  const task = makeTask();
  syncStructuredOutputPromptGroup(task, 'mvu_json_patch');
  task.promptGroups[1]!.name = '用户自定义规则';
  syncStructuredOutputPromptGroup(task, 'mvu_json_patch');
  const names = task.promptGroups.map(pg => pg.name);
  assert.ok(names.includes('用户自定义规则'));
  assert.ok(names.filter(n => n === MVU_JSON_PATCH_PROMPT_GROUP_NAME).length === 1);
});

test('default template used when cache empty', () => {
  const task = makeTask();
  syncStructuredOutputPromptGroup(task, 'mvu_json_patch');
  assert.equal(task.promptGroups[1]!.content, buildMvuJsonPatchPromptGroupContent());
});

if (process.exitCode) {
  process.exit(process.exitCode);
}
