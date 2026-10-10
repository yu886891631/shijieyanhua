import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { parse, compileScript, compileStyle } from 'vue/compiler-sfc';
import { T14_DEFAULT, T14_PALETTES, T14_THEMES, normalizeT14Appearance, styleT14Appearance } from './t14-appearance';
function luminance(hex: string) {
  const rgb = hex
    .slice(1)
    .match(/../g)!
    .map(v => parseInt(v, 16) / 255)
    .map(v => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}
function contrast(a: string, b: string) {
  const x = luminance(a),
    y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
for (const theme of T14_THEMES)
  test(`T14 ${theme.id}: semantic text >=4.5 and focus/control boundaries >=3`, () => {
    const p = T14_PALETTES[theme.id];
    for (const [foreground, background] of [
      [p.text, p.surface],
      [p.text, p.card],
      [p.text, p.control],
      [p.muted, p.surface],
      [p.muted, p.card],
      [p.onAccent, p.accent],
      [p.successText, p.successBg],
      [p.warningText, p.warningBg],
      [p.dangerText, p.dangerBg],
    ])
      assert.ok(
        contrast(foreground, background) >= 4.5,
        `${foreground}/${background} ${contrast(foreground, background)}`,
      );
    for (const bg of [p.surface, p.card, p.control]) {
      assert.ok(contrast(p.focus, bg) >= 3);
      assert.ok(contrast(p.border, bg) >= 3, `${theme.id} border ${contrast(p.border, bg)}`);
    }
    assert.ok(contrast(p.dangerBorder, p.dangerBg) >= 3);
    assert.ok(contrast(p.warningBorder, p.warningBg) >= 3);
  });
for (const value of [
  null,
  [],
  {},
  { ...T14_DEFAULT, scale: 200 },
  { ...T14_DEFAULT, theme: 'evil' },
  { ...T14_DEFAULT, text: 'script' },
  { ...T14_DEFAULT, extra: true },
])
  test(`T14 rejects invalid appearance ${JSON.stringify(value)}`, () =>
    assert.throws(() => normalizeT14Appearance(value)));
test('T14 copied preferences are instance-local; old API tokens use same palette, never second settings authority', () => {
  const copy = normalizeT14Appearance(T14_DEFAULT);
  copy.theme = 'dark';
  assert.equal(T14_DEFAULT.theme, 'light');
  for (const scale of [100, 110, 125] as const) {
    const s = styleT14Appearance({ ...copy, scale });
    assert.equal(s['--we14-font-size'], `${(14 * scale) / 100}px`);
    assert.equal(s['--we-danger-text'], 'var(--we14-danger-text)');
    assert.equal(s['--we-action-text'], 'var(--we14-on-accent)');
  }
});
const components = [
  'T5TableWorkbench',
  'T6TemplateWorkbench',
  'T6CellSetting',
  'T6ParameterForm',
  'T6WorldWorkbench',
  'T7PromptWorkbench',
  'T7WorldWorkbench',
  'T8MacroWorkbench',
  'T8WorldWorkbench',
  'T9RoundWorkbench',
  'T9WorldWorkbench',
  'T10RecoveryWorkbench',
  'T11DailyWorkbench',
  'T12ProjectionWorkbench',
  'T13BackupWorkbench',
];
test('T14 all 15 functional components have inherited semantic colors and standalone fallbacks; scoped CSS compiles', () => {
  for (const name of components) {
    const file = resolve(`src/世界演变/rebuild/${name}.vue`),
      { descriptor, errors } = parse(readFileSync(file, 'utf8'), { filename: file });
    assert.deepEqual(errors, []);
    const css = descriptor.styles[0];
    assert.equal(css.scoped, true);
    assert.deepEqual(
      compileStyle({ filename: file, source: css.content, id: 'data-v-color', scoped: true }).errors,
      [],
    );
    assert.match(css.content, /var\(--we14-text,/);
    assert.match(css.content, /var\(--we14-(?:focus|accent),/);
    for (const line of css.content.split('\n').filter(l => /#[0-9a-f]{3,8}/i.test(l)))
      assert.match(line, /var\(--we14-/);
  }
});
test('T14 shell contains no storage/transport/host imports, global selector, position-based frame or CSS zoom', () => {
  const file = resolve('src/世界演变/rebuild/T14Workspace.vue'),
    source = readFileSync(file, 'utf8'),
    { descriptor, errors } = parse(source, { filename: file });
  assert.deepEqual(errors, []);
  const compiled = compileScript(descriptor, { id: 'data-v-shell', inlineTemplate: true });
  assert.ok(compiled.content);
  assert.doesNotMatch(
    source,
    /v-html|innerHTML|fetch\(|localStorage|indexedDB|replaceVariables|prepareSql|\.save\(|\.cancel\(/,
  );
  assert.doesNotMatch(descriptor.styles[0].content, /:global|position:\s*(absolute|fixed)|\b100v[wh]|\bzoom:/);
  for (const text of [
    '@container we14',
    'minmax(0, 1fr)',
    'prefers-reduced-motion',
    'forced-colors',
    ':focus-visible',
    'overscroll-behavior',
    "'local'",
  ])
    assert.ok(source.includes(text));
  assert.match(source, /v-show="current === link.id"/);
  assert.doesNotMatch(source, /v-if="current === link.id"/);
  assert.match(
    descriptor.styles[0].content,
    /\.we14-danger,\s*\.we-t14 button\.we14-danger\s*\{\s*color: var\(--we14-danger-text\);\s*background: var\(--we14-danger-bg\);/,
  );
});
test('T14 isolated browser harness cannot access external networks; API substitution applies ONLY to existing SFC importer', () => {
  const source = readFileSync(resolve('src/世界演变/rebuild/t14-visual-server.mts'), 'utf8');
  assert.match(source, /connect-src 'self'/);
  assert.match(source, /args\.importer\.endsWith\('ApiSettingsPanel.vue'\)/);
  assert.match(source, /write: false/);
  assert.match(source, /createHash\('sha256'\)\.update\(args.path\)/);
  assert.doesNotMatch(source, /Buffer.from\(args.path\).*slice\(-/);
  assert.match(source, /meta name="t14-build"/);
  assert.match(source, /server.listen\(0, '127.0.0.1'/);
  assert.doesNotMatch(source, /writeFile|dist\/|TavernHelper|indexedDB/);
});
