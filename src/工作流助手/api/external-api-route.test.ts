import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildExternalApiPresetChain,
  listExternalApiPresetDetails,
  resolveExternalApiPresetChain,
  resolveExternalApiPresetName,
} from './external-api-route';
import type { ScriptSettings } from '../tasks/schema';

function settings(): ScriptSettings {
  return {
    enabled: true,
    apiConfig: { url: 'https://legacy.example/v1', apiKey: 'never-return-this', model: 'legacy-model', source: 'openai' },
    apiPresets: [
      { name: 'primary', apiConfig: { url: 'https://primary.example/v1', apiKey: 'primary-secret', model: 'p-model', source: 'openai' } },
      { name: 'backup', apiConfig: { url: 'https://backup.example/v1', apiKey: 'backup-secret', model: 'b-model', source: 'openai' } },
    ],
    defaultApiPresetName: 'primary',
    activeApiPresetName: 'backup',
    defaultTaskApiPreset: 'primary',
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
  } as unknown as ScriptSettings;
}

test('effective route honors chat binding before the active and default presets', () => {
  const input = settings();
  input.apiPresetBindingsByChat.chat = { presetName: 'primary', updatedAt: 1 };
  assert.equal(resolveExternalApiPresetName(input, 'chat'), 'primary');
  assert.equal(resolveExternalApiPresetName(input, 'other-chat'), 'backup');
});

test('preset information exposes status but never endpoint URLs or API keys', () => {
  const info = listExternalApiPresetDetails(settings(), 'chat');
  assert.equal(info.activePresetName, 'backup');
  assert.equal(info.presets[0]?.endpointConfigured, true);
  assert.equal(info.presets[0]?.keyConfigured, true);
  assert.equal(JSON.stringify(info).includes('https://'), false);
  assert.equal(JSON.stringify(info).includes('primary-secret'), false);
  assert.equal(JSON.stringify(info).includes('backup-secret'), false);
});

test('explicit main route and ordered fallbacks are deduplicated and validated', () => {
  assert.deepEqual(
    buildExternalApiPresetChain(settings(), 'chat', {
      presetName: 'primary',
      fallbackNames: ['backup', 'primary', 'removed'],
    }),
    ['primary', 'backup'],
  );
  assert.throws(
    () => buildExternalApiPresetChain(settings(), 'chat', { presetName: 'removed' }),
    /API 预设「removed」不存在/,
  );
});

test('a stale fallback is ignored so it cannot block the valid primary', () => {
  assert.deepEqual(
    buildExternalApiPresetChain(settings(), 'chat', { presetName: 'primary', fallbackNames: ['removed'] }),
    ['primary'],
  );
});

test('invalid optional fallback is skipped but invalid explicit primary fails closed', () => {
  const input = settings();
  input.apiPresets[1]!.apiConfig.model = '';
  assert.deepEqual(resolveExternalApiPresetChain(input, 'chat', { presetName: 'primary', fallbackNames: ['backup'] }), [
    'primary',
  ]);
  assert.throws(
    () => resolveExternalApiPresetChain(input, 'chat', { presetName: 'backup' }),
    /没有有效端点或模型名/,
  );
});

test('legacy top-level API configuration remains a valid unnamed route', () => {
  const input = settings();
  input.apiPresets = [];
  input.apiPresetBindingsByChat = {};
  input.activeApiPresetName = '';
  input.defaultApiPresetName = '';
  input.defaultTaskApiPreset = '';
  assert.equal(resolveExternalApiPresetName(input, 'chat'), '');
  assert.deepEqual(buildExternalApiPresetChain(input, 'chat'), ['']);
});

test('missing named and top-level API configurations fail before any API call', () => {
  const input = settings();
  input.apiPresets = [];
  input.apiPresetBindingsByChat = {};
  input.activeApiPresetName = '';
  input.defaultApiPresetName = '';
  input.defaultTaskApiPreset = '';
  input.apiConfig.url = '';
  input.apiConfig.model = '';
  assert.throws(() => buildExternalApiPresetChain(input, 'chat'), /尚未配置 API 预设/);
});
