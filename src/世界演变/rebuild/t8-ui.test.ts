import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import * as ts from 'typescript';
import * as Vue from 'vue';
import { compileScript, compileStyle, parse } from 'vue/compiler-sfc';
import { renderToString } from 'vue/server-renderer';
import { setupT8Test as setup, deferredT8Test as deferred, responseT8Test as response } from './t8-test-fixtures';

const names = [
  'T8MacroWorkbench',
  'T8WorldWorkbench',
  'T7WorldWorkbench',
  'T7PromptWorkbench',
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
  const compiled = ts.transpileModule(files[0].script.content, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    reportDiagnostics: true,
  });
  assert.deepEqual(compiled.diagnostics, []);
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
async function render(f: ReturnType<typeof setup>) {
  return renderToString(Vue.createSSRApp(component(), { controller: f.control }));
}
async function until(check: () => boolean) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > 3000) throw new Error('test timed out');
    await new Promise(resolve => setTimeout(resolve, 2));
  }
}
test('T8 scoped SFCs compile; no live host/HTML/raw network/save bypass', () => {
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
    assert.doesNotMatch(file.source, /v-html|innerHTML|fetch\(|TavernHelper|localStorage|executeT3|\.save\(/);
    assert.doesNotMatch(file.parsed.descriptor.styles[0].content, /(?:^|\n)\s*(?:body|html|\.menu_button)\s*\{/);
  }
});
test('T8 full shared Vue workspace passes strict virtual TypeScript', () => {
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
    ts.getPreEmitDiagnostics(program).length,
    0,
    ts.formatDiagnostics(ts.getPreEmitDiagnostics(program), {
      getCanonicalFileName: x => x,
      getCurrentDirectory: () => process.cwd(),
      getNewLine: () => '\n',
    }),
  );
});
test('T8 initial UI explains consequences, no fake completion or save/upload button', async () => {
  const html = await render(setup());
  for (const phrase of [
    '开始模拟宏观',
    '取消本轮',
    '必要前置',
    '尚未开始',
    '本阶段只会暂存宏观结果，不会正式保存',
    '暂存变化预览',
    '刷新会丢失',
    '不自动重发',
  ])
    assert.ok(html.includes(phrase), phrase);
  assert.doesNotMatch(html, />保存世界<|>上传世界书<|>运行真实API</);
});
test('T8 staged UI has exact safe messages, fingerprints and readable data changes', async () => {
  const f = setup(undefined, {
    reply: async () =>
      response('UPDATE we_environment SET f_risk = ? WHERE __we_row_id = ?', [80, 'small-valley-weather']),
  });
  f.input.story[0].text += '<script>alert("DATA_NOT_CODE")</script>';
  await (
    await f.control.start('ui-run')
  ).done;
  const html = await render(f);
  for (const phrase of [
    '宏观已暂存，未保存',
    '80',
    '30',
    '风险指数',
    '实际模拟输入与追溯指纹',
    '执行前',
    '执行后',
    '模拟 API',
  ])
    assert.ok(html.includes(phrase), phrase);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>|private-t8-key|invalid.example|Authorization/);
});
test('T8 UI waiting/failure prerequisite states and error details are visible', async () => {
  const f = setup();
  f.input.proofs.push({
    sourceId: 'database',
    required: true,
    state: 'failure',
    identity: null,
    sourceCommitId: null,
    resultFingerprint: null,
    persisted: false,
    requirePersisted: true,
    reason: '失败',
  });
  await (
    await f.control.start('ui-run')
  ).done;
  const html = await render(f);
  assert.match(html, /未通过检查/);
  assert.match(html, /database：失败/);
  assert.match(html, /PREREQUISITE/);
  assert.match(html, /没有启动宏观演算/);
});
type Node = { type: string; text: string; props: Record<string, unknown>; children: Node[]; parent: Node | null };
function mount(f: ReturnType<typeof setup>) {
  const create = (type: string, text = ''): Node => ({ type, text, props: {}, children: [], parent: null }),
    root = create('root');
  const renderer = Vue.createRenderer<Node, Node>({
    patchProp(node, key, _old, next) {
      node.props[key] = next;
    },
    insert(node, parent, anchor) {
      if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1);
      node.parent = parent;
      const at = anchor ? parent.children.indexOf(anchor) : -1;
      if (at < 0) parent.children.push(node);
      else parent.children.splice(at, 0, node);
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
  const app = renderer.createApp(component(), { controller: f.control });
  app.mount(root);
  const all = (node: Node = root): Node[] => [node, ...node.children.flatMap(n => all(n))],
    text = (node: Node): string => node.text + node.children.map(text).join('');
  const button = (label: string) => all().find(n => n.type === 'button' && text(n).trim() === label)!;
  return { app, all, text, button };
}
test('T8 actual Vue buttons start local macro, show progress, block duplicate and revalidate stale handoff', async () => {
  const f = setup(),
    ui = mount(f);
  try {
    await (ui.button('开始模拟宏观').props.onClick as () => Promise<void>)();
    await until(() => f.control.view().status === 'staged');
    await Vue.nextTick();
    assert.equal(ui.button('取消本轮').props.disabled, false);
    assert.ok(ui.all().some(n => ui.text(n).includes('宏观已暂存，未保存')));
    await (ui.button('开始模拟宏观').props.onClick as () => Promise<void>)();
    await Vue.nextTick();
    assert.ok(ui.all().some(n => ui.text(n).includes('重复触发已忽略')));
    assert.equal(f.control.view().sent, 1);
    f.input.anchor.swipeId = 'changed';
    await (ui.button('检查暂存是否仍有效').props.onClick as () => Promise<void>)();
    await Vue.nextTick();
    assert.equal(f.control.view().status, 'stale');
    assert.equal(ui.button('取消本轮').props.disabled, true);
  } finally {
    ui.app.unmount();
  }
});
test('T8 actual Vue cancel button reaches HTTP signal and publishes no stage result', async () => {
  const late = deferred<{ status: number; text: string }>(),
    f = setup(undefined, { reply: () => late.promise }),
    ui = mount(f);
  try {
    await (ui.button('开始模拟宏观').props.onClick as () => Promise<void>)();
    await until(() => f.control.view().sent === 1);
    await Vue.nextTick();
    assert.equal(ui.button('开始模拟宏观').props.disabled, true);
    (ui.button('取消本轮').props.onClick as () => void)();
    await Vue.nextTick();
    assert.equal(f.control.view().status, 'cancelled');
    assert.equal(f.control.view().changes.length, 0);
    late.resolve(response('SELECT __we_row_id FROM we_environment'));
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(f.control.view().status, 'cancelled');
    assert.ok(ui.all().some(n => ui.text(n).includes('模拟不收费')));
  } finally {
    ui.app.unmount();
  }
});
test('T8 UI page switch preserves memory child instances, responsive styles include light green and pink', () => {
  assert.match(files[1].source, /v-show="page === 'world'"/);
  assert.match(files[1].source, /v-show="page === 'macro'"/);
  const style = files[0].parsed.descriptor.styles[0].content;
  assert.match(style, /#f1f8ef/);
  assert.match(style, /#fbe9ee/);
  assert.match(style, /max-width: 600px/);
  assert.match(style, /overflow-x: auto/);
  assert.match(style, /focus-visible/);
});
