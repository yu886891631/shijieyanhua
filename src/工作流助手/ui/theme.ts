export type ThemeColorScheme = 'light' | 'dark';

export type ThemeTokens = {
  bg0: string;
  bg1: string;
  bg2: string;
  sidebarBg: string;
  hoverOverlay: string;
  border: string;
  border2: string;
  text1: string;
  text2: string;
  text3: string;
  accent: string;
  accent2: string;
  onAccent: string;
  accentGlow: string;
  success: string;
  warning: string;
  danger: string;
  fontUi: string;
  fontMono: string;
  radiusLg: string;
  radiusMd: string;
  radiusSm: string;
  shadow: string;
};

export interface AcuTheme {
  id: string;
  name: string;
  colorScheme: ThemeColorScheme;
  tokens: ThemeTokens;
  extraVars?: Record<string, string>;
}

export const THEME_CREAMY_MINIMAL: AcuTheme = {
  id: 'creamy-minimal',
  name: '奶油风',
  colorScheme: 'light',
  tokens: {
    bg0: '#F7F0E6',
    bg1: '#FCF8F1',
    bg2: '#EFE4D7',
    sidebarBg: '#F6ECDD',
    hoverOverlay: 'rgba(116, 91, 62, 0.08)',
    border: 'rgba(116, 91, 62, 0.12)',
    border2: 'rgba(116, 91, 62, 0.18)',
    text1: '#514638',
    text2: '#735F4A',
    text3: '#9A8268',
    accent: '#85A76A',
    accent2: '#738F5B',
    onAccent: '#FCF8F1',
    accentGlow: 'rgba(133, 167, 106, 0.24)',
    success: '#7F9B69',
    warning: '#AA8050',
    danger: '#A76561',
    fontUi: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
    fontMono: 'Consolas, Menlo, Monaco, "Courier New", monospace',
    radiusLg: '18px',
    radiusMd: '16px',
    radiusSm: '12px',
    shadow: '0 8px 24px rgba(92, 70, 44, 0.10)',
  },
  extraVars: {
    '--acu-overlay-bg': 'rgba(81, 70, 56, 0.22)',
    '--acu-overlay-backdrop-blur': '4px',
  },
};

export const THEME_DEFAULT_DARK: AcuTheme = {
  id: 'default-dark',
  name: '深色',
  colorScheme: 'dark',
  tokens: {
    bg0: '#1F2428',
    bg1: '#24292E',
    bg2: '#2D343B',
    sidebarBg: '#1F2428',
    hoverOverlay: 'rgba(201, 209, 217, 0.08)',
    border: 'rgba(205, 217, 229, 0.08)',
    border2: 'rgba(205, 217, 229, 0.14)',
    text1: '#F0F3F6',
    text2: '#C9D1D9',
    text3: '#8B949E',
    accent: '#7FD6CA',
    accent2: '#69C7BC',
    onAccent: '#1F2428',
    accentGlow: 'rgba(127, 214, 202, 0.26)',
    success: '#8DBA9A',
    warning: '#C9A35E',
    danger: '#D07A74',
    fontUi: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
    fontMono: 'Consolas, Menlo, Monaco, "Courier New", monospace',
    radiusLg: '18px',
    radiusMd: '16px',
    radiusSm: '12px',
    shadow: '0 18px 48px rgba(1, 4, 9, 0.36)',
  },
  extraVars: {
    '--acu-overlay-bg': 'rgba(0, 0, 0, 0.52)',
    '--acu-overlay-backdrop-blur': '4px',
  },
};

export const BUILTIN_UI_THEMES: AcuTheme[] = [THEME_CREAMY_MINIMAL, THEME_DEFAULT_DARK];

export const DEFAULT_UI_THEME_ID = THEME_CREAMY_MINIMAL.id;

const TOKEN_VAR_MAP: Record<keyof ThemeTokens, string> = {
  bg0: '--acu-bg-0',
  bg1: '--acu-bg-1',
  bg2: '--acu-bg-2',
  sidebarBg: '--acu-sidebar-bg',
  hoverOverlay: '--acu-hover-overlay',
  border: '--acu-border',
  border2: '--acu-border-2',
  text1: '--acu-text-1',
  text2: '--acu-text-2',
  text3: '--acu-text-3',
  accent: '--acu-accent',
  accent2: '--acu-accent-2',
  onAccent: '--acu-on-accent',
  accentGlow: '--acu-accent-glow',
  success: '--acu-success',
  warning: '--acu-warning',
  danger: '--acu-danger',
  fontUi: '--acu-font-ui',
  fontMono: '--acu-font-mono',
  radiusLg: '--acu-radius-lg',
  radiusMd: '--acu-radius-md',
  radiusSm: '--acu-radius-sm',
  shadow: '--acu-shadow',
};

const SHARED_EXTRA_VARS: Record<string, string> = {
  '--acu-font-size-caption': '11px',
  '--acu-font-size-body': '12px',
  '--acu-font-size-body-lg': '13px',
  '--acu-font-size-panel-title': '15px',
  '--acu-line-height-body': '1.45',
};

import { setPermanentStyle } from './permanent-style';

const GLOBAL_THEME_STYLE_ID = 'acu-pp-global-theme';

export function getThemeById(themeId?: string): AcuTheme {
  const id = String(themeId || '').trim();
  return BUILTIN_UI_THEMES.find(t => t.id === id) ?? THEME_CREAMY_MINIMAL;
}

function buildThemeVarLines(theme: AcuTheme): string[] {
  const lines = Object.entries(TOKEN_VAR_MAP).map(
    ([key, varName]) => `  ${varName}: ${theme.tokens[key as keyof ThemeTokens]};`,
  );
  for (const [name, value] of Object.entries(SHARED_EXTRA_VARS)) {
    lines.push(`  ${name}: ${value};`);
  }
  for (const [name, value] of Object.entries(theme.extraVars ?? {})) {
    lines.push(`  ${name}: ${value};`);
  }
  lines.push(`  color-scheme: ${theme.colorScheme};`);
  return lines;
}

function buildThemeCss(theme: AcuTheme, selector: string): string {
  return `${selector} {\n${buildThemeVarLines(theme).join('\n')}\n}`;
}

export function applyThemeTokens(target: HTMLElement, themeId?: string): void {
  const theme = getThemeById(themeId);
  for (const [key, varName] of Object.entries(TOKEN_VAR_MAP) as [keyof ThemeTokens, string][]) {
    target.style.setProperty(varName, theme.tokens[key]);
  }
  for (const [name, value] of Object.entries(SHARED_EXTRA_VARS)) {
    target.style.setProperty(name, value);
  }
  for (const [name, value] of Object.entries(theme.extraVars ?? {})) {
    target.style.setProperty(name, value);
  }
  target.style.colorScheme = theme.colorScheme;
}

export function updateGlobalTheme(themeId?: string): void {
  document.getElementById('acu-pp-permanent-style-host')?.remove();
  const theme = getThemeById(themeId);
  // 仅作用于本脚本 UI 根节点，勿写入 :root，避免切换主题时影响酒馆主界面背景/配色
  setPermanentStyle(GLOBAL_THEME_STYLE_ID, buildThemeCss(theme, '.acu-pp-root'));
}

/** @deprecated 使用 updateGlobalTheme */
export function ensureGlobalThemeStyle(): void {
  updateGlobalTheme(DEFAULT_UI_THEME_ID);
}
