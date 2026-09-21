import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extractMarkdownSection,
  isProtagonistInfoWorldbookEntry,
  removeMarkdownSection,
  resolveProtagonistExportEntryName,
  resolveProtagonistTableName,
} from './blocked';

test('resolveProtagonistExportEntryName falls back to default', () => {
  assert.equal(resolveProtagonistExportEntryName(undefined), '主角信息');
  assert.equal(resolveProtagonistExportEntryName({ other: { name: '其他表' } }), '主角信息');
});

test('isProtagonistInfoWorldbookEntry respects custom entryName from tablesJson', () => {
  const entryName = resolveProtagonistExportEntryName({
    sheet_a: {
      name: '主角信息表',
      exportConfig: { entryName: '玩家状态' },
    },
  });
  assert.equal(entryName, '玩家状态');
  assert.equal(isProtagonistInfoWorldbookEntry('TavernDB-ACU-CustomExport-玩家状态-表头', entryName), true);
  assert.equal(isProtagonistInfoWorldbookEntry('TavernDB-ACU-CustomExport-主角信息-表头', entryName), false);
});

test('resolveProtagonistTableName falls back to default', () => {
  assert.equal(resolveProtagonistTableName(undefined), '主角信息表');
});

test('extractMarkdownSection and removeMarkdownSection support ReadableDataTable protagonist block', () => {
  const content = [
    '# 主角信息表',
    '',
    '| 姓名 | 近况 |',
    '|---|---|',
    '| 波尔特 | 正常 |',
    '',
    '# 任务与事件表',
    '',
    '| 编号 | 事件 |',
    '|---|---|',
    '| A1 | 巡逻 |',
  ].join('\n');

  assert.equal(
    extractMarkdownSection(content, '主角信息表'),
    ['| 姓名 | 近况 |', '|---|---|', '| 波尔特 | 正常 |'].join('\n'),
  );
  assert.equal(
    removeMarkdownSection(content, '主角信息表'),
    ['# 任务与事件表', '', '| 编号 | 事件 |', '|---|---|', '| A1 | 巡逻 |'].join('\n'),
  );
});
