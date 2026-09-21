/**
 * TauriTavern / Luker 等非原版宿主可能提供未注入 Vue 特性标志的全局 Vue。
 * 裸标识符 `__VUE_PROD_DEVTOOLS__` 未定义时，createApp 会抛 ReferenceError。
 * 在打开任何 Vue UI 前补齐 globalThis 上的标志（浏览器会把裸标识符解析到全局对象）。
 */
export { ensureVueFeatureFlags } from '@util/vue-feature-flags';
