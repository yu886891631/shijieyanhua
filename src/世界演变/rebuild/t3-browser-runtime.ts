import initSqlJs, { type SqlJsStatic } from 'sql.js';
import bundledWasm from 'sql.js/dist/sql-wasm-browser.wasm?inline';

export const T3_SQLJS_VERSION = '1.14.2';
export const T3_WASM_BYTES = 658_410;
export const T3_WASM_SHA256 = '38c14f6e379210bc942bdc4ebca44e7bfdb4318ecc1c72ca666a28fdce96670a';

/** No URL loading or missing-asset fallback: the fixed WASM must be inside this bundle. */
export function decodeT3InlineWasm(asset: string): Uint8Array<ArrayBuffer> {
  if (typeof asset !== 'string' || !asset.startsWith('data:application/wasm;base64,')) {
    throw new Error('缺少内嵌 SQLite WASM，不允许从网络补载。');
  }
  const encoded = asset.slice('data:application/wasm;base64,'.length);
  if (encoded.length !== Math.ceil(T3_WASM_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw new Error('内嵌 SQLite WASM 长度或编码不符合固定版本。');
  }
  const decoded = atob(encoded);
  const bytes = Uint8Array.from(decoded, character => character.charCodeAt(0));
  if (
    bytes.length !== T3_WASM_BYTES ||
    bytes[0] !== 0 ||
    bytes[1] !== 0x61 ||
    bytes[2] !== 0x73 ||
    bytes[3] !== 0x6d ||
    bytes[4] !== 1 ||
    bytes[5] !== 0 ||
    bytes[6] !== 0 ||
    bytes[7] !== 0 ||
    !WebAssembly.validate(bytes)
  ) {
    throw new Error('内嵌 SQLite WASM 无效，拒绝启动。');
  }
  return bytes;
}

export async function createT3BrowserRuntime(): Promise<SqlJsStatic> {
  const bytes = decodeT3InlineWasm(bundledWasm);
  if (!globalThis.crypto?.subtle) throw new Error('当前 Worker 无法校验 SQLite WASM 指纹，拒绝启动。');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  const fingerprint = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  if (fingerprint !== T3_WASM_SHA256) throw new Error('SQLite WASM 指纹不符合固定版本，拒绝启动。');
  // wasmBinary prevents sql.js from fetching a wasm path. The fixed package is bundled by the worker build.
  return initSqlJs({ wasmBinary: bytes.buffer, locateFile: () => 'world-evolution-inline-only.wasm' });
}
