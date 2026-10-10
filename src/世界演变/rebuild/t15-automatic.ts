/** One event-driven wake/check/dispatch path. Timers only retry durable evidence, never prove completion. */
import type { T15SourceSignals } from './t15-source-signals';
import type { T15SourceSelection, T15Prerequisites, T15Source } from './t15-prerequisites';
interface DailyPort {
  view(): { autoEnabled: boolean; busy: boolean };
  subscribe(fn: () => void): () => void;
  trigger(event: 'prerequisite-changed'): Promise<boolean>;
  cancel(): void;
}
export function attachT15Automatic(options: {
  signals: T15SourceSignals;
  gate: T15Prerequisites;
  sources: { id: T15Source; required: boolean; selections: T15SourceSelection[] }[];
  daily: DailyPort;
  authorized(): boolean;
  valid(): boolean;
  busy(): boolean;
  /** Shared with manual entry and rechecked again at every model send. */
  assertOwner(): void;
  refresh(): Promise<void>;
  attempts?: number;
  delayMs?: number;
}) {
  options = Object.freeze({ ...options, sources: structuredClone(options.sources) });
  const attempts = options.attempts ?? 8,
    delay = options.delayMs ?? 250;
  if (
    !Number.isSafeInteger(attempts) ||
    attempts < 1 ||
    attempts > 32 ||
    !Number.isSafeInteger(delay) ||
    delay < 1 ||
    delay > 5000
  )
    throw new Error('保存复核预算无效');
  let closed = false,
    stale = false,
    checking = false,
    dispatching = false,
    pending = false,
    generation = 0;
  let checks = 0,
    reason = '默认不自动请求；等待新的本轮来源通知';
  let timer: ReturnType<typeof setTimeout> | undefined;
  let tail: Promise<void> = Promise.resolve();
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const fn of listeners) {
      try {
        fn();
      } catch {
        /* Views are not authority. */
      }
    }
  };
  const clear = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const enabled = () => !closed && !stale && options.daily.view().autoEnabled && options.authorized();
  const current = (stamp: number) => {
    if (!enabled() || stamp !== generation || !options.valid()) throw new Error('本轮自动触发已失效');
    options.assertOwner();
    const status = options.signals.status();
    if (options.sources.some(s => s.required && !(s.id === 'mvu' ? status.mvu : status.database)))
      throw new Error('等待本轮必要来源整轮完成，不能用普通通知代替');
  };
  function schedule() {
    if (!pending || checking || dispatching || timer !== undefined || !enabled()) return;
    tail = tail.then(check).catch(() => {});
  }
  async function check() {
    if (checking || dispatching || !pending || !enabled()) return;
    checking = true;
    const stamp = generation;
    try {
      current(stamp);
      if (options.busy() || options.daily.view().busy) {
        reason = '先处理手动运行、草稿或其他页面操作；未自动重试';
        pending = false;
        return;
      }
      for (const source of options.sources) {
        if (source.id === 'mvu') {
          try {
            options.signals.applyMvu(options.gate, source.selections);
          } catch {
            options.gate.hint('mvu', '本轮 MVU 完成证据不可用');
          }
        } else options.signals.applyDatabase(options.gate, source.selections);
      }
      current(stamp);
      checks++;
      await options.refresh();
      current(stamp);
      if (!options.gate.ready()) {
        reason = '已收到完成候选，等待独立存档读回；未调用模型';
        if (checks < attempts)
          timer = setTimeout(() => {
            timer = undefined;
            schedule();
          }, delay);
        else {
          pending = false;
          reason = '保存复核次数已用完，仍未确认；等待新保存通知或人工检查，不按超时放行';
        }
        return;
      }
      if (options.busy() || options.daily.view().busy) {
        pending = false;
        return;
      }
      pending = false;
      dispatching = true;
      reason = '前置保存已确认；交给手动/自动共用的整轮入口';
      emit();
      await options.daily.trigger('prerequisite-changed');
      reason = '本次自动入口已收口；成功以正式存档为准，不自动重跑失败或未知结果';
    } catch {
      pending = stamp !== generation && enabled();
      reason = '来源、权限或输入不可用；等待新的可靠通知，不调用模型';
    } finally {
      checking = false;
      dispatching = false;
      emit();
      if (pending && timer === undefined) schedule();
    }
  }
  let sawAssistant = false;
  const offSignals = options.signals.subscribe(notice => {
    if (closed || stale) return;
    if (!options.sources.length) {
      if (notice === 'assistant') sawAssistant = true;
      if (!sawAssistant) return;
    }
    generation++;
    clear();
    // Source adapters immediately revoke their gate on actual invalidation.
    if (dispatching && !options.gate.ready()) options.daily.cancel();
    pending = enabled();
    checks = 0;
    schedule();
    emit();
  });
  const offDaily = options.daily.subscribe(() => {
    if (!enabled()) {
      generation++;
      clear();
      pending = false;
      if (dispatching) options.daily.cancel();
    }
    // Merely enabling the checkbox or refreshing a view is never a trigger.
  });
  return {
    view: () => ({ closed, stale, checking, dispatching, pending, checks, reason }),
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    invalidate() {
      stale = true;
      generation++;
      clear();
      pending = false;
      options.gate.invalidate();
      options.daily.cancel();
      reason = '聊天/回复已变化；旧会话暂停，须重新捕获当前回复';
      emit();
    },
    settled: async () => {
      for (;;) {
        const observed = tail;
        await observed;
        if (observed === tail) return;
      }
    },
    close() {
      if (closed) return;
      closed = true;
      generation++;
      clear();
      pending = false;
      offSignals();
      offDaily();
      options.daily.cancel();
      listeners.clear();
    },
  };
}
export type T15Automatic = ReturnType<typeof attachT15Automatic>;
