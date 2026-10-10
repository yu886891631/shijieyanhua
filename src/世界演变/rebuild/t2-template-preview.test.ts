import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import * as ts from 'typescript';
import * as Vue from 'vue';
import { compileScript, compileStyle, parse } from 'vue/compiler-sfc';
import { renderToString } from 'vue/server-renderer';
import * as defaults from './t2-defaults';
import * as protocol from './t2-template';
import * as values from './t2-values';

const filename = resolve('src/世界演变/rebuild/T2TemplatePreview.vue');
const source = readFileSync(filename, 'utf8');
const parsed = parse(source, { filename });

function compilePreview(inlineTemplate = true): Vue.Component {
  assert.deepEqual(parsed.errors, []);
  const script = compileScript(parsed.descriptor, { id: 'data-v-we-t2', inlineTemplate });
  const output = ts.transpileModule(script.content, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    reportDiagnostics: true,
  });
  assert.equal(output.diagnostics?.length ?? 0, 0);
  const compiled: { exports: { default?: Vue.Component } } = { exports: {} };
  const imports: Record<string, unknown> = {
    vue: Vue,
    './t2-defaults': defaults,
    './t2-template': protocol,
    './t2-values': values,
  };
  const allowImport = (id: string) => {
    if (!Object.hasOwn(imports, id)) throw new Error(`T2 preview unexpected dependency: ${id}`);
    return imports[id];
  };
  // Test-only compilation of this trusted SFC; never execute imported user content or produce a bundle.
  new Function('require', 'module', 'exports', output.outputText)(allowImport, compiled, compiled.exports);
  assert.ok(compiled.exports.default);
  return compiled.exports.default;
}

const Preview = compilePreview();
const render = (props: Record<string, unknown> = {}) => renderToString(Vue.createSSRApp(Preview, props));

test('T2预览仅依赖纯协议/固定样例/Vue，私有CSS不改变宿主或生产入口', () => {
  assert.equal(parsed.descriptor.styles.length, 1);
  assert.equal(parsed.descriptor.styles[0].scoped, true);
  const css = compileStyle({ source: parsed.descriptor.styles[0].content, filename, id: 'data-v-we-t2', scoped: true });
  assert.deepEqual(css.errors, []);
  assert.match(css.code, /\[data-v-we-t2\]/);
  assert.doesNotMatch(source, /v-html|innerHTML|localStorage|sessionStorage|indexedDB|fetch\(|window\.|document\./);
  assert.doesNotMatch(parsed.descriptor.styles[0].content, /(?:^|\n)\s*(?:body|html|\.menu_button)\s*\{/);
});

test('T2预览内存编译通过strict TypeScript，未生成构建文件', () => {
  const script = compileScript(parsed.descriptor, { id: 'data-v-we-t2', inlineTemplate: true });
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
  const originalGet = host.getSourceFile;
  const originalExists = host.fileExists;
  const originalRead = host.readFile;
  const isVirtual = (path: string) => path.replaceAll('\\', '/') === virtualFilename;
  host.fileExists = path => isVirtual(path) || originalExists(path);
  host.readFile = path => (isVirtual(path) ? script.content : originalRead(path));
  host.getSourceFile = (path, languageVersion, onError, fresh) =>
    isVirtual(path)
      ? ts.createSourceFile(path, script.content, languageVersion, true)
      : originalGet(path, languageVersion, onError, fresh);
  const program = ts.createProgram([virtualFilename], options, host);
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.equal(
    ts.formatDiagnostics(diagnostics, {
      getCanonicalFileName: path => path,
      getCurrentDirectory: () => process.cwd(),
      getNewLine: () => '\n',
    }),
    '',
  );
});

test('默认七表可分别预览控件、生命周期、读取写入、继承及导出设置', async () => {
  const template = defaults.createDefaultT2Template();
  for (const table of template.tables) {
    const html = await render({ template, initialTableId: table.id });
    assert.ok(html.includes(`${table.name} · 结构与参数`));
    for (const field of table.fields) assert.ok(html.includes(field.name));
    for (const rule of Object.values(table.rules)) assert.ok(html.includes(rule));
    assert.match(html, /宏观世界/);
    assert.match(html, /微观世界/);
    assert.match(html, /aria-current="page"/);
    assert.match(html, /字段与输入方式/);
    assert.match(html, /允许读取：用户/);
    assert.match(html, /允许修改：人工/);
    assert.match(html, /继承.*上级设置/);
    assert.match(html, /世界书导出规则/);
    assert.match(html, /独立内存预览/);
    assert.match(html, /不保存当前聊天/);
    assert.match(html, /不会自动补种/);
    assert.doesNotMatch(html, /<input|<textarea|已保存成功|保存到聊天/);
  }
});

test('默认/最小/非默认业务表均可预览，不以七表枚举限制扩展', async () => {
  assert.match(await render(), /社会 · 结构与参数/);
  assert.match(
    await render({ template: defaults.createMinimalT2Template(), initialTableId: 'npc' }),
    /NPC · 结构与参数/,
  );
  const custom = defaults.createCustomT2Fixture();
  const html = await render({ template: custom.template, initialTableId: 'market' });
  assert.match(html, /市场供需 · 结构与参数/);
  assert.match(html, /固定 2 位小数/);
  assert.match(html, /布尔开关/);
  assert.doesNotMatch(html, /雾港集市|12\.30/, '仅模板预览不读取示例世界业务行');
});

test('继承来源、只读、隐藏非保密与关闭状态以中文显示', async () => {
  const template = defaults.createDefaultT2Template();
  const npc = template.tables.find(item => item.id === 'npc')!;
  npc.locked = true;
  template.phases.micro.enabled = false;
  template.phases.micro.frequency = { state: 'value', value: { ...template.defaults.frequency, every: 2 } };
  const html = await render({ template, initialTableId: 'npc' });
  assert.match(html, /来源：阶段设置/);
  assert.match(html, /来源：本表设置/);
  assert.match(html, /来源：全局设置/);
  assert.match(html, /自动更新：关闭/);
  assert.match(html, /禁止普通修改/);
  assert.match(html, /默认隐藏；不是保密权限/);
});

test('无效模板包括显式NULL均显示错误，不擅自换默认或采用损坏结构', async () => {
  for (const template of [null, {}, { ...defaults.createDefaultT2Template(), schemaVersion: 99 }]) {
    const html = await render({ template });
    assert.match(html, /role="alert"/);
    assert.match(html, /模板未通过校验/);
    assert.match(html, /没有采用这份模板/);
    assert.doesNotMatch(html, /结构与参数|aria-current/);
  }
  let calls = 0;
  const evil = Object.defineProperty({}, 'id', {
    enumerable: true,
    get() {
      calls += 1;
      return 'bad';
    },
  });
  assert.match(await render({ template: evil }), /模板未通过校验/);
  assert.equal(calls, 0);
});

test('恶意模板名/说明/规则与默认文本均被转义，不作为HTML或脚本执行', async () => {
  const template = defaults.createDefaultT2Template();
  const npc = template.tables.find(item => item.id === 'npc')!;
  template.name = '<img src=x onerror="bad()">';
  npc.description = '<script>bad()</script>';
  npc.fields.find(item => item.id === 'editor_note')!.defaultValue = '<img src=x>';
  npc.rules.update = '<script>rule()</script>';
  const html = await render({ template, initialTableId: 'npc' });
  assert.match(html, /&lt;img/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<img|<script/);
});

test('预览选表模型只改变内存选择，不改模板或世界数据', () => {
  const template = defaults.createDefaultT2Template();
  const before = JSON.stringify(template);
  const component = compilePreview(false) as unknown as {
    setup: (
      props: { template: protocol.T2Template; initialTableId: string },
      context: { expose: () => void },
    ) => { selectedTableId: Vue.Ref<string>; selected: Vue.ComputedRef<protocol.T2Table | undefined> };
  };
  const state = component.setup({ template, initialTableId: 'society' }, { expose() {} });
  for (const table of template.tables) {
    state.selectedTableId.value = table.id;
    assert.equal(state.selected.value?.id, table.id);
  }
  state.selectedTableId.value = 'missing';
  assert.equal(state.selected.value?.id, 'society');
  assert.equal(JSON.stringify(template), before);
});

test('SSR与模板选择不访问网络、实际聊天、存档、事件或世界书', async t => {
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
  const accessed: string[] = [];
  const originals = names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
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
        accessed.push(name);
        throw new Error(`禁止访问 ${name}`);
      },
    });
  await render();
  await render({ template: defaults.createMinimalT2Template(), initialTableId: 'npc' });
  await render({ template: null });
  assert.deepEqual(accessed, []);
});
