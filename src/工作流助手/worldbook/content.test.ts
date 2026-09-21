import assert from 'node:assert/strict';
import test from 'node:test';
import {
  finalizeManagedWorldbookPlaceholderContent,
  finalizePlotWorldbookPlaceholderContent,
  isSelectedPlotWorldbookEntry,
} from './content';
import { removeMarkdownSection } from './blocked';
import type { PlotWorldbookConfig } from '../tasks/schema';

function baseConfig(overrides: Partial<PlotWorldbookConfig> = {}): PlotWorldbookConfig {
  return {
    source: 'character',
    manualSelection: [],
    enabledEntries: {},
    ...overrides,
  };
}

test('isSelectedPlotWorldbookEntry includes all when enabledEntries empty', () => {
  assert.equal(
    isSelectedPlotWorldbookEntry(
      { bookName: 'BookA', uid: 99, normalizedComment: '普通条目' },
      baseConfig(),
    ),
    true,
  );
});

test('isSelectedPlotWorldbookEntry does not auto-include WorkflowHelper for $1', () => {
  const config = baseConfig({ enabledEntries: { BookA: [1] } });
  assert.equal(
    isSelectedPlotWorldbookEntry(
      { bookName: 'BookA', uid: 99, normalizedComment: 'WorkflowHelper-result' },
      config,
    ),
    false,
  );
  assert.equal(
    isSelectedPlotWorldbookEntry(
      { bookName: 'BookA', uid: 2, normalizedComment: '普通条目' },
      config,
    ),
    false,
  );
  assert.equal(
    isSelectedPlotWorldbookEntry(
      { bookName: 'BookA', uid: 1, normalizedComment: '普通条目' },
      config,
    ),
    true,
  );
});

test('isSelectedPlotWorldbookEntry still auto-includes non-chronicle DB entries', () => {
  const config = baseConfig({ enabledEntries: { BookA: [1] } });
  assert.equal(
    isSelectedPlotWorldbookEntry(
      { bookName: 'BookA', uid: 50, normalizedComment: 'TavernDB-ACU-ReadableDataTable' },
      config,
    ),
    true,
  );
  assert.equal(
    isSelectedPlotWorldbookEntry(
      { bookName: 'BookA', uid: 51, normalizedComment: '总结条目1' },
      config,
    ),
    false,
  );
  assert.equal(
    isSelectedPlotWorldbookEntry(
      { bookName: 'BookA', uid: 52, normalizedComment: 'TavernDB-ACU-CustomExport-纪要-1' },
      config,
    ),
    false,
  );
  assert.equal(
    isSelectedPlotWorldbookEntry(
      { bookName: 'BookA', uid: 53, normalizedComment: 'TavernDB-ACU-CustomExport-纪要-包裹-上' },
      config,
    ),
    false,
  );
});

test('finalize wrappers differ for $1 and $2', () => {
  assert.match(finalizePlotWorldbookPlaceholderContent('hello', []), /<worldbook_context>/);
  assert.match(finalizeManagedWorldbookPlaceholderContent('hello', []), /<worldbook_extra>/);
  assert.equal(finalizeManagedWorldbookPlaceholderContent('  ', []), '');
});

test('ReadableDataTable protagonist section can be removed before $1 formatting', () => {
  const raw = [
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
  const sanitized = removeMarkdownSection(raw, '主角信息表');
  assert.equal(sanitized.includes('波尔特'), false);
  assert.equal(sanitized.includes('# 任务与事件表'), true);
});
