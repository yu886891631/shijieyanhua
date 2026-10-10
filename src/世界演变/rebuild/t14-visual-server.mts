/* eslint-disable import-x/no-nodejs-modules -- Explicit Node-only developer server, not a browser/plugin entry. */
/** Node-only, explicitly launched, loopback-only in-memory visual server. No production build/output. */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { parse, compileScript, compileStyleAsync } from 'vue/compiler-sfc';
import { createT14VisualViews } from './t14-visual-fixtures';
const require = createRequire(import.meta.url);
interface T14Builder {
  onResolve(
    options: { filter: RegExp },
    callback: (args: { importer: string; path: string }) => { path: string } | undefined,
  ): void;
  onLoad(
    options: { filter: RegExp },
    callback: (args: { path: string }) => Promise<{ contents: string; loader: string; resolveDir: string }>,
  ): void;
}
const { build } = createRequire(require.resolve('tsx'))('esbuild') as {
  build: (options: unknown) => Promise<{ outputFiles: { contents: Uint8Array }[] }>;
};
const root = resolve('src/世界演变/rebuild');
const result = await build({
  entryPoints: [resolve(root, 't14-visual-browser.ts')],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  plugins: [
    {
      name: 't14-isolated-vue',
      setup(builder: T14Builder) {
        builder.onResolve({ filter: /^\.\.\/(store|api-config|api-client|api-routing|types)$/ }, args => {
          if (args.importer.endsWith('ApiSettingsPanel.vue'))
            return { path: resolve(root, 't14-visual-api-fixture.ts') };
          return undefined;
        });
        builder.onLoad({ filter: /\.vue$/ }, async args => {
          const source = await readFile(args.path, 'utf8'),
            { descriptor, errors } = parse(source, { filename: args.path });
          if (errors.length) throw errors[0];
          const id = 'data-v-t14-' + createHash('sha256').update(args.path).digest('hex').slice(0, 12);
          const script = compileScript(descriptor, { id, inlineTemplate: true });
          let contents = script.content;
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
          // compileScript normally exports _sfc_main directly; give it a stable binding for scope attributes.
          contents = contents.replace('export default ', 'const __default__ = ') + '\nexport default __default__;';
          return { contents, loader: 'ts', resolveDir: dirname(args.path) };
        });
      },
    },
  ],
});
const bundle = result.outputFiles[0].contents,
  fixture = JSON.stringify(await createT14VisualViews());
const buildFingerprint = createHash('sha256').update(bundle).digest('hex');
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="t14-build" content="${buildFingerprint}"><title>T14 世界演变 · 独立视觉验收</title><style>body{margin:0}#visual-root{min-width:0}</style><div id="visual-root"></div><script type="module" src="/visual.js"></script></html>`;
const server = createServer((req, res) => {
  const path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-src 'none'; base-uri 'none'",
  );
  if (path === '/fixture.json') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(fixture);
  } else if (path === '/visual.js') {
    res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
    res.end(bundle);
  } else if (path === '/') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(html);
  } else {
    res.writeHead(404);
    res.end();
  }
});
server.listen(0, '127.0.0.1', () => {
  const a = server.address();
  if (a && typeof a !== 'string')
    console.log(
      `T14 isolated visual harness http://127.0.0.1:${a.port}/ · ${bundle.length} bytes · no production files written`,
    );
});
