import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createEmptyWorldEvolutionApiConfiguration,
  exportWorldEvolutionApiConfiguration,
  loadWorldEvolutionApiConfiguration,
  migrateLegacyWorldEvolutionApiSettings,
  normalizeWorldEvolutionApiConfiguration,
  removeWorldEvolutionApiPreset,
  saveWorldEvolutionApiConfiguration,
  upsertWorldEvolutionApiPreset,
  WORLD_EVOLUTION_API_CONFIG_KEY,
} from './api-config';

test('API configuration normalizes invalid values and removes duplicate routes', () => {
  const config = normalizeWorldEvolutionApiConfiguration({
    schemaVersion: 0,
    presets: [
      {
        id: 'main',
        name: '主 API',
        endpoint: ' https://example.test/v1 ',
        apiKey: 'secret',
        model: ' model-a ',
        timeoutMs: 9,
        maxRetries: 99,
      },
      {
        id: 'main',
        name: '重复预设',
      },
    ],
    routing: {
      primaryPresetId: 'main',
      fallbackPresetIds: ['main', 'missing'],
    },
  }, 100);

  assert.equal(config.schemaVersion, 1);
  assert.equal(config.presets.length, 1);
  assert.equal(config.presets[0].endpoint, 'https://example.test/v1');
  assert.equal(config.presets[0].timeoutMs, 1_000);
  assert.equal(config.presets[0].maxRetries, 8);
  assert.deepEqual(config.routing.fallbackPresetIds, []);
});

test('legacy workflow assistant names migrate without fabricating built-in credentials', () => {
  const config = migrateLegacyWorldEvolutionApiSettings(
    { apiPresetName: '主预设', apiFallbackPresetNames: ['备用一', '主预设'] },
    123,
  );

  assert.equal(config.presets.length, 0);
  assert.equal(config.routing.workflowAssistantPresetName, '主预设');
  assert.deepEqual(config.routing.workflowAssistantFallbackPresetNames, ['备用一']);
});

test('API export is redacted and never contains the key', () => {
  let config = createEmptyWorldEvolutionApiConfiguration(100);
  config = upsertWorldEvolutionApiPreset(
    config,
    {
      id: 'primary',
      name: '主 API',
      endpoint: 'https://example.test/v1',
      apiKey: 'super-secret-key',
      model: 'model-a',
    },
    200,
  );

  const exported = exportWorldEvolutionApiConfiguration(config);
  assert.doesNotMatch(exported, /super-secret-key/);
  assert.match(exported, /"keyConfigured": true/);
  assert.match(exported, /"endpoint": "https:\/\/example\.test\/v1"/);
});

test('upsert and remove keep route references consistent', () => {
  let config = createEmptyWorldEvolutionApiConfiguration(100);
  config = upsertWorldEvolutionApiPreset(config, { id: 'primary', name: '主 API' }, 101);
  config = upsertWorldEvolutionApiPreset(config, { id: 'backup', name: '备用 API' }, 102);
  config.routing.primaryPresetId = 'primary';
  config.routing.fallbackPresetIds = ['backup'];
  config = removeWorldEvolutionApiPreset(config, 'primary', 103);

  assert.equal(config.routing.primaryPresetId, null);
  assert.deepEqual(config.routing.fallbackPresetIds, ['backup']);
  assert.equal(config.presets.length, 1);
});

test('API configuration persistence uses a separate script variable and round-trips', () => {
  const globals = globalThis as typeof globalThis & {
    getScriptId?: () => string;
    getVariables?: () => Record<string, unknown>;
    insertOrAssignVariables?: (value: Record<string, unknown>) => void;
  };
  const originalGetScriptId = globals.getScriptId;
  const originalGetVariables = globals.getVariables;
  const originalInsert = globals.insertOrAssignVariables;
  const variables: Record<string, unknown> = {};
  globals.getScriptId = () => 'world-evolution-alpha12-test';
  globals.getVariables = () => variables;
  globals.insertOrAssignVariables = value => Object.assign(variables, value);

  try {
    let config = createEmptyWorldEvolutionApiConfiguration(100);
    config = upsertWorldEvolutionApiPreset(config, {
      id: 'primary',
      name: '主 API',
      endpoint: 'https://example.test/v1',
      apiKey: 'secret',
      model: 'model-a',
    }, 101);
    saveWorldEvolutionApiConfiguration(config);

    assert.ok(variables[WORLD_EVOLUTION_API_CONFIG_KEY]);
    assert.deepEqual(loadWorldEvolutionApiConfiguration(), config);
  } finally {
    globals.getScriptId = originalGetScriptId;
    globals.getVariables = originalGetVariables;
    globals.insertOrAssignVariables = originalInsert;
  }
});
