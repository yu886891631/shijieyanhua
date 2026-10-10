/** Whole-round coordinator. One shared SQL/commit pipeline for fake or explicitly injected real transport. */
import { cloneT2Json, type T2WorldData } from './t2-template';
import { freezeT3Request, normalizeT3Result } from './t3-result';
import { canonicalT4Json, diffT4States, fingerprintT4, stampT4State } from './t4-protocol';
import { T4ServiceError, type T4Batch, type T4CommitService, type T4Prepared } from './t4-service';
import type { T4HeadToken } from './t4-store';
import { normalizeT7Input } from './t7-input';
import type { T7PhasePlan, T7Request } from './t7-run';
import {
  createT8Control,
  parseT8Output,
  type T8Options,
  type T8Handoff,
  type T8Change,
  type T8View,
} from './t8-control';
import { normalizeT9Ledger } from './t9-ledger';
import { describeT3Diagnostic, type T3Diagnostic } from './t3-diagnostic';

const clone = <T>(value: T): T => cloneT2Json(value) as unknown as T;
const same = (a: unknown, b: unknown) => canonicalT4Json(a) === canonicalT4Json(b);
type Code =
  | 'INPUT'
  | 'MACRO'
  | 'MODEL'
  | 'RESPONSE'
  | 'SQL'
  | 'PLAN'
  | 'BUDGET'
  | 'STALE'
  | 'CANCELLED'
  | 'TIMEOUT'
  | 'SAVE'
  | 'PENDING';
const messages: Record<Code, string> = {
  INPUT: '配置无效、存在草稿或另一轮尚未结束；没有开始本轮。',
  MACRO: '宏观阶段没有完成；未进入微观或保存。',
  MODEL: '微观模型请求失败；未保存。可用剩余发送额度显式续跑，不会重做已校验批次。',
  RESPONSE: '回复不是规定的 SQL JSON；未执行，不能盲目重试。',
  SQL: '本地 SQL、类型、引用、锁定、可见性或生命周期校验失败；整轮未保存。',
  PLAN: '必要微观表的路由/上下文不完整，或冻结批次丢失；整轮未保存。',
  BUDGET: '两阶段共用的发送/对象额度已用尽；不会扩额重试。',
  STALE: '基准提交、剧情/前置、模板、分支或运行权限变化，暂存已失效。',
  CANCELLED: '已停止生成。尚未到写入点的整轮不保存；已开始保存的结果以存档回执为准。',
  TIMEOUT: '整轮或 SQL 时间上限已到；迟到结果不能保存。',
  SAVE: '存档明确保存失败；可仅重试相同提交，不再调用模型。',
  PENDING: '保存回执未知；先查询存档，不重新生成或盲目覆盖。',
};
class RoundError extends Error {
  constructor(
    readonly code: Code,
    readonly diagnostic: T3Diagnostic | null = null,
  ) {
    super(messages[code]);
  }
}
export type T9Status =
  | 'idle'
  | 'macro'
  | 'micro'
  | 'validating'
  | 'saving'
  | 'saved'
  | 'no-change'
  | 'paused'
  | 'pending'
  | 'failed'
  | 'cancelled'
  | 'stale';
export interface T9BatchView {
  tableId: string;
  tableName: string;
  request: T7Request;
  status: 'pending' | 'sending' | 'validating' | 'staged';
  changedRows: number;
  newRows: number;
}
export interface T9View {
  mode: 't9-local-simulation' | 't9-real-api';
  status: T9Status;
  runId: string | null;
  macro: T8View;
  micro: T7PhasePlan | null;
  batches: T9BatchView[];
  sent: number;
  maxRequests: number;
  baseRevision: number | null;
  savedRevision: number | null;
  changes: (T8Change & { stage: 'macro' | 'micro' })[];
  error: { code: Code; message: string; diagnostic?: T3Diagnostic } | null;
  canResume: boolean;
  expiresAt: number | null;
  commitId: string | null;
  outcome: 'none' | 'private' | 'saved' | 'not-saved' | 'unknown';
  notices: string[];
}
export interface T9Options extends Omit<T8Options, 'onStaged' | 'readState'> {
  service: T4CommitService;
  afterSaved?: () => void;
}
function race<T>(job: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener('abort', abort);
      reject(signal.reason ?? new RoundError('CANCELLED'));
    };
    job.then(
      v => {
        signal.removeEventListener('abort', abort);
        if (signal.aborted) abort();
        else resolve(v);
      },
      e => {
        signal.removeEventListener('abort', abort);
        reject(e);
      },
    );
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  });
}
export function createT9Round(options: T9Options) {
  const transport = options.transport,
    reserveSend = options.reserveSend;
  const service = options.service;
  const sqlMs = options.sqlTimeoutMs ?? 10000;
  const listeners = new Set<() => void>();
  const notify = () =>
    listeners.forEach(fn => {
      try {
        fn();
      } catch {
        /* UI is not authority. */
      }
    });
  interface Record {
    view: T9View;
    baseHead: T4HeadToken;
    handoff: T8Handoff | null;
    protect: (v: unknown) => void;
    data: T2WorldData | null;
    batches: T4Batch[];
    completed: string[];
    initialMicro: T7PhasePlan | null;
    prepared: T4Prepared | null;
    inputHash: string | null;
    abort: AbortController | null;
    busy: boolean;
    dispatch: Promise<{ duplicate: boolean; runId: string; done: Promise<void> }>;
  }
  const records = new Map<string, Record>();
  let current: string | null = null;
  let recoveredView: T9View | null = null;
  const readInput = () => {
    const input = normalizeT7Input(options.readInput());
    // Successful frequency/rotation comes from sealed JSON, not a mutable caller counter.
    input.progress = service.evolutionLedger()?.progress ?? {};
    return input;
  };
  const macro = createT8Control({
    ...options,
    transport,
    reserveSend,
    readInput,
    readState: () => service.view().formal,
    onStaged: async (handoff, capabilities) => {
      const record = records.get(handoff.run.view().runId)!;
      record.handoff = handoff;
      record.protect = capabilities.protect;
      record.inputHash = await fingerprintT4(handoff.input);
      record.data = clone(handoff.data);
      record.batches = clone(handoff.batches);
      record.view.expiresAt = handoff.expiresAt;
      // T9 owns monitoring now; T8's formal-state watch must not classify our own CAS as an edit.
      capabilities.stopWatching();
      await executeRound(record, capabilities.signal);
    },
  });
  const empty = (): T9View => ({
    mode: transport ? 't9-real-api' : 't9-local-simulation',
    status: 'idle',
    runId: null,
    macro: macro.view(),
    micro: null,
    batches: [],
    sent: 0,
    maxRequests: 0,
    baseRevision: null,
    savedRevision: null,
    changes: [],
    error: null,
    canResume: false,
    expiresAt: null,
    commitId: null,
    outcome: 'none',
    notices: [
      transport
        ? '真实 API、同一受限 SQLite 与唯一提交网关。模型请求可能收费；存档能力须由宿主证明，不以运输成功冒充保存。'
        : '本地模拟：假模型响应、真实受限 SQLite、模拟 JSON 存档；零联网、零费用，不动实际聊天/MVU/数据库/世界书。',
      '微观读取本轮宏观暂存与旧微观资料；有序后批读前批暂存；所有表和时间/频率/轮转只在一次提交后生效。',
      '取消/超时的已发送请求在真实接入后可能收费；本地标记结果未知，不承诺撤销服务商请求。',
      '仅同实例、同输入/基准/模板/分支、未过期且仍有权限的暂存可显式续跑；刷新只恢复存档，绝不自动续发。',
      '类型/引用/预算/可见性/锁定可机械校验；剧情事实与任意自然语言规则不能靠 SQL 完全证明。计划完成请更新状态保留历史，默认不允许 AI 删除。',
    ],
  });
  macro.subscribe(() => {
    if (!current) return;
    const r = records.get(current);
    if (!r) return;
    r.view.macro = macro.view(current);
    if (!r.handoff) {
      r.view.sent = r.view.macro.sent;
      r.view.maxRequests = r.view.macro.maxRequests;
    }
    notify();
  });
  function checkSync(record: Record) {
    if (record.abort?.signal.aborted) throw record.abort.signal.reason;
    const handoff = record.handoff!;
    if (Date.now() >= handoff.expiresAt) throw new RoundError('TIMEOUT');
    if (!options.queue.owns(record.view.macro.triggerKey!, record.view.runId!, options.ownerId))
      throw new RoundError('STALE');
    if (options.canRun && !options.canRun()) throw new RoundError('STALE');
    try {
      if (!same(service.headToken(), record.baseHead) || !same(readInput(), handoff.input))
        throw new RoundError('STALE');
    } catch {
      throw new RoundError('STALE');
    }
    if (record.abort?.signal.aborted) throw record.abort.signal.reason;
  }
  async function check(record: Record) {
    checkSync(record);
  }
  function differences(record: Record): T9View['changes'] {
    const h = record.handoff!,
      data = record.data!;
    return diffT4States(h.base, { template: h.base.template, data }).flatMap(change => {
      const table = h.base.template.tables.find(t => t.id === change.tableId)!;
      const before = h.base.data.tables[table.id].find(r => r.meta.id === change.rowId),
        after = data.tables[table.id].find(r => r.meta.id === change.rowId);
      if (
        !table.visibility.user ||
        !table.visibility.evolutionAi ||
        (before && !before.meta.visibility.user) ||
        (after && !after.meta.visibility.user)
      )
        return [];
      const fields = table.fields
        .filter(
          f =>
            f.visibility.user &&
            f.visibility.evolutionAi &&
            (Object.hasOwn(before?.values ?? {}, f.id) !== Object.hasOwn(after?.values ?? {}, f.id) ||
              !same(before?.values[f.id] ?? null, after?.values[f.id] ?? null)),
        )
        .map(f => ({
          id: f.id,
          name: f.name,
          before: before?.values[f.id] ?? null,
          after: after?.values[f.id] ?? null,
          beforePresent: Object.hasOwn(before?.values ?? {}, f.id),
          afterPresent: Object.hasOwn(after?.values ?? {}, f.id),
        }));
      return [{ ...change, tableName: table.name, stage: table.groupId, fields }];
    });
  }
  function validateLifecycleAndTime(record: Record, next: T2WorldData, previous = record.data!) {
    const h = record.handoff!;
    for (const table of h.base.template.tables) {
      for (const row of next.tables[table.id]) {
        const old = previous.tables[table.id].find(r => r.meta.id === row.meta.id);
        for (const field of table.fields) {
          const before = old?.values[field.id],
            after = row.values[field.id];
          if (same(before ?? null, after ?? null)) continue;
          if (typeof before === 'string' && field.constraints.terminalValues?.includes(before) && before !== after)
            throw new RoundError('SQL');
          if (
            field.semantic === 'fact-time' &&
            after &&
            typeof after === 'object' &&
            !Array.isArray(after) &&
            'ordinalMinute' in after
          ) {
            if (
              !h.input.now ||
              after.calendarId !== h.input.now.calendarId ||
              after.ordinalMinute > h.input.now.ordinalMinute
            )
              throw new RoundError('SQL');
          }
        }
      }
    }
  }
  function adoptReceipt(record: Record) {
    const receipt = service.view();
    if (receipt.status === 'pending') throw new RoundError('PENDING');
    const saved = service.findEvolutionRun(record.handoff!.input.anchor);
    if (
      receipt.status !== 'saved' ||
      saved?.runId !== record.view.runId ||
      saved?.commitId !== record.prepared?.commit?.commitId
    )
      throw new RoundError('SAVE');
    record.view.status = record.view.changes.length ? 'saved' : 'no-change';
    record.view.outcome = 'saved';
    record.view.savedRevision = record.prepared!.state.data.revision;
    record.view.commitId = saved.commitId;
    if (receipt.head.commitId !== saved.commitId)
      record.view.notices.push('本轮提交已在存档中确认；当前世界还有后续提交，下面差异仅表示本轮结果。');
    record.view.error = null;
    record.view.canResume = false;
    try {
      options.afterSaved?.();
    } catch {
      /* Saved authority cannot be reversed by display refresh. */
    }
  }
  async function executeRound(record: Record, inheritedSignal?: AbortSignal) {
    const h = record.handoff!,
      run = h.run,
      view = record.view;
    record.busy = true;
    const abort = new AbortController();
    record.abort = abort;
    const forward = () => abort.abort(new RoundError('CANCELLED'));
    inheritedSignal?.addEventListener('abort', forward, { once: true });
    if (inheritedSignal?.aborted) forward();
    const timer = setTimeout(() => abort.abort(new RoundError('TIMEOUT')), Math.max(1, h.expiresAt - Date.now()));
    let saving = false,
      checking = false;
    const watch = setInterval(() => {
      if (checking || (saving && service.headToken().commitId === record.prepared?.commit?.commitId)) return;
      checking = true;
      check(record)
        .catch(e => abort.abort(e instanceof RoundError ? e : new RoundError('STALE')))
        .finally(() => {
          checking = false;
        });
    }, options.pollMs ?? 25);
    try {
      await check(record);
      view.error = null;
      view.canResume = false;
      view.outcome = 'private';
      if (!record.prepared) {
        validateLifecycleAndTime(record, record.data!, h.base.data);
        view.status = 'micro';
        notify();
        let plan = await run.plan('micro');
        if (!record.initialMicro) {
          record.initialMicro = clone(plan);
          view.batches = plan.requests.map(request => ({
            tableId: request.tableId,
            tableName: h.base.template.tables.find(t => t.id === request.tableId)!.name,
            request: clone(request),
            status: 'pending',
            changedRows: 0,
            newRows: 0,
          }));
        }
        view.micro = clone(record.initialMicro);
        if (plan.tables.some(t => t.blocked)) throw new RoundError('PLAN');
        for (const batch of view.batches) {
          if (record.completed.includes(batch.tableId)) continue;
          await check(record);
          const request = plan.requests.find(r => r.id === batch.request.id);
          if (!request) throw new RoundError('BUDGET');
          batch.request = clone(request);
          batch.status = 'sending';
          view.status = 'micro';
          notify();
          const result = await race(
            run.send(request.id, {
              signal: abort.signal,
              beforeSend: async () => {
                await check(record);
                await reserveSend?.({
                  runId: view.runId!,
                  stage: 'micro',
                  sent: run.view().sent + 1,
                  maxRequests: run.view().maxRequests,
                  anchor: h.input.anchor,
                  signal: abort.signal,
                });
                await check(record);
              },
              onAttempt: () => {
                view.sent = run.view().sent;
                notify();
              },
              reply: transport
                ? undefined
                : async (request, attempt, signal) => {
                    const fallback = {
                      status: 200,
                      text: JSON.stringify({
                        sql: `SELECT __we_row_id FROM ${h.base.template.tables.find(t => t.id === request.tableId)!.sqlName}`,
                        parameters: [],
                      }),
                    };
                    return race(
                      race(
                        options.reply ? options.reply(request, attempt, signal) : Promise.resolve(fallback),
                        signal ?? abort.signal,
                      ),
                      abort.signal,
                    );
                  },
            }),
            abort.signal,
          );
          view.sent = run.view().sent;
          await check(record);
          if (!result.ok) throw new RoundError(result.code === 'CONFIG' ? 'BUDGET' : 'MODEL');
          if (typeof result.text !== 'string') throw new RoundError('RESPONSE');
          let output: ReturnType<typeof parseT8Output>;
          try {
            output = parseT8Output(result.text);
          } catch {
            throw new RoundError('RESPONSE');
          }
          const requestSql = freezeT3Request({
            template: h.base.template,
            data: record.data!,
            ...output,
            batchId: `micro-${record.completed.length + 1}`,
            policy: request.policy,
            limits: { maxAffectedRows: request.maxRows, maxNewRows: request.maxNewRows },
          });
          batch.status = 'validating';
          view.status = 'validating';
          notify();
          await check(record);
          const sqlAbort = new AbortController(),
            stopSql = () => sqlAbort.abort(abort.signal.reason);
          abort.signal.addEventListener('abort', stopSql, { once: true });
          const sqlDeadline = Date.now() + sqlMs;
          const sqlTimer = setTimeout(() => sqlAbort.abort(new RoundError('TIMEOUT')), sqlMs);
          try {
            const resultSql = normalizeT3Result(
              await race(options.execute(requestSql, { signal: sqlAbort.signal }), sqlAbort.signal),
              requestSql,
            );
            await check(record);
            if (Date.now() >= sqlDeadline) throw new RoundError('TIMEOUT');
            record.protect({ output, data: resultSql.data });
            validateLifecycleAndTime(record, resultSql.data);
            record.data = resultSql.data;
            record.batches.push({
              ...output,
              batchId: requestSql.batchId,
              policy: clone(request.policy),
              limits: requestSql.limits,
            });
            record.completed.push(batch.tableId);
            batch.status = 'staged';
            batch.changedRows = resultSql.changedRows.length;
            batch.newRows = resultSql.allocations.length;
            view.changes = differences(record);
            notify();
          } catch (e) {
            if (abort.signal.aborted) throw abort.signal.reason;
            if (e instanceof RoundError) throw e;
            throw new RoundError('SQL', describeT3Diagnostic(e, requestSql));
          } finally {
            clearTimeout(sqlTimer);
            abort.signal.removeEventListener('abort', stopSql);
          }
          plan = await run.refreshMicro(record.data!, record.completed);
        }
        await check(record);
        // Never clear someone else's unsaved draft merely because formal data still matches.
        const live = service.view();
        if (live.draft && live.status !== 'saved') throw new RoundError('STALE');
        const microProgress = Object.fromEntries(
          record.initialMicro.tables
            .filter(t => record.completed.includes(t.tableId))
            .map(t => [t.tableId, { lastSuccessfulRound: h.input.eligibleRound, rotation: t.rotationProposal! }]),
        );
        const evolution = normalizeT9Ledger(
          {
            version: 1,
            frozenInputFingerprint: run.view().inputFingerprint,
            eligibleRound: h.input.eligibleRound,
            worldTime: h.input.now ?? service.view().evolution?.worldTime ?? null,
            progress: { ...h.progress, ...microProgress },
            processedTableIds: [
              ...h.batches.flatMap(b => b.policy.write.map(g => g.tableId)),
              ...record.completed,
            ].filter((id, i, all) => all.indexOf(id) === i),
            sent: run.view().sent,
            maxRequests: run.view().maxRequests,
          },
          h.base,
        );
        view.status = 'validating';
        notify();
        record.prepared = await race(
          service.prepareSql(
            {
              runId: view.runId!,
              commitId: `c-${view.runId!.slice(0, 62)}`,
              kind: 'model',
              anchor: h.input.anchor,
              context: h.context,
              batches: record.batches,
              evolution,
            },
            { signal: abort.signal },
          ),
          abort.signal,
        );
        await check(record);
        if (
          !same(record.prepared.base, record.baseHead) ||
          !same(record.prepared.baseState, h.base) ||
          !same(record.prepared.state, stampT4State(h.base, { template: h.base.template, data: record.data! }))
        )
          throw new RoundError('SQL');
        record.protect(record.prepared);
        view.changes = differences(record);
      }
      await check(record);
      if (!same(service.view().draft, record.prepared)) throw new RoundError('STALE');
      view.status = 'saving';
      saving = true;
      notify();
      // Do not race the durable operation: abort may occur AFTER the CAS. Its receipt wins.
      await service.save({
        signal: abort.signal,
        authorize: () => {
          try {
            checkSync(record);
          } catch (e) {
            abort.abort(e instanceof RoundError ? e : new RoundError('STALE'));
            throw e;
          }
        },
      });
      adoptReceipt(record);
    } catch (e) {
      const live = service.view();
      // ACK loss / cancel-after-write is never presented as rollback or blindly regenerated.
      let code: Code =
        e instanceof RoundError
          ? e.code
          : e instanceof T4ServiceError && ['CONFLICT', 'ANCHOR'].includes(e.code)
            ? 'STALE'
            : e instanceof T4ServiceError && e.code === 'ABORTED'
              ? abort.signal.reason instanceof RoundError
                ? abort.signal.reason.code
                : 'CANCELLED'
              : e instanceof T4ServiceError && e.code === 'SAVE_FAILED'
                ? 'SAVE'
                : saving
                  ? 'SAVE'
                  : 'SQL';
      if (saving && live.status === 'pending') code = 'PENDING';
      if (!saving && abort.signal.aborted)
        code = abort.signal.reason instanceof RoundError ? abort.signal.reason.code : 'CANCELLED';
      view.error = {
        code,
        message: messages[code],
        ...(e instanceof RoundError && e.diagnostic ? { diagnostic: e.diagnostic } : {}),
      };
      view.status =
        code === 'PENDING'
          ? 'pending'
          : code === 'CANCELLED'
            ? 'cancelled'
            : code === 'STALE'
              ? 'stale'
              : code === 'MODEL' || code === 'SAVE'
                ? 'paused'
                : 'failed';
      view.outcome =
        code === 'PENDING' || (view.sent > 0 && ['MODEL', 'CANCELLED', 'TIMEOUT'].includes(code))
          ? 'unknown'
          : 'not-saved';
      view.canResume = code === 'SAVE' || (code === 'MODEL' && run.view().sent < run.view().maxRequests);
      if (!view.canResume && code !== 'PENDING') {
        if (live.draft?.commit?.runId === view.runId && live.status !== 'saved') {
          try {
            service.cancelDraft();
          } catch {
            /* Busy preparation is aborting, never save it. */
          }
        }
        record.data = null;
      }
    } finally {
      clearTimeout(timer);
      clearInterval(watch);
      inheritedSignal?.removeEventListener('abort', forward);
      record.busy = false;
      view.sent = run.view().sent;
      notify();
    }
  }
  const control = {
    view(): T9View {
      const r = current ? records.get(current) : null;
      if (!r) return recoveredView ? clone(recoveredView) : empty();
      r.protect(r.view);
      const value = clone(r.view);
      value.canResume = value.canResume && Date.now() < (value.expiresAt ?? 0);
      return value;
    },
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    async start(runId: string) {
      const prior = records.get(runId);
      if (prior) return { ...(await prior.dispatch), duplicate: true };
      const live = service.view();
      if (
        (current && records.get(current)?.busy) ||
        live.busy ||
        live.status === 'pending' ||
        (live.draft && live.status !== 'saved')
      )
        throw new RoundError('INPUT');
      if (readInput().anchor.chatId !== live.scope.chatId) throw new RoundError('INPUT');
      const input = readInput();
      const found = service.findEvolutionRun(input.anchor);
      if (found) {
        current = null;
        recoveredView = empty();
        Object.assign(recoveredView, {
          status: 'no-change',
          runId: found.runId,
          outcome: 'saved',
          commitId: found.commitId,
          baseRevision: live.formal.data.revision,
          savedRevision: live.formal.data.revision,
        });
        recoveredView.notices.push(
          '该剧情在模拟账本中已有已保存整轮；本次仅识别历史记录，没有发送、写入或推进版本。当前正式世界可能还包含后续人工编辑。',
        );
        notify();
        return { duplicate: true, runId: found.runId, done: Promise.resolve() };
      }
      if (
        live.evolution?.worldTime &&
        input.now &&
        live.evolution.worldTime.calendarId === input.now.calendarId &&
        input.now.ordinalMinute < live.evolution.worldTime.ordinalMinute
      )
        throw new RoundError('INPUT');
      recoveredView = null;
      const view = empty();
      view.status = 'macro';
      view.runId = runId;
      view.baseRevision = live.formal.data.revision;
      const record: Record = {
        view,
        baseHead: live.head,
        handoff: null,
        protect: () => {},
        data: null,
        batches: [],
        completed: [],
        initialMicro: null,
        prepared: null,
        inputHash: null,
        abort: null,
        busy: true,
        dispatch: Promise.resolve({ duplicate: false, runId, done: Promise.resolve() }),
      };
      records.set(runId, record);
      current = runId;
      notify();
      record.dispatch = (async () => {
        try {
          const started = await macro.start(runId);
          if (started.duplicate) {
            record.busy = false;
            view.status = 'failed';
            view.error = { code: 'INPUT', message: '此剧情已有另一个入口领取；未启动重复整轮。' };
          }
          const done = started.done.then(() => {
            view.macro = macro.view(runId);
            if (!record.handoff && !started.duplicate) {
              view.status =
                view.macro.status === 'cancelled' ? 'cancelled' : view.macro.status === 'stale' ? 'stale' : 'failed';
              view.error = {
                code: 'MACRO',
                message: view.macro.error?.message ?? messages.MACRO,
                ...(view.macro.error?.diagnostic ? { diagnostic: view.macro.error.diagnostic } : {}),
              };
              view.outcome = view.macro.sent ? 'unknown' : 'not-saved';
              record.busy = false;
            }
            notify();
          });
          return { ...started, done };
        } catch {
          record.busy = false;
          view.status = 'failed';
          view.error = { code: 'INPUT', message: messages.INPUT };
          notify();
          throw new RoundError('INPUT');
        }
      })();
      return record.dispatch;
    },
    cancel() {
      const r = current ? records.get(current) : null;
      if (!r || ['saved', 'no-change', 'pending'].includes(r.view.status)) return;
      if (!r.handoff) macro.cancel(current);
      else r.abort?.abort(new RoundError('CANCELLED'));
      if (!r.busy) {
        r.view.status = 'cancelled';
        r.view.error = { code: 'CANCELLED', message: messages.CANCELLED };
        r.view.canResume = false;
        r.data = null;
        if (service.view().draft?.commit?.runId === current) service.cancelDraft();
        notify();
      }
    },
    async resume() {
      const r = current ? records.get(current) : null;
      if (!r?.handoff || r.busy || !r.view.canResume || !r.data) throw new RoundError('INPUT');
      r.abort = null;
      try {
        await check(r);
      } catch {
        r.view.status = 'stale';
        r.view.canResume = false;
        r.data = null;
        r.view.error = { code: 'STALE', message: messages.STALE };
        notify();
        return;
      }
      r.busy = true;
      await options.queue.continue(r.view.macro.triggerKey!, r.view.runId!, options.ownerId, () => executeRound(r));
    },
    async reconcile() {
      const r = current ? records.get(current) : null;
      if (!r?.prepared || r.busy || r.view.status !== 'pending') throw new RoundError('INPUT');
      r.busy = true;
      try {
        await service.reconcile();
        if (service.view().status === 'saved') adoptReceipt(r);
        else {
          r.view.status = 'paused';
          r.view.error = { code: 'SAVE', message: messages.SAVE };
          r.view.outcome = 'not-saved';
          r.view.canResume = true;
        }
      } catch {
        r.view.error = { code: 'PENDING', message: messages.PENDING };
      } finally {
        r.busy = false;
        notify();
      }
    },
  };
  return control;
}
export type T9Round = ReturnType<typeof createT9Round>;
