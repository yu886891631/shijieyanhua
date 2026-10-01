import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const workspaceSource = readFileSync(new URL('./Workspace.vue', import.meta.url), 'utf8');
const databaseSource = readFileSync(new URL('../../世界演变数据库/ui.ts', import.meta.url), 'utf8');
const evolutionSource = readFileSync(new URL('../ui.ts', import.meta.url), 'utf8');
const apiSource = readFileSync(new URL('./ApiSettingsPanel.vue', import.meta.url), 'utf8');
const promptSource = readFileSync(new URL('./PromptWorkbench.vue', import.meta.url), 'utf8');

function getRuleBody(source: string, selector: string): string {
  const selectorIndex = source.indexOf(selector);
  assert.notEqual(selectorIndex, -1, `missing CSS selector: ${selector}`);
  const openingBrace = source.indexOf('{', selectorIndex);
  const closingBrace = source.indexOf('}', openingBrace);
  assert.ok(openingBrace > selectorIndex && closingBrace > openingBrace, `invalid CSS rule: ${selector}`);
  return source.slice(openingBrace + 1, closingBrace);
}

function getToken(block: string, token: string): string {
  const match = block.match(new RegExp(`${token}:\\s*(#[\\da-fA-F]{3,8})\\s*;`));
  assert.ok(match, `missing literal value for ${token}`);
  return match[1];
}

function linearize(channel: number): number {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const expanded = hex.length === 4 ? `#${[...hex.slice(1)].map(character => character.repeat(2)).join('')}` : hex;
  const value = Number.parseInt(expanded.slice(1), 16);
  return (
    0.2126 * linearize((value >> 16) & 0xff) +
    0.7152 * linearize((value >> 8) & 0xff) +
    0.0722 * linearize(value & 0xff)
  );
}

function contrastRatio(foreground: string, background: string): number {
  const values = [luminance(foreground), luminance(background)].sort((left, right) => right - left);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

test('each workspace theme defines readable semantic status and stat colors', () => {
  const themes = [
    { name: 'default cream', selector: '.we-workspace {', surface: '#fffdf8' },
    { name: 'light', selector: ".we-workspace[data-theme='light'] {", surface: '#fff' },
    { name: 'dark', selector: ".we-workspace[data-theme='dark'] {", surface: '#1b2635' },
    { name: 'cream', selector: ".we-workspace[data-theme='cream'] {", surface: '#fffdf8' },
    { name: 'landmine', selector: ".we-workspace[data-theme='landmine'] {", surface: '#fffafd' },
  ];
  const foregroundBackgroundTokens = [
    ['--we-info-text', '--we-info-bg'],
    ['--we-success-text', '--we-success-bg'],
    ['--we-warning-text', '--we-warning-bg'],
    ['--we-danger-text', '--we-danger-bg'],
    ['--we-danger-action-text', '--we-danger-action-bg'],
    ['--we-danger-action-text', '--we-danger-action-hover-bg'],
    ['--we-action-text', '--we-action-bg'],
    ['--we-action-text', '--we-action-hover-bg'],
  ] as const;
  const borderTokens = [
    '--we-info-border',
    '--we-success-border',
    '--we-warning-border',
    '--we-danger-border',
    '--we-danger-action-border',
    '--we-action-border',
  ] as const;

  for (const theme of themes) {
    const block = getRuleBody(workspaceSource, theme.selector);
    for (const borderToken of borderTokens) getToken(block, borderToken);
    for (const [foregroundToken, backgroundToken] of foregroundBackgroundTokens) {
      const ratio = contrastRatio(getToken(block, foregroundToken), getToken(block, backgroundToken));
      assert.ok(ratio >= 4.5, `${theme.name}: ${foregroundToken}/${backgroundToken} contrast is ${ratio.toFixed(2)}:1`);
    }

    const statRatio = contrastRatio(getToken(block, '--we-stat-accent'), theme.surface);
    assert.ok(statRatio >= 4.5, `${theme.name}: --we-stat-accent contrast is ${statRatio.toFixed(2)}:1`);

    const dangerTextRatio = contrastRatio(getToken(block, '--we-danger-text'), theme.surface);
    assert.ok(dangerTextRatio >= 4.5, `${theme.name}: --we-danger-text contrast is ${dangerTextRatio.toFixed(2)}:1`);
  }
});

test('shared database styles consume semantic theme tokens and keep standalone fallbacks', () => {
  const cssMatch = databaseSource.match(/const css = `([\s\S]*?)`;/);
  assert.ok(cssMatch, 'database component CSS template must exist');
  const css = cssMatch[1];

  assert.match(css, /--wedb-panel-bg:\s*var\(--we-surface,\s*#101827\)/);
  assert.match(css, /--wedb-info-bg:\s*var\(--we-info-bg,/);
  assert.match(css, /--wedb-success-bg:\s*var\(--we-success-bg,/);
  assert.match(css, /--wedb-warning-bg:\s*var\(--we-warning-bg,/);
  assert.match(css, /--wedb-danger-bg:\s*var\(--we-danger-bg,/);
  assert.match(css, /--wedb-action-bg:\s*var\(--we-action-bg,/);
  assert.match(css, /--wedb-danger-action-hover-bg:\s*var\(--we-danger-action-hover-bg,/);
  assert.match(css, /\.wedb-btn-primary:hover:not\(:disabled\)\s*\{[^}]*background:\s*var\(--wedb-action-hover-bg\)/);
  assert.match(css, /\.wedb-danger-btn:hover:not\(:disabled\)\s*\{[^}]*background:\s*var\(--wedb-danger-action-hover-bg\)/);
  assert.match(css, /\.wedb-stat strong\s*\{[^}]*color:\s*var\(--wedb-stat-accent\)/);
  assert.match(css, /\.wedb-danger-zone\s*\{[^}]*background:\s*var\(--wedb-danger-bg\)/);
  assert.doesNotMatch(css, /(?:^|[;{])\s*(?:color|background|border-color)\s*:\s*#[\da-f]{3,8}/i);
  assert.doesNotMatch(workspaceSource, /:global\(\.we-workspace\[data-theme='(?:light|dark|cream|landmine)'\]\s+\.wedb-/);
});

test('overview actions and narrow embedded layouts use accessible semantic styles', () => {
  const primaryAction = getRuleBody(workspaceSource, '.we-primary-action {');
  assert.match(primaryAction, /background:\s*var\(--we-action-bg\)/);
  assert.match(primaryAction, /color:\s*var\(--we-action-text\)/);

  const pageScroll = getRuleBody(workspaceSource, '.we-page-scroll {');
  assert.match(pageScroll, /container-type:\s*inline-size/);
  assert.match(workspaceSource, /@container\s*\(max-width:\s*820px\)\s*\{[\s\S]*?\.we-readiness-grid,[\s\S]*?grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(workspaceSource, /@container\s*\(max-width:\s*560px\)\s*\{[\s\S]*?\.we-readiness-grid\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.match(workspaceSource, /:data-scale="scale"/);
  assert.match(
    workspaceSource,
    /\.we-workspace\[data-scale='125'\]\s+\.we-theme-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/,
  );
  assert.match(workspaceSource, /\.we-theme-option\s*\{[\s\S]*?min-width:\s*0;/);

  const objectTab = databaseSource.match(/\.wedb-object-tabs \.wedb-tab\.active\s*\{([^}]*)\}/);
  assert.ok(objectTab, 'world data active category must have a semantic selected state');
  assert.match(objectTab[1], /background:\s*var\(--wedb-info-bg\)/);
  assert.match(objectTab[1], /color:\s*var\(--wedb-info-text\)/);
});

test('light theme cascade preserves readable danger text and danger button hover', () => {
  assert.match(
    workspaceSource,
    /:global\(\.we-workspace\[data-theme='light'\]\s+\.we-danger\),[\s\S]*?color:\s*var\(--we-danger-text\)\s*!important;/,
  );
  assert.match(
    workspaceSource,
    /:global\(\.we-workspace\[data-theme='light'\]\s+\.we-btn:hover:not\(\.we-btn-danger\)\)/,
  );
  assert.doesNotMatch(
    workspaceSource,
    /:global\(\.we-workspace\[data-theme='light'\]\s+\.we-btn:hover\),[\s\S]*?background:\s*var\(--we-tint\)\s*!important;/,
  );
});

test('automatic evolution, API, and prompt pages use semantic states and container layouts', () => {
  const evolutionCss = evolutionSource.match(/const css = `([\s\S]*?)`;/);
  assert.ok(evolutionCss, 'automatic evolution panel CSS must exist');
  assert.match(evolutionCss[1], /background:\s*var\(--we-bg,\s*#111827\)/);
  assert.match(evolutionCss[1], /\.we-panel-embedded\s*\{[^}]*container:\s*we-panel\s*\/\s*inline-size/);
  assert.match(evolutionCss[1], /\.we-run-result-badge\.failed\s*\{[^}]*var\(--we-danger-bg/);
  assert.match(evolutionCss[1], /\.we-settings-save-state\.dirty\s*\{[^}]*var\(--we-warning-text/);
  assert.match(evolutionCss[1], /@container\s+we-panel\s*\(max-width:\s*480px\)/);
  assert.doesNotMatch(evolutionCss[1], /#dc2626|#ef4444|#b45309/i);

  assert.match(apiSource, /\.we-api-page\s*\{[^}]*container-type:\s*inline-size/);
  assert.match(apiSource, /\.we-api-message\.error\s*\{[^}]*var\(--we-danger-bg/);
  assert.match(apiSource, /\.we-btn-primary:hover:not\(:disabled\)\s*\{[^}]*var\(--we-action-hover-bg/);
  assert.match(apiSource, /@container\s*\(max-width:\s*700px\)/);

  assert.match(promptSource, /\.we-prompt-page\s*\{[^}]*container-type:\s*inline-size/);
  assert.match(promptSource, /\.we-prompt-status\.is-success\s*\{[^}]*var\(--we-success-bg/);
  assert.match(promptSource, /\.we-template-warning\s*\{[^}]*var\(--we-warning-bg/);
  assert.match(promptSource, /@container\s*\(max-width:\s*640px\)/);
});
