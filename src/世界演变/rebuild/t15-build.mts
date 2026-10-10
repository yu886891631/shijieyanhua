/* eslint-disable import-x/no-nodejs-modules -- Explicit Node-only candidate builder and loopback server. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { resolve, dirname, relative } from 'node:path';
import { createServer } from 'node:http';
import { parse, compileScript, compileStyleAsync } from 'vue/compiler-sfc';
import { T15_VERSION } from './t15-session';
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve('tsx'))('esbuild');
const root = resolve('src/世界演变/rebuild'),
  sha = (v: string | Uint8Array) => createHash('sha256').update(v).digest('hex');
const base = {
  bundle: true,
  write: false,
  minify: true,
  platform: 'browser',
  target: 'es2022',
  format: 'iife',
  define: { 'process.env.NODE_ENV': '"production"' },
  metafile: true,
  legalComments: 'inline',
};
const worker = await build({
  ...base,
  entryPoints: [resolve(root, 't3-worker.ts')],
  plugins: [
    {
      name: 't15-fixed-inline-wasm',
      setup(builder: any) {
        builder.onResolve({ filter: /\.wasm\?inline$/ }, (args: any) => ({
          path: require.resolve(args.path.replace('?inline', '')),
          namespace: 'wasm-inline',
        }));
        builder.onLoad({ filter: /.*/, namespace: 'wasm-inline' }, async (args: any) => ({
          contents: `export default ${JSON.stringify('data:application/wasm;base64,' + (await readFile(args.path)).toString('base64'))};`,
          loader: 'js',
        }));
      },
    },
  ],
});
const app = await build({
  ...base,
  entryPoints: [resolve(root, 't15-browser.ts')],
  define: { ...base.define, __T15_WORKER_SOURCE__: JSON.stringify(worker.outputFiles[0].text) },
  plugins: [
    {
      name: 't15-isolated-vue',
      setup(builder: any) {
        builder.onLoad({ filter: /\.vue$/ }, async (args: any) => {
          const source = await readFile(args.path, 'utf8'),
            { descriptor, errors } = parse(source, { filename: args.path });
          if (errors.length) throw errors[0];
          const id = 'data-v-t15-' + sha(relative(process.cwd(), args.path).replaceAll('\\', '/')).slice(0, 12);
          let contents = compileScript(descriptor, { id, inlineTemplate: true }).content;
          for (const style of descriptor.styles) {
            const compiled = await compileStyleAsync({
              filename: args.path,
              source: style.content,
              id,
              scoped: !!style.scoped,
              preprocessLang: style.lang as 'scss' | undefined,
            });
            if (compiled.errors.length) throw compiled.errors[0];
            contents += `\n{const s=document.createElement('style');s.textContent=${JSON.stringify(compiled.code)};document.head.append(s);}`;
          }
          contents += `\n__default__.__scopeId=${JSON.stringify(id)};`;
          contents = contents.replace('export default ', 'const __default__ = ') + '\nexport default __default__;';
          return { contents, loader: 'ts', resolveDir: dirname(args.path) };
        });
      },
    },
  ],
});
const appCode = app.outputFiles[0].text;
const entry = await build({
  ...base,
  entryPoints: [resolve(root, 't15-entry.ts')],
  define: {
    ...base.define,
    __T15_APP_SOURCE__: JSON.stringify(appCode),
    __T15_CANDIDATE_VERSION__: JSON.stringify(T15_VERSION),
    __T15_APP_HASH__: JSON.stringify(sha(appCode)),
  },
});
const bundle = entry.outputFiles[0].text;
const output = resolve('dist/世界演变候选版', T15_VERSION);
const name = `酒馆助手脚本-世界演变-${T15_VERSION}-隔离功能候选版.json`;
const pack = {
  type: 'script',
  enabled: false,
  name: `世界演变 ${T15_VERSION}（隔离功能候选，不是正式发布）`,
  id: '8f42058a-c112-4fc2-a790-9d430e57bab1',
  content: bundle,
  info: '一个自包含脚本，内嵌固定 SQLite/WASM。默认关闭，无远程 import；不读取聊天、不调用真实 API、不写角色卡世界书。不与 alpha.16 共用数据。保存只在当前实例内存，重载前请导出完整隔离工作区。真实宿主适配仍待验证，不能作为正式游戏运行版。',
  button: { enabled: true, buttons: [{ name: '打开 T15 隔离测试工作区', visible: true }] },
  data: { candidate_version: T15_VERSION },
  export_with: { tavern_helper: 'script' },
};
await mkdir(output, { recursive: true });
await writeFile(resolve(output, 'index.js'), bundle, 'utf8');
await writeFile(resolve(output, 'preview.js'), appCode, 'utf8');
const html =
  '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
  `<meta name="t15-build" content="${sha(appCode)}"><title>${T15_VERSION} 隔离候选</title>` +
  '<style>body{margin:0}</style><div id="world-evolution-t15-root"></div><script src="/preview.js"></script></html>';
await writeFile(resolve(output, 'preview.html'), html, 'utf8');
const entryHtml = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>T15 模拟酒馆入口验收</title>
<h1>模拟宿主，不是真实 SillyTavern</h1><p>只验证导入包入口、重复加载与卸载；没有聊天、API 或世界书。</p>
<div id="extensionsMenu"></div><button id="again">重复加载同一入口</button><button id="unload">卸载本次测试入口</button>
<script>window.$=fn=>fn();window.getButtonEvent=name=>name;
window.eventOn=(name,fn)=>{const b=document.createElement('button');b.textContent=name;document.body.append(b);b.onclick=fn;return {stop:()=>b.remove()}};
document.getElementById('again').onclick=()=>{const s=document.createElement('script');s.src='/index.js';document.body.append(s)};
document.getElementById('unload').onclick=()=>window.dispatchEvent(new Event('pagehide'));</script><script src="/index.js"></script></html>`;
await writeFile(resolve(output, 'entry-preview.html'), entryHtml, 'utf8');
await writeFile(resolve('导入到酒馆中', name), JSON.stringify(pack, null, 2), 'utf8');
const inputPaths = [
  ...new Set([
    ...Object.keys(worker.metafile.inputs),
    ...Object.keys(app.metafile.inputs),
    ...Object.keys(entry.metafile.inputs),
  ]),
];
const inputs = await Promise.all(
  inputPaths.map(async path => ({ path, sha256: sha(await readFile(path.replace('wasm-inline:', ''))) })),
);
const manifest = {
  candidate: T15_VERSION,
  mode: 'isolated-only',
  bundle: { bytes: Buffer.byteLength(bundle), sha256: sha(bundle) },
  worker: { bytes: worker.outputFiles[0].contents.length, sha256: sha(worker.outputFiles[0].contents) },
  app: { bytes: app.outputFiles[0].contents.length, sha256: sha(appCode) },
  importPackage: name,
  capabilities: { realApi: false, chatWrites: false, worldbookWrites: false },
  inputs,
};
await writeFile(resolve(output, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
console.log(
  JSON.stringify({
    candidate: T15_VERSION,
    output,
    importPackage: name,
    bundleBytes: manifest.bundle.bytes,
    sha256: manifest.bundle.sha256,
  }),
);
if (process.argv.includes('--serve')) {
  const server = createServer((req, res) => {
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; worker-src blob:; style-src 'unsafe-inline'; img-src data:; frame-src 'self'; connect-src 'none'; base-uri 'none'",
    );
    const path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
    if (path === '/') {
      res.setHeader('Content-Type', 'text/html;charset=utf-8');
      res.end(html);
    } else if (path === '/entry') {
      res.setHeader('Content-Type', 'text/html;charset=utf-8');
      res.end(entryHtml);
    } else if (path === '/index.js') {
      res.setHeader('Content-Type', 'text/javascript;charset=utf-8');
      res.end(bundle);
    } else if (path === '/preview.js') {
      res.setHeader('Content-Type', 'text/javascript;charset=utf-8');
      res.end(appCode);
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  server.listen(0, '127.0.0.1', () => {
    const a = server.address();
    if (a && typeof a !== 'string') console.log(`T15 isolated acceptance http://127.0.0.1:${a.port}/`);
  });
}
