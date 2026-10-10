import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import * as ts from 'typescript';
import { parse, compileScript, compileStyle } from 'vue/compiler-sfc';
import { copyT15NativeJson } from './t15-native-json';
import { cloneT2Json } from './t2-template';
import {
  createT15ImportRuntime,
  importT15Selections,
  T15_HOST_VERSION,
  T15_HOST_SCRIPT_ID,
  type T15ImportInspection,
  type T15ImportSources,
  type T15ImportSession,
} from './t15-import-runtime';
import { createT15HostImportPackage } from './t15-import-package';
import { createT15SourceSignals } from './t15-source-signals';
import { createT15AutomaticLifecycle } from './t15-automatic-lifecycle';
import { createT15DbCompletionAdapter } from './t15-db-completion-adapter';
import type { T15DbEvent, T15DbObserver } from './t15-db-completion-protocol';
import type { T15Prerequisites } from './t15-prerequisites';
import { wiringFixture } from './t15-wiring-test-fixtures';
import { createT15CompatibilityHost } from './t15-chat-compatibility';
import { createT10CompatibilityGateway } from './t10-host-gateway';
test('H3 foreign iframe JSON is explicitly localized; strict T2 remains unchanged', () => {
  const foreign = runInNewContext('({stat_data:{npc:[{name:"测试甲"}],ok:true},n:1})');
  assert.throws(() => cloneT2Json(foreign));
  assert.deepEqual(copyT15NativeJson(foreign), { stat_data: { npc: [{ name: '测试甲' }], ok: true }, n: 1 });
});
test('H3 native boundary rejects getters/classes/cycles/extra array fields and does not invoke getters', () => {
  let reads = 0;
  const getter = {
    get x() {
      reads++;
      return 1;
    },
  };
  for (const value of [
    getter,
    new Date(),
    new (class A {
      x = 1;
    })(),
    runInNewContext('new (class A extends Array{})(1)'),
  ])
    assert.throws(() => copyT15NativeJson(value));
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  assert.throws(() => copyT15NativeJson(cyclic));
  const extra = Object.assign([1], { extra: true });
  assert.throws(() => copyT15NativeJson(extra));
  assert.equal(reads, 0);
  assert.throws(() => copyT15NativeJson(JSON.parse('{"__proto__":1}')));
});
function fixture() {
  let reads = 0,
    observers = 0,
    opens = 0,
    closes = 0,
    inspectionCloses = 0,
    grants = 0,
    auto = false,
    valid = true,
    dirty = false,
    saved = false,
    closed = false;
  const binding = { characterId: 'test.png', hostChatId: 'test-chat' };
  let message: object = {},
    text = '测试剧情',
    epoch = 0;
  const signals = createT15SourceSignals({
    current: () => ({ binding, message, swipe: 0, text, matchingBodies: 1 }),
    epoch: () => epoch,
    on: () => () => {},
    mvuEvents: null,
    database: null,
  });
  const dailyListeners = new Set<() => void>();
  const session = {
    daily: {
      setAutomatic(value: boolean) {
        auto = value;
        dailyListeners.forEach(fn => fn());
      },
      view: () => ({ autoEnabled: auto }),
      subscribe(fn: () => void) {
        dailyListeners.add(fn);
        return () => {
          dailyListeners.delete(fn);
        };
      },
      settled: async () => {},
    },
    automatic: { settled: async () => {} },
    canHandoff: () => !dirty,
    authorizeRealApi(value: boolean) {
      grants += value ? 1 : 0;
      saved = value;
    },
    realApiEnabled: () => saved,
    close() {
      if (closed) return;
      closed = true;
      closes++;
    },
  };
  const runtime = createT15ImportRuntime({
    async inspect(): Promise<T15ImportInspection> {
      reads++;
      return {
        binding,
        character: '测试卡',
        state: 'empty',
        databaseKeys: ['actual-slot'],
        databaseProtocol: false,
        mvuAvailable: true,
        mainBook: null,
        assertCurrent() {
          if (!valid) throw new Error('stale');
        },
        close() {
          inspectionCloses++;
        },
      };
    },
    async observe(_choice: T15ImportSources) {
      observers++;
      return signals;
    },
    async open() {
      opens++;
      return session;
    },
    lifecycle(options) {
      return createT15AutomaticLifecycle({
        ...options,
        initialSession: options.initial,
        configurationIdentity: () => 'config',
        async open() {
          opens++;
          return {
            ...session,
            close() {
              closes++;
            },
          };
        },
      });
    },
  });
  return {
    runtime,
    signals,
    session,
    stats: () => ({ reads, observers, opens, closes, inspectionCloses, grants, auto }),
    setValid: (v: boolean) => {
      valid = v;
    },
    setDirty: (v: boolean) => {
      dirty = v;
    },
    next: () => {
      message = {};
      text = '新剧情';
      epoch++;
      signals.wake('assistant');
    },
  };
}
test('H3 import/open is inert; read/observe do not open, initialize, authorize or run', async () => {
  const f = fixture();
  assert.deepEqual(f.stats(), {
    reads: 0,
    observers: 0,
    opens: 0,
    closes: 0,
    inspectionCloses: 0,
    grants: 0,
    auto: false,
  });
  try {
    await f.runtime.inspect();
    await f.runtime.observe({ mvu: false, database: false, databaseKey: '' });
    f.signals.wake('assistant');
    assert.equal(f.stats().opens, 0);
    assert.equal(f.stats().grants, 0);
    assert.equal(f.runtime.view().armed, false);
  } finally {
    f.runtime.close();
  }
});
test('H3 no connect without separate write confirmation and explicit observed source choices', async () => {
  const f = fixture();
  try {
    await assert.rejects(f.runtime.connect(false, true), /明确允许/);
    await assert.rejects(f.runtime.connect(true, true), /先检查/);
    await f.runtime.inspect();
    await assert.rejects(f.runtime.connect(true, true), /先检查/);
    await f.runtime.observe({ mvu: false, database: false, databaseKey: '' });
    await f.runtime.connect(true, true);
    assert.equal(f.stats().opens, 1);
    assert.equal(f.stats().grants, 0);
    assert.equal(f.stats().auto, false);
  } finally {
    f.runtime.close();
  }
});
test('H3 current database keys only; never guess example field or silently disable database', () => {
  assert.throws(() => importT15Selections({ mvu: true, database: true, databaseKey: 'sample' }, ['actual-slot']));
  const selections = importT15Selections({ mvu: true, database: true, databaseKey: 'actual-slot' }, ['actual-slot']);
  assert.deepEqual(
    selections.map(s => s.required),
    [true, true],
  );
  assert.deepEqual(selections[1].selections[0].path, ['TavernDB_ACU_IsolatedData', 'actual-slot']);
  assert.equal(importT15Selections({ mvu: false, database: false, databaseKey: '' }, []).length, 0);
});
test('H3 stale read and binding/stop notification revoke preconnection approval', async () => {
  const f = fixture();
  try {
    await f.runtime.inspect();
    f.setValid(false);
    await assert.rejects(f.runtime.observe({ mvu: false, database: false, databaseKey: '' }), /stale/);
    assert.equal(f.stats().observers, 0);
    f.setValid(true);
    await f.runtime.observe({ mvu: false, database: false, databaseKey: '' });
    f.signals.invalidate('binding');
    await assert.rejects(f.runtime.connect(true, false), /先检查/);
    assert.equal(f.stats().opens, 0);
  } finally {
    f.runtime.close();
  }
});
test('H3 API UI drafts prevent permission and handoff/disconnect; not silently discarded', async () => {
  const f = fixture();
  try {
    await f.runtime.inspect();
    await f.runtime.observe({ mvu: false, database: false, databaseKey: '' });
    await f.runtime.connect(true, true);
    f.runtime.setUiDirty(true);
    assert.throws(() => f.runtime.arm(true), /草稿/);
    await assert.rejects(f.runtime.disconnect(), /草稿|未确认/);
    assert.equal(f.stats().closes, 0);
    f.runtime.setUiDirty(false);
    await f.runtime.disconnect();
    assert.equal(f.runtime.view().session, null);
    assert.equal(f.stats().closes, 1);
    assert.throws(() => f.signals.frame());
  } finally {
    f.runtime.close();
  }
});
test('H3 lifecycle adopts manual session without request and fences the next auto handoff by API draft', async () => {
  const f = fixture();
  try {
    await f.runtime.inspect();
    await f.runtime.observe({ mvu: false, database: false, databaseKey: '' });
    await f.runtime.connect(true, true);
    f.runtime.arm(true);
    assert.equal(f.stats().opens, 1);
    assert.equal(f.runtime.view().armed, true);
    f.runtime.setUiDirty(true);
    f.next();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(f.stats().opens, 1);
    assert.equal(f.stats().closes, 0);
    assert.equal(f.runtime.view().armed, false);
  } finally {
    f.runtime.close();
  }
});
test('H3 late observation cleanup after entry closes does not leave hidden source listeners', async () => {
  let release: (() => void) | undefined,
    close = 0;
  const f = fixture(),
    base = f.runtime;
  const runtime = createT15ImportRuntime<T15ImportSession>({
    async inspect() {
      await base.inspect();
      return { ...base.view().inspection!, assertCurrent() {} };
    },
    async observe() {
      await new Promise<void>(r => {
        release = r;
      });
      return {
        ...f.signals,
        close() {
          close++;
          f.signals.close();
        },
      };
    },
    open: async () => f.session,
    lifecycle: () => {
      throw new Error('not called');
    },
  });
  await runtime.inspect();
  const pending = runtime.observe({ mvu: false, database: false, databaseKey: '' });
  runtime.close();
  release!();
  await assert.rejects(pending, /关闭/);
  assert.equal(close, 1);
  base.close();
});
test('H3 host package has a distinct version/id, disabled entry and zero preapproved privileges', () => {
  const pack = createT15HostImportPackage('fixed-local-bundle');
  assert.equal(pack.enabled, false);
  assert.equal(pack.content, 'fixed-local-bundle');
  assert.equal(pack.id, T15_HOST_SCRIPT_ID);
  assert.notEqual(pack.id, '8f42058a-c112-4fc2-a790-9d430e57bab1');
  assert.equal(pack.data.candidate_version, T15_HOST_VERSION);
  assert.equal(pack.data.paid_requests_preapproved, false);
  assert.equal(pack.data.chat_writes_preapproved, false);
  assert.match(pack.info, /不是隔离沙盒|不是隔离/);
});
test('H3 entry startup only installs menu; bridge is explicit, dynamic and scoped to fixed srcdoc', () => {
  const source = readFileSync(resolve('src/世界演变/rebuild/t15-import-entry.ts'), 'utf8');
  assert.doesNotMatch(source, /\.inspect\(|\.connect\(|\.arm\(|openT15Native|createT15Native|\bfetch\(/);
  const compact = source.replaceAll(/\s+/g, '');
  assert.match(compact, /if\(host\.getElementById\(rootId\)\)return/);
  assert.match(compact, /if\(!owned\|\|stopped\)return/);
  assert.match(source, /__WE_HOST_DISPOSE__/);
  assert.match(compact, /\{get,configurable:true\}/);
  assert.match(source, /Mvu:.*typeof Mvu/);
  assert.doesNotMatch(source, /replaceScriptTrees|updateScriptTreesWith|postMessage/);
});
test('H3 existing host and new import Vue templates/styles compile; strict virtual TS', () => {
  const virtuals = new Map<string, string>();
  for (const name of ['T15ImportWorkspace.vue', 'T15HostWorkspace.vue']) {
    const file = resolve('src/世界演变/rebuild', name),
      { descriptor, errors } = parse(readFileSync(file, 'utf8'), { filename: file });
    assert.deepEqual(errors, []);
    const script = compileScript(descriptor, { id: 'data-v-h3-test', inlineTemplate: true });
    virtuals.set((file + '.ts').replaceAll('\\', '/'), script.content);
    for (const style of descriptor.styles)
      assert.deepEqual(
        compileStyle({ source: style.content, filename: file, id: 'data-v-h3-test', scoped: true }).errors,
        [],
      );
  }
  const declaration = resolve('h3-test-only.d.ts').replaceAll('\\', '/');
  const options: ts.CompilerOptions = {
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    esModuleInterop: true,
    types: ['node', 'jquery'],
  };
  const host = ts.createCompilerHost(options),
    get = host.getSourceFile;
  host.getSourceFile = (p, language, error, fresh) => {
    const path = p.replaceAll('\\', '/'),
      content =
        path === declaration
          ? "declare module '*.vue' { const component: import('vue').Component; export default component; }"
          : virtuals.get(path);
    return content === undefined ? get(p, language, error, fresh) : ts.createSourceFile(p, content, language, true);
  };
  function declarations(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap(e =>
      e.isDirectory() ? declarations(resolve(dir, e.name)) : e.name.endsWith('.d.ts') ? [resolve(dir, e.name)] : [],
    );
  }
  const diagnostics = ts.getPreEmitDiagnostics(
    ts.createProgram([...virtuals.keys(), declaration, ...declarations(resolve('@types'))], options, host),
  );
  assert.equal(
    ts.formatDiagnostics(diagnostics, {
      getCanonicalFileName: p => p,
      getCurrentDirectory: () => process.cwd(),
      getNewLine: () => '\n',
    }),
    '',
  );
});

test('H3 foreign database protocol/frame/data keep native message identity and produce a local candidate', () => {
  const message = {},
    ticket = {},
    binding = { characterId: 'test.png', hostChatId: 'test' };
  const foreignBinding = runInNewContext('({characterId:"test.png",hostChatId:"test"})');
  let listener: ((event: T15DbEvent) => void) | undefined;
  const observer: T15DbObserver = {
    protocol: 'WorldEvolution/TavernDB-auto-round/1',
    coverage: runInNewContext('["automatic-plan"]'),
    candidateOnly: true,
    subscribe(fn) {
      listener = fn;
    },
    unsubscribe() {
      listener = undefined;
    },
    isCurrent: () => true,
  };
  const frame = { binding: foreignBinding, message, swipe: 0, text: '剧情', isolation: 'slot' };
  const adapter = createT15DbCompletionAdapter({
    observer,
    current: () => ({ binding, message, swipe: 0, text: '剧情', matchingBodies: 1 }),
    epoch: () => 0,
    changed: () => {},
  });
  let expected: unknown;
  const gate = {
    readInput: () => ({ story: [{ text: '剧情' }], anchor: {} }),
    begin: () => ticket,
    complete: (_id: unknown, _token: unknown, values: unknown) => {
      expected = values;
    },
  } as unknown as T15Prerequisites;
  try {
    listener!({ type: 'begin', ticket, frame, plan: ['one'] });
    listener!({
      type: 'terminal',
      ticket,
      frame,
      outcome: 'success',
      reason: '结束',
      plan: ['one'],
      groups: [{ key: 'one', success: true }],
      data: runInNewContext('({TavernDB_ACU_IsolatedData:{slot:{name:"测试甲"}}})'),
    });
    assert.equal(adapter.status().candidate, true);
    adapter.apply(gate, [{ path: ['TavernDB_ACU_IsolatedData', 'slot'], label: '实际资料', tableIds: [] }]);
    assert.deepEqual(cloneT2Json(expected), [{ name: '测试甲' }]);
  } finally {
    adapter.close();
  }
});

test('H3 actual entry duplicate/unload/bridge behavior in fake documents performs zero host reads or writes', () => {
  class Element {
    id = '';
    style: Record<string, string> = {};
    hidden = false;
    textContent = '';
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
    readyState = 'complete';
    handlers = new Map<string, () => void>();
    createElement(tag: string) {
      return new Element(tag);
    }
    getElementById(id: string): Element | null {
      const search = (root: Element): Element | null =>
        root.id === id ? root : (root.children.map(search).find(Boolean) ?? null);
      return search(this.body);
    }
    addEventListener(name: string, fn: () => void) {
      this.handlers.set(name, fn);
    }
  }
  const host = new Doc(),
    menu = host.createElement('div');
  menu.id = 'extensionsMenu';
  host.body.append(menu);
  let reads = 0,
    writes = 0,
    buttons = 0,
    stops = 0,
    disposed = 0;
  const build = ts.transpileModule(
    readFileSync(resolve('src/世界演变/rebuild/t15-import-entry.ts'), 'utf8').replace(
      /import \{ T15_HOST_VERSION \} from '.\/t15-import-runtime';/,
      `const T15_HOST_VERSION=${JSON.stringify(T15_HOST_VERSION)};`,
    ),
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } },
  ).outputText;
  const make = () => {
    const handlers = new Map<string, () => void>(),
      context = {
        window: {
          parent: { document: host },
          addEventListener: (name: string, fn: () => void) => handlers.set(name, fn),
        },
        document: new Doc(),
        getButtonEvent: (name: string) => name,
        eventOn: () => {
          buttons++;
          return {
            stop: () => {
              stops++;
            },
          };
        },
        getVariables: () => {
          reads++;
          return {};
        },
        insertOrAssignVariables: () => {
          writes++;
        },
        __T15_HOST_APP_SOURCE__: '/* fixed inert fake app */',
        __T15_HOST_BUILD_HASH__: 'test',
        getScriptId: () => T15_HOST_SCRIPT_ID,
        Mvu: { events: {} },
      };
    runInNewContext(`(()=>{${build}})()`, context);
    return { handlers, context };
  };
  const first = make(),
    duplicate = make();
  assert.equal(menu.children.length, 1);
  assert.equal(buttons, 1);
  assert.equal(reads, 0);
  assert.equal(writes, 0);
  duplicate.handlers.get('pagehide')?.();
  assert.equal(menu.children.length, 1);
  menu.children[0].onclick!();
  const panel = host.getElementById('world-evolution-host-import-entry-panel')!;
  const frame = panel.children.find(c => c.tag === 'iframe')!;
  frame.handlers.get('load')!();
  assert.equal((frame.contentWindow.getScriptId as () => string)(), T15_HOST_SCRIPT_ID);
  assert.equal(frame.contentWindow.Mvu, first.context.Mvu);
  first.context.Mvu = { events: { changed: true } } as typeof first.context.Mvu;
  assert.equal(frame.contentWindow.Mvu, first.context.Mvu, 'bridge remains dynamic');
  assert.equal(frame.contentDocument!.body.children.length, 1);
  assert.equal(reads, 0);
  assert.equal(writes, 0);
  frame.contentWindow.__WE_HOST_DISPOSE__ = () => {
    disposed++;
  };
  first.handlers.get('pagehide')!();
  assert.equal(disposed, 1);
  assert.equal(stops, 1);
  assert.equal(menu.children.length, 0);
  assert.equal(host.getElementById('world-evolution-host-import-entry'), null);
});

test('H3 native saved chat comparisons accept foreign plain metadata/messages without replacing foreign story or MVU', async () => {
  const f = await wiringFixture();
  f.host.close();
  const newReply = { name: '角色', is_user: false, mes: '新的测试剧情', extra: {} };
  f.chat.push(newReply);
  f.mutate(doc => doc.push({ ...newReply }));
  const foreign = runInNewContext('JSON.parse(text)', { text: JSON.stringify({ metadata: f.metadata, chat: f.chat }) });
  const context = f.port.context();
  const host = createT15CompatibilityHost({
    ...f.port,
    leaseTarget: {},
    metadata: () => foreign.metadata,
    context: () => ({ ...context, chat: foreign.chat }),
  });
  try {
    const gateway = createT10CompatibilityGateway(host.driver);
    const before = JSON.stringify(
      foreign.chat.map((m: Record<string, unknown>) => ({
        mes: m.mes,
        extra: m.extra,
        stat: (m.variables as Record<string, unknown>[] | undefined)?.[0]?.stat_data ?? null,
      })),
    );
    await gateway.registerMessages(f.scope, kind => `${kind}-${crypto.randomUUID().slice(0, 8)}`);
    const doc = await host.driver.readDurable(f.binding);
    assert.equal(doc.messages.length, 3);
    assert.equal(
      JSON.stringify(
        foreign.chat.map((m: Record<string, unknown>) => ({
          mes: m.mes,
          extra: m.extra,
          stat: (m.variables as Record<string, unknown>[] | undefined)?.[0]?.stat_data ?? null,
        })),
      ),
      before,
    );
    assert.ok(f.saves() >= 2);
  } finally {
    host.close();
    f.close();
  }
});
