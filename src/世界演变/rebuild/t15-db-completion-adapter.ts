/** Consumer of the patched database's outer automatic-plan lifecycle. Never fabricates it from table changes. */
import { cloneT2Json, type T2Json } from './t2-template';
import {
  T15_DB_COMPLETION_PROTOCOL,
  type T15DbObserver,
  type T15DbEvent,
  type T15DbFrame,
} from './t15-db-completion-protocol';
import type { T15SignalFrame } from './t15-source-signals';
import type { T15Prerequisites, T15SourceSelection } from './t15-prerequisites';
import { sameT10 } from './t10-host-protocol';
import { copyT15NativeJson } from './t15-native-json';

export function createT15DbCompletionAdapter(options: {
  observer: T15DbObserver;
  current(): T15SignalFrame;
  epoch(): number;
  changed(reason: string): void;
}) {
  options = Object.freeze({ ...options });
  const api = options.observer;
  if (
    api.protocol !== T15_DB_COMPLETION_PROTOCOL ||
    api.candidateOnly !== true ||
    !sameT10(copyT15NativeJson(api.coverage), ['automatic-plan']) ||
    typeof api.subscribe !== 'function' ||
    typeof api.unsubscribe !== 'function' ||
    typeof api.isCurrent !== 'function'
  )
    throw new Error('不支持的数据库完成接口');
  const subscribe = api.subscribe.bind(api),
    unsubscribe = api.unsubscribe.bind(api),
    isCurrent = api.isCurrent.bind(api);
  let closed = false,
    reason = '已接整轮完成接口，等待本轮自动填表计划';
  let candidate: {
    ticket: object;
    frame: T15DbFrame;
    epoch: number;
    terminal: Extract<T15DbEvent, { type: 'terminal' }> | null;
  } | null = null;
  const same = (a: T15DbFrame, b: T15SignalFrame) =>
    sameT10(copyT15NativeJson(a.binding), b.binding) &&
    a.message === b.message &&
    a.swipe === b.swipe &&
    a.text === b.text;
  const current = () => {
    try {
      return (
        !closed &&
        !!candidate?.terminal &&
        candidate.epoch === options.epoch() &&
        same(candidate.frame, options.current()) &&
        isCurrent(candidate.ticket)
      );
    } catch {
      return false;
    }
  };
  const listener = (event: T15DbEvent) => {
    if (closed) return;
    if (event.type === 'invalidated') {
      candidate = null;
      reason = event.reason;
      options.changed(reason);
      return;
    }
    if (event.type === 'begin') {
      candidate = null;
      reason = '数据库开始本轮计划；等待所有分组和收尾';
      try {
        if (same(event.frame, options.current()))
          candidate = { ticket: event.ticket, frame: event.frame, epoch: options.epoch(), terminal: null };
      } catch {
        /* A historical or foreign run is not current. */
      }
      options.changed(reason);
      return;
    }
    if (!candidate || candidate.ticket !== event.ticket || candidate.terminal) return;
    reason = event.reason;
    try {
      if (
        candidate.epoch !== options.epoch() ||
        !same(event.frame, options.current()) ||
        !same(candidate.frame, options.current())
      )
        throw new Error();
      if (['success', 'disabled', 'frequency-skipped'].includes(event.outcome) && !isCurrent(event.ticket))
        throw new Error();
      if (
        event.outcome === 'success' &&
        (!event.plan?.length ||
          new Set(event.plan).size !== event.plan.length ||
          event.groups.length !== event.plan.length ||
          new Set(event.groups.map(g => g.key)).size !== event.plan.length ||
          event.groups.some(g => !event.plan!.includes(g.key) || g.success !== true))
      )
        throw new Error();
      if (event.outcome === 'frequency-skipped' && event.plan?.length !== 0) throw new Error();
      if (event.outcome === 'disabled' && event.plan !== null) throw new Error();
      candidate.terminal = { ...event, data: copyT15NativeJson(event.data) };
    } catch {
      candidate = null;
      reason = '数据库终态不是当前有效计划，或最终资料发生变化';
    }
    options.changed(reason);
  };
  try {
    subscribe(listener);
  } catch (error) {
    unsubscribe(listener);
    throw error;
  }
  return {
    status: () => ({ available: true as const, candidate: current(), reason }),
    /** An unchanged delayed UI notification does not revoke a proved outer terminal. */
    onTableUpdate(persisted: boolean) {
      if (candidate && !candidate.terminal) {
        reason = '数据库计划仍在处理；中途更新不代表整轮完成';
        options.changed(reason);
        return;
      }
      if (persisted && current()) return;
      candidate = null;
      reason = persisted ? '数据库发生新更新，旧整轮终态撤销' : '数据库发生未保存更新，旧整轮终态撤销';
      options.changed(reason);
    },
    apply(gate: T15Prerequisites, selections: T15SourceSelection[]) {
      const c = candidate,
        t = c?.terminal;
      if (
        closed ||
        !c ||
        !t ||
        !same(c.frame, options.current()) ||
        c.epoch !== options.epoch() ||
        gate.readInput().story.at(-1)?.text !== c.frame.text
      )
        throw new Error(reason);
      if (t.outcome === 'failure' || t.outcome === 'cancelled') {
        gate.fail('database', gate.begin('database', gate.readInput().anchor));
        return;
      }
      if (!current()) throw new Error(reason);
      if (t.outcome === 'disabled' || t.outcome === 'frequency-skipped') {
        gate.skip('database', t.outcome, t.reason || '数据库本轮明确跳过');
        return;
      }
      if (t.outcome !== 'success' || !selections.length) throw new Error(reason);
      const expected = selections.map(p => {
        if (p.path[0] !== 'TavernDB_ACU_IsolatedData' || p.path[1] !== c.frame.isolation)
          throw new Error('仅支持当前数据库隔离标签内显式选择的 V2 保存字段');
        let value = t.data as T2Json;
        for (const key of p.path) {
          if (
            !value ||
            typeof value !== 'object' ||
            !Object.hasOwn(value, key) ||
            ['__proto__', 'constructor', 'prototype'].includes(key)
          )
            throw new Error('数据库终态缺少所选字段');
          value = (value as Record<string, T2Json>)[key];
        }
        return cloneT2Json(value);
      });
      gate.complete('database', gate.begin('database', gate.readInput().anchor), expected);
    },
    close() {
      if (closed) return;
      closed = true;
      candidate = null;
      unsubscribe(listener);
    },
  };
}
