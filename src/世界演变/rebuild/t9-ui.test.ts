import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as ts from 'typescript';
import * as Vue from 'vue';
import { compileScript, compileStyle, parse } from 'vue/compiler-sfc';
import { renderToString } from 'vue/server-renderer';
import { setupT9Test as setup, finishT9Test as finish, untilT9Test as until } from './t9-test-fixtures';
import { deferredT8Test as deferred, responseT8Test as response } from './t8-test-fixtures';
const names = [
  'T9RoundWorkbench',
  'T9WorldWorkbench',
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
async function render(f: Awaited<ReturnType<typeof setup>>) {
  return renderToString(Vue.createSSRApp(component(), { controller: f.round }));
}
test('T9 shared Vue workbench passes strict virtual TypeScript and scoped CSS compilation', () => {
  for (const f of files.slice(0, 2)) {
    assert.deepEqual(f.parsed.errors, []);
    assert.equal(f.parsed.descriptor.styles[0].scoped, true);
    assert.deepEqual(
      compileStyle({
        filename: f.filename,
        source: f.parsed.descriptor.styles[0].content,
        id: `data-v-${f.name}`,
        scoped: true,
      }).errors,
      [],
    );
    assert.doesNotMatch(f.source, /v-html|innerHTML|\bfetch\(|TavernHelper|localStorage|\.save\(/);
  }
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
    normal = (p: string) => p.replaceAll('\\', '/');
  host.fileExists = p => virtuals.has(normal(p)) || exists(p);
  host.readFile = p => virtuals.get(normal(p)) ?? read(p);
  host.getSourceFile = (p, l, e, fresh) =>
    virtuals.has(normal(p)) ? ts.createSourceFile(p, virtuals.get(normal(p))!, l, true) : get(p, l, e, fresh);
  const program = ts.createProgram(
    [...virtuals.keys(), resolve('@types/function/variables.d.ts'), resolve('@types/iframe/util.d.ts')],
    options,
    host,
  );
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.equal(
    diagnostics.length,
    0,
    ts.formatDiagnostics(diagnostics, {
      getCanonicalFileName: x => x,
      getCurrentDirectory: () => process.cwd(),
      getNewLine: () => '\n',
    }),
  );
});
test('T9 initial page states automatic simulated save, phase order, safety and refresh boundary', async () => {
  const html = await render(await setup());
  for (const text of [
    '宏观条件 → 微观行动',
    '开始模拟整轮并保存',
    '本地模拟',
    '不修改实际聊天',
    '等待本轮宏观',
    '尚未开始',
    '一次模拟保存',
    '不自动付费续跑',
  ])
    assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, />调用真实API<|>上传世界书</);
});
test('T9 saved page has before/after diffs, affected identities, receipt and escaped model input', async () => {
  const f = await setup(undefined, {
    reply: async r =>
      r.stage === 'micro'
        ? response('UPDATE we_npc SET f_last_action = ? WHERE __we_row_id = ?', [
            '<img src=x onerror=alert(1)>',
            'traveler',
          ])
        : response('SELECT __we_row_id FROM we_environment'),
  });
  await finish(f);
  const html = await render(f);
  for (const text of [
    '整轮已保存',
    '整轮已确认保存一次',
    '宏微观前后差异',
    '已保存结果',
    'traveler',
    '后台轮转',
    'c-t9-run',
    '实际发送输入',
  ])
    assert.ok(html.includes(text), text);
  assert.match(html, /&lt;img/);
  assert.doesNotMatch(html, /<img src=x|private-t8-key|invalid.example|Authorization/);
});
test('T9 pending page has query-only recovery and unknown-cost explanation, not saved success', async () => {
  const f = await setup();
  f.store.queueWriteFault('ack-lost');
  await finish(f);
  const html = await render(f);
  for (const text of ['保存回执未知', '仅查询保存结果', '真实请求的取消或超时可能已收费', '不重新生成'])
    assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /整轮已确认保存一次/);
});
type Node = { type: string; text: string; props: Record<string, unknown>; children: Node[]; parent: Node | null };
function mount(f: Awaited<ReturnType<typeof setup>>) {
  const create = (type: string, text = ''): Node => ({ type, text, props: {}, children: [], parent: null }),
    root = create('root');
  const renderer = Vue.createRenderer<Node, Node>({
    patchProp(n, k, _old, next) {
      n.props[k] = next;
    },
    insert(n, p, a) {
      if (n.parent) n.parent.children.splice(n.parent.children.indexOf(n), 1);
      n.parent = p;
      const i = a ? p.children.indexOf(a) : -1;
      if (i < 0) p.children.push(n);
      else p.children.splice(i, 0, n);
    },
    remove(n) {
      n.parent?.children.splice(n.parent.children.indexOf(n), 1);
      n.parent = null;
    },
    createElement: t => create(t),
    createText: t => create('#text', t),
    createComment: t => create('#comment', t),
    setText(n, t) {
      n.text = t;
    },
    setElementText(n, t) {
      n.text = t;
      n.children = [];
    },
    parentNode: n => n.parent,
    nextSibling: n => n.parent?.children[n.parent.children.indexOf(n) + 1] ?? null,
  });
  const app = renderer.createApp(component(), { controller: f.round });
  app.mount(root);
  const all = (n: Node = root): Node[] => [n, ...n.children.flatMap(all)],
    text = (n: Node): string => n.text + n.children.map(text).join('');
  const button = (label: string) => all().find(n => n.type === 'button' && text(n).trim() === label)!;
  return { app, all, text, button };
}
test('T9 real Vue start/save/retry buttons preserve same run and never duplicate sends', async () => {
  const f = await setup(),
    ui = mount(f);
  f.store.queueWriteFault('save-failed');
  try {
    await (ui.button('开始模拟整轮并保存').props.onClick as () => Promise<void>)();
    await until(() => f.round.view().status === 'paused');
    await Vue.nextTick();
    assert.equal(ui.button('使用同轮暂存续跑 / 重试保存').props.disabled, false);
    await (ui.button('使用同轮暂存续跑 / 重试保存').props.onClick as () => Promise<void>)();
    await Vue.nextTick();
    assert.equal(f.round.view().status, 'no-change');
    assert.equal(f.store.statistics.writes, 1);
    assert.equal(f.round.view().sent, 2);
    assert.ok(ui.all().some(n => ui.text(n).includes('成功处理标记已保存')));
  } finally {
    ui.app.unmount();
  }
});
test('T9 actual cancel button terminates micro without committing macro', async () => {
  const gate = deferred<{ status: number; text: string }>(),
    f = await setup(undefined, {
      reply: async r => (r.stage === 'micro' ? gate.promise : response('SELECT __we_row_id FROM we_environment')),
    }),
    ui = mount(f);
  try {
    await (ui.button('开始模拟整轮并保存').props.onClick as () => Promise<void>)();
    await until(() => f.round.view().status === 'micro' && f.round.view().sent === 2);
    await Vue.nextTick();
    assert.equal(ui.button('开始模拟整轮并保存').props.disabled, true);
    (ui.button('取消本轮').props.onClick as () => void)();
    await until(() => f.round.view().status === 'cancelled');
    await Vue.nextTick();
    assert.equal(f.store.statistics.writes, 0);
    assert.equal(ui.button('取消本轮').props.disabled, true);
  } finally {
    gate.resolve(response('SELECT __we_row_id FROM we_npc'));
    ui.app.unmount();
  }
});
test('T9 scoped responsive layout retains child instances, green normal surfaces and pink warnings', () => {
  assert.match(files[1].source, /v-show="page === 'world'"/);
  assert.match(files[1].source, /v-show="page === 'round'"/);
  const css = files[0].parsed.descriptor.styles[0].content;
  for (const text of ['#f1f8ef', '#fbe9ee', 'overflow-x: auto', 'focus-visible', 'max-width: 600px'])
    assert.ok(css.includes(text), text);
});
