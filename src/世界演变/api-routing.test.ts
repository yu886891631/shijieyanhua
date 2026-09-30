import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createEmptyWorldEvolutionApiConfiguration,
  upsertWorldEvolutionApiPreset,
  type WorldEvolutionApiConfiguration,
} from './api-config';
import { type WorldEvolutionApiFetch } from './api-client';
import {
  callWorldEvolutionApiWithRouting,
  resolveWorldEvolutionApiRouting,
  type WorldEvolutionWorkflowAssistantBridge,
} from './api-routing';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function configWithBuiltin(): WorldEvolutionApiConfiguration {
  let config = createEmptyWorldEvolutionApiConfiguration(100);
  config = upsertWorldEvolutionApiPreset(
    config,
    {
      id: 'primary',
      name: '内置主 API',
      endpoint: 'https://primary.test',
      apiKey: 'secret',
      model: 'model-a',
      maxRetries: 0,
    },
    101,
  );
  config.routing.primaryPresetId = 'primary';
  return config;
}

function bridge(content = '桥接响应'): WorldEvolutionWorkflowAssistantBridge {
  return {
    callApi: async () => ({ content, usedPresetName: '工作流主预设' }),
  };
}

test('routing summary exposes the four S5 source states', () => {
  const builtin = configWithBuiltin();
  const onlyBuiltin = resolveWorldEvolutionApiRouting(builtin);
  assert.equal(onlyBuiltin.state, 'builtin-only');
  assert.deepEqual(onlyBuiltin.order, ['builtin']);

  const onlyWorkflow = createEmptyWorldEvolutionApiConfiguration(100);
  onlyWorkflow.routing.workflowAssistantPresetName = '工作流主预设';
  const workflowSummary = resolveWorldEvolutionApiRouting(onlyWorkflow, { bridge: bridge() });
  assert.equal(workflowSummary.state, 'workflow-only');
  assert.deepEqual(workflowSummary.order, ['workflow-assistant']);

  const both = resolveWorldEvolutionApiRouting(
    { ...builtin, routing: { ...builtin.routing, workflowAssistantPresetName: '工作流主预设' } },
    { bridge: bridge() },
  );
  assert.equal(both.state, 'both');
  assert.deepEqual(both.order, ['builtin', 'workflow-assistant']);

  const none = resolveWorldEvolutionApiRouting(createEmptyWorldEvolutionApiConfiguration(100));
  assert.equal(none.state, 'none');
  assert.deepEqual(none.order, []);
});

test('builtin source is preferred and does not call the workflow bridge on success', async () => {
  const config = {
    ...configWithBuiltin(),
    routing: { ...configWithBuiltin().routing, workflowAssistantPresetName: '工作流主预设' },
  };
  let bridgeCalls = 0;
  const workflow: WorldEvolutionWorkflowAssistantBridge = {
    callApi: async () => {
      bridgeCalls += 1;
      return { content: '不应调用' };
    },
  };
  const fetchImpl: WorldEvolutionApiFetch = async () => jsonResponse({ content: '内置成功' });
  const result = await callWorldEvolutionApiWithRouting(config, [], { bridge: workflow, fetchImpl });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.source, 'builtin');
  assert.equal(result.text, '内置成功');
  assert.equal(bridgeCalls, 0);
});

test('workflow-only source uses the configured bridge without touching fetch', async () => {
  const config = createEmptyWorldEvolutionApiConfiguration(100);
  config.routing.workflowAssistantPresetName = '工作流主预设';
  let fetchCalls = 0;
  const result = await callWorldEvolutionApiWithRouting(config, [{ role: 'user', content: '测试' }], {
    bridge: bridge('桥接成功'),
    fetchImpl: async () => {
      fetchCalls += 1;
      return jsonResponse({ content: '不应调用' });
    },
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.source, 'workflow-assistant');
  assert.equal(result.presetName, '工作流主预设');
  assert.equal(result.text, '桥接成功');
  assert.equal(fetchCalls, 0);
});

test('preferBuiltin false puts workflow bridge before the builtin API', async () => {
  const base = configWithBuiltin();
  const config = {
    ...base,
    routing: {
      ...base.routing,
      preferBuiltin: false,
      workflowAssistantPresetName: '工作流主预设',
    },
  };
  let fetchCalls = 0;
  const result = await callWorldEvolutionApiWithRouting(config, [], {
    bridge: bridge('工作流优先'),
    fetchImpl: async () => {
      fetchCalls += 1;
      return jsonResponse({ content: '不应调用' });
    },
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.source, 'workflow-assistant');
  assert.equal(fetchCalls, 0);
});

test('effective route descriptors follow the selected source priority', () => {
  const base = configWithBuiltin();
  const config = {
    ...base,
    routing: {
      ...base.routing,
      preferBuiltin: false,
      workflowAssistantPresetName: '工作流主预设',
    },
  };
  const summary = resolveWorldEvolutionApiRouting(config, { bridge: bridge() });
  assert.deepEqual(
    summary.effectiveRoutes.map(route => route.source),
    ['workflow-assistant', 'builtin'],
  );
});

test('retryable builtin failure can fall through to the workflow bridge', async () => {
  const base = configWithBuiltin();
  const config = {
    ...base,
    routing: { ...base.routing, workflowAssistantPresetName: '工作流主预设' },
  };
  const result = await callWorldEvolutionApiWithRouting(config, [], {
    bridge: bridge('桥接接管'),
    fetchImpl: async () => jsonResponse({ error: 'down' }, 503),
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.source, 'workflow-assistant');
  assert.equal(result.text, '桥接接管');
  assert.deepEqual(
    result.routeAttempts.map(attempt => attempt.source),
    ['builtin', 'workflow-assistant'],
  );
});

test('authentication and parse failures do not blindly switch to the workflow bridge', async () => {
  const base = configWithBuiltin();
  const config = {
    ...base,
    routing: { ...base.routing, workflowAssistantPresetName: '工作流主预设' },
  };
  let bridgeCalls = 0;
  const workflow: WorldEvolutionWorkflowAssistantBridge = {
    callApi: async () => {
      bridgeCalls += 1;
      return { content: '不应调用' };
    },
  };
  const unauthorized = await callWorldEvolutionApiWithRouting(config, [], {
    bridge: workflow,
    fetchImpl: async () => jsonResponse({ error: 'unauthorized' }, 401),
  });
  assert.equal(unauthorized.ok, false);
  if (!unauthorized.ok) assert.equal(unauthorized.code, 'HTTP');
  assert.equal(bridgeCalls, 0);

  const parseFailure = await callWorldEvolutionApiWithRouting(config, [], {
    bridge: workflow,
    fetchImpl: async () => new Response('not-json', { status: 200 }),
  });
  assert.equal(parseFailure.ok, false);
  if (!parseFailure.ok) assert.equal(parseFailure.code, 'PARSE');
  assert.equal(bridgeCalls, 0);
});

test('an unavailable builtin route may fall through to a configured workflow bridge', async () => {
  const base = configWithBuiltin();
  const config = {
    ...base,
    presets: [{ ...base.presets[0]!, endpoint: '', model: '' }],
    routing: { ...base.routing, workflowAssistantPresetName: '工作流主预设' },
  };
  const result = await callWorldEvolutionApiWithRouting(config, [], {
    bridge: bridge('桥接接管配置错误'),
    fetchImpl: async () => jsonResponse({ content: '不应调用' }),
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.source, 'workflow-assistant');
  assert.deepEqual(
    result.routeAttempts.map(attempt => attempt.source),
    ['builtin', 'workflow-assistant'],
  );
});

test('bridge errors remain classified and do not expose a builtin route that was not configured', async () => {
  const config = createEmptyWorldEvolutionApiConfiguration(100);
  config.routing.workflowAssistantPresetName = '工作流主预设';
  const result = await callWorldEvolutionApiWithRouting(config, [], {
    bridge: {
      callApi: async () => {
        throw new Error('工作流助手暂时不可用');
      },
    },
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, 'BRIDGE');
  assert.equal(result.retryable, false);
  assert.match(result.message, /工作流助手暂时不可用/);
  assert.deepEqual(result.routeAttempts, [
    {
      source: 'workflow-assistant',
      presetName: '工作流主预设',
      ok: false,
      code: 'BRIDGE',
      retryable: false,
    },
  ]);
});

test('disabled or missing builtin presets do not make a builtin route available', () => {
  const config = configWithBuiltin();
  config.presets[0]!.enabled = false;
  config.routing.fallbackPresetIds = ['missing'];
  const summary = resolveWorldEvolutionApiRouting(config);
  assert.equal(summary.state, 'none');
  assert.deepEqual(summary.builtinPresetIds, []);
});

test('bridge metadata does not count as a route until a preset or default endpoint is configured', () => {
  const config = createEmptyWorldEvolutionApiConfiguration(100);
  config.routing.allowWorkflowAssistantBridge = true;
  const emptyBridge: WorldEvolutionWorkflowAssistantBridge = {
    available: false,
    callApi: async () => ({ content: '不应调用' }),
  };
  assert.equal(resolveWorldEvolutionApiRouting(config, { bridge: emptyBridge }).state, 'none');

  const configuredBridge: WorldEvolutionWorkflowAssistantBridge = {
    available: true,
    defaultConfig: { model: 'bridge-model', endpointConfigured: true, keyConfigured: true },
    presets: [],
    callApi: async () => ({ content: '桥接成功' }),
  };
  assert.equal(resolveWorldEvolutionApiRouting(config, { bridge: configuredBridge }).state, 'workflow-only');
});
