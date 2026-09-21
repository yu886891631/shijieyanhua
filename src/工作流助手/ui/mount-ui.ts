import { createApp, nextTick } from 'vue';
import { createPinia } from 'pinia';
import { createScriptIdDiv, teleportStyle } from '@util/script';
import SettingsWindow from './SettingsWindow.vue';
import { loadSettings } from '../settings';
import { applyThemeTokens, updateGlobalTheme } from './theme';
import { refreshVisibleAcuToasts } from './toast-styles';
import { acuToast } from './toast';
import { SCRIPT_LOG_PREFIX } from './brand';
import { ensureVueFeatureFlags } from './ensure-vue-feature-flags';
import './acu-theme.css';

let app: ReturnType<typeof createApp> | null = null;
let $root: JQuery<HTMLDivElement> | null = null;
let styleDestroy: (() => void) | null = null;

function syncTeleportedStyles(): void {
  styleDestroy?.();
  const { destroy } = teleportStyle();
  styleDestroy = destroy;
}

function isWindowVisible(): boolean {
  return Boolean($root?.length && $root[0].isConnected && $root.find('.acu-overlay').length);
}

export function openSettingsWindow(): void {
  if (isWindowVisible()) {
    return;
  }

  if ($root) {
    closeSettingsWindow();
  }

  ensureVueFeatureFlags();

  try {
    app = createApp(SettingsWindow);
    app.use(createPinia());
    app.provide('closeSettings', closeSettingsWindow);
    app.config.errorHandler = (err, _instance, info) => {
      console.error(`${SCRIPT_LOG_PREFIX} 设置界面渲染失败:`, err, info);
      acuToast('error', `设置界面错误: ${err instanceof Error ? err.message : String(err)}`);
      closeSettingsWindow();
    };

    $root = createScriptIdDiv()
      .addClass('acu-pp-root')
      .css({
        // 不用 inset/height:100%：ST html 有 transform 时 fixed 相对 html，矮屏 html 高度可为 0
        position: 'fixed',
        top: '0',
        left: '0',
        width: '100vw',
        height: '100vh',
        zIndex: '10040',
        pointerEvents: 'auto',
      });
    // dvh 优先（支持时覆盖 vh），避免移动端浏览器工具栏导致可视高度偏差
    $root[0].style.setProperty('height', '100dvh');
    $root.appendTo('body');

    const uiThemeId = loadSettings().uiThemeId;
    updateGlobalTheme(uiThemeId);
    applyThemeTokens($root[0], uiThemeId);

    app.mount($root[0]);

    void nextTick(() => {
      syncTeleportedStyles();

      if (!isWindowVisible()) {
        console.error(`${SCRIPT_LOG_PREFIX} 设置界面挂载后未渲染内容`);
        acuToast('error', `设置界面未能渲染，请查看控制台 ${SCRIPT_LOG_PREFIX} 日志`);
        closeSettingsWindow();
      }
    });
  } catch (err) {
    console.error(`${SCRIPT_LOG_PREFIX} 设置界面挂载失败:`, err);
    acuToast('error', `设置界面挂载失败: ${err instanceof Error ? err.message : String(err)}`);
    closeSettingsWindow();
  }
}

export function closeSettingsWindow(): void {
  if (app) {
    try {
      app.unmount();
    } catch {
      /* ignore */
    }
    app = null;
  }
  styleDestroy?.();
  styleDestroy = null;
  $root?.remove();
  $root = null;

  // 设置窗卸载后刷新独立 toast 主题，避免进度条 toast 回落到数据库本体 acu-toast 样式
  const uiThemeId = loadSettings().uiThemeId;
  updateGlobalTheme(uiThemeId);
  refreshVisibleAcuToasts(uiThemeId);
}
