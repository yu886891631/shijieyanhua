import assert from 'node:assert/strict';
import test from 'node:test';
import { createT15CompatibilityHost, encodeT15OwnedChat, type T15CompatibilityPort } from './t15-chat-compatibility';
import { decodeT15Chat } from './t15-host-read';
import {
  canWriteT10,
  canWriteT10Compatibility,
  createT10Gateway,
  createT10CompatibilityGateway,
} from './t10-host-gateway';
import { inspectT10Host, inspectT10CompatibilityHost } from './t10-recovery';
import { openT10Session, openT10CompatibilitySession } from './t10-session';
import { copyT10, initializeT10Document, frameT10Envelope, T10_NAMESPACE as NS } from './t10-host-protocol';
import { fingerprintT4, type T4Scope } from './t4-protocol';
import { createT4CommitService } from './t4-service';
import { createT3LocalPolicy } from './t3-engine';
import { setupT8Test, executeT8Test, deferredT8Test } from './t8-test-fixtures';
import { createT15ApiTransport } from './t15-api-transport';

const binding = { hostChatId: 'fixture-chat', characterId: 'fixture-card.png' };
const scope: T4Scope = { mode: 't10-host', chatId: 'chat-one', worldId: 'demo-world', branchId: 'demo-main' };
function allocator() {
  let n = 0;
  return (kind: 'message' | 'swipe') => `${kind}-${++n}`;
}
function rawRecords() {
  return [
    {
      user_name: 'unused',
      character_name: 'unused',
      customHeader: { preserved: ['保留'] },
      chat_metadata: { integrity: 'fixture-only', variables: { TavernDB: { table: ['保留'] } }, custom: true },
    },
    { name: '玩家', is_user: true, is_system: false, mes: '等待', extra: { unrelated: true } },
    {
      name: '角色',
      is_user: false,
      is_system: false,
      mes: '暴雨加剧，道路受阻。',
      swipes: ['小雨', '暴雨加剧，道路受阻。'],
      swipe_id: 1,
      variables: [{ stat_data: { hp: 10 } }, { stat_data: { hp: 9 }, custom: true }],
      swipe_info: [{ extra: { preserved: true } }],
      extra: { preserved: true },
      otherPlugin: { preserved: true },
    },
  ];
}
function fixture(leaseTarget = {}) {
  let server: unknown[] = copyT10(rawRecords()),
    saveHook: ((body: Record<string, unknown>) => void | Promise<void>) | null = null,
    readHook: (() => void) | null = null,
    hide = () => {};
  const metadata = copyT10(rawRecords()[0].chat_metadata!),
    context = {
      groupId: null,
      characterId: 0,
      characters: [{ avatar: binding.characterId, chat: binding.hostChatId, name: '角色' }],
      chat: copyT10(rawRecords().slice(1)) as unknown[],
      getCurrentChatId: () => context.characters[0].chat,
      getRequestHeaders: () => ({ 'X-CSRF-TOKEN': 'test-only' }),
    },
    callbacks = new Map<string, () => void>(),
    calls: { url: string; init: RequestInit }[] = [];
  let saves = 0;
  const port: T15CompatibilityPort = {
    origin: 'http://127.0.0.1:8000',
    version: 'fixture-not-real-host',
    context: () => context,
    metadata: () => metadata,
    characterName: () => '角色',
    leaseTarget,
    events: Object.fromEntries(
      [
        'CHAT_CHANGED',
        'MESSAGE_DELETED',
        'MESSAGE_EDITED',
        'MESSAGE_UPDATED',
        'MESSAGE_SWIPED',
        'MESSAGE_SWIPE_DELETED',
        'MESSAGE_SENT',
        'MESSAGE_RECEIVED',
        'GENERATION_STARTED',
        'GENERATION_STOPPED',
        'CHARACTER_EDITED',
        'CHARACTER_DELETED',
        'WORLDINFO_UPDATED',
        'WORLDINFO_SETTINGS_UPDATED',
      ].map(id => [id, id]),
    ),
    on(event, listener) {
      callbacks.set(event, listener);
      return {
        stop: () => {
          callbacks.delete(event);
        },
      };
    },
    onPageHide(listener) {
      hide = listener;
      return () => {
        hide = () => {};
      };
    },
    getPrimary: () => ({ primary: '主世界书', additional: [] }),
    getWorldbook: async () => [],
    async fetchImpl(url, init) {
      calls.push({ url, init });
      if (url.endsWith('/api/characters/chats'))
        return new Response(JSON.stringify([{ file_name: 'fixture-chat.jsonl' }]));
      if (url.endsWith('/api/chats/get')) {
        readHook?.();
        return new Response(JSON.stringify(server));
      }
      assert.ok(url.endsWith('/api/chats/save'));
      saves++;
      const body = JSON.parse(String(init.body));
      server = copyT10(body.chat);
      await saveHook?.(body);
      return new Response('{}');
    },
  };
  return {
    port,
    context,
    metadata,
    calls,
    callbacks,
    server: () => copyT10(server),
    saves: () => saves,
    mutateServer: (mutate: (raw: unknown[]) => void) => mutate(server),
    saveHook: (hook: typeof saveHook) => {
      saveHook = hook;
    },
    readHook: (hook: typeof readHook) => {
      readHook = hook;
    },
    hide: () => hide(),
  };
}
async function initialized() {
  const f = fixture(),
    host = createT15CompatibilityHost(f.port),
    gateway = createT10CompatibilityGateway(host.driver),
    run = setupT8Test();
  await gateway.initialize(scope, run.state, allocator());
  return { f, host, gateway, run };
}
async function proposal(f: ReturnType<typeof fixture>, host: ReturnType<typeof createT15CompatibilityHost>) {
  const previous = await host.driver.readDurable(binding);
  return {
    binding,
    expectedFingerprint: await fingerprintT4(previous),
    document: await initializeT10Document(previous, scope, setupT8Test().state, allocator()),
    authorize() {},
  };
}

test('T15 compatible mode is lazy, separate from strict CAS; ordinary flags cannot unlock it', async () => {
  const f = fixture(),
    host = createT15CompatibilityHost(f.port);
  try {
    assert.equal(f.calls.length, 0);
    assert.equal(canWriteT10(host.driver), false);
    assert.equal(canWriteT10Compatibility(host.driver), true);
    assert.equal(host.driver.capabilities.atomicDocumentCas, false);
    await assert.rejects(
      createT10Gateway(host.driver).initialize(scope, setupT8Test().state, allocator()),
      /CAPABILITY/,
    );
    await assert.rejects(
      openT10Session({ driver: host.driver, scope, execute: executeT8Test, runtime: setupT8Test().options }),
      /CAPABILITY/,
    );
    assert.equal(f.calls.length, 0);
    assert.equal(
      canWriteT10Compatibility({
        ...host.driver,
        capabilities: { ...host.driver.capabilities, environment: 'unverified-host' },
      }),
      false,
    );
    assert.equal(canWriteT10Compatibility({ ...host.driver, writableNow: undefined }), false);
    assert.equal(
      canWriteT10Compatibility({
        ...host.driver,
        capabilities: { ...host.driver.capabilities, atomicDocumentCas: true },
      }),
      false,
    );
  } finally {
    host.close();
  }
});

test('T15 owned encoder preserves all unrelated header/messages/swipes/MVU/DB, without modifying the input', async () => {
  const raw = rawRecords(),
    original = JSON.stringify(raw),
    base = await decodeT15Chat(binding, raw),
    next = await initializeT10Document(base.document, scope, setupT8Test().state, allocator()),
    result = await encodeT15OwnedChat(base, next);
  assert.equal(JSON.stringify(raw), original);
  const stripped = copyT10(result.raw);
  delete (stripped[0].chat_metadata as { variables: Record<string, unknown> }).variables[NS];
  for (const msg of stripped.slice(1)) {
    const data = msg.variables as Record<string, unknown>[] | undefined;
    if (data) for (const value of data) delete value[NS];
  }
  delete stripped[1].variables; // Absent in original; initialized stable ID slots only.
  assert.deepEqual(stripped, raw);
  assert.equal(result.document.messages[1].swipe_id, 1);
  assert.equal(frameT10Envelope(result.document.variables[NS]).archive.commits.length, 0);
});
for (const field of ['story', 'swipe', 'mvu', 'metadata', 'other-plugin'] as const)
  test(`T15 encoder refuses non-owned proposal changes: ${field}`, async () => {
    const base = await decodeT15Chat(binding, rawRecords()),
      next = await initializeT10Document(base.document, scope, setupT8Test().state, allocator());
    if (field === 'story') next.messages[1].mes = '篡改';
    if (field === 'swipe') next.messages[1].swipes[0] = '篡改';
    if (field === 'mvu') next.messages[1].swipes_data[1].stat_data = { hp: 999 };
    if (field === 'metadata') next.variables.TavernDB = { table: ['篡改'] };
    if (field === 'other-plugin') next.messages[1].otherPlugin = { preserved: false };
    await assert.rejects(encodeT15OwnedChat(base, next), /CONFLICT/);
  });

test('T15 compatible save persists namespace and stable IDs, mirrors live memory, reads back and recovers query-only', async () => {
  const { f, host, gateway } = await initialized();
  try {
    assert.equal(f.saves(), 1);
    const request = f.calls.find(c => c.url.endsWith('/api/chats/save'))!;
    assert.equal(JSON.parse(String(request.init.body)).force, false);
    assert.equal(request.init.credentials, 'same-origin');
    assert.equal(new Headers(request.init.headers).has('Authorization'), false);
    assert.equal(new Headers(request.init.headers).get('X-CSRF-TOKEN'), 'test-only');
    assert.deepEqual(f.context.chat, f.server().slice(1));
    assert.deepEqual(f.metadata, (f.server()[0] as { chat_metadata: unknown }).chat_metadata);
    assert.equal((await gateway.read(scope)).commits.length, 0);
    assert.equal((await inspectT10Host(host.driver)).writable, false);
    const recovered = await inspectT10CompatibilityHost(host.driver);
    assert.equal(recovered.status, 'ready');
    assert.equal(recovered.source, 'compatibility-host');
    assert.equal(recovered.writable, true);
    assert.match(recovered.notices.join(' '), /一个活动页面/);
    assert.equal(f.saves(), 1); // Recovery does not auto-save or auto-send.
  } finally {
    host.close();
  }
});
for (const mutation of ['header', 'message', 'live-mvu', 'live-metadata'] as const)
  test(`T15 changed full server JSONL or unsaved live state refuses save: ${mutation}`, async () => {
    const f = fixture(),
      host = createT15CompatibilityHost(f.port);
    try {
      const input = await proposal(f, host);
      if (mutation === 'header')
        f.mutateServer(raw => {
          (raw[0] as Record<string, unknown>).unrelated = true;
        });
      if (mutation === 'message')
        f.mutateServer(raw => {
          (raw[1] as Record<string, unknown>).mes = '不同剧情';
        });
      if (mutation === 'live-mvu')
        (f.context.chat[1] as { variables: Record<string, unknown>[] }).variables[1].stat_data = { hp: 888 };
      if (mutation === 'live-metadata') f.metadata.custom = false;
      await assert.rejects(host.driver.compareDocument(input), /CONFLICT/);
      assert.equal(f.saves(), 0);
      assert.equal(canWriteT10Compatibility(host.driver), false);
    } finally {
      host.close();
    }
  });

for (const fault of [
  'network-after-save',
  'readback-mismatch',
  'readback-fails',
  'cancel-after-save',
  'event-after-save',
] as const)
  test(`T15 uncertain result is query-only and never retried: ${fault}`, async () => {
    const f = fixture(),
      host = createT15CompatibilityHost(f.port),
      controller = new AbortController();
    try {
      const input = await proposal(f, host);
      f.saveHook(() => {
        if (fault === 'network-after-save') throw new Error('potentially secret failure');
        if (fault === 'readback-mismatch')
          f.mutateServer(raw => {
            (raw[0] as Record<string, unknown>).unrelated = true;
          });
        if (fault === 'readback-fails')
          f.readHook(() => {
            throw new Error('read failed');
          });
        if (fault === 'cancel-after-save') controller.abort();
        if (fault === 'event-after-save') f.callbacks.get('MESSAGE_EDITED')!();
      });
      await assert.rejects(host.driver.compareDocument({ ...input, signal: controller.signal }), /ACK_LOST/);
      assert.equal(host.status().state, 'uncertain');
      assert.equal(f.saves(), 1);
      assert.equal(canWriteT10Compatibility(host.driver), false);
      await assert.rejects(host.driver.compareDocument(input), /CAPABILITY/);
      f.readHook(null);
      const recovered = await inspectT10CompatibilityHost(host.driver);
      assert.equal(recovered.writable, false);
      assert.equal(f.saves(), 1);
      assert.ok((f.metadata.variables as Record<string, unknown>)[NS]); // No blind memory rollback.
    } finally {
      host.close();
    }
  });

for (const authorization of ['abort', 'async', 'change-live'] as const)
  test(`T15 final authorization is synchronous, rechecked and precedes live mutation: ${authorization}`, async () => {
    const f = fixture(),
      host = createT15CompatibilityHost(f.port),
      controller = new AbortController();
    try {
      const input = await proposal(f, host);
      const authorize = () => {
        if (authorization === 'abort') controller.abort();
        if (authorization === 'async') return Promise.reject(new Error('must not leak'));
        if (authorization === 'change-live') f.metadata.custom = false;
      };
      await assert.rejects(
        host.driver.compareDocument({ ...input, signal: controller.signal, authorize }),
        /ABORTED|CONFLICT/,
      );
      assert.equal(f.saves(), 0);
      assert.equal((f.metadata.variables as Record<string, unknown>)[NS], undefined);
    } finally {
      host.close();
    }
  });

test('T15 same-page duplicate writer rejected; close and pagehide release all listeners and ownership', () => {
  const shared = {},
    f = fixture(shared),
    host = createT15CompatibilityHost(f.port);
  assert.throws(() => createT15CompatibilityHost(fixture(shared).port), /CONFLICT/);
  host.close();
  host.close();
  assert.equal(f.callbacks.size, 0);
  const second = fixture(shared),
    next = createT15CompatibilityHost(second.port);
  second.hide();
  assert.equal(next.status().state, 'closed');
  assert.equal(second.callbacks.size, 0);
  assert.equal(next.status().ownsPage, false);
});

test('T15 unload while a save is pending retains same-page ownership until the result settles', async () => {
  const shared = {},
    f = fixture(shared),
    host = createT15CompatibilityHost(f.port),
    gate = deferredT8Test<void>();
  try {
    const input = await proposal(f, host);
    f.saveHook(() => gate.promise);
    const pending = host.driver.compareDocument(input);
    while (f.saves() === 0) await new Promise(resolve => setTimeout(resolve, 1));
    f.hide();
    assert.throws(() => createT15CompatibilityHost(fixture(shared).port), /CONFLICT/);
    gate.resolve();
    await assert.rejects(pending, /ACK_LOST/);
    assert.equal(host.status().state, 'closed');
    const next = createT15CompatibilityHost(fixture(shared).port);
    next.close();
  } finally {
    gate.resolve();
    host.close();
  }
});

test('T15 frozen live fields fail before mutation or POST', async () => {
  const f = fixture(),
    host = createT15CompatibilityHost(f.port);
  try {
    const input = await proposal(f, host);
    Object.freeze(f.context.chat[1]);
    await assert.rejects(host.driver.compareDocument(input), /CAPABILITY/);
    assert.equal(f.saves(), 0);
    assert.equal((f.metadata.variables as Record<string, unknown>)[NS], undefined);
  } finally {
    host.close();
  }
});

test('T15 port mutation after construction cannot retarget a chat write or replace its headers', async () => {
  const f = fixture(),
    host = createT15CompatibilityHost(f.port);
  try {
    const input = await proposal(f, host);
    let foreignCalls = 0;
    f.port.origin = 'https://foreign.invalid';
    f.port.fetchImpl = async () => {
      foreignCalls++;
      throw new Error();
    };
    f.port.context = () => {
      throw new Error();
    };
    await host.driver.compareDocument(input);
    assert.equal(f.saves(), 1);
    assert.equal(foreignCalls, 0);
    assert.ok(f.calls.every(c => c.url.startsWith('http://127.0.0.1:8000/')));
  } finally {
    host.close();
  }
});

test('T15 concurrent writes in one driver are rejected, not queued with an obsolete proposal', async () => {
  const f = fixture(),
    host = createT15CompatibilityHost(f.port),
    gate = deferredT8Test<void>();
  try {
    const input = await proposal(f, host);
    f.saveHook(() => gate.promise);
    const pending = host.driver.compareDocument(input);
    while (f.saves() === 0) await new Promise(resolve => setTimeout(resolve, 1));
    await assert.rejects(host.driver.compareDocument(input), /CONFLICT/);
    gate.resolve();
    await pending;
    assert.equal(f.saves(), 1);
  } finally {
    gate.resolve();
    host.close();
  }
});

test('T15 captured authorization, document and cancellation cannot be replaced across awaits', async () => {
  const f = fixture(),
    host = createT15CompatibilityHost(f.port),
    controller = new AbortController();
  try {
    const input = { ...(await proposal(f, host)), signal: controller.signal };
    let allowed = true;
    input.authorize = () => {
      if (!allowed) throw new Error('revoked');
    };
    const pending = host.driver.compareDocument(input);
    input.authorize = () => {};
    input.signal = new AbortController().signal;
    input.document.variables.TavernDB = { altered: true };
    controller.abort();
    allowed = false;
    await assert.rejects(pending, /ABORTED/);
    assert.equal(f.saves(), 0);
    assert.equal((f.metadata.variables as Record<string, unknown>)[NS], undefined);
  } finally {
    host.close();
  }
});

test('T15 independent read failure revokes writes; later successful query does not silently re-enable', async () => {
  const { f, host } = await initialized();
  try {
    f.readHook(() => {
      throw new Error('private failure');
    });
    const failed = await inspectT10CompatibilityHost(host.driver);
    assert.equal(failed.status, 'read-failed');
    assert.equal(canWriteT10Compatibility(host.driver), false);
    f.readHook(null);
    const recovered = await inspectT10CompatibilityHost(host.driver);
    assert.equal(recovered.status, 'ready');
    assert.equal(recovered.writable, false);
    assert.equal(f.saves(), 1);
  } finally {
    host.close();
  }
});

test('T15 failed host construction releases the same-page lease and partial event subscriptions', () => {
  const shared = {},
    f = fixture(shared);
  delete f.port.events.MESSAGE_EDITED;
  assert.throws(() => createT15CompatibilityHost(f.port), /CAPABILITY/);
  assert.equal(f.callbacks.size, 0);
  const next = createT15CompatibilityHost(fixture(shared).port);
  next.close();
});

test('T15 deadline after dispatch is unknown, never a claimed rollback', async t => {
  const f = fixture(),
    host = createT15CompatibilityHost(f.port),
    gate = deferredT8Test<void>();
  try {
    const input = await proposal(f, host);
    t.mock.timers.enable({ apis: ['setTimeout'] });
    f.saveHook(() => gate.promise);
    const pending = host.driver.compareDocument(input);
    while (f.saves() === 0) await new Promise<void>(resolve => setImmediate(resolve));
    t.mock.timers.tick(15001);
    gate.resolve();
    await assert.rejects(pending, /ACK_LOST/);
    assert.equal(host.status().state, 'uncertain');
    assert.equal(f.saves(), 1);
  } finally {
    gate.resolve();
    host.close();
    t.mock.timers.reset();
  }
});

test('T15 a failed durable budget reservation blocks the first API request and leaves recovery interrupted', async () => {
  const { f, host, gateway, run } = await initialized(),
    anchor = await gateway.capture(scope, 1, run.input.anchor.inputFingerprint),
    input = {
      ...run.input,
      anchor,
      story: [{ messageId: anchor.messageId, role: 'assistant' as const, text: '暴雨加剧，道路受阻。' }],
    };
  let sends = 0;
  const transport = createT15ApiTransport({
    authorize() {},
    fetchImpl: async () => {
      sends++;
      throw new Error();
    },
  });
  const session = await openT10CompatibilitySession({
    driver: host.driver,
    scope,
    execute: executeT8Test,
    runtime: { ...run.options, transport, readInput: () => input },
  });
  try {
    f.saveHook(() => {
      throw new Error('reservation receipt lost');
    });
    await (
      await session.round.start('blocked-send')
    ).done;
    assert.equal(sends, 0);
    assert.equal(f.saves(), 2);
    assert.equal((await gateway.read(scope)).commits.length, 0);
    const recovered = await inspectT10CompatibilityHost(host.driver);
    assert.equal(recovered.runs[0].status, 'interrupted');
    assert.equal(recovered.writable, false);
    session.close();
    host.close();
    const reopened = createT15CompatibilityHost(f.port);
    try {
      assert.equal((await inspectT10CompatibilityHost(reopened.driver)).writable, false);
      await assert.rejects(
        openT10CompatibilitySession({
          driver: reopened.driver,
          scope,
          execute: executeT8Test,
          runtime: { ...run.options, transport, readInput: () => input },
        }),
        /DEPENDENCY/,
      );
      assert.equal(f.saves(), 2);
      assert.equal(sends, 0);
    } finally {
      reopened.close();
    }
  } finally {
    session.close();
    host.close();
  }
});

test('T15 manual SQL commit with lost receipt stays private; read-only reconciliation confirms without another write', async () => {
  const { f, host, gateway, run } = await initialized();
  const anchor = await gateway.capture(scope, 1, run.input.anchor.inputFingerprint),
    service = await createT4CommitService({ scope, store: gateway, execute: executeT8Test });
  try {
    await service.prepareSql({
      runId: 'run-manual',
      commitId: 'commit-manual',
      anchor,
      context: {
        inputFingerprint: anchor.inputFingerprint,
        promptFingerprint: 'a'.repeat(64),
        modelFingerprint: 'a'.repeat(64),
        parametersFingerprint: 'a'.repeat(64),
      },
      kind: 'manual',
      batches: [
        {
          batchId: 'manual',
          sql: "UPDATE we_npc SET f_goals = ? WHERE __we_row_id = 'traveler'",
          parameters: ['查看城门'],
          policy: createT3LocalPolicy(run.state.template, run.state.data),
        },
      ],
    });
    f.saveHook(() => {
      throw new Error('lost receipt');
    });
    await assert.rejects(service.save());
    assert.equal(service.view().status, 'pending');
    assert.equal(service.view().formal.data.revision, 1);
    await assert.rejects(service.save());
    await service.reconcile();
    assert.equal(service.view().status, 'saved');
    assert.equal(service.view().formal.data.revision, 2);
    assert.equal(f.saves(), 2);
    assert.equal(canWriteT10Compatibility(host.driver), false); // A confirmed receipt is not a write reauthorization.
  } finally {
    service.close();
    host.close();
  }
});

test('T15 compatible gateway → each durable reservation → macro/micro fake HTTP → SQLite → one confirmed commit', async () => {
  const { f, host, gateway, run } = await initialized(),
    anchor = await gateway.capture(scope, 1, run.input.anchor.inputFingerprint),
    input = {
      ...run.input,
      anchor,
      story: [{ messageId: anchor.messageId, role: 'assistant' as const, text: '暴雨加剧，道路受阻。' }],
    };
  let sends = 0;
  const transport = createT15ApiTransport({
    authorize() {
      assert.equal(canWriteT10Compatibility(host.driver), true);
    },
    async fetchImpl(_url, request) {
      const doc = await decodeT15Chat(binding, f.server()),
        record = frameT10Envelope(doc.document.variables[NS]).runs[0];
      assert.equal(record.sent, sends + 1);
      assert.equal(record.phase, sends === 0 ? 'macro' : 'micro');
      if (sends === 1) assert.match(String(request?.body), /80/);
      const sql =
        sends++ === 0
          ? {
              sql: 'UPDATE we_environment SET f_risk = ? WHERE __we_row_id = ?',
              parameters: [80, 'small-valley-weather'],
            }
          : {
              sql: 'UPDATE we_npc SET f_last_action = ? WHERE __we_row_id = ?',
              parameters: ['等待雨势减缓', 'traveler'],
            };
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(sql) } }] }));
    },
  });
  const session = await openT10CompatibilitySession({
    driver: host.driver,
    scope,
    execute: executeT8Test,
    runtime: { ...run.options, transport, readInput: () => input },
  });
  try {
    assert.equal(session.consistency, 'optimistic-single-page');
    await (
      await session.round.start('compatibility-round')
    ).done;
    assert.equal(session.round.view().status, 'saved', JSON.stringify(session.round.view().error));
    assert.equal(sends, 2);
    assert.equal(f.saves(), 4); // Init + two pre-send reservations + one whole-round commit.
    assert.equal((await gateway.read(scope)).commits.length, 1);
    assert.doesNotMatch(JSON.stringify(f.server()), /private-t8-key|Authorization|apiKey/);
    const before = f.saves(),
      recovered = await inspectT10CompatibilityHost(host.driver);
    assert.equal(recovered.status, 'ready');
    assert.equal(recovered.runs[0].status, 'committed');
    assert.equal(f.saves(), before);
    assert.equal(sends, 2);
  } finally {
    session.close();
    host.close();
  }
});
