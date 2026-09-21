import { getThemeById, type ThemeTokens } from './theme';
import { loadSettings } from '../settings';
import { setPermanentStyle } from './permanent-style';

const TOAST_STYLE_ID = 'acu-pp-toast-style';
const PROGRESS_HUD_STYLE_ID = 'acu-pp-progress-hud-style';

function buildToastCss(tokens: ThemeTokens): string {
  const t = tokens;
  return `
    #toast-container .acu-pp-toast.toast {
      font-family: ${t.fontUi} !important;
      font-weight: 500 !important;
      font-size: 14px !important;
      letter-spacing: 0.2px;
      background: ${t.bg1} !important;
      color: ${t.text1} !important;
      border: 1px solid ${t.border} !important;
      border-radius: ${t.radiusSm} !important;
      box-shadow: ${t.shadow} !important;
      padding: 12px 14px 12px 50px !important;
      width: min(420px, calc(100vw - 24px)) !important;
      opacity: 1 !important;
      position: relative !important;
      overflow: hidden !important;
      border-left: 3px solid ${t.text2} !important;
      background-image: none !important;
    }
    #toast-container .acu-pp-toast.toast .toast-title,
    #toast-container .acu-pp-toast.toast .toast-message {
      background: transparent !important;
      color: ${t.text1} !important;
      text-shadow: none !important;
      font-family: ${t.fontUi};
    }
    #toast-container .acu-pp-toast.toast .toast-title {
      font-weight: 650 !important;
      letter-spacing: 0.4px;
      margin-bottom: 4px !important;
    }
    #toast-container .acu-pp-toast.toast .toast-message {
      line-height: 1.55;
      font-weight: 500 !important;
      font-size: 13px !important;
    }
    #toast-container .acu-pp-toast.toast::before {
      content: "知" !important;
      position: absolute;
      left: 10px;
      top: 50%;
      transform: translateY(-50%);
      width: 26px;
      height: 26px;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 600;
      font-size: 12px;
      font-family: ${t.fontUi};
      color: ${t.onAccent};
      background: ${t.text2};
    }
    #toast-container .acu-pp-toast.acu-pp-toast--success { border-left-color: ${t.success} !important; }
    #toast-container .acu-pp-toast.acu-pp-toast--success::before { content: "达" !important; background: ${t.success}; }
    #toast-container .acu-pp-toast.acu-pp-toast--info { border-left-color: ${t.text2} !important; }
    #toast-container .acu-pp-toast.acu-pp-toast--info::before { content: "知" !important; background: ${t.text2}; }
    #toast-container .acu-pp-toast.acu-pp-toast--warning { border-left-color: ${t.warning} !important; }
    #toast-container .acu-pp-toast.acu-pp-toast--warning::before { content: "警" !important; background: ${t.warning}; }
    #toast-container .acu-pp-toast.acu-pp-toast--error { border-left-color: ${t.danger} !important; }
    #toast-container .acu-pp-toast.acu-pp-toast--error::before { content: "误" !important; background: ${t.danger}; }
    @media (max-width: 520px) {
      #toast-container .acu-pp-toast.toast {
        width: calc(100vw - 16px) !important;
        max-width: calc(100vw - 16px) !important;
        padding: 10px 12px 10px 42px !important;
      }
      #toast-container .acu-pp-toast.toast::before {
        left: 9px;
        width: 22px;
        height: 22px;
        font-size: 11px;
      }
    }
  `;
}

function buildProgressHudCss(tokens: ThemeTokens): string {
  const t = tokens;
  return `
    #acu-pp-progress-hud.acu-pp-progress-hud-root {
      position: fixed;
      top: calc(env(safe-area-inset-top, 0px) + 12px);
      right: calc(env(safe-area-inset-right, 0px) + 12px);
      z-index: 10030;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      width: max-content;
      max-width: min(280px, calc(100vw - 16px));
      pointer-events: none;
      cursor: grab;
      -webkit-user-select: none;
      user-select: none;
    }
    #acu-pp-progress-hud.acu-pp-progress-hud-root--placed {
      right: auto;
    }
    #acu-pp-progress-hud.acu-pp-progress-hud-root--dragging {
      cursor: grabbing;
      touch-action: none;
    }
    #acu-pp-progress-hud.acu-pp-progress-hud-root[aria-hidden="true"],
    #acu-pp-progress-hud.acu-pp-progress-hud-root:empty {
      display: none;
    }
    #acu-pp-progress-hud .acu-pp-progress-hud {
      font-family: ${t.fontUi};
      font-size: 13px;
      font-weight: 500;
      color: ${t.text1};
      background: ${t.bg1};
      border: 1px solid ${t.border};
      border-radius: ${t.radiusSm};
      box-shadow: ${t.shadow};
      padding: 6px 8px;
      pointer-events: auto;
      text-align: right;
      width: max-content;
      max-width: min(280px, calc(100vw - 16px));
      cursor: inherit;
    }
    #acu-pp-progress-hud .acu-pp-progress-hud__head {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      flex-wrap: nowrap;
      gap: 0;
      min-width: 0;
    }
    #acu-pp-progress-hud .acu-pp-progress-hud__title {
      flex: 0 1 auto;
      max-width: 12em;
      min-width: 0;
      font-weight: 600;
      font-size: 13px;
      line-height: 1.25;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      color: ${t.text1};
    }
    #acu-pp-progress-hud .acu-pp-progress-hud__actions {
      display: inline-flex;
      align-items: center;
      flex-shrink: 0;
      gap: 0;
      margin-left: 4px;
    }
    #acu-pp-progress-hud .acu-pp-progress-hud__count {
      font-size: 12px;
      font-weight: 600;
      color: ${t.text2};
      font-variant-numeric: tabular-nums;
      line-height: 1.25;
    }
    #acu-pp-progress-hud .acu-pp-progress-hud__count + .acu-pp-progress-hud__stop {
      margin-left: 4px;
    }
    #acu-pp-progress-hud .acu-pp-progress-hud__stop {
      flex-shrink: 0;
      padding: 2px 8px;
      border-radius: ${t.radiusSm};
      border: 1px solid ${t.accent};
      background: transparent;
      color: ${t.text1};
      font-weight: 600;
      font-family: ${t.fontUi};
      font-size: 12px;
      cursor: pointer;
      line-height: 1.25;
      touch-action: manipulation;
    }
    #acu-pp-progress-hud .acu-pp-progress-hud__stop:hover:not(:disabled) {
      background: ${t.accent};
      color: ${t.onAccent};
    }
    #acu-pp-progress-hud .acu-pp-progress-hud__stop:disabled {
      opacity: 0.55;
      cursor: not-allowed;
    }
    #acu-pp-progress-hud .acu-pp-progress-hud__bar {
      margin-top: 4px;
      height: 2px;
      border-radius: 999px;
      background: ${t.border};
      overflow: hidden;
    }
    #acu-pp-progress-hud .acu-pp-progress-hud__bar > i {
      display: block;
      height: 100%;
      border-radius: inherit;
      background: ${t.accent};
      transition: width 0.2s ease;
    }
    #acu-pp-progress-hud .acu-pp-progress-hud__list {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      align-items: center;
      gap: 4px 8px;
      margin: 4px 0 0;
      padding: 0;
      list-style: none;
      max-height: min(40vh, 220px);
      overflow-y: auto;
      overflow-x: hidden;
      text-align: right;
      scrollbar-width: thin;
      touch-action: pan-y;
    }
    #acu-pp-progress-hud .acu-pp-progress-hud__item {
      display: inline-flex;
      align-items: center;
      gap: 2px;
      flex: 0 1 auto;
      max-width: 100%;
      min-width: 0;
      font-size: 12px;
      line-height: 1.35;
      color: ${t.text2};
      white-space: nowrap;
      overflow: hidden;
      transition: opacity 0.25s ease, max-width 0.25s ease, margin 0.25s ease, padding 0.25s ease;
    }
    #acu-pp-progress-hud .acu-pp-progress-hud__sym {
      flex-shrink: 0;
    }
    #acu-pp-progress-hud .acu-pp-progress-hud__name {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    #acu-pp-progress-hud .acu-pp-progress-hud__item--running,
    #acu-pp-progress-hud .acu-pp-progress-hud__active.acu-pp-progress-hud__item--running {
      color: ${t.text1};
      font-weight: 600;
    }
    #acu-pp-progress-hud .acu-pp-progress-hud__item--done {
      color: ${t.success};
      font-weight: 600;
    }
    #acu-pp-progress-hud .acu-pp-progress-hud__item--failed {
      color: ${t.danger};
      font-weight: 600;
    }
    #acu-pp-progress-hud .acu-pp-progress-hud__item--leaving {
      opacity: 0;
      max-width: 0;
      margin: 0;
      padding: 0;
      overflow: hidden;
      pointer-events: none;
    }
    #acu-pp-progress-hud .acu-pp-progress-hud__detail {
      font-weight: 400;
      color: ${t.text3};
      flex-shrink: 0;
    }
    #acu-pp-progress-hud .acu-pp-progress-hud__active {
      margin-top: 4px;
      font-size: 12px;
      line-height: 1.25;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      color: ${t.text1};
      text-align: right;
    }
    #acu-pp-progress-hud .acu-pp-progress-hud__active + .acu-pp-progress-hud__active {
      margin-top: 2px;
    }
    @media (max-width: 640px) {
      #acu-pp-progress-hud.acu-pp-progress-hud-root {
        top: calc(env(safe-area-inset-top, 0px) + 8px);
        right: calc(env(safe-area-inset-right, 0px) + 8px);
        max-width: min(280px, calc(100vw - 16px));
      }
      #acu-pp-progress-hud .acu-pp-progress-hud {
        background: color-mix(in srgb, ${t.bg1} 88%, transparent);
        border: 1px solid color-mix(in srgb, ${t.border} 70%, transparent);
        box-shadow: 0 2px 12px rgba(0, 0, 0, 0.18);
        padding: 6px 8px;
        border-radius: ${t.radiusSm};
        font-size: 12px;
        text-shadow: none;
      }
      #acu-pp-progress-hud .acu-pp-progress-hud__title {
        font-size: 12px;
        max-width: 10em;
      }
      #acu-pp-progress-hud .acu-pp-progress-hud__bar {
        display: block;
        height: 2px;
      }
      #acu-pp-progress-hud .acu-pp-progress-hud__stop {
        min-height: auto;
        padding: 2px 6px;
        border: 1px solid color-mix(in srgb, ${t.accent} 55%, transparent);
        background: transparent;
        color: ${t.accent};
        text-decoration: none;
      }
      #acu-pp-progress-hud .acu-pp-progress-hud__stop:hover:not(:disabled) {
        background: color-mix(in srgb, ${t.accent} 18%, transparent);
        color: ${t.accent};
        opacity: 1;
      }
      #acu-pp-progress-hud .acu-pp-progress-hud__item {
        font-size: 11px;
        line-height: 1.3;
      }
      #acu-pp-progress-hud .acu-pp-progress-hud__list {
        margin-top: 4px;
        max-height: min(36vh, 200px);
        padding: 4px 0 2px;
        background: color-mix(in srgb, ${t.bg0} 55%, transparent);
        border-radius: 4px;
      }
    }
  `;
}

/** 注入独立 toast 样式（head 直接子 style，不被 teleportStyle 克隆） */
export function ensureAcuToastStyles(themeId?: string): void {
  document.getElementById('acu-pp-permanent-style-host')?.remove();
  const theme = getThemeById(themeId ?? loadSettings().uiThemeId);
  setPermanentStyle(TOAST_STYLE_ID, buildToastCss(theme.tokens));
  setPermanentStyle(PROGRESS_HUD_STYLE_ID, buildProgressHudCss(theme.tokens));
}

export function refreshVisibleAcuToasts(themeId?: string): void {
  ensureAcuToastStyles(themeId);
}
