import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { T0SandboxAiFixture, T0SandboxJson, T0SandboxScope } from './t0-sandbox';

test('T0 module import, construction, reads and fake writes never access real global capabilities', async t => {
  const accessed: string[] = [];
  const names = [
    'fetch',
    'indexedDB',
    'localStorage',
    'sessionStorage',
    'window',
    'parent',
    'document',
    'TavernHelper',
    'SillyTavern',
    'Mvu',
    'generate',
    'generateRaw',
    'getVariables',
    'replaceVariables',
    'getChatMessages',
    'setChatMessages',
    'getWorldbook',
    'replaceWorldbook',
    'eventOn',
  ];
  const descriptors = names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
  t.after(() => {
    for (const [name, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  });
  for (const name of names) {
    Object.defineProperty(globalThis, name, {
      configurable: true,
      get() {
        accessed.push(name);
        throw new Error(`Real capability must not be accessed: ${name}`);
      },
    });
  }

  const { createT0Sandbox } = await import('./t0-sandbox');
  const sandbox = createT0Sandbox({
    aiFixtures: [
      { kind: 'success', response: { note: 'fixture only' } },
      { kind: 'failure', message: 'fixture error' },
    ],
    hostJsonFixture: { status: 'unchanged' },
  });
  assert.deepEqual(sandbox.hostJson.read(sandbox.scope), { status: 'unchanged' });
  assert.deepEqual(sandbox.worldbook.read(sandbox.scope), []);
  assert.deepEqual(sandbox.ai.readRequests(sandbox.scope), []);
  sandbox.hostJson.write(sandbox.scope, { status: 'memory only' });
  sandbox.worldbook.replace(sandbox.scope, [{ name: 'fake entry' }]);
  assert.deepEqual(await sandbox.ai.request(sandbox.scope, { stage: 'fake' }), { note: 'fixture only' });
  await assert.rejects(sandbox.ai.request(sandbox.scope, {}), /simulated AI failure/);
  await assert.rejects(sandbox.ai.request(sandbox.scope, {}), /no real API fallback/);
  assert.deepEqual(accessed, []);
});

test('T0 factories produce distinct, clearly sandbox-prefixed, immutable scopes', async () => {
  const { createT0Sandbox, T0_SANDBOX_PREFIX } = await import('./t0-sandbox');
  const first = createT0Sandbox({ label: 'same-label', aiFixtures: [] });
  const second = createT0Sandbox({ label: 'same-label', aiFixtures: [] });
  assert.equal(first.mode, 'fixture-only-memory');
  assert.ok(first.scope.scopeId.startsWith(T0_SANDBOX_PREFIX));
  assert.ok(first.scope.worldId.startsWith(T0_SANDBOX_PREFIX));
  assert.notEqual(first.scope.scopeId, second.scope.scopeId);
  assert.notEqual(first.scope.worldId, second.scope.worldId);
  assert.ok(Object.isFrozen(first.scope));
  assert.ok(Object.isFrozen(first));
  assert.equal(first.hostJson.read(first.scope), undefined);
});

test('T0 fake AI consumes only explicit fixtures, including failures, and never retries itself', async () => {
  const { createT0Sandbox } = await import('./t0-sandbox');
  const sandbox = createT0Sandbox({
    aiFixtures: [
      { kind: 'failure', message: 'simulated timeout' },
      { kind: 'success', response: { value: 2 } },
    ],
    hostJsonFixture: { value: 0 },
    worldbookFixture: [{ value: 0 }],
  });
  await assert.rejects(sandbox.ai.request(sandbox.scope, { input: 1 }), /simulated timeout/);
  assert.deepEqual(sandbox.hostJson.read(sandbox.scope), { value: 0 });
  assert.deepEqual(sandbox.worldbook.read(sandbox.scope), [{ value: 0 }]);
  assert.deepEqual(await sandbox.ai.request(sandbox.scope, { input: 2 }), { value: 2 });
  await assert.rejects(sandbox.ai.request(sandbox.scope, { input: 3 }), /queue exhausted/);
  assert.deepEqual(sandbox.ai.readRequests(sandbox.scope), [{ input: 1 }, { input: 2 }, { input: 3 }]);
});

test('T0 fake adapters reject foreign scopes, production-like scopes and mismatched world identities', async () => {
  const { createT0Sandbox } = await import('./t0-sandbox');
  const first = createT0Sandbox({ aiFixtures: [{ kind: 'success', response: 'still available' }] });
  const second = createT0Sandbox({ aiFixtures: [] });
  const invalidScopes: T0SandboxScope[] = [
    second.scope,
    { scopeId: 'world-evolution:live:chat', worldId: 'live-world' },
    { ...first.scope, worldId: second.scope.worldId },
  ];
  for (const scope of invalidScopes) {
    assert.throws(() => first.hostJson.read(scope), /outside its own scope/);
    assert.throws(() => first.hostJson.write(scope, { value: 'wrong' }), /outside its own scope/);
    assert.throws(() => first.worldbook.read(scope), /outside its own scope/);
    assert.throws(() => first.worldbook.replace(scope, []), /outside its own scope/);
    assert.throws(() => first.ai.readRequests(scope), /outside its own scope/);
    await assert.rejects(first.ai.request(scope, {}), /outside its own scope/);
  }
  assert.equal(first.hostJson.read(first.scope), undefined);
  assert.deepEqual(first.worldbook.read(first.scope), []);
  assert.deepEqual(first.ai.readRequests(first.scope), []);
  assert.equal(await first.ai.request(first.scope, {}), 'still available');
});

test('T0 instances keep separate fake JSON, worldbook and AI state even with identical labels and seeds', async () => {
  const { createT0Sandbox } = await import('./t0-sandbox');
  const options = {
    label: 'fixture',
    aiFixtures: [{ kind: 'success' as const, response: 'result' }],
    hostJsonFixture: { value: 0 },
    worldbookFixture: [{ name: 'initial' }],
  };
  const first = createT0Sandbox(options);
  const second = createT0Sandbox(options);
  first.hostJson.write(first.scope, { value: 1 });
  first.worldbook.replace(first.scope, [{ name: 'first only' }]);
  await first.ai.request(first.scope, { from: 'first' });
  assert.deepEqual(second.hostJson.read(second.scope), { value: 0 });
  assert.deepEqual(second.worldbook.read(second.scope), [{ name: 'initial' }]);
  assert.deepEqual(second.ai.readRequests(second.scope), []);
  assert.equal(await second.ai.request(second.scope, {}), 'result');
});

test('T0 clones constructor fixtures so later external mutation cannot rewrite its state or AI response', async () => {
  const { createT0Sandbox } = await import('./t0-sandbox');
  const response = { rows: [{ name: 'original' }] };
  const fixtures: T0SandboxAiFixture[] = [{ kind: 'success', response }];
  const json = { rows: [{ name: 'original' }] };
  const entries = [{ name: 'original' }];
  const sandbox = createT0Sandbox({ aiFixtures: fixtures, hostJsonFixture: json, worldbookFixture: entries });
  response.rows[0].name = 'external';
  fixtures.length = 0;
  json.rows[0].name = 'external';
  entries[0].name = 'external';
  assert.deepEqual(sandbox.hostJson.read(sandbox.scope), { rows: [{ name: 'original' }] });
  assert.deepEqual(sandbox.worldbook.read(sandbox.scope), [{ name: 'original' }]);
  assert.deepEqual(await sandbox.ai.request(sandbox.scope, {}), { rows: [{ name: 'original' }] });
});

test('T0 clones fake writes, reads, AI input and request-log reads across every adapter boundary', async () => {
  const { createT0Sandbox } = await import('./t0-sandbox');
  const sandbox = createT0Sandbox({ aiFixtures: [{ kind: 'success', response: { note: 'done' } }] });
  const json = { rows: [{ name: 'write' }] };
  const entries = [{ name: 'write' }];
  const request = { input: { text: 'sent' } };
  sandbox.hostJson.write(sandbox.scope, json);
  sandbox.worldbook.replace(sandbox.scope, entries);
  await sandbox.ai.request(sandbox.scope, request);
  json.rows[0].name = 'external';
  entries[0].name = 'external';
  request.input.text = 'external';
  const readJson = sandbox.hostJson.read(sandbox.scope) as typeof json;
  const readEntries = sandbox.worldbook.read(sandbox.scope) as typeof entries;
  const requests = sandbox.ai.readRequests(sandbox.scope) as (typeof request)[];
  readJson.rows[0].name = 'changed read';
  readEntries[0].name = 'changed read';
  requests[0].input.text = 'changed read';
  assert.deepEqual(sandbox.hostJson.read(sandbox.scope), { rows: [{ name: 'write' }] });
  assert.deepEqual(sandbox.worldbook.read(sandbox.scope), [{ name: 'write' }]);
  assert.deepEqual(sandbox.ai.readRequests(sandbox.scope), [{ input: { text: 'sent' } }]);
});

test('T0 rejects non-JSON inputs without calling getters, custom serializers or consuming AI fixtures', async () => {
  const { createT0Sandbox } = await import('./t0-sandbox');
  let called = 0;
  const accessor = Object.defineProperty({}, 'value', {
    enumerable: true,
    get() {
      called += 1;
      return 'side effect';
    },
  });
  const customSerializer = {
    toJSON() {
      called += 1;
      return 'side effect';
    },
  };
  const sandbox = createT0Sandbox({ aiFixtures: [{ kind: 'success', response: null }], hostJsonFixture: null });
  const invalid = [undefined, Infinity, NaN, new Date(0), customSerializer, accessor, [undefined], Array(1)];
  for (const value of invalid) {
    assert.throws(() => sandbox.hostJson.write(sandbox.scope, value as T0SandboxJson), /T0 sandbox/);
    await assert.rejects(sandbox.ai.request(sandbox.scope, value as T0SandboxJson), /T0 sandbox/);
  }
  assert.equal(called, 0);
  assert.equal(sandbox.hostJson.read(sandbox.scope), null);
  assert.deepEqual(sandbox.ai.readRequests(sandbox.scope), []);
  assert.equal(await sandbox.ai.request(sandbox.scope, {}), null);
});

test('T0 rejects invalid labels and unsupported fake AI fixture kinds', async () => {
  const { createT0Sandbox } = await import('./t0-sandbox');
  assert.throws(() => createT0Sandbox({ label: 'live/chat', aiFixtures: [] }), /label/);
  assert.throws(() => createT0Sandbox({ label: '', aiFixtures: [] }), /label/);
  assert.throws(
    () => createT0Sandbox({ aiFixtures: [{ kind: 'live' } as unknown as T0SandboxAiFixture] }),
    /explicit success or failure/,
  );
});
