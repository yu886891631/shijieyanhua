import assert from 'node:assert/strict';
import { refreshNestedExtractTagsInContent, type RelayTagMap } from './utils';

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`, e);
    process.exitCode = 1;
  }
}

test('nested refresh updates inner bare tag inside outer', () => {
  const relay: RelayTagMap = new Map([['npc', ['updated']]]);
  const out = refreshNestedExtractTagsInContent(
    '<story><npc>stale</npc></story>',
    relay,
    new Map(),
    new Set(['npc']),
    { historyFallback: 'all-tags' },
  );
  assert.equal(out, '<story><npc>updated</npc></story>');
});

test('nested refresh updates composite attr tag', () => {
  const relay: RelayTagMap = new Map([['item@id=1', ['<item id="1">new</item>']]]);
  const out = refreshNestedExtractTagsInContent(
    '<wrap><item id="1">old</item></wrap>',
    relay,
    new Map(),
    new Set(['item@id']),
    { historyFallback: 'all-tags' },
  );
  assert.equal(out, '<wrap><item id="1">new</item></wrap>');
});

test('nested refresh multi-pass for deep nesting', () => {
  const relay: RelayTagMap = new Map([
    ['inner', ['deep']],
    ['mid', ['<inner>deep</inner>']],
  ]);
  const out = refreshNestedExtractTagsInContent(
    '<outer><mid><inner>stale</inner></mid></outer>',
    relay,
    new Map(),
    new Set(['inner', 'mid']),
    { historyFallback: 'all-tags' },
  );
  assert.equal(out, '<outer><mid><inner>deep</inner></mid></outer>');
});

if (process.exitCode) {
  process.exit(process.exitCode);
}
