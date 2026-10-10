import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import * as ts from 'typescript';
import * as Vue from 'vue';
import { compileScript, compileStyle, parse } from 'vue/compiler-sfc';
import { renderToString } from 'vue/server-renderer';
import * as contract from './t1-ui-contract';

const sampleFilename = resolve('src/世界演变/rebuild/T1SandboxWorkbench.vue');
const sampleSource = readFileSync(sampleFilename, 'utf8');
const parsed = parse(sampleSource, { filename: sampleFilename });

function compileSample(inlineTemplate = true): Vue.Component {
  assert.deepEqual(parsed.errors, []);
  const script = compileScript(parsed.descriptor, {
    id: 'data-v-we-t1-sandbox',
    inlineTemplate,
  });
  const output = ts.transpileModule(script.content, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    reportDiagnostics: true,
  });
  assert.equal(output.diagnostics?.length ?? 0, 0);
  const compiledModule: { exports: { default?: Vue.Component } } = { exports: {} };
  const resolveAllowedImport = (id: string) => {
    if (id === 'vue') return Vue;
    if (id === './t1-ui-contract') return contract;
    throw new Error(`T1 sample imported an unexpected dependency: ${id}`);
  };
  // Compile in memory only. No entry point, artifact file, host mount or network request is created.
  new Function('require', 'module', 'exports', output.outputText)(
    resolveAllowedImport,
    compiledModule,
    compiledModule.exports,
  );
  assert.ok(compiledModule.exports.default);
  return compiledModule.exports.default;
}

const Sample = compileSample();

async function renderSample(controller = contract.createT1SandboxController()) {
  return renderToString(Vue.createSSRApp(Sample, { controller }));
}

test('T1 sample compiles with only the shared contract and Vue, and its styles remain private', () => {
  assert.equal(parsed.descriptor.styles.length, 1);
  assert.equal(parsed.descriptor.styles[0].scoped, true);
  const css = compileStyle({
    source: parsed.descriptor.styles[0].content,
    filename: sampleFilename,
    id: 'data-v-we-t1-sandbox',
    scoped: true,
  });
  assert.deepEqual(css.errors, []);
  assert.match(css.code, /\[data-v-we-t1-sandbox\]/);
  assert.doesNotMatch(parsed.descriptor.styles[0].content, /(?:^|\n)\s*(?:body|html|\.menu_button)\s*\{/);
  assert.doesNotMatch(
    sampleSource,
    /v-html|innerHTML|localStorage|sessionStorage|indexedDB|fetch\(|window\.|document\./,
  );
});

test('T1 compiled sample passes strict TypeScript checks without creating a build artifact', () => {
  const script = compileScript(parsed.descriptor, { id: 'data-v-we-t1-sandbox', inlineTemplate: true });
  const virtualFilename = `${sampleFilename}.ts`.replaceAll('\\', '/');
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
  const readSourceFile = host.getSourceFile;
  const fileExists = host.fileExists;
  const readFile = host.readFile;
  const isVirtualFile = (filename: string) => filename.replaceAll('\\', '/') === virtualFilename;
  host.fileExists = filename => isVirtualFile(filename) || fileExists(filename);
  host.readFile = filename => (isVirtualFile(filename) ? script.content : readFile(filename));
  host.getSourceFile = (filename, languageVersion, onError, shouldCreateNewSourceFile) => {
    if (isVirtualFile(filename)) return ts.createSourceFile(filename, script.content, languageVersion, true);
    return readSourceFile(filename, languageVersion, onError, shouldCreateNewSourceFile);
  };
  const program = ts.createProgram([virtualFilename], options, host);
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.equal(
    ts.formatDiagnostics(diagnostics, {
      getCanonicalFileName: filename => filename,
      getCurrentDirectory: () => process.cwd(),
      getNewLine: () => '\n',
    }),
    '',
  );
});

test('T1 sample renders all nine pages with navigation, close access, regions, scope and blocked operations', async () => {
  assert.equal(contract.T1_PAGE_ITEMS.length, 9);
  for (const item of contract.T1_PAGE_ITEMS) {
    const controller = contract.createT1SandboxController({ initialRoute: contract.createT1Route({ page: item.id }) });
    const html = await renderSample(controller);
    const blueprint = contract.T1_PAGE_BLUEPRINTS[item.id];
    assert.ok(html.includes(blueprint.title), item.id);
    assert.ok(html.includes(blueprint.emptyTitle), item.id);
    for (const region of blueprint.sections) assert.ok(html.includes(region), `${item.id}: ${region}`);
    for (const nav of contract.T1_PAGE_ITEMS) assert.ok(html.includes(nav.label), `${item.id}: navigation ${nav.id}`);
    assert.match(html, /aria-label="关闭工作台样例"/);
    assert.match(html, /aria-current="page"/);
    assert.match(html, /tabindex="-1"/);
    assert.match(html, /仅内存沙盒/);
    assert.match(html, /非正式功能/);
    assert.match(html, /未写当前聊天/);
    assert.match(html, /不调用 API 或世界书/);
    assert.match(html, /当前不能执行的原因/);
    assert.match(html, /disabled/);
    assert.doesNotMatch(html, /正式保存成功|已保存到聊天/);
    assert.equal(controller.getState().dirtyDraft, null);
    assert.equal(controller.getState().mode, 'sandbox-only');
  }
});

test('T1 component works without props and with only an initial route using its own sandbox factory', async () => {
  const defaultHtml = await renderToString(Vue.createSSRApp(Sample));
  assert.ok(defaultHtml.includes(contract.T1_PAGE_BLUEPRINTS.overview.title));
  assert.match(defaultHtml, /仅内存沙盒/);
  assert.match(defaultHtml, /没有未保存修改/);
  const dataHtml = await renderToString(
    Vue.createSSRApp(Sample, {
      initialRoute: { page: 'data', tab: 'parameters', section: 'api' },
    }),
  );
  assert.ok(dataHtml.includes(contract.T1_PAGE_BLUEPRINTS.data.title));
  assert.match(dataHtml, /表级参数尚未接入模板服务/);
  assert.match(dataHtml, /未写当前聊天/);
});

test('T1 data subviews share the same route model and render all structure parameter sections', async () => {
  const controller = contract.createT1SandboxController({ initialRoute: contract.createT1Route({ page: 'data' }) });
  let html = await renderSample(controller);
  assert.match(html, /宏观世界/);
  assert.match(html, /微观世界/);
  assert.match(html, /aria-pressed="true"[^>]*>\s*数据/);
  for (const section of contract.T1_PARAMETER_SECTIONS) {
    controller.navigate(contract.createT1Route({ page: 'data', tab: 'parameters', section: section.id }));
    html = await renderSample(controller);
    for (const item of contract.T1_PARAMETER_SECTIONS) assert.ok(html.includes(item.label));
    assert.match(html, /表级参数尚未接入模板服务/);
    const current = controller.getState().route;
    assert.equal(current.page, 'data');
    if (current.page === 'data') assert.equal(current.section, section.id);
  }
});

test('T1 compiled setup handlers return from every parameter section to records and preserve dirty-navigation checks', () => {
  const controller = contract.createT1SandboxController({ initialRoute: contract.createT1Route({ page: 'data' }) });
  // Invoke the SFC's own setup handlers without a DOM. This is not a browser click or focus acceptance test.
  const component = compileSample(false) as unknown as {
    setup: (
      props: { controller: typeof controller },
      context: { expose: () => void },
    ) => {
      selectDataTab: (tab: 'records' | 'parameters') => void;
      selectParameterSection: (section: string) => void;
      createExampleDraft: () => void;
      resolvePending: (choice: 'stay' | 'discard') => void;
      requestClose: () => void;
    };
  };
  const handlers = component.setup({ controller }, { expose() {} });
  for (const section of contract.T1_PARAMETER_SECTIONS) {
    handlers.selectDataTab('parameters');
    handlers.selectParameterSection(section.id);
    const parameters = controller.getState().route;
    assert.equal(parameters.page, 'data');
    if (parameters.page === 'data') assert.equal(parameters.section, section.id);
    handlers.selectDataTab('records');
    const records = controller.getState().route;
    assert.equal(records.page, 'data');
    if (records.page === 'data') {
      assert.equal(records.tab, 'records');
      assert.equal(records.section, 'schema');
    }
  }
  handlers.createExampleDraft();
  handlers.selectDataTab('parameters');
  assert.equal(controller.getState().pending?.kind, 'navigate');
  handlers.resolvePending('stay');
  assert.ok(controller.getState().dirtyDraft);
  handlers.selectDataTab('parameters');
  handlers.resolvePending('discard');
  assert.equal(controller.getState().dirtyDraft, null);
  handlers.requestClose();
  assert.equal(controller.getState().isOpen, false);
});

test('T1 unsaved navigation asks before leaving, stay retains draft, and discard affects only sandbox state', async () => {
  const controller = contract.createT1SandboxController();
  controller.markDraft('current-world', '示例姓名修改');
  controller.navigate(contract.createT1Route({ page: 'api' }));
  let html = await renderSample(controller);
  assert.equal(controller.getState().route.page, 'overview');
  assert.match(html, /role="alertdialog"/);
  assert.match(html, /aria-modal="true"/);
  assert.match(html, /inert/);
  assert.match(html, /留下继续查看/);
  assert.match(html, /丢弃示例草稿并离开/);
  controller.resolvePending('stay');
  html = await renderSample(controller);
  assert.equal(controller.getState().dirtyDraft?.label, '示例姓名修改');
  assert.equal(controller.getState().route.page, 'overview');
  assert.doesNotMatch(html, /role="alertdialog"/);
  controller.navigate(contract.createT1Route({ page: 'api' }));
  controller.resolvePending('discard');
  html = await renderSample(controller);
  assert.equal(controller.getState().route.page, 'api');
  assert.equal(controller.getState().dirtyDraft, null);
  assert.match(html, /没有未保存修改/);
});

test('T1 close remains reachable both without and with unsaved drafts, without pretending to stop a running engine', async () => {
  const empty = contract.createT1SandboxController();
  empty.requestClose();
  let html = await renderSample(empty);
  assert.equal(empty.getState().isOpen, false);
  assert.match(html, /工作台样例已关闭/);
  assert.doesNotMatch(html, /aria-label="工作台页面"/);

  const dirty = contract.createT1SandboxController();
  dirty.markDraft('current-template', '示例字段结构');
  dirty.requestClose();
  html = await renderSample(dirty);
  assert.equal(dirty.getState().isOpen, true);
  assert.match(html, /丢弃示例草稿并关闭/);
  dirty.resolvePending('stay');
  assert.equal(dirty.getState().isOpen, true);
  assert.equal(dirty.getState().dirtyDraft?.label, '示例字段结构');
  dirty.requestClose();
  dirty.resolvePending('discard');
  html = await renderSample(dirty);
  assert.equal(dirty.getState().isOpen, false);
  assert.equal(dirty.getState().dirtyDraft, null);
  assert.match(html, /未调用 API 或世界书/);
  assert.doesNotMatch(html, /已取消后台任务|已停止脚本/);
});

test('T1 fixture text is escaped in drafts and confirmation, and keyboard focus structure is explicit', async () => {
  const controller = contract.createT1SandboxController();
  controller.markDraft('current-world', '<img src=x onerror="steal()"> & <script>bad()</script>');
  controller.requestClose();
  const html = await renderSample(controller);
  assert.match(html, /&lt;img/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&amp;/);
  assert.doesNotMatch(html, /<img|<script/);
  assert.match(sampleSource, /@keydown\.tab\.prevent="cycleConfirmationFocus\(\$event\.shiftKey\)"/);
  assert.match(sampleSource, /@keydown\.esc\.stop\.prevent="resolvePending\('stay'\)"/);
  assert.match(sampleSource, /stayButton\.value\?\.focus\(\)/);
  assert.match(sampleSource, /pageHeading\.value\?\.focus\(\)/);
});

test('T1 SSR and pure navigation/close models do not touch real storage, network, globals or worldbook APIs', async t => {
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
  const descriptors = names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
  t.after(() => {
    for (const [name, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  });
  for (const name of names) {
    Object.defineProperty(globalThis, name, {
      configurable: true,
      get() {
        accessed.push(name);
        throw new Error(`T1 sample must not access real capability: ${name}`);
      },
    });
  }
  const controller = contract.createT1SandboxController();
  await renderToString(Vue.createSSRApp(Sample));
  for (const page of contract.T1_PAGE_ITEMS) {
    controller.navigate(contract.createT1Route({ page: page.id }));
    await renderSample(controller);
  }
  controller.markDraft('current-world', '示例修改');
  controller.requestClose();
  await renderSample(controller);
  controller.resolvePending('discard');
  await renderSample(controller);
  assert.deepEqual(accessed, []);
});
