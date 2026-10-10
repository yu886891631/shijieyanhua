/* eslint-disable import-x/no-nodejs-modules -- Test-only in-memory webpack compiler, never part of a production entry. */
import { resolve } from 'node:path';
import webpackFactory, { type Stats } from 'webpack';

/** Test-only webpack. The output filesystem is a Map; this never writes a dist file. */
export async function compileT3BrowserTestBundle(entry: string): Promise<{ code: string; moduleNames: string[] }> {
  const files = new Map<string, Buffer>();
  const outputPath = resolve('t3-test-memory-output-not-created');
  const compiler = webpackFactory({
    mode: 'development',
    target: 'webworker',
    devtool: false,
    cache: false,
    entry: resolve(entry),
    output: {
      path: outputPath,
      filename: 'worker.js',
      library: { name: 'T3TestBundle', type: 'var' },
      globalObject: 'globalThis',
    },
    resolve: { extensions: ['.ts', '.js'], conditionNames: ['browser', 'import', 'module', 'default'] },
    module: {
      rules: [
        {
          test: /\.ts$/,
          exclude: /node_modules/,
          loader: 'ts-loader',
          options: {
            transpileOnly: true,
            onlyCompileBundledFiles: true,
            compilerOptions: { target: 'ES2022', module: 'ESNext' },
          },
        },
        {
          test: /\.wasm$/,
          resourceQuery: /inline/,
          type: 'asset/inline',
          generator: { dataUrl: { mimetype: 'application/wasm' } },
        },
      ],
    },
    optimization: { minimize: false },
  });
  compiler.outputFileSystem = {
    mkdir(_path: string, optionsOrCallback: unknown, callback?: (error?: Error | null) => void) {
      const done =
        typeof optionsOrCallback === 'function' ? (optionsOrCallback as (error?: Error | null) => void) : callback;
      done?.(null);
    },
    writeFile(path: string, content: string | Buffer, callback: (error?: Error | null) => void) {
      files.set(path, Buffer.isBuffer(content) ? content : Buffer.from(content));
      callback(null);
    },
    stat(path: string, callback: (error: Error | null, stat?: unknown) => void) {
      const bytes = files.get(path);
      if (bytes) callback(null, { size: bytes.length, isFile: () => true, isDirectory: () => false });
      else callback(Object.assign(new Error('in-memory file does not exist'), { code: 'ENOENT' }));
    },
  } as unknown as typeof compiler.outputFileSystem;
  try {
    const stats = await new Promise<Stats>((resolveStats, reject) => {
      compiler.run((error, result) => {
        if (error) reject(error);
        else if (!result || result.hasErrors())
          reject(new Error(result?.toString({ all: false, errors: true }) ?? 'No stats'));
        else resolveStats(result);
      });
    });
    const code = files.get(resolve(outputPath, 'worker.js'))?.toString('utf8');
    if (!code) throw new Error('Worker test bundle missing from memory output.');
    return {
      code,
      moduleNames: stats.toJson({ all: false, modules: true }).modules?.map(module => module.name ?? '') ?? [],
    };
  } finally {
    await new Promise<void>((resolveClose, reject) =>
      compiler.close(error => (error ? reject(error) : resolveClose())),
    );
  }
}
