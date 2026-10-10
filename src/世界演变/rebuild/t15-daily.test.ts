import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import * as ts from 'typescript';
import {
  createT15DailyRuntime,
  dailyT15Sources,
  T15_DAILY_VERSION,
  T15_DAILY_SCRIPT_ID,
  type T15DailyInspection,
} from './t15-daily-runtime';
import { createT15DailyImportPackage } from './t15-daily-package';
import { createT15SourceSignals } from './t15-source-signals';
import { createT15NativeDailyRuntime } from './t15-daily-native';
import { wiringFixture } from './t15-wiring-test-fixtures';
import type { T15ImportSession } from './t15-import-runtime';
import type { T10RecoveryView } from './t10-recovery';
function recovery(status: T10RecoveryView['status']): T10RecoveryView {
  return {
    status,
    source: 'unverified-host',
    writable: false,
    binding: null,
    scope: null,
    head: null,
    state: null,
    evolution: null,
    pending: [],
    runs: [],
    cache: 'absent',
    bytes: 0,
    notices: [],
  };
}
function fixture(status: T10RecoveryView['status'] = 'empty') {
  let reads = 0,
    opens = 0,
    writes = 0,
    grants = 0,
    closes = 0,
    infoCloses = 0,
    observers = 0,
    signalCloses = 0,
    armed = false;
  let changed: (bindingChanged: boolean) => void = () => {};
  let delayed: (() => Promise<void>) | undefined,
    blocked = false;
  const info: T15DailyInspection = {
    binding: { hostChatId: 'test-chat', characterId: 'test.png' },
    character: '测试角色',
    recovery: recovery(status),
    mainBook: null,
    mvuRequired: false,
    mvuAvailable: false,
    databaseRequired: false,
    databaseProtocol: false,
    databaseKeys: [],
    canOpenReadFirst: status === 'ready',
    assertCurrent() {},
    close() {
      infoCloses++;
    },
  };
  const opened: { initialize: boolean; readFirst: boolean }[] = [];
  const runtime = createT15DailyRuntime({
    async inspect(fn) {
      reads++;
      changed = fn;
      await delayed?.();
      return { ...info, binding: { ...info.binding } };
    },
    async observe() {
      observers++;
      const signals = createT15SourceSignals({
        current: () => ({ binding: info.binding, message: {}, text: '测试剧情', swipe: 0, matchingBodies: 1 }),
        epoch: () => 0,
        on: () => () => {},
        mvuEvents: null,
        database: null,
      });
      return {
        ...signals,
        close() {
          signalCloses++;
          signals.close();
        },
      };
    },
    async open(options) {
      opens++;
      opened.push({ initialize: options.initialize, readFirst: options.readFirst });
      if (!options.readFirst) writes++;
      let closed = false;
      const session: T15ImportSession = {
        canHandoff: () => !blocked,
        authorizeRealApi(value) {
          if (value) grants++;
        },
        daily: { setAutomatic() {}, settled: async () => {} },
        automatic: { settled: async () => {} },
        close() {
          if (!closed) {
            closes++;
            closed = true;
          }
        },
      };
      return session;
    },
    lifecycle(options) {
      return {
        view: () => ({ armed, reason: '' }),
        arm(value) {
          if (value) options.assertSources();
          armed = value;
        },
        subscribe: () => () => {},
        settled: async () => {},
        close() {
          armed = false;
          options.initial.close();
        },
        session: () => options.initial,
      };
    },
  });
  return {
    runtime,
    info,
    opened,
    stats: () => ({ reads, opens, writes, grants, closes, infoCloses, observers, signalCloses }),
    changed: (binding = false) => changed(binding),
    delay: (value: () => Promise<void>) => {
      delayed = value;
    },
    block: (value: boolean) => {
      blocked = value;
    },
  };
}
test('H4 load is inert; opening empty chat reads real status but never initializes/grants/runs', async () => {
  const f = fixture();
  assert.equal(f.stats().reads, 0);
  try {
    await f.runtime.refresh();
    assert.equal(f.stats().reads, 1);
    assert.equal(f.stats().opens, 0);
    assert.equal(f.stats().writes, 0);
    assert.equal(f.stats().grants, 0);
    assert.equal(f.runtime.view().info?.recovery.status, 'empty');
    assert.equal(f.runtime.view().armed, false);
  } finally {
    f.runtime.close();
  }
});
test('H4 healthy archive opens existing controllers read-first without startup writes or paid permission', async () => {
  const f = fixture('ready');
  try {
    await f.runtime.refresh();
    assert.deepEqual(f.opened, [{ readFirst: true, initialize: false }]);
    assert.equal(f.stats().writes, 0);
    assert.equal(f.stats().grants, 0);
    assert.ok(f.runtime.view().session);
  } finally {
    f.runtime.close();
  }
});

test('H4 preserved page aligns the daily controller immediately when a native session is mounted', () => {
  const source = readFileSync(resolve('src/世界演变/rebuild/T15HostWorkspace.vue'), 'utf8');
  assert.match(source, /watch\(\s*\(\) => props\.initialPage,[\s\S]*?\{ immediate: true \}/);
  assert.match(source, /daily\.selectPage\(value === 'history' \? 'history' : value === 'evolution' \? 'automatic'/);
});
test('H4 save remains a separate one-action confirmation, never implicit in opening', async () => {
  const f = fixture();
  try {
    await f.runtime.refresh();
    await assert.rejects(f.runtime.edit(false), /确认/);
    assert.equal(f.stats().writes, 0);
    await f.runtime.edit(true);
    assert.deepEqual(f.opened, [{ readFirst: false, initialize: true }]);
    assert.equal(f.stats().writes, 1);
    assert.equal(f.stats().grants, 0);
    assert.equal(f.runtime.view().armed, false);
  } finally {
    f.runtime.close();
  }
});
test('H4 missing DB protocol does not gate browsing/editing but blocks manual paid permission and auto', async () => {
  const f = fixture();
  f.info.databaseRequired = true;
  f.info.databaseKeys = ['actual'];
  try {
    await f.runtime.refresh();
    assert.equal(f.runtime.view().databaseKey, 'actual');
    await f.runtime.edit(true);
    assert.ok(f.runtime.view().session);
    assert.throws(() => f.runtime.view().session!.authorizeRealApi(true), /数据库/);
    assert.throws(() => f.runtime.arm(true), /数据库/);
    assert.equal(f.stats().grants, 0);
    assert.equal(f.runtime.view().armed, false);
  } finally {
    f.runtime.close();
  }
});
test('H4 ambiguous DB table group stays required rather than being silently skipped', async () => {
  const f = fixture();
  Object.assign(f.info, { databaseRequired: true, databaseProtocol: true, databaseKeys: ['one', 'two'] });
  try {
    await f.runtime.refresh();
    assert.equal(f.runtime.view().databaseKey, '');
    assert.deepEqual(dailyT15Sources(f.info, ''), [{ id: 'database', required: true, selections: [] }]);
    await f.runtime.edit(true);
    assert.throws(() => f.runtime.arm(true), /表组/);
    await f.runtime.selectDatabaseKey('two');
    await f.runtime.edit(true);
    f.runtime.arm(true);
    assert.equal(f.runtime.view().armed, true);
    assert.deepEqual(dailyT15Sources(f.info, 'two')[0].selections[0].path, ['TavernDB_ACU_IsolatedData', 'two']);
  } finally {
    f.runtime.close();
  }
});
test('H4 required MVU not ready blocks sending while preserving real data visibility', async () => {
  const f = fixture('ready');
  f.info.mvuRequired = true;
  try {
    await f.runtime.refresh();
    assert.ok(f.runtime.view().session);
    assert.throws(() => f.runtime.arm(true), /MVU/);
    assert.throws(() => f.runtime.view().session!.authorizeRealApi(true), /MVU/);
  } finally {
    f.runtime.close();
  }
});
test('H4 API/editor drafts preserve session on chat change and prevent writes/automatic activation', async () => {
  for (const apiDraft of [true, false]) {
    const f = fixture('ready');
    try {
      await f.runtime.refresh();
      const session = f.runtime.view().session;
      if (apiDraft) f.runtime.setDirty(true);
      else f.block(true);
      f.changed(true);
      await f.runtime.refresh();
      assert.equal(f.stats().reads, 1);
      assert.equal(f.runtime.view().session, session);
      assert.equal(f.stats().closes, 0);
      assert.equal(f.runtime.view().stale, true);
      await assert.rejects(f.runtime.edit(true));
      assert.throws(() => f.runtime.arm(true));
    } finally {
      f.runtime.close();
    }
  }
});
test('H4 same-chat events are owned by active lifecycle, not destructive observer reconstruction', async () => {
  const f = fixture('ready');
  try {
    await f.runtime.refresh();
    f.runtime.arm(true);
    f.changed(false);
    assert.equal(f.stats().reads, 1);
    assert.equal(f.stats().observers, 1);
    assert.equal(f.stats().closes, 0);
    assert.equal(f.runtime.view().armed, true);
  } finally {
    f.runtime.close();
  }
});
test('H4 late inspection after closing is disposed and cannot reopen a hidden session', async () => {
  const f = fixture('ready');
  let release: () => void = () => {};
  f.delay(
    () =>
      new Promise<void>(r => {
        release = r;
      }),
  );
  const reading = f.runtime.refresh();
  await new Promise(resolve => setTimeout(resolve, 0));
  f.runtime.close();
  release();
  await reading;
  assert.equal(f.stats().opens, 0);
  assert.equal(f.stats().infoCloses, 1);
  assert.equal(f.stats().observers, 0);
});
test('H4 new package uses normal button, distinct ID, no preapproved writes/model permissions', () => {
  const pack = createT15DailyImportPackage('local-bundle');
  assert.equal(pack.id, T15_DAILY_SCRIPT_ID);
  assert.equal(pack.enabled, false);
  assert.equal(pack.data.candidate_version, T15_DAILY_VERSION);
  assert.equal(pack.data.paid_requests_preapproved, false);
  assert.equal(pack.data.chat_writes_preapproved, false);
  assert.equal(pack.button.buttons[0].name, '打开世界演变面板');
  assert.match(pack.info, /无需手动连接/);
});
test('H4 actual daily entry: no startup chat calls, one menu/iframe, two compatible buttons, no outer close bar', () => {
  class Element {
    id = '';
    style: Record<string, string> = {};
    hidden = false;
    parent: Element | null = null;
    children: Element[] = [];
    onclick: (() => void) | null = null;
    handlers = new Map<string, () => void>();
    contentWindow: Record<string, unknown> = {};
    contentDocument: Doc | null = null;
    constructor(public tag: string) {
      if (tag === 'iframe') this.contentDocument = new Doc();
    }
    append(...items: Element[]) {
      for (const item of items) {
        item.parent = this;
        this.children.push(item);
      }
    }
    addEventListener(name: string, fn: () => void) {
      this.handlers.set(name, fn);
    }
    remove() {
      if (this.parent) this.parent.children = this.parent.children.filter(c => c !== this);
    }
  }
  class Doc {
    body = new Element('body');
    handlers = new Map<string, () => void>();
    createElement(tag: string) {
      return new Element(tag);
    }
    getElementById(id: string): Element | null {
      const find = (r: Element): Element | null => (r.id === id ? r : (r.children.map(find).find(Boolean) ?? null));
      return find(this.body);
    }
    addEventListener(name: string, fn: () => void) {
      this.handlers.set(name, fn);
    }
  }
  const host = new Doc(),
    menu = host.createElement('div');
  menu.id = 'extensionsMenu';
  host.body.append(menu);
  let calls = 0,
    stops = 0;
  const buttons = new Map<string, () => void>();
  const build = ts.transpileModule(
    readFileSync(resolve('src/世界演变/rebuild/t15-daily-entry.ts'), 'utf8').replace(
      /import \{ T15_DAILY_VERSION \} from '.\/t15-daily-runtime';/,
      `const T15_DAILY_VERSION=${JSON.stringify(T15_DAILY_VERSION)};`,
    ),
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } },
  ).outputText;
  const make = () => {
    const handlers = new Map<string, () => void>();
    runInNewContext(`(()=>{${build}})()`, {
      window: { parent: { document: host }, addEventListener: (key: string, fn: () => void) => handlers.set(key, fn) },
      $: (fn: () => void) => fn(),
      getButtonEvent: (name: string) => name,
      eventOn: (name: string, fn: () => void) => {
        buttons.set(name, fn);
        return {
          stop() {
            stops++;
          },
        };
      },
      getVariables() {
        calls++;
        return {};
      },
      insertOrAssignVariables() {
        calls++;
      },
      __T15_HOST_APP_SOURCE__: '/* inert test app */',
      __T15_HOST_BUILD_HASH__: 'test',
    });
    return handlers;
  };
  const first = make();
  make();
  assert.equal(menu.children.length, 1);
  assert.equal(buttons.size, 2);
  assert.equal(calls, 0);
  buttons.get('打开世界演变面板')!();
  const panel = host.getElementById('world-evolution-host-import-entry-panel')!;
  assert.deepEqual(
    panel.children.map(c => c.tag),
    ['iframe'],
  );
  const frame = panel.children[0];
  frame.handlers.get('load')!();
  assert.equal(calls, 0);
  frame.contentDocument!.handlers.get('we-host-close')!();
  assert.equal(panel.style.display, 'none');
  buttons.get('打开世界演变真实接线候选')!();
  assert.equal(panel.style.display, 'flex');
  first.get('pagehide')!();
  assert.equal(stops, 2);
  assert.equal(menu.children.length, 0);
});
test('H4 actual native read-first composition consumes saved JSON without chat/book saves or model calls', async () => {
  const f = await wiringFixture();
  f.host.close();
  const names = [
    'window',
    'SillyTavern',
    'tavern_events',
    'eventOn',
    'getScriptId',
    'getScriptTrees',
    'getVariables',
    'getCharWorldbookNames',
    'getWorldbook',
    'Mvu',
  ];
  const descriptors = names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
  let reads = 0;
  const before = f.saves(),
    original = JSON.stringify(f.chat);
  const parent = {
    location: { href: 'http://127.0.0.1:8000/' },
    fetch: (url: string, init: RequestInit) => {
      if (!url.endsWith('/api/chats/get') && !url.endsWith('/api/characters/chats'))
        throw new Error('test forbids model/book/chat writes');
      reads++;
      return f.port.fetchImpl(url, init);
    },
  };
  const globals: Record<string, unknown> = {
    window: { parent, addEventListener() {}, removeEventListener() {} },
    SillyTavern: {
      ...f.port.context(),
      chatMetadata: f.metadata,
      characters: [{ avatar: f.binding.characterId, chat: f.binding.hostChatId, name: '测试卡' }],
      getWorldInfoNames: () => ['主书'],
    },
    tavern_events: f.port.events,
    eventOn: f.port.on,
    getScriptId: () => T15_DAILY_SCRIPT_ID,
    getScriptTrees: () => [],
    getVariables: () => ({}),
    getCharWorldbookNames: f.port.getPrimary,
    getWorldbook: f.port.getWorldbook,
    Mvu: undefined,
  };
  for (const [name, value] of Object.entries(globals))
    Object.defineProperty(globalThis, name, { value, configurable: true });
  const runtime = createT15NativeDailyRuntime(async () => {
    throw new Error('read-first must not execute SQL');
  });
  try {
    await runtime.refresh();
    assert.ok(runtime.view().info?.recovery.state);
    assert.equal(runtime.view().info?.character, '测试卡');
    assert.equal(runtime.view().info?.recovery.status, 'ready');
    assert.ok(runtime.view().session, runtime.view().notice + ' / ' + runtime.view().error);
    assert.equal(f.saves(), before);
    assert.equal(JSON.stringify(f.chat), original);
    assert.equal(runtime.view().armed, false);
    assert.equal(runtime.view().session!.realApiEnabled(), false);
    assert.ok(reads >= 2);
  } finally {
    runtime.close();
    for (const [name, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
    f.close();
  }
});
