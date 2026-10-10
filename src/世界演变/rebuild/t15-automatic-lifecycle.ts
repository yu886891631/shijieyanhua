/** Re-capture a fresh native session per reply. Explicit arming; no opening/replay/initialization trigger. */
import type { T15SourceSignals, T15SignalFrame } from './t15-source-signals';
import { sameT10 } from './t10-host-protocol';
interface Session {
  daily: {
    setAutomatic(value: boolean): void;
    view(): { autoEnabled: boolean };
    subscribe(fn: () => void): () => void;
    settled(): Promise<void>;
  };
  authorizeRealApi(confirmed: boolean): void;
  realApiEnabled(): boolean;
  canHandoff(): boolean;
  automatic: { settled(): Promise<void> };
  close(): void;
}
type Frame = T15SignalFrame & { epoch: number };
const same = (a: Frame, b: Frame) =>
  sameT10(a.binding, b.binding) &&
  a.message === b.message &&
  a.swipe === b.swipe &&
  a.text === b.text &&
  a.epoch === b.epoch;
export function createT15AutomaticLifecycle<S extends Session>(options: {
  signals: T15SourceSignals;
  sources: { id: 'mvu' | 'database'; required: boolean }[];
  /** Kept only in memory; never displayed/logged/stored. Changes revoke the grant. */
  configurationIdentity(): string;
  open(assertCurrent: () => void): Promise<S>;
  /** Embedding caller reuses the existing panel; no new UI or server. */
  onWorkspace?: (session: S) => void;
  /** Explicit initial editable session, adopted without restoring API/automatic consent. */
  initialSession?: S;
}) {
  options = Object.freeze({ ...options, sources: structuredClone(options.sources) });
  let closed = false,
    armed = false,
    pumping = false;
  let binding: T15SignalFrame['binding'] | null = null,
    config: string | null = null;
  let frame: Frame | null = null,
    pending: Frame | null = null,
    session: S | null = options.initialSession ?? null;
  let reason = '默认关闭；须明确授权后等待新的来源/剧情通知，不回放旧事件';
  let offSession: (() => void) | null = null;
  let tail = Promise.resolve();
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const fn of listeners) {
      try {
        fn();
      } catch {
        /* View is not authority. */
      }
    }
  };
  const ready = () => {
    const status = options.signals.status();
    return options.sources.every(s => !s.required || (s.id === 'mvu' ? status.mvu : status.database));
  };
  function assertCurrent(target: Frame) {
    if (
      closed ||
      !armed ||
      !binding ||
      !sameT10(binding, target.binding) ||
      !same(target, options.signals.frame()) ||
      !ready() ||
      options.configurationIdentity() !== config
    )
      throw new Error('自动轮次、来源或 API 授权已失效');
  }
  async function retire() {
    offSession?.();
    offSession = null;
    const old = session;
    session = null;
    frame = null;
    if (old) {
      old.close();
      await Promise.all([old.daily.settled(), old.automatic.settled()]);
    }
  }
  async function pump() {
    if (pumping || closed) return;
    pumping = true;
    try {
      while (pending && armed && !closed) {
        const target = pending;
        pending = null;
        assertCurrent(target);
        if (frame && same(frame, target) && session) continue;
        if (session && !session.canHandoff()) {
          armed = false;
          reason = '旧页面有草稿、暂停或未知保存结果；保留页面，先处理后再启用自动';
          session.daily.setAutomatic(false);
          emit();
          break;
        }
        await retire();
        assertCurrent(target);
        const opened = await options.open(() => assertCurrent(target));
        try {
          assertCurrent(target);
          session = opened;
          frame = target;
          opened.authorizeRealApi(true);
          opened.daily.setAutomatic(true);
          offSession = opened.daily.subscribe(() => {
            if (!opened.daily.view().autoEnabled || !opened.realApiEnabled()) {
              armed = false;
              pending = null;
              reason = '页面关闭了自动运行或真实 API 权限；不会自动重新开启';
              emit();
            }
          });
          options.onWorkspace?.(opened);
          reason = '已捕获当前回复；保存复核与运行仍由同一个工作台调度器处理';
          // Reuses the freshly observed event; arming/opening without it never gets here.
          options.signals.wake(options.sources.length ? 'source' : 'assistant');
        } catch (error) {
          opened.close();
          await Promise.all([opened.daily.settled(), opened.automatic.settled()]);
          if (session === opened) {
            offSession?.();
            offSession = null;
            session = null;
            frame = null;
          }
          throw error;
        }
      }
    } catch {
      armed = false;
      pending = null;
      session?.daily.setAutomatic(false);
      reason = '自动接管未完成；输入、来源、配置或所有权不匹配，未自动重开/重试';
    } finally {
      pumping = false;
      emit();
    }
  }
  const offSignals = options.signals.subscribe(notice => {
    if (closed || !armed) return;
    if (notice === 'binding' || notice === 'cancelled') {
      armed = false;
      pending = null;
      session?.daily.setAutomatic(false);
      reason = '聊天/角色切换或停止生成使授权失效，包括切走后再切回；需要重新确认';
      emit();
      return;
    }
    if (!options.sources.length && notice !== 'assistant') return;
    try {
      if (options.configurationIdentity() !== config) {
        armed = false;
        pending = null;
        session?.daily.setAutomatic(false);
        reason = 'API 配置改变；自动授权已撤销';
        emit();
        return;
      }
      if (session && (!session.daily.view().autoEnabled || !session.realApiEnabled())) {
        armed = false;
        pending = null;
        reason = '当前页面已撤销自动或 API 权限；不会由下一条通知重新开启';
        emit();
        return;
      }
      if (!ready()) {
        reason = '等待必要来源完成；不会用普通表格变化或生成结束代替';
        emit();
        return;
      }
      const next = options.signals.frame();
      if (!binding || !sameT10(binding, next.binding) || options.configurationIdentity() !== config) {
        armed = false;
        pending = null;
        session?.daily.setAutomatic(false);
        reason = '聊天/角色或 API 配置改变，自动授权已撤销；需要重新确认';
        emit();
        return;
      }
      pending = { ...next, binding: { ...next.binding } };
      if (!pumping) tail = tail.then(pump);
    } catch {
      armed = false;
      pending = null;
      reason = '当前回复无效；未启动自动演变';
      emit();
    }
  });
  return {
    view: () => ({ closed, armed, pumping, pending: !!pending, reason }),
    session: () => session,
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    arm(confirmedRealRequests: boolean) {
      if (closed) throw new Error('自动生命周期已关闭');
      pending = null;
      if (confirmedRealRequests !== true) {
        armed = false;
        config = null;
        binding = null;
        session?.daily.setAutomatic(false);
        session?.authorizeRealApi(false);
      } else {
        const current = options.signals.frame();
        binding = { ...current.binding };
        config = options.configurationIdentity();
        armed = true;
        session?.authorizeRealApi(true);
        session?.daily.setAutomatic(true);
      }
      reason = '已更新授权；仍只等待之后的新通知，勾选本身不请求模型';
      emit();
    },
    settled: async () => {
      await tail;
    },
    close() {
      if (closed) return;
      closed = true;
      armed = false;
      pending = null;
      config = null;
      offSignals();
      tail = tail.then(retire);
      session?.close();
      listeners.clear();
    },
  };
}
