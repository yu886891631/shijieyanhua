import assert from 'node:assert/strict';
import lodash from 'lodash';
import {
  getChatScopeDropdownValue,
  readChatTaskScope,
  setChatScopeActiveView,
} from './chat-task-scope';
import { CHAT_SCOPE_METADATA_KEY, CHAT_SNAPSHOT_PRESET_NAME } from './schema';

(globalThis as typeof globalThis & { _: typeof lodash })._ = lodash;

const g = globalThis as typeof globalThis & {
  window?: { parent?: { SillyTavern?: { getContext?: () => unknown } } };
};

let metadata: Record<string, unknown> = {};

function mockStContext() {
  const ctx = {
    chatMetadata: metadata,
    updateChatMetadata: (values: Record<string, unknown>, reset: boolean) => {
      if (reset) {
        metadata = { ...values };
      } else {
        metadata = { ...metadata, ...values };
      }
      ctx.chatMetadata = metadata;
    },
    saveChat: async () => {},
  };
  g.window = { parent: { SillyTavern: { getContext: () => ctx } } };
}

const snapshot = {
  name: CHAT_SNAPSHOT_PRESET_NAME,
  tasks: [],
  finalInjectTemplate: '',
  tagVariableInjectTemplate: '',
  chatExtractTags: { user: [], assistant: [] },
  chatBodyTagReplaceRules: [],
  chatWorldbookWriteRules: [],
  contextTurnCount: 0,
  contextExtractRules: [],
  contextExcludeRules: [],
  plotWorldbookConfig: {
    source: 'character' as const,
    manualSelection: [],
    enabledEntries: {},
  },
};

metadata = {
  [CHAT_SCOPE_METADATA_KEY]: {
    mode: 'chat_override',
    snapshot,
    originPresetName: 'A',
    updatedAt: 1,
    source: 'ui',
    activeView: 'snapshot',
    boundGlobalPresetName: '',
  },
};
mockStContext();

async function main() {
  assert.equal(getChatScopeDropdownValue(), CHAT_SNAPSHOT_PRESET_NAME);
  console.log('ok getChatScopeDropdownValue returns sentinel for snapshot view');

  const next = await setChatScopeActiveView({ view: 'global', presetName: '预设B' }, [
    { name: '预设B' },
  ]);
  assert.ok(next);
  assert.equal(next!.activeView, 'global');
  assert.equal(next!.boundGlobalPresetName, '预设B');
  assert.ok(next!.snapshot);
  assert.equal(getChatScopeDropdownValue(), '预设B');
  assert.ok(readChatTaskScope()?.snapshot);

  const back = await setChatScopeActiveView({ view: 'snapshot' }, [{ name: '预设B' }]);
  assert.equal(back!.activeView, 'snapshot');
  assert.equal(getChatScopeDropdownValue(), CHAT_SNAPSHOT_PRESET_NAME);
  assert.ok(readChatTaskScope()?.snapshot);
  console.log('ok setChatScopeActiveView switches without clearing snapshot');
}

main().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
