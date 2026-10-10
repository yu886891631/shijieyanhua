import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import test, { before } from 'node:test';
import { runInNewContext } from 'node:vm';
import { Worker } from 'node:worker_threads';
import { gzipSync } from 'node:zlib';
import initSqlJs from 'sql.js';
import { compileT3BrowserTestBundle } from './t3-browser-test-bundle';
import { createDefaultT2Fixture } from './t2-defaults';
import { createT3LocalPolicy, executeT3Request, type T3Request, type T3Result } from './t3-engine';
import { cloneT2Json } from './t2-template';
import {
  createT3BrowserWorkerFactory,
  createT3WorkerRunner,
  T3RuntimeError,
  type T3WorkerEvent,
  type T3WorkerEventType,
  type T3WorkerExecuteMessage,
  type T3WorkerListener,
  type T3WorkerPort,
} from './t3-runtime';

const fixture = createDefaultT2Fixture();
const request: T3Request = {
  ...fixture,
  sql: 'SELECT f_name FROM we_npc WHERE __we_row_id = ?',
  parameters: ['lin-watch'],
  batchId: 'transport',
  policy: createT3LocalPolicy(fixture.template, fixture.data),
};
let result: T3Result;
before(async () => {
  const SQL = await initSqlJs({
    wasmBinary: new Uint8Array(readFileSync(resolve('node_modules/sql.js/dist/sql-wasm.wasm'))).buffer,
  });
  result = executeT3Request(SQL, request);
});

class FakeWorker implements T3WorkerPort {
  readonly listeners = new Map<T3WorkerEventType, Set<T3WorkerListener>>();
  readonly posted: T3WorkerExecuteMessage[] = [];
  terminated = 0;
  postError = false;
  onPost?: () => void;

  addEventListener(type: T3WorkerEventType, listener: T3WorkerListener) {
    const values = this.listeners.get(type) ?? new Set();
    values.add(listener);
    this.listeners.set(type, values);
  }

  removeEventListener(type: T3WorkerEventType, listener: T3WorkerListener) {
    this.listeners.get(type)?.delete(listener);
  }
  postMessage(message: T3WorkerExecuteMessage) {
    if (this.postError) throw new Error('send failed');
    this.posted.push(message);
    this.onPost?.();
  }
  terminate() {
    this.terminated += 1;
  }
  emit(type: T3WorkerEventType, event: T3WorkerEvent) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
  get listenerCount() {
    return Array.from(this.listeners.values()).reduce((sum, set) => sum + set.size, 0);
  }
}

test('成功结果结束单次 Worker，清理所有监听，不留下可复用 SQLite 状态', async () => {
  const worker = new FakeWorker();
  const promise = createT3WorkerRunner(() => worker).run(request);
  assert.deepEqual(worker.posted, [{ type: 'execute', request }]);
  worker.emit('message', { data: { type: 'result', result } });
  assert.deepEqual(await promise, result);
  assert.equal(worker.terminated, 1);
  assert.equal(worker.listenerCount, 0);
});

test('并发请求各有独立 Worker，取消其中一项不取消另一项', async () => {
  const first = new FakeWorker();
  const second = new FakeWorker();
  const workers = [first, second];
  const runner = createT3WorkerRunner(() => workers.shift()!);
  const abort = new AbortController();
  const cancelled = runner.run(request, { signal: abort.signal });
  const accepted = runner.run(request);
  abort.abort();
  second.emit('message', { data: { type: 'result', result } });
  await assert.rejects(cancelled, { code: 'ABORTED' });
  assert.deepEqual(await accepted, result);
  assert.equal(first.terminated, 1);
  assert.equal(second.terminated, 1);
});

test('已取消请求不创建 Worker；取消后的迟到结果不能被接受', async () => {
  const controller = new AbortController();
  controller.abort();
  let created = false;
  await assert.rejects(
    createT3WorkerRunner(() => {
      created = true;
      return new FakeWorker();
    }).run(request, { signal: controller.signal }),
    { code: 'ABORTED' },
  );
  assert.equal(created, false);
  const active = new AbortController();
  const worker = new FakeWorker();
  const running = createT3WorkerRunner(() => worker).run(request, { signal: active.signal });
  const late = Array.from(worker.listeners.get('message')!)[0];
  active.abort();
  late({ data: { type: 'result', result } });
  await assert.rejects(running, { code: 'ABORTED' });
  assert.equal(worker.terminated, 1);
  assert.equal(worker.listenerCount, 0);
});

test('超时强制 terminate Worker，清理监听并拒绝随后到达的结果', async () => {
  const worker = new FakeWorker();
  const running = createT3WorkerRunner(() => worker, 10).run(request);
  const late = Array.from(worker.listeners.get('message')!)[0];
  await assert.rejects(running, { code: 'TIMEOUT' });
  late({ data: { type: 'result', result } });
  assert.equal(worker.terminated, 1);
  assert.equal(worker.listenerCount, 0);
});

test('启动失败、发送失败和清理失败均不接受结果', async () => {
  await assert.rejects(
    createT3WorkerRunner(() => {
      throw new Error('CSP');
    }).run(request),
    { code: 'WORKER_START' },
  );
  const worker = new FakeWorker();
  worker.postError = true;
  await assert.rejects(createT3WorkerRunner(() => worker).run(request), { code: 'WORKER_START' });
  assert.equal(worker.terminated, 1);
  assert.equal(worker.listenerCount, 0);
  const cleanupFails = new FakeWorker();
  cleanupFails.removeEventListener = () => {
    throw new Error('broken adapter');
  };
  const pending = createT3WorkerRunner(() => cleanupFails).run(request);
  cleanupFails.emit('messageerror', {});
  await assert.rejects(pending, { code: 'PROTOCOL' });
  assert.equal(cleanupFails.terminated, 1);
});

test('Worker 错误、消息解码错误、错误封装和未知消息全部失败关闭', async () => {
  const cases: [T3WorkerEventType, T3WorkerEvent, string][] = [
    ['error', { message: 'bad', preventDefault() {} }, 'WORKER_ERROR'],
    ['messageerror', {}, 'PROTOCOL'],
    ['message', { data: { type: 'error', error: { code: 'SQL', message: '拒绝SQL' } } }, 'WORKER_ERROR'],
    ['message', { data: { type: 'ready' } }, 'PROTOCOL'],
    ['message', { data: { type: 'result', result: null } }, 'PROTOCOL'],
    ['message', { data: { type: 'result', result: {} } }, 'PROTOCOL'],
    ['message', { data: { type: 'result', result, extra: 1 } }, 'PROTOCOL'],
    ['message', { data: { type: 'result', result: { invalid: NaN } } }, 'PROTOCOL'],
    ['message', { data: { type: 'result', result: { invalid() {} } } }, 'PROTOCOL'],
    ['message', { data: { type: 'error', error: { code: 1, message: 'bad' } } }, 'PROTOCOL'],
    ['message', { data: { type: 'error', error: { code: 'CUSTOM', message: 'bad' } } }, 'PROTOCOL'],
    ['message', { data: { type: 'error', error: { code: 'DATA', message: 'bad', statementIndex: 32 } } }, 'PROTOCOL'],
    ['message', { data: { type: 'error', error: { code: 'DATA', message: 'bad', statementIndex: -1 } } }, 'PROTOCOL'],
    ['message', { data: { type: 'error', error: { code: 'DATA', message: 'bad', statementIndex: 0.5 } } }, 'PROTOCOL'],
    [
      'message',
      { data: { type: 'error', error: { code: 'DATA', message: 'bad', fieldId: 'constructor' } } },
      'PROTOCOL',
    ],
    ['message', { data: { type: 'error', error: { code: 'DATA', message: 'bad', fieldId: '<script>' } } }, 'PROTOCOL'],
    [
      'message',
      { data: { type: 'error', error: { code: 'DATA', message: 'bad', tableId: 'constructor' } } },
      'PROTOCOL',
    ],
    ['message', { data: { type: 'error', error: { code: 'DATA', message: 'bad', tableId: '<script>' } } }, 'PROTOCOL'],
    [
      'message',
      { data: { type: 'error', error: { code: 'DATA', message: 'bad', rawData: 'not allowed' } } },
      'PROTOCOL',
    ],
  ];
  for (const [type, event, code] of cases) {
    const worker = new FakeWorker();
    const pending = createT3WorkerRunner(() => worker).run(request);
    worker.emit(type, event);
    await assert.rejects(pending, { code });
    assert.equal(worker.terminated, 1);
    assert.equal(worker.listenerCount, 0);
  }
});

test('结构化领域错误和传输错误不混淆，保留定位但不把原消息内容当 UI 文本', async () => {
  const worker = new FakeWorker();
  const running = createT3WorkerRunner(() => worker).run(request);
  worker.emit('message', {
    data: {
      type: 'error',
      error: {
        code: 'DATA',
        message: '机密值:<script>secret</script>',
        statementIndex: 1,
        fieldId: 'name',
        tableId: 'npc',
      },
    },
  });
  await assert.rejects(running, error => {
    assert.ok(error instanceof T3RuntimeError);
    assert.equal(error.code, 'WORKER_ERROR');
    assert.equal(error.domainCode, 'DATA');
    assert.deepEqual(error.details, { statementIndex: 1, fieldId: 'name', tableId: 'npc' });
    assert.ok(Object.isFrozen(error.details));
    assert.doesNotMatch(error.message, /secret|script|机密/);
    return true;
  });
});

test('运行器冻结克隆请求，调用方后续编辑不改变 Worker 快照或结果验收身份', async () => {
  const worker = new FakeWorker();
  const work = cloneT2Json(request) as unknown as T3Request;
  const running = createT3WorkerRunner(() => worker).run(work);
  assert.notEqual(worker.posted[0].request, work);
  assert.ok(Object.isFrozen(worker.posted[0].request));
  assert.ok(Object.isFrozen(worker.posted[0].request.data.tables.npc[0].values));
  work.data.worldId = 'changed-world';
  work.batchId = 'changed-batch';
  work.parameters[0] = 'changed-target';
  assert.equal(worker.posted[0].request.data.worldId, request.data.worldId);
  worker.emit('message', { data: { type: 'result', result } });
  assert.deepEqual(await running, result);
  const rejected = new FakeWorker();
  await assert.rejects(createT3WorkerRunner(() => rejected).run({ ...request, data: {} } as T3Request), {
    code: 'PROTOCOL',
  });
  assert.equal(rejected.posted.length, 0);
});

test('超时设置硬边界，Worker 创建过程中取消不发送工作', async () => {
  for (const timeout of [0, -1, 1.5, 60001, NaN, Infinity])
    assert.throws(() => createT3WorkerRunner(() => new FakeWorker(), timeout), T3RuntimeError);
  await assert.rejects(createT3WorkerRunner(() => new FakeWorker()).run(request, { timeoutMs: 0 }), {
    code: 'PROTOCOL',
  });
  const controller = new AbortController();
  const worker = new FakeWorker();
  await assert.rejects(
    createT3WorkerRunner(() => {
      controller.abort();
      return worker;
    }).run(request, { signal: controller.signal }),
    { code: 'ABORTED' },
  );
  assert.equal(worker.posted.length, 0);
  assert.equal(worker.listenerCount, 0);
  assert.equal(worker.terminated, 1);
});

test('浏览器 Blob Worker 生命周期释放对象 URL，构造失败也释放 URL', async () => {
  const originalWorker = globalThis.Worker;
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  const releases: string[] = [];
  const constructed: unknown[][] = [];
  const worker = new FakeWorker();
  try {
    URL.createObjectURL = () => 'blob:t3-test';
    URL.revokeObjectURL = url => {
      releases.push(url);
    };
    globalThis.Worker = class {
      constructor(...args: unknown[]) {
        constructed.push(args);
        return worker;
      }
    } as unknown as typeof globalThis.Worker;
    const factory = createT3BrowserWorkerFactory('/* embedded local bundle */');
    const port = factory();
    port.terminate();
    port.terminate();
    assert.equal(worker.terminated, 1);
    assert.deepEqual(releases, ['blob:t3-test']);
    assert.equal(constructed[0][0], 'blob:t3-test');
    globalThis.Worker = class {
      constructor() {
        throw new Error('CSP denied');
      }
    } as unknown as typeof globalThis.Worker;
    assert.throws(factory, /CSP denied/);
    assert.deepEqual(releases, ['blob:t3-test', 'blob:t3-test']);
    assert.throws(() => createT3BrowserWorkerFactory('   '));
  } finally {
    globalThis.Worker = originalWorker;
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
  }
});

let browserRuntimeBundle: ReturnType<typeof compileT3BrowserTestBundle> | undefined;
const loadBundle = () =>
  (browserRuntimeBundle ??= compileT3BrowserTestBundle('src/世界演变/rebuild/t3-browser-runtime.ts'));

test('真实浏览器 WASM bundle 内嵌固定资源，没有 Node 模块或外部导入，网络禁用仍启动', async t => {
  const built = await loadBundle();
  assert.ok(built.moduleNames.some(name => name.includes('sql-wasm-browser.js')));
  assert.ok(built.moduleNames.some(name => name.includes('sql-wasm-browser.wasm?inline')));
  assert.ok(
    built.moduleNames.every(name => !/external |\bnode:|(?:^|[ /])(?:fs|path|crypto)\b/.test(name)),
    built.moduleNames.join('\n'),
  );
  assert.doesNotMatch(built.code, /importScripts\s*\(/);
  let networkAttempts = 0;
  const blockNetwork = () => {
    networkAttempts += 1;
    throw new Error('network forbidden');
  };
  const sandbox = {
    console,
    Uint8Array,
    ArrayBuffer,
    WebAssembly,
    atob,
    crypto: webcrypto,
    TextDecoder,
    TextEncoder,
    fetch: blockNetwork,
    XMLHttpRequest: class {
      constructor() {
        blockNetwork();
      }
    },
    self: { location: { href: 'blob:local-sqlite-test' } },
    importScripts: blockNetwork,
  };
  const context = runInNewContext(`${built.code}\nT3TestBundle`, sandbox) as {
    T3_SQLJS_VERSION: string;
    T3_WASM_BYTES: number;
    createT3BrowserRuntime(): Promise<{ Database: new () => { exec(sql: string): unknown; close(): void } }>;
    decodeT3InlineWasm(input: string): Uint8Array;
  };
  assert.equal(context.T3_SQLJS_VERSION, '1.14.2');
  assert.equal(context.T3_WASM_BYTES, 658410);
  const started = performance.now();
  const SQL = await context.createT3BrowserRuntime();
  const startupMs = performance.now() - started;
  const db = new SQL.Database();
  try {
    const version = db.exec('SELECT sqlite_version() AS version');
    assert.ok(JSON.stringify(version).includes('3.'));
    assert.equal(networkAttempts, 0);
    t.diagnostic(
      JSON.stringify({
        bundleBytes: Buffer.byteLength(built.code),
        gzipBytes: gzipSync(built.code).length,
        wasmBytes: 658410,
        startupMs: Math.round(startupMs),
        sqlite: version,
      }),
    );
  } finally {
    db.close();
  }
  assert.throws(() => context.decodeT3InlineWasm('https://cdn.test/sqlite.wasm'), /不允许从网络/);
  assert.throws(() => context.decodeT3InlineWasm('data:application/wasm;base64,AAAA'), /长度或编码/);
  assert.equal(networkAttempts, 0);
});

test('WASM 指纹改变或无法校验时拒绝启动，不尝试网络补载', async () => {
  const built = await loadBundle();
  const original = readFileSync(resolve('node_modules/sql.js/dist/sql-wasm-browser.wasm'));
  let changed: Buffer | undefined;
  for (let index = original.length - 1; index >= original.length - 128; index -= 1) {
    const candidate = Buffer.from(original);
    candidate[index] ^= 1;
    if (WebAssembly.validate(candidate)) {
      changed = candidate;
      break;
    }
  }
  assert.ok(changed, 'Find a structurally valid WASM byte mutation, so hash validation—not compilation—rejects it.');
  const originalAsset = `data:application/wasm;base64,${original.toString('base64')}`;
  const changedAsset = `data:application/wasm;base64,${changed.toString('base64')}`;
  assert.ok(built.code.includes(originalAsset));
  let networkAttempts = 0;
  const block = () => {
    networkAttempts += 1;
    throw new Error('network forbidden');
  };
  const sandbox = {
    console,
    Uint8Array,
    ArrayBuffer,
    WebAssembly,
    atob,
    crypto: webcrypto,
    TextDecoder,
    TextEncoder,
    fetch: block,
    XMLHttpRequest: block,
  };
  const changedExports = runInNewContext(
    `${built.code.replace(originalAsset, changedAsset)}\nT3TestBundle`,
    sandbox,
  ) as { createT3BrowserRuntime(): Promise<unknown> };
  await assert.rejects(changedExports.createT3BrowserRuntime(), /指纹不符合/);
  const missingCrypto = runInNewContext(`${built.code}\nT3TestBundle`, { ...sandbox, crypto: undefined }) as {
    createT3BrowserRuntime(): Promise<unknown>;
  };
  await assert.rejects(missingCrypto.createT3BrowserRuntime(), /无法校验/);
  assert.equal(networkAttempts, 0);
});

function nodeBrowserWorker(code: string, started?: () => void): T3WorkerPort & { native: Worker; terminated: number } {
  const prefix = `const {parentPort} = require('node:worker_threads');
    globalThis.crypto = require('node:crypto').webcrypto;
    globalThis.self = globalThis; globalThis.location = {href:'blob:t3-local-test'};
    globalThis.fetch = () => { throw new Error('network forbidden'); };
    globalThis.XMLHttpRequest = class { constructor(){ throw new Error('network forbidden'); } };
    globalThis.importScripts = () => { throw new Error('external scripts forbidden'); };
    globalThis.addEventListener = (type, listener) => { if(type==='message') parentPort.on('message', data => listener({data})); };
    globalThis.postMessage = data => parentPort.postMessage(data);
  `;
  const native = new Worker(`${prefix}\n${code}`, { eval: true });
  const callbacks = new Map<T3WorkerListener, { type: T3WorkerEventType; callback: (...args: unknown[]) => void }>();
  native.on('message', message => {
    if (message?.type === 'test-started') started?.();
  });
  const port: T3WorkerPort & { native: Worker; terminated: number } = {
    native,
    terminated: 0,
    addEventListener(type, listener) {
      const callback =
        type === 'message'
          ? (data: unknown) => {
              if (!(data !== null && typeof data === 'object' && 'type' in data && data.type === 'test-started'))
                listener({ data });
            }
          : (error: unknown) => listener({ message: String(error) });
      callbacks.set(listener, { type, callback });
      native.on(type, callback);
    },
    removeEventListener(_type, listener) {
      const entry = callbacks.get(listener);
      if (entry) native.off(entry.type, entry.callback);
      callbacks.delete(listener);
    },
    postMessage(message) {
      native.postMessage(message);
    },
    terminate() {
      port.terminated += 1;
      void native.terminate();
    },
  };
  return port;
}

test('完整生产 Worker bundle 执行受限 SQL，返回隔离副本，并可重新从原 JSON 恢复', async t => {
  const built = await compileT3BrowserTestBundle('src/世界演变/rebuild/t3-worker.ts');
  assert.ok(
    built.moduleNames.every(name => !/external |\bnode:/.test(name)),
    built.moduleNames.join('\n'),
  );
  assert.doesNotMatch(built.code, /importScripts\s*\(/);
  const { template, data } = createDefaultT2Fixture();
  const original = JSON.stringify(data);
  const work: T3Request = {
    template,
    data,
    sql: 'UPDATE we_npc SET f_goals = ? WHERE __we_row_id = ?; SELECT f_name, f_goals FROM we_npc WHERE __we_row_id = ?',
    parameters: ['保护修好的河堤', 'lin-watch', 'lin-watch'],
    batchId: 'worker-demo',
    policy: createT3LocalPolicy(template, data),
  };
  const runner = createT3WorkerRunner(() => nodeBrowserWorker(built.code));
  const started = performance.now();
  const changed = await runner.run(work);
  assert.equal(changed.mode, 'isolated-sqlite');
  assert.equal(changed.data.tables.npc[0].values.goals, '保护修好的河堤');
  assert.equal(changed.data.revision, data.revision);
  assert.equal(JSON.stringify(data), original);
  const restore = await runner.run({
    ...work,
    sql: 'SELECT f_goals FROM we_npc WHERE __we_row_id = ?',
    parameters: ['lin-watch'],
  });
  assert.equal(restore.data.tables.npc[0].values.goals, data.tables.npc[0].values.goals);
  await assert.rejects(runner.run({ ...work, sql: 'DROP TABLE we_npc', parameters: [] }), { code: 'WORKER_ERROR' });
  await assert.rejects(
    runner.run({
      ...work,
      sql: 'SELECT f_name FROM we_npc WHERE __we_row_id = ?; UPDATE we_npc SET f_name = ? WHERE __we_row_id = ?',
      parameters: ['lin-watch', 42, 'lin-watch'],
    }),
    error => {
      assert.ok(error instanceof T3RuntimeError);
      assert.equal(error.code, 'WORKER_ERROR');
      assert.equal(error.domainCode, 'DATA');
      assert.deepEqual(error.details, { statementIndex: 1, fieldId: 'name', tableId: 'npc' });
      return true;
    },
  );
  t.diagnostic(
    JSON.stringify({
      workerBundleBytes: Buffer.byteLength(built.code),
      gzipBytes: gzipSync(built.code).length,
      requestAndRestoreMs: Math.round(performance.now() - started),
    }),
  );
});

test('真实 Worker 中同步重型 SQLite 在返回前被 watchdog 和取消终止', async t => {
  const built = await compileT3BrowserTestBundle('src/世界演变/rebuild/t3-runtime.test-worker.ts');
  const heavy =
    'WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x < 1000000000) SELECT sum(x) FROM n';
  const timeoutMarkers = new SharedArrayBuffer(8);
  let timeoutPort: ReturnType<typeof nodeBrowserWorker> | undefined;
  const before = performance.now();
  const trustedTestPort = (markers: SharedArrayBuffer, started?: () => void) => {
    const port = nodeBrowserWorker(built.code, started);
    // Only this test adapter sends unrestricted workload/control markers to a test-only worker.
    // The production runner still receives and freezes an ordinary valid request.
    port.postMessage = () => port.native.postMessage({ type: 'execute', request: { sql: heavy, markers } });
    return port;
  };
  const timed = createT3WorkerRunner(() => (timeoutPort = trustedTestPort(timeoutMarkers)), 1500).run(request);
  await assert.rejects(timed, { code: 'TIMEOUT' });
  assert.equal(Atomics.load(new Int32Array(timeoutMarkers), 0), 1, 'SQLite heavy execution must actually have started');
  assert.equal(Atomics.load(new Int32Array(timeoutMarkers), 1), 0, 'SQLite must not have returned before termination');
  assert.equal(timeoutPort!.terminated, 1);
  const controller = new AbortController();
  const abortMarkers = new SharedArrayBuffer(8);
  let abortPort: ReturnType<typeof nodeBrowserWorker> | undefined;
  const cancelled = createT3WorkerRunner(
    () => (abortPort = trustedTestPort(abortMarkers, () => setTimeout(() => controller.abort(), 10))),
    5000,
  ).run(request, { signal: controller.signal });
  await assert.rejects(cancelled, { code: 'ABORTED' });
  assert.equal(Atomics.load(new Int32Array(abortMarkers), 0), 1);
  assert.equal(Atomics.load(new Int32Array(abortMarkers), 1), 0);
  assert.equal(abortPort!.terminated, 1);
  t.diagnostic(
    `Real-worker timeout termination: ${Math.round(performance.now() - before)} ms; no heavy-query result accepted.`,
  );
});

test('T3 Worker 和纯客户端无当前聊天、持久化、API 或世界书入口', () => {
  for (const path of ['t3-runtime.ts', 't3-browser-runtime.ts', 't3-worker.ts']) {
    const source = readFileSync(resolve('src/世界演变/rebuild', path), 'utf8');
    assert.doesNotMatch(
      source,
      /getVariables|replaceVariables|setChatMessages|worldbook|indexedDB|localStorage|fetch\s*\(|https?:\/\/|from ['"]node:/,
    );
  }
});
