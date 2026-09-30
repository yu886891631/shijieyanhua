import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildWorldEvolutionPrompt, callWorldEvolutionAi, setWorldEvolutionAiCaller } from './engine';
import {
  createEmptyWorldEvolutionApiConfiguration,
  upsertWorldEvolutionApiPreset,
  WORLD_EVOLUTION_API_CONFIG_KEY,
} from './api-config';
import { createEmptyWorld, DEFAULT_WORLD_EVOLUTION_SETTINGS, type WorldEvolutionInput } from './types';

test('world evolution AI caller can be replaced by a deterministic simulator', async () => {
  const calls: Array<{ prompt: string; enabled: boolean }> = [];
  setWorldEvolutionAiCaller(async (prompt, settings) => {
    calls.push({ prompt, enabled: settings.enabled });
    return JSON.stringify({
      baseRevision: 0,
      operations: [],
    });
  });

  try {
    const response = await callWorldEvolutionAi('模拟楼层', {
      ...DEFAULT_WORLD_EVOLUTION_SETTINGS,
      enabled: true,
    });
    assert.deepEqual(JSON.parse(response), {
      baseRevision: 0,
      operations: [],
    });
    assert.deepEqual(calls, [{ prompt: '模拟楼层', enabled: true }]);
  } finally {
    setWorldEvolutionAiCaller(undefined);
  }
});

test('world evolution AI caller propagates simulated failures without calling a real API', async () => {
  setWorldEvolutionAiCaller(async () => {
    throw new Error('simulated-timeout');
  });

  try {
    await assert.rejects(callWorldEvolutionAi('超时楼层', DEFAULT_WORLD_EVOLUTION_SETTINGS), /simulated-timeout/);
  } finally {
    setWorldEvolutionAiCaller(undefined);
  }
});

test('default world evolution caller uses the built-in routing before the workflow bridge', async () => {
  const globals = globalThis as typeof globalThis & {
    getScriptId?: () => string;
    getVariables?: (option?: unknown) => Record<string, unknown>;
    fetch?: typeof fetch;
    window?: Window & typeof globalThis;
  };
  const originalGetScriptId = globals.getScriptId;
  const originalGetVariables = globals.getVariables;
  const originalFetch = globals.fetch;
  const originalWindow = globals.window;
  let config = createEmptyWorldEvolutionApiConfiguration(100);
  config = upsertWorldEvolutionApiPreset(
    config,
    {
      id: 'builtin-primary',
      name: '内置主 API',
      endpoint: 'https://builtin.example.test/v1/chat/completions',
      apiKey: 'test-only-key',
      model: 'test-model',
      maxRetries: 0,
    },
    101,
  );
  config.routing.primaryPresetId = 'builtin-primary';
  let bridgeCalls = 0;
  let requestBody: Record<string, unknown> | undefined;
  globals.getScriptId = () => 'world-evolution-s6-test';
  globals.getVariables = () => ({ [WORLD_EVOLUTION_API_CONFIG_KEY]: config });
  globals.window = {
    parent: {
      AcuPostProcessAPI: {
        callApi: async () => {
          bridgeCalls += 1;
          return { content: '不应调用' };
        },
      },
    },
  } as Window & typeof globalThis;
  globals.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({ content: '内置路由成功' }), { status: 200 });
  };

  try {
    const response = await callWorldEvolutionAi('请生成世界演变 JSON', {
      ...DEFAULT_WORLD_EVOLUTION_SETTINGS,
      enabled: true,
    });
    assert.equal(response, '内置路由成功');
    assert.equal(bridgeCalls, 0);
    assert.equal(requestBody?.model, 'test-model');
  } finally {
    globals.getScriptId = originalGetScriptId;
    globals.getVariables = originalGetVariables;
    globals.fetch = originalFetch;
    globals.window = originalWindow;
  }
});

test('default world evolution caller can use the workflow assistant bridge when no builtin route exists', async () => {
  const globals = globalThis as typeof globalThis & {
    getScriptId?: () => string;
    getVariables?: (option?: unknown) => Record<string, unknown>;
    fetch?: typeof fetch;
    window?: Window & typeof globalThis;
  };
  const originalGetScriptId = globals.getScriptId;
  const originalGetVariables = globals.getVariables;
  const originalFetch = globals.fetch;
  const originalWindow = globals.window;
  const config = createEmptyWorldEvolutionApiConfiguration(100);
  config.routing.workflowAssistantPresetName = '工作流主预设';
  let bridgeCalls = 0;
  globals.getScriptId = () => 'world-evolution-s6-bridge-test';
  globals.getVariables = () => ({ [WORLD_EVOLUTION_API_CONFIG_KEY]: config });
  globals.window = {
    parent: {
      AcuPostProcessAPI: {
        listApiPresetDetails: () => ({
          available: true,
          defaultConfig: { model: 'bridge-model', endpointConfigured: true, keyConfigured: true },
          presets: [],
        }),
        callApi: async () => {
          bridgeCalls += 1;
          return { content: '工作流桥接成功', usedPresetName: '工作流主预设' };
        },
      },
    },
  } as Window & typeof globalThis;
  globals.fetch = async () => {
    throw new Error('内置路由不应被调用');
  };

  try {
    const response = await callWorldEvolutionAi('请生成桥接世界演变 JSON', {
      ...DEFAULT_WORLD_EVOLUTION_SETTINGS,
      enabled: true,
    });
    assert.equal(response, '工作流桥接成功');
    assert.equal(bridgeCalls, 1);
  } finally {
    globals.getScriptId = originalGetScriptId;
    globals.getVariables = originalGetVariables;
    globals.fetch = originalFetch;
    globals.window = originalWindow;
  }
});

test('world evolution does not silently fall back to the active SillyTavern API', async () => {
  const globals = globalThis as typeof globalThis & {
    getScriptId?: () => string;
    getVariables?: (option?: unknown) => Record<string, unknown>;
    window?: Window & typeof globalThis;
    generateRaw?: (...args: unknown[]) => Promise<unknown>;
  };
  const originalGetScriptId = globals.getScriptId;
  const originalGetVariables = globals.getVariables;
  const originalWindow = globals.window;
  const originalGenerateRaw = globals.generateRaw;
  globals.getScriptId = () => 'world-evolution-empty-test';
  globals.getVariables = () => ({});
  let generateRawCalled = false;
  globals.window = { parent: {} } as Window & typeof globalThis;
  globals.generateRaw = async () => {
    generateRawCalled = true;
    return 'should-not-be-used';
  };

  try {
    await assert.rejects(
      callWorldEvolutionAi('no fallback', DEFAULT_WORLD_EVOLUTION_SETTINGS),
      /没有配置可用的内置 API，也没有可用的工作流助手桥接/,
    );
    assert.equal(generateRawCalled, false);
  } finally {
    globals.getScriptId = originalGetScriptId;
    globals.getVariables = originalGetVariables;
    globals.window = originalWindow;
    globals.generateRaw = originalGenerateRaw;
  }
});

test('world evolution prompt includes MVU, workflow and database context without invoking an API', () => {
  const world = createEmptyWorld('chat-context');
  world.entities['npc:林青'] = {
    id: 'npc:林青',
    type: 'npc',
    name: '林青',
    state: { goal: '寻找信使' },
    visibility: 'ai_context',
    updatedAt: 1,
  };
  const input: WorldEvolutionInput = {
    chatKey: 'chat-context',
    messageId: 12,
    latestMessage: '林青离开了北门。',
    mvuSnapshot: { world: { time: '春日' } },
    previousMvuSnapshot: { world: { time: '冬日' } },
    mvuChangeSummary: '{"time":"冬日→春日"}',
    databaseSummary: '{"workflow":"角色表已更新"}',
    databaseSnapshot: { 角色表: { rows: [{ name: '林青', location: '北门' }] } },
    candidateNames: ['林青'],
    currentTime: '春日-01日-10:00',
    currentLocation: '北门',
  };

  const prompt = buildWorldEvolutionPrompt(input, world, DEFAULT_WORLD_EVOLUTION_SETTINGS);
  assert.match(prompt, /角色表已更新/);
  assert.match(prompt, /林青/);
  assert.match(prompt, /北门/);
  assert.match(prompt, /当前 MVU 快照/);
  assert.match(prompt, /数据库当前表快照/);
  assert.match(prompt, /"operations"/);
  assert.doesNotMatch(prompt, /"scheduledEvents"/);
});
