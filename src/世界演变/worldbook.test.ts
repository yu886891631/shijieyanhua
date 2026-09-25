import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { createEmptyWorld } from './types';
import { syncWorldEvolutionWorldbook } from './worldbook';

const originalGetWorldbook = globalThis.getWorldbook;
const originalReplaceWorldbook = globalThis.replaceWorldbook;

afterEach(() => {
  globalThis.getWorldbook = originalGetWorldbook;
  globalThis.replaceWorldbook = originalReplaceWorldbook;
});

test('worldbook sync keeps backstage information out and preserves unmanaged entries', async () => {
  let savedEntries: TypeFest.PartialDeep<WorldbookEntry>[] = [];
  globalThis.getWorldbook = async () =>
    [
      {
        name: 'User-owned entry',
        enabled: true,
        content: 'keep me',
        strategy: {
          type: 'constant',
          keys: [],
          keys_secondary: { logic: 'and_any', keys: [] },
          scan_depth: 'same_as_global',
        },
      } as WorldbookEntry,
    ];
  globalThis.replaceWorldbook = async (_name, entries) => {
    savedEntries = entries;
  };

  const world = createEmptyWorld('chat-test');
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

  await syncWorldEvolutionWorldbook('Test Book', world);

  const names = savedEntries.map(entry => entry.name);
  const serialized = JSON.stringify(savedEntries);
  assert.ok(names.includes('User-owned entry'));
  assert.ok(names.includes('WorldEvolution-全局'));
  assert.ok(names.includes('WorldEvolution-NPC-林青'));
  assert.ok(names.includes('WorldEvolution-事件-EV-PUBLIC'));
  assert.ok(names.includes('WorldEvolution-计划-SE-PUBLIC'));
  assert.ok(!names.includes('WorldEvolution-NPC-幕后操盘者'));
  assert.ok(!names.includes('WorldEvolution-事件-EV-HIDDEN'));
  assert.ok(!names.includes('WorldEvolution-计划-SE-HIDDEN'));
  assert.ok(serialized.includes('寻找失踪的信使'));
  assert.ok(serialized.includes('信使抵达北门'));
  assert.ok(!serialized.includes('策划宫廷政变'));
  assert.ok(!serialized.includes('政变计划进入最后准备'));
  assert.ok(!serialized.includes('密谋者发动政变'));
});
