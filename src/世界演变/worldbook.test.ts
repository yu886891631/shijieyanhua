import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { createEmptyWorld } from './types';
import {
  buildWorldEvolutionProjections,
  inspectWorldEvolutionWorldbook,
  rebuildWorldEvolutionWorldbook,
  resolveCurrentCharacterWorldbookName,
  syncWorldEvolutionWorldbook,
} from './worldbook';

const originalGetWorldbook = globalThis.getWorldbook;
const originalUpdateWorldbookWith = globalThis.updateWorldbookWith;
const originalCreateWorldbookEntries = globalThis.createWorldbookEntries;
const originalDeleteWorldbookEntries = globalThis.deleteWorldbookEntries;
const originalGetCharWorldbookNames = globalThis.getCharWorldbookNames;

type MockWorldbook = {
  entries: WorldbookEntry[];
  updates: number;
  creates: number;
  deletes: number;
};

function fullEntry(input: Partial<WorldbookEntry> & Pick<WorldbookEntry, 'name' | 'uid'>): WorldbookEntry {
  return {
    name: input.name,
    uid: input.uid,
    enabled: input.enabled ?? true,
    strategy: input.strategy ?? {
      type: 'constant',
      keys: [],
      keys_secondary: { logic: 'and_any', keys: [] },
      scan_depth: 'same_as_global',
    },
    position: input.position ?? {
      type: 'at_depth',
      role: 'system',
      depth: 2,
      order: 100,
    },
    content: input.content ?? '',
    probability: input.probability ?? 100,
    recursion: input.recursion ?? {
      prevent_incoming: true,
      prevent_outgoing: true,
      delay_until: null,
    },
    effect: input.effect ?? {
      sticky: null,
      cooldown: null,
      delay: null,
    },
    extra: input.extra,
  };
}

function installMock(initial: WorldbookEntry[]): MockWorldbook {
  const state: MockWorldbook = {
    entries: structuredClone(initial),
    updates: 0,
    creates: 0,
    deletes: 0,
  };
  globalThis.getWorldbook = async () => structuredClone(state.entries);
  globalThis.updateWorldbookWith = async (_name, updater) => {
    state.updates += 1;
    state.entries = (await updater(structuredClone(state.entries))) as WorldbookEntry[];
    return structuredClone(state.entries);
  };
  globalThis.createWorldbookEntries = async (_name, partials) => {
    state.creates += 1;
    const newEntries = partials.map((partial, index) =>
      fullEntry({
        ...(partial as Partial<WorldbookEntry>),
        name: String(partial.name ?? `created-${index}`),
        uid: Math.max(0, ...state.entries.map(entry => entry.uid)) + index + 1,
      }),
    );
    state.entries.push(...newEntries);
    return { worldbook: structuredClone(state.entries), new_entries: structuredClone(newEntries) };
  };
  globalThis.deleteWorldbookEntries = async (_name, predicate) => {
    state.deletes += 1;
    const deleted_entries = state.entries.filter(predicate);
    state.entries = state.entries.filter(entry => !predicate(entry));
    return { worldbook: structuredClone(state.entries), deleted_entries };
  };
  return state;
}

function createWorld(chatKey = 'chat-test') {
  const world = createEmptyWorld(chatKey);
  world.revision = 4;
  world.entities = {
    'npc:visible': {
      id: 'npc:visible',
      type: 'npc',
      name: '林青',
      state: { goal: '寻找失踪的信使' },
      visibility: 'ai_context',
      updatedAt: 1,
    },
    'npc:hidden': {
      id: 'npc:hidden',
      type: 'npc',
      name: '幕后操盘者',
      state: { secret: '策划宫廷政变' },
      visibility: 'backstage',
      updatedAt: 1,
    },
  };
  world.events = [
    {
      id: 'EV-PUBLIC',
      type: 'npc_action',
      actors: ['林青'],
      summary: '林青出城寻找信使',
      visibility: 'ai_context',
      sourceMessageId: 3,
      createdAt: 1,
    },
    {
      id: 'EV-HIDDEN',
      type: 'conspiracy',
      actors: ['幕后操盘者'],
      summary: '政变计划进入最后准备',
      visibility: 'backstage',
      sourceMessageId: 3,
      createdAt: 1,
    },
  ];
  world.scheduledEvents = [
    {
      id: 'SE-PUBLIC',
      title: '信使抵达北门',
      trigger: '次日清晨',
      actors: ['林青'],
      visibility: 'ai_context',
      status: 'pending',
      createdAt: 1,
    },
    {
      id: 'SE-HIDDEN',
      title: '密谋者发动政变',
      trigger: '王宴开始时',
      actors: ['幕后操盘者'],
      visibility: 'backstage',
      status: 'pending',
      createdAt: 1,
    },
  ];
  return world;
}

afterEach(() => {
  globalThis.getWorldbook = originalGetWorldbook;
  globalThis.updateWorldbookWith = originalUpdateWorldbookWith;
  globalThis.createWorldbookEntries = originalCreateWorldbookEntries;
  globalThis.deleteWorldbookEntries = originalDeleteWorldbookEntries;
  globalThis.getCharWorldbookNames = originalGetCharWorldbookNames;
});

test('世界演变默认解析当前角色卡 primary 世界书，不使用 additional 或旧手动书名', () => {
  globalThis.getCharWorldbookNames = () => ({
    primary: '  角色卡主世界书  ',
    additional: ['附加世界书'],
  });
  assert.equal(resolveCurrentCharacterWorldbookName(), '角色卡主世界书');
});

test('当前角色卡没有 primary 世界书时不返回任意回退书名', () => {
  globalThis.getCharWorldbookNames = () => ({
    primary: null,
    additional: ['附加世界书'],
  });
  assert.equal(resolveCurrentCharacterWorldbookName(), null);
});

test('精确投影保留用户条目、过滤后台对象并使用稳定键', async () => {
  const state = installMock([fullEntry({ name: 'User-owned entry', uid: 1, content: 'keep me' })]);
  const world = createWorld();

  await syncWorldEvolutionWorldbook('Test Book', world);

  const names = state.entries.map(entry => entry.name);
  assert.ok(names.includes('User-owned entry'));
  assert.ok(names.includes('WorldEvolution-索引'));
  assert.ok(names.includes('WorldEvolution-NPC-npc:visible'));
  assert.ok(names.includes('WorldEvolution-事件-EV-PUBLIC'));
  assert.ok(names.includes('WorldEvolution-计划-SE-PUBLIC'));
  assert.ok(!names.includes('WorldEvolution-NPC-npc:hidden'));
  assert.ok(!names.includes('WorldEvolution-事件-EV-HIDDEN'));
  assert.ok(!names.includes('WorldEvolution-计划-SE-HIDDEN'));
  const npc = state.entries.find(entry => entry.name === 'WorldEvolution-NPC-npc:visible');
  assert.equal(npc?.extra?.managedBy, 'world-evolution-db-v1');
  assert.equal(npc?.extra?.chatKey, 'chat-test');
  assert.equal(typeof npc?.extra?.projectionKey, 'string');
  assert.equal(typeof npc?.extra?.contentFingerprint, 'string');
});

test('内容不变时跳过世界书写入，内容变化只更新原 UID', async () => {
  const state = installMock([]);
  const world = createWorld();
  await syncWorldEvolutionWorldbook('Stable Book', world);
  const first = state.entries.find(entry => entry.name === 'WorldEvolution-NPC-npc:visible');
  assert.ok(first);
  const writesAfterCreate = { updates: state.updates, creates: state.creates, deletes: state.deletes };

  await syncWorldEvolutionWorldbook('Stable Book', structuredClone(world));
  assert.deepEqual({ updates: state.updates, creates: state.creates, deletes: state.deletes }, writesAfterCreate);

  const changed = structuredClone(world);
  changed.entities['npc:visible']!.state.goal = '改走南门';
  await syncWorldEvolutionWorldbook('Stable Book', changed);
  const second = state.entries.find(entry => entry.name === 'WorldEvolution-NPC-npc:visible');
  assert.equal(second?.uid, first.uid);
  assert.match(second?.content ?? '', /改走南门/);
  assert.equal(state.creates, writesAfterCreate.creates);
  assert.equal(state.updates, writesAfterCreate.updates + 1);
});

test('托管条目被手动改写时，指纹会发现漂移并恢复投影', async () => {
  const state = installMock([]);
  const world = createWorld('drift-chat');
  await syncWorldEvolutionWorldbook('Drift Book', world);
  const entry = state.entries.find(item => item.name === 'WorldEvolution-NPC-npc:visible');
  assert.ok(entry);
  entry.content = '用户误改的内容';
  const updatesBefore = state.updates;

  await syncWorldEvolutionWorldbook('Drift Book', world);

  assert.equal(state.updates, updatesBefore + 1);
  assert.match(state.entries.find(item => item.uid === entry.uid)?.content ?? '', /寻找失踪的信使/);
});

test('删除或隐藏对象时只清理本插件本聊天的孤儿条目', async () => {
  const state = installMock([]);
  const world = createWorld('chat-cleanup');
  await syncWorldEvolutionWorldbook('Cleanup Book', world);
  const removed = state.entries.find(entry => entry.name === 'WorldEvolution-NPC-npc:visible');
  assert.ok(removed);
  const otherChat = fullEntry({
    name: 'WorldEvolution-NPC-npc:other',
    uid: 900,
    content: 'other chat',
    extra: {
      acuWorldEvolution: true,
      managedBy: 'world-evolution-db-v1',
      chatKey: 'other-chat',
      projectionKey: JSON.stringify(['other-chat', 'npc', 'npc:other']),
      contentFingerprint: 'other',
    },
  });
  state.entries.push(otherChat);
  delete world.entities['npc:visible'];
  await syncWorldEvolutionWorldbook('Cleanup Book', world);

  assert.ok(!state.entries.some(entry => entry.uid === removed.uid));
  assert.ok(state.entries.some(entry => entry.uid === otherChat.uid));
  assert.ok(state.entries.some(entry => entry.name === 'User-owned entry') === false);
});

test('改名复用稳定条目而不是创建第二条', async () => {
  const state = installMock([]);
  const world = createWorld('rename-chat');
  await syncWorldEvolutionWorldbook('Rename Book', world);
  const before = state.entries.find(entry => entry.name === 'WorldEvolution-NPC-npc:visible');
  assert.ok(before);

  const renamed = structuredClone(world);
  renamed.entities['npc:visible']!.name = '林青（新名）';
  await syncWorldEvolutionWorldbook('Rename Book', renamed);
  const after = state.entries.find(entry => entry.extra?.projectionRowId === 'npc:visible');
  assert.equal(after?.uid, before.uid);
  assert.equal(after?.name, 'WorldEvolution-NPC-npc:visible');
  assert.ok(!state.entries.some(entry => entry.name === 'WorldEvolution-NPC-林青（新名）'));
  assert.deepEqual(
    buildWorldEvolutionProjections(renamed)
      .filter(item => item.rowId === 'npc:visible')
      .map(item => item.stableName),
    ['WorldEvolution-NPC-npc:visible'],
  );
});

test('旧版 managedBy 条目按显示名迁移到稳定键', async () => {
  const old = fullEntry({
    name: 'WorldEvolution-NPC-林青',
    uid: 33,
    content: '旧状态',
    extra: { acuWorldEvolution: true, managedBy: 'world-evolution-v1' },
  });
  const state = installMock([old]);
  await syncWorldEvolutionWorldbook('Migration Book', createWorld('migration-chat'));
  const migrated = state.entries.find(entry => entry.extra?.projectionRowId === 'npc:visible');
  assert.equal(migrated?.uid, 33);
  assert.equal(migrated?.name, 'WorldEvolution-NPC-npc:visible');
  assert.equal(migrated?.extra?.managedBy, 'world-evolution-db-v1');
});

test('投影检查能区分缺失、孤儿和内容漂移', async () => {
  const state = installMock([]);
  const world = createWorld('inspection-chat');
  const empty = await inspectWorldEvolutionWorldbook('Inspection Book', world);
  assert.equal(empty.projectionCount, 4);
  assert.equal(empty.missingCount, 4);
  assert.equal(empty.orphanCount, 0);

  await syncWorldEvolutionWorldbook('Inspection Book', world);
  const npc = state.entries.find(entry => entry.name === 'WorldEvolution-NPC-npc:visible');
  assert.ok(npc);
  npc.content = '用户改写';
  state.entries.push(
    fullEntry({
      name: 'WorldEvolution-NPC-orphan',
      uid: 999,
      content: '孤儿',
      extra: {
        acuWorldEvolution: true,
        managedBy: 'world-evolution-db-v1',
        chatKey: 'inspection-chat',
        projectionKey: JSON.stringify(['inspection-chat', 'npc', 'npc:orphan']),
      },
    }),
  );

  const inspected = await inspectWorldEvolutionWorldbook('Inspection Book', world);
  assert.equal(inspected.missingCount, 0);
  assert.equal(inspected.orphanCount, 1);
  assert.equal(inspected.driftCount, 1);
});

test('完整重建只重建当前聊天投影并保留用户与其它聊天条目', async () => {
  const state = installMock([fullEntry({ name: '用户条目', uid: 1, content: '保留' })]);
  const world = createWorld('rebuild-chat');
  await syncWorldEvolutionWorldbook('Rebuild Book', world);
  const otherChat = fullEntry({
    name: 'WorldEvolution-NPC-other',
    uid: 800,
    content: '其它聊天',
    extra: {
      acuWorldEvolution: true,
      managedBy: 'world-evolution-db-v1',
      chatKey: 'other-chat',
      projectionKey: JSON.stringify(['other-chat', 'npc', 'npc:other']),
      contentFingerprint: 'other',
    },
  });
  state.entries.push(otherChat);
  const createsBefore = state.creates;
  const deletesBefore = state.deletes;

  await rebuildWorldEvolutionWorldbook('Rebuild Book', world);

  assert.equal(state.creates, createsBefore + 1);
  assert.equal(state.deletes, deletesBefore + 1);
  assert.ok(state.entries.some(entry => entry.name === '用户条目'));
  assert.ok(state.entries.some(entry => entry.uid === otherChat.uid));
  assert.ok(state.entries.some(entry => entry.name === 'WorldEvolution-NPC-npc:visible'));
  assert.equal(state.entries.filter(entry => entry.extra?.chatKey === 'rebuild-chat').length, 4);
});
