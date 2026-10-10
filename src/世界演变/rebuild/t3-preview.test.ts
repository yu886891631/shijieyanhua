import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import initSqlJs from 'sql.js';
import * as ts from 'typescript';
import * as Vue from 'vue';
import { compileScript, compileStyle, parse } from 'vue/compiler-sfc';
import { renderToString } from 'vue/server-renderer';
import { createDefaultT2Fixture, createMinimalT2Fixture } from './t2-defaults';
import { normalizeT2WorldData } from './t2-values';
import * as preview from './t3-preview';
import type { T3Result } from './t3-engine';
import { createT3LocalPolicy, executeT3Request, T3EngineError } from './t3-engine';

const filename = resolve('src/世界演变/rebuild/T3SqlPreview.vue');
const source = readFileSync(filename, 'utf8');
const parsed = parse(source, { filename });
function compilePreview(inlineTemplate = true): Vue.Component {
  assert.deepEqual(parsed.errors, []);
  const script = compileScript(parsed.descriptor, { id: 'data-v-we-t3', inlineTemplate });
  const output = ts.transpileModule(script.content, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    reportDiagnostics: true,
  });
  assert.equal(output.diagnostics?.length ?? 0, 0);
  const compiled: { exports: { default?: Vue.Component } } = { exports: {} };
  const imports: Record<string, unknown> = { vue: Vue, './t3-preview': preview };
  new Function('require', 'module', 'exports', output.outputText)(
    (id: string) => {
      if (!Object.hasOwn(imports, id)) throw new Error(`T3 preview unexpected dependency: ${id}`);
      return imports[id];
    },
    compiled,
    compiled.exports,
  );
  assert.ok(compiled.exports.default);
  return compiled.exports.default;
}
const Preview = compilePreview();
const render = (props: Record<string, unknown> = {}) => renderToString(Vue.createSSRApp(Preview, props));

function resultFixture(): { template: ReturnType<typeof createDefaultT2Fixture>['template']; result: T3Result } {
  const { template, data } = createDefaultT2Fixture();
  const npc = template.tables.find(table => table.id === 'npc')!;
  const row = data.tables.npc[0];
  return {
    template,
    result: {
      mode: 'isolated-sqlite',
      data,
      queries: [
        {
          statementIndex: 0,
          tableId: npc.id,
          fieldIds: ['name', 'goals'],
          rows: [{ rowId: row.meta.id, values: { name: row.values.name, goals: row.values.goals } }],
        },
      ],
      allocations: [],
      changedRows: [{ tableId: npc.id, rowId: row.meta.id }],
      statements: [
        {
          statementIndex: 0,
          operation: 'update',
          tableId: npc.id,
          rowIds: [row.meta.id],
          fieldIds: ['goals'],
          sql: 'secret-diagnostic-sql',
          bindings: ['secret-bound-value'],
          affectedRows: 1,
        },
      ],
      log: {
        format: 'world-evolution-sql-log',
        version: 1,
        templateId: template.id,
        templateVersion: 1,
        batchId: 'preview',
        sql: 'secret-original-sql',
        parameters: ['secret-log-parameter'],
      },
    },
  };
}

test('T3 预览SFC和scoped样式编译，纯展示依赖不接SQLite/宿主/入口', () => {
  assert.equal(parsed.descriptor.styles.length, 1);
  assert.equal(parsed.descriptor.styles[0].scoped, true);
  const css = compileStyle({ source: parsed.descriptor.styles[0].content, filename, id: 'data-v-we-t3', scoped: true });
  assert.deepEqual(css.errors, []);
  assert.match(css.code, /\[data-v-we-t3\]/);
  assert.doesNotMatch(source, /v-html|innerHTML|indexedDB|localStorage|fetch\(|window\.|document\.|executeT3|sql\.js/);
  assert.doesNotMatch(parsed.descriptor.styles[0].content, /(?:^|\n)\s*(?:body|html|\.menu_button)\s*\{/);
});

test('T3 预览虚拟编译通过strict TypeScript，无构建输出', () => {
  const script = compileScript(parsed.descriptor, { id: 'data-v-we-t3', inlineTemplate: true });
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
  const get = host.getSourceFile,
    exists = host.fileExists,
    read = host.readFile;
  const isVirtual = (path: string) => path.replaceAll('\\', '/') === virtualFilename;
  host.fileExists = path => isVirtual(path) || exists(path);
  host.readFile = path => (isVirtual(path) ? script.content : read(path));
  host.getSourceFile = (path, version, onError, fresh) =>
    isVirtual(path) ? ts.createSourceFile(path, script.content, version, true) : get(path, version, onError, fresh);
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

test('T3 未提供结果只显示空默认表，不暗中加载虚构示例或执行入口', async () => {
  const html = await render();
  assert.match(html, /宏观 · 社会/);
  assert.match(html, /微观 · NPC/);
  assert.match(html, /不会保存当前聊天、调用API或写入世界书/);
  assert.match(html, /默认模板只建立空表/);
  assert.doesNotMatch(html, /林澄|雾港纪元|雾港集市|<input|<textarea|执行SQL|保存草稿/);
});

test('T3 执行结果展示可见表、查询、预算及未提交状态，不展示原始SQL和参数', async () => {
  const fixture = resultFixture();
  const html = await render({ ...fixture, initialTableId: 'npc', limits: { maxAffectedRows: 3, maxNewRows: 1 } });
  assert.match(html, /NPC · 查询1/);
  assert.match(html, /林澄/);
  assert.match(html, /隔离批次校验通过/);
  assert.match(html, /结果仍未提交到聊天存档/);
  assert.match(html, /最多修改记录/);
  assert.match(html, /修改 · NPC · 1条可见记录/);
  assert.doesNotMatch(html, /secret-diagnostic-sql|secret-bound-value|secret-original-sql|secret-log-parameter/);
  assert.deepEqual(preview.createT3PreviewModel(fixture).summary, {
    changedRows: 1,
    newRows: 0,
    queryRows: 1,
    statements: 1,
  });
});

test('T3 不可见表、行、字段、默认隐藏列及其计数不在只读模型或HTML泄漏', async () => {
  const fixture = resultFixture();
  const npc = fixture.template.tables.find(table => table.id === 'npc')!;
  const privateField = npc.fields.find(field => field.id === 'private_goal')!;
  privateField.visibility.user = false;
  privateField.name = 'secret-private-field-label';
  fixture.result.data.tables.npc[0].values.private_goal = 'secret-private-cell';
  fixture.result.data.tables.npc[0].values.editor_note = 'secret-hidden-ui-cell';
  fixture.result.data.tables.npc[1].meta.visibility.user = false;
  const hiddenId = fixture.result.data.tables.npc[1].meta.id;
  fixture.result.queries[0].fieldIds.push(privateField.id, 'editor_note');
  fixture.result.queries[0].rows[0].values.private_goal = 'secret-private-query';
  fixture.result.queries[0].rows[0].values.editor_note = 'secret-hidden-ui-query';
  fixture.result.queries[0].rows.push({ rowId: hiddenId, values: { name: 'secret-hidden-row-cell' } });
  const org = fixture.template.tables.find(table => table.id === 'organization')!;
  org.visibility.user = false;
  org.name = 'secret-hidden-table-label';
  const orgId = fixture.result.data.tables.organization[0].meta.id;
  fixture.result.queries.push({
    statementIndex: 1,
    tableId: org.id,
    fieldIds: ['name'],
    rows: [{ rowId: orgId, values: { name: 'secret-org-query' } }],
  });
  fixture.result.changedRows.push({ tableId: npc.id, rowId: hiddenId }, { tableId: org.id, rowId: orgId });
  fixture.result.allocations.push({ statementIndex: 2, tableId: org.id, rowId: orgId });
  fixture.result.statements.push({
    statementIndex: 1,
    operation: 'update',
    tableId: org.id,
    rowIds: [orgId],
    fieldIds: ['name'],
    sql: 'secret-org-sql',
    bindings: [],
    affectedRows: 1,
  });
  const model = preview.createT3PreviewModel(fixture);
  const text = JSON.stringify(model);
  for (const token of ['secret-', hiddenId, '"organization"', 'private_goal', 'editor_note'])
    assert.equal(text.includes(token), false, token);
  assert.deepEqual(model.summary, { changedRows: 1, newRows: 0, queryRows: 1, statements: 1 });
  const html = await render({ ...fixture, initialTableId: 'npc' });
  assert.doesNotMatch(html, /secret-|lin-merchant|secret-hidden-table-label/);
});

test('T3 仅改不可见字段的记录不计入可见修改或语句数', () => {
  const fixture = resultFixture();
  const field = fixture.template.tables
    .find(table => table.id === 'npc')!
    .fields.find(item => item.id === 'private_goal')!;
  field.visibility.user = false;
  fixture.result.statements[0].fieldIds = ['private_goal'];
  assert.equal(preview.createT3PreviewModel(fixture).summary.changedRows, 0);
  assert.equal(preview.createT3PreviewModel(fixture).summary.statements, 0);
});

test('T3 隐藏目标行/表的引用不公开稳定身份或私密引用数量', () => {
  const fixture = resultFixture();
  fixture.result.data.tables.npc[1].meta.visibility.user = false;
  fixture.template.tables.find(table => table.id === 'organization')!.visibility.user = false;
  const model = preview.createT3PreviewModel(fixture);
  const encoded = JSON.stringify(model);
  assert.equal(encoded.includes('lin-merchant'), false);
  assert.equal(encoded.includes('"rowId":"watch"'), false);
  assert.ok(encoded.includes('未公开'));
});

test('T3 错误只显示固定代码与可证明公开的定位，不回显错误原文或不可见字段', async () => {
  const fixture = resultFixture();
  const error = {
    code: 'DATA',
    statementIndex: 2,
    tableId: 'npc',
    fieldId: 'goals',
    message: 'secret-error-sql-data',
    sql: 'secret-full-sql',
  };
  let html = await render({ template: fixture.template, error });
  assert.match(html, /字段或引用未通过校验/);
  assert.match(html, /出错语句：第3条/);
  assert.match(html, /相关字段：NPC \/ 公开目标/);
  assert.doesNotMatch(html, /secret-error-sql-data|secret-full-sql/);
  fixture.template.tables
    .find(table => table.id === 'npc')!
    .fields.find(field => field.id === 'private_goal')!.visibility.user = false;
  html = await render({ template: fixture.template, error: { ...error, fieldId: 'private_goal' } });
  assert.doesNotMatch(html, /出错语句|相关字段|private_goal|秘密|secret-/);
  assert.match(html, /字段或引用未通过校验/);
});

test('T3 删除计数只在同身份基线可证明用户可见时显示，不猜测隐藏对象', () => {
  const fixture = resultFixture();
  const base = JSON.parse(JSON.stringify(fixture.result.data));
  const rowId = fixture.result.data.tables.event[0].meta.id;
  // Remove both the event and inbound references to keep complete graph valid.
  fixture.result.data.tables.plan[1].values.result_events = [];
  fixture.result.data.tables.event = [];
  fixture.result.changedRows = [{ tableId: 'event', rowId }];
  fixture.result.statements = [
    {
      statementIndex: 0,
      operation: 'delete',
      tableId: 'event',
      rowIds: [rowId],
      fieldIds: [],
      sql: 'secret-delete',
      bindings: [],
      affectedRows: 1,
    },
  ];
  assert.equal(preview.createT3PreviewModel(fixture).summary.changedRows, 0);
  assert.equal(preview.createT3PreviewModel({ ...fixture, baseData: base }).summary.changedRows, 1);
  base.worldId = 'different-world';
  assert.equal(preview.createT3PreviewModel({ ...fixture, baseData: base }).status, 'invalid');
});

test('T3 无效模板/结果/getter封闭显示，不执行访问器或回显恶意错误', async () => {
  for (const props of [{ template: null }, { result: {} }, { error: { code: 'unknown', message: 'secret' } }]) {
    const html = await render(props);
    assert.match(html, /预览输入未通过校验/);
    assert.doesNotMatch(html, /secret|aria-current/);
  }
  let calls = 0;
  const result = Object.defineProperty({}, 'data', {
    enumerable: true,
    get() {
      calls += 1;
      throw new Error('不要执行');
    },
  });
  assert.match(await render({ result }), /预览输入未通过校验/);
  assert.equal(calls, 0);
});

test('T3 业务文本与模板名称作为安全文本转义，不产生HTML/脚本', async () => {
  const fixture = resultFixture();
  fixture.template.name = '<img src=x onerror="bad()">';
  fixture.result.data.tables.npc[0].values.name = '<script>bad()</script>';
  fixture.result.queries[0].rows[0].values.name = '<script>query()</script>';
  const html = await render({ ...fixture, initialTableId: 'npc' });
  assert.match(html, /&lt;img/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<img|<script/);
});

test('T3 选表只修改内存选择，不改变模板、结果、基线或执行SQL', () => {
  const fixture = resultFixture();
  const before = JSON.stringify(fixture);
  const component = compilePreview(false) as unknown as {
    setup: (
      props: Record<string, unknown>,
      context: { expose: () => void },
    ) => {
      selectedTableId: Vue.Ref<string>;
      selected: Vue.ComputedRef<preview.T3PreviewTable | undefined>;
    };
  };
  const state = component.setup({ ...fixture, initialTableId: 'npc' }, { expose() {} });
  assert.equal(state.selected.value?.id, 'npc');
  state.selectedTableId.value = 'environment';
  assert.equal(state.selected.value?.id, 'environment');
  state.selectedTableId.value = 'missing';
  assert.equal(state.selected.value?.id, 'society');
  assert.equal(JSON.stringify(fixture), before);
});

test('T3 SSR与选择不读取网络、聊天、存档、事件、MVU或世界书', async t => {
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
  const originals = names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
  const accessed: string[] = [];
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
        throw new Error(`禁止访问${name}`);
      },
    });
  await render();
  await render({ template: createMinimalT2Fixture().template });
  await render(resultFixture());
  await render({ error: { code: 'SQL', message: 'secret' } });
  assert.deepEqual(accessed, []);
});

test('T3 演示结果仍经过完整模板/数据校验，而非显示损坏图中的猜测值', () => {
  const fixture = resultFixture();
  fixture.result.data.tables.npc[0].values.location = { tableId: 'location', rowId: 'not-exists' };
  assert.throws(() => normalizeT2WorldData(fixture.template, fixture.result.data));
  assert.equal(preview.createT3PreviewModel(fixture).status, 'invalid');
});

test('T3 真实SQLite结果进入只读预览，显示私有草稿而非虚构保存成功', async () => {
  const SQL = await initSqlJs({
    wasmBinary: Uint8Array.from(readFileSync(resolve('node_modules/sql.js/dist/sql-wasm.wasm'))).buffer,
  });
  const { template, data } = createDefaultT2Fixture();
  const before = JSON.stringify(data);
  const result = executeT3Request(SQL, {
    template,
    data,
    batchId: 'preview-real',
    policy: createT3LocalPolicy(template, data),
    sql: 'UPDATE we_npc SET f_goals = ? WHERE __we_row_id = ?; SELECT f_name, f_goals FROM we_npc WHERE __we_row_id = ?',
    parameters: ['<script>只读结果</script>', 'lin-watch', 'lin-watch'],
  });
  const model = preview.createT3PreviewModel({ template, result, baseData: data });
  assert.equal(model.status, 'success');
  assert.equal(model.summary.changedRows, 1);
  assert.equal(model.queries[0].rows[0].cells[1], '<script>只读结果</script>');
  const html = await render({ template, result, baseData: data, initialTableId: 'npc' });
  assert.match(html, /&lt;script&gt;只读结果&lt;\/script&gt;/);
  assert.match(html, /结果仍未提交到聊天存档/);
  assert.doesNotMatch(html, /<script>|UPDATE we_npc/);
  assert.equal(JSON.stringify(data), before);
});

test('T3 真实字段错误保留公开表/字段定位，原始值不作为错误文本展示', async () => {
  const SQL = await initSqlJs({
    wasmBinary: Uint8Array.from(readFileSync(resolve('node_modules/sql.js/dist/sql-wasm.wasm'))).buffer,
  });
  const { template, data } = createDefaultT2Fixture();
  try {
    executeT3Request(SQL, {
      template,
      data,
      batchId: 'preview-error',
      policy: createT3LocalPolicy(template, data),
      sql: 'UPDATE we_npc SET f_name = ? WHERE __we_row_id = ?',
      parameters: [42, 'lin-watch'],
    });
    assert.fail('非法字段应拒绝');
  } catch (error) {
    assert.ok(error instanceof T3EngineError);
    const model = preview.createT3PreviewModel({
      template,
      error: {
        code: error.code,
        statementIndex: error.statementIndex,
        tableId: error.tableId,
        fieldId: error.fieldId,
        message: 'secret-original-message',
      },
    });
    assert.equal(model.status, 'error');
    assert.equal(model.error?.statement, 1);
    assert.match(model.error?.field ?? '', /NPC/);
    assert.doesNotMatch(JSON.stringify(model), /secret-original-message/);
  }
});

test('T3 取消、超时和线程错误显示明确固定文案，不伪装成字段或SQL问题', () => {
  for (const [code, pattern] of [
    ['ABORTED', /已取消/],
    ['TIMEOUT', /超时/],
    ['WORKER_START', /无法启动/],
    ['PROTOCOL', /未通过校验/],
  ] as const) {
    const model = preview.createT3PreviewModel({ error: { code, message: 'secret-error' } });
    assert.equal(model.status, 'error');
    assert.match(model.error?.label ?? '', pattern);
    assert.equal(model.error?.statement, null);
    assert.doesNotMatch(JSON.stringify(model), /secret-error/);
  }
});
