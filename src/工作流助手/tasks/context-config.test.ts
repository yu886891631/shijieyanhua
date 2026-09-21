import assert from 'node:assert/strict';
import { pickGlobalContextConfig, resolveTaskContextConfig } from './context-config';
import type { PostProcessTask, ScriptSettings, TaskContextConfig } from './schema';

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`, e);
    process.exitCode = 1;
  }
}

const globalConfig: TaskContextConfig = {
  contextTurnCount: 3,
  contextExtractRules: [{ start: '<a>', end: '</a>' }],
  contextExcludeRules: [{ start: '<b>', end: '</b>' }],
};

const taskConfig: TaskContextConfig = {
  contextTurnCount: 5,
  contextExtractRules: [{ start: '<x>', end: '</x>' }],
  contextExcludeRules: [],
};

const baseSettings = {
  contextTurnCount: globalConfig.contextTurnCount,
  contextExtractRules: globalConfig.contextExtractRules,
  contextExcludeRules: globalConfig.contextExcludeRules,
  taskContextOverridesEnabled: true,
} as ScriptSettings;

const baseTask = {
  id: 't1',
  contextMode: 'inherit',
} as PostProcessTask;

test('inherit uses global context config', () => {
  const resolved = resolveTaskContextConfig(baseTask, baseSettings);
  assert.equal(resolved.contextTurnCount, 3);
  assert.equal(resolved.contextExtractRules[0]?.start, '<a>');
});

test('custom uses task contextConfig', () => {
  const task = {
    ...baseTask,
    contextMode: 'custom' as const,
    contextConfig: taskConfig,
  };
  const resolved = resolveTaskContextConfig(task, baseSettings);
  assert.equal(resolved.contextTurnCount, 5);
  assert.equal(resolved.contextExtractRules[0]?.start, '<x>');
});

test('overrides disabled always uses global', () => {
  const task = {
    ...baseTask,
    contextMode: 'custom' as const,
    contextConfig: taskConfig,
  };
  const settings = { ...baseSettings, taskContextOverridesEnabled: false };
  const resolved = resolveTaskContextConfig(task, settings);
  assert.equal(resolved.contextTurnCount, 3);
});

test('pickGlobalContextConfig mirrors settings fields', () => {
  const picked = pickGlobalContextConfig(baseSettings);
  assert.deepEqual(picked, globalConfig);
});
