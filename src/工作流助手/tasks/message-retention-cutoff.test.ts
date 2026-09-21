import assert from 'node:assert/strict';
import lodash from 'lodash';
import { resolveMessageRetentionCutoff } from './message-floor';
import { cleanupOldMessageFloorVariables } from './message-var-retention';

(globalThis as typeof globalThis & { _: typeof lodash })._ = lodash;

const floorVars: Record<number, Record<string, unknown>> = {};

const g = globalThis as typeof globalThis & {
  getChatMessages?: (id: number) => Array<{ message_id: number; role: string }>;
  getLastMessageId?: () => number;
  getVariables?: (opt: { type: string; message_id?: number }) => Record<string, unknown>;
  replaceVariables?: (data: unknown, opt: { type: string; message_id?: number }) => void;
};

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`, e);
    process.exitCode = 1;
  }
}

test('resolveMessageRetentionCutoff uses getLastMessageId not chat length', () => {
  const prev = {
    getChatMessages: g.getChatMessages,
    getLastMessageId: g.getLastMessageId,
  };
  // chat 有 10 条（length-1=9），但 getLastMessageId 返回 7 → cutoff 应按 7 算
  g.getChatMessages = (id: number) => {
    if (id === -1) return [{ message_id: 9, role: 'assistant' }];
    if (id >= 0 && id <= 9) return [{ message_id: id, role: id % 2 ? 'user' : 'assistant' }];
    return [];
  };
  g.getLastMessageId = () => 7;
  try {
    const w = resolveMessageRetentionCutoff(2);
    assert.ok(w);
    assert.equal(w!.last, 7);
    assert.equal(w!.keep, 2);
    assert.equal(w!.cutoff, 5);
  } finally {
    g.getChatMessages = prev.getChatMessages;
    g.getLastMessageId = prev.getLastMessageId;
  }
});

test('resolveMessageRetentionCutoff empty chat returns null', () => {
  const prev = g.getChatMessages;
  g.getChatMessages = () => [];
  try {
    assert.equal(resolveMessageRetentionCutoff(20), null);
  } finally {
    g.getChatMessages = prev;
  }
});

test('cleanupOldMessageFloorVariables shares same cutoff as resolveMessageRetentionCutoff', () => {
  const prev = {
    getChatMessages: g.getChatMessages,
    getLastMessageId: g.getLastMessageId,
    getVariables: g.getVariables,
    replaceVariables: g.replaceVariables,
  };

  for (const k of Object.keys(floorVars)) delete floorVars[Number(k)];
  for (let i = 0; i <= 7; i++) floorVars[i] = { post_process_tags: { x: String(i) } };

  g.getChatMessages = (id: number) => {
    if (id === -1) return [{ message_id: 7, role: 'user' }];
    if (id >= 0 && id <= 7) return [{ message_id: id, role: 'assistant' }];
    return [];
  };
  g.getLastMessageId = () => 7;
  g.getVariables = opt => {
    if (opt.type === 'message' && typeof opt.message_id === 'number') {
      return { ...(floorVars[opt.message_id] ?? {}) };
    }
    return {};
  };
  g.replaceVariables = (data, opt) => {
    if (opt.type === 'message' && typeof opt.message_id === 'number') {
      floorVars[opt.message_id] = { ...(data as Record<string, unknown>) };
    }
  };

  try {
    const w = resolveMessageRetentionCutoff(2);
    assert.equal(w?.cutoff, 5);
    const cleared = cleanupOldMessageFloorVariables(2);
    assert.ok(cleared >= 1);
    // ≤ cutoff 已清空
    assert.deepEqual(floorVars[5], {});
    // 保留窗口内仍在
    assert.ok(Object.keys(floorVars[6] ?? {}).length > 0);
    assert.ok(Object.keys(floorVars[7] ?? {}).length > 0);
  } finally {
    g.getChatMessages = prev.getChatMessages;
    g.getLastMessageId = prev.getLastMessageId;
    g.getVariables = prev.getVariables;
    g.replaceVariables = prev.replaceVariables;
  }
});
