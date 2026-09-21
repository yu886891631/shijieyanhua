import assert from 'node:assert/strict';
import lodash from 'lodash';

(globalThis as typeof globalThis & { _: typeof lodash })._ = lodash;

import { parseJsonPatchOpsWithIssues } from './patch-parse-lenient';
import {
  clearPatchLog,
  createPatchLogEntry,
  getLastPatchLog,
  mergePatchLogAfterManualApply,
  mergePatchLogEntries,
  setLastPatchLog,
} from './patch-log';
import { applyOpsToFloor, updateAddonFromMessage } from './update';
import { normalizeAddonData, type AddonData } from './schema';

(globalThis as any).getChatMessages = () => [{ message: '' }];
(globalThis as any).toastr = { warning: () => {}, error: () => {}, info: () => {} };
(globalThis as any).eventEmit = async () => {};
(globalThis as any).getVariables = () => ({});
(globalThis as any).updateVariablesWith = (fn: (v: Record<string, unknown>) => Record<string, unknown>) => {
  fn({});
};
(globalThis as any).getScriptId = () => 'test';
(globalThis as any).getScriptTrees = () => [];

function baseWorld(): AddonData {
  return normalizeAddonData({
    世界: {
      阿斯塔利亚: {
        降临: true,
        平行演化: false,
        刊报日期: '旧',
      },
    },
    位面交汇: false,
  });
}

async function main() {
  {
    clearPatchLog();
    const raw = `[
    { "op": "insert", "path": "/阿斯塔利亚/x", "value": { "a": 1 },
    { "op": "replace", "path": "/阿斯塔利亚/刊报日期", "value": "d2" }
  ]`;
    const { ops, issues, failedFragments } = parseJsonPatchOpsWithIssues(raw);
    assert.equal(ops.length, 2);
    assert.equal(failedFragments.length, 0);
    assert.ok(issues.some(i => i.kind === 'heal'));
    console.log('ok parse heals missing braces (no failedFragments)');
  }

  {
    clearPatchLog();
    assert.equal(getLastPatchLog(), null);
    const entry = createPatchLogEntry({
      ops: [{ op: 'replace', path: '/世界/阿斯塔利亚/刊报日期', value: 'x' }],
      issues: [],
      failedFragments: [],
      changed: true,
      messageId: 3,
    });
    setLastPatchLog(entry);
    assert.equal(getLastPatchLog()?.messageId, 3);
    clearPatchLog();
    assert.equal(getLastPatchLog(), null);
    console.log('ok store set/get/clear patch log');
  }

  {
    clearPatchLog();
    const message = `<AddonJSONPatch>
[
  { "op": "insert", "path": "/a", "value": { "x": "未闭合
]
</AddonJSONPatch>`;
    const result = await updateAddonFromMessage(message, baseWorld(), { emitEvents: false });
    assert.equal(result, undefined);
    const log = getLastPatchLog();
    assert.ok(log);
    assert.equal(log!.ops.length, 0);
    assert.ok(log!.issues.some(i => i.kind === 'parse'));
    assert.ok(log!.failedFragments.length >= 1);
    console.log('ok updateAddonFromMessage records log when all ops bad');
  }

  {
    clearPatchLog();
    const base = baseWorld();
    const result = await applyOpsToFloor(
      [{ op: 'replace', path: '/阿斯塔利亚/刊报日期', value: '手工' }],
      base,
      { emitEvents: false },
    );
    assert.equal(result.changed, true);
    assert.equal(_.get(result.data, '世界.阿斯塔利亚.刊报日期'), '手工');
    assert.equal(getLastPatchLog()?.ops.length, 1);
    assert.equal(
      (getLastPatchLog()!.ops[0] as { path: string }).path,
      '/世界/阿斯塔利亚/刊报日期',
    );
    console.log('ok applyOpsToFloor writes field and log');
  }

  {
    clearPatchLog();
    setLastPatchLog(
      createPatchLogEntry({
        messageId: 1,
        changed: true,
        ops: [
          { op: 'replace', path: '/世界/阿斯塔利亚/刊报日期', value: '旧日期' },
          { op: 'replace', path: '/世界/阿斯塔利亚/时代快讯/世界时代阶段/时代阶段', value: '中期' },
        ],
        issues: [{ kind: 'parse', message: '第 1 条 op 无法修复: bad' }],
        failedFragments: [
          {
            index: 1,
            snippet: '{ "op": "insert", "path": "/阿斯塔利亚/坏条目", "value": {',
            message: '第 1 条 op 无法修复: bad',
          },
        ],
      }),
    );

    const mergedOnly = mergePatchLogAfterManualApply(getLastPatchLog(), {
      ops: [{ op: 'insert', path: '/世界/阿斯塔利亚/坏条目', value: { ok: true } }],
      issues: [],
      changed: true,
      resolvedFragmentIndexes: [1],
    });
    assert.equal(mergedOnly.ops.length, 3);
    assert.ok(mergedOnly.ops.some(o => 'path' in o && o.path === '/世界/阿斯塔利亚/刊报日期'));
    assert.ok(
      mergedOnly.ops.some(
        o => 'path' in o && o.path === '/世界/阿斯塔利亚/时代快讯/世界时代阶段/时代阶段',
      ),
    );
    assert.ok(mergedOnly.ops.some(o => 'path' in o && o.path === '/世界/阿斯塔利亚/坏条目'));
    assert.equal(mergedOnly.failedFragments.length, 0);
    assert.ok(!mergedOnly.issues.some(i => i.message.includes('第 1 条')));
    assert.equal(mergedOnly.manualFixedOps.length, 1);
    assert.ok(
      mergedOnly.manualFixedOps.some(o => 'path' in o && o.path === '/世界/阿斯塔利亚/坏条目'),
    );
    console.log('ok mergePatchLogAfterManualApply keeps other ops');
  }

  {
    clearPatchLog();
    setLastPatchLog(
      createPatchLogEntry({
        messageId: 1,
        changed: false,
        ops: [],
        issues: [{ kind: 'parse', message: '第 2 条 op 无法修复: bad' }],
        failedFragments: [
          {
            index: 2,
            snippet: '{ "op": "replace", "path": "/阿斯塔利亚/刊报日期", "value":',
            message: '第 2 条 op 无法修复: bad',
          },
        ],
      }),
    );
    const failedMerge = mergePatchLogAfterManualApply(getLastPatchLog(), {
      ops: [{ op: 'replace', path: '/世界/阿斯塔利亚/刊报日期', value: 'x' }],
      issues: [
        {
          kind: 'apply',
          message: 'apply failed',
          op: { op: 'replace', path: '/世界/阿斯塔利亚/刊报日期', value: 'x' },
        },
      ],
      changed: false,
    });
    assert.equal(failedMerge.manualFixedOps.length, 0);
    console.log('ok merge does not write manualFixedOps on apply failure');
  }

  {
    clearPatchLog();
    const merged = mergePatchLogEntries(
      createPatchLogEntry({
        messageId: 1,
        changed: false,
        ops: [],
        issues: [{ kind: 'parse', message: '第 1 条 op 无法修复: a' }],
        failedFragments: [
          {
            index: 1,
            snippet: '{ "op": "insert", "path": "/阿斯塔利亚/a", "value": {',
            message: '第 1 条 op 无法修复: a',
          },
        ],
      }),
      {
        messageId: 1,
        changed: false,
        ops: [],
        issues: [{ kind: 'parse', message: '第 1 条 op 无法修复: b' }],
        failedFragments: [
          {
            index: 1,
            snippet: '{ "op": "insert", "path": "/阿斯塔利亚/b", "value": {',
            message: '第 1 条 op 无法修复: b',
          },
        ],
      },
      { recordSuccessfulAsManual: false },
    );
    assert.equal(merged.failedFragments.length, 2);
    assert.equal(merged.failedFragments[0]!.index, 1);
    assert.equal(merged.failedFragments[1]!.index, 2);
    assert.ok(merged.failedFragments[0]!.snippet.includes('/阿斯塔利亚/a'));
    assert.ok(merged.failedFragments[1]!.snippet.includes('/阿斯塔利亚/b'));
    console.log('ok merge renumbers failedFragments to unique 1..n');
  }

  {
    clearPatchLog();
    setLastPatchLog(
      createPatchLogEntry({
        messageId: 2,
        changed: true,
        ops: [
          { op: 'replace', path: '/世界/阿斯塔利亚/刊报日期', value: 'A' },
          { op: 'replace', path: '/世界/阿斯塔利亚/时代快讯/世界时代阶段/时代阶段', value: 'B' },
        ],
        issues: [],
        failedFragments: [
          {
            index: 9,
            snippet: '{ "op": "replace", "path": "/阿斯塔利亚/刊报日期", "value":',
            message: 'frag9',
          },
        ],
      }),
    );
    const base = baseWorld();
    await applyOpsToFloor([{ op: 'replace', path: '/阿斯塔利亚/刊报日期', value: 'C' }], base, {
      emitEvents: false,
      mergeIntoLastLog: true,
      resolvedFragmentIndexes: [9],
      message_id: undefined,
    });
    const log = getLastPatchLog();
    assert.ok(log);
    assert.equal(log!.ops.length, 2);
    assert.ok(log!.ops.some(o => 'path' in o && o.path?.includes('时代阶段')));
    assert.equal(
      (log!.ops.find(o => 'path' in o && o.path === '/世界/阿斯塔利亚/刊报日期') as { value: string })
        .value,
      'C',
    );
    assert.equal(log!.failedFragments.length, 0);
    assert.equal(log!.manualFixedOps.length, 1);
    assert.ok(log!.manualFixedOps.some(o => 'path' in o && o.path === '/世界/阿斯塔利亚/刊报日期'));
    console.log('ok applyOpsToFloor mergeIntoLastLog preserves siblings');
  }

  {
    clearPatchLog();
    const base = baseWorld();
    const msg1 = `<AddonJSONPatch>
[
  { "op": "insert", "path": "/世界/阿斯塔利亚/潮汐王座深夜市井图", "value": { "描述": "a" } },
  { "op": "insert", "path": "/世界/阿斯塔利亚/深蓝议会政务图", "value": { "描述": "b" } }
]
</AddonJSONPatch>`;
    const msg2 = `<AddonJSONPatch>
[
  { "op": "insert", "path": "/世界/阿斯塔利亚/艾瑟嘉德圣职书信图", "value": { "描述": "c" } }
]
</AddonJSONPatch>`;
    await updateAddonFromMessage(msg1, base, {
      emitEvents: false,
      message_id: 2,
      mergeIntoLastLog: true,
    });
    const after1 = getLastPatchLog();
    assert.ok(after1);
    assert.equal(after1!.ops.length, 2);
    assert.equal(after1!.manualFixedOps.length, 0);

    await updateAddonFromMessage(msg2, base, {
      emitEvents: false,
      message_id: 2,
      mergeIntoLastLog: true,
    });
    const log = getLastPatchLog();
    assert.ok(log);
    assert.equal(log!.ops.length, 3);
    assert.ok(log!.ops.some(o => 'path' in o && o.path?.includes('潮汐王座')));
    assert.ok(log!.ops.some(o => 'path' in o && o.path?.includes('深蓝议会')));
    assert.ok(log!.ops.some(o => 'path' in o && o.path?.includes('艾瑟嘉德')));
    assert.equal(log!.manualFixedOps.length, 0);
    assert.equal(log!.messageId, 2);
    console.log('ok same messageId multi-stage merge keeps all ops without manualFixedOps');
  }

  {
    clearPatchLog();
    const base = baseWorld();
    const msgA = `<AddonJSONPatch>
[
  { "op": "replace", "path": "/世界/阿斯塔利亚/刊报日期", "value": "阶段1" }
]
</AddonJSONPatch>`;
    const msgB = `<AddonJSONPatch>
[
  { "op": "replace", "path": "/世界/阿斯塔利亚/刊报日期", "value": "阶段2" },
  { "op": "insert", "path": "/世界/阿斯塔利亚/新传闻", "value": { "描述": "x" } }
]
</AddonJSONPatch>`;
    await updateAddonFromMessage(msgA, base, {
      emitEvents: false,
      message_id: 5,
      mergeIntoLastLog: true,
    });
    await updateAddonFromMessage(msgB, base, {
      emitEvents: false,
      message_id: 5,
      mergeIntoLastLog: true,
    });
    const log = getLastPatchLog();
    assert.ok(log);
    const dateOps = log!.ops.filter(o => 'path' in o && o.path === '/世界/阿斯塔利亚/刊报日期');
    assert.equal(dateOps.length, 1);
    assert.equal((dateOps[0] as { value: string }).value, '阶段2');
    assert.ok(log!.ops.some(o => 'path' in o && o.path === '/世界/阿斯塔利亚/新传闻'));
    console.log('ok same path later stage overwrites earlier op');
  }

  {
    clearPatchLog();
    const base = baseWorld();
    const msg1 = `<AddonJSONPatch>
[
  { "op": "insert", "path": "/世界/阿斯塔利亚/楼2专属", "value": { "描述": "a" } }
]
</AddonJSONPatch>`;
    const msg2 = `<AddonJSONPatch>
[
  { "op": "insert", "path": "/世界/阿斯塔利亚/楼3专属", "value": { "描述": "b" } }
]
</AddonJSONPatch>`;
    await updateAddonFromMessage(msg1, base, {
      emitEvents: false,
      message_id: 2,
      mergeIntoLastLog: true,
    });
    await updateAddonFromMessage(msg2, base, {
      emitEvents: false,
      message_id: 3,
      mergeIntoLastLog: true,
    });
    const log = getLastPatchLog();
    assert.ok(log);
    assert.equal(log!.messageId, 3);
    assert.equal(log!.ops.length, 1);
    assert.ok(log!.ops.some(o => 'path' in o && o.path?.includes('楼3专属')));
    assert.ok(!log!.ops.some(o => 'path' in o && o.path?.includes('楼2专属')));
    console.log('ok different messageId does not merge');
  }
}

main().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
