import assert from 'node:assert/strict';
import { extractInjectTagsFromResponse } from './tag-extract';
import {
  clearUnresolvedTaskPlaceholders,
  extractPlotTagsFromResponse,
  filterXmlExtractedTagsForDisplay,
  formatTagValueForInject,
  formatTagValuesForInject,
  joinWritableRelayValues,
  mergeRelayTagMap,
  overwriteRelayTagMap,
  refreshNestedExtractTagsInContent,
  replacePlotTagPlaceholdersWithHistory,
  resolvePlaceholderForInject,
  type RelayTagMap,
} from './utils';
import { ENUM_REGISTRY_MARKER } from './replica-enum-parse';

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`, e);
    process.exitCode = 1;
  }
}

test('item@id splits by attribute', () => {
  const text = '<item id="1">A</item><item id="2">B</item>';
  const { extractedTags, injectedFragments } = extractInjectTagsFromResponse(text, ['item@id']);
  assert.equal(extractedTags['item@id=1'], 'A');
  assert.equal(extractedTags['item@id=2'], 'B');
  assert.equal(injectedFragments[0], '<item id="1">\nA\n</item>');
  assert.equal(injectedFragments[1], '<item id="2">\nB\n</item>');
});

test('bare tag skips nested same-name self-closing when taking last', () => {
  const text = `<角色集>
  <角色集 类型="前台角色" 列表="波尔特" />
  <角色集 类型="后台关系列表角色" 列表="凯尔" />
</角色集>`;
  const { extractedTags } = extractInjectTagsFromResponse(text, ['角色集']);
  assert.match(extractedTags['角色集'] || '', /类型="前台角色"/);
  assert.match(extractedTags['角色集'] || '', /类型="后台关系列表角色"/);
  assert.ok((extractedTags['角色集'] || '').length > 0);
});

test('item@id skips bare tag without id', () => {
  const text = '<item id="1">A</item><item>无id</item>';
  const { extractedTags } = extractInjectTagsFromResponse(text, ['item@id']);
  assert.equal(extractedTags['item@id=1'], 'A');
  assert.equal(extractedTags.item, undefined);
});

test('item@id only bare tags yields empty', () => {
  const text = '<item>first</item><item>second</item>';
  const { extractedTags } = extractInjectTagsFromResponse(text, ['item@id']);
  assert.equal(Object.keys(extractedTags).length, 0);
});

test('npc@act skips bare open in think and keeps attr block', () => {
  const text =
    '<think>仅限更新佐久夜的<npc>内容，确保其行为的独立性。</think>\n' +
    '<npc act="佐久夜">正文</npc>';
  const { extractedTags } = extractInjectTagsFromResponse(text, ['npc@act']);
  assert.equal(extractedTags['npc@act=佐久夜'], '正文');
  assert.equal(extractedTags.npc, undefined);
});

test('bare result keeps inner last', () => {
  const text = '<result>x</result><result type="a">y</result>';
  const { extractedTags } = extractPlotTagsFromResponse(text, ['result']);
  assert.equal(extractedTags.result, 'y');
});

test('bare content last when first open tag is unclosed', () => {
  const text = '<content>...|<content>....</content>';
  const { extractedTags } = extractInjectTagsFromResponse(text, ['content']);
  assert.equal(extractedTags.content, '....');
});

test('bare content last among two closed pairs', () => {
  const text = '<content>first</content>mid<content>last</content>';
  const { extractedTags } = extractInjectTagsFromResponse(text, ['content']);
  assert.equal(extractedTags.content, 'last');
});

test('item@id still enumerates all attr instances', () => {
  const text = '<item id="1">A</item><item id="2">B</item>';
  const { extractedTags } = extractInjectTagsFromResponse(text, ['item@id']);
  assert.equal(extractedTags['item@id=1'], 'A');
  assert.equal(extractedTags['item@id=2'], 'B');
});

test('formatTagValueForInject composite inner rebuilds attr block', () => {
  assert.equal(formatTagValueForInject('item@id=1', 'A'), '<item id="1">\nA\n</item>');
});

test('formatTagValueForInject full block rewraps with newlines', () => {
  const block = '<item id="1">A</item>';
  assert.equal(formatTagValueForInject('item@id=1', block), '<item id="1">\nA\n</item>');
});

test('formatTagValueForInject wraps inner', () => {
  assert.equal(formatTagValueForInject('result', 'hello'), '<result>\nhello\n</result>');
});

test('formatTagValueForInject bare key wraps nested child tags', () => {
  const inner = '<npc act="李明">李明</npc>';
  const out = formatTagValueForInject('不在场npc', inner);
  assert.equal(out, `<不在场npc>\n${inner}\n</不在场npc>`);
});

test('formatTagValueForInject bare key passthrough own full block rewraps', () => {
  const inner = '<npc act="李明">李明</npc>';
  const block = `<不在场npc>${inner}</不在场npc>`;
  assert.equal(formatTagValueForInject('不在场npc', block), `<不在场npc>\n${inner}\n</不在场npc>`);
});

test('formatTagValueForInject composite npc@act rewraps full block', () => {
  const block = '<npc act="李明">李明</npc>';
  assert.equal(formatTagValueForInject('npc@act=李明', block), '<npc act="李明">\n李明\n</npc>');
});

test('formatTagValueForInject item key does not match itemize', () => {
  const inner = '<itemize>list</itemize>';
  const out = formatTagValueForInject('item', inner);
  assert.equal(out, `<item>\n${inner}\n</item>`);
});

test('placeholder 不在场npc preserves outer wrapper', () => {
  const inner = '<npc act="李明">李明</npc>';
  const map: RelayTagMap = new Map([['不在场npc', [inner]]]);
  const out = replacePlotTagPlaceholdersWithHistory('{{不在场npc}}', map, new Map(), new Set(['不在场npc']));
  assert.equal(out, `<不在场npc>\n${inner}\n</不在场npc>`);
});

test('placeholder item@id=1 precise', () => {
  const map: RelayTagMap = new Map([['item@id=1', ['<item id="1">A</item>']]]);
  const out = replacePlotTagPlaceholdersWithHistory('x {{item@id=1}} y', map, new Map(), new Set(['item@id']));
  assert.equal(out, 'x <item id="1">\nA\n</item> y');
  assert.ok(!out.includes('<item><item'));
});

test('placeholder item expands bare key only', () => {
  const map: RelayTagMap = new Map([
    ['item@id=1', ['<item id="1">A</item>']],
    ['item@id=2', ['<item id="2">B</item>']],
    ['item', ['<item>无id</item>']],
  ]);
  const out = replacePlotTagPlaceholdersWithHistory('{{item}}', map, new Map(), new Set(['item@id', 'item']));
  assert.equal(out, '<item>\n无id\n</item>');
  assert.ok(!out.includes('<item id="1">'));
  assert.ok(!out.includes('<item id="2">'));
});

test('placeholder total:item@id expands all attr instances', () => {
  const map: RelayTagMap = new Map([
    ['item@id=2', ['<item id="2">B</item>']],
    ['item@id=1', ['<item id="1">A</item>']],
    ['item', ['<item>无id</item>']],
  ]);
  const out = replacePlotTagPlaceholdersWithHistory(
    '{{total:item@id}}',
    map,
    new Map(),
    new Set(['item@id']),
  );
  assert.ok(out.indexOf('<item id="1">') < out.indexOf('<item id="2">'));
  assert.ok(!out.includes('<item>无id</item>'));
});

test('placeholder item@id dynamic expands attr instances only', () => {
  const map: RelayTagMap = new Map([
    ['item@id=2', ['<item id="2">B</item>']],
    ['item@id=1', ['<item id="1">A</item>']],
    ['item', ['<item>无id</item>']],
  ]);
  const out = replacePlotTagPlaceholdersWithHistory('{{item@id}}', map, new Map(), new Set(['item@id']));
  assert.ok(out.indexOf('<item id="1">') < out.indexOf('<item id="2">'));
  assert.ok(!out.includes('<item>无id</item>'));
});

test('historyFallback all-tags without injectOnly whitelist', () => {
  const history: RelayTagMap = new Map([['archived', ['saved']]]);
  const out = replacePlotTagPlaceholdersWithHistory('{{archived}}', new Map(), history, new Set(), {
    historyFallback: 'all-tags',
  });
  assert.equal(out, '<archived>\nsaved\n</archived>');
});

test('relay wins over history with all-tags fallback', () => {
  const relay: RelayTagMap = new Map([['foo', ['new']]]);
  const history: RelayTagMap = new Map([['foo', ['old']]]);
  const out = replacePlotTagPlaceholdersWithHistory('{{foo}}', relay, history, new Set(), {
    historyFallback: 'all-tags',
  });
  assert.equal(out, '<foo>\nnew\n</foo>');
});

test('all-tags fallback clears unconfigured ASCII placeholder with no data', () => {
  const out = replacePlotTagPlaceholdersWithHistory('x{{missing}}y', new Map(), new Map(), new Set(), {
    historyFallback: 'all-tags',
  });
  assert.equal(out, 'xy');
});

test('preserves tavern and helper variable macros for macro pass', () => {
  const macros =
    '{{getvar::复活机制}}' +
    '{{get_message_variable::stat_data.世界.时间}}' +
    '{{format_message_variable::stat_data.世界}}' +
    '{{get_global_variable::x}}' +
    '{{format_chat_variable::商品.1}}' +
    '{{.local}}{{$global}}';
  const out = replacePlotTagPlaceholdersWithHistory(macros, new Map(), new Map(), new Set(), {
    historyFallback: 'all-tags',
  });
  assert.equal(out, macros);
});

test('still clears unowned chinese script tags with no data', () => {
  const out = replacePlotTagPlaceholdersWithHistory('x{{中文标签}}y', new Map(), new Map(), new Set(), {
    historyFallback: 'all-tags',
  });
  assert.equal(out, 'xy');
});

test('mergeRelayTagMap appends same key', () => {
  const map: RelayTagMap = new Map();
  mergeRelayTagMap(map, { 'item@id=1': 'S1' });
  mergeRelayTagMap(map, { 'item@id=1': 'S2' });
  assert.equal(map.get('item@id=1')?.length, 2);
  assert.deepEqual(map.get('item@id=1'), ['S1', 'S2']);
});

test('overwriteRelayTagMap overwrites same key', () => {
  const map: RelayTagMap = new Map();
  overwriteRelayTagMap(map, { 'item@id=1': '<item id="1">S1</item>' });
  overwriteRelayTagMap(map, { 'item@id=1': '<item id="1">S2</item>' });
  assert.equal(map.get('item@id=1')?.length, 1);
  assert.equal(map.get('item@id=1')?.[0], '<item id="1">S2</item>');
});

test('formatTagValuesForInject merges inners under one outer tag', () => {
  const out = formatTagValuesForInject('result', ['A', 'B']);
  assert.equal(out, '<result>\nA\n\nB\n</result>');
});

test('replica composite placeholder prefers floor over relay', () => {
  const relay: RelayTagMap = new Map([['item@id=1', ['enum']]]);
  const history: RelayTagMap = new Map([['item@id=1', ['floor']]]);
  const out = replacePlotTagPlaceholdersWithHistory('x {{item@id=1}} y', relay, history, new Set(['item@id']), {
    historyFallback: 'all-tags',
    replicaAttrSpec: { tagName: 'item', attrName: 'id' },
  });
  assert.equal(out, 'x <item id="1">\nfloor\n</item> y');
});

test('replica composite placeholder empty floor yields empty attr block', () => {
  const relay: RelayTagMap = new Map([['item@id=2', ['<item id="2">enum</item>']]]);
  const out = replacePlotTagPlaceholdersWithHistory('{{item@id=2}}', relay, new Map(), new Set(['item@id']), {
    historyFallback: 'all-tags',
    replicaAttrSpec: { tagName: 'item', attrName: 'id' },
  });
  assert.equal(out, '<item id="2">\n\n</item>');
});

test('outer tag refreshes nested inner from relay', () => {
  const relay: RelayTagMap = new Map([
    ['story', ['<npc>old</npc>']],
    ['npc', ['new']],
  ]);
  const out = replacePlotTagPlaceholdersWithHistory('{{story}}', relay, new Map(), new Set(['story', 'npc']), {
    historyFallback: 'all-tags',
  });
  assert.equal(out, '<story>\n<npc>\nnew\n</npc>\n</story>');
});

test('refreshNestedExtractTagsInContent ignores unconfigured tags', () => {
  const relay: RelayTagMap = new Map([
    ['story', ['<other>old</other>']],
    ['other', ['new']],
  ]);
  const out = refreshNestedExtractTagsInContent(
    '<story><other>old</other></story>',
    relay,
    new Map(),
    new Set(['story']),
    { historyFallback: 'all-tags' },
  );
  // story 在注入名单内会按 format 规范换行包裹；未配置的 other 不被刷新为 relay 新值
  assert.equal(out, '<story>\n<other>old</other>\n</story>');
  assert.ok(!out.includes('<other>new</other>'));
});

test('filterXmlExtractedTagsForDisplay drops ReplicaEnum registry markers', () => {
  const filtered = filterXmlExtractedTagsForDisplay({
    result: '摘要',
    'item@id=1': ENUM_REGISTRY_MARKER,
    'item@id=2': ENUM_REGISTRY_MARKER,
    'item@name=甲': '<item name="甲">内容</item>',
    empty: '   ',
  });
  assert.deepEqual(filtered, {
    result: '摘要',
    'item@name=甲': '<item name="甲">内容</item>',
  });
});

test('joinWritableRelayValues drops registry marker and keeps real XML', () => {
  const joined = joinWritableRelayValues([
    ENUM_REGISTRY_MARKER,
    '<item name="甲">A</item>',
    ENUM_REGISTRY_MARKER,
    '<item name="乙">B</item>',
  ]);
  assert.equal(joined, '<item name="甲">A</item>\n\n<item name="乙">B</item>');
  assert.equal(joinWritableRelayValues([ENUM_REGISTRY_MARKER]), '');
});

test('replica:val resolves to replicaAttrValue in member context', () => {
  const out = replacePlotTagPlaceholdersWithHistory('处理 {{replica:val}}', new Map(), new Map(), new Set(), {
    historyFallback: 'all-tags',
    replicaAttrValue: '1',
  });
  assert.equal(out, '处理 1');
});

test('replica:val resolves empty outside replica member context', () => {
  const relay: RelayTagMap = new Map([['replica:val', ['should-not-use']]]);
  const out = replacePlotTagPlaceholdersWithHistory('{{replica:val}}', relay, new Map(), new Set(), {
    historyFallback: 'all-tags',
  });
  assert.equal(out, '');
});

test('replica:val ignores relay tag even when replicaAttrValue set', () => {
  const relay: RelayTagMap = new Map([['replica:val', ['wrong']]]);
  const out = resolvePlaceholderForInject('replica:val', relay, new Map(), new Set(), {
    replicaAttrValue: '甲',
  });
  assert.equal(out, '甲');
});

test('{{char}} and {{user}} preserved as deferred bare tavern macros', () => {
  const out = replacePlotTagPlaceholdersWithHistory(
    'hi {{char}} / <{{user}}初始设定> bye',
    new Map(),
    new Map(),
    new Set(),
    { historyFallback: 'all-tags' },
  );
  assert.equal(out, 'hi {{char}} / <{{user}}初始设定> bye');
});

test('configured plot tag still replaces to empty when no data', () => {
  const out = replacePlotTagPlaceholdersWithHistory('{{result}}', new Map(), new Map(), new Set(['result']), {
    historyFallback: 'all-tags',
  });
  assert.equal(out, '');
});

test('unconfigured ASCII plot tag clears when no data even without inject whitelist', () => {
  const out = replacePlotTagPlaceholdersWithHistory('a{{consistency}}b', new Map(), new Map(), new Set(), {
    historyFallback: 'all-tags',
  });
  assert.equal(out, 'ab');
});

test('clearUnresolvedTaskPlaceholders strips unmatched task refs', () => {
  assert.equal(clearUnresolvedTaskPlaceholders('x{{task:不存在}}y{{task:id-1}}z'), 'xyz');
  assert.equal(clearUnresolvedTaskPlaceholders('ok {{task: name }} end'), 'ok  end');
  assert.equal(clearUnresolvedTaskPlaceholders('keep {{char}}'), 'keep {{char}}');
});

test('replica:launched resolves launched suffixes', () => {
  const root = {
    id: 'root-1',
    name: '副本族处理',
    enabled: true,
    stage: 2,
    promptGroups: [],
    extractInjectTags: ['item@id'],
    mergeStrategy: 'concat' as const,
    maxRetries: 3,
    minLength: 0,
    apiPresetName: '',
    plotWorldbookMode: 'inherit' as const,
    contextMode: 'inherit' as const,
    structuredOutputMode: 'off' as const,
    syncAsReplicaFamily: true,
    replicaFamilySpec: 'item@id',
    replicaFamilyBaseName: '副本族处理',
    replicaFamilyScheduleMode: 'manual' as const,
  };
  const rep = {
    ...root,
    id: 'rep-1',
    name: '副本族处理 1',
    syncAsReplicaFamily: false,
    replicaFamilyRootId: 'root-1',
    replicaFamilyAttrValue: '1',
    replicaFamilyLaunched: true,
  };
  const out = replacePlotTagPlaceholdersWithHistory(
    '开启：{{replica:launched:副本族处理}}',
    new Map(),
    new Map(),
    new Set(),
    { historyFallback: 'all-tags', allTasks: [root, rep] },
  );
  assert.equal(out, '开启：1');
});

test('total:launched expands only launched replica composites (manual)', () => {
  const root = {
    id: 'root-1',
    name: '副本族处理',
    enabled: true,
    stage: 2,
    promptGroups: [],
    extractInjectTags: ['item@id'],
    mergeStrategy: 'concat' as const,
    maxRetries: 3,
    minLength: 0,
    apiPresetName: '',
    plotWorldbookMode: 'inherit' as const,
    contextMode: 'inherit' as const,
    structuredOutputMode: 'off' as const,
    syncAsReplicaFamily: true,
    replicaFamilySpec: 'item@id',
    replicaFamilyEnumSpec: 'item@id',
    replicaFamilyBaseName: '副本族处理',
    replicaFamilyScheduleMode: 'manual' as const,
  };
  const rep1 = {
    ...root,
    id: 'rep-1',
    name: '副本族处理 1',
    syncAsReplicaFamily: false,
    replicaFamilyRootId: 'root-1',
    replicaFamilyAttrValue: '1',
    replicaFamilyLaunched: true,
  };
  const rep2 = {
    ...root,
    id: 'rep-2',
    name: '副本族处理 2',
    syncAsReplicaFamily: false,
    replicaFamilyRootId: 'root-1',
    replicaFamilyAttrValue: '2',
    replicaFamilyLaunched: false,
  };
  const history: RelayTagMap = new Map([
    ['item@id=1', ['A']],
    ['item@id=2', ['B']],
  ]);
  const out = replacePlotTagPlaceholdersWithHistory(
    '{{total:launched:item@id}}',
    new Map(),
    history,
    new Set(),
    { historyFallback: 'all-tags', allTasks: [root, rep1, rep2] },
  );
  assert.ok(out.includes('<item id="1">'));
  assert.ok(out.includes('A'));
  assert.ok(!out.includes('<item id="2">'));
  assert.ok(!out.includes('B'));
});

test('total:launched expands only enum-registered replicas (auto)', () => {
  const root = {
    id: 'root-1',
    name: '副本族处理',
    enabled: true,
    stage: 2,
    promptGroups: [],
    extractInjectTags: ['item@id'],
    mergeStrategy: 'concat' as const,
    maxRetries: 3,
    minLength: 0,
    apiPresetName: '',
    plotWorldbookMode: 'inherit' as const,
    contextMode: 'inherit' as const,
    structuredOutputMode: 'off' as const,
    syncAsReplicaFamily: true,
    replicaFamilySpec: 'item@id',
    replicaFamilyEnumSpec: 'item@id',
    replicaFamilyBaseName: '副本族处理',
    replicaFamilyScheduleMode: 'auto' as const,
  };
  const rep1 = {
    ...root,
    id: 'rep-1',
    name: '副本族处理 1',
    syncAsReplicaFamily: false,
    replicaFamilyRootId: 'root-1',
    replicaFamilyAttrValue: '1',
  };
  const rep2 = {
    ...root,
    id: 'rep-2',
    name: '副本族处理 2',
    syncAsReplicaFamily: false,
    replicaFamilyRootId: 'root-1',
    replicaFamilyAttrValue: '2',
  };
  const relay: RelayTagMap = new Map([['item@id=1', [ENUM_REGISTRY_MARKER]]]);
  const history: RelayTagMap = new Map([
    ['item@id=1', ['A']],
    ['item@id=2', ['B']],
  ]);
  const out = replacePlotTagPlaceholdersWithHistory(
    '{{total:launched:item@id}}',
    relay,
    history,
    new Set(),
    { historyFallback: 'all-tags', allTasks: [root, rep1, rep2] },
  );
  assert.ok(out.includes('<item id="1">'));
  assert.ok(out.includes('A'));
  assert.ok(!out.includes('<item id="2">'));
});

test('total:launched returns empty for unknown attr spec', () => {
  const out = replacePlotTagPlaceholdersWithHistory(
    '{{total:launched:npc@name}}',
    new Map(),
    new Map([['npc@name=1', ['X']]]),
    new Set(),
    { historyFallback: 'all-tags', allTasks: [] },
  );
  assert.equal(out, '');
});

test('total:item@id still expands all instances when total:launched exists', () => {
  const map: RelayTagMap = new Map([
    ['item@id=1', ['A']],
    ['item@id=2', ['B']],
  ]);
  const out = replacePlotTagPlaceholdersWithHistory(
    '{{total:item@id}}',
    map,
    new Map(),
    new Set(['item@id']),
  );
  assert.ok(out.includes('<item id="1">'));
  assert.ok(out.includes('<item id="2">'));
});

test('total:last-launched expands from snapshot launchedAttrValues (manual)', () => {
  const root = {
    id: 'root-1',
    name: '副本族处理',
    enabled: true,
    stage: 2,
    promptGroups: [],
    extractInjectTags: ['item@id'],
    mergeStrategy: 'concat' as const,
    maxRetries: 3,
    minLength: 0,
    apiPresetName: '',
    plotWorldbookMode: 'inherit' as const,
    contextMode: 'inherit' as const,
    structuredOutputMode: 'off' as const,
    syncAsReplicaFamily: true,
    replicaFamilySpec: 'item@id',
    replicaFamilyEnumSpec: 'item@id',
    replicaFamilyBaseName: '副本族处理',
    replicaFamilyScheduleMode: 'manual' as const,
  };
  const history: RelayTagMap = new Map([
    ['item@id=1', ['A']],
    ['item@id=2', ['B']],
  ]);
  const out = replacePlotTagPlaceholdersWithHistory(
    '{{total:last-launched:item@id}}',
    new Map([['item@id=2', ['RELAY-ONLY']]]),
    history,
    new Set(),
    {
      historyFallback: 'all-tags',
      allTasks: [root],
      replicaState: {
        'root-1': { attrValues: ['1', '2'], launchedAttrValues: ['1'] },
      },
    },
  );
  assert.ok(out.includes('<item id="1">'));
  assert.ok(out.includes('A'));
  assert.ok(!out.includes('<item id="2">'));
  assert.ok(!out.includes('RELAY-ONLY'));
});

test('total:last-launched expands from lastEnumAttrValues (auto)', () => {
  const root = {
    id: 'root-1',
    name: '副本族处理',
    enabled: true,
    stage: 2,
    promptGroups: [],
    extractInjectTags: ['item@id'],
    mergeStrategy: 'concat' as const,
    maxRetries: 3,
    minLength: 0,
    apiPresetName: '',
    plotWorldbookMode: 'inherit' as const,
    contextMode: 'inherit' as const,
    structuredOutputMode: 'off' as const,
    syncAsReplicaFamily: true,
    replicaFamilySpec: 'item@id',
    replicaFamilyEnumSpec: 'item@id',
    replicaFamilyBaseName: '副本族处理',
    replicaFamilyScheduleMode: 'auto' as const,
  };
  const history: RelayTagMap = new Map([
    ['item@id=1', ['A']],
    ['item@id=2', ['B']],
  ]);
  const out = replacePlotTagPlaceholdersWithHistory(
    '{{total:last-launched:item@id}}',
    new Map(),
    history,
    new Set(),
    {
      historyFallback: 'all-tags',
      allTasks: [root],
      replicaState: {
        'root-1': { attrValues: ['1', '2'], lastEnumAttrValues: ['2'] },
      },
    },
  );
  assert.ok(out.includes('<item id="2">'));
  assert.ok(out.includes('B'));
  assert.ok(!out.includes('<item id="1">'));
});

test('total:last-launched falls back to other field when primary empty', () => {
  const root = {
    id: 'root-1',
    name: '副本族处理',
    enabled: true,
    stage: 2,
    promptGroups: [],
    extractInjectTags: ['item@id'],
    mergeStrategy: 'concat' as const,
    maxRetries: 3,
    minLength: 0,
    apiPresetName: '',
    plotWorldbookMode: 'inherit' as const,
    contextMode: 'inherit' as const,
    structuredOutputMode: 'off' as const,
    syncAsReplicaFamily: true,
    replicaFamilySpec: 'item@id',
    replicaFamilyEnumSpec: 'item@id',
    replicaFamilyBaseName: '副本族处理',
    replicaFamilyScheduleMode: 'manual' as const,
  };
  const history: RelayTagMap = new Map([['item@id=2', ['B']]]);
  const out = replacePlotTagPlaceholdersWithHistory(
    '{{total:last-launched:item@id}}',
    new Map(),
    history,
    new Set(),
    {
      historyFallback: 'all-tags',
      allTasks: [root],
      replicaState: {
        'root-1': { attrValues: ['2'], lastEnumAttrValues: ['2'] },
      },
    },
  );
  assert.ok(out.includes('<item id="2">'));
  assert.ok(out.includes('B'));
});

test('total:launched prefers current round over last-launched snapshot', () => {
  const root = {
    id: 'root-1',
    name: '副本族处理',
    enabled: true,
    stage: 2,
    promptGroups: [],
    extractInjectTags: ['item@id'],
    mergeStrategy: 'concat' as const,
    maxRetries: 3,
    minLength: 0,
    apiPresetName: '',
    plotWorldbookMode: 'inherit' as const,
    contextMode: 'inherit' as const,
    structuredOutputMode: 'off' as const,
    syncAsReplicaFamily: true,
    replicaFamilySpec: 'item@id',
    replicaFamilyEnumSpec: 'item@id',
    replicaFamilyBaseName: '副本族处理',
    replicaFamilyScheduleMode: 'manual' as const,
  };
  const rep1 = {
    ...root,
    id: 'rep-1',
    name: '副本族处理 1',
    syncAsReplicaFamily: false,
    replicaFamilyRootId: 'root-1',
    replicaFamilyAttrValue: '1',
    replicaFamilyLaunched: true,
  };
  const history: RelayTagMap = new Map([
    ['item@id=1', ['CUR']],
    ['item@id=2', ['LAST']],
  ]);
  const out = replacePlotTagPlaceholdersWithHistory(
    '{{total:launched:item@id}}',
    new Map(),
    history,
    new Set(),
    {
      historyFallback: 'all-tags',
      allTasks: [root, rep1],
      replicaState: {
        'root-1': { attrValues: ['1', '2'], launchedAttrValues: ['2'] },
      },
    },
  );
  assert.ok(out.includes('<item id="1">'));
  assert.ok(out.includes('CUR'));
  assert.ok(!out.includes('<item id="2">'));
  assert.ok(!out.includes('LAST'));
});

test('total:launched falls back to last-launched when current empty', () => {
  const root = {
    id: 'root-1',
    name: '副本族处理',
    enabled: true,
    stage: 2,
    promptGroups: [],
    extractInjectTags: ['item@id'],
    mergeStrategy: 'concat' as const,
    maxRetries: 3,
    minLength: 0,
    apiPresetName: '',
    plotWorldbookMode: 'inherit' as const,
    contextMode: 'inherit' as const,
    structuredOutputMode: 'off' as const,
    syncAsReplicaFamily: true,
    replicaFamilySpec: 'item@id',
    replicaFamilyEnumSpec: 'item@id',
    replicaFamilyBaseName: '副本族处理',
    replicaFamilyScheduleMode: 'manual' as const,
  };
  const rep2 = {
    ...root,
    id: 'rep-2',
    name: '副本族处理 2',
    syncAsReplicaFamily: false,
    replicaFamilyRootId: 'root-1',
    replicaFamilyAttrValue: '2',
    replicaFamilyLaunched: false,
  };
  const history: RelayTagMap = new Map([
    ['item@id=1', ['LAST']],
    ['item@id=2', ['OTHER']],
  ]);
  const out = replacePlotTagPlaceholdersWithHistory(
    '{{total:launched:item@id}}',
    new Map([['item@id=1', ['RELAY-ONLY']]]),
    history,
    new Set(),
    {
      historyFallback: 'all-tags',
      allTasks: [root, rep2],
      replicaState: {
        'root-1': { attrValues: ['1', '2'], launchedAttrValues: ['1'] },
      },
    },
  );
  assert.ok(out.includes('<item id="1">'));
  assert.ok(out.includes('LAST'));
  assert.ok(!out.includes('RELAY-ONLY'));
  assert.ok(!out.includes('<item id="2">'));
});

test('total:launched empty when both current and last empty', () => {
  const root = {
    id: 'root-1',
    name: '副本族处理',
    enabled: true,
    stage: 2,
    promptGroups: [],
    extractInjectTags: ['item@id'],
    mergeStrategy: 'concat' as const,
    maxRetries: 3,
    minLength: 0,
    apiPresetName: '',
    plotWorldbookMode: 'inherit' as const,
    contextMode: 'inherit' as const,
    structuredOutputMode: 'off' as const,
    syncAsReplicaFamily: true,
    replicaFamilySpec: 'item@id',
    replicaFamilyEnumSpec: 'item@id',
    replicaFamilyBaseName: '副本族处理',
    replicaFamilyScheduleMode: 'manual' as const,
  };
  const out = replacePlotTagPlaceholdersWithHistory(
    '{{total:launched:item@id}}',
    new Map(),
    new Map([['item@id=1', ['A']]]),
    new Set(),
    {
      historyFallback: 'all-tags',
      allTasks: [root],
      replicaState: { 'root-1': { attrValues: ['1'] } },
    },
  );
  assert.equal(out, '');
});

test('total:launched unions all replica families sharing spec', () => {
  const rootA = {
    id: 'root-a',
    name: '族A',
    enabled: true,
    stage: 2,
    promptGroups: [],
    extractInjectTags: ['item@id'],
    mergeStrategy: 'concat' as const,
    maxRetries: 3,
    minLength: 0,
    apiPresetName: '',
    plotWorldbookMode: 'inherit' as const,
    contextMode: 'inherit' as const,
    structuredOutputMode: 'off' as const,
    syncAsReplicaFamily: true,
    replicaFamilySpec: 'item@id',
    replicaFamilyEnumSpec: 'item@id',
    replicaFamilyBaseName: '族A',
    replicaFamilyScheduleMode: 'manual' as const,
  };
  const rootB = {
    ...rootA,
    id: 'root-b',
    name: '族B',
    replicaFamilyBaseName: '族B',
  };
  const repA = {
    ...rootA,
    id: 'rep-a1',
    name: '族A 1',
    syncAsReplicaFamily: false,
    replicaFamilyRootId: 'root-a',
    replicaFamilyAttrValue: '1',
    replicaFamilyLaunched: true,
  };
  const repB = {
    ...rootB,
    id: 'rep-b2',
    name: '族B 2',
    syncAsReplicaFamily: false,
    replicaFamilyRootId: 'root-b',
    replicaFamilyAttrValue: '2',
    replicaFamilyLaunched: true,
  };
  const history: RelayTagMap = new Map([
    ['item@id=1', ['A']],
    ['item@id=2', ['B']],
  ]);
  const out = replacePlotTagPlaceholdersWithHistory(
    '{{total:launched:item@id}}',
    new Map(),
    history,
    new Set(),
    { historyFallback: 'all-tags', allTasks: [rootA, rootB, repA, repB] },
  );
  assert.ok(out.includes('<item id="1">'));
  assert.ok(out.includes('<item id="2">'));
});

test('total:launched:spec:task narrows to one family', () => {
  const rootA = {
    id: 'root-a',
    name: '族A',
    enabled: true,
    stage: 2,
    promptGroups: [],
    extractInjectTags: ['item@id'],
    mergeStrategy: 'concat' as const,
    maxRetries: 3,
    minLength: 0,
    apiPresetName: '',
    plotWorldbookMode: 'inherit' as const,
    contextMode: 'inherit' as const,
    structuredOutputMode: 'off' as const,
    syncAsReplicaFamily: true,
    replicaFamilySpec: 'item@id',
    replicaFamilyEnumSpec: 'item@id',
    replicaFamilyBaseName: '族A',
    replicaFamilyScheduleMode: 'manual' as const,
  };
  const rootB = {
    ...rootA,
    id: 'root-b',
    name: '族B',
    replicaFamilyBaseName: '族B',
  };
  const repA = {
    ...rootA,
    id: 'rep-a1',
    name: '族A 1',
    syncAsReplicaFamily: false,
    replicaFamilyRootId: 'root-a',
    replicaFamilyAttrValue: '1',
    replicaFamilyLaunched: true,
  };
  const repB = {
    ...rootB,
    id: 'rep-b2',
    name: '族B 2',
    syncAsReplicaFamily: false,
    replicaFamilyRootId: 'root-b',
    replicaFamilyAttrValue: '2',
    replicaFamilyLaunched: true,
  };
  const history: RelayTagMap = new Map([
    ['item@id=1', ['A']],
    ['item@id=2', ['B']],
  ]);
  const out = replacePlotTagPlaceholdersWithHistory(
    '{{total:launched:item@id:族A}}',
    new Map(),
    history,
    new Set(),
    { historyFallback: 'all-tags', allTasks: [rootA, rootB, repA, repB] },
  );
  assert.ok(out.includes('<item id="1">'));
  assert.ok(!out.includes('<item id="2">'));
});

test('total:last-launched:spec:task filters by task', () => {
  const rootA = {
    id: 'root-a',
    name: '族A',
    enabled: true,
    stage: 2,
    promptGroups: [],
    extractInjectTags: ['item@id'],
    mergeStrategy: 'concat' as const,
    maxRetries: 3,
    minLength: 0,
    apiPresetName: '',
    plotWorldbookMode: 'inherit' as const,
    contextMode: 'inherit' as const,
    structuredOutputMode: 'off' as const,
    syncAsReplicaFamily: true,
    replicaFamilySpec: 'item@id',
    replicaFamilyEnumSpec: 'item@id',
    replicaFamilyBaseName: '族A',
    replicaFamilyScheduleMode: 'auto' as const,
  };
  const rootB = {
    ...rootA,
    id: 'root-b',
    name: '族B',
    replicaFamilyBaseName: '族B',
  };
  const history: RelayTagMap = new Map([
    ['item@id=1', ['A']],
    ['item@id=2', ['B']],
  ]);
  const out = replacePlotTagPlaceholdersWithHistory(
    '{{total:last-launched:item@id:族B}}',
    new Map(),
    history,
    new Set(),
    {
      historyFallback: 'all-tags',
      allTasks: [rootA, rootB],
      replicaState: {
        'root-a': { attrValues: ['1'], lastEnumAttrValues: ['1'] },
        'root-b': { attrValues: ['2'], lastEnumAttrValues: ['2'] },
      },
    },
  );
  assert.ok(out.includes('<item id="2">'));
  assert.ok(!out.includes('<item id="1">'));
});

test('total:launched per-root fallback unions current of A with last of B', () => {
  const rootA = {
    id: 'root-a',
    name: '族A',
    enabled: true,
    stage: 2,
    promptGroups: [],
    extractInjectTags: ['item@id'],
    mergeStrategy: 'concat' as const,
    maxRetries: 3,
    minLength: 0,
    apiPresetName: '',
    plotWorldbookMode: 'inherit' as const,
    contextMode: 'inherit' as const,
    structuredOutputMode: 'off' as const,
    syncAsReplicaFamily: true,
    replicaFamilySpec: 'item@id',
    replicaFamilyEnumSpec: 'item@id',
    replicaFamilyBaseName: '族A',
    replicaFamilyScheduleMode: 'manual' as const,
  };
  const rootB = {
    ...rootA,
    id: 'root-b',
    name: '族B',
    replicaFamilyBaseName: '族B',
  };
  const repA = {
    ...rootA,
    id: 'rep-a1',
    name: '族A 1',
    syncAsReplicaFamily: false,
    replicaFamilyRootId: 'root-a',
    replicaFamilyAttrValue: '1',
    replicaFamilyLaunched: true,
  };
  const repB = {
    ...rootB,
    id: 'rep-b2',
    name: '族B 2',
    syncAsReplicaFamily: false,
    replicaFamilyRootId: 'root-b',
    replicaFamilyAttrValue: '2',
    replicaFamilyLaunched: false,
  };
  const history: RelayTagMap = new Map([
    ['item@id=1', ['A']],
    ['item@id=2', ['B']],
  ]);
  const out = replacePlotTagPlaceholdersWithHistory(
    '{{total:launched:item@id}}',
    new Map(),
    history,
    new Set(),
    {
      historyFallback: 'all-tags',
      allTasks: [rootA, rootB, repA, repB],
      replicaState: {
        'root-a': { attrValues: ['1'], lastEnumAttrValues: ['9'] },
        'root-b': { attrValues: ['2'], lastEnumAttrValues: ['2'] },
      },
    },
  );
  assert.ok(out.includes('<item id="1">'));
  assert.ok(out.includes('<item id="2">'));
});

if (process.exitCode) {
  process.exit(process.exitCode);
}
