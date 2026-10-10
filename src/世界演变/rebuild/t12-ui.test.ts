import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import * as ts from 'typescript';
import * as Vue from 'vue';
import { parse, compileScript, compileStyle } from 'vue/compiler-sfc';
import { renderToString } from 'vue/server-renderer';
import { setupT12Test as setup } from './t12-test-fixtures';
import { createMinimalT2Fixture } from './t2-defaults';
const filename = resolve('src/世界演变/rebuild/T12ProjectionWorkbench.vue'),
  source = readFileSync(filename, 'utf8');
const parsed = parse(source, { filename }),
  script = compileScript(parsed.descriptor, { id: 'data-v-t12', inlineTemplate: true });
function component(): Vue.Component {
  const compiled = ts.transpileModule(script.content, {
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
const render = (controller: Awaited<ReturnType<typeof setup>>['projection']) =>
  renderToString(Vue.createSSRApp(component(), { controller }));
test('T12 SFC strict TypeScript and scoped CSS compile; no real host/network or executable data rendering', () => {
  assert.deepEqual(parsed.errors, []);
  assert.doesNotMatch(source, /v-html|innerHTML|\bfetch\(|TavernHelper|localStorage|indexedDB|createWorldbook/);
  const virtual = `${filename}.ts`.replaceAll('\\', '/'),
    options: ts.CompilerOptions = {
      noEmit: true,
      strict: true,
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      skipLibCheck: true,
      esModuleInterop: true,
    };
  const host = ts.createCompilerHost(options),
    get = host.getSourceFile;
  host.getSourceFile = (path, language, error, fresh) =>
    path.replaceAll('\\', '/') === virtual
      ? ts.createSourceFile(path, script.content, language, true)
      : get(path, language, error, fresh);
  const diagnostics = ts.getPreEmitDiagnostics(
    ts.createProgram(
      [virtual, resolve('@types/function/variables.d.ts'), resolve('@types/iframe/util.d.ts')],
      options,
      host,
    ),
  );
  assert.equal(
    diagnostics.length,
    0,
    ts.formatDiagnostics(diagnostics, {
      getCanonicalFileName: p => p,
      getCurrentDirectory: () => process.cwd(),
      getNewLine: () => '\n',
    }),
  );
  assert.equal(parsed.descriptor.styles.length, 1);
  assert.equal(parsed.descriptor.styles[0].scoped, true);
  const css = parsed.descriptor.styles[0].content;
  assert.deepEqual(compileStyle({ filename, source: css, id: 'data-v-t12', scoped: true }).errors, []);
  for (const rule of [
    'minmax(0, 1fr)',
    'min-width: 0',
    'overflow: auto',
    ':focus-visible',
    'max-width: 850px',
    'max-width: 600px',
    '#fff0f3',
    '#f1f8ef',
  ])
    assert.ok(css.includes(rule), rule);
  assert.doesNotMatch(css, /position:\s*(?:fixed|absolute)|100vh|100vw|(?:^|\n)\s*(?:body|html|\.menu_button)\s*\{/);
});
test('T12 unopened/empty UI has plain Chinese, no fake success and explicit disabled writes', async () => {
  const s = createMinimalT2Fixture();
  s.data.tables = Object.fromEntries(s.template.tables.map(t => [t.id, []]));
  const f = await setup(s);
  let html = await render(f.projection);
  for (const text of [
    '世界书投影',
    '尚未检查',
    '检查与预览（不写入）',
    '仅查询同步结果',
    '没有可预览的条目',
    '同步与修复范围',
  ])
    assert.ok(html.includes(text), text);
  assert.match(html, /disabled[^>]*>同步当前已保存版本/);
  await f.projection.inspect();
  html = await render(f.projection);
  assert.match(html, /世界已保存，投影待同步/);
  assert.equal(f.book.statistics.writes, 0);
  f.close();
});
test('T12 preview and diff escape malicious text; user-invisible main-only fields never leak into page', async () => {
  const s = createMinimalT2Fixture(),
    t = s.template.tables.find(t => t.id === 'npc')!;
  t.fields.find(f => f.id === 'goals')!.visibility.user = false;
  s.data.tables.npc[0].values.goals = '不应出现在页面上的秘密';
  s.data.tables.npc[0].values.name = '<img src=x onerror=alert(1)>';
  const f = await setup(s);
  await f.projection.inspect();
  const html = await render(f.projection);
  assert.doesNotMatch(html, /<img src=x|不应出现在页面上的秘密|private-t8-key/);
  assert.match(html, /&lt;img/);
  f.close();
});
test('T12 blocked capability and partial failure explain no real writes or mixed-version reads', async () => {
  const f = await setup(undefined, {}, { guardedCapture: false });
  await f.projection.inspect();
  const blocked = await render(f.projection);
  assert.match(blocked, /安全条件未满足/);
  assert.match(blocked, /预览不代表已可供主 AI 使用/);
  assert.match(blocked, /disabled[^>]*>同步当前已保存版本/);
  f.close();
  const g = await setup();
  await g.projection.inspect();
  g.book.queueFault('partial');
  await g.projection.sync(true);
  const html = await render(g.projection);
  assert.match(html, /主 AI 投影捕获保持阻断/);
  assert.match(html, /仅重试投影/);
  assert.match(html, /世界存档未改变/);
  g.close();
});
interface HostNode {
  type: string;
  text: string;
  props: Record<string, unknown>;
  children: HostNode[];
  parent: HostNode | null;
  addEventListener: () => void;
}
function mount(controller: Awaited<ReturnType<typeof setup>>['projection']) {
  const node = (type: string, text = ''): HostNode => ({
    type,
    text,
    props: {},
    children: [],
    parent: null,
    addEventListener: () => {},
  });
  const renderer = Vue.createRenderer<HostNode, HostNode>({
    createElement: type => node(type),
    createText: text => node('text', text),
    createComment: text => node('comment', text),
    setText: (n, text) => {
      n.text = text;
    },
    setElementText: (n, text) => {
      n.text = text;
      n.children = [];
    },
    patchProp: (n, key, _old, value) => {
      n.props[key] = value;
    },
    insert(n, parent, anchor) {
      if (n.parent) n.parent.children.splice(n.parent.children.indexOf(n), 1);
      const index = anchor ? parent.children.indexOf(anchor) : -1;
      if (index < 0) parent.children.push(n);
      else parent.children.splice(index, 0, n);
      n.parent = parent;
    },
    remove(n) {
      if (n.parent) n.parent.children.splice(n.parent.children.indexOf(n), 1);
    },
    parentNode: n => n.parent,
    nextSibling: n => n.parent?.children[n.parent.children.indexOf(n) + 1] ?? null,
  });
  const root = node('root'),
    app = renderer.createApp(component(), { controller });
  app.mount(root);
  const nodes = () => {
    const all: HostNode[] = [];
    const visit = (n: HostNode) => {
      all.push(n);
      n.children.forEach(visit);
    };
    visit(root);
    return all;
  };
  const button = (text: string) => {
    const b = nodes().find(n => n.type === 'button' && n.text.includes(text));
    assert.ok(b, text);
    return b;
  };
  const click = async (text: string) => {
    const b = button(text);
    assert.ok(!b.props.disabled, `disabled ${text}`);
    await (b.props.onClick as () => unknown)();
    await Vue.nextTick();
  };
  const confirm = async () => {
    const box = nodes().find(n => n.type === 'input')!;
    (box.props['onUpdate:modelValue'] as (v: boolean) => void)(true);
    await Vue.nextTick();
  };
  return { app, button, click, confirm };
}
test('T12 mounted check -> explicit confirmation -> sync -> query uses only injected worldbook', async () => {
  const f = await setup(),
    ui = mount(f.projection);
  assert.equal(ui.button('同步当前已保存版本').props.disabled, true);
  await ui.click('检查与预览');
  assert.equal(f.book.statistics.writes, 0);
  await ui.confirm();
  assert.equal(ui.button('同步当前已保存版本').props.disabled, false);
  await ui.click('同步当前已保存版本');
  assert.equal(f.projection.view().status, 'synced');
  assert.equal(f.book.statistics.writes, 1);
  assert.equal(ui.button('同步当前已保存版本').props.disabled, true);
  await ui.click('仅查询同步结果');
  assert.equal(f.book.statistics.writes, 1);
  assert.equal(f.store.statistics.writes, 0);
  ui.app.unmount();
  f.close();
});
test('T12 page unmount is not shared-service close; table settings navigation changes no data', async () => {
  let navigated = 0;
  const f = await setup(undefined, {
      navigateTemplate: () => {
        navigated++;
      },
    }),
    ui = mount(f.projection);
  await ui.click('去表级导出参数');
  assert.equal(navigated, 1);
  ui.app.unmount();
  await f.projection.inspect();
  await f.projection.sync(true);
  assert.equal(f.projection.view().status, 'synced');
  assert.equal(f.store.statistics.writes, 0);
  f.close();
});
