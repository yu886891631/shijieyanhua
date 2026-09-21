import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildAssistantContextSlice } from './assistant-context';
import type { ScriptSettings } from './schema';

const baseSettings = {
  contextTurnCount: 0,
  contextExtractRules: [
    { start: '<tp', end: '</tp>' },
    { start: '<gametxt', end: '</gametxt>' },
  ],
  contextExcludeRules: [],
} as Pick<ScriptSettings, 'contextTurnCount' | 'contextExtractRules' | 'contextExcludeRules'>;

test('$7 keeps extract rule tags when extract rules configured', () => {
  const aiText =
    '<tp>time info</tp>\n\n<gametxt>body text</gametxt>\n\n<scene_info>extra</scene_info>';
  const out = buildAssistantContextSlice(baseSettings as ScriptSettings, 0, aiText);
  assert.ok(out.includes('<tp>'), 'should keep tp block');
  assert.ok(out.includes('<gametxt>'), 'should keep gametxt block');
  assert.ok(out.includes('body text'));
  assert.ok(!out.includes('<scene_info>'), 'non-extracted tags should be omitted');
});

test('$7 passes through full message when no extract rules', () => {
  const settings = {
    contextTurnCount: 0,
    contextExtractRules: [],
    contextExcludeRules: [],
  } as Pick<ScriptSettings, 'contextTurnCount' | 'contextExtractRules' | 'contextExcludeRules'>;
  const aiText = '<gametxt>inner only</gametxt>';
  const out = buildAssistantContextSlice(settings as ScriptSettings, 0, aiText);
  assert.equal(out, '<gametxt>inner only</gametxt>');
});

console.log('assistant-context.test.ts: all passed');
