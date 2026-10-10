import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import * as ts from 'typescript';
import * as Vue from 'vue';
import { parse, compileScript, compileStyle } from 'vue/compiler-sfc';
import { renderToString } from 'vue/server-renderer';
import { setupT11Test as setup } from './t11-test-fixtures';
import { createDefaultT2Fixture } from './t2-defaults';
import { deferredT8Test as deferred, responseT8Test as response } from './t8-test-fixtures';
import { untilT9Test as until } from './t9-test-fixtures';
const filename = resolve('src/世界演变/rebuild/T11DailyWorkbench.vue'),
  source = readFileSync(filename, 'utf8');
const parsed = parse(source, { filename }),
  script = compileScript(parsed.descriptor, { id: 'data-v-t11', inlineTemplate: true });
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
const render = (controller: Awaited<ReturnType<typeof setup>>['controller']) =>
  renderToString(Vue.createSSRApp(component(), { controller }));
test('T11 SFC has strict compiled TypeScript; page imports no live globals/network/unsafe HTML', () => {
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
});
test('T11 scoped green/pink UI has shrinkable grids, contained scroll/focus and no host-global layout', () => {
  assert.equal(parsed.descriptor.styles.length, 1);
  assert.equal(parsed.descriptor.styles[0].scoped, true);
  const css = parsed.descriptor.styles[0].content;
  assert.deepEqual(compileStyle({ filename, source: css, id: 'data-v-t11', scoped: true }).errors, []);
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
  assert.doesNotMatch(css, /position:\s*(?:fixed|absolute)|100vh|100vw|background:\s*(?:black|#000)/);
  assert.doesNotMatch(css, /(?:^|\n)\s*(?:body|html|\.menu_button)\s*\{/);
});
test('T11 overview empty / unchecked / configured states are plain Chinese with safe next actions', async () => {
  const state = createDefaultT2Fixture();
  state.data.tables = Object.fromEntries(state.template.tables.map(t => [t.id, []]));
  const f = await setup(state);
  let html = await render(f.controller);
  for (const text of ['总览', '自动演变', '楼层记录', '存档尚未确认', '不会自动把演示 NPC', '配置 API', '检查准备情况'])
    assert.ok(html.includes(text), text);
  await f.controller.refresh();
  html = await render(f.controller);
  assert.match(html, /版本与存档一致/);
  assert.match(html, /微观必须等本轮宏观/);
  assert.doesNotMatch(html, /已同步世界书|已存入酒馆聊天/);
  assert.equal(f.store.statistics.writes, 0);
  f.controller.close();
});
test('T11 long and malicious names/values are escaped on every page and readonly checkpoint', async () => {
  const f = await setup();
  await f.manual('<img src=x onerror=alert(1)>');
  await f.service.save();
  await f.controller.refresh();
  f.controller.selectHistory(f.service.headToken().commitId!);
  for (const page of ['overview', 'automatic', 'history'] as const) {
    f.controller.selectPage(page);
    const html = await render(f.controller);
    assert.doesNotMatch(html, /<img src=x|private-t8-key|invalid.example|Authorization/);
    if (page === 'history') assert.match(html, /&lt;img/);
  }
  f.controller.close();
});
test('T11 automatic page explains same cap/frequency/pending micro and disabled unconfigured start', async () => {
  const f = await setup();
  f.api.presets = [];
  await f.controller.refresh();
  f.controller.selectPage('automatic');
  const html = await render(f.controller);
  for (const text of [
    '两阶段',
    '不会把历史重放',
    '同轮续跑',
    '仅查询保存结果',
    '起点',
    '候选待本轮宏观',
    '整轮统一保存',
    '不绕过缺项',
  ])
    assert.ok(html.includes(text), text);
  assert.match(html, /disabled[^>]*>\s*手动运行整轮/);
  const isolated = await renderToString(
    Vue.createSSRApp(component(), { controller: f.controller, eventsAvailable: false }),
  );
  assert.match(isolated, /只支持手动本地模拟/);
  assert.match(isolated, /type="checkbox"[^>]*disabled/);
  assert.doesNotMatch(isolated, /开启不会立刻生成/);
  assert.equal(f.store.statistics.writes, 0);
  f.controller.close();
});
test('T11 waiting/running UI says temporary not saved; final no-change has saved receipt not failure', async () => {
  const gate = deferred<void>();
  const f = await setup(undefined, {
    reply: async r => {
      await gate.promise;
      return response(`SELECT __we_row_id FROM we_${r.tableId}`);
    },
  });
  f.controller.selectPage('automatic');
  const done = f.controller.start();
  await until(() => f.round.view().macro.sent > 0);
  let html = await render(f.controller);
  assert.match(html, /宏观暂存成功不等于整轮已保存/);
  assert.match(html, /取消本轮/);
  gate.resolve();
  await done;
  html = await render(f.controller);
  assert.match(html, /存档已确认/);
  assert.match(html, /已处理，未产生公开业务变化/);
  f.controller.close();
});
test('T11 failed / pending UI gives correct stage and query action without fake success', async () => {
  for (const fault of ['save-failed', 'ack-lost'] as const) {
    const f = await setup();
    f.store.queueWriteFault(fault);
    await f.controller.start();
    f.controller.selectPage('automatic');
    const html = await render(f.controller);
    assert.match(html, /失败位置：保存阶段/);
    assert.doesNotMatch(html, /存档已确认/);
    assert.match(html, fault === 'ack-lost' ? /保存回执未知，先查询/ : /保存失败/);
    f.controller.close();
  }
});
test('T11 history separates attempt logs / formal chain / SQL / checkpoint and distinct recovery effects', async () => {
  const f = await setup();
  await f.controller.start();
  f.controller.selectPage('history');
  f.controller.selectHistory(f.controller.view().history[0].id);
  const html = await render(f.controller);
  for (const text of [
    '运行记录（不等于已保存版本）',
    '已保存提交链',
    '不重新执行 SQL',
    '父提交',
    '固定 SQL',
    'SELECT &quot;__we_row_id&quot;',
    '世界时间',
    '所选历史检查点',
    '只预览范围',
    '分支需要独立目标身份',
  ])
    assert.ok(html.includes(text), text);
  assert.equal(f.store.statistics.writes, 1);
  f.controller.close();
});
test('T11 restore screen is explicit pink danger, full-checkpoint consent and preserved history', async () => {
  const f = await setup();
  await f.controller.start();
  f.controller.selectPage('history');
  f.controller.selectHistory('genesis');
  f.controller.previewRestore();
  const html = await render(f.controller);
  for (const text of [
    '恢复确认（会写入新版本，不删除历史）',
    '包含未公开字段',
    '我确认恢复整个检查点',
    '确认恢复 / 重试同一保存',
    '取消恢复草稿',
  ])
    assert.ok(html.includes(text), text);
  assert.match(html, /type="checkbox"/);
  assert.match(html, /disabled[^>]*>\s*确认恢复/);
  assert.equal(f.store.statistics.writes, 1);
  f.controller.close();
});
interface HostNode {
  type: string;
  text: string;
  props: Record<string, unknown>;
  children: HostNode[];
  parent: HostNode | null;
}
function mount(controller: Awaited<ReturnType<typeof setup>>['controller']) {
  const node = (type: string, text = ''): HostNode => ({ type, text, props: {}, children: [], parent: null });
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
      n.parent = null;
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
    const found = nodes().find(n => n.type === 'button' && n.text.includes(text));
    assert.ok(found, text);
    return found;
  };
  const click = async (text: string) => {
    const n = button(text);
    assert.ok(!n.props.disabled, `disabled ${text}`);
    await (n.props.onClick as () => Promise<unknown> | void)();
    await Vue.nextTick();
  };
  return { root, app, nodes, button, click };
}
test('T11 actual mounted page buttons switch the shared route, refresh only, then run one simulated round', async () => {
  const f = await setup(),
    ui = mount(f.controller);
  await ui.click('检查准备情况');
  await ui.click('自动演变');
  assert.equal(f.controller.view().page, 'automatic');
  assert.equal(f.store.statistics.writes, 0);
  await ui.click('手动运行整轮');
  assert.equal(f.store.statistics.writes, 1);
  await ui.click('楼层记录');
  assert.equal(f.controller.view().page, 'history');
  await ui.click('查看提交 1');
  assert.equal(f.controller.view().selected!.seq, 1);
  assert.equal(f.store.statistics.writes, 1);
  ui.app.unmount();
  f.controller.close();
});
test('T11 unmounting a view removes UI listener but does not cancel shared runtime', async () => {
  const gate = deferred<void>();
  const f = await setup(undefined, {
    reply: async r => {
      await gate.promise;
      return response(`SELECT __we_row_id FROM we_${r.tableId}`);
    },
  });
  const ui = mount(f.controller);
  const done = f.controller.start();
  await until(() => f.round.view().macro.sent > 0);
  ui.app.unmount();
  gate.resolve();
  await done;
  assert.equal(f.store.statistics.writes, 1);
  f.controller.close();
});
