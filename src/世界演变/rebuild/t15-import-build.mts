/* eslint-disable import-x/no-nodejs-modules -- Explicit Node-only candidate builder; writes only with --write to a new fixed version. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { resolve, dirname, relative } from 'node:path';
import { parse, compileScript, compileStyleAsync } from 'vue/compiler-sfc';
import { T15_HOST_VERSION } from './t15-import-runtime';
import { createT15HostImportPackage } from './t15-import-package';
const require = createRequire(import.meta.url),
  { build } = createRequire(require.resolve('tsx'))('esbuild');
const sha = (v: string | Uint8Array) => createHash('sha256').update(v).digest('hex');
const root = resolve('src/世界演变/rebuild');
const base = {
  bundle: true,
  write: false,
  minify: true,
  platform: 'browser',
  target: 'es2022',
  format: 'iife',
  metafile: true,
  define: { 'process.env.NODE_ENV': '"production"' },
  legalComments: 'inline',
};
const worker = await build({
  ...base,
  entryPoints: [resolve(root, 't3-worker.ts')],
  plugins: [
    {
      name: 'host-inline-wasm',
      setup(b: any) {
        b.onResolve({ filter: /\.wasm\?inline$/ }, (args: any) => ({
          path: require.resolve(args.path.replace('?inline', '')),
          namespace: 'wasm-inline',
        }));
        b.onLoad({ filter: /.*/, namespace: 'wasm-inline' }, async (args: any) => ({
          contents: `export default ${JSON.stringify('data:application/wasm;base64,' + (await readFile(args.path)).toString('base64'))};`,
          loader: 'js',
        }));
      },
    },
  ],
});
const app = await build({
  ...base,
  entryPoints: [resolve(root, 't15-import-browser.ts')],
  define: { ...base.define, __T15_HOST_WORKER_SOURCE__: JSON.stringify(worker.outputFiles[0].text) },
  plugins: [
    {
      name: 'host-import-vue',
      setup(b: any) {
        b.onLoad({ filter: /\.vue$/ }, async (args: any) => {
          const { descriptor, errors } = parse(await readFile(args.path, 'utf8'), { filename: args.path });
          if (errors.length) throw errors[0];
          const id = 'data-v-we-host-' + sha(relative(process.cwd(), args.path).replaceAll('\\', '/')).slice(0, 12);
          let contents = compileScript(descriptor, { id, inlineTemplate: true }).content;
          for (const style of descriptor.styles) {
            const css = await compileStyleAsync({
              filename: args.path,
              source: style.content,
              id,
              scoped: !!style.scoped,
              preprocessLang: style.lang as 'scss' | undefined,
            });
            if (css.errors.length) throw css.errors[0];
            contents += `\n{const s=document.createElement('style');s.textContent=${JSON.stringify(css.code)};document.head.append(s);}`;
          }
          contents =
            contents.replace('export default ', 'const __default__ = ') +
            `\n__default__.__scopeId=${JSON.stringify(id)};export default __default__;`;
          return { contents, loader: 'ts', resolveDir: dirname(args.path) };
        });
      },
    },
  ],
});
const appCode = app.outputFiles[0].text;
const entry = await build({
  ...base,
  entryPoints: [resolve(root, 't15-import-entry.ts')],
  define: {
    ...base.define,
    __T15_HOST_APP_SOURCE__: JSON.stringify(appCode),
    __T15_HOST_BUILD_HASH__: JSON.stringify(sha(appCode)),
  },
});
const bundle = entry.outputFiles[0].text,
  pack = createT15HostImportPackage(bundle);
const name = `酒馆助手脚本-世界演变-${T15_HOST_VERSION}-真实接线候选版.json`;
const paths = [
  ...new Set([
    ...Object.keys(worker.metafile.inputs),
    ...Object.keys(app.metafile.inputs),
    ...Object.keys(entry.metafile.inputs),
  ]),
];
if (
  paths.some(
    p =>
      p.includes('test-fixtures') ||
      p.includes('t15-session.ts') ||
      p.includes('t15-browser.ts') ||
      p.includes('T15CandidateWorkspace.vue') ||
      p.startsWith('node:'),
  )
)
  throw new Error('真实候选混入隔离/测试/Node 入口');
const inputs = await Promise.all(
  paths.map(async path => ({ path, sha256: sha(await readFile(path.replace('wasm-inline:', ''))) })),
);
const manifest = {
  candidate: T15_HOST_VERSION,
  mode: 'controlled-native-candidate',
  bundle: { bytes: Buffer.byteLength(bundle), sha256: sha(bundle) },
  app: { bytes: Buffer.byteLength(appCode), sha256: sha(appCode) },
  worker: { bytes: worker.outputFiles[0].contents.length, sha256: sha(worker.outputFiles[0].contents) },
  importPackage: name,
  defaultEnabled: false,
  defaultPermissions: { paidRequests: false, chatWrites: false, automatic: false, worldbookSync: false },
  requiresDatabasePatchWhenSelected: true,
  trueHostAcceptance: 'not-performed',
  inputs,
};
const output = resolve('dist/世界演变候选版', T15_HOST_VERSION);
if (process.argv.includes('--write')) {
  await mkdir(output, { recursive: true });
  await writeFile(resolve(output, 'index.js'), bundle, 'utf8');
  await writeFile(resolve(output, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  await writeFile(resolve('导入到酒馆中', name), JSON.stringify(pack, null, 2), 'utf8');
}
console.log(
  JSON.stringify({
    write: process.argv.includes('--write'),
    candidate: T15_HOST_VERSION,
    output,
    importPackage: name,
    bundleBytes: manifest.bundle.bytes,
    sha256: manifest.bundle.sha256,
    inputs: inputs.length,
    vueInputs: paths.filter(p => p.endsWith('.vue')).length,
  }),
);
