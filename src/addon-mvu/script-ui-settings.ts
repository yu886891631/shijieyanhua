export type AddonConsoleTheme = 'light' | 'dark';

export const ADDON_CONSOLE_THEME_KEY = 'addon_console_theme';

function readScriptVars(): Record<string, unknown> {
  try {
    return (getVariables({ type: 'script', script_id: getScriptId() }) as Record<string, unknown>) ?? {};
  } catch {
    return {};
  }
}

function writeScriptVar(key: string, value: unknown): void {
  insertOrAssignVariables({ [key]: value }, { type: 'script', script_id: getScriptId() });
}

export function getConsoleTheme(): AddonConsoleTheme {
  const raw = readScriptVars()[ADDON_CONSOLE_THEME_KEY];
  return raw === 'dark' ? 'dark' : 'light';
}

export function setConsoleTheme(theme: AddonConsoleTheme): AddonConsoleTheme {
  const next = theme === 'dark' ? 'dark' : 'light';
  writeScriptVar(ADDON_CONSOLE_THEME_KEY, next);
  return next;
}
