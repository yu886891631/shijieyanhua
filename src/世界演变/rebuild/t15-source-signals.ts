/** Observe actual source interfaces. Update notifications alone never authorize an evolution request. */
import { cloneT2Json, type T2Json } from './t2-template';
import { sameT10, type T10Binding } from './t10-host-protocol';
import type { T15Prerequisites, T15SourceSelection } from './t15-prerequisites';
import type { T15DbObserver } from './t15-db-completion-protocol';
import { createT15DbCompletionAdapter } from './t15-db-completion-adapter';
import { copyT15NativeJson } from './t15-native-json';
export interface T15SignalFrame {
  binding: T10Binding;
  /** Native message object identity, not a numeric floor/body-hash pseudo identity. */
  message: object;
  swipe: number;
  text: string;
  matchingBodies: number;
}
export type T15SignalNotice = 'source' | 'persisted' | 'input' | 'binding' | 'cancelled' | 'assistant';
export interface T15SignalsPort {
  current(): T15SignalFrame;
  epoch(): number;
  on(event: string, listener: (...args: unknown[]) => void): () => void;
  mvuEvents: { parsed: string; reconciled: string } | null;
  database: {
    registerTableUpdateCallback(fn: (data: unknown, meta?: { persisted?: boolean }) => void): void;
    unregisterTableUpdateCallback(fn: (data: unknown, meta?: { persisted?: boolean }) => void): void;
    /** Optional only in the explicitly patched automatic-plan producer; never inferred from old callbacks. */
    getWorldEvolutionCompletion?(): T15DbObserver;
  } | null;
}
const copy = <T>(value: T): T => cloneT2Json(value) as unknown as T;
function values(root: T2Json, selections: T15SourceSelection[]) {
  return selections.map(p => {
    let value = root;
    for (const key of p.path) {
      if (
        !value ||
        typeof value !== 'object' ||
        !Object.hasOwn(value, key) ||
        ['__proto__', 'constructor', 'prototype'].includes(key)
      )
        throw new Error('来源字段不存在');
      value = (value as Record<string, T2Json>)[key];
    }
    return copy(value);
  });
}
/** Only the exact, known MVU message post-processing is allowed between parse and persisted inspection. */
function mvuBody(text: string) {
  let result = text;
  if (!result.includes('<StatusPlaceHolderImpl/>')) result += '\n\n<StatusPlaceHolderImpl/>';
  return result.replaceAll(/<(status_current_variable)>(?:(?!<\1>).)*<\/\1?>/gis, '');
}
export function createT15SourceSignals(input: T15SignalsPort) {
  const port = Object.freeze({ ...input }),
    stops: (() => void)[] = [];
  let closed = false,
    databaseReason = port.database
      ? '已接表格更新通知；该版本没有整轮终态接口，不能据此宣称本轮所有批次完成'
      : '未检测到可用数据库通知接口';
  let candidate: { frame: T15SignalFrame; epoch: number; variables: object; data: T2Json | null } | null = null;
  let activeGate: T15Prerequisites | null = null;
  let databaseCompletion: ReturnType<typeof createT15DbCompletionAdapter> | null = null;
  let mvuRevision = 0,
    databaseRevision = 0;
  const listeners = new Set<(notice: T15SignalNotice) => void>();
  const applied = new WeakMap<T15Prerequisites, { mvu?: number; database?: number }>();
  const notify = (notice: T15SignalNotice = 'source') => {
    for (const listener of [...listeners]) {
      try {
        listener(notice);
      } catch {
        /* Observation cannot change source processing. */
      }
    }
  };
  const hint = (id: 'mvu' | 'database', reason: string) => {
    try {
      activeGate?.hint(id, reason);
    } catch {
      /* A previously closed workspace cannot be reauthorized. */
    }
  };
  const sameFrame = (a: T15SignalFrame, b: T15SignalFrame) =>
    sameT10(a.binding, b.binding) && a.message === b.message && a.swipe === b.swipe;
  function parsed(variables: unknown, _commands: unknown, body: unknown) {
    if (closed) return;
    candidate = null;
    mvuRevision++;
    hint('mvu', 'MVU 开始新的处理；此前完成证据已撤销');
    try {
      const frame = port.current();
      if (
        !variables ||
        typeof variables !== 'object' ||
        typeof body !== 'string' ||
        frame.matchingBodies !== 1 ||
        body !== frame.text
      )
        return;
      candidate = { frame: { ...frame, binding: copy(frame.binding) }, epoch: port.epoch(), variables, data: null };
    } catch {
      /* Unsupported/historical parsing does not complete the current message. */
    }
    notify();
  }
  function reconciled(variables: unknown) {
    if (closed || !candidate || variables !== candidate.variables) return;
    try {
      if (candidate.epoch !== port.epoch() || !sameFrame(candidate.frame, port.current())) {
        candidate = null;
        return;
      }
      const safe = copyT15NativeJson(variables);
      if (!safe || typeof safe !== 'object' || Array.isArray(safe) || !Object.hasOwn(safe, 'stat_data'))
        throw new Error();
      if (candidate.data && sameT10(candidate.data, safe)) return;
      candidate.data = safe;
      mvuRevision++;
    } catch {
      candidate = null;
    }
    notify();
  }
  const updated = (_data: unknown, meta?: { persisted?: boolean }) => {
    if (closed) return;
    if (databaseCompletion) {
      databaseCompletion.onTableUpdate(meta?.persisted !== false);
      return;
    }
    databaseReason =
      meta?.persisted === false
        ? '数据库通知明确标记为仅内存更新；不能启动演变'
        : '数据库发生表格更新；缺少本轮整轮终态、目标 swipe 和全部批次结果，仍等待可靠完成证据';
    hint('database', databaseReason);
    databaseRevision++;
    notify();
  };
  try {
    if (typeof port.database?.getWorldEvolutionCompletion === 'function') {
      try {
        databaseCompletion = createT15DbCompletionAdapter({
          observer: port.database.getWorldEvolutionCompletion(),
          current: port.current,
          epoch: port.epoch,
          changed(reason) {
            databaseReason = reason;
            hint('database', reason);
            databaseRevision++;
            notify();
          },
        });
        databaseReason = databaseCompletion.status().reason;
        stops.push(() => databaseCompletion!.close());
      } catch {
        databaseReason = '数据库完成接口版本或能力不匹配；没有采用普通更新通知兜底';
      }
    }
    if (port.mvuEvents) {
      stops.push(port.on(port.mvuEvents.parsed, parsed));
      stops.push(port.on(port.mvuEvents.reconciled, reconciled));
    }
    if (port.database) stops.push(() => port.database!.unregisterTableUpdateCallback(updated));
    port.database?.registerTableUpdateCallback(updated);
  } catch (error) {
    for (const off of stops) {
      try {
        off();
      } catch {
        /* Keep cleaning up even if one source rejects unregistering. */
      }
    }
    throw error;
  }
  return {
    status: () => ({
      mvu: (() => {
        try {
          const frame = port.current();
          return (
            !closed &&
            !!candidate?.data &&
            candidate.epoch === port.epoch() &&
            sameFrame(candidate.frame, frame) &&
            [candidate.frame.text, mvuBody(candidate.frame.text)].includes(frame.text)
          );
        } catch {
          return false;
        }
      })(),
      database: databaseCompletion?.status().candidate ?? false,
      databaseCompletionAvailable: !!databaseCompletion,
      databaseReason,
    }),
    frame: () => {
      if (closed) throw new Error('来源观察器已关闭');
      return { ...port.current(), epoch: port.epoch() };
    },
    subscribe(listener: (notice: T15SignalNotice) => void) {
      if (closed) throw new Error('来源观察器已关闭');
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    /** A save/update event only wakes an independent read; it is not a completion receipt. */
    wake(notice: 'persisted' | 'assistant' | 'source' = 'persisted') {
      if (!closed) notify(notice);
    },
    invalidate(notice: 'input' | 'binding' | 'cancelled' = 'input') {
      if (closed) return;
      candidate = null;
      mvuRevision++;
      databaseRevision++;
      hint('mvu', '输入事件使旧来源证据失效');
      hint('database', '输入事件使旧来源证据失效');
      notify(notice);
    },
    /** Called after stable IDs have been registered and final story independently captured.
     * Returns a candidate receipt; gate.refresh() still has to prove these fields are persisted. */
    applyMvu(gate: T15Prerequisites, selections: T15SourceSelection[]) {
      if (closed || !candidate?.data || candidate.epoch !== port.epoch()) throw new Error('没有本轮 MVU 完成候选');
      const frame = port.current();
      if (
        !sameFrame(candidate.frame, frame) ||
        ![candidate.frame.text, mvuBody(candidate.frame.text)].includes(frame.text) ||
        gate.readInput().story.at(-1)?.text !== frame.text
      )
        throw new Error('MVU 候选不是当前回复');
      const expected = values(candidate.data, selections),
        previous = applied.get(gate) ?? {};
      activeGate = gate;
      if (previous.mvu === mvuRevision) return;
      const token = gate.begin('mvu', gate.readInput().anchor);
      gate.complete('mvu', token, expected);
      previous.mvu = mvuRevision;
      applied.set(gate, previous);
    },
    applyDatabaseHint(gate: T15Prerequisites) {
      activeGate = gate;
      gate.hint('database', databaseReason);
    },
    applyDatabase(gate: T15Prerequisites, selections: T15SourceSelection[]) {
      activeGate = gate;
      if (!databaseCompletion) {
        gate.hint('database', databaseReason);
        return;
      }
      try {
        const previous = applied.get(gate) ?? {};
        if (previous.database === databaseRevision) {
          if (!databaseCompletion.status().candidate) throw new Error('数据库旧候选已失效');
          return;
        }
        databaseCompletion.apply(gate, selections);
        previous.database = databaseRevision;
        applied.set(gate, previous);
      } catch (error) {
        databaseReason =
          '数据库完成候选未采用：' +
          (error instanceof Error ? error.message.slice(0, 160) : '所选字段或本轮身份不匹配');
        gate.hint('database', databaseReason);
      }
    },
    detach(gate: T15Prerequisites) {
      if (activeGate === gate) activeGate = null;
    },
    close() {
      if (closed) return;
      closed = true;
      candidate = null;
      activeGate = null;
      listeners.clear();
      for (const off of stops.splice(0)) {
        try {
          off();
        } catch {
          /* A failed unregistration must not leave the other source attached. */
        }
      }
    },
  };
}
/** Explicitly requested MVU attachment only. No source global access before its readiness barrier. */
export async function createT15NativeSourceSignals(options: { mvu: boolean; database: boolean }) {
  if (options.mvu) await waitGlobalInitialized('Mvu');
  let epoch = 0;
  const offs: (() => void)[] = [];
  const current = (): T15SignalFrame => {
    const c = SillyTavern,
      index = c.chat.length - 1,
      message = c.chat[index] as { mes?: string; is_user?: boolean; swipe_id?: number; extra?: { type?: string } },
      card = c.characters[Number(c.characterId)],
      chat = c.getCurrentChatId();
    if (
      c.groupId ||
      !message ||
      message.is_user ||
      message.extra?.type === 'narrator' ||
      typeof message.mes !== 'string' ||
      !card?.avatar ||
      !chat ||
      card.chat !== chat
    )
      throw new Error('来源目标无效');
    return {
      binding: { characterId: card.avatar, hostChatId: chat },
      message,
      swipe: message.swipe_id ?? 0,
      text: message.mes,
      matchingBodies: c.chat.filter(m => (m as { mes?: string }).mes === message.mes).length,
    };
  };
  let monitor: ReturnType<typeof createT15SourceSignals> | undefined;
  try {
    for (const event of [
      tavern_events.CHAT_CHANGED,
      tavern_events.MESSAGE_SWIPED,
      tavern_events.MESSAGE_SWIPE_DELETED,
      tavern_events.MESSAGE_DELETED,
      tavern_events.MESSAGE_EDITED,
      tavern_events.GENERATION_STARTED,
      tavern_events.GENERATION_STOPPED,
    ])
      offs.push(
        eventOn(event, () => {
          epoch++;
          monitor?.invalidate(
            event === tavern_events.CHAT_CHANGED
              ? 'binding'
              : event === tavern_events.GENERATION_STOPPED
                ? 'cancelled'
                : 'input',
          );
        }).stop,
      );
    const db = options.database
      ? (window.parent as Window & { AutoCardUpdaterAPI?: T15SignalsPort['database'] }).AutoCardUpdaterAPI
      : null;
    monitor = createT15SourceSignals({
      current,
      epoch: () => epoch,
      mvuEvents: options.mvu
        ? { parsed: Mvu.events.COMMAND_PARSED, reconciled: Mvu.events.VARIABLE_UPDATE_ENDED + '_for_zod' }
        : null,
      database:
        db &&
        typeof db.registerTableUpdateCallback === 'function' &&
        typeof db.unregisterTableUpdateCallback === 'function'
          ? db
          : null,
      on(event, fn) {
        const handle = eventOn(event, fn);
        return () => handle.stop();
      },
    });
    for (const event of [tavern_events.MESSAGE_UPDATED, tavern_events.MESSAGE_RECEIVED])
      offs.push(eventOn(event, () => monitor?.wake()).stop);
    offs.push(eventOn(tavern_events.GENERATION_ENDED, () => monitor?.wake('assistant')).stop);
    for (const event of [tavern_events.CHARACTER_EDITED, tavern_events.CHARACTER_DELETED])
      offs.push(
        eventOn(event, () => {
          epoch++;
          monitor?.invalidate('binding');
        }).stop,
      );
  } catch (error) {
    monitor?.close();
    for (const off of offs) off();
    throw error;
  }
  const attached = monitor;
  if (!attached) throw new Error('来源观察未完成');
  const close = () => {
    attached.close();
    for (const off of offs.splice(0)) off();
    window.removeEventListener('pagehide', close);
  };
  window.addEventListener('pagehide', close, { once: true });
  return { ...attached, close };
}
export type T15SourceSignals = ReturnType<typeof createT15SourceSignals>;
