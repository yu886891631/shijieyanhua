import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import * as ts from 'typescript';
import * as Vue from 'vue';
import { parse, compileScript, compileStyle } from 'vue/compiler-sfc';
import { renderToString } from 'vue/server-renderer';
import { setupT13Test, emptyT13Fixture, legacyT13Fixture } from './t13-test-fixtures';
import type { T13Controller } from './t13-controller';
const filename = resolve('src/世界演变/rebuild/T13BackupWorkbench.vue'),
  source = readFileSync(filename, 'utf8');
const parsed = parse(source, { filename }),
  script = compileScript(parsed.descriptor, { id: 'data-v-t13', inlineTemplate: true });
function component(): Vue.Component {
  const generated = ts.transpileModule(script.content, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    reportDiagnostics: true,
  });
  assert.deepEqual(generated.diagnostics, []);
  const module = { exports: {} as { default: Vue.Component } };
  new Function('require', 'module', 'exports', generated.outputText)(
    (id: string) => {
      assert.equal(id, 'vue');
      // Custom renderer has no browser focus tree; retain real model creation and update the fake value only.
      return {
        ...Vue,
        vModelText: {
          ...Vue.vModelText,
          beforeUpdate: (el: { value: unknown }, binding: { value: unknown }) => {
            el.value = binding.value ?? '';
          },
        },
      };
    },
    module,
    module.exports,
  );
  return module.exports.default;
}
const render = (controller: T13Controller) => renderToString(Vue.createSSRApp(component(), { controller }));
test('T13 strict SFC TypeScript/scoped CSS compile and prohibit executable imports or global UI selectors', () => {
  assert.deepEqual(parsed.errors, []);
  assert.doesNotMatch(source, /v-html|innerHTML|\bfetch\(|indexedDB|TavernHelper|localStorage/);
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
  const css = parsed.descriptor.styles[0];
  assert.equal(css.scoped, true);
  assert.deepEqual(compileStyle({ filename, source: css.content, id: 'data-v-t13', scoped: true }).errors, []);
  for (const token of [
    'minmax(0, 1fr)',
    'min-width: 0',
    'overflow: auto',
    ':focus-visible',
    'max-width: 850px',
    'max-width: 600px',
    '#fff0f3',
    '#f1f8ef',
  ])
    assert.ok(css.content.includes(token), token);
  assert.doesNotMatch(
    css.content,
    /position:\s*(fixed|absolute)|100vh|100vw|(?:^|\n)\s*(body|html|\.menu_button)\s*\{/,
  );
});
test('T13 unopened page has separated wizards, no fake saved state, disabled clear and readonly-source capability', async () => {
  const f = await setupT13Test(),
    html = await render(f.transfer);
  for (const text of [
    '完整世界',
    '资料快照',
    '迁移旧版资料',
    '恢复指定世界',
    '导入独立世界',
    '导入模板',
    '检查历史审计',
    '不更新世界书',
    '单独操作：清空当前世界',
    '不能直接由旧插件读取',
  ])
    assert.ok(html.includes(text), text);
  assert.match(html, /disabled[^>]*>\s*只读检查已选旧库/);
  assert.match(html, /disabled[^>]*>\s*只预览清空范围/);
  assert.equal(f.store.statistics.writes, 0);
  f.close();
});
test('T13 mapping and template malicious strings are escaped, never interpreted as HTML/script', async () => {
  const raw = legacyT13Fixture();
  raw.rows.npc[0].id = '<script>alert(1)</script>';
  raw.rows.event[0].data.actorIds = [raw.rows.npc[0].id];
  raw.rows.organization[0].data.memberIds = [raw.rows.npc[0].id];
  raw.rows.plan[0].data.actorIds = [raw.rows.npc[0].id];
  const f = await setupT13Test(emptyT13Fixture());
  await f.transfer.previewText(JSON.stringify(raw), 'legacy');
  const html = await render(f.transfer);
  assert.match(html, /&lt;script&gt;alert/);
  assert.doesNotMatch(html, /<script>alert|private-t8-key/);
  assert.equal(f.store.statistics.writes, 0);
  f.close();
});
test('T13 pending receipt disables confirmation/save/clear and exposes query-only next step', async () => {
  const f = await setupT13Test(emptyT13Fixture());
  await f.backup();
  await f.transfer.previewText(JSON.stringify(legacyT13Fixture()), 'legacy');
  f.transfer.consent(true);
  f.store.queueWriteFault('ack-lost');
  await f.transfer.save();
  const html = await render(f.transfer);
  assert.match(html, /disabled[^>]*>\s*确认并保存当前目标世界/);
  assert.doesNotMatch(html, /disabled[^>]*>\s*仅查询未知保存结果/);
  await f.transfer.query();
  assert.equal(f.store.statistics.writes, 1);
  f.close();
});
interface Node {
  type: string;
  text: string;
  props: Record<string, unknown>;
  children: Node[];
  parent: Node | null;
  addEventListener: () => void;
  options: Node[];
  value: unknown;
  multiple: boolean;
  selectedIndex: number;
}
function mount(controller: T13Controller) {
  const node = (type: string, text = ''): Node => ({
    type,
    text,
    props: {},
    children: [],
    parent: null,
    addEventListener: () => {},
    get options() {
      return this.children.filter(n => n.type === 'option');
    },
    get value() {
      return this.props.value;
    },
    set value(v) {
      this.props.value = v;
    },
    multiple: false,
    selectedIndex: -1,
  });
  const renderer = Vue.createRenderer<Node, Node>({
    createElement: t => node(t),
    createText: t => node('text', t),
    createComment: t => node('comment', t),
    setText: (n, t) => {
      n.text = t;
    },
    setElementText: (n, t) => {
      n.text = t;
      n.children = [];
    },
    patchProp: (n, k, _o, v) => {
      n.props[k] = v;
    },
    insert(n, p, a) {
      if (n.parent) n.parent.children.splice(n.parent.children.indexOf(n), 1);
      const i = a ? p.children.indexOf(a) : -1;
      if (i < 0) p.children.push(n);
      else p.children.splice(i, 0, n);
      n.parent = p;
    },
    remove(n) {
      if (n.parent) n.parent.children.splice(n.parent.children.indexOf(n), 1);
    },
    parentNode: n => n.parent,
    nextSibling: n => n.parent?.children[n.parent.children.indexOf(n) + 1] ?? null,
  });
  const root = node('root'),
    exports: { text: string; filename: string }[] = [],
    app = renderer.createApp(component(), {
      controller,
      onExport: (text: string, filename: string) => exports.push({ text, filename }),
    });
  app.mount(root);
  const all = () => {
    const ns: Node[] = [];
    const visit = (n: Node) => {
      ns.push(n);
      n.children.forEach(visit);
    };
    visit(root);
    return ns;
  };
  const button = (text: string) => {
    const n = all().find(n => n.type === 'button' && n.text.includes(text));
    assert.ok(n, text);
    return n;
  };
  const click = async (text: string) => {
    const n = button(text);
    assert.ok(!n.props.disabled, text);
    await (n.props.onClick as () => unknown)();
    await Vue.nextTick();
  };
  const check = async (index: number) => {
    const n = all().filter(n => n.type === 'input')[index];
    assert.ok(n);
    const update = n.props['onUpdate:modelValue'] as ((v: boolean) => void) | undefined;
    if (update) update(true);
    else (n.props.onChange as (event: unknown) => void)({ target: { checked: true } });
    await Vue.nextTick();
  };
  const text = async (v: string) => {
    const n = all().find(n => n.type === 'textarea')!;
    (n.props['onUpdate:modelValue'] as (v: string) => void)(v);
    await Vue.nextTick();
  };
  return { app, exports, button, click, check, text };
}
test('T13 mounted backup→external acknowledgement→preview→consent→save uses the same formal service', async () => {
  const f = await setupT13Test(emptyT13Fixture()),
    ui = mount(f.transfer);
  await ui.check(0);
  await ui.click('生成并导出所选备份');
  assert.equal(ui.exports.length, 1);
  assert.match(ui.exports[0].filename, /完整|world/);
  await ui.check(1);
  await ui.text(JSON.stringify(legacyT13Fixture()));
  await ui.click('校验并预览所选文件');
  assert.equal(ui.button('确认并保存').props.disabled, true);
  await ui.check(4);
  await ui.click('确认并保存');
  assert.equal(f.transfer.view().report?.status, 'saved', f.transfer.view().error ?? '');
  assert.equal(f.store.statistics.writes, 1);
  ui.app.unmount();
  f.close();
});
test('T13 editing source/options invalidates previous preview consent, and unmount does not close shared controller', async () => {
  const f = await setupT13Test(emptyT13Fixture()),
    ui = mount(f.transfer);
  await ui.text(JSON.stringify(legacyT13Fixture()));
  await ui.click('校验并预览所选文件');
  f.transfer.consent(true);
  await Vue.nextTick();
  await ui.text('{}');
  assert.equal(f.transfer.view().report, null);
  assert.equal(f.transfer.view().consent, false);
  assert.equal(f.store.statistics.writes, 0);
  ui.app.unmount();
  assert.equal(f.transfer.view().closed, false);
  await f.transfer.previewText(JSON.stringify(legacyT13Fixture()), 'legacy');
  assert.equal(f.transfer.view().report?.valid, true);
  f.close();
});
