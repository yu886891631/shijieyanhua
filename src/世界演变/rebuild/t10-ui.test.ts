import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import * as ts from 'typescript';
import * as Vue from 'vue';
import { parse, compileScript, compileStyle } from 'vue/compiler-sfc';
import { renderToString } from 'vue/server-renderer';
import { createMinimalT2Fixture } from './t2-defaults';
import { initializeT10Document, normalizeT10Document, type T10Document } from './t10-host-protocol';
import { createT10SimulatedHost } from './t10-simulated-host';
import { createT10RecoveryController } from './t10-recovery-controller';
import type { T10Driver } from './t10-host-gateway';
const filename = resolve('src/世界演变/rebuild/T10RecoveryWorkbench.vue'),
  source = readFileSync(filename, 'utf8'),
  parsed = parse(source, { filename }),
  script = compileScript(parsed.descriptor, { id: 'data-v-t10', inlineTemplate: true });
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
async function setup(initialized = true, unverified = false) {
  let doc: T10Document = normalizeT10Document({
    binding: { hostChatId: '<img src=x onerror=alert(1)>', characterId: 'card' },
    variables: { other: 5 },
    messages: [],
  });
  if (initialized)
    doc = await initializeT10Document(
      doc,
      { mode: 't10-host', chatId: 'chat-ui', worldId: 'demo-world', branchId: 'demo-main' },
      createMinimalT2Fixture(),
      () => {
        throw new Error('No fake anchor is made for empty messages');
      },
    );
  const host = createT10SimulatedHost(doc),
    driver: T10Driver = unverified
      ? {
          ...host.driver,
          capabilities: {
            ...host.driver.capabilities,
            environment: 'unverified-host',
            durableRead: false,
            atomicDocumentCas: false,
            writeScope: 'none',
          },
        }
      : host.driver;
  const controller = createT10RecoveryController(driver);
  return { host, controller };
}
const render = (controller: ReturnType<typeof createT10RecoveryController>) =>
  renderToString(Vue.createSSRApp(component(), { controller }));
test('T10 recovery UI has strict TypeScript, scoped responsive CSS and only a query action', () => {
  assert.deepEqual(parsed.errors, []);
  assert.ok(parsed.descriptor.styles[0].scoped);
  assert.deepEqual(
    compileStyle({ filename, source: parsed.descriptor.styles[0].content, id: 'data-v-t10', scoped: true }).errors,
    [],
  );
  assert.doesNotMatch(
    source,
    /v-html|innerHTML|\bfetch\(|\.save\(|\.start\(|localStorage|TavernHelper|position:\s*absolute|\d+vh/,
  );
  const virtual = `${filename}.ts`.replaceAll('\\', '/');
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
    original = host.getSourceFile;
  host.getSourceFile = (p, l, e, fresh) =>
    p.replaceAll('\\', '/') === virtual ? ts.createSourceFile(p, script.content, l, true) : original(p, l, e, fresh);
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
      getCanonicalFileName: x => x,
      getCurrentDirectory: () => process.cwd(),
      getNewLine: () => '\n',
    }),
  );
});
test('T10 page clearly separates unchecked, confirmed JSON and simulated-host source without writes', async () => {
  const f = await setup();
  assert.match(await render(f.controller), /尚未检查/);
  await f.controller.refresh();
  const html = await render(f.controller);
  for (const label of [
    '完整快照已确认',
    '模拟宿主（不是实际酒馆）',
    '初始快照或无有效存档',
    '未自动压缩或清理历史',
    '不自动续发',
  ])
    assert.ok(html.includes(label), label);
  assert.match(html, /&lt;img/);
  assert.doesNotMatch(html, /<img src=x/);
  assert.equal(f.host.statistics.writes, 0);
  f.controller.close();
});
test('T10 empty namespace page explains old data is not automatically migrated and no anchor remains draft', async () => {
  const f = await setup(false);
  await f.controller.refresh();
  const html = await render(f.controller);
  assert.match(html, /未建立新格式存档/);
  assert.match(html, /只能保留草稿/);
  assert.match(html, /不会在这里被自动搬入或覆盖/);
  assert.equal(f.host.statistics.writes, 0);
  f.controller.close();
});
test('T10 unverified host is visibly readonly and never advertised as durable live acceptance', async () => {
  const f = await setup(true, true);
  await f.controller.refresh();
  const html = await render(f.controller);
  assert.match(html, /当前只读/);
  assert.match(html, /原子写入未经验证/);
  assert.match(html, /未验证宿主，只读/);
  assert.equal(f.host.statistics.writes, 0);
  f.controller.close();
});
test('T10 persisted read failure has no success label and no automatic retry generation', async () => {
  const f = await setup();
  f.host.failReads();
  await f.controller.refresh();
  const html = await render(f.controller);
  assert.match(html, /持久读回失败，未确认/);
  assert.doesNotMatch(html, /完整快照已确认/);
  assert.equal(f.host.statistics.writes, 0);
  f.controller.close();
});
