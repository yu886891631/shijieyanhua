/** Same nine-page controllers, one real-host authority. Explicit opt-in; no startup/native side effects. */
import { cloneT2Json } from './t2-template';
import { normalizeWorldEvolutionApiConfiguration, type WorldEvolutionApiConfiguration } from '../api-config';
import { fingerprintT4, normalizeT4Scope, type T4Scope } from './t4-protocol';
import type { T4Executor } from './t4-service';
import type { T10Driver } from './t10-host-gateway';
import { openT10CompatibilitySession } from './t10-session';
import { inspectT10CompatibilityHost } from './t10-recovery';
import { createT5Workbench } from './t5-workbench';
import { createT6DefaultStore } from './t6-defaults';
import { createT6Workbench } from './t6-workbench';
import { createT7Workbench } from './t7-workbench';
import { createT8Queue } from './t8-queue';
import { createT11Controller, type T11Destination } from './t11-controller';
import { createT12CompatibilityController } from './t12-controller';
import type { T12Driver } from './t12-gateway';
import { createT13Controller } from './t13-controller';
import { T14_DEFAULT, type T14Appearance } from './t14-appearance';
import type { T15ApiTransport } from './t15-api-transport';
import type { T15Prerequisites } from './t15-prerequisites';
import type { T15TriggerOwner } from './t15-trigger-ownership';
export interface T15ApiConfigurationPort {
  read(): WorldEvolutionApiConfiguration;
  save(next: WorldEvolutionApiConfiguration): WorldEvolutionApiConfiguration;
}
const copy = <T>(v: T): T => cloneT2Json(v) as unknown as T;
export async function createT15HostWorkspace(options: {
  driver: T10Driver;
  scope: T4Scope;
  execute: T4Executor;
  prerequisites: T15Prerequisites;
  bookDriver: T12Driver;
  api: T15ApiConfigurationPort;
  transport: T15ApiTransport;
  navigate?: (destination: T11Destination) => void;
  triggerOwner?: T15TriggerOwner;
}) {
  options = Object.freeze({ ...options });
  const scope = normalizeT4Scope(options.scope),
    prerequisites = options.prerequisites,
    api = Object.freeze({ ...options.api });
  let closed = false,
    authorizedApi = false,
    refreshing = false,
    appearance: T14Appearance = copy(T14_DEFAULT);
  let data: ReturnType<typeof createT5Workbench> | undefined,
    structure: ReturnType<typeof createT6Workbench> | undefined,
    generation: Awaited<ReturnType<typeof createT7Workbench>> | undefined,
    projection: ReturnType<typeof createT12CompatibilityController> | undefined,
    backup: ReturnType<typeof createT13Controller> | undefined;
  const id = () => `h-${crypto.randomUUID().replaceAll('-', '').slice(0, 24)}`;
  const readInput = () => {
    const input = prerequisites.readInput(),
      ledger = session?.service.view().evolution;
    input.progress = ledger?.progress ?? {};
    input.eligibleRound = Math.max(input.eligibleRound, (ledger?.eligibleRound ?? 0) + 1);
    return input;
  };
  const readApi = () => normalizeWorldEvolutionApiConfiguration(api.read(), 0);
  const active = () => ['macro', 'micro', 'validating', 'saving'].includes(session?.round.view().status ?? 'idle');
  const editorsIdle = () =>
    !data?.dirty() && !data?.view().busy && data?.view().history == null && !structure?.dirty() && !structure?.isBusy();
  const idle = () => !closed && !active() && !generation?.view().busy && !projection?.isBusy() && !backup?.isBusy();
  // Not a paid request on construction. Every later dispatch is still gated by consent and source proofs.
  let session: Awaited<ReturnType<typeof openT10CompatibilitySession>> | undefined;
  const transport = Object.freeze<T15ApiTransport>({
    mode: 'real-api',
    dispatch(url, init) {
      if (!authorizedApi || closed || !prerequisites.ready() || !session?.canRun())
        throw new Error('真实 API 权限未确认或前置失效');
      options.triggerOwner?.assertClaim(scope, readInput().anchor);
      return options.transport.dispatch(url, init);
    },
  });
  try {
    session = await openT10CompatibilitySession({
      driver: options.driver,
      scope,
      execute: options.execute,
      runtime: {
        readInput,
        readApi,
        readPrompts: () => generation!.exportPrompts().enabled,
        canFreeze: () =>
          !closed &&
          editorsIdle() &&
          !generation?.view().busy &&
          !projection?.isBusy() &&
          !backup?.isBusy() &&
          !generation?.view().prompts.dirty,
        canRun: () => {
          if (options.triggerOwner) {
            try {
              options.triggerOwner.assertClaim(scope, readInput().anchor);
            } catch {
              return false;
            }
          }
          return !closed && authorizedApi && prerequisites.ready() && !projection?.isBusy() && !backup?.isBusy();
        },
        canOwnContinuation: () =>
          !closed &&
          authorizedApi &&
          prerequisites.ready() &&
          (!options.triggerOwner || options.triggerOwner.canContinue(scope, readInput().anchor)),
        queue: createT8Queue(),
        ownerId: id(),
        transport,
        afterSaved: () => {
          data?.refreshSaved();
          structure?.refreshSaved();
        },
      },
    });
    const { service, gateway, round } = session;
    const runSpec = () => ({
      runId: id(),
      commitId: id(),
      anchor: readInput().anchor,
      context: {
        inputFingerprint: readInput().anchor.inputFingerprint,
        promptFingerprint: readInput().anchor.inputFingerprint,
        modelFingerprint: readInput().anchor.inputFingerprint,
        parametersFingerprint: readInput().anchor.inputFingerprint,
      },
    });
    const canEdit = () => !closed && options.driver.writableNow?.() === true && idle();
    data = createT5Workbench({
      service,
      runSpec,
      nextId: id,
      readArchive: () => gateway.read(scope),
      canEdit: () => refreshing || (canEdit() && !structure?.dirty() && !structure?.isBusy()),
    });
    structure = createT6Workbench({
      service,
      execute: options.execute,
      runSpec,
      defaults: await createT6DefaultStore(service.view().formal.template),
      dataIdle: () => canEdit() && !data!.dirty() && !data!.view().busy && data!.view().history === null,
      afterSaved: async () => {
        refreshing = true;
        try {
          await data!.reload(false);
        } finally {
          refreshing = false;
        }
      },
    });
    await structure.readDefault();
    generation = await createT7Workbench({
      readState: () => service.view().formal,
      input: readInput(),
      api: readApi(),
      canFreeze: () => !closed && !active() && editorsIdle() && !projection?.isBusy() && !backup?.isBusy(),
    });
    const readRecovery = () => inspectT10CompatibilityHost(options.driver);
    const readSecrets = () =>
      readApi()
        .presets.map(p => p.apiKey)
        .filter(Boolean);
    projection = createT12CompatibilityController({
      scope,
      service,
      store: gateway,
      driver: options.bookDriver,
      readRecovery,
      readSecrets,
      navigateTemplate: () => options.navigate?.('world'),
      canUse: () => !closed && !active() && editorsIdle() && !generation!.view().busy && !backup?.isBusy(),
    });
    backup = createT13Controller({
      scope,
      service,
      store: gateway,
      execute: options.execute,
      runSpec: async () => runSpec(),
      readRecovery,
      readSecrets,
      canBackupPrivate: () => true,
      canUse: () =>
        !closed &&
        options.driver.writableNow?.() === true &&
        !active() &&
        editorsIdle() &&
        !generation!.view().busy &&
        !projection!.isBusy(),
      afterSaved: () => {
        data!.refreshSaved();
        structure!.refreshSaved();
      },
    });
    const daily = createT11Controller({
      service,
      round,
      store: gateway,
      readRecovery,
      canContinue: session.canContinue,
      claimDispatch: options.triggerOwner
        ? (_source, input) => options.triggerOwner!.claim(scope, input.anchor)
        : undefined,
      claimResume: options.triggerOwner ? input => options.triggerOwner!.continueClaim(scope, input.anchor) : undefined,
      runtime: {
        readInput,
        readApi,
        readPrompts: () => generation!.exportPrompts().enabled,
        canFreeze: () => idle() && editorsIdle() && !generation!.view().prompts.dirty,
        canRun: () => !closed && authorizedApi && prerequisites.ready() && options.driver.writableNow?.() === true,
      },
      restoreSpec: async () => runSpec(),
      nextRunId: id,
      projection: projection.summary,
      subscribeProjection: projection.subscribe,
      navigate: options.navigate,
    });
    const offService = service.subscribe(() => {
      if (service.view().status === 'saved') {
        data!.refreshSaved();
        structure!.refreshSaved();
      }
    });
    const offSources = prerequisites.subscribe(() => {
      // A source change during execution cancels the owned round; it never auto-starts another.
      if (active() && !prerequisites.ready()) round.cancel();
    });
    return {
      scope,
      service,
      store: gateway,
      data,
      structure,
      generation,
      daily,
      round,
      projection,
      backup,
      prerequisites,
      automaticIdle: () => idle() && editorsIdle() && !generation!.view().prompts.dirty,
      canHandoff: () =>
        editorsIdle() &&
        !generation!.view().prompts.dirty &&
        !projection!.isBusy() &&
        !backup!.isBusy() &&
        !round.view().canResume &&
        service.view().status !== 'pending' &&
        (!service.view().draft || service.view().status === 'saved'),
      apiPort: {
        read: readApi,
        save(next: WorldEvolutionApiConfiguration) {
          if (!idle() || !editorsIdle()) throw new Error('先处理运行/未保存资料，再修改 API');
          authorizedApi = false; // Changed credentials/routes need a new explicit paid-request consent.
          return api.save(normalizeWorldEvolutionApiConfiguration(next));
        },
      },
      readInput,
      readAppearance: () => copy(appearance),
      setAppearance(value: T14Appearance) {
        appearance = copy(value);
      },
      realApiEnabled: () => authorizedApi,
      authorizeRealApi(confirmed: boolean) {
        if (confirmed && (!idle() || !editorsIdle())) throw new Error('当前正在处理其他操作');
        authorizedApi = confirmed === true;
        if (!authorizedApi && active()) round.cancel();
      },
      async applyPrimaryRoute(confirmed: boolean) {
        if (!confirmed || !idle() || !editorsIdle()) throw new Error('请确认采用当前 API 主预设');
        const config = readApi(),
          preset = config.presets.find(p => p.id === config.routing.primaryPresetId && p.enabled);
        if (!preset) throw new Error('请先在 API 页保存一个启用的主预设');
        const next = copy(service.view().formal.template);
        next.defaults.api = { state: 'value', value: { presetId: preset.id } };
        structure!.replaceTemplate(next);
        await structure!.prepare();
        structure!.consent(true);
        await structure!.save();
        if (structure!.view().error) throw new Error(structure!.view().error!);
        authorizedApi = false;
        await daily.refresh();
      },
      async refresh() {
        await prerequisites.refresh();
        generation!.setInput(readInput());
        generation!.setApi(readApi());
        await daily.refresh();
        await projection!.inspect();
      },
      identity: () => fingerprintT4({ scope, anchor: readInput().anchor }),
      close() {
        if (closed) return;
        closed = true;
        authorizedApi = false;
        offSources();
        offService();
        daily.close();
        projection!.close();
        backup!.close();
        session!.close();
        prerequisites.close();
      },
    };
  } catch (error) {
    projection?.close();
    backup?.close();
    session?.close();
    throw error;
  }
}
export type T15HostWorkspace = Awaited<ReturnType<typeof createT15HostWorkspace>>;
