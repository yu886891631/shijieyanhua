/** Display-only, instance-local preferences. No storage, credentials, host or business writes. */
export const T14_BUILD = 'T14-local-visual-1';
export const T14_THEMES = [
  { id: 'light', name: '浅色 · 淡绿' },
  { id: 'cream', name: '奶油风' },
  { id: 'landmine', name: '地雷色 · 淡粉' },
  { id: 'dark', name: '深色' },
] as const;
export type T14Theme = (typeof T14_THEMES)[number]['id'];
export interface T14Appearance {
  theme: T14Theme;
  scale: 100 | 110 | 125;
  density: 'comfortable' | 'compact';
  text: 'wrap' | 'bounded';
}
export const T14_DEFAULT: Readonly<T14Appearance> = Object.freeze({
  theme: 'light',
  scale: 100,
  density: 'comfortable',
  text: 'bounded',
});
export const T14_PALETTES = {
  light: {
    surface: '#f1f8ef',
    card: '#fbfdfa',
    control: '#ffffff',
    text: '#294734',
    muted: '#516752',
    border: '#6f8b73',
    accent: '#315e40',
    onAccent: '#ffffff',
    soft: '#e4eee1',
    successBg: '#e7f1e3',
    successText: '#315e40',
    warningBg: '#faf3df',
    warningText: '#72501f',
    warningBorder: '#967539',
    dangerBg: '#fff0f3',
    dangerText: '#853c52',
    dangerBorder: '#b56780',
    focus: '#315e40',
  },
  cream: {
    surface: '#f8f6eb',
    card: '#fffdf6',
    control: '#fffefa',
    text: '#3e4835',
    muted: '#62684f',
    border: '#89886b',
    accent: '#41613a',
    onAccent: '#ffffff',
    soft: '#eeefdc',
    successBg: '#e7f1e3',
    successText: '#315e40',
    warningBg: '#faf3df',
    warningText: '#72501f',
    warningBorder: '#967539',
    dangerBg: '#fff0f3',
    dangerText: '#853c52',
    dangerBorder: '#b56780',
    focus: '#41613a',
  },
  landmine: {
    surface: '#fcf1f5',
    card: '#fffafd',
    control: '#ffffff',
    text: '#54364b',
    muted: '#75586a',
    border: '#a87991',
    accent: '#80445f',
    onAccent: '#ffffff',
    soft: '#f1e1e9',
    successBg: '#e7f1e3',
    successText: '#315e40',
    warningBg: '#faf3df',
    warningText: '#72501f',
    warningBorder: '#967539',
    dangerBg: '#ffe7ee',
    dangerText: '#803047',
    dangerBorder: '#b56780',
    focus: '#80445f',
  },
  dark: {
    surface: '#26372e',
    card: '#304339',
    control: '#354b3e',
    text: '#ecf5ed',
    muted: '#c2d5c6',
    border: '#94b39c',
    accent: '#bfdec5',
    onAccent: '#23372a',
    soft: '#3c5543',
    successBg: '#334d3b',
    successText: '#d1efd7',
    warningBg: '#514632',
    warningText: '#ffebbb',
    warningBorder: '#ddbd79',
    dangerBg: '#503740',
    dangerText: '#ffdae4',
    dangerBorder: '#e6a7bb',
    focus: '#bfdec5',
  },
} as const;
export function normalizeT14Appearance(input: unknown): T14Appearance {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('外观设置格式不正确');
  const v = input as Record<string, unknown>;
  if (
    Reflect.ownKeys(v).length !== 4 ||
    !T14_THEMES.some(t => t.id === v.theme) ||
    ![100, 110, 125].includes(v.scale as number) ||
    !['comfortable', 'compact'].includes(v.density as string) ||
    !['wrap', 'bounded'].includes(v.text as string)
  )
    throw new Error('不支持的主题、字号或显示方式');
  return {
    theme: v.theme as T14Theme,
    scale: v.scale as T14Appearance['scale'],
    density: v.density as T14Appearance['density'],
    text: v.text as T14Appearance['text'],
  };
}
export function styleT14Appearance(input: T14Appearance): Record<string, string> {
  const value = normalizeT14Appearance(input),
    colors = T14_PALETTES[value.theme];
  const result: Record<string, string> = {};
  for (const [key, color] of Object.entries(colors))
    result[`--we14-${key.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)}`] = color;
  result['--we14-font-size'] = `${(14 * value.scale) / 100}px`;
  result['--we14-space'] = value.density === 'compact' ? '10px' : '16px';
  result['--we14-cell-space'] = value.density === 'compact' ? '8px' : '12px';
  // Existing API view remains the sole editor; adapt its token names, not its storage or routes.
  const aliases: Record<string, string> = {
    surface: 'surface',
    'surface-soft': 'soft',
    input: 'control',
    text: 'text',
    muted: 'muted',
    border: 'border',
    accent: 'accent',
    tint: 'soft',
    'success-bg': 'success-bg',
    'success-text': 'success-text',
    'success-border': 'border',
    'warning-bg': 'warning-bg',
    'warning-text': 'warning-text',
    'warning-border': 'warning-border',
    'danger-bg': 'danger-bg',
    'danger-text': 'danger-text',
    'danger-border': 'danger-border',
    'action-bg': 'accent',
    'action-border': 'accent',
    'action-text': 'on-accent',
    'action-hover-bg': 'accent',
    'danger-action-bg': 'danger-bg',
    'danger-action-border': 'danger-border',
    'danger-action-text': 'danger-text',
  };
  for (const [key, target] of Object.entries(aliases)) result[`--we-${key}`] = `var(--we14-${target})`;
  return result;
}
