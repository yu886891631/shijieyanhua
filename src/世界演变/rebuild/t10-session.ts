/** Opt-in T9 -> host integration. Strict and single-page compatibility entries are separate. */
import { createT4CommitService, type T4Executor } from './t4-service';
import { normalizeT4Scope, type T4Scope } from './t4-protocol';
import { createT9Round, type T9Options } from './t9-round';
import { T10Error, sameT10, stampedT10Messages } from './t10-host-protocol';
import {
  createT10Gateway,
  canWriteT10,
  createT10CompatibilityGateway,
  canWriteT10Compatibility,
  type T10Driver,
} from './t10-host-gateway';
import { inspectT10Host, inspectT10CompatibilityHost } from './t10-recovery';
interface T10SessionOptions {
  driver: T10Driver;
  scope: T4Scope;
  execute: T4Executor;
  runtime: Omit<T9Options, 'service' | 'reserveSend' | 'execute'> & { canOwnContinuation?: () => boolean };
}
export async function openT10Session(options: T10SessionOptions) {
  return openSession(options, false);
}
export async function openT10CompatibilitySession(options: T10SessionOptions) {
  return openSession(options, true);
}
async function openSession(options: T10SessionOptions, compatibility: boolean) {
  const canWrite = compatibility ? canWriteT10Compatibility : canWriteT10,
    inspect = compatibility ? inspectT10CompatibilityHost : inspectT10Host;
  const { driver } = options,
    scope = normalizeT4Scope(options.scope);
  if (!canWrite(driver)) throw new T10Error('CAPABILITY');
  const recovery = await inspect(driver);
  if (recovery.status !== 'ready' || !sameT10(recovery.scope, scope) || !recovery.writable)
    throw new T10Error('DEPENDENCY');
  const gateway = (compatibility ? createT10CompatibilityGateway : createT10Gateway)(driver),
    input = options.runtime.readInput();
  // Exact stable IDs must match; caller may not substitute a numeric floor/body-hash pseudo-ID.
  const doc = await driver.readDurable(driver.currentBinding());
  const index = doc.messages.findIndex(m => {
    const stamp = m.swipes_data[m.swipe_id].world_evolution_sql_t10;
    return stamp && typeof stamp === 'object' && !Array.isArray(stamp) && stamp.messageId === input.anchor.messageId;
  });
  const anchor = await gateway.capture(scope, index, input.anchor.inputFingerprint);
  if (!sameT10(anchor, input.anchor)) throw new T10Error('ANCHOR');
  const prefix = stampedT10Messages(doc, index);
  if (
    input.story.some(
      s =>
        !prefix.some(
          m =>
            m.active.messageId === s.messageId &&
            m.message.role === s.role &&
            m.message.swipes[m.message.swipe_id] === s.text,
        ),
    )
  )
    throw new T10Error('ANCHOR');
  const service = await createT4CommitService({ scope, store: gateway, execute: options.execute });
  let invalidated = false,
    closed = false;
  const canRun = () => !invalidated && !closed && canWrite(driver) && (options.runtime.canRun?.() ?? true);
  const round = createT9Round({
    ...options.runtime,
    service,
    execute: options.execute,
    canRun,
    reserveSend: reservation => gateway.reserveSend(scope, options.runtime.ownerId, reservation),
  });
  const unsubscribe = driver.subscribe?.(() => {
    invalidated = true;
    round.cancel();
  });
  return {
    consistency: compatibility ? ('optimistic-single-page' as const) : ('atomic-document-cas' as const),
    gateway,
    service,
    round,
    canRun,
    /** A same-instance owned continuation is distinct from reopening an interrupted persisted run. */
    canContinue() {
      const v = round.view();
      return (
        !invalidated &&
        !closed &&
        canWrite(driver) &&
        (options.runtime.canOwnContinuation?.() ?? options.runtime.canRun?.() ?? true) &&
        v.canResume &&
        !!v.runId &&
        !!v.macro.triggerKey &&
        options.runtime.queue.owns(v.macro.triggerKey, v.runId, options.runtime.ownerId)
      );
    },
    /** Read-only after changes. Creating a new session requires fresh anchors and explicit user action. */
    refresh: () => inspect(driver),
    close() {
      if (closed) return;
      closed = true;
      invalidated = true;
      round.cancel();
      unsubscribe?.();
      service.close();
    },
  };
}
