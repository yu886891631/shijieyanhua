import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import initSqlJs from 'sql.js';
import * as ts from 'typescript';
import * as Vue from 'vue';
import { compileScript, compileStyle, parse } from 'vue/compiler-sfc';
import { renderToString } from 'vue/server-renderer';
import * as editor from './t6-editor';
import * as parameters from './t6-parameters';
import * as values from './t2-values';
import { createMinimalT2Fixture, createCustomT2Fixture } from './t2-defaults';
import { executeT3Request } from './t3-engine';
import { createT6Sandbox } from './t6-sandbox';
import type { T4State } from './t4-protocol';

const names = ['T6TemplateWorkbench', 'T6ParameterForm', 'T6CellSetting', 'T6WorldWorkbench', 'T5TableWorkbench'];
const files = names.map(name => {
  const filename = resolve(`src/世界演变/rebuild/${name}.vue`),
    source = readFileSync(filename, 'utf8'),
    parsed = parse(source, { filename });
  const script = compileScript(parsed.descriptor, { id: `data-v-${name}`, inlineTemplate: true });
  return { name, filename, source, parsed, script };
});
const components = new Map<string, Vue.Component>();
function component(name: string): Vue.Component {
  const cached = components.get(name);
  if (cached) return cached;
  const file = files.find(f => f.name === name)!;
  const output = ts.transpileModule(file.script.content, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    reportDiagnostics: true,
  });
  assert.equal(output.diagnostics?.length ?? 0, 0);
  const module = { exports: {} as { default: Vue.Component } };
  new Function('require', 'module', 'exports', output.outputText)(
    (id: string) => {
      if (id === 'vue') return Vue;
      if (id.endsWith('.vue')) return { default: component(id.slice(2, -4)) };
      if (id === './t6-editor') return editor;
      if (id === './t6-parameters') return parameters;
      if (id === './t2-values') return values;
      throw new Error(`Unexpected runtime import: ${id}`);
    },
    module,
    module.exports,
  );
  components.set(name, module.exports.default);
  return module.exports.default;
}
const SQL = initSqlJs({
  wasmBinary: Uint8Array.from(readFileSync(new URL('../../../node_modules/sql.js/dist/sql-wasm.wasm', import.meta.url)))
    .buffer,
});
async function fixture(initial: T4State = createMinimalT2Fixture()) {
  return createT6Sandbox({
    scope: { mode: 't4-sandbox', chatId: 'sandbox-t6-ui', worldId: 'demo-world', branchId: 'demo-main' },
    initial,
    execute: async request => executeT3Request(await SQL, request),
    withMockAnchor: true,
  });
}

test('T6 all SFCs compile, private styles and safe text only; no runtime/host/network entry', () => {
  for (const file of files.filter(f => f.name.startsWith('T6'))) {
    assert.deepEqual(file.parsed.errors, []);
    component(file.name);
    assert.equal(file.parsed.descriptor.styles.length, 1);
    assert.equal(file.parsed.descriptor.styles[0].scoped, true);
    const style = compileStyle({
      filename: file.filename,
      source: file.parsed.descriptor.styles[0].content,
      id: `data-v-${file.name}`,
      scoped: true,
    });
    assert.deepEqual(style.errors, []);
    assert.match(style.code, /data-v-/);
    assert.doesNotMatch(
      file.source,
      /v-html|innerHTML|localStorage|indexedDB|fetch\(|TavernHelper|createWorldbook|getChatMessages/,
    );
    assert.doesNotMatch(file.parsed.descriptor.styles[0].content, /(?:^|\n)\s*(?:html|body|\.menu_button)\s*\{/);
  }
});

test('T6 strict virtual TypeScript covers four new Vue templates and existing data page without dist', () => {
  const virtuals = new Map(files.map(f => [`${f.filename}.ts`.replaceAll('\\', '/'), f.script.content]));
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
  const normalized = (path: string) => path.replaceAll('\\', '/');
  host.fileExists = path => virtuals.has(normalized(path)) || exists(path);
  host.readFile = path => virtuals.get(normalized(path)) ?? read(path);
  host.getSourceFile = (path, language, onError, fresh) =>
    virtuals.has(normalized(path))
      ? ts.createSourceFile(path, virtuals.get(normalized(path))!, language, true)
      : get(path, language, onError, fresh);
  const program = ts.createProgram([...virtuals.keys()], options, host);
  assert.equal(
    ts.formatDiagnostics(ts.getPreEmitDiagnostics(program), {
      getCanonicalFileName: p => p,
      getCurrentDirectory: () => process.cwd(),
      getNewLine: () => '\n',
    }),
    '',
  );
});

test('T6 grouped structure form includes DIY, rules, inherited parameters, two save scopes and draft warning', async () => {
  const f = await fixture(),
    html = await renderToString(Vue.createSSRApp(component('T6TemplateWorkbench'), { workbench: f.structure }));
  for (const text of [
    '宏观世界',
    '微观世界',
    '新增业务表',
    '字段列表',
    '新字段 ID',
    '表级规则',
    'API 路由',
    '继承上级',
    '世界书导出设置',
    '高级：规范模板',
    '校验并预览迁移',
    '保存当前模拟世界',
    '仅保存新世界默认模板',
    '关闭或刷新会丢失',
    'T7',
  ])
    assert.ok(html.includes(text), text);
  assert.equal(f.store.statistics.writes, 0);
  assert.equal((await f.defaults.read()).revision, 0);
});

test('T6 field/default/ref/enum/decimal forms escaped; errors/private definitions do not become raw HTML', async () => {
  const initial = createCustomT2Fixture();
  initial.template.tables.find(t => t.id === 'market')!.name = '<img src=x onerror=evil()>';
  const f = await fixture(initial);
  f.structure.selectTable('market');
  f.structure.selectField('unit_price');
  const html = await renderToString(Vue.createSSRApp(component('T6TemplateWorkbench'), { workbench: f.structure }));
  assert.ok(html.includes('&lt;img'));
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /小数位数/);
  assert.match(html, /新记录默认值/);
  assert.match(html, /未提供值时补充/);
  f.structure.selectField('location');
  const refs = await renderToString(Vue.createSSRApp(component('T6TemplateWorkbench'), { workbench: f.structure }));
  assert.match(refs, /可引用的表/);
  assert.match(refs, /阻断，先处理引用/);
  const secret = createMinimalT2Fixture();
  secret.template.tables[1].fields[0].visibility.user = false;
  secret.template.tables[1].fields[0].name = '隐藏字段定义';
  const hidden = await fixture(secret),
    hiddenHtml = await renderToString(
      Vue.createSSRApp(component('T6TemplateWorkbench'), { workbench: hidden.structure }),
    );
  assert.doesNotMatch(hiddenHtml, /隐藏字段定义|山谷旅人|陈望/);
  assert.match(hiddenHtml, /非公开结构/);
});

test('T6 data/structure navigation is one workspace with no implicit save or seed', async () => {
  const f = await fixture(),
    html = await renderToString(
      Vue.createSSRApp(component('T6WorldWorkbench'), { data: f.workbench, structure: f.structure }),
    );
  assert.match(html, /数据填写/);
  assert.match(html, /结构与参数/);
  assert.match(html, /切页不保存/);
  assert.equal(f.store.statistics.writes, 0);
});

test('T6 shrinkable green/pink CSS and keyboard focus contract, not claimed actual host zoom acceptance', () => {
  const css = files.find(f => f.name === 'T6TemplateWorkbench')!.parsed.descriptor.styles[0].content;
  for (const pattern of [
    /max-width: 850px/,
    /max-width: 600px/,
    /minmax\(0, 1fr\)/,
    /min-width: 0/,
    /overflow: auto/,
    /bottom: 0/,
    /:focus-visible/,
    /#fbeaf0/,
    /#edf5ee/,
  ])
    assert.match(css, pattern);
  assert.doesNotMatch(css, /100vw|100vh|position: fixed|background:\s*(?:black|#000)/);
});

type Node = {
  tag: string;
  text: string;
  props: Record<string, unknown>;
  children: Node[];
  parent: Node | null;
  style: Record<string, string>;
};
function renderer() {
  const node = (tag: string, text = ''): Node => ({ tag, text, props: {}, children: [], parent: null, style: {} });
  const api = Vue.createRenderer<Node, Node>({
    insert(child, parent, anchor) {
      if (child.parent) child.parent.children.splice(child.parent.children.indexOf(child), 1);
      const index = anchor ? parent.children.indexOf(anchor) : -1;
      if (index < 0) parent.children.push(child);
      else parent.children.splice(index, 0, child);
      child.parent = parent;
    },
    remove(child) {
      if (child.parent) child.parent.children.splice(child.parent.children.indexOf(child), 1);
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
  const root = node('root'),
    walk = (n: Node): Node[] => [n, ...n.children.flatMap(walk)];
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
  return { api, root, find, button, fire, text: () => text(root) };
}

test('T6 mounted form adds age field, selects integer, previews and saves actual SQLite/T4 transaction', async () => {
  const f = await fixture();
  f.structure.selectTable('npc');
  const ui = renderer(),
    app = ui.api.createApp(component('T6TemplateWorkbench'), { workbench: f.structure });
  app.mount(ui.root);
  await Vue.nextTick();
  await ui.fire(
    ui.find('input', n => n.props['aria-label'] === '新字段 ID'),
    'onInput',
    { target: { value: 'age' } },
  );
  await ui.fire(
    ui.find('input', n => n.props['aria-label'] === '新字段名称'),
    'onInput',
    { target: { value: '年龄' } },
  );
  await ui.fire(
    ui.find('form', n => n.children.some(c => c.tag === 'button' && c.text === '添加字段')),
    'onSubmit',
    { preventDefault() {} },
  );
  await ui.fire(
    ui.find('select', n => n.props['aria-label'] === '字段类型'),
    'onChange',
    { target: { value: 'integer' } },
  );
  assert.equal(f.store.statistics.writes, 0);
  await ui.fire(ui.button('校验并预览迁移'), 'onClick');
  assert.equal(f.structure.view().report?.valid, true);
  await ui.fire(
    ui.find(
      'input',
      n => n.props.type === 'checkbox' && (n.parent?.children.some(c => c.text.includes('确认当前模拟世界')) ?? false),
    ),
    'onChange',
    { target: { checked: true } },
  );
  await ui.fire(ui.button('保存当前模拟世界'), 'onClick');
  assert.equal(f.store.statistics.writes, 1);
  const saved = f.service
    .view()
    .formal.template.tables.find(t => t.id === 'npc')!
    .fields.find(f => f.id === 'age')!;
  assert.equal(saved.type, 'integer');
  assert.equal(saved.name, '年龄');
  assert.match(ui.text(), /当前模拟世界已保存/);
  app.unmount();
});

test('T6 inherited parameter form changes canonical API route and validates frequency without network', async () => {
  const f = await fixture();
  f.structure.selectTable('npc');
  const ui = renderer(),
    app = ui.api.createApp(component('T6TemplateWorkbench'), { workbench: f.structure });
  app.mount(ui.root);
  await Vue.nextTick();
  await ui.fire(
    ui.find('select', n => n.props['aria-label'] === '表级 API 路由方式'),
    'onChange',
    { target: { value: 'value' } },
  );
  await ui.fire(
    ui.find('input', n => n.props.placeholder === '只引用预设，不填写 Key'),
    'onChange',
    { target: { value: 'my-preset' } },
  );
  assert.deepEqual(f.structure.view().template!.tables.find(t => t.id === 'npc')!.runtime.api, {
    state: 'value',
    value: { presetId: 'my-preset' },
  });
  await ui.fire(
    ui.find('select', n => n.props['aria-label'] === '表级 更新频率方式'),
    'onChange',
    { target: { value: 'value' } },
  );
  assert.equal(f.structure.view().resolved?.frequency.source, 'table');
  assert.equal(f.store.statistics.writes, 0);
  app.unmount();
});

test('T6 invalid local cell input blocks preview/default-save until corrected, not silently using old value', async () => {
  const f = await fixture();
  f.structure.selectTable('npc');
  f.structure.addField('age', '年龄');
  f.structure.field({ type: 'integer', control: 'integer' });
  const ui = renderer(),
    app = ui.api.createApp(component('T6TemplateWorkbench'), { workbench: f.structure });
  app.mount(ui.root);
  await Vue.nextTick();
  await ui.fire(
    ui.find('select', n => n.props['aria-label'] === '新记录默认值方式'),
    'onChange',
    { target: { value: 'value' } },
  );
  assert.equal(ui.button('校验并预览迁移').props.disabled, true);
  assert.match(ui.text(), /尚未采用/);
  await ui.fire(
    ui.find('textarea', n => n.props['aria-label'] === '新记录默认值内容'),
    'onInput',
    { target: { value: '12' } },
  );
  assert.equal(ui.button('校验并预览迁移').props.disabled, false);
  assert.equal(
    f.structure
      .view()
      .template!.tables.find(t => t.id === 'npc')!
      .fields.find(f => f.id === 'age')!.defaultValue,
    12,
  );
  assert.equal(f.store.statistics.writes, 0);
  app.unmount();
});
