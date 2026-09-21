/**
 * CDN / 外部 Vue 会读取裸标识符 `__VUE_PROD_DEVTOOLS__` 等。
 * 未定义时 createApp 抛 ReferenceError（真机浏览器无 Vue DevTools 扩展时常见）。
 * 在打开任何 Vue UI 前补齐 globalThis 上的标志。
 */
export function ensureVueFeatureFlags(target?: typeof globalThis): void {
  const g = (target ?? globalThis) as typeof globalThis & Record<string, unknown>;
  if (typeof g.__VUE_OPTIONS_API__ === 'undefined') {
    g.__VUE_OPTIONS_API__ = true;
  }
  if (typeof g.__VUE_PROD_DEVTOOLS__ === 'undefined') {
    g.__VUE_PROD_DEVTOOLS__ = false;
  }
  if (typeof g.__VUE_PROD_HYDRATION_MISMATCH_DETAILS__ === 'undefined') {
    g.__VUE_PROD_HYDRATION_MISMATCH_DETAILS__ = false;
  }
}
