import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PostProcessTask } from './schema';
import { buildEffectivePromptGroups, buildPromptPreviewRows } from './prompt-auto-segments';

function baseTask(overrides: Partial<PostProcessTask> = {}): PostProcessTask {
  return {
    id: 't1',
    name: 'test',
    enabled: true,
    stage: 1,
    promptGroups: [
      { name: 'm0', role: 'user', content: 'manual-0', enabled: true },
      { name: 'm1', role: 'user', content: 'manual-1', enabled: true },
      { name: 'm2', role: 'user', content: 'manual-2', enabled: true },
    ],
    promptAutoSlots: [],
    promptAutoSegments: [],
    extractInjectTags: ['result'],
    mergeStrategy: 'concat',
    maxRetries: 3,
    minLength: 0,
    apiPresetName: '',
    apiPresetFallbackNames: [],
    apiPrimaryMaxConcurrency: 5,
    apiFallbackMaxConcurrencies: [],
    plotWorldbookMode: 'inherit',
    contextMode: 'inherit',
    structuredOutputMode: 'off',
    ...overrides,
  } as PostProcessTask;
}

test('buildEffectivePromptGroups inserts auto segments before manual index', () => {
  const task = baseTask({
    promptAutoSlots: [
      { id: 's0', name: 'head', order: 0 },
      { id: 's1', name: 'mid', order: 1 },
      { id: 's2', name: 'tail', order: 3 },
    ],
    promptAutoSegments: [
      { id: 'a1', slotId: 's0', name: 'auto-head', role: 'system', content: 'A0', inserted: true },
      { id: 'a2', slotId: 's1', name: 'auto-mid', role: 'system', content: 'A1', inserted: true },
      { id: 'a3', slotId: 's2', name: 'auto-tail', role: 'system', content: 'A3', inserted: true },
      { id: 'a4', slotId: 's0', name: 'off', role: 'system', content: 'off', inserted: false },
    ],
  });
  const names = buildEffectivePromptGroups(task).map(g => g.content);
  assert.deepEqual(names, ['A0', 'manual-0', 'A1', 'manual-1', 'manual-2', 'A3']);
});

test('buildEffectivePromptGroups skips non-inserted segments', () => {
  const task = baseTask({
    promptAutoSlots: [{ id: 's0', name: 'head', order: 0 }],
    promptAutoSegments: [
      { id: 'a1', slotId: 's0', name: 'off', role: 'system', content: 'skip', inserted: false },
    ],
  });
  assert.deepEqual(
    buildEffectivePromptGroups(task).map(g => g.content),
    ['manual-0', 'manual-1', 'manual-2'],
  );
});

test('buildEffectivePromptGroups with empty manual only auto at order 0', () => {
  const task = baseTask({
    promptGroups: [],
    promptAutoSlots: [{ id: 's0', name: 'only', order: 0 }],
    promptAutoSegments: [
      { id: 'a1', slotId: 's0', name: 'solo', role: 'user', content: 'solo', inserted: true },
    ],
  });
  assert.deepEqual(buildEffectivePromptGroups(task).map(g => g.content), ['solo']);
});

test('same order multiple slots merge by slot id', () => {
  const task = baseTask({
    promptGroups: [{ name: 'm', role: 'user', content: 'm', enabled: true }],
    promptAutoSlots: [
      { id: 'b', name: 'B', order: 0 },
      { id: 'a', name: 'A', order: 0 },
    ],
    promptAutoSegments: [
      { id: 'seg-b', slotId: 'b', name: 'B', role: 'system', content: 'B', inserted: true },
      { id: 'seg-a', slotId: 'a', name: 'A', role: 'system', content: 'A', inserted: true },
    ],
  });
  assert.deepEqual(buildEffectivePromptGroups(task).map(g => g.content), ['A', 'B', 'm']);
});

test('same slot segments merge by sortOrder', () => {
  const task = baseTask({
    promptGroups: [{ name: 'm', role: 'user', content: 'm', enabled: true }],
    promptAutoSlots: [{ id: 's0', name: 'head', order: 0 }],
    promptAutoSegments: [
      { id: 'a2', slotId: 's0', name: 'second', role: 'system', content: 'B', inserted: true, sortOrder: 1 },
      { id: 'a1', slotId: 's0', name: 'first', role: 'system', content: 'A', inserted: true, sortOrder: 0 },
    ],
  });
  assert.deepEqual(buildEffectivePromptGroups(task).map(g => g.content), ['A', 'B', 'm']);
});

test('buildPromptPreviewRows interleaves auto and manual rows', () => {
  const task = baseTask({
    promptGroups: [
      { name: 'm0', role: 'user', content: 'manual-0', enabled: true },
      { name: 'm1', role: 'user', content: 'manual-1', enabled: true },
    ],
    promptAutoSlots: [
      { id: 's0', name: 'head', order: 0 },
      { id: 's1', name: 'mid', order: 1 },
    ],
    promptAutoSegments: [
      { id: 'a1', slotId: 's0', name: 'auto-head', role: 'system', content: 'A0', inserted: true, sortOrder: 0 },
      { id: 'a2', slotId: 's1', name: 'auto-mid', role: 'system', content: 'A1', inserted: true, sortOrder: 0 },
      { id: 'a3', slotId: 's0', name: 'off', role: 'system', content: 'off', inserted: false, sortOrder: 1 },
    ],
  });
  const rows = buildPromptPreviewRows(task);
  assert.deepEqual(
    rows.map(row => (row.kind === 'auto' ? `auto:${row.group.content}` : `manual:${row.manualIndex}`)),
    ['auto:A0', 'manual:0', 'auto:A1', 'manual:1'],
  );
  const autoRow = rows.find(r => r.kind === 'auto' && r.segmentId === 'a1');
  assert.ok(autoRow && autoRow.kind === 'auto');
  if (autoRow.kind === 'auto') {
    assert.equal(autoRow.slotName, 'head');
  }
});
