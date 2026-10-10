/** Native read-first ports. Actual persisted snapshots; never seed demo data or authorize paid requests. */
import { createT15DailyRuntime, T15_DAILY_VERSION, type T15DailyInspection } from './t15-daily-runtime';
import { createT15NativeTavernHost } from './t15-tavern-host';
import { recoverT10Document } from './t10-recovery';
import { T10_NAMESPACE, sameT10 } from './t10-host-protocol';
import { T15_DB_COMPLETION_PROTOCOL } from './t15-db-completion-protocol';
import { createT15NativeSourceSignals } from './t15-source-signals';
import { openT15NativeWorkspace, createT15NativeAutomaticLifecycle } from './t15-native-workspace';
import type { T4Executor } from './t4-service';
import type { T11Destination } from './t11-controller';
export function createT15NativeDailyRuntime(execute: T4Executor, navigate?: (destination: T11Destination) => void) {
  return createT15DailyRuntime({
    async inspect(changed): Promise<T15DailyInspection> {
      const host = createT15NativeTavernHost(T15_DAILY_VERSION);
      let off: (() => void) | undefined;
      try {
        const binding = host.driver.currentBinding(),
          stamp = host.eventEpoch();
        const doc = await host.driver.readDurable(binding),
          recovery = await recoverT10Document(doc, 'unverified-host');
        if (host.eventEpoch() !== stamp) throw new Error('聊天正在更新，请稍后刷新');
        const last = doc.messages.at(-1),
          raw = last?.TavernDB_ACU_IsolatedData;
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
          /* Optional interface may be unavailable. */
        }
        const mvuPresent = typeof Mvu !== 'undefined';
        const mvuAvailable =
          mvuPresent &&
          typeof Mvu.events?.COMMAND_PARSED === 'string' &&
          typeof Mvu.events?.VARIABLE_UPDATE_ENDED === 'string';
        off = host.driver.subscribe!(event => changed(['chat-changed', 'copied', 'branched'].includes(event)));
        let mainBook: string | null = null;
        try {
          mainBook = getCharWorldbookNames('current').primary;
        } catch {
          /* A missing book never prevents reading tables. */
        }
        return {
          binding,
          character: SillyTavern.characters[Number(SillyTavern.characterId)]?.name ?? '当前角色卡',
          recovery,
          mainBook,
          mvuRequired: mvuPresent || doc.messages.some(m => Object.hasOwn(m, 'stat_data')),
          mvuAvailable,
          databaseRequired: !!db || databaseKeys.length > 0,
          databaseProtocol,
          databaseKeys,
          canOpenReadFirst:
            recovery.status === 'ready' &&
            !recovery.runs.some(r => ['interrupted', 'stale'].includes(r.status)) &&
            last?.role === 'assistant' &&
            !last.is_hidden &&
            !!last.swipes_data[last.swipe_id]?.[T10_NAMESPACE],
          assertCurrent() {
            if (host.eventEpoch() !== stamp || !sameT10(binding, host.driver.currentBinding()))
              throw new Error('当前聊天已变化，请刷新资料');
          },
          close() {
            off?.();
            host.close();
          },
        };
      } catch (e) {
        off?.();
        host.close();
        throw e;
      }
    },
    observe: info => createT15NativeSourceSignals({ mvu: info.mvuAvailable, database: info.databaseRequired }),
    open: async options => {
      const opened = await openT15NativeWorkspace({
        version: T15_DAILY_VERSION,
        execute,
        confirmedSinglePage: true,
        initializeIfEmpty: options.initialize,
        registerOnOpen: !options.readFirst,
        assertSourceConfiguration: options.assertSources,
        signals: options.signals,
        sources: options.sources,
        navigate,
      });
      try {
        await opened.daily.refresh();
        return opened;
      } catch (error) {
        opened.close();
        throw error;
      }
    },
    lifecycle: options =>
      createT15NativeAutomaticLifecycle({
        version: T15_DAILY_VERSION,
        execute,
        confirmedSinglePage: true,
        signals: options.signals,
        sources: options.sources,
        assertSourceConfiguration: options.assertSources,
        initialSession: options.initial,
        onWorkspace: options.onWorkspace,
        navigate,
      }),
  });
}
