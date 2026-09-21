import assert from 'node:assert/strict';
import { getChatExtractTagSpecs } from './tag-extract';

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`, e);
    process.exitCode = 1;
  }
}

test('getChatExtractTagSpecs trims and filters user list', () => {
  assert.deepEqual(getChatExtractTagSpecs({ user: [' input ', 'ctx'], assistant: ['ai'] }, 'user'), [
    'input',
    'ctx',
  ]);
});

test('getChatExtractTagSpecs returns assistant list', () => {
  assert.deepEqual(getChatExtractTagSpecs({ user: [], assistant: ['ai'] }, 'assistant'), ['ai']);
});

test('getChatExtractTagSpecs empty when missing config', () => {
  assert.deepEqual(getChatExtractTagSpecs(undefined, 'user'), []);
});

if (process.exitCode) {
  process.exit(process.exitCode);
}
