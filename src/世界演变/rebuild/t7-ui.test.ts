import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import * as ts from 'typescript';
import * as Vue from 'vue';
import { compileScript, compileStyle, parse } from 'vue/compiler-sfc';
import { renderToString } from 'vue/server-renderer';
import { createMinimalT2Fixture } from './t2-defaults';
import { createEmptyWorldEvolutionApiConfiguration } from '../api-config';
import { createT7Workbench } from './t7-workbench';
import type { T7Input } from './t7-input';

const names = [
  'T7PromptWorkbench',
  'T7WorldWorkbench',
  'T6WorldWorkbench',
  'T6TemplateWorkbench',
  'T6ParameterForm',
  'T6CellSetting',
  'T5TableWorkbench',
];
const files = names.map(name => {
  const filename = resolve(`src/世界演变/rebuild/${name}.vue`),
    source = readFileSync(filename, 'utf8'),
    parsed = parse(source, { filename });
  return {
    name,
    filename,
    source,
    parsed,
    script: compileScript(parsed.descriptor, { id: `data-v-${name}`, inlineTemplate: true }),
  };
});
function component(): Vue.Component {
  const file = files[0],
    compiled = ts.transpileModule(file.script.content, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      reportDiagnostics: true,
    });
  assert.equal(compiled.diagnostics?.length ?? 0, 0);
  const module = { exports: {} as { default: Vue.Component } };
  new Function('require', 'module', 'exports', compiled.outputText)(
    (id: string) => {
      assert.equal(id, 'vue');
      return Vue;
    },
    module,
    module.exports,
  );
  return module.exports.default;
}
async function fixture() {
  const state = createMinimalT2Fixture();
  state.template.defaults.api = { state: 'value', value: { presetId: 'first' } };
  const api = createEmptyWorldEvolutionApiConfiguration(0);
  api.presets = [
    {
      id: 'first',
      name: '模拟模型',
      model: 'model-safe',
      endpoint: 'https://invalid.example/completions',
      apiKey: 'secret-ui-key',
      provider: 'openai-compatible',
      enabled: true,
      timeoutMs: 1000,
      maxRetries: 0,
      createdAt: 0,
      updatedAt: 0,
    },
  ];
  const input: T7Input = {
    anchor: { chatId: 'sandbox-t7-ui', messageId: 'a7', swipeId: 's0', inputFingerprint: 'a'.repeat(64) },
    worldId: state.data.worldId,
    branchId: state.data.branchId,
    eligibleRound: 1,
    story: [{ messageId: 'a7', role: 'assistant', text: '<script>alert("DATA_ONLY")</script> 山谷下雨。' }],
    segments: [],
    proofs: [],
    selected: [],
    progress: {},
    now: null,
  };
  const workbench = await createT7Workbench({ readState: () => state, input, api });
  return { state, api, input, workbench, props: { workbench } };
}
test('T7 two SFCs compile with isolated responsive green styles, safe text and no host/network/SQL bypass', () => {
  component();
  for (const file of files.slice(0, 2)) {
    assert.deepEqual(file.parsed.errors, []);
    assert.equal(file.parsed.descriptor.styles[0].scoped, true);
    assert.deepEqual(
      compileStyle({
        filename: file.filename,
        source: file.parsed.descriptor.styles[0].content,
        id: `data-v-${file.name}`,
        scoped: true,
      }).errors,
      [],
    );
    assert.doesNotMatch(
      file.source,
      /v-html|innerHTML|fetch\(|localStorage|TavernHelper|executeT3|createWorldbook|getChatMessages/,
    );
    assert.doesNotMatch(file.parsed.descriptor.styles[0].content, /(?:^|\n)\s*(?:body|html|\.menu_button)\s*\{/);
  }
});
test('T7 strict virtual Vue TypeScript, including shared world/data/structure pages', () => {
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
    read = host.readFile,
    normalize = (p: string) => p.replaceAll('\\', '/');
  host.fileExists = p => virtuals.has(normalize(p)) || exists(p);
  host.readFile = p => virtuals.get(normalize(p)) ?? read(p);
  host.getSourceFile = (p, language, error, fresh) =>
    virtuals.has(normalize(p))
      ? ts.createSourceFile(p, virtuals.get(normalize(p))!, language, true)
      : get(p, language, error, fresh);
  const program = ts.createProgram(
    [...virtuals.keys(), resolve('@types/function/variables.d.ts'), resolve('@types/iframe/util.d.ts')],
    options,
    host,
  );
  assert.equal(
    ts.formatDiagnostics(ts.getPreEmitDiagnostics(program), {
      getCanonicalFileName: p => p,
      getCurrentDirectory: () => process.cwd(),
      getNewLine: () => '\n',
    }),
    '',
  );
});
test('T7 SSR shows versions, enabled/draft distinction, table routes, pending micro and actual source summary', async () => {
  const f = await fixture();
  await f.workbench.freeze();
  const html = await renderToString(Vue.createSSRApp(component(), f.props));
  for (const text of [
    '规则草稿',
    '启用版本 1',
    '保存草稿',
    '启用已保存草稿',
    '下一轮',
    '待宏观结果',
    'API 来源',
    'global',
    '模拟模型',
    'model-safe',
    '实际 messages 内容',
    '不含认证头/Key',
    '字符',
    '模拟此请求',
  ])
    assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /secret-ui-key|invalid.example|<script>/);
  assert.match(html, /&lt;script&gt;/);
});
test('T7 empty view does not fabricate preview or real-run button', async () => {
  const f = await fixture(),
    html = await renderToString(Vue.createSSRApp(component(), f.props));
  assert.match(html, /尚未冻结/);
  assert.match(html, /没有真实演变/);
  assert.doesNotMatch(html, /模拟此请求/);
  assert.equal(f.workbench.view().run, null);
});
test('T7 API absence is visible as a blocking skip, not mock success', async () => {
  const f = await fixture();
  f.workbench.setApi(createEmptyWorldEvolutionApiConfiguration(0));
  await f.workbench.freeze();
  const html = await renderToString(Vue.createSSRApp(component(), f.props));
  assert.match(html, /引用预设不存在/);
  assert.doesNotMatch(html, /模拟此请求/);
});
type Node = { type: string; text: string; props: Record<string, unknown>; children: Node[]; parent: Node | null };
function mount(props: Record<string, unknown>) {
  const create = (type: string, text = ''): Node => ({ type, text, props: {}, children: [], parent: null });
  const root = create('root');
  const renderer = Vue.createRenderer<Node, Node>({
    patchProp: (node, k, _old, next) => {
      node.props[k] = next;
    },
    insert(node, parent, anchor) {
      if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1);
      node.parent = parent;
      const index = anchor ? parent.children.indexOf(anchor) : -1;
      if (index < 0) parent.children.push(node);
      else parent.children.splice(index, 0, node);
    },
    remove(node) {
      node.parent?.children.splice(node.parent.children.indexOf(node), 1);
      node.parent = null;
    },
    createElement: type => create(type),
    createText: text => create('#text', text),
    createComment: text => create('#comment', text),
    setText(node, text) {
      node.text = text;
    },
    setElementText(node, text) {
      node.text = text;
      node.children = [];
    },
    parentNode: node => node.parent,
    nextSibling: node => node.parent?.children[node.parent.children.indexOf(node) + 1] ?? null,
  });
  const app = renderer.createApp(component(), props);
  app.mount(root);
  const all = (node: Node = root): Node[] => [node, ...node.children.flatMap(n => all(n))];
  const text = (node: Node): string => node.text + node.children.map(text).join('');
  return {
    app,
    all,
    text,
    button: (label: string) => all().find(n => n.type === 'button' && text(n).trim() === label)!,
  };
}
test('T7 real Vue form events save/enable separate draft, freeze exact messages and simulate without network', async () => {
  const f = await fixture(),
    ui = mount(f.props);
  try {
    const textarea = ui.all().find(n => n.type === 'textarea')!;
    (textarea.props.onInput as (event: unknown) => void)({ target: { value: 'UI_ENABLED_RULE' } });
    await Vue.nextTick();
    assert.equal(f.workbench.view().prompts.enabled.revision, 1);
    assert.equal(f.workbench.view().prompts.dirty, true);
    assert.equal(ui.button('启用已保存草稿').props.disabled, true);
    await (ui.button('保存草稿').props.onClick as () => unknown)();
    await Vue.nextTick();
    assert.equal(f.workbench.view().prompts.enabled.revision, 1);
    await (ui.button('启用已保存草稿').props.onClick as () => unknown)();
    await Vue.nextTick();
    assert.equal(f.workbench.view().prompts.enabled.revision, 2);
    await (ui.button('冻结并预览宏观请求').props.onClick as () => unknown)();
    await Vue.nextTick();
    assert.match(f.workbench.view().run!.macro!.requests[0].messages[0].content, /UI_ENABLED_RULE/);
    await (ui.button('模拟此请求（不联网）').props.onClick as () => unknown)();
    await Vue.nextTick();
    assert.equal(f.workbench.view().result?.ok, true);
    assert.equal(f.workbench.view().run!.sent, 1);
    await (ui.button('关闭本轮预览').props.onClick as () => unknown)();
    await Vue.nextTick();
    assert.equal(f.workbench.view().run, null);
  } finally {
    ui.app.unmount();
  }
});
test('T7 actual select and text events edit inherited/table guidance, discard preserves last saved draft', async () => {
  const f = await fixture(),
    ui = mount(f.props);
  try {
    const select = ui.all().find(n => n.type === 'select')!;
    (select.props.onChange as (e: unknown) => void)({ target: { value: 'table:npc' } });
    await Vue.nextTick();
    const mode = ui.all().filter(n => n.type === 'select')[1];
    (mode.props.onChange as (e: unknown) => void)({ target: { value: 'value' } });
    await Vue.nextTick();
    const textarea = ui.all().find(n => n.type === 'textarea')!;
    (textarea.props.onInput as (e: unknown) => void)({ target: { value: 'TABLE_NPC_UI' } });
    await Vue.nextTick();
    assert.deepEqual(f.workbench.view().prompts.draft.tables.npc, { state: 'value', value: 'TABLE_NPC_UI' });
    await (ui.button('撤销未保存编辑').props.onClick as () => unknown)();
    await Vue.nextTick();
    assert.equal(f.workbench.view().prompts.draft.tables.npc, undefined);
  } finally {
    ui.app.unmount();
  }
});
