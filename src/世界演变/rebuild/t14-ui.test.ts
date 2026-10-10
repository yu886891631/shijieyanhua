import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import * as ts from 'typescript';
import * as Vue from 'vue';
import { parse, compileScript } from 'vue/compiler-sfc';
import { renderToString } from 'vue/server-renderer';
import * as appearance from './t14-appearance';
import * as contract from './t1-ui-contract';
import { createT14VisualViews } from './t14-visual-fixtures';
const filename = resolve('src/世界演变/rebuild/T14Workspace.vue');
const source = readFileSync(filename, 'utf8');
const { descriptor } = parse(source, { filename });
const script = compileScript(descriptor, {
  id: 'data-v-t14-test',
  inlineTemplate: true,
  templateOptions: { compilerOptions: { hoistStatic: false } },
});
function component() {
  const module = { exports: {} as { default: Vue.Component } };
  const generated = ts.transpileModule(script.content, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  });
  new Function('require', 'module', 'exports', generated.outputText)(
    (id: string) => {
      if (id === 'vue') return Vue;
      if (id === './t14-appearance') return appearance;
      assert.equal(id, './t1-ui-contract');
      return contract;
    },
    module,
    module.exports,
  );
  return module.exports.default;
}
test('T14 shell strict virtual TypeScript and inline template compile', () => {
  const virtual = `${filename}.ts`.replaceAll('\\', '/');
  const options: ts.CompilerOptions = {
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    esModuleInterop: true,
  };
  const host = ts.createCompilerHost(options),
    get = host.getSourceFile;
  host.getSourceFile = (p, language, error, fresh) =>
    p.replaceAll('\\', '/') === virtual
      ? ts.createSourceFile(p, script.content, language, true)
      : get(p, language, error, fresh);
  const diagnostics = ts.getPreEmitDiagnostics(ts.createProgram([virtual], options, host));
  assert.equal(
    ts.formatDiagnostics(diagnostics, {
      getCanonicalFileName: p => p,
      getCurrentDirectory: () => process.cwd(),
      getNewLine: () => '\n',
    }),
    '',
  );
});
test('T14 safe nine-page shell names settings and unavailable slots without claiming usable host integration', async () => {
  const html = await renderToString(
    Vue.createSSRApp({
      render: () => Vue.h(component(), { version: '<script>bad</script>', dirtyLabels: ['NPC：<img onerror=bad>'] }),
    }),
  );
  for (const page of contract.T1_PAGE_ITEMS) assert.ok(html.includes(page.label));
  assert.match(html, /&lt;script&gt;bad/);
  assert.doesNotMatch(html, /<script>bad|<img onerror/);
  assert.match(html, /等待宿主接线|尚未接入/);
  assert.match(html, /本地隔离预览/);
});
interface N {
  style: { display: string };
  type: string;
  text: string;
  props: Record<string, unknown>;
  children: N[];
  parent: N | null;
  value: unknown;
  options: N[];
  multiple: boolean;
  selectedIndex: number;
  addEventListener: () => void;
  focus: () => void;
}
function mount(dirtyLabels: string[] = []) {
  let focused = '';
  let mounted = 0;
  let unmounted = 0;
  const node = (type: string, text = ''): N => ({
    style: { display: '' },
    type,
    text,
    props: {},
    children: [],
    parent: null,
    get value() {
      return this.props.value;
    },
    set value(v) {
      this.props.value = v;
    },
    get options() {
      return this.children.filter(n => n.type === 'option');
    },
    multiple: false,
    selectedIndex: -1,
    addEventListener: () => {},
    focus() {
      focused = this.text;
    },
  });
  const renderer = Vue.createRenderer<N, N>({
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
    patchProp: (n, k, _old, v) => {
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
  const model = Vue.reactive({ dirtyLabels }),
    close: boolean[] = [],
    pages: string[] = [],
    changes: appearance.T14Appearance[] = [];
  const child = Vue.defineComponent({
    setup() {
      const draft = Vue.ref('原填写');
      Vue.onMounted(() => mounted++);
      Vue.onUnmounted(() => unmounted++);
      return () =>
        Vue.h('textarea', {
          value: draft.value,
          onInput: (value: string) => {
            draft.value = value;
          },
        });
    },
  });
  const app = renderer.createApp({
    render: () =>
      Vue.h(
        component(),
        {
          dirtyLabels: model.dirtyLabels,
          onClose: () => close.push(true),
          'onUpdate:page': (v: string) => pages.push(v),
          onAppearance: (v: appearance.T14Appearance) => changes.push(v),
        },
        { data: () => Vue.h(child) },
      ),
  });
  const root = node('root');
  app.mount(root);
  const all = () => {
    const result: N[] = [];
    const visit = (n: N) => {
      result.push(n);
      n.children.forEach(visit);
    };
    visit(root);
    return result;
  };
  const click = async (text: string) => {
    const n = all().find(n => n.type === 'button' && (n.text === text || n.children.some(c => c.text === text)));
    assert.ok(n, text);
    await (n.props.onClick as () => unknown)();
    await Vue.nextTick();
  };
  return {
    app,
    all,
    click,
    close,
    pages,
    changes,
    model,
    focused: () => focused,
    mounted: () => mounted,
    unmounted: () => unmounted,
  };
}
test('T14 navigating away and back keeps slot component, typed draft and never emits close/save/discard', async () => {
  const ui = mount(['世界资料']);
  const field = ui.all().find(n => n.type === 'textarea')!;
  (field.props.onInput as (v: string) => void)('修改尚未保存');
  await Vue.nextTick();
  await ui.click('世界资料');
  await ui.click('API 配置');
  await ui.click('世界资料');
  assert.equal(ui.mounted(), 1);
  assert.equal(ui.unmounted(), 0);
  assert.equal(ui.all().find(n => n.type === 'textarea')?.props.value, '修改尚未保存');
  assert.deepEqual(ui.close, []);
  assert.deepEqual(ui.pages, ['data', 'api', 'data']);
  assert.equal(ui.focused(), '世界资料');
  ui.app.unmount();
});
test('T14 dirty close requires explicit decision, initially focuses safe choice and Escape returns focus', async () => {
  const ui = mount(['NPC 填写']);
  await ui.click('关闭工作台');
  assert.equal(ui.focused(), '留在工作台');
  assert.deepEqual(ui.close, []);
  const region = ui.all().find(n => n.props.role === 'region')!;
  (region.props.onKeydown as (e: unknown) => void)({ key: 'Escape', stopPropagation: () => {} });
  await Vue.nextTick();
  assert.equal(ui.focused(), '关闭工作台');
  assert.deepEqual(ui.close, []);
  await ui.click('关闭工作台');
  await ui.click('我知道尚未保存，仍请求关闭');
  assert.equal(ui.close.length, 1);
  assert.deepEqual(ui.model.dirtyLabels, ['NPC 填写']);
  assert.equal(ui.unmounted(), 0);
  ui.app.unmount();
});
test('T14 four themes and display-only settings emit copied values, reset to default without destroying pages', async () => {
  const ui = mount();
  await ui.click('外观与显示');
  await ui.click('深色');
  assert.equal(ui.changes.at(-1)?.theme, 'dark');
  const saved = ui.changes.at(-1)!;
  await ui.click('奶油风');
  assert.equal(saved.theme, 'dark');
  await ui.click('恢复默认外观');
  assert.deepEqual(ui.changes.at(-1), appearance.T14_DEFAULT);
  assert.equal(ui.mounted(), 1);
  assert.equal(ui.unmounted(), 0);
  ui.app.unmount();
});
test('T14 fixture producer uses safe public view snapshots with seven tables; no secret or live storage fields', async () => {
  const data = await createT14VisualViews();
  assert.equal(data.data.tables.length, 7);
  assert.equal(data.backup.sourceAvailable, false);
  assert.equal(data.backup.privateAllowed, false);
  assert.doesNotMatch(JSON.stringify(data), /private-t8-key-no-leak|"apiKey"|"authorization"/);
});
