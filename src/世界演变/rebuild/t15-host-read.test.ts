import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeT15Chat, createT15ChatReader, normalizeT15ChatTarget } from './t15-host-read';
import { createT15TavernHost, type T15TavernPort } from './t15-tavern-host';
import { canWriteT10, createT10Gateway } from './t10-host-gateway';
import { canWriteT12 } from './t12-gateway';
import { createMinimalT2Fixture } from './t2-defaults';
import { fingerprintT4, type T4Scope } from './t4-protocol';
import { copyT10 } from './t10-host-protocol';
import { deferredT8Test, setupT8Test, executeT8Test } from './t8-test-fixtures';
import { openT10Session } from './t10-session';
import { createT15ApiTransport } from './t15-api-transport';

const binding = { hostChatId: 'local-chat', characterId: 'card.png' },
  target = { binding, avatar: 'card.png', fileName: 'local-chat' };
const scope: T4Scope = { mode: 't10-host', chatId: 'chat-one', worldId: 'demo-world', branchId: 'demo-main' };
function records() {
  return [
    {
      chat_metadata: {
        integrity: 'fixture-integrity',
        variables: { TavernDB: { sheet: ['保持'] }, unrelated: true },
        custom: 7,
      },
      customHeader: '保持',
    },
    { name: '玩家', mes: '去城门', is_user: true, is_system: false, extra: { custom: 3 }, unrelated: ['保持'] },
    {
      name: '叙述者',
      mes: '另一回复',
      is_user: false,
      is_system: true,
      swipe_id: 1,
      swipes: ['大雨封路', '另一回复'],
      variables: [{ stat_data: { hp: 7 } }, { stat_data: { hp: 8 } }],
      swipe_info: [{ extra: '保持' }],
      extra: { type: 'narrator' },
      otherPlugin: { data: '保持' },
    },
  ];
}
function fixture() {
  const events = Object.fromEntries(
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
    ].map(name => [name, name.toLowerCase()]),
  );
  const handles = new Map<string, () => void>();
  let hides: () => void = () => {};
  const context = {
    groupId: null as string | null,
    characterId: 0,
    characters: [{ avatar: 'card.png', chat: 'local-chat' }],
    chat: [{}],
    getCurrentChatId: () => context.characters[0].chat,
    getRequestHeaders: () => ({ 'X-CSRF-TOKEN': 'fixture-only' }),
  };
  const requests: { url: string; init: RequestInit }[] = [],
    reads: string[] = [];
  let primary: string | null = '卡自带世界书';
  const port: T15TavernPort = {
    origin: 'http://127.0.0.1:8000',
    version: '1.18.0-fixture',
    events,
    context: () => context,
    async fetchImpl(url, init) {
      requests.push({ url, init });
      return new Response(
        JSON.stringify(
          url.endsWith('/api/characters/chats')
            ? [{ file_name: 'local-chat.jsonl', file_id: 'local-chat' }]
            : records(),
        ),
      );
    },
    on(event, callback) {
      handles.set(event, callback);
      return {
        stop: () => {
          handles.delete(event);
        },
      };
    },
    onPageHide(callback) {
      hides = callback;
      return () => {
        hides = () => {};
      };
    },
    getPrimary: () => ({ primary, additional: ['不能回退到此世界书'] }),
    async getWorldbook(name) {
      reads.push(name);
      return [{ uid: 2, name: '人工条目', content: '保持', extra: { unrelated: true } }];
    },
  };
  return {
    port,
    context,
    requests,
    reads,
    handles,
    hide: () => hides(),
    primary: (name: string | null) => {
      primary = name;
    },
  };
}

test('T15 JSONL codec preserves raw header/plugin data, normalizes swipes and narrator without mutating input', async () => {
  const raw = records(),
    before = JSON.stringify(raw),
    snapshot = await decodeT15Chat(binding, raw);
  assert.equal(JSON.stringify(raw), before);
  assert.deepEqual(snapshot.raw, raw);
  assert.equal(snapshot.rawFingerprint, await fingerprintT4(raw));
  assert.equal(snapshot.document.messages[0].role, 'user');
  assert.equal(snapshot.document.messages[1].role, 'system');
  assert.equal(snapshot.document.messages[1].is_hidden, true);
  assert.deepEqual(snapshot.document.messages[1].swipes_data[1], { stat_data: { hp: 8 } });
  assert.deepEqual(snapshot.document.messages[1].swipes_info[1], {});
  assert.deepEqual(snapshot.document.messages[1].otherPlugin, { data: '保持' });
  assert.deepEqual(snapshot.document.variables.TavernDB, { sheet: ['保持'] });
  raw[0].customHeader = 'changed';
  assert.notDeepEqual(snapshot.raw, raw);
});
test('T15 full raw fingerprint detects unrelated metadata, not just evolution variables', async () => {
  const raw = records(),
    a = await decodeT15Chat(binding, raw);
  raw[0].customHeader = 'changed';
  const b = await decodeT15Chat(binding, raw);
  assert.deepEqual(a.document, b.document);
  assert.notEqual(a.rawFingerprint, b.rawFingerprint);
});
for (const value of [
  [],
  [{}],
  [null],
  [{ chat_metadata: null }],
  [{ chat_metadata: { variables: [] } }],
  [{ chat_metadata: {} }, { name: 'bad', mes: 'text', swipes: [], is_user: false }],
  [{ chat_metadata: {} }, { name: 'bad', mes: 'text', is_user: true, extra: { type: 'narrator' } }],
])
  test(`T15 malformed JSONL is refused: ${JSON.stringify(value)}`, async () => {
    await assert.rejects(decodeT15Chat(binding, value), /READ/);
  });

for (const name of ['', '../other', 'folder/chat', 'folder\\chat', '..', 'unknown_chat'])
  test(`T15 chat target refuses invalid names ${name}`, () => {
    assert.throws(() =>
      normalizeT15ChatTarget({ ...target, fileName: name, binding: { ...binding, hostChatId: name } }),
    );
  });
test('T15 native reader is lazy, uses exact existing single-card server endpoint and CSRF, never a save', async () => {
  const f = fixture(),
    host = createT15TavernHost(f.port);
  try {
    assert.equal(f.requests.length, 0);
    assert.equal(f.reads.length, 0);
    const snapshot = await host.readSnapshot();
    assert.equal(snapshot.source, 'server-jsonl');
    assert.equal(f.requests.length, 2);
    assert.equal(f.requests[0].url, 'http://127.0.0.1:8000/api/characters/chats');
    const request = f.requests[1];
    assert.equal(request.url, 'http://127.0.0.1:8000/api/chats/get');
    assert.equal(request.init.credentials, 'same-origin');
    assert.deepEqual(JSON.parse(String(request.init.body)), { avatar_url: 'card.png', file_name: 'local-chat' });
    assert.equal(new Headers(request.init.headers).get('X-CSRF-TOKEN'), 'fixture-only');
    assert.equal(canWriteT10(host.driver), false);
    await assert.rejects(
      createT10Gateway(host.driver).initialize(scope, createMinimalT2Fixture(), () => 'id-one'),
      /CAPABILITY/,
    );
    assert.equal(f.requests.length, 2);
  } finally {
    host.close();
  }
});
test('T15 groups, temporary chats or unknown cards never cause a server read/create', async () => {
  const f = fixture(),
    host = createT15TavernHost(f.port);
  try {
    f.context.groupId = 'group';
    await assert.rejects(host.readSnapshot());
    f.context.groupId = null;
    f.context.chat = [];
    await assert.rejects(host.readSnapshot());
    f.context.chat = [{}];
    f.context.characterId = 4;
    await assert.rejects(host.readSnapshot());
    assert.equal(f.requests.length, 0);
  } finally {
    host.close();
  }
});
test('T15 independent read failure never falls back to a cached helper snapshot', async () => {
  const f = fixture();
  let calls = 0;
  f.port.fetchImpl = async () => {
    calls++;
    throw new Error('private network error');
  };
  const host = createT15TavernHost(f.port);
  try {
    await assert.rejects(host.readSnapshot(), e => e instanceof Error && e.message === '酒馆存档：READ');
    assert.equal(calls, 1);
  } finally {
    host.close();
  }
});
test('T15 late read is discarded after chat A→B→A; events invalidate but do not fabricate completion', async () => {
  const f = fixture(),
    gate = deferredT8Test<Response>(),
    observed: string[] = [];
  f.port.fetchImpl = () => gate.promise;
  const host = createT15TavernHost(f.port);
  const stop = host.driver.subscribe!(event => observed.push(event));
  try {
    const reading = host.readSnapshot();
    f.context.characters[0].chat = 'chat-b';
    f.handles.get(f.port.events.CHAT_CHANGED)!();
    f.context.characters[0].chat = 'local-chat';
    f.handles.get(f.port.events.CHAT_CHANGED)!();
    gate.resolve(new Response(JSON.stringify(records())));
    await assert.rejects(reading, /IDENTITY/);
    assert.deepEqual(observed, ['chat-changed', 'chat-changed']);
    stop();
    f.handles.get(f.port.events.MESSAGE_DELETED)!();
    assert.equal(observed.length, 2);
  } finally {
    host.close();
  }
});
test('T15 pagehide aborts in-flight read, emits revocation once and releases every listener', async () => {
  const f = fixture(),
    gate = deferredT8Test<Response>();
  let signal: AbortSignal | null | undefined;
  f.port.fetchImpl = (_, init) => {
    signal = init.signal;
    return gate.promise;
  };
  const host = createT15TavernHost(f.port);
  let revocations = 0;
  host.driver.subscribe!(() => {
    revocations++;
  });
  const reading = host.readSnapshot();
  f.hide();
  f.hide();
  host.close();
  assert.equal(signal?.aborted, true);
  assert.equal(f.handles.size, 0);
  assert.equal(revocations, 1);
  gate.resolve(new Response(JSON.stringify(records())));
  await assert.rejects(reading, /ABORTED/);
  await assert.rejects(host.driver.readDurable(binding));
  assert.equal(f.reads.length, 0);
});
test('T15 missing host event rolls back partially registered listeners without requests', () => {
  const f = fixture();
  delete f.port.events.MESSAGE_EDITED;
  assert.throws(() => createT15TavernHost(f.port), /CAPABILITY/);
  assert.equal(f.handles.size, 0);
  assert.equal(f.requests.length, 0);
});
test('T15 worldbook read only targets the card primary; never creates, falls back, writes or captures', async () => {
  const f = fixture(),
    host = createT15TavernHost(f.port),
    driver = host.worldbook(scope);
  try {
    assert.equal((await driver.current()).primaryBook, '卡自带世界书');
    const book = await driver.read('卡自带世界书');
    assert.equal(book.entries[0].name, '人工条目');
    assert.equal(book.blocked, true);
    assert.equal(canWriteT12(driver.capabilities), false);
    assert.deepEqual(f.reads, ['卡自带世界书']);
    await assert.rejects(driver.read('不能回退到此世界书'), /TARGET/);
    f.primary(null);
    await assert.rejects(driver.read('卡自带世界书'), /TARGET/);
    assert.deepEqual(f.reads, ['卡自带世界书']);
  } finally {
    host.close();
  }
});
test('T15 worldbook rebinding or editing during read discards stale projection input', async () => {
  const f = fixture(),
    gate = deferredT8Test<unknown[]>();
  f.port.getWorldbook = () => gate.promise;
  const host = createT15TavernHost(f.port),
    driver = host.worldbook(scope);
  try {
    const reading = driver.read('卡自带世界书');
    f.handles.get(f.port.events.WORLDINFO_UPDATED)!();
    gate.resolve([{ uid: 2, content: 'stale' }]);
    await assert.rejects(reading, /TARGET/);
  } finally {
    host.close();
  }
});
test('T15 read boundary refuses mixed API Authorization and foreign origins before dispatch', async () => {
  let calls = 0;
  const port = {
    origin: 'http://127.0.0.1:8000',
    current: () => copyT10(target),
    epoch: () => 0,
    headers: () => ({ Authorization: 'Bearer should-not-be-here' }),
    fetchImpl: async () => {
      calls++;
      return new Response(JSON.stringify(records()));
    },
  };
  await assert.rejects(createT15ChatReader(port).read(binding), /READ/);
  assert.equal(calls, 0);
  assert.throws(() => createT15ChatReader({ ...port, origin: 'https://user:password@host/' }));
});

for (const listing of [[], { error: true }, [{ file_name: 'other.jsonl' }]])
  test(`T15 missing persisted chat refuses /get and its directory-creation side effect: ${JSON.stringify(listing)}`, async () => {
    const f = fixture();
    let calls = 0;
    f.port.fetchImpl = async url => {
      calls++;
      assert.ok(url.endsWith('/api/characters/chats'));
      return new Response(JSON.stringify(listing));
    };
    const host = createT15TavernHost(f.port);
    try {
      await assert.rejects(host.readSnapshot(), /READ/);
      assert.equal(calls, 1);
    } finally {
      host.close();
    }
  });
test('T15 close is reentrant-safe even when a revocation consumer closes the host again', () => {
  const f = fixture(),
    host = createT15TavernHost(f.port);
  let count = 0;
  host.driver.subscribe!(() => {
    count++;
    host.close();
  });
  host.close();
  assert.equal(count, 1);
  assert.equal(f.handles.size, 0);
});

test('T15 native unverified storage cannot open a real round or send API before capability confirmation', async () => {
  const f = fixture(),
    host = createT15TavernHost(f.port),
    run = setupT8Test();
  let sends = 0;
  const transport = createT15ApiTransport({
    authorize() {},
    async fetchImpl() {
      sends++;
      return new Response('{}');
    },
  });
  try {
    await assert.rejects(
      openT10Session({ driver: host.driver, scope, execute: executeT8Test, runtime: { ...run.options, transport } }),
      /CAPABILITY/,
    );
    assert.equal(f.requests.length, 0);
    assert.equal(f.reads.length, 0);
    assert.equal(sends, 0);
  } finally {
    host.close();
  }
});
