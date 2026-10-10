import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import initSqlJs from 'sql.js';
import * as ts from 'typescript';
import * as Vue from 'vue';
import { compileScript, compileStyle, parse } from 'vue/compiler-sfc';
import { renderToString } from 'vue/server-renderer';
import { createDefaultT2Fixture } from './t2-defaults';
import { cloneT2Json, type T2Row } from './t2-template';
import { prepareT2NewRow } from './t2-values';
import { createT3LocalPolicy, executeT3Request } from './t3-engine';
import * as preview from './t4-preview';
import type { T4PreviewInput } from './t4-preview';

const filename = resolve('src/世界演变/rebuild/T4CommitPreview.vue');
const source = readFileSync(filename, 'utf8');
const parsed = parse(source, { filename });
function compilePreview(inlineTemplate = true): Vue.Component {
  assert.deepEqual(parsed.errors, []);
  const script = compileScript(parsed.descriptor, { id: 'data-v-we-t4', inlineTemplate });
  const output = ts.transpileModule(script.content, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    reportDiagnostics: true,
  });
  assert.equal(output.diagnostics?.length ?? 0, 0);
  const compiled: { exports: { default?: Vue.Component } } = { exports: {} };
  const imports: Record<string, unknown> = { vue: Vue, './t4-preview': preview };
  new Function('require', 'module', 'exports', output.outputText)(
    (id: string) => {
      if (!Object.hasOwn(imports, id)) throw new Error(`T4 preview unexpected dependency: ${id}`);
      return imports[id];
    },
    compiled,
    compiled.exports,
  );
  assert.ok(compiled.exports.default);
  return compiled.exports.default;
}
const Preview = compilePreview();
const render = (input?: unknown) => renderToString(Vue.createSSRApp(Preview, input === undefined ? {} : { input }));
function fixture(): T4PreviewInput {
  const base = createDefaultT2Fixture();
  const draft = cloneT2Json(base) as unknown as typeof base;
  draft.data.tables.npc[0].values.goals = '检查北门后再安排居民通行。';
  return {
    status: 'private',
    base,
    draft,
    scope: { mode: 't4-sandbox', chatId: 'sandbox-preview', worldId: base.data.worldId, branchId: base.data.branchId },
    anchor: {
      chatId: 'sandbox-preview',
      messageId: 'assistant-one',
      swipeId: 'swipe-one',
      inputFingerprint: 'a'.repeat(64),
    },
    kind: 'manual',
  };
}

test('T4 预览SFC与私有scoped样式编译，不依赖提交服务、SQL或宿主入口', () => {
  assert.equal(parsed.descriptor.styles.length, 1);
  assert.equal(parsed.descriptor.styles[0].scoped, true);
  const css = compileStyle({ source: parsed.descriptor.styles[0].content, filename, id: 'data-v-we-t4', scoped: true });
  assert.deepEqual(css.errors, []);
  assert.match(css.code, /\[data-v-we-t4\]/);
  assert.doesNotMatch(
    source,
    /v-html|innerHTML|indexedDB|localStorage|fetch\(|window\.|document\.|executeT3|sql\.js|t4-service|t4-store/,
  );
  assert.doesNotMatch(parsed.descriptor.styles[0].content, /(?:^|\n)\s*(?:body|html|\.menu_button)\s*\{/);
});

test('T4 预览虚拟编译strict TypeScript，无构建输出', () => {
  const script = compileScript(parsed.descriptor, { id: 'data-v-we-t4', inlineTemplate: true });
  const virtualFilename = `${filename}.ts`.replaceAll('\\', '/');
  const options: ts.CompilerOptions = {
    noEmit: true,
    strict: true,
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    skipLibCheck: true,
    esModuleInterop: true,
  };
  const host = ts.createCompilerHost(options);
  const get = host.getSourceFile,
    exists = host.fileExists,
    read = host.readFile;
  const isVirtual = (path: string) => path.replaceAll('\\', '/') === virtualFilename;
  host.fileExists = path => isVirtual(path) || exists(path);
  host.readFile = path => (isVirtual(path) ? script.content : read(path));
  host.getSourceFile = (path, version, onError, fresh) =>
    isVirtual(path) ? ts.createSourceFile(path, script.content, version, true) : get(path, version, onError, fresh);
  const program = ts.createProgram([virtualFilename], options, host);
  assert.equal(
    ts.formatDiagnostics(ts.getPreEmitDiagnostics(program), {
      getCanonicalFileName: path => path,
      getCurrentDirectory: () => process.cwd(),
      getNewLine: () => '\n',
    }),
    '',
  );
});

test('T4 只读差异以人话呈现范围与前后值，不虚构聊天保存', async () => {
  const input = fixture();
  const before = JSON.stringify(input);
  const model = preview.createT4PreviewModel(input);
  assert.equal(model.valid, true);
  assert.equal(model.confirmationAllowed, true);
  assert.deepEqual(model.summary, { inserted: 0, updated: 1, deleted: 0, truncated: false });
  assert.equal(model.changes[0].fields[0].name, '公开目标');
  const html = await render(input);
  assert.match(html, /独立模拟存档，未写当前聊天/);
  assert.match(html, /模拟聊天/);
  assert.match(html, /sandbox-preview/);
  assert.match(html, /消息版本/);
  assert.match(html, /修改前/);
  assert.match(html, /检查北门后再安排居民通行/);
  assert.match(html, /校验通过不等于已经保存/);
  assert.match(html, /勾选确认也不会直接保存/);
  assert.doesNotMatch(html, /inputFingerprint|a{64}|<button|>执行SQL<|已存入酒馆聊天<\/strong>/);
  assert.equal(JSON.stringify(input), before);
});

for (const status of ['draft', 'private', 'saving', 'saved', 'failed', 'pending', 'conflict', 'cancelled'] as const)
  test(`T4 ${status} 状态使用固定文案，与模拟范围同时展示`, async () => {
    const input = fixture();
    input.status = status;
    if (status === 'saved') {
      input.commitId = 'commit-one';
      input.seq = 1;
    }
    const model = preview.createT4PreviewModel(input);
    assert.equal(model.status, status);
    assert.equal(model.confirmationAllowed, ['draft', 'private'].includes(status));
    const html = await render(input);
    assert.ok(html.includes(model.badge));
    assert.match(html, /独立模拟存档，未写当前聊天/);
    if (status === 'saved') assert.match(html, /不表示已存入酒馆聊天/);
    if (status === 'pending') assert.match(html, /可能已经写入模拟存档/);
    if (status === 'failed') assert.match(html, /关闭或刷新不保证恢复/);
  });

test('T4 缺少消息锚点只留草稿，不出现可用确认或伪成功', async () => {
  const input = fixture();
  input.anchor = null;
  const model = preview.createT4PreviewModel(input);
  assert.equal(model.status, 'private');
  assert.equal(model.confirmationAllowed, false);
  assert.match(model.confirmationReason, /没有有效助手消息锚点/);
  const html = await render(input);
  assert.match(html, /disabled/);
  assert.match(html, /不能假称已存聊天/);
  input.status = 'saved';
  input.commitId = 'commit-one';
  input.seq = 1;
  assert.equal(preview.createT4PreviewModel(input).status, 'invalid');
});

test('T4 显式起始快照是模拟权威基线，不冒充一次成功提交', async () => {
  const input: T4PreviewInput = { ...fixture(), status: 'saved', draft: null, anchor: null, isGenesis: true, seq: 0 };
  const model = preview.createT4PreviewModel(input);
  assert.equal(model.valid, true);
  assert.equal(model.status, 'saved');
  assert.equal(model.commit, null);
  assert.equal(model.confirmationAllowed, false);
  assert.match(model.badge, /模拟起始资料已载入，尚无提交/);
  const html = await render(input);
  assert.match(html, /尚无提交/);
  assert.doesNotMatch(html, /模拟存档已确认|提交身份/);
  for (const bad of [
    { ...input, commitId: 'fake-commit' },
    { ...input, seq: 1 },
    { ...input, draft: fixture().draft },
    { ...input, status: 'private' },
  ])
    assert.equal(preview.createT4PreviewModel(bad).status, 'invalid');
});

test('T4 隐藏表、记录、字段、UI隐藏列与变化数量不进入模型或HTML', async () => {
  const input = fixture();
  for (const state of [input.base, input.draft!]) {
    const npc = state.template.tables.find(table => table.id === 'npc')!;
    const field = npc.fields.find(item => item.id === 'private_goal')!;
    field.visibility.user = false;
    field.name = 'secret-private-field';
    state.data.tables.npc[1].meta.visibility.user = false;
    state.template.tables.find(table => table.id === 'organization')!.visibility.user = false;
  }
  input.draft!.data.tables.npc[0].values.private_goal = 'secret-value';
  input.draft!.data.tables.npc[0].values.editor_note = 'secret-hidden-ui';
  input.draft!.data.tables.npc[1].values.goals = 'secret-hidden-row';
  input.draft!.data.tables.organization[0].values.name = 'secret-hidden-table';
  const model = preview.createT4PreviewModel(input);
  assert.deepEqual(model.summary, { inserted: 0, updated: 1, deleted: 0, truncated: false });
  assert.doesNotMatch(JSON.stringify(model), /secret-|lin-merchant|private_goal|editor_note|"organization"/);
  assert.doesNotMatch(await render(input), /secret-|lin-merchant|private_goal|editor_note/);
  input.draft!.data.tables.npc[0].values.goals = input.base.data.tables.npc[0].values.goals;
  assert.deepEqual(preview.createT4PreviewModel(input).summary, {
    inserted: 0,
    updated: 0,
    deleted: 0,
    truncated: false,
  });
});

test('T4 引用公开文本变化才计数，隐藏引用数量或身份变化不泄漏', () => {
  const input = fixture();
  input.draft!.data.tables.npc[0].values.goals = input.base.data.tables.npc[0].values.goals;
  for (const state of [input.base, input.draft!]) state.data.tables.npc[1].meta.visibility.user = false;
  input.base.data.tables.npc[0].values.relationships = [{ tableId: 'npc', rowId: 'lin-merchant' }];
  input.draft!.data.tables.npc[0].values.relationships = [];
  const model = preview.createT4PreviewModel(input);
  assert.equal(model.summary.updated, 0);
  assert.doesNotMatch(JSON.stringify(model), /lin-merchant|relationships/);
});

test('T4 引用目标仅在某一端隐藏时，两侧差异都不公开目标身份', () => {
  const input = fixture();
  input.draft!.data.tables.npc[1].meta.visibility.user = false;
  input.draft!.data.tables.npc[0].values.relationships = [];
  const model = preview.createT4PreviewModel(input);
  assert.doesNotMatch(JSON.stringify(model), /lin-merchant/);
  assert.equal(model.changes.length, 1);
  assert.equal(model.changes[0].fields.length, 1);
});

test('T4 可见新增、修改、删除只比较完整有效图，不反复补默认资料', () => {
  const input = fixture();
  input.draft!.data.tables.npc.push(prepareT2NewRow(input.draft!.template, 'npc', 'new-person', { name: '新增角色' }));
  input.draft!.data.tables.plan[1].values.result_events = [];
  input.draft!.data.tables.event = [];
  const model = preview.createT4PreviewModel(input);
  assert.deepEqual(model.summary, { inserted: 1, updated: 2, deleted: 1, truncated: false });
  assert.match(JSON.stringify(model), /新增角色/);
  assert.equal(model.changes.find(change => change.operation === '删除')?.tableId, 'event');
  input.draft!.data.tables.npc[0].values.location = { tableId: 'location', rowId: 'missing' };
  assert.equal(preview.createT4PreviewModel(input).status, 'invalid');
});

test('T4 空串、NULL与零值分别展示，保留字段的明确含义', () => {
  const input = fixture();
  input.draft!.data.tables.npc[0].values.goals = '';
  input.draft!.data.tables.npc[0].values.location = null;
  input.draft!.data.tables.society[0].values.order = 0;
  const model = preview.createT4PreviewModel(input);
  const texts = model.changes.flatMap(change => change.fields.map(field => field.after));
  assert.ok(texts.includes('空字符串'));
  assert.ok(texts.includes('NULL（明确空值）'));
  assert.ok(texts.includes('0'));
});

test('T4 展开最多100条可见记录，总数只包含真实可见业务差异', () => {
  const input = fixture();
  input.draft!.data.tables.npc[0].values.goals = input.base.data.tables.npc[0].values.goals;
  for (let index = 0; index < 101; index += 1) {
    const row = cloneT2Json(input.draft!.data.tables.npc[0]) as unknown as T2Row;
    row.meta.id = `new-public-${index}`;
    row.values.name = `演示角色${index}`;
    input.draft!.data.tables.npc.push(row);
  }
  const model = preview.createT4PreviewModel(input);
  assert.equal(model.valid, true);
  assert.equal(model.changes.length, 100);
  assert.deepEqual(model.summary, { inserted: 101, updated: 0, deleted: 0, truncated: true });
});

test('T4 输入范围错配、损坏状态、访问器和多余私密载荷封闭拒绝', async () => {
  let calls = 0;
  const getter = Object.defineProperty({}, 'template', {
    enumerable: true,
    get() {
      calls += 1;
      throw new Error('secret');
    },
  });
  for (const input of [
    null,
    {},
    { ...fixture(), base: getter },
    { ...fixture(), scope: { ...fixture().scope, mode: 'live' } },
    { ...fixture(), scope: { ...fixture().scope, worldId: 'wrong-world' } },
    { ...fixture(), anchor: { ...fixture().anchor, chatId: 'sandbox-other' } },
    { ...fixture(), status: 'saved' },
    { ...fixture(), sql: 'secret-sql' },
    { ...fixture(), errorCode: '<script>secret</script>' },
  ]) {
    const model = preview.createT4PreviewModel(input);
    assert.equal(model.status, 'invalid');
    assert.equal(model.confirmationAllowed, false);
    assert.deepEqual(model.changes, []);
    const html = await render(input);
    assert.match(html, /没有执行或保存任何内容/);
    assert.doesNotMatch(html, /secret|<input/);
  }
  assert.equal(calls, 0);
});

test('T4 错误仅显示固定标签，不显示未知代码、SQL或错误原文', () => {
  const input = fixture();
  input.status = 'failed';
  input.errorCode = 'SAVE_FAILED';
  assert.match(preview.createT4PreviewModel(input).error ?? '', /模拟存档保存失败/);
  input.errorCode = 'SECRET_SERVER_PAYLOAD';
  assert.doesNotMatch(JSON.stringify(preview.createT4PreviewModel(input)), /SECRET_SERVER_PAYLOAD/);
});

test('T4 业务文本经Vue安全转义，超过展示限度截短，不执行HTML', async () => {
  const input = fixture();
  input.draft!.data.tables.npc[0].values.goals = '<script>bad()</script>';
  let html = await render(input);
  assert.match(html, /&lt;script&gt;bad\(\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script/);
  input.draft!.data.tables.npc[0].values.goals = '很长'.repeat(1000);
  const model = preview.createT4PreviewModel(input);
  assert.match(model.changes[0].fields[0].after, /展示已截短/);
  assert.ok(model.changes[0].fields[0].after.length < 600);
  html = await render(input);
  assert.match(html, /展示已截短/);
});

test('T4 勾选只发确认事件，替换预览撤销确认，不保存也不修改输入', async () => {
  const input = fixture();
  const before = JSON.stringify(input);
  const component = compilePreview(false) as unknown as {
    setup: (
      props: { input?: unknown },
      context: {
        expose: () => void;
        emit: (event: string, value: boolean) => void;
      },
    ) => { consent: Vue.Ref<boolean>; setConsent: (event: Event) => void };
  };
  const events: [string, boolean][] = [];
  const props = Vue.shallowReactive({ input });
  const scope = Vue.effectScope();
  const state = scope.run(() =>
    component.setup(props, {
      expose() {},
      emit(event, value) {
        events.push([event, value]);
      },
    }),
  )!;
  state.setConsent({ target: { checked: true } } as unknown as Event);
  assert.equal(state.consent.value, true);
  assert.deepEqual(events, [['consent-change', true]]);
  props.input = { ...fixture(), anchor: null };
  await Vue.nextTick();
  assert.equal(state.consent.value, false);
  assert.deepEqual(events.at(-1), ['consent-change', false]);
  state.setConsent({ target: { checked: true } } as unknown as Event);
  assert.equal(state.consent.value, false);
  assert.equal(JSON.stringify(input), before);
  scope.stop();
});

test('T4 预览与确认不访问网络、宿主、API、存档缓存或世界书', async t => {
  const names = [
    'fetch',
    'indexedDB',
    'localStorage',
    'sessionStorage',
    'window',
    'document',
    'parent',
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
  const originals = names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
  const accesses: string[] = [];
  t.after(() => {
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  });
  for (const name of names)
    Object.defineProperty(globalThis, name, {
      configurable: true,
      get() {
        accesses.push(name);
        throw new Error(`Forbidden access ${name}`);
      },
    });
  await render();
  await render(fixture());
  await render({ ...fixture(), status: 'pending' });
  assert.deepEqual(accesses, []);
});

test('T4 真实SQLite私有结果进入差异页，不假称模拟或聊天保存成功', async () => {
  const SQL = await initSqlJs({
    wasmBinary: Uint8Array.from(readFileSync(resolve('node_modules/sql.js/dist/sql-wasm.wasm'))).buffer,
  });
  const input = fixture();
  const original = JSON.stringify(input.base);
  const result = executeT3Request(SQL, {
    template: input.base.template,
    data: input.base.data,
    batchId: 't4-preview-real',
    policy: createT3LocalPolicy(input.base.template, input.base.data),
    sql: 'UPDATE we_npc SET f_goals = ? WHERE __we_row_id = ?; INSERT INTO we_npc (f_name) VALUES (?)',
    parameters: ['<b>来自SQLite</b>', 'lin-watch', '沙盒新角色'],
  });
  input.draft = { template: input.base.template, data: result.data };
  const model = preview.createT4PreviewModel(input);
  assert.equal(model.status, 'private');
  assert.deepEqual(model.summary, { inserted: 1, updated: 1, deleted: 0, truncated: false });
  const html = await render(input);
  assert.match(html, /&lt;b&gt;来自SQLite&lt;\/b&gt;/);
  assert.match(html, /沙盒新角色/);
  assert.doesNotMatch(html, /UPDATE we_npc|INSERT INTO we_npc|模拟存档已确认/);
  assert.equal(JSON.stringify(input.base), original);
});
