import assert from 'node:assert/strict';
import lodash from 'lodash';
import { TAG_DATA_ROOT_KEY } from './tag-variables';
import type { ScriptSettings } from './schema';

(globalThis as typeof globalThis & { _: typeof lodash })._ = lodash;

const gPinia = globalThis as typeof globalThis & {
  defineStore?: (...args: unknown[]) => unknown;
  ref?: <T>(v: T) => { value: T };
  watchEffect?: (fn: () => void) => void;
  getScriptId?: () => string;
};
gPinia.defineStore = () => () => ({});
gPinia.ref = <T>(v: T) => ({ value: v });
gPinia.watchEffect = () => {};
gPinia.getScriptId = () => '工作流助手';

function makeFloorVars(): Record<number, Record<string, unknown>> {
  return {
    1: {
      [TAG_DATA_ROOT_KEY]: {
        item_id: { '1': 'from-floor-1' },
        result: 'keep-me',
      },
    },
    2: {
      [TAG_DATA_ROOT_KEY]: {
        item_id: { '1': 'stale', '9': 'orphan' },
        extra: 'should-be-removed',
      },
    },
  };
}

function installMocks(floorVars: Record<number, Record<string, unknown>>): void {
  const g = globalThis as typeof globalThis & {
    getChatMessages?: (message_id: number | string) => Array<{ role: string; message: string; message_id?: number }>;
    getVariables?: (opt: { type: string; message_id: number }) => Record<string, unknown>;
    updateVariablesWith?: (
      updater: (variables: Record<string, unknown>) => Record<string, unknown>,
      opt: { type: string; message_id: number },
    ) => void;
    getLastMessageId?: () => number;
    formatAsTavernRegexedString?: (text: string) => string;
    substitudeMacros?: (text: string) => string;
  };

  g.getChatMessages = (message_id: number | string) => {
    if (typeof message_id === 'number' && message_id >= 0 && message_id <= 2) {
      return [{ role: 'assistant', message: '', message_id }];
    }
    return [];
  };

  g.getVariables = (opt: { type: string; message_id: number }) => ({
    ...(floorVars[opt.message_id] ?? {}),
  });

  g.updateVariablesWith = (updater, opt) => {
    floorVars[opt.message_id] = updater({ ...(floorVars[opt.message_id] ?? {}) });
  };

  g.getLastMessageId = () => 2;
  g.formatAsTavernRegexedString = (text: string) => text;
  g.substitudeMacros = (text: string) => text;
}

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`, e);
    process.exitCode = 1;
  }
}

async function main(): Promise<void> {
  await test('restorePostProcessTagsFromPreviousFloor replaces current snapshot', async () => {
    const floorVars = makeFloorVars();
    installMocks(floorVars);
    const { restorePostProcessTagsFromPreviousFloor } = await import('./tag-variables');
    restorePostProcessTagsFromPreviousFloor(2);
    const current = floorVars[2][TAG_DATA_ROOT_KEY] as Record<string, unknown>;
    assert.deepEqual(current, {
      item_id: { '1': 'from-floor-1' },
      result: 'keep-me',
    });
    assert.equal(current.extra, undefined);
    assert.equal((current.item_id as Record<string, string>)['9'], undefined);
  });

  await test('restorePostProcessTagsFromPreviousFloor clears when previous empty', async () => {
    const floorVars: Record<number, Record<string, unknown>> = {
      0: {},
      1: {
        [TAG_DATA_ROOT_KEY]: { stale: 'x' },
      },
    };
    installMocks(floorVars);
    const { restorePostProcessTagsFromPreviousFloor } = await import('./tag-variables');
    restorePostProcessTagsFromPreviousFloor(1);
    assert.equal(floorVars[1][TAG_DATA_ROOT_KEY], undefined);
  });

  await test('mergeAiFloorInjectBlock still renders static text and history tags when all skipped', async () => {
    const floorVars = makeFloorVars();
    installMocks(floorVars);
    const { mergeAiFloorInjectBlock } = await import('./tag-variables');
    const settings = {
      finalInjectTemplate: 'STATUS:{{result}}{{task:跳过的任务}}',
      tasks: [],
    } as unknown as ScriptSettings;
    const out = await mergeAiFloorInjectBlock(
      settings,
      [
        {
          success: false,
          skipped: true,
          extractedTags: { result: 'should-not-use' },
          extractedBlock: 'SKIPPED_BLOCK',
          taskId: 't-skip',
          taskName: '跳过的任务',
        },
      ],
      1,
    );
    assert.equal(out, 'STATUS:<result>\nkeep-me\n</result>');
    assert.ok(!out.includes('SKIPPED_BLOCK'));
    assert.ok(!out.includes('should-not-use'));
    assert.ok(!out.includes('{{task:'));
  });

  await test('mergeAiFloorInjectBlock keeps static template when all skipped and no history tags', async () => {
    const floorVars: Record<number, Record<string, unknown>> = { 1: {} };
    installMocks(floorVars);
    const { mergeAiFloorInjectBlock } = await import('./tag-variables');
    const settings = {
      finalInjectTemplate: 'FLOOR_INJECT',
      tasks: [],
    } as unknown as ScriptSettings;
    const out = await mergeAiFloorInjectBlock(
      settings,
      [
        {
          success: false,
          skipped: true,
          extractedTags: {},
          extractedBlock: '',
          taskId: 't-skip',
          taskName: '跳过',
        },
      ],
      1,
    );
    assert.equal(out, 'FLOOR_INJECT');
  });
}

main().then(() => {
  if (process.exitCode) process.exit(process.exitCode);
});
