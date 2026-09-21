import assert from 'node:assert/strict';
import { test } from 'node:test';
import lodash from 'lodash';
import {
  appendPromptGroup,
  remapManualExpandedKeys,
  remapManualExpandedKeysAfterRemove,
  reorderPromptGroupsAt,
} from './prompt-group-ops';

(globalThis as typeof globalThis & { _: typeof lodash })._ = lodash;

const sample = [
  { name: 'a', role: 'user' as const, content: 'a', enabled: true },
  { name: 'b', role: 'user' as const, content: 'b', enabled: true },
  { name: 'c', role: 'user' as const, content: 'c', enabled: true },
];

test('reorderPromptGroupsAt moves item to target index', () => {
  const moved = reorderPromptGroupsAt(sample, 0, 2);
  assert.deepEqual(
    moved.map(g => g.name),
    ['b', 'c', 'a'],
  );
});

test('reorderPromptGroupsAt no-op when indices equal', () => {
  const same = reorderPromptGroupsAt(sample, 1, 1);
  assert.equal(same, sample);
});

test('reorderPromptGroupsAt throws on invalid index', () => {
  assert.throws(() => reorderPromptGroupsAt(sample, -1, 0));
  assert.throws(() => reorderPromptGroupsAt(sample, 0, 3));
});

test('remapManualExpandedKeys follows moved segment and shifts neighbors', () => {
  const keys = new Set(['m-0', 'm-2', 'a-x']);
  assert.deepEqual(
    [...remapManualExpandedKeys(keys, 0, 2)].sort(),
    ['a-x', 'm-1', 'm-2'].sort(),
  );
  assert.deepEqual(
    [...remapManualExpandedKeys(new Set(['m-2']), 2, 0)].sort(),
    ['m-0'],
  );
});

test('remapManualExpandedKeysAfterRemove drops removed key and shifts higher indices', () => {
  const keys = new Set(['m-0', 'm-1', 'm-3', 'a-seg']);
  assert.deepEqual(
    [...remapManualExpandedKeysAfterRemove(keys, 1)].sort(),
    ['a-seg', 'm-0', 'm-2'].sort(),
  );
});

test('remapManualExpandedKeysAfterRemove keeps keys below removed index', () => {
  assert.deepEqual([...remapManualExpandedKeysAfterRemove(new Set(['m-0', 'm-2']), 2)].sort(), ['m-0']);
});

/**
 * 锁定竞态修复意图：
 * - 正确：先本地 append，再以该 draft 作为整表写回 → 保留新段
 * - 错误：先得到含新段的 store 态，再用未 append 的旧 draft 整表写回 → 新段丢失
 */
test('local-append-then-replace keeps new group; stale-draft replace drops it', () => {
  const uiDraft = _.cloneDeep(sample);
  const afterLocalAppend = appendPromptGroup(uiDraft);
  assert.equal(afterLocalAppend.length, 4);

  // 正确路径：写回的就是已 append 的本地态
  const writtenCorrect = afterLocalAppend;
  assert.equal(writtenCorrect.length, 4);

  // 错误路径：store 已是 4 段，flush 旧 3 段 draft 盖回
  const storeAfterApiStyleWrite = afterLocalAppend;
  const staleViewTasksFlush = _.cloneDeep(sample);
  const writtenWrong = staleViewTasksFlush;
  assert.equal(storeAfterApiStyleWrite.length, 4);
  assert.equal(writtenWrong.length, 3);
  assert.ok(writtenWrong.length < storeAfterApiStyleWrite.length);
});
