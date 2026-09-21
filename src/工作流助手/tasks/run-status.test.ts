import assert from 'node:assert/strict';
import lodash from 'lodash';

(globalThis as typeof globalThis & { _: typeof lodash })._ = lodash;

const savedVars: Record<string, unknown> = {};
const chat: Array<Record<string, unknown>> = [];
let saveChatCalls = 0;

const g = globalThis as typeof globalThis & {
  getVariables?: (opt: unknown) => Record<string, unknown>;
  insertOrAssignVariables?: (data: unknown, opt: unknown) => void;
  getScriptId?: () => string;
  getChatMessages?: (id: number) => Array<{ message_id: number; role: string }>;
  getLastMessageId?: () => number;
  defineStore?: (...args: unknown[]) => unknown;
  ref?: <T>(v: T) => { value: T };
  watchEffect?: (fn: () => void) => void;
  window?: {
    parent?: {
      SillyTavern?: {
        getContext?: () => {
          chat: Array<Record<string, unknown>>;
          saveChat: () => Promise<void>;
          chatMetadata: Record<string, unknown>;
          updateChatMetadata: (v: Record<string, unknown>, reset: boolean) => void;
        };
      };
    };
  };
  eventEmit?: () => Promise<void>;
  eventOn?: () => { stop: () => void };
  tavern_events?: Record<string, string>;
};

g.getScriptId = () => '工作流助手';
g.getVariables = () => ({ ...savedVars });
g.insertOrAssignVariables = (data: unknown) => {
  Object.assign(savedVars, data as Record<string, unknown>);
};
g.getChatMessages = (id: number) => {
  if (id === -1) {
    if (chat.length === 0) return [];
    return [{ message_id: chat.length - 1, role: 'assistant' }];
  }
  if (id >= 0 && id < chat.length) {
    return [{ message_id: id, role: chat[id]?.is_user ? 'user' : 'assistant' }];
  }
  return [];
};
g.getLastMessageId = () => Math.max(0, chat.length - 1);
g.defineStore = () => () => ({});
g.ref = <T>(v: T) => ({ value: v });
g.watchEffect = () => {};
g.eventEmit = async () => {};
g.eventOn = () => ({ stop: () => {} });
g.tavern_events = {
  MESSAGE_DELETED: 'MESSAGE_DELETED',
  CHAT_CHANGED: 'CHAT_CHANGED',
};
g.window = {
  parent: {
    SillyTavern: {
      getContext: () => ({
        chat,
        saveChat: async () => {
          saveChatCalls += 1;
        },
        chatMetadata: {},
        updateChatMetadata: () => {},
      }),
    },
  },
};

function resetChat(msgs: Array<Record<string, unknown>>): void {
  chat.length = 0;
  chat.push(...msgs);
  saveChatCalls = 0;
}

const tests: Array<{ name: string; fn: () => void | Promise<void> }> = [];

function test(name: string, fn: () => void | Promise<void>): void {
  tests.push({ name, fn });
}

void (async () => {
  const {
    ACU_WORKFLOW_RUN_STATUS_KEY,
    writeRunStatusToMessage,
    readRunStatusFromMessage,
    resolveEffectiveRunStatus,
    resolveRunStatusForFloor,
    retargetRunStatusCache,
    resolveLastRunStatus,
    toFloorRunStatus,
    cleanupOldRunStatusSnapshots,
    runStatusIsHeavy,
  } = await import('./run-status');
  const { loadSettings, saveSettings } = await import('../settings');

  const sampleStatus = (messageId: number, tag: string) => ({
    messageId,
    at: 100 + messageId,
    taskResults: [
      {
        taskId: 't1',
        taskName: '任务',
        success: true,
        skipped: false,
        extractedTags: { onlyRelay: tag },
        promptMessages: [],
        aiOutput: '',
        aiReasoning: '',
      },
    ],
  });

  const heavyStatus = (messageId: number, tag: string) => ({
    messageId,
    at: 100 + messageId,
    taskResults: [
      {
        taskId: 't1',
        taskName: '任务',
        success: true,
        skipped: false,
        extractedTags: { onlyRelay: tag },
        promptMessages: [{ role: 'user', content: 'HUGE_PROMPT' }],
        aiOutput: 'HUGE_OUTPUT',
        aiReasoning: 'HUGE_REASON',
      },
    ],
  });

  test('writeRunStatusToMessage sets mes top-level field and saveChat', async () => {
    resetChat([
      { is_user: true, mes: 'u' },
      { is_user: false, mes: 'ai' },
    ]);
    const status = sampleStatus(1, 'RELAY_A');
    const ok = await writeRunStatusToMessage(1, status);
    assert.equal(ok, true);
    assert.equal(saveChatCalls, 1);
    assert.ok(chat[1]?.[ACU_WORKFLOW_RUN_STATUS_KEY]);
    assert.equal(
      (chat[1]?.[ACU_WORKFLOW_RUN_STATUS_KEY] as { taskResults: Array<{ extractedTags: Record<string, string> }> })
        .taskResults[0]?.extractedTags.onlyRelay,
      'RELAY_A',
    );
    // 不写 message.data
    assert.equal(chat[1]?.data, undefined);
  });

  test('writeRunStatusToMessage strips heavy fields', async () => {
    resetChat([{ is_user: false, mes: 'ai' }]);
    await writeRunStatusToMessage(0, heavyStatus(0, 'LIGHT'));
    const stored = chat[0]?.[ACU_WORKFLOW_RUN_STATUS_KEY] as {
      taskResults: Array<{ aiOutput: string; aiReasoning: string; promptMessages: unknown[]; extractedTags: Record<string, string> }>;
    };
    assert.equal(stored.taskResults[0]?.extractedTags.onlyRelay, 'LIGHT');
    assert.equal(stored.taskResults[0]?.aiOutput, '');
    assert.equal(stored.taskResults[0]?.aiReasoning, '');
    assert.deepEqual(stored.taskResults[0]?.promptMessages, []);
    assert.equal(runStatusIsHeavy(toFloorRunStatus(heavyStatus(0, 'X'))), false);
  });

  test('read / resolveRunStatusForFloor', async () => {
    resetChat([
      { is_user: false, mes: 'ai0', [ACU_WORKFLOW_RUN_STATUS_KEY]: sampleStatus(0, 'OLD') },
      { is_user: true, mes: 'u' },
      { is_user: false, mes: 'ai2', [ACU_WORKFLOW_RUN_STATUS_KEY]: sampleStatus(2, 'NEW') },
    ]);
    assert.equal(readRunStatusFromMessage(2)?.taskResults[0]?.extractedTags?.onlyRelay, 'NEW');
    assert.equal(resolveRunStatusForFloor(0)?.taskResults[0]?.extractedTags?.onlyRelay, 'OLD');
    assert.equal(resolveRunStatusForFloor(1), null);
    assert.equal(resolveRunStatusForFloor(null), null);
  });

  test('resolveEffectiveRunStatus scans older AI floors', () => {
    resetChat([
      { is_user: false, mes: 'ai0', [ACU_WORKFLOW_RUN_STATUS_KEY]: sampleStatus(0, 'FLOOR0') },
      { is_user: true, mes: 'u1' },
      { is_user: false, mes: 'ai2' }, // no snapshot
      { is_user: true, mes: 'u3' },
    ]);
    assert.equal(resolveEffectiveRunStatus()?.taskResults[0]?.extractedTags?.onlyRelay, 'FLOOR0');
    assert.equal(resolveEffectiveRunStatus(1)?.taskResults[0]?.extractedTags?.onlyRelay, 'FLOOR0');
    assert.equal(resolveEffectiveRunStatus(0), null);
  });

  test('retargetRunStatusCache falls back after floor deleted', () => {
    resetChat([
      { is_user: false, mes: 'ai0', [ACU_WORKFLOW_RUN_STATUS_KEY]: sampleStatus(0, 'KEEP') },
      { is_user: true, mes: 'u' },
    ]);
    const settings = loadSettings();
    settings.lastRunStatus = sampleStatus(5, 'GONE');
    saveSettings(settings);

    retargetRunStatusCache();
    const after = loadSettings().lastRunStatus;
    assert.equal(after.messageId, 0);
    assert.equal(after.taskResults[0]?.extractedTags?.onlyRelay, 'KEEP');
  });

  test('retargetRunStatusCache does not overwrite full settings when floor exists', () => {
    resetChat([
      { is_user: false, mes: 'ai', [ACU_WORKFLOW_RUN_STATUS_KEY]: sampleStatus(0, 'LIGHT_MES') },
    ]);
    const settings = loadSettings();
    settings.lastRunStatus = heavyStatus(0, 'FULL_SETTINGS');
    saveSettings(settings);

    retargetRunStatusCache();
    const after = loadSettings().lastRunStatus;
    assert.equal(after.taskResults[0]?.extractedTags?.onlyRelay, 'FULL_SETTINGS');
    assert.equal(after.taskResults[0]?.aiOutput, 'HUGE_OUTPUT');
  });

  test('retargetRunStatusCache clears when no snapshots remain', () => {
    resetChat([{ is_user: false, mes: 'ai' }, { is_user: true, mes: 'u' }]);
    const settings = loadSettings();
    settings.lastRunStatus = sampleStatus(9, 'STALE');
    saveSettings(settings);

    retargetRunStatusCache();
    assert.deepEqual(loadSettings().lastRunStatus.taskResults, []);
  });

  test('resolveLastRunStatus prefers settings when its floor still exists', () => {
    resetChat([
      { is_user: false, mes: 'ai', [ACU_WORKFLOW_RUN_STATUS_KEY]: sampleStatus(0, 'MES') },
    ]);
    const settings = loadSettings();
    settings.lastRunStatus = heavyStatus(0, 'SETTINGS');
    saveSettings(settings);
    assert.equal(resolveLastRunStatus().taskResults[0]?.extractedTags?.onlyRelay, 'SETTINGS');
    assert.equal(resolveLastRunStatus().taskResults[0]?.aiOutput, 'HUGE_OUTPUT');
  });

  test('resolveLastRunStatus falls back to mes when settings floor gone', () => {
    resetChat([
      { is_user: false, mes: 'ai', [ACU_WORKFLOW_RUN_STATUS_KEY]: sampleStatus(0, 'MES') },
    ]);
    const settings = loadSettings();
    settings.lastRunStatus = sampleStatus(99, 'CACHE');
    saveSettings(settings);
    assert.equal(resolveLastRunStatus().taskResults[0]?.extractedTags?.onlyRelay, 'MES');
  });

  test('cleanupOldRunStatusSnapshots deletes old and slims kept heavy', async () => {
    // 5 floors, keep 2 → cutoff = 2; delete 0..2, slim 3..4 if heavy
    resetChat([
      { is_user: false, mes: 'a0', [ACU_WORKFLOW_RUN_STATUS_KEY]: heavyStatus(0, 'OLD0') },
      { is_user: true, mes: 'u1' },
      { is_user: false, mes: 'a2', [ACU_WORKFLOW_RUN_STATUS_KEY]: heavyStatus(2, 'OLD2') },
      { is_user: false, mes: 'a3', [ACU_WORKFLOW_RUN_STATUS_KEY]: heavyStatus(3, 'KEEP3') },
      { is_user: false, mes: 'a4', [ACU_WORKFLOW_RUN_STATUS_KEY]: heavyStatus(4, 'KEEP4') },
    ]);
    const n = await cleanupOldRunStatusSnapshots(2);
    assert.ok(n >= 3);
    assert.equal(chat[0]?.[ACU_WORKFLOW_RUN_STATUS_KEY], undefined);
    assert.equal(chat[2]?.[ACU_WORKFLOW_RUN_STATUS_KEY], undefined);
    const keep3 = chat[3]?.[ACU_WORKFLOW_RUN_STATUS_KEY] as {
      taskResults: Array<{ aiOutput: string; extractedTags: Record<string, string> }>;
    };
    assert.equal(keep3.taskResults[0]?.extractedTags.onlyRelay, 'KEEP3');
    assert.equal(keep3.taskResults[0]?.aiOutput, '');
    assert.equal(saveChatCalls, 1);
  });

  test('cleanup uses getLastMessageId cutoff even if chat.length differs', async () => {
    const { resolveMessageRetentionCutoff } = await import('./message-floor');
    resetChat([
      { is_user: false, mes: 'a0', [ACU_WORKFLOW_RUN_STATUS_KEY]: heavyStatus(0, 'A') },
      { is_user: false, mes: 'a1', [ACU_WORKFLOW_RUN_STATUS_KEY]: heavyStatus(1, 'B') },
      { is_user: false, mes: 'a2', [ACU_WORKFLOW_RUN_STATUS_KEY]: heavyStatus(2, 'C') },
      { is_user: false, mes: 'a3', [ACU_WORKFLOW_RUN_STATUS_KEY]: heavyStatus(3, 'D') },
      { is_user: false, mes: 'a4', [ACU_WORKFLOW_RUN_STATUS_KEY]: heavyStatus(4, 'E') },
    ]);
    // 假装 getLastMessageId 比 chat.length-1 小 1
    const prevLast = g.getLastMessageId;
    g.getLastMessageId = () => 3;
    try {
      const w = resolveMessageRetentionCutoff(2);
      assert.equal(w?.last, 3);
      assert.equal(w?.cutoff, 1);
      await cleanupOldRunStatusSnapshots(2);
      assert.equal(chat[0]?.[ACU_WORKFLOW_RUN_STATUS_KEY], undefined);
      assert.equal(chat[1]?.[ACU_WORKFLOW_RUN_STATUS_KEY], undefined);
      // 2、3 在保留窗内应被压扁保留；4 > last 不压扁也不删（仍在 chat 里）
      assert.ok(chat[2]?.[ACU_WORKFLOW_RUN_STATUS_KEY]);
      assert.equal(
        (chat[2]?.[ACU_WORKFLOW_RUN_STATUS_KEY] as { taskResults: Array<{ aiOutput: string }> }).taskResults[0]
          ?.aiOutput,
        '',
      );
      assert.equal(
        (chat[4]?.[ACU_WORKFLOW_RUN_STATUS_KEY] as { taskResults: Array<{ aiOutput: string }> }).taskResults[0]
          ?.aiOutput,
        'HUGE_OUTPUT',
      );
    } finally {
      g.getLastMessageId = prevLast;
    }
  });

  test('read rebinds stale embedded messageId to current floor', () => {
    resetChat([
      {
        is_user: false,
        mes: 'ai',
        [ACU_WORKFLOW_RUN_STATUS_KEY]: sampleStatus(5, 'STALE_MID'),
      },
      { is_user: true, mes: 'u' },
    ]);
    const status = readRunStatusFromMessage(0);
    assert.equal(status?.messageId, 0);
    assert.equal(status?.taskResults[0]?.extractedTags?.onlyRelay, 'STALE_MID');

    const effective = resolveEffectiveRunStatus();
    assert.equal(effective?.messageId, 0);
    assert.equal(effective?.taskResults[0]?.extractedTags?.onlyRelay, 'STALE_MID');
  });

  test('rebinding allows buildRelay after floor index shift', async () => {
    const { buildRelayFromLastRunStatus } = await import('./user-input-end-inject');
    resetChat([
      {
        is_user: false,
        mes: 'ai',
        [ACU_WORKFLOW_RUN_STATUS_KEY]: sampleStatus(5, 'AFTER_DELETE'),
      },
      { is_user: true, mes: 'u' },
    ]);
    const status = readRunStatusFromMessage(0);
    const { relay, taskBlocks } = buildRelayFromLastRunStatus(status ?? undefined, 0);
    assert.equal(relay.get('onlyRelay')?.[0], 'AFTER_DELETE');
    assert.equal(taskBlocks.length, 1);
  });

  let failed = 0;
  for (const t of tests) {
    try {
      await t.fn();
      console.log(`ok ${t.name}`);
    } catch (e) {
      failed += 1;
      console.error(`FAIL ${t.name}`, e);
    }
  }
  if (failed) process.exitCode = 1;
})();
