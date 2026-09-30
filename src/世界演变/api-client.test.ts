import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createEmptyWorldEvolutionApiConfiguration, upsertWorldEvolutionApiPreset } from './api-config';
import {
  callWorldEvolutionApi,
  callWorldEvolutionApiPreset,
  type WorldEvolutionApiFetch,
} from './api-client';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function createPreset(overrides: Record<string, unknown> = {}) {
  const config = upsertWorldEvolutionApiPreset(
    createEmptyWorldEvolutionApiConfiguration(100),
    {
      id: 'primary',
      name: '主 API',
      endpoint: 'https://example.test/v1/chat/completions',
      apiKey: 'secret',
      model: 'model-a',
      ...overrides,
    },
    101,
  );
  return config.presets[0];
}

test('OpenAI-compatible client sends a JSON request and extracts message content', async () => {
  let requestBody: Record<string, unknown> | undefined;
  const fetchImpl: WorldEvolutionApiFetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return jsonResponse({
      id: 'req-1',
      choices: [{ message: { content: '  模拟响应  ' } }],
    });
  };

  const result = await callWorldEvolutionApiPreset(
    createPreset(),
    [{ role: 'user', content: '模拟请求' }],
    { fetchImpl, now: () => 200 },
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.text, '模拟响应');
  assert.equal(result.requestId, 'req-1');
  assert.deepEqual(requestBody, {
    model: 'model-a',
    messages: [{ role: 'user', content: '模拟请求' }],
  });
});

test('429 retries with injected sleep and succeeds without waiting in real time', async () => {
  let calls = 0;
  const delays: number[] = [];
  const fetchImpl: WorldEvolutionApiFetch = async () => {
    calls += 1;
    return calls === 1 ? jsonResponse({ error: 'busy' }, 429) : jsonResponse({ content: '恢复' });
  };
  const result = await callWorldEvolutionApiPreset(createPreset({ maxRetries: 1 }), [], {
    fetchImpl,
    sleep: async delay => {
      delays.push(delay);
    },
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.attempts, 2);
  assert.deepEqual(delays, [400]);
});

test('timeout is classified as retryable and does not call a real API', async () => {
  const fetchImpl: WorldEvolutionApiFetch = (_input, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('timeout', 'AbortError')), {
        once: true,
      });
    });
  const result = await callWorldEvolutionApiPreset({ ...createPreset({ maxRetries: 0 }), timeoutMs: 5 }, [], {
    fetchImpl,
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, 'TIMEOUT');
  assert.equal(result.retryable, true);
});

test('retryable primary failure falls through to the configured backup', async () => {
  const first = createPreset({ id: 'primary', endpoint: 'https://primary.test' });
  const backup = { ...createPreset({ id: 'backup', name: '备用 API', endpoint: 'https://backup.test' }) };
  const config = createEmptyWorldEvolutionApiConfiguration(100);
  config.presets = [first, backup];
  config.routing.primaryPresetId = 'primary';
  config.routing.fallbackPresetIds = ['backup'];
  const seen: string[] = [];
  const fetchImpl: WorldEvolutionApiFetch = async input => {
    seen.push(input);
    return input.includes('primary') ? jsonResponse({ error: 'down' }, 503) : jsonResponse({ content: '备用成功' });
  };

  const result = await callWorldEvolutionApi(config, [], {
    fetchImpl,
    sleep: async () => {},
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.presetId, 'backup');
  assert.deepEqual(seen, [
    'https://primary.test',
    'https://primary.test',
    'https://primary.test',
    'https://backup.test',
  ]);
});

test('authentication failure does not blindly switch to a backup', async () => {
  const first = createPreset({ id: 'primary' });
  const backup = { ...createPreset({ id: 'backup', name: '备用 API' }) };
  const config = createEmptyWorldEvolutionApiConfiguration(100);
  config.presets = [first, backup];
  config.routing.primaryPresetId = 'primary';
  config.routing.fallbackPresetIds = ['backup'];
  let calls = 0;
  const result = await callWorldEvolutionApi(config, [], {
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse({ error: 'unauthorized' }, 401);
    },
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, 'HTTP');
  assert.equal(result.status, 401);
  assert.equal(result.retryable, false);
  assert.equal(calls, 1);
});

test('invalid JSON and missing route are classified as non-retryable configuration errors', async () => {
  const parseResult = await callWorldEvolutionApiPreset(createPreset(), [], {
    fetchImpl: async () =>
      new Response('not-json', {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      }),
  });
  assert.equal(parseResult.ok, false);
  if (!parseResult.ok) assert.equal(parseResult.code, 'PARSE');

  const emptyConfig = createEmptyWorldEvolutionApiConfiguration();
  const configResult = await callWorldEvolutionApi(emptyConfig, []);
  assert.equal(configResult.ok, false);
  if (!configResult.ok) assert.equal(configResult.code, 'CONFIG');
});
