import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PostProcessTaskSchema } from '../tasks/schema';
import {
  alignFallbackMaxConcurrencies,
  buildRouteConcurrencyLimits,
  hasAnyRouteConcurrencyCap,
} from './route-concurrency-limits';
import type { PostProcessTask, ScriptSettings } from '../tasks/schema';

function baseSettings(): ScriptSettings {
  return {
    enabled: true,
    apiConfig: { url: '', apiKey: '', model: '', source: 'openai' },
    apiPresets: [
      { name: 'primary-preset', apiConfig: { url: 'p', apiKey: '', model: 'm', source: 'openai' } },
      { name: 'fallback-a', apiConfig: { url: 'a', apiKey: '', model: 'm', source: 'openai' } },
      { name: 'fallback-b', apiConfig: { url: 'b', apiKey: '', model: 'm', source: 'openai' } },
    ],
    defaultApiPresetName: 'primary-preset',
    activeApiPresetName: '',
    defaultTaskApiPreset: 'primary-preset',
    taskApiPresetOverridesById: {},
    tasks: [],
    contextTurnCount: 3,
    contextExtractRules: [],
    contextExcludeRules: [],
    plotWorldbookConfig: { source: 'character', manualSelection: [], enabledEntries: {} },
    taskPlotWorldbookOverridesEnabled: false,
    taskContextOverridesEnabled: false,
    finalInjectTemplate: '',
    tagVariableInjectTemplate: '',
    chatExtractTags: { user: [], assistant: [] },
    chatBodyTagReplaceRules: [],
    chatWorldbookWriteRules: [],
    presets: [],
    activePresetName: '',
    scheduleState: {},
    lastRunStatus: { taskResults: [] },
    messageVarRetention: { enabled: true, keepFloors: 20 },
    uiThemeId: 'creamy-minimal',
    apiPresetBindingsByChat: {},
  } as ScriptSettings;
}

test('migrates legacy apiRouteMaxConcurrency to per-route fields', () => {
  const task = PostProcessTaskSchema.parse({
    id: 't1',
    apiRouteMaxConcurrency: 3,
    apiPresetFallbackNames: ['fallback-a', 'fallback-b'],
  });
  assert.equal(task.apiPrimaryMaxConcurrency, 3);
  assert.deepEqual(task.apiFallbackMaxConcurrencies, [3, 3]);
});

test('buildRouteConcurrencyLimits maps fallback indices to chain routes', () => {
  const settings = baseSettings();
  const task: Pick<
    PostProcessTask,
    | 'apiPresetName'
    | 'apiPresetFallbackNames'
    | 'apiPrimaryMaxConcurrency'
    | 'apiFallbackMaxConcurrencies'
  > = {
    apiPresetName: 'primary-preset',
    apiPresetFallbackNames: ['fallback-a', 'fallback-b'],
    apiPrimaryMaxConcurrency: 5,
    apiFallbackMaxConcurrencies: [2, 10],
  };
  const limits = buildRouteConcurrencyLimits(settings, 't1', task);
  assert.equal(limits.get('primary-preset'), 5);
  assert.equal(limits.get('fallback-a'), 2);
  assert.equal(limits.get('fallback-b'), 10);
  assert.equal(hasAnyRouteConcurrencyCap(limits), true);
});

test('alignFallbackMaxConcurrencies pads and truncates', () => {
  assert.deepEqual(alignFallbackMaxConcurrencies(['a', 'b'], [7]), [7, 5]);
  assert.deepEqual(alignFallbackMaxConcurrencies(['a'], [1, 2, 3]), [1]);
});

test('hasAnyRouteConcurrencyCap is false when all routes unlimited', () => {
  const limits = new Map([
    ['a', 0],
    ['b', 0],
  ]);
  assert.equal(hasAnyRouteConcurrencyCap(limits), false);
});
