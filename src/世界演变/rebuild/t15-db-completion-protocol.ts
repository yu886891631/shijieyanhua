/** Portable source-side protocol. No globals, fetch, storage, timers, SQL or UI effects. */
export const T15_DB_COMPLETION_PROTOCOL = 'WorldEvolution/TavernDB-auto-round/1' as const;
export interface T15DbFrame {
  binding: { characterId: string; hostChatId: string };
  message: object;
  swipe: number;
  text: string;
  isolation: string;
}
export type T15DbOutcome = 'success' | 'failure' | 'cancelled' | 'disabled' | 'frequency-skipped' | 'unverifiable';
export type T15DbEvent =
  | { type: 'begin'; ticket: object; frame: T15DbFrame; plan: readonly string[] | null }
  | {
      type: 'terminal';
      ticket: object;
      frame: T15DbFrame;
      outcome: T15DbOutcome;
      reason: string;
      plan: readonly string[] | null;
      groups: readonly { key: string; success: boolean }[];
      data: unknown;
    }
  | { type: 'invalidated'; reason: string };
export interface T15DbObserver {
  readonly protocol: typeof T15_DB_COMPLETION_PROTOCOL;
  readonly coverage: readonly ['automatic-plan'];
  readonly candidateOnly: true;
  subscribe(listener: (event: T15DbEvent) => void): void;
  unsubscribe(listener: (event: T15DbEvent) => void): void;
  isCurrent(ticket: object): boolean;
}
export interface T15DbProducerPort {
  current(): T15DbFrame;
  /** Compare the runtime export too: an unpersisted edit must not reuse a terminal receipt. */
  snapshot(): { data: unknown; runtime: unknown };
  epoch(): number;
}
function jsonCopy(value: unknown, depth = 0, budget = { nodes: 0 }): unknown {
  if (depth > 48 || ++budget.nodes > 100000) throw new Error('source snapshot exceeds limits');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return Array.from(value, v => jsonCopy(v, depth + 1, budget));
  if (
    !value ||
    typeof value !== 'object' ||
    (Object.getPrototypeOf(value) !== null && Object.getPrototypeOf(Object.getPrototypeOf(value)) !== null)
  )
    throw new Error('source snapshot is not JSON');
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('unsafe source field');
    const v = (value as Record<string, unknown>)[key];
    if (v !== undefined) result[key] = jsonCopy(v, depth + 1, budget);
  }
  return result;
}
function snapshot(port: T15DbProducerPort) {
  const value = jsonCopy(port.snapshot()) as { data: unknown; runtime: unknown },
    text = JSON.stringify(value);
  if (text.length > 2_000_000) throw new Error('source snapshot exceeds size limit');
  return { value, text };
}
function freezeJson<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const v of Object.values(value)) freezeJson(v);
    Object.freeze(value);
  }
  return value;
}
function capture(frame: T15DbFrame): T15DbFrame {
  if (
    !frame.binding?.characterId ||
    !frame.binding.hostChatId ||
    !frame.message ||
    typeof frame.message !== 'object' ||
    !Number.isSafeInteger(frame.swipe) ||
    frame.swipe < 0 ||
    typeof frame.text !== 'string' ||
    !frame.text ||
    frame.text.length > 1_000_000 ||
    !frame.isolation ||
    frame.isolation.length > 200
  )
    throw new Error('invalid source frame');
  // Never deep-freeze the native message object.
  return Object.freeze({ ...frame, binding: Object.freeze({ ...frame.binding }) });
}
function sameFrame(a: T15DbFrame, b: T15DbFrame) {
  return (
    a.binding.characterId === b.binding.characterId &&
    a.binding.hostChatId === b.binding.hostChatId &&
    a.message === b.message &&
    a.swipe === b.swipe &&
    a.text === b.text &&
    a.isolation === b.isolation
  );
}
export function createT15DbCompletionProducer(input: T15DbProducerPort) {
  const port = Object.freeze({ ...input }),
    listeners = new Set<(event: T15DbEvent) => void>();
  let closed = false;
  let run: {
    ticket: object;
    frame: T15DbFrame;
    epoch: number;
    plan: readonly string[] | null;
    groups: Map<string, boolean>;
    invalid: boolean;
    ended: boolean;
    terminal: T15DbEvent | null;
    snapshot: string | null;
  } | null = null;
  const emit = (event: T15DbEvent) => {
    for (const fn of [...listeners]) {
      try {
        fn(event);
      } catch {
        /* Observers cannot alter the database operation. */
      }
    }
  };
  const observer: T15DbObserver = Object.freeze({
    protocol: T15_DB_COMPLETION_PROTOCOL,
    coverage: Object.freeze(['automatic-plan'] as const),
    candidateOnly: true,
    subscribe(fn: (event: T15DbEvent) => void) {
      if (closed) throw new Error('source closed');
      listeners.add(fn);
    },
    unsubscribe(fn: (event: T15DbEvent) => void) {
      listeners.delete(fn);
    },
    isCurrent(ticket: object) {
      try {
        return (
          !closed &&
          !!run &&
          run.ticket === ticket &&
          run.ended &&
          !run.invalid &&
          run.snapshot !== null &&
          run.epoch === port.epoch() &&
          sameFrame(run.frame, port.current()) &&
          run.snapshot === snapshot(port).text
        );
      } catch {
        return false;
      }
    },
  });
  return {
    observer,
    begin(keys: readonly string[] | null) {
      if (closed) throw new Error('source closed');
      const plan = keys === null ? null : Object.freeze([...keys]);
      if (
        plan &&
        (plan.length > 512 ||
          new Set(plan).size !== plan.length ||
          plan.some(k => typeof k !== 'string' || !k.trim() || k.length > 200))
      )
        throw new Error('invalid group plan');
      const ticket = Object.freeze({}),
        frame = capture(port.current());
      run = {
        ticket,
        frame,
        epoch: port.epoch(),
        plan,
        groups: new Map(),
        invalid: false,
        ended: false,
        terminal: null,
        snapshot: null,
      };
      emit(Object.freeze({ type: 'begin', ticket, frame, plan }));
      return ticket;
    },
    /** Only actual awaited group runners call this, never chunk/progress callbacks. */
    groups(ticket: object, keys: readonly string[], result: unknown) {
      if (closed || !run || run.ticket !== ticket || run.ended) return false;
      const r = result as { success?: unknown; failedGroups?: unknown } | null;
      if (
        !run.plan ||
        !keys.length ||
        new Set(keys).size !== keys.length ||
        keys.some(k => !run!.plan!.includes(k) || run!.groups.has(k)) ||
        !r ||
        typeof r.success !== 'boolean' ||
        (r.failedGroups !== undefined &&
          (!Array.isArray(r.failedGroups) ||
            r.failedGroups.some(k => typeof k !== 'string' || !keys.includes(k)) ||
            new Set(r.failedGroups).size !== r.failedGroups.length))
      ) {
        run.invalid = true;
        return false;
      }
      const failed = (r.failedGroups ?? []) as string[];
      if (r.success && failed.length) {
        run.invalid = true;
        return false;
      }
      for (const key of keys) run.groups.set(key, r.success === true || (failed.length > 0 && !failed.includes(key)));
      return true;
    },
    finish(ticket: object, outcome: T15DbOutcome, reason: string) {
      if (closed || !run || run.ticket !== ticket || run.ended) return false;
      run.ended = true;
      let data: unknown = null;
      const original = outcome;
      try {
        if (run.invalid || run.epoch !== port.epoch() || !sameFrame(run.frame, port.current())) throw new Error();
        if (!['success', 'failure', 'cancelled', 'disabled', 'frequency-skipped', 'unverifiable'].includes(outcome))
          throw new Error();
        if (
          outcome === 'success' &&
          (!run.plan?.length || run.groups.size !== run.plan.length || [...run.groups.values()].some(v => !v))
        )
          throw new Error();
        if (
          (outcome === 'frequency-skipped' && run.plan?.length !== 0) ||
          (outcome === 'disabled' && (run.plan !== null || run.groups.size))
        )
          throw new Error();
        if (outcome === 'success' || outcome === 'disabled' || outcome === 'frequency-skipped') {
          const final = snapshot(port);
          run.snapshot = final.text;
          data = freezeJson(final.value.data);
        }
      } catch {
        outcome = 'unverifiable';
        run.invalid = true;
        run.snapshot = null;
      }
      const event: T15DbEvent = Object.freeze({
        type: 'terminal',
        ticket,
        frame: run.frame,
        outcome,
        reason: outcome === original ? reason.slice(0, 160) : '本轮目标、分组结果或最终资料无法验证',
        plan: run.plan,
        groups: Object.freeze([...run.groups].map(([key, success]) => Object.freeze({ key, success }))),
        data,
      });
      run.terminal = event;
      emit(event);
      return true;
    },
    close() {
      if (closed) return;
      closed = true;
      run = null;
      emit(Object.freeze({ type: 'invalidated', reason: '数据库完成接口已卸载' }));
      listeners.clear();
    },
  };
}
