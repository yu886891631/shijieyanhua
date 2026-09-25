import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  callWorldEvolutionAi,
  setWorldEvolutionAiCaller,
} from './engine';
import { DEFAULT_WORLD_EVOLUTION_SETTINGS } from './types';

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
