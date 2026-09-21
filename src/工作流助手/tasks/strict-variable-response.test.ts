import assert from 'node:assert/strict';
import { buildChatCompletionPayload } from '../api/api-preset-utils';
import {
  bodyParamsHasResponseFormat,
  enrichApiConfigForStructuredTask,
  extractStrictVariableResponse,
  stripCodeFence,
  tryParseJsonObject,
} from './strict-variable-response';
import type { ApiConfig } from './schema';

const JSON_PATCH_RE = /<JSONPatch>\s*[\s\S]*?\s*<\/JSONPatch>/i;
const ADDON_JSON_PATCH_RE = /<AddonJSONPatch>\s*[\s\S]*?\s*<\/AddonJSONPatch>/i;

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`, e);
    process.exitCode = 1;
  }
}

test('stripCodeFence removes markdown fence', () => {
  const raw = '```json\n{"analysis":"x","patch":[]}\n```';
  assert.equal(stripCodeFence(raw), '{"analysis":"x","patch":[]}');
});

test('tryParseJsonObject extracts object from noise', () => {
  const parsed = tryParseJsonObject('说明文字 {"a":1} 尾部') as { a: number };
  assert.equal(parsed.a, 1);
});

test('mvu strict JSON normalizes to UpdateVariable + JSONPatch', () => {
  const json = JSON.stringify({
    analysis: 'Time passed 1 day.',
    patch: [{ op: 'replace', path: '/x', value: 1 }],
  });
  const result = extractStrictVariableResponse(json, 'mvu_json_patch');
  assert.ok(result.ok);
  assert.match(result.normalizedXml!, /<UpdateVariable>/);
  assert.match(result.normalizedXml!, /<Analysis>Time passed 1 day\.<\/Analysis>/);
  assert.match(result.normalizedXml!, /<JSONPatch>/);
  assert.match(result.normalizedXml!, JSON_PATCH_RE);
});

test('addon strict JSON normalizes to UpdateVariable + AddonJSONPatch', () => {
  const json = JSON.stringify({
    analysis: 'Minor updates only.',
    patch: [{ op: 'replace', path: '/x', value: 'y' }],
  });
  const result = extractStrictVariableResponse(json, 'addon_json_patch');
  assert.ok(result.ok);
  assert.match(result.normalizedXml!, /<UpdateVariable>/);
  assert.match(result.normalizedXml!, /<AddonJSONPatch>/);
  assert.match(result.normalizedXml!, ADDON_JSON_PATCH_RE);
  assert.ok(!/<UpdateAddonVariable>/i.test(result.normalizedXml!));
});

test('legacy format field is ignored when present', () => {
  const json = JSON.stringify({
    format: 'addon_json_patch_v1',
    analysis: 'Legacy reply with format.',
    patch: [{ op: 'replace', path: '/x', value: 1 }],
  });
  const result = extractStrictVariableResponse(json, 'mvu_json_patch');
  assert.ok(result.ok);
  assert.match(result.normalizedXml!, /<JSONPatch>/);
});

test('missing analysis fails validation', () => {
  const json = JSON.stringify({
    patch: [],
  });
  const result = extractStrictVariableResponse(json, 'mvu_json_patch');
  assert.equal(result.ok, false);
  assert.match(result.error!, /analysis/);
});

test('missing patch fails validation', () => {
  const json = JSON.stringify({
    analysis: 'ok',
  });
  const result = extractStrictVariableResponse(json, 'mvu_json_patch');
  assert.equal(result.ok, false);
  assert.match(result.error!, /patch/);
});

test('lenient recovery when analysis contains raw quotes', () => {
  const broken = `{
  "analysis": "确认[刊报日期]: ""（空）。后续仍有内容",
  "patch": [
    { "op": "replace", "path": "/x", "value": 1 }
  ]
}`;
  assert.throws(() => JSON.parse(broken));
  const result = extractStrictVariableResponse(broken, 'addon_json_patch');
  assert.ok(result.ok);
  assert.equal(result.recovered, true);
  assert.match(result.normalizedXml!, /<AddonJSONPatch>/);
  assert.match(result.normalizedXml!, /"path": "\/x"/);
  assert.match(result.normalizedXml!, /刊报日期/);
});

test('lenient recovery heals patch op missing closing brace (addon keeps raw slice)', () => {
  // 第一条缺闭合 }，L1 可 heal；addon 仍写入原始 slice，由 addon-mvu 统一修/记 heal
  const broken = `{
  "analysis": "ok",
  "patch": [
    { "op": "insert", "path": "/w/rumor/bad", "value": { "影响力": "圈内谈资", "流变历程": { "1": { "真相": "x" } } },
    { "op": "replace", "path": "/w/date", "value": "d1" }
  ]
}`;
  assert.throws(() => JSON.parse(broken));
  const result = extractStrictVariableResponse(broken, 'addon_json_patch');
  assert.ok(result.ok);
  assert.equal(result.recovered, true);
  assert.match(result.normalizedXml!, /<AddonJSONPatch>/);
  assert.match(result.normalizedXml!, /"path": "\/w\/date"/);
  assert.match(result.normalizedXml!, /\/w\/rumor\/bad/);
  assert.equal(result.skippedOpCount ?? 0, 0);
});

test('mvu lenient recovery heals missing braces into JSONPatch', () => {
  const broken = `{
  "analysis": "ok",
  "patch": [
    { "op": "insert", "path": "/w/rumor/bad", "value": { "影响力": "圈内谈资", "流变历程": { "1": { "真相": "x" } } },
    { "op": "replace", "path": "/w/date", "value": "d1" }
  ]
}`;
  const result = extractStrictVariableResponse(broken, 'mvu_json_patch');
  assert.ok(result.ok);
  assert.equal(result.recovered, true);
  assert.match(result.normalizedXml!, /<JSONPatch>/);
  assert.match(result.normalizedXml!, /"path": "\/w\/date"/);
  assert.match(result.normalizedXml!, /\/w\/rumor\/bad/);
  assert.equal((result.normalizedXml!.match(/"op":/g) || []).length, 2);
  assert.equal(result.skippedOpCount ?? 0, 0);
});

test('enrichApiConfig injects json_object only when missing', () => {
  const base: ApiConfig = {
    url: 'https://api.example.com',
    apiKey: '',
    model: 'deepseek-chat',
    source: 'openai',
    bodyParams: '',
    excludeBodyParams: '',
    requestHeaders: '',
    customPromptPostProcessing: 'none',
    includeReasoning: false,
    reasoningEffort: 'medium',
  };
  const enriched = enrichApiConfigForStructuredTask(base, 'mvu_json_patch');
  assert.ok(bodyParamsHasResponseFormat(enriched.bodyParams));
  assert.equal(enriched.customPromptPostProcessing, 'strict');

  const presetWithFormat: ApiConfig = {
    ...base,
    bodyParams: 'response_format:\n  type: json_schema',
  };
  const kept = enrichApiConfigForStructuredTask(presetWithFormat, 'mvu_json_patch');
  assert.equal(kept.bodyParams, presetWithFormat.bodyParams);
});

test('buildChatCompletionPayload uses preset strict processing', () => {
  const apiConfig: ApiConfig = {
    url: 'https://api.example.com',
    apiKey: 'k',
    model: 'm',
    source: 'openai',
    bodyParams: 'response_format:\n  type: json_object',
    excludeBodyParams: 'top_p',
    requestHeaders: '',
    customPromptPostProcessing: 'strict',
    includeReasoning: false,
    reasoningEffort: 'high',
  };
  const body = buildChatCompletionPayload([{ role: 'user', content: 'hi' }], apiConfig);
  assert.equal(body.custom_prompt_post_processing, 'strict');
  assert.equal(body.reasoning_effort, 'high');
  assert.equal(body.include_reasoning, false);
});

if (process.exitCode) {
  process.exit(process.exitCode);
}
