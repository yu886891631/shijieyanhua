import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDollarURaw } from '../tasks/user-placeholder';

test('buildDollarURaw wraps persona and protagonist sections', () => {
  const raw = buildDollarURaw('我是 persona', '姓名：张三\n近况：良好');
  assert.match(raw, /^<{{user}}初始设定>\n我是 persona\n<\/{{user}}初始设定>\n<{{user}}最新数据>\n姓名：张三\n近况：良好\n<\/{{user}}最新数据>$/);
});

test('buildDollarURaw keeps empty sections with outer tags', () => {
  const raw = buildDollarURaw('', '');
  assert.equal(
    raw,
    ['<{{user}}初始设定>', '', '</{{user}}初始设定>', '<{{user}}最新数据>', '', '</{{user}}最新数据>'].join('\n'),
  );
});
