import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { createT15ApiTransport } from './t15-api-transport';
import { createT7Run } from './t7-run';
import { setupT8Test, deferredT8Test, executeT8Test } from './t8-test-fixtures';
import { finishT9Test, setupT9Test, untilT9Test } from './t9-test-fixtures';
import { fingerprintT4 } from './t4-protocol';
import { createT10SimulatedHost } from './t10-simulated-host';
import { createT10Gateway } from './t10-host-gateway';
import { frameT10Envelope, T10_NAMESPACE } from './t10-host-protocol';
import { openT10Session } from './t10-session';

const endpoint = 'https://invalid.example/chat/completions';
function init(signal = new AbortController().signal): RequestInit {
  return {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer fixture-key' },
    body: JSON.stringify({ model: 'fixture', messages: [] }),
  };
}
const envelope = (sql: string, parameters: unknown[] = []) =>
  new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ sql, parameters }) } }] }));

test('T15 real transport is lazy and forces credential/redirect isolation at each send', async () => {
  const seen: RequestInit[] = [],
    trace: string[] = [];
  const transport = createT15ApiTransport({
    authorize() {
      trace.push('authorize');
    },
    async fetchImpl(url, options) {
      assert.equal(url, endpoint);
      trace.push('fetch');
      seen.push(options!);
      return envelope('SELECT 1');
    },
  });
  assert.deepEqual(trace, []);
  const request = { ...init(), credentials: 'include' as const, redirect: 'follow' as const };
  await transport.dispatch(endpoint, request);
  await transport.dispatch(endpoint, request);
  assert.deepEqual(trace, ['authorize', 'fetch', 'authorize', 'fetch']);
  for (const sent of seen) {
    assert.equal(sent.credentials, 'omit');
    assert.equal(sent.redirect, 'error');
    assert.equal(sent.cache, 'no-store');
  }
  assert.equal(request.credentials, 'include');
});

for (const url of [
  'file:///secret',
  '/relative',
  'https://user:password@invalid.example/',
  'https://invalid.example/#fragment',
])
  test(`T15 transport refuses invalid endpoint ${url} before fetch`, async () => {
    let calls = 0;
    const transport = createT15ApiTransport({
      authorize() {},
      async fetchImpl() {
        calls++;
        return envelope('SELECT 1');
      },
    });
    await assert.rejects(transport.dispatch(url, init()));
    assert.equal(calls, 0);
  });
for (const change of [{ signal: undefined }, { method: 'GET' }, { body: 'a'.repeat(1_000_001) }, { headers: {} }])
  test(`T15 transport rejects malformed request ${Object.keys(change)[0]}`, async () => {
    let calls = 0;
    const transport = createT15ApiTransport({
      authorize() {},
      async fetchImpl() {
        calls++;
        return envelope('SELECT 1');
      },
    });
    await assert.rejects(transport.dispatch(endpoint, { ...init(), ...change }));
    assert.equal(calls, 0);
  });

test('T15 transport rechecks consent and cancellation without exposing authority error text', async () => {
  let calls = 0,
    allowed = true;
  const transport = createT15ApiTransport({
    authorize() {
      if (!allowed) throw new Error('private-token');
    },
    async fetchImpl() {
      calls++;
      return envelope('SELECT 1');
    },
  });
  await transport.dispatch(endpoint, init());
  allowed = false;
  await assert.rejects(
    transport.dispatch(endpoint, init()),
    e => e instanceof Error && !e.message.includes('private-token'),
  );
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(transport.dispatch(endpoint, init(abort.signal)), /已取消/);
  assert.equal(calls, 1);
});
test('T15 async authorization is rejected, never awaited as permission and never sent', async () => {
  let calls = 0;
  const transport = createT15ApiTransport({
    authorize: async () => {
      throw new Error('not synchronous');
    },
    async fetchImpl() {
      calls++;
      return envelope('SELECT 1');
    },
  });
  await assert.rejects(transport.dispatch(endpoint, init()), /未获准/);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(calls, 0);
});

test('T15 T7 preview/simulate cannot send real API; every real attempt needs a reservation', async () => {
  let calls = 0;
  const f = setupT8Test(),
    transport = createT15ApiTransport({
      authorize() {},
      async fetchImpl() {
        calls++;
        return envelope('SELECT __we_row_id FROM we_environment');
      },
    });
  const run = await createT7Run({ runId: 'real-run', ...f, transport });
  const request = (await run.plan('macro')).requests[0];
  assert.equal(calls, 0);
  assert.equal(run.view().mode, 't7-real-api');
  await assert.rejects(run.simulate(request.id), /模拟入口/);
  await assert.rejects(run.send(request.id), /持久发送预算/);
  await assert.rejects(run.send(request.id, { beforeSend: async () => {}, responses: [] }), /混入/);
  assert.equal(calls, 0);
  const result = await run.send(request.id, { beforeSend: async () => {} });
  assert.equal(result.ok, true);
  assert.equal(result.mode, 'real-api');
  assert.equal(calls, 1);
});
test('T15 reservation failure or cancellation while reserving never reaches HTTP', async () => {
  let calls = 0;
  const f = setupT8Test(),
    transport = createT15ApiTransport({
      authorize() {},
      async fetchImpl() {
        calls++;
        return envelope('SELECT __we_row_id FROM we_environment');
      },
    });
  const run = await createT7Run({ runId: 'real-run', ...f, transport }),
    request = (await run.plan('macro')).requests[0];
  const failed = await run.send(request.id, {
    beforeSend: async () => {
      throw new Error('failed');
    },
  });
  assert.equal(failed.ok, false);
  assert.equal(calls, 0);
  const controller = new AbortController(),
    gate = deferredT8Test<void>();
  const waiting = run.send(request.id, { signal: controller.signal, beforeSend: () => gate.promise });
  controller.abort();
  gate.resolve();
  await waiting;
  assert.equal(calls, 0);
});
test('T15 real control refuses missing reservation or mixed fake replies at construction', () => {
  const transport = createT15ApiTransport({
    authorize() {},
    async fetchImpl() {
      throw new Error('never');
    },
  });
  assert.throws(() => setupT8Test(undefined, { transport }), /持久发送/);
  assert.throws(
    () =>
      setupT8Test(undefined, {
        transport,
        reserveSend: async () => {},
        reply: async () => ({ status: 200, text: '{}' }),
      }),
    /混入/,
  );
});

test('T15 real HTTP loopback: macro→micro, refreshed conditions, one SQL commit; no provider or host touched', async () => {
  const stages: string[] = [],
    reservations: string[] = [];
  const server = createServer(async (request, response) => {
    try {
      let body = '';
      for await (const part of request) body += part.toString();
      const parsed = JSON.parse(body),
        macro = parsed.messages.some((m: { content: string }) => m.content.includes('"stage":"macro"'));
      assert.equal(request.method, 'POST');
      assert.equal(request.headers.cookie, undefined);
      assert.equal(parsed.model, 'model-fake');
      assert.equal(request.headers.authorization, 'Bearer private-t8-key-no-leak');
      const stage = macro ? 'macro' : 'micro';
      assert.equal(reservations.at(-1), stage);
      stages.push(stage);
      if (!macro) assert.match(JSON.stringify(parsed.messages), /80/);
      const sql = macro
        ? 'UPDATE we_environment SET f_risk = ? WHERE __we_row_id = ?'
        : 'UPDATE we_npc SET f_last_action = ? WHERE __we_row_id = ?';
      const parameters = macro ? [80, 'small-valley-weather'] : ['等待雨势减缓', 'traveler'];
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ sql, parameters }) } }] }));
    } catch {
      response.writeHead(400);
      response.end('{}');
    }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const transport = createT15ApiTransport({ authorize() {}, fetchImpl: fetch });
  const f = await setupT9Test(undefined, {
    transport,
    reserveSend: async input => {
      reservations.push(input.stage);
    },
  }); // Fixture reservation, not proof of native durable CAS.
  f.api.presets[0].endpoint = `http://127.0.0.1:${address.port}/chat/completions`;
  try {
    const v = await finishT9Test(f);
    assert.equal(v.status, 'saved', JSON.stringify(v.error));
    assert.equal(v.mode, 't9-real-api');
    assert.deepEqual(stages, ['macro', 'micro']);
    assert.deepEqual(reservations, stages);
    assert.equal(v.sent, 2);
    assert.equal(f.store.statistics.writes, 1);
    assert.equal(f.service.view().formal.data.tables.environment[0].values.risk, 80);
    assert.equal(f.service.view().formal.data.tables.npc[0].values.last_action, '等待雨势减缓');
    assert.doesNotMatch(JSON.stringify([v, f.store.exportStorage()]), /private-t8-key|Authorization|apiKey/);
  } finally {
    f.service.close();
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test('T15 real transport bad SQL leaves both stages and formal revision unchanged', async () => {
  let calls = 0;
  const transport = createT15ApiTransport({
    authorize() {},
    async fetchImpl() {
      return ++calls === 1
        ? envelope('UPDATE we_environment SET f_risk = ? WHERE __we_row_id = ?', [80, 'small-valley-weather'])
        : envelope('DROP TABLE we_npc');
    },
  });
  const f = await setupT9Test(undefined, { transport, reserveSend: async () => {} });
  const before = await fingerprintT4(f.service.view().formal);
  try {
    const v = await finishT9Test(f);
    assert.equal(v.status, 'failed');
    assert.equal(f.store.statistics.writes, 0);
    assert.equal(await fingerprintT4(f.service.view().formal), before);
    assert.equal(calls, 2);
  } finally {
    f.service.close();
  }
});

test('T15 configured HTTP retry repeats authorization/reservation but cannot exceed table budget', async () => {
  let calls = 0,
    authorized = 0,
    reserved = 0;
  const f = setupT8Test();
  f.api.presets[0].maxRetries = 4;
  f.state.template.tables[0].runtime.budget = {
    state: 'value',
    value: { ...f.state.template.defaults.budget, maxRequests: 2 },
  };
  const transport = createT15ApiTransport({
    authorize() {
      authorized++;
    },
    async fetchImpl() {
      calls++;
      return new Response('{}', { status: 503 });
    },
  });
  const run = await createT7Run({ runId: 'real-retry', ...f, transport }),
    request = (await run.plan('macro')).requests[0];
  assert.equal(request.maxRequests, 2);
  const result = await run.send(request.id, {
    beforeSend: async () => {
      reserved++;
    },
  });
  assert.equal(result.ok, false);
  assert.equal(calls, 2);
  assert.equal(reserved, 2);
  assert.equal(authorized, 2);
  assert.equal(run.view().sent, 2);
});
test('T15 revocation between configured retries stops the next HTTP dispatch', async () => {
  let calls = 0,
    allowed = true,
    reserved = 0;
  const f = setupT8Test();
  f.api.presets[0].maxRetries = 1;
  const transport = createT15ApiTransport({
    authorize() {
      if (!allowed) throw new Error('revoked');
    },
    async fetchImpl() {
      calls++;
      allowed = false;
      return new Response('{}', { status: 503 });
    },
  });
  const run = await createT7Run({ runId: 'real-revoke', ...f, transport }),
    request = (await run.plan('macro')).requests[0];
  const result = await run.send(request.id, {
    beforeSend: async () => {
      reserved++;
    },
  });
  assert.equal(result.ok, false);
  assert.equal(calls, 1);
  assert.equal(reserved, 2); // Reserved conservatively, not a billing receipt.
});

test('T15 retry keeps the original reservation callback even if the caller replaces its options', async () => {
  let calls = 0,
    reserved = 0;
  const f = setupT8Test();
  f.api.presets[0].maxRetries = 1;
  const options: { beforeSend?: () => Promise<void> } = {
    beforeSend: async () => {
      reserved++;
    },
  };
  const transport = createT15ApiTransport({
    authorize() {},
    async fetchImpl() {
      options.beforeSend = undefined;
      return ++calls === 1 ? new Response('{}', { status: 503 }) : envelope('SELECT __we_row_id FROM we_environment');
    },
  });
  const run = await createT7Run({ runId: 'retry-callback', ...f, transport }),
    request = (await run.plan('macro')).requests[0];
  assert.equal((await run.send(request.id, options)).ok, true);
  assert.equal(calls, 2);
  assert.equal(reserved, 2);
});
test('T15 real round cancellation discards late HTTP output and never starts micro or saves', async () => {
  let calls = 0;
  const gate = deferredT8Test<Response>();
  const transport = createT15ApiTransport({
    authorize() {},
    fetchImpl: async () => {
      calls++;
      return gate.promise;
    },
  });
  const f = await setupT9Test(undefined, { transport, reserveSend: async () => {} });
  const before = await fingerprintT4(f.service.view().formal);
  try {
    const job = await f.round.start('real-cancel');
    await untilT9Test(() => calls === 1);
    f.round.cancel();
    await job.done;
    gate.resolve(envelope('UPDATE we_environment SET f_risk = ? WHERE __we_row_id = ?', [80, 'small-valley-weather']));
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(f.round.view().status, 'cancelled');
    assert.equal(calls, 1);
    assert.equal(f.store.statistics.writes, 0);
    assert.equal(await fingerprintT4(f.service.view().formal), before);
  } finally {
    f.service.close();
  }
});
test('T15 a simulation controller cannot acquire real transport through later options mutation', async () => {
  let calls = 0;
  const f = setupT8Test();
  f.options.transport = createT15ApiTransport({
    authorize() {},
    async fetchImpl() {
      calls++;
      return envelope('SELECT 1');
    },
  });
  await (
    await f.control.start('still-simulation')
  ).done;
  assert.equal(f.control.view().mode, 't8-local-simulation');
  assert.equal(f.control.view().status, 'staged');
  assert.equal(calls, 0);
});

test('T15 real transport + simulated durable host: persist each reservation, then confirm one whole-round archive', async () => {
  const f = setupT8Test(),
    scope = {
      mode: 't10-host' as const,
      chatId: 'chat-transport',
      worldId: f.state.data.worldId,
      branchId: f.state.data.branchId,
    };
  const host = createT10SimulatedHost({
    binding: { hostChatId: 'fixture-chat', characterId: 'fixture-card.png' },
    variables: { unrelated: '保持' },
    messages: [
      {
        message_id: 0,
        name: '叙述者',
        role: 'assistant',
        is_hidden: false,
        swipe_id: 0,
        swipes: ['暴雨加剧，道路受阻。'],
        swipes_data: [{}],
        swipes_info: [{}],
      },
    ],
  });
  const gateway = createT10Gateway(host.driver);
  let allocated = 0;
  await gateway.initialize(scope, f.state, kind => `${kind}-${++allocated}`);
  const anchor = await gateway.capture(scope, 0, f.input.anchor.inputFingerprint);
  const input = {
    ...f.input,
    anchor,
    story: [{ messageId: anchor.messageId, role: 'assistant' as const, text: '暴雨加剧，道路受阻。' }],
  };
  let sends = 0;
  const transport = createT15ApiTransport({
    authorize() {},
    async fetchImpl() {
      const document = await host.driver.readDurable(host.driver.currentBinding()),
        run = frameT10Envelope(document.variables[T10_NAMESPACE]).runs[0];
      assert.equal(run.sent, sends + 1);
      assert.equal(run.phase, sends === 0 ? 'macro' : 'micro');
      return ++sends === 1
        ? envelope('UPDATE we_environment SET f_risk = ? WHERE __we_row_id = ?', [80, 'small-valley-weather'])
        : envelope('UPDATE we_npc SET f_last_action = ? WHERE __we_row_id = ?', ['等待雨势减缓', 'traveler']);
    },
  });
  const session = await openT10Session({
    driver: host.driver,
    scope,
    execute: executeT8Test,
    runtime: { ...f.options, transport, readInput: () => input },
  });
  try {
    await (
      await session.round.start('durable-send')
    ).done;
    assert.equal(session.round.view().status, 'saved', JSON.stringify(session.round.view().error));
    const archive = await gateway.read(scope);
    assert.equal(archive.commits.length, 1);
    assert.equal(sends, 2);
    const document = await host.driver.readDurable(host.driver.currentBinding());
    assert.equal(document.variables.unrelated, '保持');
    assert.doesNotMatch(JSON.stringify(document), /private-t8-key|Authorization|apiKey/);
  } finally {
    session.close();
  }
});
