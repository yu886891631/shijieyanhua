import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TaskApiRouteConcurrencyPool } from './route-concurrency-pool';
import { callTaskApiWithRouteFallback } from './task-api-route';
import type { ScriptSettings } from '../tasks/schema';

function poolLimits(entries: Array<[string, number]>) {
  return new Map(entries);
}

function baseSettings(): ScriptSettings {
  return {
    enabled: true,
    apiConfig: { url: '', apiKey: '', model: '', source: 'openai' },
    apiPresets: [
      { name: 'primary', apiConfig: { url: 'p', apiKey: '', model: 'm', source: 'openai' } },
      { name: 'fallback', apiConfig: { url: 'f', apiKey: '', model: 'm', source: 'openai' } },
    ],
    defaultApiPresetName: 'primary',
    activeApiPresetName: '',
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
  } as ScriptSettings;
}

test('callTaskApiWithRouteFallback uses fallback when primary throws', async () => {
  const calls: string[] = [];
  const result = await callTaskApiWithRouteFallback(
    [{ role: 'user', content: 'hi', name: '' }],
    baseSettings(),
    ['primary', 'fallback'],
    null,
    'test',
    {
      callApi: async (_messages, resolved) => {
        const url = resolved.apiConfig.url;
        calls.push(url);
        if (url === 'p') throw new Error('primary failed');
        return { content: 'ok-from-fallback' };
      },
    },
  );
  assert.deepEqual(calls, ['p', 'f']);
  assert.equal(result.content, 'ok-from-fallback');
  assert.equal(result.usedPresetName, 'fallback');
});

test('callTaskApiWithRouteFallback throws when all routes fail', async () => {
  await assert.rejects(
    () =>
      callTaskApiWithRouteFallback(
        [{ role: 'user', content: 'hi', name: '' }],
        baseSettings(),
        ['primary', 'fallback'],
        null,
        'test',
        {
          callApi: async () => {
            throw new Error('api down');
          },
        },
      ),
    /api down/,
  );
});

test('callTaskApiWithRouteFallback returns primary when it succeeds', async () => {
  const result = await callTaskApiWithRouteFallback(
    [{ role: 'user', content: 'hi', name: '' }],
    baseSettings(),
    ['primary', 'fallback'],
    null,
    'test',
    {
      callApi: async (_messages, resolved) => ({
        content: `ok:${resolved.apiConfig.url}`,
      }),
    },
  );
  assert.equal(result.content, 'ok:p');
  assert.equal(result.usedPresetName, 'primary');
});

test('callTaskApiWithRouteFallback with pool uses fallback when primary slots are full', async () => {
  const pool = new TaskApiRouteConcurrencyPool(
    ['primary', 'fallback'],
    poolLimits([
      ['primary', 1],
      ['fallback', 1],
    ]),
  );
  const heldPrimary = await pool.acquire();
  assert.equal(heldPrimary, 'primary');

  const calls: string[] = [];
  const result = await callTaskApiWithRouteFallback(
    [{ role: 'user', content: 'hi', name: '' }],
    baseSettings(),
    ['primary', 'fallback'],
    null,
    'test-pool',
    {
      routePool: pool,
      callApi: async (_messages, resolved) => {
        calls.push(resolved.apiConfig.url);
        return { content: 'ok' };
      },
    },
  );

  pool.release(heldPrimary);
  assert.equal(result.usedPresetName, 'fallback');
  assert.deepEqual(calls, ['f']);
});

test('callTaskApiWithRouteFallback preferPrimaryOnly stays on primary with pool', async () => {
  const pool = new TaskApiRouteConcurrencyPool(
    ['primary', 'fallback'],
    poolLimits([
      ['primary', 1],
      ['fallback', 1],
    ]),
  );
  const calls: string[] = [];
  const result = await callTaskApiWithRouteFallback(
    [{ role: 'user', content: 'hi', name: '' }],
    baseSettings(),
    ['primary', 'fallback'],
    null,
    'test-primary-only',
    {
      routePool: pool,
      preferPrimaryOnly: true,
      callApi: async (_messages, resolved) => {
        calls.push(resolved.apiConfig.url);
        return { content: 'ok-primary' };
      },
    },
  );
  assert.equal(result.usedPresetName, 'primary');
  assert.deepEqual(calls, ['p']);
});
