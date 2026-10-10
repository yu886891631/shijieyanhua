import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import initSqlJs from 'sql.js';
import * as ts from 'typescript';
import * as Vue from 'vue';
import { compileScript, compileStyle, parse } from 'vue/compiler-sfc';
import { renderToString } from 'vue/server-renderer';
import { createDefaultT2Fixture, createCustomT2Fixture } from './t2-defaults';
import { executeT3Request } from './t3-engine';
import { createT5Sandbox } from './t5-sandbox';
import type { T4State } from './t4-protocol';

const filename = resolve('src/世界演变/rebuild/T5TableWorkbench.vue'),
  source = readFileSync(filename, 'utf8');
const parsed = parse(source, { filename });
const script = compileScript(parsed.descriptor, { id: 'data-v-we-t5', inlineTemplate: true });
const output = ts.transpileModule(script.content, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  reportDiagnostics: true,
});
const module = { exports: {} as { default: Vue.Component } };
new Function('require', 'module', 'exports', output.outputText)(
  (id: string) => {
    assert.equal(id, 'vue');
    return Vue;
  },
  module,
  module.exports,
);
const Component = module.exports.default;
const ready = initSqlJs({
  wasmBinary: Uint8Array.from(readFileSync(new URL('../../../node_modules/sql.js/dist/sql-wasm.wasm', import.meta.url)))
    .buffer,
});
async function fixture(initial?: T4State) {
  return createT5Sandbox({
    scope: { mode: 't4-sandbox', chatId: 'sandbox-t5-ui', worldId: 'demo-world', branchId: 'demo-main' },
    execute: async request => executeT3Request(await ready, request),
    withMockAnchor: true,
    ...(initial ? { initial } : {}),
  });
}
test('T5 scoped SFC and typed template compile without host/API/global state imports or unsafe HTML', () => {
  assert.deepEqual(parsed.errors, []);
  assert.equal(output.diagnostics?.length ?? 0, 0);
  assert.equal(parsed.descriptor.styles.length, 1);
  assert.equal(parsed.descriptor.styles[0].scoped, true);
  const style = compileStyle({
    filename,
    source: parsed.descriptor.styles[0].content,
    id: 'data-v-we-t5',
    scoped: true,
  });
  assert.deepEqual(style.errors, []);
  assert.match(style.code, /\[data-v-we-t5\]/);
  assert.doesNotMatch(
    source,
    /v-html|innerHTML|localStorage|indexedDB|fetch\(|TavernHelper|getChatMessages|createWorldbook/,
  );
  assert.doesNotMatch(parsed.descriptor.styles[0].content, /(?:^|\n)\s*(?:html|body|\.menu_button)\s*\{/);
});
test('T5 virtual strict TypeScript checks compiled Vue template without touching dist', () => {
  const virtual = `${filename}.ts`.replaceAll('\\', '/');
  const options: ts.CompilerOptions = {
    noEmit: true,
    strict: true,
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    skipLibCheck: true,
    esModuleInterop: true,
  };
  const host = ts.createCompilerHost(options),
    get = host.getSourceFile,
    exists = host.fileExists,
    read = host.readFile;
  const match = (path: string) => path.replaceAll('\\', '/') === virtual;
  host.fileExists = path => match(path) || exists(path);
  host.readFile = path => (match(path) ? script.content : read(path));
  host.getSourceFile = (path, language, onError, fresh) =>
    match(path) ? ts.createSourceFile(path, script.content, language, true) : get(path, language, onError, fresh);
  const program = ts.createProgram([virtual], options, host);
  assert.equal(
    ts.formatDiagnostics(ts.getPreEmitDiagnostics(program), {
      getCanonicalFileName: p => p,
      getCurrentDirectory: () => process.cwd(),
      getNewLine: () => '\n',
    }),
    '',
  );
});
test('T5 rendered empty state has grouped tables, direct add, simulation notice and no fake success', async () => {
  const f = await fixture(),
    html = await renderToString(Vue.createSSRApp(Component, { workbench: f.workbench }));
  for (const text of [
    '宏观世界',
    '微观世界',
    '新增 社会',
    '未写当前聊天',
    '不会自动加入示例 NPC',
    '关闭或刷新不会自动保存',
    '保存模拟存档',
    '校验并预览差异',
  ])
    assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /已存入酒馆聊天|已同步世界书/);
  assert.equal(f.store.statistics.writes, 0);
});
test('T5 long/malicious display text is escaped; typed controls and reference picker are real elements', async () => {
  const state = createCustomT2Fixture();
  state.data.tables.npc[0].values.name = '<img src=x onerror=alert(1)>'.repeat(3);
  const f = await fixture(state);
  f.workbench.selectTable('npc');
  f.workbench.beginEdit('lin-watch');
  const html = await renderToString(Vue.createSSRApp(Component, { workbench: f.workbench }));
  assert.ok(html.includes('&lt;img'));
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /textarea/);
  assert.match(html, /multiple/);
  assert.match(html, /当前位置填写方式/);
  f.workbench.cancelEditor();
  f.workbench.selectTable('market');
  f.workbench.beginEdit('harbor-market');
  const market = await renderToString(Vue.createSSRApp(Component, { workbench: f.workbench }));
  assert.match(market, /是否开放/);
  assert.match(market, /type="checkbox"/);
  assert.match(market, /inputmode="decimal"/);
});
test('T5 narrow/zoom CSS has shrinkable grids, contained table scrolling, reachable actions and visible focus', () => {
  const css = parsed.descriptor.styles[0].content;
  assert.match(css, /max-width: 850px/);
  assert.match(css, /max-width: 600px/);
  assert.match(css, /minmax\(0, 1fr\)/);
  assert.match(css, /min-width: 0/);
  assert.match(css, /overflow: auto/);
  assert.match(css, /bottom: 0/);
  assert.match(css, /:focus-visible/);
  assert.doesNotMatch(css, /100vw|100vh|position: fixed|background:\s*(?:black|#000)/);
  // This is a CSS contract test, not a claim of measured 100/110/125% browser geometry.
});

type Node = {
  tag: string;
  text: string;
  props: Record<string, unknown>;
  children: Node[];
  parent: Node | null;
  focus: () => void;
};
function renderer() {
  let focused = '';
  const node = (tag: string, text = ''): Node => {
    const n: Node = {
      tag,
      text,
      props: {},
      children: [],
      parent: null,
      focus: () => {
        focused = String(n.props.id ?? '');
      },
    };
    return n;
  };
  const api = Vue.createRenderer<Node, Node>({
    insert(child, parent, anchor) {
      if (child.parent) {
        const old = child.parent.children.indexOf(child);
        if (old >= 0) child.parent.children.splice(old, 1);
      }
      const index = anchor ? parent.children.indexOf(anchor) : -1;
      if (index < 0) parent.children.push(child);
      else parent.children.splice(index, 0, child);
      child.parent = parent;
    },
    remove(child) {
      if (child.parent) {
        const index = child.parent.children.indexOf(child);
        child.parent.children.splice(index, 1);
      }
      child.parent = null;
    },
    createElement: tag => node(tag),
    createText: text => node('#text', text),
    createComment: text => node('#comment', text),
    setText(n, text) {
      n.text = text;
    },
    setElementText(n, text) {
      n.text = text;
      n.children = [];
    },
    parentNode: n => n.parent,
    nextSibling: n => n.parent?.children[n.parent.children.indexOf(n) + 1] ?? null,
    patchProp(n, key, _old, value) {
      n.props[key] = value;
    },
  });
  const root = node('root');
  const walk = (n: Node): Node[] => [n, ...n.children.flatMap(walk)];
  const text = (n: Node): string => (n.tag === '#comment' ? '' : n.text + n.children.map(text).join(''));
  const find = (tag: string, predicate: (n: Node) => boolean) => {
    const n = walk(root).find(n => n.tag === tag && predicate(n));
    assert.ok(n, `${tag} not found`);
    return n;
  };
  const button = (label: string) => find('button', n => text(n).trim() === label);
  const fire = async (n: Node, key: string, event: unknown = {}) => {
    assert.notEqual(n.props.disabled, true);
    const handler = n.props[key] as (event: unknown) => unknown;
    assert.equal(typeof handler, 'function');
    await handler(event);
    await Vue.nextTick();
  };
  return { api, root, find, button, fire, text: () => text(root), focused: () => focused };
}
test('T5 mounted UI clicks add NPC, types name, stages, previews, confirms and saves through actual SQLite/T4', async () => {
  const f = await fixture(),
    ui = renderer();
  const app = ui.api.createApp(Component, { workbench: f.workbench });
  app.mount(ui.root);
  await Vue.nextTick();
  await ui.fire(ui.button('NPC 0'), 'onClick');
  await ui.fire(ui.button('新增 NPC'), 'onClick');
  const name = ui.find('input', n => n.props.id === 't5-npc-name');
  await ui.fire(name, 'onInput', { target: { value: '按钮新增角色' } });
  await ui.fire(
    ui.find('form', () => true),
    'onSubmit',
    { preventDefault() {} },
  );
  assert.equal(f.store.statistics.writes, 0);
  assert.equal(f.workbench.view().staged.length, 1);
  await ui.fire(ui.button('校验并预览差异'), 'onClick');
  const consent = ui.find(
    'input',
    n =>
      n.props.type === 'checkbox' &&
      ui.text().includes('我已检查') &&
      n.parent?.tag === 'label' &&
      n.parent.children.some(c => c.text.includes('我已检查')),
  );
  await ui.fire(consent, 'onChange', { target: { checked: true } });
  await ui.fire(ui.button('保存模拟存档'), 'onClick');
  assert.equal(f.store.statistics.writes, 1);
  assert.equal(f.service.view().formal.data.tables.npc[0].values.name, '按钮新增角色');
  assert.match(ui.text(), /保存并读回确认/);
  app.unmount();
});
test('T5 keyboard-submit validation focuses first invalid field and cancel removes editor without saving', async () => {
  const f = await fixture(),
    ui = renderer();
  const app = ui.api.createApp(Component, { workbench: f.workbench });
  app.mount(ui.root);
  await Vue.nextTick();
  await ui.fire(ui.button('NPC 0'), 'onClick');
  await ui.fire(ui.button('新增 NPC'), 'onClick');
  await ui.fire(
    ui.find('form', () => true),
    'onSubmit',
    { preventDefault() {} },
  );
  assert.equal(ui.focused(), 't5-npc-name');
  assert.match(ui.text(), /必填/);
  await ui.fire(ui.button('取消这条填写'), 'onClick');
  assert.equal(f.workbench.view().editor, null);
  assert.equal(f.store.statistics.writes, 0);
  app.unmount();
});
test('T14 typed field errors are associated with the control and description, not color alone', async () => {
  const f = await fixture();
  f.workbench.selectTable('npc');
  f.workbench.beginNew();
  f.workbench.stageEditor();
  const html = await renderToString(Vue.createSSRApp(Component, { workbench: f.workbench }));
  assert.match(html, /aria-describedby="t5-help-name t5-error-npc-name"/);
  assert.match(html, /id="t5-error-npc-name"[^>]*role="alert"/);
  assert.match(html, /aria-invalid="true"/);
  assert.equal(f.store.statistics.writes, 0);
  f.service.close();
});
test('T5 mounted UI save failure retains staged user changes and distinguishes saved from private results', async () => {
  const f = await fixture(createDefaultT2Fixture()),
    w = f.workbench,
    ui = renderer();
  w.selectTable('npc');
  w.beginEdit('lin-watch');
  const field = w.view().editor!.fields.find(f => f.field.id === 'goals')!;
  w.setInput('goals', { ...field.input, mode: 'value', text: '模拟失败' });
  w.stageEditor();
  await w.prepare();
  w.consent(true);
  const app = ui.api.createApp(Component, { workbench: w });
  app.mount(ui.root);
  await Vue.nextTick();
  f.store.queueWriteFault('save-failed');
  await ui.fire(ui.button('保存模拟存档'), 'onClick');
  assert.equal(w.view().staged.length, 1);
  assert.match(ui.text(), /保存失败|保存未成功/);
  assert.equal(f.store.statistics.writes, 0);
  app.unmount();
});
