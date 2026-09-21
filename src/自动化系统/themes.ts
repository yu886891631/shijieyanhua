export const THEME_IDS = ['dark', 'jade', 'parchment', 'fog', 'celadon', 'dusk'] as const;

export type ChronicleThemeId = (typeof THEME_IDS)[number];

export type ThemeOption = {
  id: ChronicleThemeId;
  label: string;
  swatch: string;
  icon: string;
};

export const THEME_OPTIONS: ThemeOption[] = [
  { id: 'dark', label: '暗夜紫', swatch: '#221c38', icon: '🌙' },
  { id: 'jade', label: '墨玉绿', swatch: '#1a2e28', icon: '🍃' },
  { id: 'parchment', label: '暖羊皮纸', swatch: '#f3efe6', icon: '📜' },
  { id: 'fog', label: '雾蓝档案', swatch: '#e8eef5', icon: '🌫️' },
  { id: 'celadon', label: '墨玉青瓷', swatch: '#e9efec', icon: '🪴' },
  { id: 'dusk', label: '暮霞石灰', swatch: '#f0ecea', icon: '🌹' },
];

const LIGHT_IDS: ReadonlySet<ChronicleThemeId> = new Set(['parchment', 'fog', 'celadon', 'dusk']);

const THEME_SET = new Set<string>(THEME_IDS);

export function normalizeThemeId(raw: string | null | undefined): ChronicleThemeId {
  if (raw === 'light') return 'parchment';
  if (raw && THEME_SET.has(raw)) return raw as ChronicleThemeId;
  return 'dark';
}

export function isLightTheme(id: ChronicleThemeId): boolean {
  return LIGHT_IDS.has(id);
}

export function themeOption(id: ChronicleThemeId): ThemeOption {
  return THEME_OPTIONS.find(o => o.id === id) ?? THEME_OPTIONS[0];
}
