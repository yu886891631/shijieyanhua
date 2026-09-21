import assert from 'node:assert/strict';
import {
  mergeTaskExecutionOptions,
  normalizeExtractInjectTags,
} from './task-extract-tags-merge';

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`, e);
    process.exitCode = 1;
  }
}

test('normalizeExtractInjectTags accepts bare and attr specs', () => {
  const tags = normalizeExtractInjectTags(['result', 'item@id', '  item@id  ']);
  assert.deepEqual(tags, ['result', 'item@id']);
});

test('normalizeExtractInjectTags rejects invalid spec', () => {
  assert.throws(() => normalizeExtractInjectTags(['@bad']), /无效提取标签规格/);
});

test('normalizeExtractInjectTags requires at least one tag', () => {
  assert.throws(() => normalizeExtractInjectTags(['', '  ']), /至少需要一个提取标签/);
});

test('mergeTaskExecutionOptions validates maxRetries', () => {
  assert.throws(
    () => mergeTaskExecutionOptions({ maxRetries: 3, minLength: 0 }, { maxRetries: 0 }),
    /maxRetries 无效/,
  );
  const merged = mergeTaskExecutionOptions({ maxRetries: 3, minLength: 0 }, { maxRetries: 5 });
  assert.equal(merged.maxRetries, 5);
});

test('mergeTaskExecutionOptions validates minLength', () => {
  assert.throws(
    () => mergeTaskExecutionOptions({ maxRetries: 3, minLength: 0 }, { minLength: -1 }),
    /minLength 无效/,
  );
});

test('mergeTaskExecutionOptions normalizes skipIfTagsFound', () => {
  const merged = mergeTaskExecutionOptions(
    { maxRetries: 3, minLength: 0 },
    { skipIfTagsFound: ['skip', ' Skip ', ''] },
  );
  assert.deepEqual(merged.skipIfTagsFound, ['skip', 'Skip']);
});
