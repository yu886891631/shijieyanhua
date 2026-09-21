import assert from 'node:assert/strict';
import {
  commaSeparatedListsEqual,
  formatCommaSeparatedList,
  parseCommaSeparatedList,
} from './comma-separated';

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`, e);
    process.exitCode = 1;
  }
}

test('parse half-width commas', () => {
  assert.deepEqual(parseCommaSeparatedList('a,b,c'), ['a', 'b', 'c']);
});

test('parse full-width commas', () => {
  assert.deepEqual(parseCommaSeparatedList('a，b，c'), ['a', 'b', 'c']);
});

test('parse mixed commas', () => {
  assert.deepEqual(parseCommaSeparatedList('a,b，c'), ['a', 'b', 'c']);
});

test('parse drops trailing empty segments', () => {
  assert.deepEqual(parseCommaSeparatedList('recall,'), ['recall']);
  assert.deepEqual(parseCommaSeparatedList('recall，'), ['recall']);
  assert.deepEqual(parseCommaSeparatedList('a, ,b，,'), ['a', 'b']);
});

test('parse trims whitespace', () => {
  assert.deepEqual(parseCommaSeparatedList('  a , b ， c  '), ['a', 'b', 'c']);
});

test('parse empty', () => {
  assert.deepEqual(parseCommaSeparatedList(''), []);
  assert.deepEqual(parseCommaSeparatedList('   '), []);
  assert.deepEqual(parseCommaSeparatedList(',，,'), []);
});

test('format joins with half-width comma', () => {
  assert.equal(formatCommaSeparatedList(['a', 'b']), 'a,b');
  assert.equal(formatCommaSeparatedList(['  a  ', '', 'b']), 'a,b');
  assert.equal(formatCommaSeparatedList([]), '');
});

test('lists equal', () => {
  assert.equal(commaSeparatedListsEqual(['a', 'b'], ['a', 'b']), true);
  assert.equal(commaSeparatedListsEqual(['a'], ['a', 'b']), false);
});
