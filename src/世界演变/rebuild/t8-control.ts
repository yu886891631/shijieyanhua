/** Macro coordinator. Explicit transport/reservation injection; never selects a default fetch or writer. */
import { z } from 'zod';
import { normalizeWorldEvolutionApiConfiguration, type WorldEvolutionApiConfiguration } from '../api-config';
import { cloneT2Json, type T2Cell, type T2Json, type T2WorldData } from './t2-template';
import { freezeT3Request, normalizeT3Result } from './t3-result';
import { T3RuntimeError } from './t3-runtime';
import { describeT3Diagnostic, type T3Diagnostic } from './t3-diagnostic';
import { diffT4States, fingerprintT4, normalizeT4State, type T4State, type T4Context } from './t4-protocol';
import type { T4Batch, T4Executor } from './t4-service';
import { inspectT7Prerequisites, normalizeT7Input, type T7Input } from './t7-input';
import { normalizeT7Prompts, type T7Prompts } from './t7-prompts';
import { createT7Run, type T7Request, type T7Run, type T7PhasePlan } from './t7-run';
import type { T8Queue } from './t8-queue';
import type { T15ApiTransport } from './t15-api-transport';

const clone = <T>(value: T): T => cloneT2Json(value) as unknown as T;
export type T8Status = 'idle' | 'queued' | 'waiting' | 'running' | 'staged' | 'cancelled' | 'stale' | 'failed';
export type T8ErrorCode =
  | 'INPUT'
  | 'PREREQUISITE'
  | 'PREREQUISITE_TIMEOUT'
  | 'OWNERSHIP'
  | 'STALE'
  | 'CANCELLED'
  | 'RUN_TIMEOUT'
  | 'MODEL'
  | 'PLAN'
  | 'RESPONSE'
  | 'SQL'
  | 'BUDGET';
const messages: Record<T8ErrorCode, string> = {
  INPUT: '运行配置无效或有未保存草稿；没有启动演算。',
  PREREQUISITE: '必要前置失败、无法验证或证据失配；没有启动宏观演算。',
  PREREQUISITE_TIMEOUT: '等待必要前置超时；超时不会被当作成功。',
  OWNERSHIP: '当前入口不再拥有本轮触发权；已停止后续请求。',
  STALE: '聊天、消息、swipe、正式资料或模板已变化；本轮暂存失效。',
  CANCELLED: '已取消本轮；不会保存暂存结果或继续下一张表。',
  RUN_TIMEOUT: '整轮时间上限已到；不会接受迟到结果。',
  MODEL: '模型未成功返回；请核对传输、超时或重试配置。已发送请求的结果可能未知。',
  PLAN: '必要宏观表的 API 路由或上下文未就绪；请查看各表的阻断原因。',
  RESPONSE: '模型输出不是规定的 SQL JSON；没有执行这份输出。',
  SQL: 'SQL、类型、引用、权限或结果校验未通过；本轮没有正式保存。',
  BUDGET: '整轮或表级发送额度已用完；不会自动增加请求次数。',
};
class T8Error extends Error {
  constructor(
    readonly code: T8ErrorCode,
    readonly diagnostic: T3Diagnostic | null = null,
  ) {
    super(messages[code]);
  }
}
export interface T8Change {
  tableId: string;
  tableName: string;
  rowId: string;
  kind: 'insert' | 'update' | 'delete';
  fields: {
    id: string;
    name: string;
    before: T2Cell | null;
    after: T2Cell | null;
    beforePresent: boolean;
    afterPresent: boolean;
  }[];
}
export interface T8BatchView {
  tableId: string;
  tableName: string;
  status: 'pending' | 'sending' | 'validating' | 'staged';
  request: T7Request;
  beforeFingerprint: string | null;
  afterFingerprint: string | null;
  changedRows: number;
  newRows: number;
}
export interface T8View {
  mode: 't8-local-simulation' | 't8-real-api';
  status: T8Status;
  runId: string | null;
  triggerKey: string | null;
  error: { code: T8ErrorCode; message: string; diagnostic?: T3Diagnostic } | null;
  prerequisites: Awaited<ReturnType<typeof inspectT7Prerequisites>> | null;
  baseRevision: number | null;
  templateVersion: number | null;
  promptVersion: number | null;
  inputFingerprint: string | null;
  worldTime: T7Input['now'];
  maxRequests: number;
  sent: number;
  completed: number;
  total: number;
  batches: T8BatchView[];
  skipped: { tableId: string; reason: string }[];
  changes: T8Change[];
  outcome: 'none' | 'private-macro-ready' | 'simulation-result-unknown' | 'request-result-unknown';
  notices: string[];
}
export interface T8Handoff {
  run: T7Run;
  base: T4State;
  data: T2WorldData;
  input: T7Input;
  batches: T4Batch[];
  usage: { rows: number; newRows: number };
  context: T4Context;
  progress: T7Input['progress'];
  expiresAt: number;
}
export interface T8Options {
  ownerId: string;
  queue: T8Queue;
  readState: () => T4State;
  readInput: () => T7Input;
  readPrompts: () => T7Prompts;
  readApi: () => WorldEvolutionApiConfiguration;
  execute: T4Executor;
  transport?: T15ApiTransport;
  canFreeze?: () => boolean;
  canRun?: () => boolean;
  /** Persist a credential-free reservation before transport, including retries. */
  reserveSend?: (input: {
    runId: string;
    stage: 'macro' | 'micro';
    sent: number;
    maxRequests: number;
    anchor: T7Input['anchor'];
    signal: AbortSignal;
  }) => Promise<void>;
  /** Only a fake model response; no endpoint, headers or credentials are supplied. */
  reply?: (
    request: T7Request,
    attempt: number,
    signal: AbortSignal | null,
  ) => Promise<{ status: number; text: string }>;
  pollMs?: number;
  prerequisiteTimeoutMs?: number;
  runTimeoutMs?: number;
  sqlTimeoutMs?: number;
  /** Trusted T9 extension, inside the same trigger queue. Not a host/plugin entry. */
  onStaged?: (
    handoff: T8Handoff,
    capabilities: {
      signal: AbortSignal;
      check: () => Promise<void>;
      protect: (value: unknown) => void;
      stopWatching: () => void;
    },
  ) => Promise<void>;
}
function inputCore(input: T7Input) {
  const { segments: _segments, proofs, ...rest } = input;
  return {
    ...rest,
    sources: proofs.map(p => ({ sourceId: p.sourceId, required: p.required, requirePersisted: p.requirePersisted })),
  };
}
/** Races even a broken mock adapter that ignores abort, and removes listeners on every path. */
export function abortableT8<T>(job: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      cleanup();
      reject(signal.reason instanceof T8Error ? signal.reason : new T8Error('CANCELLED'));
    };
    const cleanup = () => signal.removeEventListener('abort', abort);
    job.then(
      value => {
        cleanup();
        if (signal.aborted) abort();
        else resolve(value);
      },
      error => {
        cleanup();
        reject(error);
      },
    );
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  });
}
async function pause(ms: number, signal: AbortSignal) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await abortableT8(
      new Promise<void>(resolve => {
        timer = setTimeout(resolve, ms);
      }),
      signal,
    );
  } finally {
    clearTimeout(timer);
  }
}
const outputSchema = z.strictObject({ sql: z.string().min(1).max(20000), parameters: z.array(z.unknown()).max(8192) });
export function parseT8Output(text: string): { sql: string; parameters: T2Json[] } {
  try {
    if (typeof text !== 'string' || text.length > 200000) throw new Error();
    return outputSchema.parse(cloneT2Json(JSON.parse(text))) as { sql: string; parameters: T2Json[] };
  } catch {
    throw new T8Error('RESPONSE');
  }
}

export function createT8Control(options: T8Options) {
  // Network capability/reservation cannot be inserted or swapped after construction.
  const transport = options.transport,
    reserveSend = options.reserveSend;
  if (transport && !reserveSend) throw new Error('真实运行必须使用持久发送预算登记');
  if (transport && options.reply) throw new Error('真实运行不能混入模拟响应');
  if (!/^[a-z][a-z0-9_-]{0,63}$/.test(options.ownerId)) throw new T8Error('INPUT');
  const times = {
    poll: options.pollMs ?? 25,
    prerequisite: options.prerequisiteTimeoutMs ?? 10000,
    run: options.runTimeoutMs ?? 60000,
    sql: options.sqlTimeoutMs ?? 10000,
  };
  for (const value of Object.values(times))
    if (!Number.isSafeInteger(value) || value < 1 || value > 60000) throw new T8Error('INPUT');
  const listeners = new Set<() => void>();
  const notify = () =>
    listeners.forEach(fn => {
      try {
        fn();
      } catch {
        /* A view listener cannot interrupt ownership/validation. */
      }
    });
  const records = new Map<
    string,
    {
      view: T8View;
      abort: AbortController;
      check: () => Promise<void>;
      handoff: T8Handoff | null;
      done: Promise<void>;
      protect: (v: unknown) => void;
    }
  >();
  let current: string | null = null;
  const empty = (): T8View => ({
    mode: transport ? 't8-real-api' : 't8-local-simulation',
    status: 'idle',
    runId: null,
    triggerKey: null,
    error: null,
    prerequisites: null,
    baseRevision: null,
    templateVersion: null,
    promptVersion: null,
    inputFingerprint: null,
    worldTime: null,
    maxRequests: 0,
    sent: 0,
    completed: 0,
    total: 0,
    batches: [],
    skipped: [],
    changes: [],
    outcome: 'none',
    notices: [
      transport
        ? '已接真实 API；发送可能收费，每次发送前先确认持久预留和当前权限。宏观仍只私有暂存。'
        : '本地模拟，零网络/费用；不写实际聊天、MVU、数据库或世界书。',
      '宏观结果仅私有暂存，尚未正式保存；不推进世界时间、频率或轮转。',
      '此队列只证明共享实例内的触发去重；真实宿主跨脚本锁与完成证据留到 T10。',
      '刷新丢失暂存，不自动续发；T9 才接微观与整轮统一保存。',
    ],
  });
  function terminate(record: typeof records extends Map<string, infer R> ? R : never, error: T8Error) {
    record.view.status = error.code === 'STALE' ? 'stale' : error.code === 'CANCELLED' ? 'cancelled' : 'failed';
    record.view.error = {
      code: error.code,
      message: error.message,
      ...(error.diagnostic ? { diagnostic: error.diagnostic } : {}),
    };
    record.view.outcome =
      record.view.sent > 0 ? (transport ? 'request-result-unknown' : 'simulation-result-unknown') : 'none';
    record.view.changes = [];
    record.handoff = null;
    record.abort.abort(error);
    notify();
  }
  const control = {
    view(runId = current): T8View {
      const record = runId ? records.get(runId) : null;
      if (!record) return empty();
      record.protect(record.view);
      return clone(record.view);
    },
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    async start(runId: string) {
      if (!/^[a-z][a-z0-9_-]{0,63}$/.test(runId) || records.has(runId)) throw new T8Error('INPUT');
      let base: T4State, initial: T7Input, prompts: T7Prompts, api: WorldEvolutionApiConfiguration;
      try {
        if ((options.canRun && !options.canRun()) || (options.canFreeze && !options.canFreeze())) throw new Error();
        base = normalizeT4State(options.readState());
        initial = normalizeT7Input(options.readInput());
        prompts = normalizeT7Prompts(options.readPrompts(), base.template);
        api = normalizeWorldEvolutionApiConfiguration(clone(options.readApi()), 0);
        if (
          initial.worldId !== base.data.worldId ||
          initial.branchId !== base.data.branchId ||
          !(initial.anchor.chatId.startsWith('sandbox-') || initial.anchor.chatId.startsWith('chat-'))
        )
          throw new Error();
      } catch {
        throw new T8Error('INPUT');
      }
      const stateHash = await fingerprintT4(base),
        coreHash = await fingerprintT4(inputCore(initial));
      const triggerKey = await fingerprintT4({
        ...initial.anchor,
        worldId: initial.worldId,
        branchId: initial.branchId,
      });
      const keys = api.presets.map(p => p.apiKey).filter(Boolean);
      const protect = (value: unknown) => {
        function inspect(v: unknown): boolean {
          if (typeof v === 'string') return keys.some(k => v.includes(k));
          if (Array.isArray(v)) return v.some(inspect);
          return !!v && typeof v === 'object' && Object.entries(v).some(([k, val]) => inspect(k) || inspect(val));
        }
        if (inspect(value)) throw new T8Error('INPUT');
      };
      let frozenInputHash: string | null = null,
        frozenInput: T7Input | null = null,
        run: T7Run | null = null;
      let deadline = 0;
      const abort = new AbortController(),
        view = empty();
      Object.assign(view, {
        status: 'queued',
        runId,
        triggerKey,
        baseRevision: base.data.revision,
        templateVersion: base.template.templateVersion,
        promptVersion: prompts.revision,
        worldTime: clone(initial.now),
        maxRequests: Math.min(base.template.defaults.budget.maxRequests, base.template.hardLimits.maxRequests),
      });
      protect(view);
      const record = {
        view,
        abort,
        handoff: null as T8Handoff | null,
        done: Promise.resolve(),
        protect,
        check: async () => {},
      };
      async function check() {
        if (abort.signal.aborted)
          throw abort.signal.reason instanceof T8Error ? abort.signal.reason : new T8Error('CANCELLED');
        if (deadline && ['waiting', 'running'].includes(view.status) && Date.now() >= deadline)
          throw new T8Error('RUN_TIMEOUT');
        if (!options.queue.owns(triggerKey, runId, options.ownerId)) throw new T8Error('OWNERSHIP');
        try {
          if (options.canRun && !options.canRun()) throw new Error();
          const live = normalizeT7Input(options.readInput());
          if (
            stateHash !== (await fingerprintT4(normalizeT4State(options.readState()))) ||
            coreHash !== (await fingerprintT4(inputCore(live))) ||
            (frozenInputHash && frozenInputHash !== (await fingerprintT4(live)))
          )
            throw new Error();
        } catch {
          throw new T8Error('STALE');
        }
        if (abort.signal.aborted) throw abort.signal.reason;
        if (!options.queue.owns(triggerKey, runId, options.ownerId)) throw new T8Error('OWNERSHIP');
      }
      record.check = check;
      async function work() {
        let timer: ReturnType<typeof setTimeout> | undefined, watch: ReturnType<typeof setInterval> | undefined;
        let checking = false;
        const stop = (error: T8Error) => {
          if (!abort.signal.aborted) abort.abort(error);
        };
        try {
          await check();
          deadline = Date.now() + times.run;
          timer = setTimeout(() => stop(new T8Error('RUN_TIMEOUT')), times.run);
          watch = setInterval(() => {
            if (checking) return;
            checking = true;
            check()
              .catch(error => stop(error instanceof T8Error ? error : new T8Error('STALE')))
              .finally(() => {
                checking = false;
              });
          }, times.poll);
          view.status = 'waiting';
          notify();
          const waitingSince = Date.now();
          let hasWaited = false;
          while (true) {
            await check();
            const input = normalizeT7Input(options.readInput());
            const report = await inspectT7Prerequisites(input);
            protect(report);
            view.prerequisites = report;
            notify();
            if (hasWaited && Date.now() - waitingSince >= times.prerequisite) throw new T8Error('PREREQUISITE_TIMEOUT');
            if (report.ready) {
              frozenInput = input;
              frozenInputHash = await fingerprintT4(input);
              break;
            }
            if (report.reports.some(p => p.required && !p.valid && p.state !== 'waiting'))
              throw new T8Error('PREREQUISITE');
            // A waiting proof from another swipe cannot release this run later.
            if (
              input.proofs.some(
                p =>
                  p.required &&
                  p.state === 'waiting' &&
                  p.identity &&
                  JSON.stringify(Object.entries(p.identity).sort()) !==
                    JSON.stringify(
                      Object.entries({ ...input.anchor, worldId: input.worldId, branchId: input.branchId }).sort(),
                    ),
              )
            )
              throw new T8Error('PREREQUISITE');
            if (Date.now() - waitingSince >= times.prerequisite) throw new T8Error('PREREQUISITE_TIMEOUT');
            hasWaited = true;
            await pause(times.poll, abort.signal);
          }
          run = await createT7Run({
            runId,
            state: base,
            input: frozenInput!,
            prompts,
            api,
            transport,
          });
          const initialPlan = await run.plan('macro');
          await check();
          view.skipped = initialPlan.tables.filter(t => t.skip).map(t => ({ tableId: t.tableId, reason: t.skip! }));
          // Explicitly disabled/not-due/no-candidate tables may inherit. A missing API or
          // incomplete mandatory context is not a successful no-change macro phase.
          if (initialPlan.tables.some(table => table.blocked)) throw new T8Error('PLAN');
          view.inputFingerprint = run.view().inputFingerprint;
          view.status = 'running';
          view.batches = initialPlan.requests.map(request => ({
            tableId: request.tableId,
            tableName: base.template.tables.find(t => t.id === request.tableId)!.name,
            status: 'pending',
            request: clone(request),
            beforeFingerprint: null,
            afterFingerprint: null,
            changedRows: 0,
            newRows: 0,
          }));
          view.total = view.batches.length;
          notify();
          let privateData = clone(base.data),
            plan: T7PhasePlan = initialPlan;
          const batches: T4Batch[] = [],
            usage = { rows: 0, newRows: 0 };
          for (const batchView of view.batches) {
            await check();
            const request = plan.requests.find(r => r.id === batchView.request.id);
            if (!request) throw new T8Error('SQL');
            batchView.request = clone(request);
            batchView.beforeFingerprint = await fingerprintT4(privateData);
            batchView.status = 'sending';
            notify();
            let boundaryError: T8Error | null = null;
            const result = await abortableT8(
              run.send(request.id, {
                signal: abort.signal,
                beforeSend: async () => {
                  try {
                    await check();
                    await reserveSend?.({
                      runId,
                      stage: 'macro',
                      sent: run!.view().sent + 1,
                      maxRequests: run!.view().maxRequests,
                      anchor: initial.anchor,
                      signal: abort.signal,
                    });
                    await check();
                  } catch (error) {
                    boundaryError = error instanceof T8Error ? error : new T8Error('STALE');
                    stop(boundaryError);
                    throw boundaryError;
                  }
                },
                onAttempt: () => {
                  view.sent = run!.view().sent;
                  notify();
                },
                reply: transport
                  ? undefined
                  : async (sentRequest, attempt, signal) => {
                      const fallback = {
                        status: 200,
                        text: JSON.stringify({
                          sql: `SELECT __we_row_id FROM ${base.template.tables.find(t => t.id === sentRequest.tableId)!.sqlName}`,
                          parameters: [],
                        }),
                      };
                      const job = options.reply
                        ? options.reply(sentRequest, attempt, signal)
                        : Promise.resolve(fallback);
                      // Both whole-run abort and the client's per-request timeout reach the fake transport.
                      return abortableT8(abortableT8(job, signal ?? abort.signal), abort.signal);
                    },
              }),
              abort.signal,
            );
            await check();
            view.sent = run.view().sent;
            if (boundaryError) throw boundaryError;
            if (!result.ok)
              throw new T8Error(
                result.code === 'CONFIG'
                  ? view.sent >= view.maxRequests || result.attempts > request.maxRequests
                    ? 'BUDGET'
                    : 'PLAN'
                  : 'MODEL',
              );
            if (typeof result.text !== 'string') throw new T8Error('RESPONSE');
            const output = parseT8Output(result.text);
            const sqlRequest = freezeT3Request({
              template: base.template,
              data: privateData,
              ...output,
              batchId: `macro-${batches.length + 1}`,
              policy: request.policy,
              limits: { maxAffectedRows: request.maxRows, maxNewRows: request.maxNewRows },
            });
            batchView.status = 'validating';
            notify();
            await check();
            const sqlAbort = new AbortController(),
              forward = () => sqlAbort.abort(abort.signal.reason);
            abort.signal.addEventListener('abort', forward, { once: true });
            const sqlTimer = setTimeout(() => sqlAbort.abort(new T8Error('SQL')), times.sql);
            const sqlDeadline = Date.now() + times.sql;
            try {
              const response = await abortableT8(
                options.execute(sqlRequest, { signal: sqlAbort.signal }),
                sqlAbort.signal,
              );
              const checked = normalizeT3Result(response, sqlRequest);
              await check();
              if (Date.now() >= sqlDeadline) throw new T8Error('SQL');
              usage.rows += checked.changedRows.length;
              usage.newRows += checked.allocations.length;
              batchView.changedRows = checked.changedRows.length;
              batchView.newRows = checked.allocations.length;
              batchView.afterFingerprint = await fingerprintT4(checked.data);
              protect({ ...output, changes: checked.changedRows });
              privateData = checked.data;
              batches.push({
                ...output,
                batchId: sqlRequest.batchId,
                policy: clone(request.policy),
                limits: clone(sqlRequest.limits!),
              });
              batchView.status = 'staged';
              view.completed += 1;
              notify();
            } catch (error) {
              if (abort.signal.aborted) throw abort.signal.reason;
              if (error instanceof T8Error) throw error;
              if (error instanceof T3RuntimeError && error.code === 'ABORTED') throw new T8Error('CANCELLED');
              throw new T8Error('SQL', describeT3Diagnostic(error, sqlRequest));
            } finally {
              clearTimeout(sqlTimer);
              abort.signal.removeEventListener('abort', forward);
            }
            if (view.completed < view.total)
              plan = await run.refreshMacro(
                privateData,
                view.batches.filter(batch => batch.status === 'staged').map(batch => batch.tableId),
              );
          }
          await check();
          await run.provideMacro({ runId, inputFingerprint: run.view().inputFingerprint, data: privateData, usage });
          const changes: T8Change[] = [];
          for (const change of diffT4States(base, { template: base.template, data: privateData })) {
            const table = base.template.tables.find(t => t.id === change.tableId)!;
            const before = base.data.tables[table.id].find(r => r.meta.id === change.rowId),
              after = privateData.tables[table.id].find(r => r.meta.id === change.rowId);
            const fields = table.fields
              .filter(
                f =>
                  f.visibility.user &&
                  f.visibility.evolutionAi &&
                  (Object.hasOwn(before?.values ?? {}, f.id) !== Object.hasOwn(after?.values ?? {}, f.id) ||
                    JSON.stringify(before?.values[f.id]) !== JSON.stringify(after?.values[f.id])),
              )
              .map(f => ({
                id: f.id,
                name: f.name,
                before: before?.values[f.id] ?? null,
                after: after?.values[f.id] ?? null,
                beforePresent: Object.hasOwn(before?.values ?? {}, f.id),
                afterPresent: Object.hasOwn(after?.values ?? {}, f.id),
              }));
            if (
              table.visibility.user &&
              table.visibility.evolutionAi &&
              (!before || before.meta.visibility.user) &&
              (!after || after.meta.visibility.user)
            )
              changes.push({ ...change, tableName: table.name, fields });
          }
          protect(changes);
          await check();
          record.handoff = {
            run,
            base: clone(base),
            data: clone(privateData),
            input: clone(frozenInput!),
            batches: clone(batches),
            usage: clone(usage),
            context: {
              inputFingerprint: frozenInput!.anchor.inputFingerprint,
              promptFingerprint: await fingerprintT4(prompts),
              modelFingerprint: await fingerprintT4(
                api.presets.map(p => ({ id: p.id, model: p.model, provider: p.provider })),
              ),
              parametersFingerprint: await fingerprintT4(api.presets.map(({ apiKey: _key, ...p }) => p)),
            },
            progress: {
              ...clone(frozenInput!.progress),
              ...Object.fromEntries(
                initialPlan.tables
                  .filter(t => t.rotationProposal !== null)
                  .map(t => [
                    t.tableId,
                    { lastSuccessfulRound: frozenInput!.eligibleRound, rotation: t.rotationProposal! },
                  ]),
              ),
            },
            expiresAt: deadline,
          };
          await check();
          view.changes = changes;
          view.status = 'staged';
          view.outcome = 'private-macro-ready';
          notify();
          if (options.onStaged) {
            const stopWatching = () => {
              clearTimeout(timer);
              clearInterval(watch);
            };
            await options.onStaged(record.handoff, { signal: abort.signal, check, protect, stopWatching });
          }
        } catch (error) {
          if (run) view.sent = run.view().sent;
          terminate(
            record,
            abort.signal.reason instanceof T8Error
              ? abort.signal.reason
              : error instanceof T8Error
                ? error
                : new T8Error('SQL'),
          );
        } finally {
          clearTimeout(timer);
          clearInterval(watch);
        }
      }
      const scheduled = options.queue.schedule(triggerKey, runId, options.ownerId, work);
      if (scheduled.duplicate) return { duplicate: true, runId: scheduled.runId, done: scheduled.done };
      records.set(runId, record);
      current = runId;
      record.done = scheduled.done;
      notify();
      return { duplicate: false, runId, done: record.done };
    },
    cancel(runId = current) {
      const record = runId ? records.get(runId) : null;
      if (record && ['queued', 'waiting', 'running', 'staged'].includes(record.view.status))
        terminate(record, new T8Error('CANCELLED'));
    },
    async check(runId = current) {
      const record = runId ? records.get(runId) : null;
      if (!record || !['queued', 'waiting', 'running', 'staged'].includes(record.view.status)) return;
      try {
        await record.check();
      } catch (error) {
        terminate(record, error instanceof T8Error ? error : new T8Error('STALE'));
      }
    },
    /** Trusted T9 boundary only. Public Vue view never contains full private/hidden world data. */
    async handoff(runId = current): Promise<T8Handoff> {
      await control.check(runId);
      const record = runId ? records.get(runId) : null;
      if (!record?.handoff || record.view.status !== 'staged') throw new T8Error('STALE');
      const { run, ...value } = record.handoff;
      return { run, ...clone(value) };
    },
  };
  return control;
}
export type T8Control = ReturnType<typeof createT8Control>;
