import fs from 'fs';
import path from 'path';

const dir = path.resolve('src/addon-console/assets/tarot');
const names = fs
  .readdirSync(dir)
  .filter(f => f.endsWith('.png'))
  .map(f => f.slice(0, -4))
  .sort((a, b) => a.localeCompare(b, 'zh'));

const lines = [
  'export type TarotParsed = { name: string; reversed: boolean };',
  '',
  'const TAROT_SRC: Record<string, string> = {',
  ...names.map(n => `  '${n}': require('./assets/tarot/${n}.png?url'),`),
  '};',
  '',
  'export function tarotSrc(name: string): string | undefined {',
  '  return TAROT_SRC[name];',
  '}',
  '',
  '/** 解析发展层/细节层牌名串，如 `魔术师(逆位)、命运之轮、女皇` */',
  'export function parseTarotList(text: string): TarotParsed[] {',
  "  const raw = (text ?? '').trim();",
  '  if (!raw) return [];',
  '  return raw',
  '    .split(/[、,，]/)',
  '    .map(part => part.trim())',
  '    .filter(Boolean)',
  '    .map(part => {',
  '      const reversed = /\\(逆位\\)$/.test(part);',
  "      const name = part.replace(/\\(逆位\\)$/, '').trim();",
  '      return { name, reversed };',
  '    })',
  '    .filter(c => c.name);',
  '}',
  '',
];

fs.writeFileSync(path.resolve('src/addon-console/tarot.ts'), lines.join('\n'), 'utf8');
console.log('wrote', names.length, 'entries');
