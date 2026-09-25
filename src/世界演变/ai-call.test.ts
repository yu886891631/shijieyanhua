import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildWorldEvolutionPrompt,
  callWorldEvolutionAi,
  setWorldEvolutionAiCaller,
} from './engine';
import { createEmptyWorld, DEFAULT_WORLD_EVOLUTION_SETTINGS, type WorldEvolutionInput } from './types';

test('world evolution AI caller can be replaced by a deterministic simulator', async () => {
  const calls: Array<{ prompt: string; enabled: boolean }> = [];
  setWorldEvolutionAiCaller(async (prompt, settings) => {
    calls.push({ prompt, enabled: settings.enabled });
    return JSON.stringify({
      baseRevision: 0,
      updates: [],
      events: [],
      scheduledEvents: [],
    });
  });

  try {
    const response = await callWorldEvolutionAi('模拟楼层', {
      ...DEFAULT_WORLD_EVOLUTION_SETTINGS,
      enabled: true,
    });
    assert.deepEqual(JSON.parse(response), {
      baseRevision: 0,
      updates: [],
      events: [],
      scheduledEvents: [],
    });
    assert.deepEqual(calls, [{ prompt: '模拟楼层', enabled: true }]);
  } finally {
    setWorldEvolutionAiCaller(undefined);
  }
});

test('world evolution AI caller propagates simulated failures without calling a real API', async () => {
  setWorldEvolutionAiCaller(async () => {
    throw new Error('simulated-timeout');
  });

  try {
    await assert.rejects(
      callWorldEvolutionAi('超时楼层', DEFAULT_WORLD_EVOLUTION_SETTINGS),
      /simulated-timeout/,
    );
  } finally {
    setWorldEvolutionAiCaller(undefined);
  }
});

test('world evolution prompt includes MVU, workflow and database context without invoking an API', () => {
  const world = createEmptyWorld('chat-context');
  world.entities['npc:林青'] = {
    id: 'npc:林青',
    type: 'npc',
    name: '林青',
    state: { goal: '寻找信使' },
    visibility: 'ai_context',
    updatedAt: 1,
  };
  const input: WorldEvolutionInput = {
    chatKey: 'chat-context',
    messageId: 12,
    latestMessage: '林青离开了北门。',
    mvuSnapshot: { world: { time: '春日' } },
    previousMvuSnapshot: { world: { time: '冬日' } },
    mvuChangeSummary: '{"time":"冬日→春日"}',
    databaseSummary: '{"workflow":"角色表已更新"}',
    databaseSnapshot: { 角色表: { rows: [{ name: '林青', location: '北门' }] } },
    candidateNames: ['林青'],
    currentTime: '春日-01日-10:00',
    currentLocation: '北门',
  };

  const prompt = buildWorldEvolutionPrompt(input, world, DEFAULT_WORLD_EVOLUTION_SETTINGS);
  assert.match(prompt, /角色表已更新/);
  assert.match(prompt, /林青/);
  assert.match(prompt, /北门/);
  assert.match(prompt, /当前 MVU 快照/);
  assert.match(prompt, /数据库当前表快照/);
});
