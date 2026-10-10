/** User-operated isolated candidate. No host reads/writes, real model transport, or legacy initialization. */
import { z } from 'zod';
import { createEmptyWorldEvolutionApiConfiguration, normalizeWorldEvolutionApiConfiguration } from '../api-config';
import { cloneT2Json } from './t2-template';
import { createDefaultT2Template } from './t2-defaults';
import { createT2EmptyWorld } from './t2-values';
import { fingerprintT4, normalizeT4Scope, validateT4Archive, type T4Archive, type T4Scope } from './t4-protocol';
import { createT4SandboxStore, headT4Token } from './t4-store';
import { createT4CommitService, type T4Executor } from './t4-service';
import { createT5Workbench } from './t5-workbench';
import { createT6DefaultStore } from './t6-defaults';
import { createT6Workbench } from './t6-workbench';
import { normalizeT7Input, type T7Input } from './t7-input';
import { createT7Workbench } from './t7-workbench';
import { createT8Queue } from './t8-queue';
import { createT9Round, type T9Options } from './t9-round';
import { recoverT9Ledger } from './t9-ledger';
import { createT11Controller, type T11Destination } from './t11-controller';
import { createT12SimulatedBook } from './t12-simulated-book';
import { createT12Controller } from './t12-controller';
import { createT13Controller } from './t13-controller';
import { T14_DEFAULT, type T14Appearance } from './t14-appearance';

export const T15_VERSION = 'A0.1.0-alpha.17-T15.1';
export const T15_CAPABILITIES = Object.freeze({
  localSqlite: true,
  localArchive: true,
  localProjection: true,
  realApi: false,
  chatWrites: false,
  characterWorldbookWrites: false,
  hostEvents: false,
});
const clone = <T>(value: T): T => cloneT2Json(value) as unknown as T;
const promptsSchema = z.strictObject({
  enabled: z.unknown(),
  draft: z.unknown(),
  revision: z.number().int().nonnegative(),
});
const appearanceSchema = z.strictObject({
  theme: z.enum(['light', 'cream', 'landmine', 'dark']),
  scale: z.union([z.literal(100), z.literal(110), z.literal(125)]),
  density: z.enum(['comfortable', 'compact']),
  text: z.enum(['wrap', 'bounded']),
});
const payloadSchema = z.strictObject({
  scope: z.unknown(),
  storage: z.string().max(20_000_000),
  defaults: z.string().max(2_000_000),
  input: z.unknown(),
  prompts: promptsSchema,
  appearance: appearanceSchema,
});
const fileSchema = z.strictObject({
  format: z.literal('world-evolution-t15-local-workspace'),
  version: z.literal(1),
  candidate: z.literal(T15_VERSION),
  payload: payloadSchema,
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
});
export type T15File = z.infer<typeof fileSchema>;
export async function parseT15File(text: string): Promise<T15File> {
  if (text.length > 24_000_000) throw new Error('文件过大；原工作区未修改');
  const file = fileSchema.parse(JSON.parse(text));
  if (file.fingerprint !== (await fingerprintT4(file.payload))) throw new Error('工作区指纹不符；原工作区未修改');
  const scope = normalizeT4Scope(file.payload.scope),
    input = normalizeT7Input(file.payload.input);
  if (
    scope.mode !== 't4-sandbox' ||
    input.anchor.chatId !== scope.chatId ||
    input.worldId !== scope.worldId ||
    input.branchId !== scope.branchId
  )
    throw new Error('只能打开同一身份的隔离存档');
  return file;
}
export async function createT15Session(options: {
  execute: T4Executor;
  file?: T15File;
  navigate?: (destination: T11Destination) => void;
  /** Trusted fake reply hook; never a URL/fetch/host adapter. */
  reply?: T9Options['reply'];
}) {
  // Validate again at this public boundary; never trust a caller's parsed/version flag.
  const file = options.file ? await parseT15File(JSON.stringify(options.file)) : null;
  const scope: T4Scope = file
    ? normalizeT4Scope(file.payload.scope)
    : {
        mode: 't4-sandbox',
        chatId: `sandbox-t15-${crypto.randomUUID().slice(0, 8)}`,
        worldId: 'local-world',
        branchId: 'main',
      };
  const store = createT4SandboxStore(file?.payload.storage);
  const template = createDefaultT2Template();
  if (!file)
    await store.initialize(scope, { template, data: createT2EmptyWorld(template, scope.worldId, scope.branchId) });
  const initialArchive = await validateT4Archive(await store.read(scope));
  // No imported multi-chat authority can be smuggled into this isolated instance.
  const raw = JSON.parse(store.exportStorage());
  if (
    raw.chats.length !== 1 ||
    raw.chats[0].chatId !== scope.chatId ||
    Object.keys(raw.chats[0].archives).join() !== `${scope.worldId}/${scope.branchId}`
  )
    throw new Error('候选文件只能包含一个隔离世界');
  const service = await createT4CommitService({ scope, store, execute: options.execute });
  let input: T7Input = file
    ? normalizeT7Input(file.payload.input)
    : {
        anchor: {
          chatId: scope.chatId,
          messageId: 'local-story-1',
          swipeId: 'local-swipe',
          inputFingerprint: await fingerprintT4('本地模拟剧情'),
        },
        worldId: scope.worldId,
        branchId: scope.branchId,
        eligibleRound: 1,
        story: [{ messageId: 'local-story-1', role: 'assistant', text: '本地模拟剧情；请填写本轮发生的事情。' }],
        segments: [],
        proofs: [],
        selected: [],
        progress: {},
        now: null,
      };
  store.registerAnchor(input.anchor);
  let transition = false;
  let closed = false,
    refreshing = false;
  let appearance: T14Appearance = clone(file?.payload.appearance ?? T14_DEFAULT);
  const id = () => crypto.randomUUID().replaceAll('-', '').slice(0, 20);
  const runSpec = () => ({
    runId: `local-${id()}`,
    commitId: `c-${id()}`,
    anchor: clone(input.anchor),
    context: {
      inputFingerprint: input.anchor.inputFingerprint,
      promptFingerprint: input.anchor.inputFingerprint,
      modelFingerprint: input.anchor.inputFingerprint,
      parametersFingerprint: input.anchor.inputFingerprint,
    },
  });
  // The reserved simulated route is never the user-entered API configuration.
  const simulationApi = createEmptyWorldEvolutionApiConfiguration(0);
  simulationApi.presets = [
    {
      id: 't15-simulation',
      name: '仅本地模拟',
      provider: 'openai-compatible',
      endpoint: 'https://invalid.example/chat/completions',
      apiKey: 't15-local-placeholder',
      model: 'local-no-network',
      enabled: true,
      timeoutMs: 1000,
      maxRetries: 0,
      createdAt: 0,
      updatedAt: 0,
    },
  ];
  let editorApi = createEmptyWorldEvolutionApiConfiguration(0);
  const apiPort = {
    read: () => clone(editorApi),
    save: (next: typeof editorApi) => {
      if (closed) throw new Error('工作区已关闭');
      editorApi = normalizeWorldEvolutionApiConfiguration(next);
      return clone(editorApi);
    },
  };
  const readSecrets = () => [...editorApi.presets.map(p => p.apiKey).filter(Boolean), 't15-local-placeholder'];
  const active = () => ['macro', 'micro', 'validating', 'saving'].includes(round?.view().status ?? 'idle');
  // Busy accessors must not compute another page's canSave/canUse view (cross-page recursion).
  const otherIdle = () =>
    !closed && !transition && !active() && !generation?.view().busy && !projection?.isBusy() && !backup?.isBusy();
  const data = createT5Workbench({
    service,
    runSpec,
    nextId: id,
    readArchive: () => store.read(scope),
    canEdit: () => refreshing || (otherIdle() && !structure?.dirty() && !structure?.isBusy()),
  });
  const defaults = await createT6DefaultStore(service.view().formal.template, file?.payload.defaults);
  const structure = createT6Workbench({
    service,
    execute: options.execute,
    runSpec,
    defaults,
    dataIdle: () => otherIdle() && !data.dirty() && !data.view().busy && data.view().history === null,
    afterSaved: async () => {
      refreshing = true;
      try {
        await data.reload(false);
      } finally {
        refreshing = false;
      }
    },
  });
  await structure.readDefault();
  const editorsIdle = () =>
    !data.dirty() && !data.view().busy && data.view().history === null && !structure.dirty() && !structure.isBusy();
  const generation = await createT7Workbench({
    readState: () => service.view().formal,
    input,
    api: simulationApi,
    initialPrompts: file
      ? {
          enabled: file.payload.prompts.enabled,
          draft: file.payload.prompts.draft,
          revision: file.payload.prompts.revision,
        }
      : undefined,
    canFreeze: () => otherIdle() && editorsIdle() && (!service.view().draft || service.view().status === 'saved'),
  });
  const syncLedger = async () => {
    const ledger = recoverT9Ledger(await validateT4Archive(await store.read(scope)));
    input.progress = ledger?.progress ?? {};
    input.eligibleRound = Math.max(input.eligibleRound, (ledger?.eligibleRound ?? 0) + 1);
    generation.setInput(input);
  };
  const runtime = {
    readInput: () => clone(input),
    readApi: () => clone(simulationApi),
    readPrompts: () => generation.exportPrompts().enabled,
    canFreeze: () =>
      !closed &&
      !transition &&
      editorsIdle() &&
      !generation.view().busy &&
      !projection.isBusy() &&
      !backup.isBusy() &&
      !generation.view().prompts.dirty,
    canRun: () => !closed && !projection.isBusy() && !backup.isBusy(),
  };
  const round = createT9Round({
    ...runtime,
    service,
    execute: options.execute,
    queue: createT8Queue(),
    ownerId: `t15-${id()}`,
    reply: options.reply,
    afterSaved: () => {
      data.refreshSaved();
    },
  });
  const binding = {
    chatId: scope.chatId,
    worldId: scope.worldId,
    branchId: scope.branchId,
    characterId: 'local-card',
    primaryBook: '本地模拟角色卡世界书（非真实世界书）',
  };
  const book = createT12SimulatedBook(binding);
  book.registerSource(scope, () => {
    const raw = JSON.parse(store.exportStorage());
    return JSON.parse(raw.chats[0].archives[`${scope.worldId}/${scope.branchId}`]) as T4Archive;
  });
  const projection = createT12Controller({
    scope,
    service,
    store,
    driver: book.driver,
    readSecrets,
    navigateTemplate: options.navigate ? () => options.navigate!('world') : undefined,
    canUse: () => !closed && !active() && editorsIdle() && !generation.view().busy && !backup?.isBusy(),
  });
  const daily = createT11Controller({
    service,
    round,
    store,
    runtime,
    restoreSpec: async () => runSpec(),
    nextRunId: () => `local-round-${id()}`,
    projection: projection.summary,
    subscribeProjection: projection.subscribe,
    navigate: options.navigate,
  });
  const backup = createT13Controller({
    scope,
    service,
    store,
    execute: options.execute,
    runSpec: async () => runSpec(),
    canBackupPrivate: () => true,
    readSecrets,
    canUse: () => !closed && !active() && editorsIdle() && !generation.view().busy && !projection.isBusy(),
    afterSaved: () => {
      data.refreshSaved();
    },
  });
  const unsub = service.subscribe(() => {
    if (service.view().status === 'saved') {
      data.refreshSaved();
      structure.refreshSaved();
    }
  });
  await syncLedger();
  function idle() {
    if (
      !otherIdle() ||
      !editorsIdle() ||
      generation.view().prompts.dirty ||
      service.view().busy ||
      ['pending', 'failed'].includes(service.view().status) ||
      (service.view().draft && service.view().status !== 'saved') ||
      transition
    )
      throw new Error('先处理未保存草稿、运行或待确认回执；原工作区保留');
  }
  return {
    scope,
    store,
    service,
    data,
    structure,
    generation,
    round,
    daily,
    projection,
    backup,
    book,
    apiPort,
    capabilities: T15_CAPABILITIES,
    initialArchive,
    readInput: () => clone(input),
    readAppearance: () => clone(appearance),
    setAppearance: (value: T14Appearance) => {
      appearance = appearanceSchema.parse(value);
    },
    async setStory(text: string) {
      idle();
      transition = true;
      try {
        const messageId = `local-story-${id()}`;
        const next = normalizeT7Input({
          ...input,
          anchor: { ...input.anchor, messageId, inputFingerprint: await fingerprintT4(text) },
          story: [{ messageId, role: 'assistant', text }],
        });
        input = next;
        store.registerAnchor(input.anchor);
        generation.setInput(input);
        await daily.refresh();
      } finally {
        transition = false;
      }
    },
    async refresh() {
      await syncLedger();
      await daily.refresh();
      await projection.inspect();
    },
    async enableSimulation(confirmed: boolean) {
      idle();
      if (!confirmed) throw new Error('需要明确确认本地模拟路由与请求额度变更');
      const next = clone(service.view().formal.template);
      next.defaults.api = { state: 'value', value: { presetId: 't15-simulation' } };
      // Preserve the user's budget. Seven due tables with a cap of five must fail, not auto-expand.
      structure.replaceTemplate(next);
      await structure.prepare();
      structure.consent(true);
      await structure.save();
      if (structure.view().error) throw new Error(structure.view().error!);
      await daily.refresh();
    },
    async exportWorkspace(): Promise<string> {
      idle();
      transition = true;
      try {
        const archive = await validateT4Archive(await store.read(scope));
        if (JSON.stringify(headT4Token(archive)) !== JSON.stringify(service.view().head))
          throw new Error('正式资料已变化');
        const payload = payloadSchema.parse({
          scope,
          storage: store.exportStorage(),
          defaults: defaults.exportStorage(),
          input,
          prompts: generation.exportPrompts(),
          appearance,
        });
        const text = JSON.stringify(payload);
        if (readSecrets().some(key => text.includes(key))) throw new Error('资料含 API Key，禁止导出');
        return JSON.stringify(
          fileSchema.parse({
            format: 'world-evolution-t15-local-workspace',
            version: 1,
            candidate: T15_VERSION,
            payload,
            fingerprint: await fingerprintT4(payload),
          }),
          null,
          2,
        );
      } finally {
        transition = false;
      }
    },
    assertIdle: idle,
    close() {
      if (closed) return;
      closed = true;
      round.cancel();
      daily.close();
      projection.close();
      backup.close();
      unsub();
      service.close();
    },
  };
}
export type T15Session = Awaited<ReturnType<typeof createT15Session>>;
