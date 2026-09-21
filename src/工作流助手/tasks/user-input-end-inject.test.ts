import assert from 'node:assert/strict';
import { test } from 'node:test';
import lodash from 'lodash';
import {
  buildRelayFromLastRunStatus,
  expandUserInputEndInjectTemplate,
  processLatestUserFloorExtractThenInject,
  processUserFloorExtractThenInjectById,
  shouldSkipUserFloorExtractInjectFallback,
  USER_INPUT_END_INJECT_ID,
} from './user-input-end-inject';
import { TAG_DATA_ROOT_KEY } from './tag-variables';
import { replacePlotTagPlaceholdersWithHistory } from './utils';
import { ScriptSettingsSchema, type ScriptSettings } from './schema';

(globalThis as typeof globalThis & { _: typeof lodash })._ = lodash;

test('schema defaults userInputEndInjectTemplate to empty', () => {
  const s = ScriptSettingsSchema.parse({});
  assert.equal(s.userInputEndInjectTemplate, '');
});

test('buildRelayFromLastRunStatus matches previous AI floor', () => {
  const { relay, taskBlocks } = buildRelayFromLastRunStatus(
    {
      messageId: 3,
      at: 1,
      taskResults: [
        {
          taskId: 't1',
          taskName: '任务甲',
          success: true,
          skipped: false,
          extractedTags: { onlyRelay: 'from-relay', shared: 'relay-val' },
          promptMessages: [],
          aiOutput: '',
          aiReasoning: '',
        },
        {
          taskId: 't2',
          taskName: '跳过',
          success: true,
          skipped: true,
          extractedTags: { skippedTag: 'nope' },
          promptMessages: [],
          aiOutput: '',
          aiReasoning: '',
        },
        {
          taskId: 't3',
          taskName: '失败',
          success: false,
          skipped: false,
          extractedTags: { failTag: 'nope' },
          promptMessages: [],
          aiOutput: '',
          aiReasoning: '',
        },
      ],
    },
    3,
  );

  assert.equal(relay.get('onlyRelay')?.[0], 'from-relay');
  assert.equal(relay.get('shared')?.[0], 'relay-val');
  assert.equal(relay.has('skippedTag'), false);
  assert.equal(relay.has('failTag'), false);
  assert.equal(taskBlocks.length, 1);
  assert.equal(taskBlocks[0]?.taskName, '任务甲');
  assert.match(taskBlocks[0]?.extractedBlock ?? '', /onlyRelay|from-relay/);
});

test('buildRelayFromLastRunStatus empty when messageId mismatch', () => {
  const { relay, taskBlocks } = buildRelayFromLastRunStatus(
    {
      messageId: 1,
      taskResults: [
        {
          taskId: 't1',
          taskName: 'A',
          success: true,
          extractedTags: { x: '1' },
          promptMessages: [],
          aiOutput: '',
          aiReasoning: '',
        },
      ],
    },
    2,
  );
  assert.equal(relay.size, 0);
  assert.equal(taskBlocks.length, 0);
});

test('relay-only tag expands via lastRunStatus relay before history', () => {
  const { relay } = buildRelayFromLastRunStatus(
    {
      messageId: 5,
      taskResults: [
        {
          taskId: 't1',
          taskName: 'T',
          success: true,
          extractedTags: { onlyRelay: 'RELAY_BODY' },
          promptMessages: [],
          aiOutput: '',
          aiReasoning: '',
        },
      ],
    },
    5,
  );
  const history = new Map<string, string[]>([['archived', ['HIST']]]);
  const out = replacePlotTagPlaceholdersWithHistory(
    'R={{onlyRelay}} H={{archived}} M={{missing}} U={{user}}',
    relay,
    history,
    new Set(),
    { historyFallback: 'all-tags' },
  );
  assert.equal(out, 'R=<onlyRelay>\nRELAY_BODY\n</onlyRelay> H=<archived>\nHIST\n</archived> M= U={{user}}');
});

test('expandUserInputEndInjectTemplate empty / disabled / non-user', async () => {
  const g = globalThis as Record<string, unknown>;
  const prev = {
    getChatMessages: g.getChatMessages,
    getVariables: g.getVariables,
    getLastMessageId: g.getLastMessageId,
    formatAsTavernRegexedString: g.formatAsTavernRegexedString,
    substitudeMacros: g.substitudeMacros,
  };

  g.getChatMessages = (id: number) => {
    if (id === 1) return [{ message_id: 1, role: 'user', message: 'hi' }];
    if (id === 0) return [{ message_id: 0, role: 'assistant', message: 'ai' }];
    return [];
  };
  g.getVariables = () => ({});
  g.getLastMessageId = () => 1;
  g.formatAsTavernRegexedString = (text: string) => text;
  g.substitudeMacros = (text: string) => text;

  try {
    const base = ScriptSettingsSchema.parse({
      enabled: true,
      userInputEndInjectTemplate: '',
      tasks: [],
    }) as ScriptSettings;
    assert.equal(await expandUserInputEndInjectTemplate(base, 1), '');

    const disabled = { ...base, enabled: false, userInputEndInjectTemplate: 'x{{y}}' };
    assert.equal(await expandUserInputEndInjectTemplate(disabled, 1), '');

    g.getChatMessages = (id: number) => {
      if (id === 1) return [{ message_id: 1, role: 'assistant', message: 'ai' }];
      return [];
    };
    const asst = { ...base, userInputEndInjectTemplate: 'hello' };
    assert.equal(await expandUserInputEndInjectTemplate(asst, 1), '');
  } finally {
    g.getChatMessages = prev.getChatMessages;
    g.getVariables = prev.getVariables;
    g.getLastMessageId = prev.getLastMessageId;
    g.formatAsTavernRegexedString = prev.formatAsTavernRegexedString;
    g.substitudeMacros = prev.substitudeMacros;
  }
});

test('expandUserInputEndInjectTemplate uses lastRunStatus relay only (no floor history)', async () => {
  const g = globalThis as Record<string, unknown>;
  const prev = {
    getChatMessages: g.getChatMessages,
    getVariables: g.getVariables,
    getLastMessageId: g.getLastMessageId,
    formatAsTavernRegexedString: g.formatAsTavernRegexedString,
    substitudeMacros: g.substitudeMacros,
    window: g.window,
  };

  const floorVars: Record<number, Record<string, unknown>> = {
    0: { [TAG_DATA_ROOT_KEY]: { archived: 'from-ai-floor' } },
    1: { [TAG_DATA_ROOT_KEY]: { archived: 'from-user-floor', userTag: 'u1' } },
  };

  const chat = [
    {
      is_user: false,
      mes: 'ai text',
      acu_workflow_run_status: {
        messageId: 0,
        at: 1,
        taskResults: [
          {
            taskId: 't1',
            taskName: '任务甲',
            success: true,
            extractedTags: { onlyRelay: 'RELAY_ONLY', shared: 'x' },
            promptMessages: [],
            aiOutput: '',
            aiReasoning: '',
          },
        ],
      },
    },
    { is_user: true, mes: 'user text' },
  ];

  g.getChatMessages = (id: number) => {
    if (id === 1) return [{ message_id: 1, role: 'user', message: 'user text', data: {} }];
    if (id === 0) return [{ message_id: 0, role: 'assistant', message: 'ai text', data: {} }];
    if (id === -1) return [{ message_id: 1, role: 'user', message: 'user text', data: {} }];
    return [];
  };
  g.getVariables = (opt: { type: string; message_id?: number }) => {
    if (opt.type === 'message' && typeof opt.message_id === 'number') {
      return { ...(floorVars[opt.message_id] ?? {}) };
    }
    return {};
  };
  g.getLastMessageId = () => 1;
  g.formatAsTavernRegexedString = (text: string) => text;
  g.substitudeMacros = (text: string) => text;
  g.window = {
    parent: {
      SillyTavern: {
        getContext: () => ({
          chat,
          saveChat: async () => {},
        }),
      },
    },
  };

  try {
    const settings = ScriptSettingsSchema.parse({
      enabled: true,
      userInputEndInjectTemplate: 'R={{onlyRelay}} H={{archived}} T={{task:任务甲}}',
      tasks: [],
      lastRunStatus: { taskResults: [] },
    }) as ScriptSettings;

    const out = await expandUserInputEndInjectTemplate(settings, 1);
    assert.match(out, /RELAY_ONLY/);
    assert.match(out, /onlyRelay|RELAY_ONLY/);
    assert.ok(!out.includes('from-user-floor'));
    assert.ok(!out.includes('from-ai-floor'));
    assert.match(out, /H=\s*T=/);
    assert.ok(!out.includes('{{onlyRelay}}'));
    assert.ok(!out.includes('{{archived}}'));
    assert.ok(!out.includes('{{task:任务甲}}'));
  } finally {
    g.getChatMessages = prev.getChatMessages;
    g.getVariables = prev.getVariables;
    g.getLastMessageId = prev.getLastMessageId;
    g.formatAsTavernRegexedString = prev.formatAsTavernRegexedString;
    g.substitudeMacros = prev.substitudeMacros;
    g.window = prev.window;
  }
});

test('expandUserInputEndInjectTemplate ignores inherited tags when previous AI has no run', async () => {
  const g = globalThis as Record<string, unknown>;
  const prev = {
    getChatMessages: g.getChatMessages,
    getVariables: g.getVariables,
    getLastMessageId: g.getLastMessageId,
    formatAsTavernRegexedString: g.formatAsTavernRegexedString,
    substitudeMacros: g.substitudeMacros,
    window: g.window,
  };

  const floorVars: Record<number, Record<string, unknown>> = {
    3: { [TAG_DATA_ROOT_KEY]: { archived: 'inherited-old', onlyRelay: 'stale' } },
  };

  const chat = [
    { is_user: false, mes: 'old ai with extracts' },
    { is_user: true, mes: 'u1' },
    { is_user: false, mes: 'new ai no workflow' },
    { is_user: true, mes: 'u2' },
  ];

  g.getChatMessages = (id: number) => {
    if (id === 3) return [{ message_id: 3, role: 'user', message: 'u2', data: {} }];
    if (id === 2) return [{ message_id: 2, role: 'assistant', message: 'new ai', data: {} }];
    if (id === 1) return [{ message_id: 1, role: 'user', message: 'u1', data: {} }];
    if (id === 0) return [{ message_id: 0, role: 'assistant', message: 'old ai', data: {} }];
    return [];
  };
  g.getVariables = (opt: { type: string; message_id?: number }) => {
    if (opt.type === 'message' && typeof opt.message_id === 'number') {
      return { ...(floorVars[opt.message_id] ?? {}) };
    }
    return {};
  };
  g.getLastMessageId = () => 3;
  g.formatAsTavernRegexedString = (text: string) => text;
  g.substitudeMacros = (text: string) => text;
  g.window = {
    parent: {
      SillyTavern: {
        getContext: () => ({
          chat,
          saveChat: async () => {},
        }),
      },
    },
  };

  try {
    const settings = ScriptSettingsSchema.parse({
      enabled: true,
      userInputEndInjectTemplate: 'R={{onlyRelay}} H={{archived}}',
      tasks: [],
      // 旧 AI 楼的缓存，messageId 与当前上一 AI(2) 不对齐
      lastRunStatus: {
        messageId: 0,
        at: 1,
        taskResults: [
          {
            taskId: 't1',
            taskName: '旧任务',
            success: true,
            extractedTags: { onlyRelay: 'OLD_RELAY', archived: 'OLD_ARCH' },
            promptMessages: [],
            aiOutput: '',
            aiReasoning: '',
          },
        ],
      },
    }) as ScriptSettings;

    const out = await expandUserInputEndInjectTemplate(settings, 3);
    assert.ok(!out.includes('inherited-old'));
    assert.ok(!out.includes('stale'));
    assert.ok(!out.includes('OLD_RELAY'));
    assert.ok(!out.includes('OLD_ARCH'));
    assert.ok(!out.includes('{{onlyRelay}}'));
    assert.ok(!out.includes('{{archived}}'));
    assert.match(out, /^R=\s*H=\s*$/);
  } finally {
    g.getChatMessages = prev.getChatMessages;
    g.getVariables = prev.getVariables;
    g.getLastMessageId = prev.getLastMessageId;
    g.formatAsTavernRegexedString = prev.formatAsTavernRegexedString;
    g.substitudeMacros = prev.substitudeMacros;
    g.window = prev.window;
  }
});

test('expandUserInputEndInjectTemplate falls back to settings cache when mes missing', async () => {
  const g = globalThis as Record<string, unknown>;
  const prev = {
    getChatMessages: g.getChatMessages,
    getVariables: g.getVariables,
    getLastMessageId: g.getLastMessageId,
    formatAsTavernRegexedString: g.formatAsTavernRegexedString,
    substitudeMacros: g.substitudeMacros,
    window: g.window,
  };

  g.getChatMessages = (id: number) => {
    if (id === 1) return [{ message_id: 1, role: 'user', message: 'user text', data: {} }];
    if (id === 0) return [{ message_id: 0, role: 'assistant', message: 'ai text', data: {} }];
    return [];
  };
  g.getVariables = () => ({});
  g.getLastMessageId = () => 1;
  g.formatAsTavernRegexedString = (text: string) => text;
  g.substitudeMacros = (text: string) => text;
  g.window = {
    parent: {
      SillyTavern: {
        getContext: () => ({
          chat: [{ is_user: false, mes: 'ai' }, { is_user: true, mes: 'u' }],
          saveChat: async () => {},
        }),
      },
    },
  };

  try {
    const settings = ScriptSettingsSchema.parse({
      enabled: true,
      userInputEndInjectTemplate: 'R={{onlyRelay}}',
      tasks: [],
      lastRunStatus: {
        messageId: 0,
        at: 1,
        taskResults: [
          {
            taskId: 't1',
            taskName: '任务甲',
            success: true,
            extractedTags: { onlyRelay: 'FROM_CACHE' },
            promptMessages: [],
            aiOutput: '',
            aiReasoning: '',
          },
        ],
      },
    }) as ScriptSettings;

    const out = await expandUserInputEndInjectTemplate(settings, 1);
    assert.match(out, /FROM_CACHE/);
  } finally {
    g.getChatMessages = prev.getChatMessages;
    g.getVariables = prev.getVariables;
    g.getLastMessageId = prev.getLastMessageId;
    g.formatAsTavernRegexedString = prev.formatAsTavernRegexedString;
    g.substitudeMacros = prev.substitudeMacros;
    g.window = prev.window;
  }
});

test('USER_INPUT_END_INJECT_ID is stable', () => {
  assert.equal(USER_INPUT_END_INJECT_ID, 'workflow-helper:user-input-end-inject');
});

test('shouldSkipUserFloorExtractInjectFallback dryRun and non-user', () => {
  assert.equal(shouldSkipUserFloorExtractInjectFallback(true, 'user'), true);
  assert.equal(shouldSkipUserFloorExtractInjectFallback(false, 'assistant'), true);
  assert.equal(shouldSkipUserFloorExtractInjectFallback(false, undefined), true);
  assert.equal(shouldSkipUserFloorExtractInjectFallback(false, 'user'), false);
});

test('processLatestUserFloorExtractThenInject skips dryRun and non-user', async () => {
  const g = globalThis as Record<string, unknown>;
  const prev = {
    getChatMessages: g.getChatMessages,
    getVariables: g.getVariables,
    getLastMessageId: g.getLastMessageId,
  };

  g.getChatMessages = (id: number) => {
    if (id === -1 || id === 2) return [{ message_id: 2, role: 'assistant', message: 'ai' }];
    if (id === 1) return [{ message_id: 1, role: 'user', message: 'old' }];
    return [];
  };
  g.getVariables = () => ({});
  g.getLastMessageId = () => 2;

  try {
    assert.equal(await processLatestUserFloorExtractThenInject({ dryRun: true }), false);
    assert.equal(await processLatestUserFloorExtractThenInject({ dryRun: false }), false);
  } finally {
    g.getChatMessages = prev.getChatMessages;
    g.getVariables = prev.getVariables;
    g.getLastMessageId = prev.getLastMessageId;
  }
});

test('processUserFloorExtractThenInjectById rejects non-user floors', async () => {
  const g = globalThis as Record<string, unknown>;
  const prev = {
    getChatMessages: g.getChatMessages,
    getVariables: g.getVariables,
  };

  g.getChatMessages = (id: number) => {
    if (id === 0) return [{ message_id: 0, role: 'assistant', message: 'ai' }];
    if (id === 1) return [{ message_id: 1, role: 'user', message: 'u' }];
    return [];
  };
  g.getVariables = () => ({});

  try {
    assert.equal(await processUserFloorExtractThenInjectById(0), false);
    assert.equal(await processUserFloorExtractThenInjectById(99), false);
  } finally {
    g.getChatMessages = prev.getChatMessages;
    g.getVariables = prev.getVariables;
  }
});
