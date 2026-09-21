import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isAutoIncludedPlotWorldbookEntry,
  isChronicleMemoryRowEntry,
  isChronicleMemoryWrapAfter,
  isChronicleMemoryWrapBefore,
  isChronicleMemoryWrapEntry,
  isChronicleMemoryWorldbookEntry,
  isCustomExportIndexEntry,
  isManagedPlotWorldbookEntry,
  isPlotDollar1AutoIncludedEntry,
  isProtagonistInfoWorldbookEntry,
  isWorkflowHelperManagedEntry,
  resolveProtagonistExportEntryName,
  shouldShowEntryInUi,
} from './blocked';
import type { ChatWorldbookWriteRule } from '../tasks/schema';

function baseRule(overrides: Partial<ChatWorldbookWriteRule> = {}): ChatWorldbookWriteRule {
  return {
    id: 'r1',
    targetTag: 'item@name',
    template: '{{item@name}}',
    entryName: '',
    bookSource: 'character',
    manualBookName: '',
    entryType: 'constant',
    keywords: '',
    splitByAttr: false,
    wrapTagName: '',
    placement: { position: 'at_depth_as_system', depth: 2, order: 10000 },
    preventRecursion: true,
    ...overrides,
  };
}

test('isWorkflowHelperManagedEntry matches default prefix', () => {
  assert.equal(isWorkflowHelperManagedEntry('WorkflowHelper-result'), true);
  assert.equal(isWorkflowHelperManagedEntry('普通条目'), false);
});

test('isChronicleMemoryRowEntry matches CustomExport rows and legacy summary', () => {
  assert.equal(isChronicleMemoryRowEntry('TavernDB-ACU-CustomExport-纪要-1'), true);
  assert.equal(isChronicleMemoryRowEntry('TavernDB-ACU-CustomExport-纪要-12'), true);
  assert.equal(isChronicleMemoryRowEntry('总结条目1'), true);
  assert.equal(isChronicleMemoryRowEntry('小总结条目2'), true);
  assert.equal(isChronicleMemoryRowEntry('TavernDB-ACU-CustomExport-纪要-包裹-上'), false);
  assert.equal(isChronicleMemoryRowEntry('TavernDB-ACU-CustomExport-纪要索引'), false);
  assert.equal(isChronicleMemoryRowEntry('TavernDB-ACU-foo'), false);
});

test('isChronicleMemoryWrapEntry matches 包裹上/下', () => {
  assert.equal(isChronicleMemoryWrapEntry('TavernDB-ACU-CustomExport-纪要-包裹-上'), true);
  assert.equal(isChronicleMemoryWrapEntry('TavernDB-ACU-CustomExport-纪要-包裹-下'), true);
  assert.equal(isChronicleMemoryWrapBefore('TavernDB-ACU-CustomExport-纪要-包裹-上'), true);
  assert.equal(isChronicleMemoryWrapAfter('TavernDB-ACU-CustomExport-纪要-包裹-下'), true);
  assert.equal(isChronicleMemoryWrapEntry('TavernDB-ACU-CustomExport-纪要-1'), false);
});

test('isChronicleMemoryWorldbookEntry covers row, wrap, and header', () => {
  assert.equal(isChronicleMemoryWorldbookEntry('TavernDB-ACU-CustomExport-纪要-1'), true);
  assert.equal(isChronicleMemoryWorldbookEntry('TavernDB-ACU-CustomExport-纪要-包裹-上'), true);
  assert.equal(isChronicleMemoryWorldbookEntry('TavernDB-ACU-CustomExport-纪要-表头'), true);
  assert.equal(isChronicleMemoryWorldbookEntry('总结条目1'), true);
  assert.equal(isChronicleMemoryWorldbookEntry('TavernDB-ACU-CustomExport-纪要索引'), false);
  assert.equal(isChronicleMemoryWorldbookEntry('TavernDB-ACU-foo'), false);
});

test('isPlotDollar1AutoIncludedEntry excludes managed and chronicle CustomExport', () => {
  assert.equal(isPlotDollar1AutoIncludedEntry('TavernDB-ACU-foo'), true);
  assert.equal(isPlotDollar1AutoIncludedEntry('重要人物条目-x'), true);
  assert.equal(isPlotDollar1AutoIncludedEntry('WorkflowHelper-item'), false);
  assert.equal(isPlotDollar1AutoIncludedEntry('总结条目1'), false);
  assert.equal(isPlotDollar1AutoIncludedEntry('TavernDB-ACU-CustomExport-纪要-1'), false);
  assert.equal(isPlotDollar1AutoIncludedEntry('TavernDB-ACU-CustomExport-纪要-包裹-下'), false);
  assert.equal(isPlotDollar1AutoIncludedEntry('TavernDB-ACU-CustomExport-纪要-表头'), false);
  assert.equal(isPlotDollar1AutoIncludedEntry('普通条目'), false);
});

test('isProtagonistInfoWorldbookEntry matches CustomExport 主角信息 variants', () => {
  assert.equal(isProtagonistInfoWorldbookEntry('TavernDB-ACU-CustomExport-主角信息'), true);
  assert.equal(isProtagonistInfoWorldbookEntry('TavernDB-ACU-CustomExport-主角信息-表头'), true);
  assert.equal(isProtagonistInfoWorldbookEntry('TavernDB-ACU-CustomExport-主角信息-包裹-上'), true);
  assert.equal(isProtagonistInfoWorldbookEntry('TavernDB-ACU-CustomExport-主角信息-包裹-下'), true);
  assert.equal(isProtagonistInfoWorldbookEntry('TavernDB-ACU-CustomExport-主角信息-1'), true);
  assert.equal(isProtagonistInfoWorldbookEntry('TavernDB-ACU-CustomExport-主角信息-索引'), true);
  assert.equal(isProtagonistInfoWorldbookEntry('TavernDB-ACU-CustomExport-纪要-1'), false);
  assert.equal(isProtagonistInfoWorldbookEntry('TavernDB-ACU-foo'), false);
});

test('isPlotDollar1AutoIncludedEntry excludes protagonist CustomExport', () => {
  assert.equal(isPlotDollar1AutoIncludedEntry('TavernDB-ACU-CustomExport-主角信息'), false);
  assert.equal(isPlotDollar1AutoIncludedEntry('TavernDB-ACU-CustomExport-主角信息-1'), false);
  assert.equal(isPlotDollar1AutoIncludedEntry('TavernDB-ACU-CustomExport-主角信息-索引'), false);
});

test('resolveProtagonistExportEntryName reads tablesJson exportConfig', () => {
  assert.equal(resolveProtagonistExportEntryName(null), '主角信息');
  assert.equal(
    resolveProtagonistExportEntryName({
      sheet_protagonist: {
        name: '主角信息表',
        exportConfig: { entryName: '玩家档案' },
      },
    }),
    '玩家档案',
  );
  assert.equal(
    isProtagonistInfoWorldbookEntry('TavernDB-ACU-CustomExport-玩家档案-1', '玩家档案'),
    true,
  );
  assert.equal(
    isPlotDollar1AutoIncludedEntry('TavernDB-ACU-CustomExport-玩家档案', '玩家档案'),
    false,
  );
});

test('isCustomExportIndexEntry matches CustomExport index entries', () => {
  assert.equal(isCustomExportIndexEntry('TavernDB-ACU-CustomExport-地点表-索引'), true);
  assert.equal(isCustomExportIndexEntry('TavernDB-ACU-CustomExport-纪要索引'), true);
  assert.equal(isCustomExportIndexEntry('TavernDB-ACU-CustomExport-地点表-1'), false);
  assert.equal(isCustomExportIndexEntry('TavernDB-ACU-CustomExport-地点表'), false);
});

test('isManagedPlotWorldbookEntry matches WorkflowHelper only', () => {
  assert.equal(isManagedPlotWorldbookEntry('WorkflowHelper-item name-剑'), true);
  const rules = [baseRule({ entryName: 'MyEntry-{attrValue}', splitByAttr: true })];
  assert.equal(isManagedPlotWorldbookEntry('MyEntry-断剑', rules), false);
  assert.equal(isManagedPlotWorldbookEntry('WorkflowHelper-item name-断剑', rules), true);
});

test('isAutoIncludedPlotWorldbookEntry still covers DB and managed for UI hide', () => {
  assert.equal(isAutoIncludedPlotWorldbookEntry('TavernDB-ACU-foo'), true);
  assert.equal(isAutoIncludedPlotWorldbookEntry('WorkflowHelper-item name-剑'), true);
  assert.equal(isAutoIncludedPlotWorldbookEntry('普通条目'), false);
});

test('shouldShowEntryInUi hides auto-included entries', () => {
  assert.equal(shouldShowEntryInUi({ name: 'WorkflowHelper-result' }), false);
  assert.equal(shouldShowEntryInUi({ name: 'TavernDB-ACU-ReadableDataTable' }), false);
  assert.equal(shouldShowEntryInUi({ name: '普通剧情设定' }), true);
  const rules = [baseRule({ entryName: 'CustomPrefix' })];
  assert.equal(shouldShowEntryInUi({ name: 'CustomPrefix-foo' }, rules), true);
  assert.equal(shouldShowEntryInUi({ name: 'WorkflowHelper-item' }, rules), false);
});
