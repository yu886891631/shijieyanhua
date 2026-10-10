/** Lazy native import ports. No probe/read/observer starts until an explicit entry action. */
import { createT15ImportRuntime, T15_HOST_VERSION, type T15ImportInspection } from './t15-import-runtime';
import { createT15NativeTavernHost } from './t15-tavern-host';
import { recoverT10Document } from './t10-recovery';
import { createT15NativeSourceSignals } from './t15-source-signals';
import { createT15NativeAutomaticLifecycle, openT15NativeWorkspace } from './t15-native-workspace';
import { T15_DB_COMPLETION_PROTOCOL } from './t15-db-completion-protocol';
import { assertT15NoOtherEntries } from './t15-trigger-ownership';
import type { T4Executor } from './t4-service';
import { sameT10 } from './t10-host-protocol';
export function createT15NativeImportRuntime(execute: T4Executor) {
  return createT15ImportRuntime({
    async inspect(): Promise<T15ImportInspection> {
      assertT15NoOtherEntries(
        ['global', 'preset', 'character'].map(type => getScriptTrees({ type: type as ScriptTreesOptions['type'] })),
        getScriptId(),
      );
      const host = createT15NativeTavernHost(T15_HOST_VERSION);
      try {
        const binding = host.driver.currentBinding(),
          stamp = host.eventEpoch();
        const doc = await host.driver.readDurable(binding),
          recovery = await recoverT10Document(doc, 'unverified-host');
        if (host.eventEpoch() !== stamp) throw new Error('检查期间聊天发生变化');
        const c = SillyTavern,
          card = c.characters[Number(c.characterId)],
          last = doc.messages.at(-1);
        if (!last || last.role !== 'assistant' || last.is_hidden)
          throw new Error('请打开已保存且最后一条为助手剧情的单角色测试聊天');
        const raw = last.TavernDB_ACU_IsolatedData;
        const databaseKeys =
          raw && typeof raw === 'object' && !Array.isArray(raw)
            ? Object.keys(raw).filter(k => !['__proto__', 'constructor', 'prototype'].includes(k))
            : [];
        const db = (
          window.parent as Window & {
            AutoCardUpdaterAPI?: { getWorldEvolutionCompletion?: () => { protocol?: string } };
          }
        ).AutoCardUpdaterAPI;
        let databaseProtocol = false;
        try {
          databaseProtocol = db?.getWorldEvolutionCompletion?.().protocol === T15_DB_COMPLETION_PROTOCOL;
        } catch {
          /* not supported */
        }
        // Keep only target invalidation listeners until disconnect/recheck, including A -> B -> A.
        const liveBinding = () => host.driver.currentBinding();
        const frame = c.chat.at(-1),
          text = frame?.mes,
          swipe = frame?.swipe_id ?? 0;
        return {
          binding,
          character: card?.name ?? '当前角色卡',
          state: recovery.status,
          databaseKeys,
          databaseProtocol,
          mvuAvailable:
            typeof Mvu !== 'undefined' &&
            typeof Mvu.events?.COMMAND_PARSED === 'string' &&
            typeof Mvu.events?.VARIABLE_UPDATE_ENDED === 'string',
          mainBook: getCharWorldbookNames('current').primary,
          assertCurrent() {
            if (
              host.eventEpoch() !== stamp ||
              !sameT10(binding, liveBinding()) ||
              SillyTavern.chat.at(-1) !== frame ||
              frame?.mes !== text ||
              (frame?.swipe_id ?? 0) !== swipe
            )
              throw new Error('只读检查的目标已变化；请重新检查');
          },
          close: host.close,
        };
      } catch (error) {
        host.close();
        throw error;
      }
    },
    observe: choice => createT15NativeSourceSignals({ mvu: choice.mvu, database: choice.database }),
    open: options =>
      openT15NativeWorkspace({
        version: T15_HOST_VERSION,
        execute,
        confirmedSinglePage: true,
        initializeIfEmpty: options.initialize,
        sources: options.sources,
        signals: options.signals,
      }),
    lifecycle: options =>
      createT15NativeAutomaticLifecycle({
        version: T15_HOST_VERSION,
        execute,
        confirmedSinglePage: true,
        sources: options.sources,
        signals: options.signals,
        initialSession: options.initial,
        onWorkspace: options.onWorkspace,
      }),
  });
}
