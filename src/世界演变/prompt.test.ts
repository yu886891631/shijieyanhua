import assert from 'node:assert/strict';
import { test } from 'node:test';
import { INITIAL_WORLD_EVOLUTION_PROMPT, normalizeWorldEvolutionPromptMessages } from './prompt';

test('prompt draft importer preserves the exported message roles case-insensitively', () => {
  const messages = normalizeWorldEvolutionPromptMessages([
    { role: 'USER', content: '第一条' },
    { role: 'assistant', content: '第二条' },
    { role: 'system', content: '第三条' },
  ]);

  assert.deepEqual(
    messages.map(message => message.role),
    ['USER', 'ASSISTANT', 'SYSTEM'],
  );
});

test('empty or malformed prompt imports fall back to the safe world-evolution draft', () => {
  assert.deepEqual(normalizeWorldEvolutionPromptMessages([]), INITIAL_WORLD_EVOLUTION_PROMPT);
  assert.deepEqual(normalizeWorldEvolutionPromptMessages(null), INITIAL_WORLD_EVOLUTION_PROMPT);
});
