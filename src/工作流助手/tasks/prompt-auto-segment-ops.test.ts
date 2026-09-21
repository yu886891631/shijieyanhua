import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  appendPromptAutoSegment,
  sortSegmentsInSlot,
} from './prompt-auto-segment-ops';

const slotId = 'slot-a';

test('sortSegmentsInSlot orders by sortOrder with array index tie-break', () => {
  const segments = [
    { id: 's2', slotId, name: 'b', role: 'system' as const, content: 'b', inserted: false, sortOrder: 1 },
    { id: 's1', slotId, name: 'a', role: 'system' as const, content: 'a', inserted: false, sortOrder: 0 },
    { id: 'other', slotId: 'other', name: 'x', role: 'system' as const, content: 'x', inserted: false, sortOrder: 0 },
  ];
  assert.deepEqual(sortSegmentsInSlot(segments, slotId).map(s => s.id), ['s1', 's2']);
});

test('appendPromptAutoSegment assigns incremental sortOrder in slot', () => {
  let segments = appendPromptAutoSegment([], slotId);
  segments = appendPromptAutoSegment(segments, slotId);
  const inSlot = sortSegmentsInSlot(segments, slotId);
  assert.deepEqual(inSlot.map(s => s.sortOrder), [0, 1]);
});
