/** Explicit native composition. Not imported or started by the isolated candidate entry. */
import { loadWorldEvolutionApiConfiguration, saveWorldEvolutionApiConfiguration } from '../api-config';
import { createT15NativeCompatibilityHost } from './t15-chat-compatibility';
import { createT15NativeApiTransport } from './t15-tavern-host';
import { createT10CompatibilityGateway } from './t10-host-gateway';
import { inspectT10CompatibilityHost } from './t10-recovery';
import { createDefaultT2Template } from './t2-defaults';
import { createT2EmptyWorld } from './t2-values';
import { captureT15Input, createT15Prerequisites, type T15SourceSelection } from './t15-prerequisites';
import type { createT15SourceSignals } from './t15-source-signals';
import { createT15NativeWorldbookCompatibility } from './t15-worldbook-compatibility';
import { createT15HostWorkspace } from './t15-host-workspace';
import type { T4Executor } from './t4-service';
import type { T4Scope } from './t4-protocol';
import type { T11Destination } from './t11-controller';
import { attachT15Automatic, type T15Automatic } from './t15-automatic';
import { acquireT15TriggerOwner, assertT15NoOtherEntries } from './t15-trigger-ownership';
import { createT15AutomaticLifecycle } from './t15-automatic-lifecycle';
import { canonicalT4Json } from './t4-protocol';
export async function openT15NativeWorkspace(options: {
  version: string;
  execute: T4Executor;
  confirmedSinglePage: boolean;
  initializeIfEmpty: boolean;
  sources: { id: 'mvu' | 'database'; required: boolean; selections: T15SourceSelection[] }[];
  /** Start observation before the source plugins run, not after their events were lost. */
  signals: ReturnType<typeof createT15SourceSignals>;
  /** Daily entry may open an already stamped archive without any startup write. */
  registerOnOpen?: boolean;
  /** Ambiguous/missing source selection blocks sending, not browsing/editing. */
  assertSourceConfiguration?: () => void;
  navigate?: (destination: T11Destination) => void;
  /** Captured automatic lifecycle authorization; also checked at every real send. */
  assertTriggerCurrent?: () => void;
}) {
  options = Object.freeze({ ...options });
  if (options.confirmedSinglePage !== true)
    throw new Error('请先确认：备份后的单角色测试聊天、单活动页面、停用旧写入脚本');
  options.assertTriggerCurrent?.();
  const sources = structuredClone(options.sources);
  const owner = acquireT15TriggerOwner(window.parent, () => {
    assertT15NoOtherEntries(
      ['global', 'preset', 'character'].map(type => getScriptTrees({ type: type as ScriptTreesOptions['type'] })),
      getScriptId(),
    );
  });
  let host: ReturnType<typeof createT15NativeCompatibilityHost>;
  try {
    host = createT15NativeCompatibilityHost(options.version);
  } catch (error) {
    owner.close();
    throw error;
  }
  let epoch = 0;
  let automatic: T15Automatic | null = null;
  const off = host.driver.subscribe!(() => {
    epoch++;
    automatic?.invalidate();
  });
  let book: ReturnType<typeof createT15NativeWorldbookCompatibility> | null = null;
  let gate: ReturnType<typeof createT15Prerequisites> | null = null;
  try {
    const gateway = createT10CompatibilityGateway(host.driver),
      recovery = await inspectT10CompatibilityHost(host.driver);
    let scope: T4Scope;
    if (recovery.status === 'empty') {
      if (!options.initializeIfEmpty) throw new Error('当前聊天没有新格式存档；需要单独确认初始化，不自动迁移旧库');
      scope = {
        mode: 't10-host',
        chatId: `chat-${crypto.randomUUID().replaceAll('-', '').slice(0, 20)}`,
        worldId: 'world',
        branchId: 'main',
      };
      const template = createDefaultT2Template();
      await gateway.initialize(
        scope,
        { template, data: createT2EmptyWorld(template, scope.worldId, scope.branchId) },
        kind => `${kind}-${crypto.randomUUID().replaceAll('-', '').slice(0, 20)}`,
      );
    } else {
      if (recovery.status !== 'ready' || !recovery.writable || !recovery.scope)
        throw new Error('当前存档有未确认/失效记录；仅查询恢复，不能直接重开真实请求');
      scope = recovery.scope;
      if (options.registerOnOpen !== false)
        await gateway.registerMessages(
          scope,
          kind => `${kind}-${crypto.randomUUID().replaceAll('-', '').slice(0, 20)}`,
        );
    }
    const port = { read: () => host.driver.readDurable(host.driver.currentBinding()), epoch: () => epoch },
      input = await captureT15Input(port, scope, Math.max(1, (recovery.evolution?.eligibleRound ?? 0) + 1));
    gate = createT15Prerequisites({ port, scope, input, sources });
    for (const source of sources) {
      if (source.id === 'mvu') {
        try {
          options.signals.applyMvu(gate, source.selections);
        } catch {
          gate.hint('mvu', '没有捕获当前回复的 MVU 完成候选；不把旧变量或生成结束当成成功');
        }
      } else options.signals.applyDatabase(gate, source.selections);
    }
    book = createT15NativeWorldbookCompatibility(host, scope);
    const workspace = await createT15HostWorkspace({
      driver: host.driver,
      scope,
      execute: options.execute,
      prerequisites: gate,
      bookDriver: book.driver,
      api: { read: () => loadWorldEvolutionApiConfiguration(), save: saveWorldEvolutionApiConfiguration },
      transport: createT15NativeApiTransport(() => {
        options.assertSourceConfiguration?.();
        options.assertTriggerCurrent?.();
        owner.assertClaim(scope, gate!.readInput().anchor);
        if (sources.some(s => s.id === 'mvu' && s.required) && !options.signals.status().mvu) {
          gate?.hint('mvu', 'MVU 本轮完成证据已失效；不能沿用旧结果发送');
          throw new Error('MVU 本轮完成证据已失效');
        }
        if (sources.some(s => s.id === 'database' && s.required) && !options.signals.status().database) {
          gate?.hint('database', '数据库本轮完成证据已失效；不能沿用旧结果发送');
          throw new Error('数据库本轮完成证据已失效');
        }
        if (host.status().state !== 'ready' || !host.status().ownsPage || !gate?.ready())
          throw new Error('来源或页面权限已撤销');
      }),
      navigate: options.navigate,
      triggerOwner: owner,
    });
    const refresh = async () => {
      for (const source of sources) {
        if (source.id === 'mvu') {
          try {
            options.signals.applyMvu(gate!, source.selections);
          } catch {
            gate!.hint('mvu', '没有捕获当前回复的 MVU 完成候选');
          }
        } else options.signals.applyDatabase(gate!, source.selections);
      }
      await workspace.refresh();
    };
    try {
      automatic = attachT15Automatic({
        signals: options.signals,
        gate,
        sources,
        daily: workspace.daily,
        authorized: workspace.realApiEnabled,
        valid: () => host.status().state === 'ready' && owner.owns(),
        busy: () => !workspace.automaticIdle(),
        assertOwner: owner.assertAvailable,
        refresh,
      });
    } catch (error) {
      workspace.close();
      throw error;
    }
    return {
      ...workspace,
      automatic,
      refresh,
      close() {
        automatic!.close();
        owner.close();
        options.signals.detach(gate!);
        workspace.close();
        book!.close();
        off();
        host.close();
      },
    };
  } catch (error) {
    owner.close();
    if (gate) options.signals.detach(gate);
    gate?.close();
    book?.close();
    off();
    host.close();
    throw error;
  }
}
/** Explicit runtime composition only. Existing initialized world required; no auto migration/seed. */
export function createT15NativeAutomaticLifecycle(
  options: Omit<Parameters<typeof openT15NativeWorkspace>[0], 'initializeIfEmpty' | 'assertTriggerCurrent'> & {
    onWorkspace?: (workspace: Awaited<ReturnType<typeof openT15NativeWorkspace>>) => void;
    initialSession?: Awaited<ReturnType<typeof openT15NativeWorkspace>>;
  },
) {
  options = Object.freeze({ ...options, sources: structuredClone(options.sources) });
  if (!options.confirmedSinglePage) throw new Error('需要明确的单活动测试页面确认');
  const lifecycle = createT15AutomaticLifecycle({
    signals: options.signals,
    sources: options.sources,
    configurationIdentity: () => canonicalT4Json(loadWorldEvolutionApiConfiguration()),
    open: assertTriggerCurrent =>
      openT15NativeWorkspace({ ...options, initializeIfEmpty: false, assertTriggerCurrent }),
    onWorkspace: options.onWorkspace,
    initialSession: options.initialSession,
  });
  const hide = () => lifecycle.close();
  window.addEventListener('pagehide', hide, { once: true });
  return {
    ...lifecycle,
    close() {
      window.removeEventListener('pagehide', hide);
      lifecycle.close();
    },
  };
}
