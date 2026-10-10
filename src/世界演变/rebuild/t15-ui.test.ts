import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import * as ts from 'typescript';
import { parse, compileScript } from 'vue/compiler-sfc';
const filename = resolve('src/世界演变/rebuild/T15CandidateWorkspace.vue');
const { descriptor, errors } = parse(readFileSync(filename, 'utf8'), { filename });
test('T15 composed candidate Vue inline template and strict virtual TypeScript', () => {
  assert.deepEqual(errors, []);
  const script = compileScript(descriptor, { id: 'data-v-t15-test', inlineTemplate: true });
  const virtual = `${filename}.ts`.replaceAll('\\', '/'),
    declarations = resolve('t15-test-only.d.ts').replaceAll('\\', '/');
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
      : p.replaceAll('\\', '/') === declarations
        ? ts.createSourceFile(
            p,
            "declare module '*.vue' { const component: import('vue').Component; export default component; }",
            language,
            true,
          )
        : get(p, language, error, fresh);
  const diagnostics = ts.getPreEmitDiagnostics(
    ts.createProgram(
      [virtual, declarations, resolve('@types/function/variables.d.ts'), resolve('@types/iframe/util.d.ts')],
      options,
      host,
    ),
  );
  assert.equal(
    ts.formatDiagnostics(diagnostics, {
      getCanonicalFileName: p => p,
      getCurrentDirectory: () => process.cwd(),
      getNewLine: () => '\n',
    }),
    '',
  );
});
test('T15 all nine pages are wired to live controllers, without visual-fixture/old engine imports', () => {
  const source = readFileSync(filename, 'utf8');
  for (const page of ['overview', 'data', 'history', 'worldbook', 'api', 'evolution', 'prompts', 'backup'])
    assert.ok(source.includes(`#${page}`));
  assert.doesNotMatch(source, /visual-fixture|port<T>|setupT\d+Test/);
  const entry = readFileSync(resolve('src/世界演变/rebuild/t15-entry.ts'), 'utf8');
  assert.doesNotMatch(entry, /getVariables|replaceVariables|generate\(|tavern_events|fetch\(|loadSettings/);
  assert.match(entry, /\.stop/);
  assert.match(entry, /pagehide/);
  assert.match(entry, /rootId.*menu/);
  const browser = readFileSync(resolve('src/世界演变/rebuild/t15-browser.ts'), 'utf8');
  assert.match(browser, /createT3BrowserWorkerFactory/);
  assert.doesNotMatch(browser, /fetch\(|http|fixture/);
});
