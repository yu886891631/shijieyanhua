import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  normalizeApiPresetFallbackNames,
  resolveTaskApiPreset,
  resolveTaskApiPresetChain,
} from './resolve';
import type { PostProcessTask, ScriptSettings } from '../tasks/schema';

function baseSettings(partial?: Partial<ScriptSettings>): ScriptSettings {
  return {
    enabled: true,
    apiConfig: { url: '', apiKey: '', model: '', source: 'openai' },
    apiPresets: [
      { name: 'primary-preset', apiConfig: { url: 'p', apiKey: '', model: 'm', source: 'openai' } },
      { name: 'fallback-a', apiConfig: { url: 'a', apiKey: '', model: 'm', source: 'openai' } },
      { name: 'fallback-b', apiConfig: { url: 'b', apiKey: '', model: 'm', source: 'openai' } },
    ],
    defaultApiPresetName: 'global-default',
    activeApiPresetName: '',
    defaultTaskApiPreset: 'global-default',
    taskApiPresetOverridesById: {},
    tasks: [],
    contextTurnCount: 3,
    contextExtractRules: [],
    contextExcludeRules: [],
    plotWorldbookConfig: { source: 'character', manualSelection: [], enabledEntries: {} },
    taskPlotWorldbookOverridesEnabled: false,
    taskContextOverridesEnabled: false,
    finalInjectTemplate: '',
    userInputEndInjectTemplate: '',
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
    ...partial,
  } as ScriptSettings;
}

const taskBase: Pick<PostProcessTask, 'apiPresetName' | 'apiPresetFallbackNames'> = {
  apiPresetName: '',
  apiPresetFallbackNames: [],
};

test('resolveTaskApiPresetChain uses global default when primary empty', () => {
  const chain = resolveTaskApiPresetChain(baseSettings(), 't1', taskBase);
  assert.deepEqual(chain, ['global-default']);
});

test('resolveTaskApiPresetChain appends valid fallbacks', () => {
  const chain = resolveTaskApiPresetChain(baseSettings(), 't1', {
    apiPresetName: 'primary-preset',
    apiPresetFallbackNames: ['fallback-a', 'fallback-b'],
  });
  assert.deepEqual(chain, ['primary-preset', 'fallback-a', 'fallback-b']);
});

test('resolveTaskApiPresetChain dedupes and excludes primary from fallbacks', () => {
  const chain = resolveTaskApiPresetChain(baseSettings(), 't1', {
    apiPresetName: 'primary-preset',
    apiPresetFallbackNames: ['primary-preset', 'fallback-a', 'fallback-a', 'fallback-b'],
  });
  assert.deepEqual(chain, ['primary-preset', 'fallback-a', 'fallback-b']);
});

test('resolveTaskApiPresetChain skips missing fallback presets', () => {
  const chain = resolveTaskApiPresetChain(baseSettings(), 't1', {
    apiPresetName: 'primary-preset',
    apiPresetFallbackNames: ['missing', 'fallback-a'],
  });
  assert.deepEqual(chain, ['primary-preset', 'fallback-a']);
});

test('resolveTaskApiPreset override wins over task primary', () => {
  const settings = baseSettings({
    taskApiPresetOverridesById: { t1: 'fallback-b' },
  });
  assert.equal(resolveTaskApiPreset(settings, 't1', 'primary-preset'), 'fallback-b');
  const chain = resolveTaskApiPresetChain(settings, 't1', {
    apiPresetName: 'primary-preset',
    apiPresetFallbackNames: ['fallback-a'],
  });
  assert.deepEqual(chain, ['fallback-b', 'fallback-a']);
});

test('normalizeApiPresetFallbackNames trims and dedupes', () => {
  assert.deepEqual(
    normalizeApiPresetFallbackNames([' a ', 'b', 'a', '', 'primary'], 'primary'),
    ['a', 'b'],
  );
});
