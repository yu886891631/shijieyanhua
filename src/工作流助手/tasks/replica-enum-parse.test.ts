import assert from 'node:assert/strict';
import {
  buildDirectedEnumRegistryKey,
  collectEnumRegistryAttrValues,
  collectReplicaEnumRenames,
  composePendingReplicaRenames,
  ENUM_REGISTRY_MARKER,
  parseReplicaEnumFromResponse,
  replicaEnumResultToRegistryTags,
} from './replica-enum-parse';
import { prepareStageTasksWithReplicaSync } from './replica-family';
import type { PostProcessTask } from './schema';

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`, e);
    process.exitCode = 1;
  }
}

function findEntry(
  parsed: ReturnType<typeof parseReplicaEnumFromResponse>,
  specKey: string,
  taskRef?: string,
) {
  return parsed.entries.find(
    e => e.specKey === specKey && (e.taskRef ?? undefined) === (taskRef ?? undefined),
  );
}

test('parse single spec JSON block', () => {
  const text = `<ReplicaEnum>{"spec":"npc@id","values":["alice","bob"]}</ReplicaEnum>`;
  const parsed = parseReplicaEnumFromResponse(text);
  assert.equal(parsed.entries.length, 1);
  assert.deepEqual(findEntry(parsed, 'npc@id')?.values, ['alice', 'bob']);
  assert.equal(findEntry(parsed, 'npc@id')?.taskRef, undefined);
});

test('parse entry with optional task', () => {
  const text = `<ReplicaEnum>{"spec":"npc@id","values":["alice"],"task":"NPC后台"}</ReplicaEnum>`;
  const parsed = parseReplicaEnumFromResponse(text);
  assert.deepEqual(findEntry(parsed, 'npc@id', 'NPC后台')?.values, ['alice']);
});

test('parse batch enums array', () => {
  const text = `<ReplicaEnum>{"enums":[{"spec":"npc@id","values":["a","b"]},{"spec":"item@id","values":["1","2"]}]}</ReplicaEnum>`;
  const parsed = parseReplicaEnumFromResponse(text);
  assert.deepEqual(findEntry(parsed, 'npc@id')?.values, ['a', 'b']);
  assert.deepEqual(findEntry(parsed, 'item@id')?.values, ['1', '2']);
});

test('uses last ReplicaEnum block when multiple present', () => {
  const text = [
    '<ReplicaEnum>{"spec":"item@id","values":["1"]}</ReplicaEnum>',
    '叙述文字',
    '<ReplicaEnum>{"spec":"item@id","values":["2"]}</ReplicaEnum>',
  ].join('\n');
  const parsed = parseReplicaEnumFromResponse(text);
  assert.deepEqual(findEntry(parsed, 'item@id')?.values, ['2']);
});

test('multiple blocks uses last only directed entry', () => {
  const text = [
    '<ReplicaEnum>{"spec":"item@id","values":["1","2"]}</ReplicaEnum>',
    '<ReplicaEnum>{"spec":"item@id","values":["1"],"task":"族A"}</ReplicaEnum>',
  ].join('');
  const parsed = parseReplicaEnumFromResponse(text);
  assert.equal(findEntry(parsed, 'item@id')?.values, undefined);
  assert.deepEqual(findEntry(parsed, 'item@id', '族A')?.values, ['1']);
});

test('thinking draft then body final uses body only', () => {
  const text = [
    '<think>',
    '草稿',
    '<ReplicaEnum>{"spec":"npc@act","values":["草稿角色"],"task":"后台角色"}</ReplicaEnum>',
    '</think>',
    '<ReplicaEnum>{"spec":"npc@act","values":["正式角色"],"task":"后台角色"}</ReplicaEnum>',
  ].join('\n');
  const parsed = parseReplicaEnumFromResponse(text);
  assert.deepEqual(findEntry(parsed, 'npc@act', '后台角色')?.values, ['正式角色']);
});

test('orphan open in thinking does not swallow body ReplicaEnum', () => {
  const text = [
    '<think>',
    '预演核对，勿输出 <ReplicaEnum> 标签；名单：佐久夜',
    '还要检查 Step 4',
    '</think>',
    '<ReplicaEnum>',
    '{"enums":[{"spec":"npc@act","values":["佐久夜"],"task":"后台角色"}]}',
    '</ReplicaEnum>',
  ].join('\n');
  const parsed = parseReplicaEnumFromResponse(text);
  assert.deepEqual(findEntry(parsed, 'npc@act', '后台角色')?.values, ['佐久夜']);
});

test('unclosed open in thinking pairs with body close — last open wins', () => {
  const text = [
    '<think>',
    '格式：<ReplicaEnum>',
    '还要检查',
    '</think>',
    '<ReplicaEnum>',
    '{"enums":[{"spec":"npc@act","values":["正式角色"],"task":"后台角色"}]}',
    '</ReplicaEnum>',
  ].join('\n');
  const parsed = parseReplicaEnumFromResponse(text);
  assert.deepEqual(findEntry(parsed, 'npc@act', '后台角色')?.values, ['正式角色']);
});

test('ignore invalid entry block', () => {
  const text = [
    '<ReplicaEnum>{"spec":"","values":["1"]}</ReplicaEnum>',
    '<ReplicaEnum>{}</ReplicaEnum>',
    '<ReplicaEnum>{"spec":"item@id","values":["2"]}</ReplicaEnum>',
  ].join('');
  const parsed = parseReplicaEnumFromResponse(text);
  assert.deepEqual(findEntry(parsed, 'item@id')?.values, ['2']);
});

test('replicaEnumResultToRegistryTags broadcast uses marker', () => {
  const tags = replicaEnumResultToRegistryTags({
    entries: [{ specKey: 'item@id', values: ['1'] }],
  });
  assert.equal(tags['item@id=1'], ENUM_REGISTRY_MARKER);
});

test('replicaEnumResultToRegistryTags directed uses rootId key', () => {
  const tags = replicaEnumResultToRegistryTags(
    { entries: [{ specKey: 'item@id', values: ['1'], taskRef: '副本族处理' }] },
    taskRef =>
      taskRef === '副本族处理' ? { rootId: 'root-1', specKey: 'item@id' } : null,
  );
  const key = buildDirectedEnumRegistryKey('root-1', 'item', 'id', '1');
  assert.equal(tags[key], ENUM_REGISTRY_MARKER);
  assert.equal(tags['item@id=1'], undefined);
});

test('replicaEnumResultToRegistryTags drops mismatched spec', () => {
  const tags = replicaEnumResultToRegistryTags(
    { entries: [{ specKey: 'item@id', values: ['1'], taskRef: '族A' }] },
    () => ({ rootId: 'root-a', specKey: 'npc@act' }),
  );
  assert.deepEqual(tags, {});
});

test('broadcast suppressed when same spec has failed task intent', () => {
  const tags = replicaEnumResultToRegistryTags(
    {
      entries: [
        { specKey: 'item@id', values: ['1', '2'] },
        { specKey: 'item@id', values: ['1'], taskRef: '不存在的任务' },
      ],
    },
    () => null,
  );
  assert.equal(tags['item@id=1'], undefined);
  assert.equal(tags['item@id=2'], undefined);
  assert.deepEqual(tags, {});
});

test('broadcast suppressed when same spec has successful directed', () => {
  const tags = replicaEnumResultToRegistryTags(
    {
      entries: [
        { specKey: 'item@id', values: ['1', '2'] },
        { specKey: 'item@id', values: ['9'], taskRef: '族A' },
      ],
    },
    taskRef => (taskRef === '族A' ? { rootId: 'root-a', specKey: 'item@id' } : null),
  );
  assert.equal(tags['item@id=1'], undefined);
  assert.equal(tags['item@id=2'], undefined);
  assert.equal(tags[buildDirectedEnumRegistryKey('root-a', 'item', 'id', '9')], ENUM_REGISTRY_MARKER);
});

test('pure broadcast still writes broadcast keys', () => {
  const tags = replicaEnumResultToRegistryTags({
    entries: [{ specKey: 'item@id', values: ['1', '2'] }],
  });
  assert.equal(tags['item@id=1'], ENUM_REGISTRY_MARKER);
  assert.equal(tags['item@id=2'], ENUM_REGISTRY_MARKER);
});

test('collectEnumRegistryAttrValues ignores non-marker keys', () => {
  const relay = new Map<string, string[]>([
    ['item@id=1', [ENUM_REGISTRY_MARKER]],
    ['item@id=2', ['real content']],
  ]);
  const values = collectEnumRegistryAttrValues(relay, { tagName: 'item', attrName: 'id' });
  assert.deepEqual(values, ['1']);
});

test('collect prefers directed over broadcast for root', () => {
  const relay = new Map<string, string[]>([
    ['item@id=1', [ENUM_REGISTRY_MARKER]],
    ['item@id=2', [ENUM_REGISTRY_MARKER]],
    [buildDirectedEnumRegistryKey('root-a', 'item', 'id', '9'), [ENUM_REGISTRY_MARKER]],
  ]);
  assert.deepEqual(
    collectEnumRegistryAttrValues(relay, { tagName: 'item', attrName: 'id' }, 'root-a'),
    ['9'],
  );
  assert.deepEqual(
    collectEnumRegistryAttrValues(relay, { tagName: 'item', attrName: 'id' }, 'root-b'),
    ['1', '2'],
  );
});

test('prepareStageTasksWithReplicaSync uses registry keys only', () => {
  const root: PostProcessTask = {
    id: 'root-1',
    name: '处理 item',
    enabled: true,
    stage: 2,
    promptGroups: [{ name: '', role: 'user', content: 'do {{item@id}}', enabled: true }],
    extractInjectTags: ['result'],
    mergeStrategy: 'concat',
    maxRetries: 3,
    minLength: 0,
    apiPresetName: '',
    apiPresetFallbackNames: [],
    plotWorldbookMode: 'inherit',
    contextMode: 'inherit',
    structuredOutputMode: 'off',
    syncAsReplicaFamily: true,
    replicaFamilySpec: 'item@id',
    replicaFamilyEnumSpec: 'item@id',
    replicaFamilyScheduleMode: 'auto',
  };
  const registryRelay = new Map<string, string[]>([
    ['item@id=1', [ENUM_REGISTRY_MARKER]],
    ['item@id=2', [ENUM_REGISTRY_MARKER]],
  ]);
  const { tasks: runtimeFromRegistry } = prepareStageTasksWithReplicaSync([root], [root], registryRelay);
  assert.equal(runtimeFromRegistry.length, 2);

  const xmlRelay = new Map<string, string[]>([
    ['item@id=1', ['<item id="1">A</item>']],
    ['item@id=2', ['<item id="2">B</item>']],
  ]);
  const { tasks: runtimeFromXml, skippedRoots } = prepareStageTasksWithReplicaSync([root], [root], xmlRelay);
  assert.equal(runtimeFromXml.length, 0);
  assert.equal(skippedRoots.length, 1);
});

test('two families same spec: directed vs broadcast', () => {
  const rootA: PostProcessTask = {
    id: 'root-a',
    name: '族A',
    enabled: true,
    stage: 2,
    promptGroups: [{ name: '', role: 'user', content: '{{item@id}}', enabled: true }],
    extractInjectTags: ['result'],
    mergeStrategy: 'concat',
    maxRetries: 3,
    minLength: 0,
    apiPresetName: '',
    apiPresetFallbackNames: [],
    plotWorldbookMode: 'inherit',
    contextMode: 'inherit',
    structuredOutputMode: 'off',
    syncAsReplicaFamily: true,
    replicaFamilySpec: 'item@id',
    replicaFamilyEnumSpec: 'item@id',
    replicaFamilyBaseName: '族A',
    replicaFamilyScheduleMode: 'auto',
  };
  const rootB: PostProcessTask = {
    ...rootA,
    id: 'root-b',
    name: '族B',
    replicaFamilyBaseName: '族B',
  };
  const relay = new Map<string, string[]>([
    ['item@id=1', [ENUM_REGISTRY_MARKER]],
    ['item@id=2', [ENUM_REGISTRY_MARKER]],
    [buildDirectedEnumRegistryKey('root-a', 'item', 'id', '9'), [ENUM_REGISTRY_MARKER]],
  ]);
  const preparedA = prepareStageTasksWithReplicaSync([rootA], [rootA, rootB], relay);
  assert.equal(preparedA.tasks.length, 1);
  assert.equal(preparedA.tasks[0]!.replicaFamilyAttrValue, '9');

  const preparedB = prepareStageTasksWithReplicaSync([rootB], [rootA, rootB], relay);
  assert.equal(preparedB.tasks.length, 2);
  assert.deepEqual(
    preparedB.tasks.map(t => t.replicaFamilyAttrValue).sort(),
    ['1', '2'],
  );
});

test('parse renames with values', () => {
  const text = `<ReplicaEnum>{"spec":"item@id","renames":[{"from":"断剑","to":"锈剑"}],"values":["锈剑","药剂"]}</ReplicaEnum>`;
  const parsed = parseReplicaEnumFromResponse(text);
  const entry = findEntry(parsed, 'item@id');
  assert.deepEqual(entry?.values, ['锈剑', '药剂']);
  assert.deepEqual(entry?.renames, [{ from: '断剑', to: '锈剑' }]);
});

test('parse pure renames without values', () => {
  const text = `<ReplicaEnum>{"spec":"item@id","renames":[{"from":"a","to":"b"}]}</ReplicaEnum>`;
  const parsed = parseReplicaEnumFromResponse(text);
  const entry = findEntry(parsed, 'item@id');
  assert.deepEqual(entry?.values, []);
  assert.deepEqual(entry?.renames, [{ from: 'a', to: 'b' }]);
});

test('normalize renames drops empty and from===to; later from wins', () => {
  const text = `<ReplicaEnum>{"spec":"item@id","renames":[{"from":"","to":"x"},{"from":"a","to":"a"},{"from":"a","to":"b"},{"from":"a","to":"c"}]}</ReplicaEnum>`;
  const parsed = parseReplicaEnumFromResponse(text);
  assert.deepEqual(findEntry(parsed, 'item@id')?.renames, [{ from: 'a', to: 'c' }]);
});

test('multiple blocks uses last renames only', () => {
  const text = [
    '<ReplicaEnum>{"spec":"item@id","renames":[{"from":"a","to":"b"}]}</ReplicaEnum>',
    '<ReplicaEnum>{"spec":"item@id","renames":[{"from":"c","to":"d"}],"values":["d"]}</ReplicaEnum>',
  ].join('');
  const parsed = parseReplicaEnumFromResponse(text);
  const entry = findEntry(parsed, 'item@id');
  assert.deepEqual(entry?.values, ['d']);
  assert.deepEqual(entry?.renames, [{ from: 'c', to: 'd' }]);
});

test('registry registers rename to values not from', () => {
  const tags = replicaEnumResultToRegistryTags({
    entries: [
      {
        specKey: 'item@id',
        values: ['药剂'],
        renames: [{ from: '断剑', to: '锈剑' }],
      },
    ],
  });
  assert.equal(tags['item@id=锈剑'], ENUM_REGISTRY_MARKER);
  assert.equal(tags['item@id=药剂'], ENUM_REGISTRY_MARKER);
  assert.equal(tags['item@id=断剑'], undefined);
});

test('registry pure renames registers to', () => {
  const tags = replicaEnumResultToRegistryTags({
    entries: [{ specKey: 'item@id', values: [], renames: [{ from: 'a', to: 'b' }] }],
  });
  assert.equal(tags['item@id=b'], ENUM_REGISTRY_MARKER);
  assert.equal(tags['item@id=a'], undefined);
});

test('collectReplicaEnumRenames extracts pending list', () => {
  const parsed = parseReplicaEnumFromResponse(
    `<ReplicaEnum>{"spec":"item@id","renames":[{"from":"a","to":"b"}],"task":"族A"}</ReplicaEnum>`,
  );
  assert.deepEqual(collectReplicaEnumRenames(parsed), [
    { specKey: 'item@id', taskRef: '族A', from: 'a', to: 'b' },
  ]);
});

test('composePendingReplicaRenames merges chain in same bucket', () => {
  assert.deepEqual(
    composePendingReplicaRenames([
      { specKey: 'item@id', from: 'a', to: 'b' },
      { specKey: 'item@id', from: 'b', to: 'c' },
    ]),
    [
      { specKey: 'item@id', from: 'a', to: 'b', taskRef: undefined },
      { specKey: 'item@id', from: 'b', to: 'c', taskRef: undefined },
    ],
  );
});

test('composePendingReplicaRenames topologically sorts out-of-order edges', () => {
  assert.deepEqual(
    composePendingReplicaRenames([
      { specKey: 'item@id', from: 'b', to: 'c' },
      { specKey: 'item@id', from: 'a', to: 'b' },
    ]),
    [
      { specKey: 'item@id', from: 'a', to: 'b', taskRef: undefined },
      { specKey: 'item@id', from: 'b', to: 'c', taskRef: undefined },
    ],
  );
});

test('composePendingReplicaRenames drops cyclic edges', () => {
  assert.deepEqual(
    composePendingReplicaRenames([
      { specKey: 'item@id', from: 'a', to: 'b' },
      { specKey: 'item@id', from: 'b', to: 'a' },
    ]),
    [],
  );
});

test('directed renames register directed keys for to', () => {
  const tags = replicaEnumResultToRegistryTags(
    {
      entries: [
        { specKey: 'item@id', values: [], renames: [{ from: '1', to: '9' }], taskRef: '族A' },
      ],
    },
    taskRef => (taskRef === '族A' ? { rootId: 'root-a', specKey: 'item@id' } : null),
  );
  assert.equal(tags[buildDirectedEnumRegistryKey('root-a', 'item', 'id', '9')], ENUM_REGISTRY_MARKER);
  assert.equal(tags['item@id=9'], undefined);
});

test('parse collapses middle-dot variants in values', () => {
  const text = `<ReplicaEnum>{"spec":"npc@act","values":["波尔特・瓦伦","波尔特·瓦伦"]}</ReplicaEnum>`;
  const parsed = parseReplicaEnumFromResponse(text);
  assert.deepEqual(findEntry(parsed, 'npc@act')?.values, ['波尔特·瓦伦']);
});

test('collectEnumRegistryAttrValues unifies middle-dot variants', () => {
  const relay = new Map<string, string[]>([
    ['npc@act=波尔特・瓦伦', [ENUM_REGISTRY_MARKER]],
    ['npc@act=波尔特·瓦伦', [ENUM_REGISTRY_MARKER]],
  ]);
  assert.deepEqual(collectEnumRegistryAttrValues(relay, { tagName: 'npc', attrName: 'act' }), [
    '波尔特·瓦伦',
  ]);
});

if (process.exitCode) process.exit(process.exitCode);
