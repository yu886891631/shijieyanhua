/* eslint-disable import-x/no-nodejs-modules -- Test-only compilation of pinned source with fake host/services; write:false. */
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { createT15DbPatchSources } from './t15-db-completion-patch';
import { deferredT8Test } from './t8-test-fixtures';
import { wiringFixture } from './t15-wiring-test-fixtures';
import { createT15SourceSignals, type T15SignalFrame } from './t15-source-signals';
import type { T15DbObserver, T15DbEvent } from './t15-db-completion-protocol';

const require = createRequire(import.meta.url),
  { build } = createRequire(require.resolve('tsx'))('esbuild');
export async function patchedDatabaseFixture(
  scenario: {
    legacy?: boolean;
    failed?: boolean;
    throwGroup?: boolean;
    missingGroup?: boolean;
    stopped?: boolean;
    disabled?: boolean;
    noWork?: boolean;
    preconditionFailure?: boolean;
    coalesced?: boolean;
  } = {},
) {
  const f = await wiringFixture(),
    reference = process.env.WE_T15_DB_REFERENCE ?? resolve(process.cwd(), '../shujuku-inspect-20260925');
  const files = await createT15DbPatchSources(reference);
  const texts = {
    registry: files['src/presentation/bootstrap/api-registry.ts'].after,
    trigger: files['src/presentation/triggers/settings-ui-sync/settings-ui-trigger.ts'].after,
    glue: files['src/service/runtime/world-evolution-completion.ts'].after,
    protocol: files['src/shared/world-evolution-completion-protocol.ts'].after,
  };
  const names = new Set<string>();
  for (const text of Object.values(texts))
    for (const match of text.matchAll(/import\s+(?:type\s+)?\{([\s\S]*?)\}\s+from\s*['"][^'"]+['"]/g))
      for (const raw of match[1].split(',')) {
        const name = raw
          .trim()
          .replace(/^type\s+/, '')
          .split(/\s+as\s+/)[0];
        if (name) names.add(name);
      }
  const updates = new Set<(data: unknown, meta?: { persisted?: boolean }) => void>(),
    top: { AutoCardUpdaterAPI?: Record<string, any> } = {};
  const afterGroups = deferredT8Test<void>(),
    release = deferredT8Test<void>();
  const groups = {
    a: {
      key: 'a',
      groupId: 1,
      indices: [1],
      batchSize: 1,
      sheetKeys: ['sheet_a'],
      sheetNames: ['环境'],
      requiresBoundaryStaging: false,
    },
    b: {
      key: 'b',
      groupId: 2,
      indices: [1],
      batchSize: 1,
      sheetKeys: ['sheet_b'],
      sheetNames: ['人物'],
      requiresBoundaryStaging: true,
    },
  };
  const environment: Record<string, any> = {
    stopped: false,
    topLevelWindow_ACU: top,
    SillyTavern_API_ACU: {
      chat: f.chat,
      characters: [{ avatar: f.binding.characterId, chat: f.binding.hostChatId }],
      characterId: 0,
      getCurrentChatId: () => f.binding.hostChatId,
    },
    getChatArray_ACU: () => f.chat,
    getCurrentIsolationKey_ACU: () => 'slot',
    currentJsonTableData_ACU: { sheet_a: { content: [['天气'], ['雨']] }, sheet_b: { content: [['姓名'], ['旅人']] } },
    allChatMessages_ACU: f.chat,
    coreApisAreReady_ACU: true,
    isAutoUpdatingCard_ACU: false,
    settings_ACU: { maxConcurrentGroups: 2, toastMuteEnabled: true },
    startRuntimePerformanceSpan_ACU: () => ({ id: 'mock-span', end: () => {} }),
    checkAutoUpdatePreConditions_ACU: () =>
      scenario.disabled
        ? { canProceed: false, code: 'auto_update_disabled' }
        : scenario.preconditionFailure
          ? { canProceed: false, code: 'api_not_configured' }
          : { canProceed: true },
    handleFloorIncreaseDelay_ACU: async () => undefined,
    buildAutoUpdatePlan_ACU: () => ({
      tablesToUpdate: scenario.noWork ? [] : ['a', 'b'],
      updateGroups: scenario.noWork ? {} : groups,
      boundary: { fullCheckpointIndices: [], requiresBoundaryStaging: true },
    }),
    isSqliteMode: () => !!scenario.legacy,
    getSortedSheetKeys_ACU: () => ['sheet_a', 'sheet_b'],
    getStorageProvider: () => ({ getCurrentData: () => environment.currentJsonTableData_ACU }),
    updateReadableLorebookEntry_ACU: async () => {},
    loadAllChatMessages_ACU: async () => {},
    purgeOldLayerData_ACU: async () => {},
    _set_isAutoUpdatingCard_ACU: () => {},
    logDebug_ACU: () => {},
    logError_ACU: () => {},
    logWarn_ACU: () => {},
    logAutoFillSkip_ACU: () => {},
    showToastr_ACU: () => {},
    updateCardUpdateStatusDisplay_ACU: () => {},
    installRuntimeGatedSqlReadApi_ACU: () => {},
    processUpdates_ACU: async () => {
      if (scenario.throwGroup) throw new Error('fake failure');
      return { success: !scenario.failed };
    },
    processGroupedRuntimeChunk_ACU: async (list: { key: string }[]) => {
      if (scenario.throwGroup) throw new Error('fake failure');
      return { success: !scenario.failed, failedGroups: scenario.failed ? list.map(g => g.key) : [] };
    },
    executeAutoFillStagingGroups_ACU: async () => ({ success: true, failedGroups: [] }),
    createCallbackApi: () => ({
      registerTableUpdateCallback: (fn: (data: unknown, meta?: { persisted?: boolean }) => void) => updates.add(fn),
      unregisterTableUpdateCallback: (fn: (data: unknown, meta?: { persisted?: boolean }) => void) =>
        updates.delete(fn),
      _notifyTableUpdate: () => {
        for (const fn of updates) fn(environment.currentJsonTableData_ACU, { persisted: true });
      },
    }),
  };
  for (const name of names) if (name.startsWith('create') && !(name in environment)) environment[name] = () => ({});
  environment.executeAutoUpdatePlan_ACU = async (
    plan: any,
    _settings: any,
    setAuto: (value: boolean) => void,
    ops: any,
  ) => {
    setAuto(true);
    try {
      if (scenario.legacy)
        await ops.processUpdates(plan.updateGroups.a.indices, 'auto_independent', { targetSheetKeys: ['sheet_a'] });
      else await ops.processGroupedUpdates([groups.a], 'auto_independent', {});
      if (!scenario.missingGroup) await ops.processStagingGroupedUpdates([groups.b], 'auto_independent', {});
      await ops.loadAllChatMessages();
      await ops.refreshData();
      await ops.purgeOldLayerData();
      afterGroups.resolve();
      await release.promise;
      if (scenario.coalesced) {
        scenario.coalesced = false;
        scenario.noWork = true;
        await environment.reenter();
      }
      environment.stopped = !!scenario.stopped;
      setAuto(false);
      // Deliberately falsely reports aggregate success for a failed group: source-side group receipts still refuse it.
      return { success: true, failedGroups: 0, totalGroups: 2, autoMergeTriggered: false };
    } finally {
      setAuto(false);
    }
  };
  const special = new Set([
    'wasStoppedByUser_ACU',
    '_set_wasStoppedByUser_ACU',
    'executeAutoUpdatePlan_ACU',
    'isAutoUpdatingCard_ACU',
    '_set_isAutoUpdatingCard_ACU',
  ]);
  const stub = `const env=(globalThis as any).__weT15DbPatchFixture;
    export let wasStoppedByUser_ACU=false;
    export let isAutoUpdatingCard_ACU=false;
    export const _set_isAutoUpdatingCard_ACU=(value:boolean)=>{isAutoUpdatingCard_ACU=value;};
    export const _set_wasStoppedByUser_ACU=(value:boolean)=>{wasStoppedByUser_ACU=value;env.stopped=value;};
    export const executeAutoUpdatePlan_ACU=async(...args:any[])=>{const result=await env.executeAutoUpdatePlan_ACU(...args);wasStoppedByUser_ACU=env.stopped;return result;};
    ${[...names]
      .filter(n => !special.has(n))
      .map(n => `export const ${n}=env.${n};`)
      .join('\n')}`;
  const built = await build({
    write: false,
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    stdin: {
      contents:
        "import 'registry'; export { triggerAutomaticUpdateIfNeeded_ACU as start } from 'trigger'; export { _set_isAutoUpdatingCard_ACU as busy } from 'stub';",
      loader: 'ts',
    },
    plugins: [
      {
        name: 'fake-db-only',
        setup(builder: any) {
          builder.onResolve({ filter: /.*/ }, (args: any) => ({
            namespace: 'fake-db',
            path: ['registry', 'trigger'].includes(args.path)
              ? args.path
              : args.path.endsWith('/world-evolution-completion-protocol')
                ? 'protocol'
                : args.path.endsWith('/world-evolution-completion')
                  ? 'glue'
                  : 'stub',
          }));
          builder.onLoad({ filter: /.*/, namespace: 'fake-db' }, (args: any) => ({
            contents: args.path === 'stub' ? stub : texts[args.path as keyof typeof texts],
            loader: 'ts',
          }));
        },
      },
    ],
  });
  (globalThis as Record<string, unknown>).__weT15DbPatchFixture = environment;
  let monitor: ReturnType<typeof createT15SourceSignals> | undefined;
  try {
    const module = await import(
      'data:text/javascript;base64,' +
        Buffer.from(built.outputFiles[0].contents).toString('base64') +
        '#' +
        crypto.randomUUID()
    );
    environment.reenter = module.start;
    const api = top.AutoCardUpdaterAPI!,
      observer = api.getWorldEvolutionCompletion() as T15DbObserver;
    const events: T15DbEvent[] = [];
    observer.subscribe(e => events.push(e));
    const frame: T15SignalFrame = {
      binding: f.binding,
      message: f.chat.at(-1)!,
      swipe: 0,
      text: f.input.story.at(-1)!.text,
      matchingBodies: 1,
    };
    monitor = createT15SourceSignals({
      current: () => frame,
      epoch: () => 0,
      on: () => () => {},
      mvuEvents: null,
      database: api as any,
    });
    monitor.applyDatabaseHint(f.gate);
    f.gate.complete('mvu', f.gate.begin('mvu', f.input.anchor), [{ weather: '雨' }]);
    return {
      ...f,
      start: () => module.start(),
      afterGroups: afterGroups.promise,
      release: () => release.resolve(),
      busy: (value: boolean) => module.busy(value),
      events,
      monitor,
      apply: () => monitor!.applyDatabase(f.gate, f.selections[1].selections),
      observer,
      close() {
        release.resolve();
        monitor!.close();
        f.close();
        if ((globalThis as Record<string, unknown>).__weT15DbPatchFixture === environment)
          delete (globalThis as Record<string, unknown>).__weT15DbPatchFixture;
      },
    };
  } catch (error) {
    monitor?.close();
    f.close();
    delete (globalThis as Record<string, unknown>).__weT15DbPatchFixture;
    throw error;
  }
}
