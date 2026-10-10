/* eslint-disable import-x/no-nodejs-modules -- Explicit Node-only, write:false browser build verification. */
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { dirname, relative } from 'node:path';
import { parse, compileScript, compileStyleAsync } from 'vue/compiler-sfc';
const require = createRequire(import.meta.url),
  { build } = createRequire(require.resolve('tsx'))('esbuild');
const result = await build({
  bundle: true,
  write: false,
  outdir: 't15-memory-build-only',
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  metafile: true,
  define: { 'process.env.NODE_ENV': '"production"' },
  // The source signal factory is explicit and independent of the workspace factory's injected monitor.
  entryPoints: [
    'src/世界演变/rebuild/t15-native-workspace.ts',
    'src/世界演变/rebuild/t15-host-mount.ts',
    'src/世界演变/rebuild/t15-source-signals.ts',
  ],
  plugins: [
    {
      name: 'host-vue-smoke',
      setup(builder: any) {
        builder.onLoad({ filter: /\.vue$/ }, async (args: any) => {
          const source = await readFile(args.path, 'utf8'),
            { descriptor, errors } = parse(source, { filename: args.path });
          if (errors.length) throw errors[0];
          const id =
            'data-v-host-' + createHash('sha256').update(relative(process.cwd(), args.path)).digest('hex').slice(0, 12);
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
const inputs = Object.keys(result.metafile.inputs);
if (inputs.some(p => p.includes('test-fixtures') || /node:/.test(p))) throw new Error('浏览器入口包含测试/Node 依赖');
process.stdout.write(
  JSON.stringify({
    write: false,
    bytes: result.outputFiles.map((f: any) => f.contents.byteLength),
    vueInputs: inputs.filter(p => p.endsWith('.vue')).length,
    inputs: inputs.length,
  }) + '\n',
);
