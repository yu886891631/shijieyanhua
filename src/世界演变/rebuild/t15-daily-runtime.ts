/** Read-first daily entry. Opening the UI never initializes/stamps a chat or authorizes a model. */
import type { T10Binding } from './t10-host-protocol';
import { sameT10 } from './t10-host-protocol';
import type { T10RecoveryView } from './t10-recovery';
import type { T15ImportSession, T15ImportLifecycle, T15ImportSelection } from './t15-import-runtime';
import type { T15SourceSignals } from './t15-source-signals';
export const T15_DAILY_VERSION = 'A0.1.0-alpha.19-H4';
export const T15_DAILY_SCRIPT_ID = 'dc3b738a-7fb4-4e38-a80c-e6c3bf2e113c';
export interface T15DailyInspection {
  binding: T10Binding;
  character: string;
  recovery: T10RecoveryView;
  mainBook: string | null;
  mvuRequired: boolean;
  mvuAvailable: boolean;
  databaseRequired: boolean;
  databaseProtocol: boolean;
  databaseKeys: string[];
  canOpenReadFirst: boolean;
  assertCurrent(): void;
  close(): void;
}
export function dailyT15Sources(info: T15DailyInspection, databaseKey: string): T15ImportSelection[] {
  const result: T15ImportSelection[] = [];
  if (info.mvuRequired)
    result.push({
      id: 'mvu',
      required: true,
      selections: [{ path: ['stat_data'], label: '本轮 MVU 资料', tableIds: [] }],
    });
  if (info.databaseRequired)
    result.push({
      id: 'database',
      required: true,
      selections: info.databaseKeys.includes(databaseKey)
        ? [{ path: ['TavernDB_ACU_IsolatedData', databaseKey], label: '本轮数据库资料', tableIds: [] }]
        : [],
    });
  return result;
}
export function createT15DailyRuntime<S extends T15ImportSession>(port: {
  inspect(changed: (bindingChanged: boolean) => void): Promise<T15DailyInspection>;
  observe(info: T15DailyInspection): Promise<T15SourceSignals>;
  open(options: {
    info: T15DailyInspection;
    signals: T15SourceSignals;
    sources: T15ImportSelection[];
    initialize: boolean;
    readFirst: boolean;
    assertSources(): void;
  }): Promise<S>;
  lifecycle(options: {
    signals: T15SourceSignals;
    sources: T15ImportSelection[];
    initial: S;
    assertSources(): void;
    onWorkspace(session: S): void;
  }): T15ImportLifecycle<S>;
}) {
  port = Object.freeze({ ...port });
  let info: T15DailyInspection | null = null,
    session: S | null = null;
  let signals: T15SourceSignals | null = null,
    signalBinding: T10Binding | null = null;
  let signalConfiguration = '';
  let lifecycle: T15ImportLifecycle<S> | null = null,
    offLifecycle: (() => void) | null = null;
  let busy = false,
    closed = false,
    dirty = false,
    stale = false,
    pendingRefresh = false,
    generation = 0;
  let databaseKey = '',
    error = '',
    notice = '正在识别当前聊天；不会保存或调用模型。';
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const fn of [...listeners]) fn();
  };
  const handoff = () => !dirty && (!session || session.canHandoff());
  function decorate(value: S) {
    const old = value.canHandoff,
      authorize = value.authorizeRealApi;
    value.canHandoff = () => !dirty && old();
    value.authorizeRealApi = enabled => {
      if (enabled) assertSources();
      authorize(enabled);
    };
    return value;
  }
  function assertSources() {
    if (!info) throw new Error('尚未读取当前聊天');
    if (info.databaseRequired && (!info.databaseProtocol || !info.databaseKeys.includes(databaseKey)))
      throw new Error('数据库完成接口或当前表组尚未确认；可查看/编辑资料，但不能启动演变');
    if (info.mvuRequired && !info.mvuAvailable) throw new Error('MVU 尚未就绪；不能启动演变');
  }
  async function retire() {
    offLifecycle?.();
    offLifecycle = null;
    lifecycle?.close();
    if (lifecycle) await lifecycle.settled();
    else if (session) {
      session.close();
      await Promise.all([session.daily.settled(), session.automatic.settled()]);
    }
    lifecycle = null;
    session = null;
  }
  async function establish(readFirst: boolean) {
    if (!info || !signals) throw new Error('当前聊天资料尚未载入');
    info.assertCurrent();
    const sources = dailyT15Sources(info, databaseKey);
    const opened = decorate(
      await port.open({
        info,
        signals,
        sources,
        initialize: !readFirst && info.recovery.status === 'empty',
        readFirst,
        assertSources,
      }),
    );
    if (closed) {
      opened.close();
      throw new Error('页面已关闭');
    }
    let next: T15ImportLifecycle<S>;
    try {
      next = port.lifecycle({
        signals,
        sources,
        initial: opened,
        assertSources,
        onWorkspace(value) {
          session = decorate(value);
          stale = false;
          emit();
        },
      });
    } catch (e) {
      opened.close();
      throw e;
    }
    session = opened;
    lifecycle = next;
    offLifecycle = next.subscribe(emit);
    notice = '当前聊天资料已载入。真实 API 与自动演变默认关闭。';
  }
  const api = {
    view: () => ({
      info,
      session,
      busy,
      closed,
      stale,
      dirty,
      databaseKey,
      notice,
      error,
      armed: lifecycle?.view().armed ?? false,
    }),
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    async refresh() {
      if (closed) return;
      if (busy) {
        pendingRefresh = true;
        return;
      }
      if (!handoff()) {
        stale = true;
        notice = '聊天有变化；先保存或取消草稿，再刷新资料。不会丢弃修改。';
        emit();
        return;
      }
      busy = true;
      pendingRefresh = false;
      error = '';
      const attempt = ++generation;
      emit();
      try {
        await retire();
        info?.close();
        info = null;
        const read = await port.inspect(bindingChanged => {
          if (closed || attempt !== generation) return;
          if (session && !bindingChanged) {
            if (!lifecycle?.view().armed) {
              stale = true;
              notice = '剧情已更新。资料仍保留；编辑下一轮前请刷新。';
              emit();
            }
            return; // H2 owns automatic reply handoff, never reconstruct its observers here.
          }
          pendingRefresh = true;
          void api.refresh();
        });
        if (closed || attempt !== generation) {
          read.close();
          return;
        }
        try {
          read.assertCurrent();
        } catch (e) {
          read.close();
          throw e;
        }
        info = read;
        if (!read.databaseKeys.includes(databaseKey))
          databaseKey = read.databaseKeys.length === 1 ? read.databaseKeys[0] : '';
        const configuration = JSON.stringify([read.mvuAvailable, read.databaseRequired]);
        if (!signalBinding || !sameT10(signalBinding, read.binding) || signalConfiguration !== configuration) {
          signals?.close();
          signals = null;
          signals = await port.observe(read);
          signalBinding = { ...read.binding };
          signalConfiguration = configuration;
        }
        if (closed) {
          signals?.close();
          read.close();
          return;
        }
        stale = false;
        notice =
          read.recovery.status === 'empty'
            ? '当前聊天还没有世界演变存档；默认表仅供查看，尚未保存。'
            : '已读取当前聊天的已保存资料。';
        if (read.canOpenReadFirst) {
          try {
            await establish(true);
          } catch {
            notice = '已读取资料；启用编辑前会重新核对当前聊天。';
          }
        }
      } catch (e) {
        error = e instanceof Error ? e.message.slice(0, 200) : '无法读取当前聊天';
        notice = '无法自动读取；页面仍可浏览和配置 API。请打开单角色聊天后刷新。';
      } finally {
        busy = false;
        emit();
        if (pendingRefresh && !closed) {
          pendingRefresh = false;
          void api.refresh();
        }
      }
    },
    setDirty(value: boolean) {
      dirty = value === true;
      emit();
    },
    async edit(confirmedSave: boolean) {
      if (confirmedSave !== true) throw new Error('请确认把资料保存到当前聊天');
      if (closed || busy || !handoff() || !info || !signals) throw new Error('先处理草稿，或等待当前聊天载入');
      if (stale) throw new Error('剧情已变化，请先刷新资料');
      busy = true;
      error = '';
      emit();
      try {
        await retire();
        await establish(false);
      } catch (e) {
        stale = true;
        error = e instanceof Error ? e.message.slice(0, 200) : '未能启用编辑';
        throw e;
      } finally {
        busy = false;
        emit();
        if (pendingRefresh && !closed) {
          pendingRefresh = false;
          void api.refresh();
        }
      }
    },
    async selectDatabaseKey(value: string) {
      if (closed || busy || !handoff() || !info || !info.databaseKeys.includes(value))
        throw new Error('先处理草稿，再选择本聊天的表组');
      busy = true;
      emit();
      try {
        await retire();
        if (closed) return;
        databaseKey = value;
        stale = false;
        notice = '已选择当前聊天的数据库表组；没有调用模型。';
        if (info.canOpenReadFirst) await establish(true);
      } catch (e) {
        stale = true;
        throw e;
      } finally {
        busy = false;
        emit();
        if (pendingRefresh && !closed) {
          pendingRefresh = false;
          void api.refresh();
        }
      }
    },
    arm(confirmed: boolean) {
      if (!confirmed) {
        lifecycle?.arm(false);
        emit();
        return;
      }
      if (!session || !lifecycle || busy || dirty || stale) throw new Error('请先处理草稿并刷新当前资料');
      if (confirmed) assertSources();
      lifecycle.arm(confirmed);
      emit();
    },
    close() {
      if (closed) return;
      closed = true;
      generation++;
      lifecycle?.close();
      session?.close();
      offLifecycle?.();
      signals?.close();
      info?.close();
      listeners.clear();
    },
  };
  return api;
}
