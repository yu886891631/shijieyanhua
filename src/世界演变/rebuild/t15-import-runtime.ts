/** Import-entry coordinator. Loading/viewing is inert; writes and paid runs require separate explicit actions. */
import { sameT10, type T10Binding } from './t10-host-protocol';
import type { T15SourceSignals } from './t15-source-signals';
import type { T15SourceSelection } from './t15-prerequisites';
export const T15_HOST_VERSION = 'A0.1.0-alpha.18-H3' as const;
export const T15_HOST_SCRIPT_ID = 'f2a5a19d-69fd-455e-b5a0-c1be169f18c3';
export interface T15ImportSources {
  mvu: boolean;
  database: boolean;
  databaseKey: string;
}
export type T15ImportSelection = { id: 'mvu' | 'database'; required: boolean; selections: T15SourceSelection[] };
export interface T15ImportInspection {
  binding: T10Binding;
  character: string;
  state: string;
  databaseKeys: string[];
  databaseProtocol: boolean;
  mvuAvailable: boolean;
  mainBook: string | null;
  /** Native captured binding/event fence, not a flag copied into JSON. */
  assertCurrent(): void;
  close?(): void;
}
export interface T15ImportSession {
  close(): void;
  canHandoff(): boolean;
  authorizeRealApi(value: boolean): void;
  daily: { setAutomatic(value: boolean): void; settled(): Promise<void> };
  automatic: { settled(): Promise<void> };
}
export interface T15ImportLifecycle<S> {
  view(): { armed: boolean; reason: string };
  arm(value: boolean): void;
  subscribe(fn: () => void): () => void;
  settled(): Promise<void>;
  close(): void;
  session(): S | null;
}
export function importT15Selections(choice: T15ImportSources, available: string[]): T15ImportSelection[] {
  if (typeof choice.mvu !== 'boolean' || typeof choice.database !== 'boolean') throw new Error('前置选择无效');
  const result: T15ImportSelection[] = [];
  if (choice.mvu)
    result.push({
      id: 'mvu',
      required: true,
      selections: [{ path: ['stat_data'], label: '本轮 MVU 角色卡变量', tableIds: [] }],
    });
  if (choice.database) {
    if (
      !choice.databaseKey ||
      !available.includes(choice.databaseKey) ||
      ['__proto__', 'constructor', 'prototype'].includes(choice.databaseKey)
    )
      throw new Error('请先选择当前聊天实际存在的数据库隔离组；不使用示例字段');
    result.push({
      id: 'database',
      required: true,
      selections: [
        {
          path: ['TavernDB_ACU_IsolatedData', choice.databaseKey],
          label: '本轮数据库：' + choice.databaseKey,
          tableIds: [],
        },
      ],
    });
  }
  return result;
}
export function createT15ImportRuntime<S extends T15ImportSession>(port: {
  inspect(): Promise<T15ImportInspection>;
  observe(choice: T15ImportSources): Promise<T15SourceSignals>;
  open(options: { signals: T15SourceSignals; sources: T15ImportSelection[]; initialize: boolean }): Promise<S>;
  lifecycle(options: {
    signals: T15SourceSignals;
    sources: T15ImportSelection[];
    initial: S;
    onWorkspace(session: S): void;
  }): T15ImportLifecycle<S>;
}) {
  port = Object.freeze({ ...port });
  let closed = false,
    busy = false,
    uiDirty = false;
  let inspection: T15ImportInspection | null = null,
    signals: T15SourceSignals | null = null,
    session: S | null = null;
  let lifecycle: T15ImportLifecycle<S> | null = null,
    offLifecycle: (() => void) | null = null,
    offSignals: (() => void) | null = null;
  let sources: T15ImportSelection[] = [];
  let reason = '尚未连接。打开本页不读取聊天、不保存、不请求模型。';
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const fn of [...listeners]) fn();
  };
  function assertIdle() {
    if (closed || busy || session) throw new Error('连接正在处理或工作台已打开');
  }
  function decorated(value: S): S {
    const original = value.canHandoff;
    value.canHandoff = () => !uiDirty && original();
    return value;
  }
  const api = {
    view: () => ({
      closed,
      busy,
      inspection: inspection
        ? {
            binding: { ...inspection.binding },
            character: inspection.character,
            state: inspection.state,
            databaseKeys: [...inspection.databaseKeys],
            databaseProtocol: inspection.databaseProtocol,
            mvuAvailable: inspection.mvuAvailable,
            mainBook: inspection.mainBook,
          }
        : null,
      observing: !!signals,
      session,
      uiDirty,
      armed: lifecycle?.view().armed ?? false,
      reason: lifecycle?.view().reason ?? reason,
    }),
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    async inspect() {
      assertIdle();
      if (signals) throw new Error('已开始观察；先关闭本次连接后重新检查');
      busy = true;
      emit();
      try {
        inspection?.close?.();
        inspection = null;
        const read = await port.inspect();
        try {
          read.assertCurrent();
          if (closed) throw new Error('入口已关闭');
          inspection = read;
          reason = '只读检查完成；尚未允许任何聊天保存或真实 API。';
        } catch (error) {
          read.close?.();
          throw error;
        }
      } finally {
        busy = false;
        emit();
      }
    },
    async observe(choice: T15ImportSources) {
      assertIdle();
      if (!inspection || signals) throw new Error('先只读检查，再开始观察一次');
      inspection.assertCurrent();
      const selected = importT15Selections(choice, inspection.databaseKeys);
      if (choice.mvu && !inspection.mvuAvailable) throw new Error('未检测到已就绪 MVU；先检查安装，不会跳过必要来源');
      busy = true;
      emit();
      let observed: T15SourceSignals | null = null;
      try {
        observed = await port.observe({ ...choice });
        inspection.assertCurrent();
        if (closed) throw new Error('入口已关闭');
        signals = observed;
        sources = selected;
        offSignals = signals.subscribe(notice => {
          if ((notice === 'binding' || notice === 'cancelled') && !session) {
            inspection?.close?.();
            inspection = null;
            reason = '目标切换/停止使本次检查失效；断开后重新检查。';
            emit();
          }
        });
        reason = '已观察后续完成通知；无收费请求、无聊天写入。旧事件不回放。';
      } catch (error) {
        observed?.close();
        throw error;
      } finally {
        busy = false;
        emit();
      }
    },
    async connect(confirmedWrites: boolean, initialize: boolean) {
      assertIdle();
      if (confirmedWrites !== true) throw new Error('需要明确允许在备份测试聊天写入新世界演变存档');
      if (!inspection || !signals) throw new Error('先检查并开始观察前置来源');
      // Source notifications may advance the reply, but never switch the approved character/chat.
      if (!sameT10(inspection.binding, signals.frame().binding)) throw new Error('测试聊天已切换，重新检查');
      busy = true;
      emit();
      let opened: S | null = null;
      try {
        opened = decorated(await port.open({ signals, sources: structuredClone(sources), initialize }));
        if (closed) throw new Error('入口已关闭');
        const created = port.lifecycle({
          signals,
          sources: structuredClone(sources),
          initial: opened,
          onWorkspace(next) {
            session = decorated(next);
            uiDirty = false;
            emit();
          },
        });
        session = opened;
        lifecycle = created;
        offLifecycle = created.subscribe(emit);
        reason = '测试工作台已接入；真实 API 和自动运行仍关闭。';
      } catch (error) {
        opened?.close();
        if (opened) await Promise.all([opened.daily.settled(), opened.automatic.settled()]);
        throw error;
      } finally {
        busy = false;
        emit();
      }
    },
    setUiDirty(value: boolean) {
      uiDirty = value === true;
      emit();
    },
    arm(confirmed: boolean) {
      if (closed || busy || !lifecycle || !session) throw new Error('尚未连接可运行工作台');
      if (confirmed && uiDirty) throw new Error('先保存或取消 API 草稿');
      lifecycle.arm(confirmed === true);
      emit();
    },
    async disconnect(allowDiscard = false) {
      if (busy) throw new Error('正在连接，请等本次操作收口');
      if (session && (!session.canHandoff() || uiDirty) && !allowDiscard)
        throw new Error('有未保存/暂停/未确认内容；没有丢弃，请先处理');
      offLifecycle?.();
      offLifecycle = null;
      if (lifecycle) {
        lifecycle.close();
        await lifecycle.settled();
      } else if (session) {
        session.close();
        await Promise.all([session.daily.settled(), session.automatic.settled()]);
      }
      lifecycle = null;
      session = null;
      offSignals?.();
      offSignals = null;
      signals?.close();
      signals = null;
      inspection?.close?.();
      inspection = null;
      uiDirty = false;
      sources = [];
      reason = '已断开；关闭不等于远端请求未收费或未保存。';
      emit();
    },
    close() {
      closed = true;
      lifecycle?.close();
      session?.close();
      signals?.close();
      inspection?.close?.();
      offSignals?.();
      offLifecycle?.();
      listeners.clear();
    },
  };
  return api;
}
