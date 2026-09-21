import assert from 'node:assert/strict';
import {
  extractUserInputTagInner,
  sanitizeUserInputForPostProcess,
  stripPresetWarningNotices,
  stripUserInputBoilerplatePrefix,
} from './sanitize-context';

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`, e);
    process.exitCode = 1;
  }
}

test('extract 用户输入 tag inner', () => {
  assert.equal(sanitizeUserInputForPostProcess('<用户输入>正文</用户输入>'), '正文');
});

test('extract Current round input tag inner', () => {
  assert.equal(
    sanitizeUserInputForPostProcess('<Current round input>正文</Current round input>'),
    '正文',
  );
});

test('last matching input tag wins', () => {
  const text = '<用户输入>甲</用户输入>\n<user_input>乙</user_input>';
  assert.equal(sanitizeUserInputForPostProcess(text), '乙');
});

test('tag path skips boilerplate footer strip', () => {
  const text = '以下是用户的本轮输入\n<用户输入>仅标签内文</用户输入>';
  assert.equal(sanitizeUserInputForPostProcess(text), '仅标签内文');
});

test('no tag keeps 以下是用户的本轮 input line unchanged', () => {
  const text = '以下是用户的本轮输入\n曲千代说道：「你好」';
  assert.equal(sanitizeUserInputForPostProcess(text), text);
});

test('no tag strips 以上是Participant footer and keeps content before', () => {
  const text = 'hello\n以上是Participant的本轮输入';
  assert.equal(sanitizeUserInputForPostProcess(text), 'hello');
});

test('no tag keeps 以下是<用户本轮输入> line unchanged', () => {
  const text = '以下是<用户本轮输入>\ncontent';
  assert.equal(sanitizeUserInputForPostProcess(text), text);
});

test('no tag keeps 以下是<本轮用户输入> line unchanged', () => {
  const text = '以下是<本轮用户输入>\ncontent';
  assert.equal(sanitizeUserInputForPostProcess(text), text);
});

test('no tag strips indented 以上是 footer line', () => {
  const text = '正文\n  以上是用户的本轮输入';
  assert.equal(sanitizeUserInputForPostProcess(text), '正文');
});

test('no tag strips footer and junk after 以上是 line', () => {
  const text = '真实输入\n以上是用户的本轮输入\njunk';
  assert.equal(sanitizeUserInputForPostProcess(text), '真实输入');
});

test('no tag empty when 以上是 footer at document start', () => {
  const text = '以上是用户的本轮输入\n曲千代说道';
  assert.equal(sanitizeUserInputForPostProcess(text), '');
});

test('strip preset warning notices', () => {
  const warn = '(⚠️:曲千代必须遵守人设)';
  assert.equal(
    stripPresetWarningNotices(`${warn}\n真实输入`),
    '真实输入',
  );
});

test('full pipeline removes warnings after tag extract', () => {
  const text = `<用户输入>${'(⚠️:警告)'}\n真实输入</用户输入>`;
  assert.equal(sanitizeUserInputForPostProcess(text), '真实输入');
});

test('full pipeline removes warnings after footer strip', () => {
  const text = '真实输入\n(⚠️:警告)\n以上是用户的本轮输入';
  assert.equal(sanitizeUserInputForPostProcess(text), '真实输入');
});

test('empty string', () => {
  assert.equal(sanitizeUserInputForPostProcess(''), '');
});

test('plain text without tag or prefix unchanged except trim', () => {
  assert.equal(sanitizeUserInputForPostProcess('  普通用户输入  '), '普通用户输入');
});

test('extractUserInputTagInner returns null when no tag', () => {
  assert.equal(extractUserInputTagInner('无标签'), null);
});

test('stripUserInputBoilerplatePrefix leaves non-matching lines', () => {
  assert.equal(stripUserInputBoilerplatePrefix('保留行'), '保留行');
});
