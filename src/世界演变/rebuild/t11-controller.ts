/** T11 daily pages share the injected T9 scheduler / T4 authority. No live entry or network fallback. */
import { normalizeWorldEvolutionApiConfiguration } from '../api-config';
import { cloneT2Json, isT2TableDue, resolveT2TableSettings } from './t2-template';
import { canonicalT4Json, validateT4Archive, type T4Archive, type T4State } from './t4-protocol';
import { createT4PreviewModel, type T4PreviewModel } from './t4-preview';
import { type T4CommitService, type T4Prepared, type T4RunSpec } from './t4-service';
import { headT4Token, type T4ArchiveGateway, type T4HeadToken } from './t4-store';
import { normalizeT7Input, type T7Input } from './t7-input';
import { createT7Run, type T7PhasePlan } from './t7-run';
import type { T9Options, T9Round, T9Status, T9View } from './t9-round';
import type { T10RecoveryView } from './t10-recovery';
import { maskT11State, projectT11History, type T11HistoryItem } from './t11-history';

const copy = <T>(v: T): T => cloneT2Json(v) as unknown as T;
const same = (a: unknown, b: unknown) => canonicalT4Json(a) === canonicalT4Json(b);
const active = (v: T9View) => ['macro', 'micro', 'validating', 'saving'].includes(v.status);
export type T11Page = 'overview' | 'automatic' | 'history';
export type T11Destination = 'world' | 'api' | 'prompts' | 'recovery' | 'projection';
export interface T11RunItem {
  runId: string;
  source: 'manual' | 'automatic' | 'recovered';
  messageId: string;
  swipeId: string;
  status: string;
  label: string;
  saved: boolean;
  effective: boolean | null;
  commitId: string | null;
  sent: number;
  cap: number;
  error: string | null;
}
export interface T11TableView {
  id: string;
  name: string;
  group: 'macro' | 'micro';
  rows: number;
  lastSuccess: number | null;
  nextDue: number | null;
  frequency: string;
  due: boolean;
  skip: string | null;
  route: string;
  routeReady: boolean;
  pending: boolean;
  candidates: { rowId: string; selected: boolean; reasons: string[]; skipped: string | null }[];
  chars: number | null;
  estimatedTokens: number | null;
  requestCap: number | null;
}
export interface T11View {
  page: T11Page;
  busy: boolean;
  autoEnabled: boolean;
  error: string | null;
  message: string;
  confirmed: boolean;
  source: string;
  worldId: string;
  branchId: string;
  templateName: string;
  templateVersion: number;
  revision: number;
  commitId: string | null;
  seq: number;
  macroTables: number;
  microTables: number;
  macroRows: number;
  microRows: number;
  readiness: { id: string; label: string; ok: boolean; detail: string }[];
  checked: boolean;
  canStart: boolean;
  canCancel: boolean;
  canResume: boolean;
  canQuery: boolean;
  canReload: boolean;
  projection: { status: 'unavailable' | 'pending' | 'synced' | 'failed'; detail: string };
  run: {
    status: T9Status;
    label: string;
    outcome: string;
    phase: string;
    failureTable: string | null;
    failureCode: string | null;
    failureField: string | null;
    failureStatement: number | null;
    error: string | null;
    sent: number;
    cap: number;
    macroDone: number;
    macroTotal: number;
    microDone: number;
    microTotal: number;
    canResume: boolean;
    baseRevision: number | null;
    savedRevision: number | null;
    commitId: string | null;
  };
  tables: T11TableView[];
  runs: T11RunItem[];
  history: T11HistoryItem[];
  selected: T11HistoryItem | null;
  checkpoint: T4PreviewModel | null;
  invalidated: { id: string; seq: number; reason: string }[];
  impact: { afterSeq: number; commits: number; messageIds: string[]; detail: string } | null;
  restore: { sourceId: string | null; preview: T4PreviewModel; canConfirm: boolean; reason: string } | null;
  notices: string[];
}
export const T11_STATUS_NAMES: Record<T9Status, string> = {
  idle: '尚未运行',
  macro: '宏观阶段（可能等待前置）',
  micro: '微观阶段',
  validating: '整批校验中',
  saving: '正在保存，尚未确认',
  saved: '整轮已保存',
  'no-change': '已处理，未产生公开业务变化',
  paused: '暂停待处理',
  pending: '保存结果待核对',
  failed: '失败，未保存',
  cancelled: '已取消',
  stale: '结果已过期',
};
export interface T11Options {
  service: T4CommitService;
  round: T9Round;
  store: T4ArchiveGateway;
  runtime: Pick<T9Options, 'readInput' | 'readApi' | 'readPrompts' | 'canFreeze' | 'canRun'>;
  /** Trusted session permission, not a user JSON flag. Host writes require T10 verification. */
  readRecovery?: () => Promise<T10RecoveryView>;
  /** Captures a current valid anchor through the same gateway. Missing => recovery preview only. */
  restoreSpec?: () => Promise<T4RunSpec>;
  nextRunId?: () => string;
  /** Trusted T10 same-instance queue ownership. Does not authorize refreshed/interrupted runs. */
  canContinue?: () => boolean;
  projection?: () => T11View['projection'];
  subscribeProjection?: (listener: () => void) => () => void;
  navigate?: (destination: T11Destination) => void;
  /** Native manual/automatic entry shares this synchronous claim before round.start(). */
  claimDispatch?: (source: 'manual' | 'automatic', input: T7Input) => { assertCurrent(): void; finish(): void } | null;
  claimResume?: (input: T7Input) => { assertCurrent(): void; finish(): void };
}
export function createT11Controller(options: T11Options) {
  const { service, round } = options;
  let page: T11Page = 'overview',
    autoEnabled = false,
    busy = false,
    closed = false;
  let epoch = 0,
    error: string | null = null,
    message = '';
  let archive: T4Archive | null = null,
    recovery: T10RecoveryView | null = null;
  let cached: {
    key: string;
    macro: T7PhasePlan;
    micro: T7PhasePlan;
    ready: boolean;
    input: T7Input;
    waiting: boolean;
    fatal: boolean;
  } | null = null;
  let selectedId: string | undefined;
  let historyCache: { archive: T4Archive; head: T4HeadToken; secrets: number; items: T11HistoryItem[] } | null = null;
  const logs = new Map<string, T11RunItem>(),
    secrets = new Set<string>(),
    listeners = new Set<() => void>();
  let dispatching = false,
    restoring = false,
    restoreAbort: AbortController | null = null;
  let restore: {
    sourceId: string | null;
    head: T4HeadToken;
    input: string;
    preview: T4PreviewModel;
    prepared: T4Prepared | null;
  } | null = null;
  const emit = () => {
    for (const fn of listeners) {
      try {
        fn();
      } catch {
        /* Display is not authority. */
      }
    }
  };
  const redact = <T>(v: T): T => {
    const clean = (value: unknown): unknown => {
      if (typeof value === 'string') {
        for (const s of secrets) if (s) value = (value as string).split(s).join('[凭据已隐藏]');
        return value;
      }
      if (Array.isArray(value)) return value.map(clean);
      if (value && typeof value === 'object')
        return Object.fromEntries(Object.entries(value).map(([k, v]) => [clean(k), clean(v)]));
      return value;
    };
    return clean(v) as T;
  };
  const capture = () => {
    const live = service.view();
    const input = normalizeT7Input(options.runtime.readInput());
    input.progress = live.evolution?.progress ?? {};
    if (
      input.anchor.chatId !== live.scope.chatId ||
      input.worldId !== live.scope.worldId ||
      input.branchId !== live.scope.branchId
    )
      throw new Error('scope');
    const api = normalizeWorldEvolutionApiConfiguration(options.runtime.readApi(), 0);
    for (const p of api.presets) if (p.apiKey) secrets.add(p.apiKey);
    if ([...secrets].some(key => JSON.stringify(live.formal).includes(key))) throw new Error('credential-in-world');
    const prompts = options.runtime.readPrompts();
    return { live, input, api, prompts, key: canonicalT4Json({ head: live.head, input, api, prompts }) };
  };
  const writable = () =>
    service.view().scope.mode === 't4-sandbox' ||
    (recovery?.status === 'ready' && recovery.writable && same(recovery.scope, service.view().scope));
  const editing = () => {
    try {
      return !(options.runtime.canFreeze?.() ?? true);
    } catch {
      return true;
    }
  };
  const permitted = () => {
    try {
      return options.runtime.canRun?.() ?? true;
    } catch {
      return false;
    }
  };
  const allowed = () => !closed && writable() && !editing() && permitted();
  function remember() {
    const v = round.view();
    if (!v.runId) return;
    const prior = logs.get(v.runId);
    logs.set(v.runId, {
      runId: v.runId,
      source: prior?.source ?? 'recovered',
      messageId: prior?.messageId ?? '',
      swipeId: prior?.swipeId ?? '',
      status: v.status,
      label: T11_STATUS_NAMES[v.status],
      saved: v.outcome === 'saved',
      effective: v.outcome === 'saved' ? true : null,
      commitId: v.commitId,
      sent: v.outcome === 'saved' && v.maxRequests === 0 ? (prior?.sent ?? 0) : v.sent,
      cap: v.outcome === 'saved' && v.maxRequests === 0 ? (prior?.cap ?? 0) : v.maxRequests,
      error: v.error?.message ?? null,
    });
    while (logs.size > 64) logs.delete(logs.keys().next().value!);
  }
  const unsubscribe = round.subscribe(() => {
    if (!closed) {
      remember();
      emit();
    }
  });
  let observedHead = service.headToken();
  const unsubscribeService = service.subscribe(() => {
    if (closed) return;
    const head = service.headToken();
    const changed = !same(head, observedHead);
    observedHead = head;
    emit();
    if (changed && !service.view().busy) void refresh(); // Query only, never starts the scheduler.
  });
  const unsubscribeProjection = options.subscribeProjection?.(() => {
    if (!closed) emit();
  });
  function projectedHistory(current: T4State, head: T4HeadToken) {
    if (!archive) return [];
    if (historyCache?.archive === archive && same(historyCache.head, head) && historyCache.secrets === secrets.size)
      return historyCache.items;
    const items = projectT11History(archive, current, [...secrets]);
    historyCache = { archive, head, secrets: secrets.size, items };
    return items;
  }
  function view(): T11View {
    const loaded = service.view(),
      v = round.view();
    const recovered = recovery && same(recovery.scope, loaded.scope) ? recovery : null;
    const live =
      recovered?.state && recovered.head && recovered.status !== 'ready'
        ? { ...loaded, formal: recovered.state, head: recovered.head, evolution: recovered.evolution }
        : loaded;
    let frozen: ReturnType<typeof capture> | null = null;
    try {
      frozen = capture();
    } catch {
      /* Configuration is not ready; no raw error. */
    }
    const valid = !!frozen && cached?.key === frozen.key;
    const check = valid ? cached : null;
    const matches = !!archive && same(headT4Token(archive), live.head);
    const confirmed =
      matches || !!(recovered?.state && recovered.head && ['ready', 'restored-ancestor'].includes(recovered.status));
    const runActive = active(v) || dispatching || restoring;
    const draft = !!live.draft && live.status !== 'saved';
    const publicTables = live.formal.template.tables.filter(t => t.visibility.user);
    const history = projectedHistory(live.formal, live.head);
    const selected = selectedId === undefined ? null : (history.find(h => h.id === selectedId) ?? null);
    const sourceState =
      selectedId === undefined || !archive
        ? null
        : selectedId === 'genesis'
          ? archive.genesis
          : (archive.commits.find(c => c.commitId === selectedId)?.snapshot.state ?? null);
    const checkpoint = sourceState
      ? createT4PreviewModel({
          status: 'private',
          scope: live.scope,
          base: {
            ...maskT11State(sourceState, live.formal),
            data: { ...sourceState.data, tables: Object.fromEntries(sourceState.template.tables.map(t => [t.id, []])) },
          },
          draft: maskT11State(sourceState, live.formal),
          anchor: null,
          kind: 'manual',
        })
      : null;
    const latestBatches = v.batches.length ? v.batches : v.macro.batches;
    const failedBatch = latestBatches.find(b => b.status === 'sending' || b.status === 'validating');
    const phase =
      v.error?.code === 'MACRO' || (!v.micro && v.error)
        ? '宏观阶段'
        : ['SAVE', 'PENDING'].includes(v.error?.code ?? '')
          ? '保存阶段'
          : v.error
            ? '微观/整轮校验阶段'
            : v.macro.status === 'waiting'
              ? '等待前置完成'
              : v.status === 'macro'
                ? '宏观阶段'
                : v.status === 'micro'
                  ? '微观阶段'
                  : v.status === 'validating'
                    ? '统一校验'
                    : v.status === 'saving'
                      ? '保存确认'
                      : T11_STATUS_NAMES[v.status];
    const tables: T11TableView[] = publicTables.map(t => {
      const setting = resolveT2TableSettings(live.formal.template, t.id);
      const last = live.evolution?.progress[t.id]?.lastSuccessfulRound ?? null;
      const frequency = setting.frequency.value;
      const nextDue =
        !setting.enabled || !frequency
          ? null
          : last === null
            ? frequency.offset
            : Math.max(frequency.offset, last + frequency.every);
      const final = v.runId && active(v) ? (t.groupId === 'micro' ? v.micro : null) : null;
      const plan = final ?? (t.groupId === 'macro' ? check?.macro : check?.micro);
      const entry = plan?.tables.find(p => p.tableId === t.id);
      const request =
        plan?.requests.find(r => r.tableId === t.id) ??
        (active(v) ? [...v.macro.batches, ...v.batches].find(b => b.tableId === t.id)?.request : undefined);
      const candidates = (plan?.candidates ?? []).filter(
        c =>
          c.tableId === t.id &&
          live.formal.data.tables[t.id].some(r => r.meta.id === c.rowId && r.meta.visibility.user),
      );
      return {
        id: t.id,
        name: t.name,
        group: t.groupId,
        rows: live.formal.data.tables[t.id].filter(r => r.meta.visibility.user).length,
        lastSuccess: last,
        nextDue,
        frequency: !frequency
          ? '此层禁用频率'
          : `每 ${frequency.every} 次合格剧情轮；起点 ${frequency.offset}（${setting.frequency.source === 'table' ? '本表' : setting.frequency.source === 'phase' ? '表组' : '全局'}）`,
        due:
          !!frozen &&
          setting.enabled &&
          (last === null || last <= frozen.input.eligibleRound) &&
          isT2TableDue(frequency, frozen.input.eligibleRound, last),
        skip: entry?.skip ?? (!setting.enabled ? '自动更新关闭，仍可作为可读条件' : null),
        route: entry?.route.name
          ? `${entry.route.name} · ${entry.route.model}`
          : (entry?.route.reason ?? '尚未检查最终路由'),
        routeReady: entry?.route.ready ?? false,
        pending: t.groupId === 'micro' && !v.micro,
        candidates: candidates.map(c => ({
          rowId: c.rowId,
          selected: c.selected,
          reasons: c.reasons,
          skipped: c.skipped,
        })),
        chars: request?.chars ?? null,
        estimatedTokens: request?.estimatedTokens ?? null,
        requestCap: request?.maxRequests ?? null,
      };
    });
    const canStart =
      !!check &&
      !check.fatal &&
      matches &&
      allowed() &&
      !runActive &&
      !v.canResume &&
      !draft &&
      !live.busy &&
      live.status !== 'pending';
    const restoreCurrent =
      !!restore && same(restore.head, live.head) && !!frozen && restore.input === canonicalT4Json(frozen.input);
    const restoreOwned = !!restore?.prepared && same(restore.prepared, live.draft);
    const readiness: T11View['readiness'] = [
      {
        id: 'archive',
        label: '已保存资料',
        ok: matches,
        detail: !archive
          ? '尚未检查或存档读取失败'
          : matches
            ? '版本与存档一致'
            : '存档出现新提交；请先重新载入正式资料',
      },
      {
        id: 'host',
        label: '运行与保存权限',
        ok: allowed(),
        detail: !writable()
          ? '宿主持久读取/原子写入未验证，或有中断/失效记录：当前只读'
          : editing()
            ? '先保存或取消其他页面的编辑草稿'
            : !permitted()
              ? '会话已失效或运行权限不可用；需要重新确认当前楼层锚点'
              : '同一个已验证网关；本地模拟不等于酒馆真机验收',
      },
      {
        id: 'input',
        label: '当前剧情与模板',
        ok: !!check,
        detail: check
          ? `合格剧情第 ${check.input.eligibleRound} 轮；配置仅为预检，不表示已经执行`
          : '点击检查准备情况；剧情、模板、提示词或 API 变化后须重新检查',
      },
      {
        id: 'api',
        label: 'API 与上下文',
        ok: !!check && ![...check.macro.tables, ...check.micro.tables].some(t => t.blocked),
        detail: check ? '宏观使用最终计划；微观必须等本轮宏观完成后才能确定' : '尚未检查',
      },
      {
        id: 'prerequisites',
        label: 'MVU / 数据库等前置',
        ok: !!check?.ready,
        detail: check?.waiting
          ? '正在等待本轮独立完成证据；不会用固定延时当完成'
          : check?.ready
            ? '必要来源已验证或明确跳过'
            : '必要前置未完成、失败或证据失配',
      },
    ];
    let projection: T11View['projection'] = {
      status: 'unavailable',
      detail: '新表协议世界书投影由 T12 接入；本页不写世界书，也不把保存称为已同步。',
    };
    try {
      if (options.projection) projection = copy(options.projection());
    } catch {
      projection = { status: 'failed', detail: '投影状态读取失败，未声明已同步' };
    }
    const afterSeq = selectedId === 'genesis' ? 0 : selected?.seq;
    const tail = afterSeq === undefined ? [] : history.filter(h => h.seq > afterSeq);
    return redact({
      page,
      busy: busy || restoring || dispatching,
      autoEnabled,
      error,
      message,
      confirmed,
      source:
        live.scope.mode === 't4-sandbox'
          ? '独立模拟存档（不是实际聊天）'
          : recovery?.source === 'simulated-host'
            ? '模拟酒馆宿主（不是实际酒馆）'
            : recovery?.source === 'verified-host'
              ? '已验证宿主网关（仍须专门真机验收）'
              : recovery?.source === 'compatibility-host'
                ? '单活动页面兼容宿主（非原子保存，仍须真机验收）'
                : '未验证宿主，当前只读',
      worldId: live.scope.worldId,
      branchId: live.scope.branchId,
      templateName: live.formal.template.name,
      templateVersion: live.formal.template.templateVersion,
      revision: live.formal.data.revision,
      commitId: live.head.commitId,
      seq: live.head.seq,
      macroTables: publicTables.filter(t => t.groupId === 'macro').length,
      microTables: publicTables.filter(t => t.groupId === 'micro').length,
      macroRows: tables.filter(t => t.group === 'macro').reduce((n, t) => n + t.rows, 0),
      microRows: tables.filter(t => t.group === 'micro').reduce((n, t) => n + t.rows, 0),
      readiness,
      checked: !!check,
      canStart,
      canCancel: (active(v) || v.canResume) && !restoring && live.status !== 'pending',
      canResume:
        !runActive &&
        v.canResume &&
        (!draft || live.draft?.commit?.runId === v.runId) &&
        !editing() &&
        permitted() &&
        (writable() ||
          (options.canContinue?.() === true && recovered?.status === 'ready' && same(recovered.head, loaded.head))) &&
        live.status !== 'pending',
      canQuery: !runActive && (v.status === 'pending' || live.status === 'pending'),
      canReload: !closed && !runActive && !busy && !live.busy && !draft && !editing() && live.status !== 'pending',
      projection,
      run: {
        status: v.status,
        label: T11_STATUS_NAMES[v.status],
        outcome:
          v.outcome === 'saved'
            ? '存档已确认'
            : live.status === 'pending' || v.status === 'pending'
              ? '保存回执未知，先查询'
              : v.outcome === 'unknown'
                ? '未确认保存；已发送请求的结果/费用可能未知（本地模拟不收费）'
                : v.outcome === 'private'
                  ? '仅暂存，正式资料尚未改变'
                  : '尚无本轮正式保存',
        phase,
        failureTable: failedBatch?.tableName ?? null,
        failureCode: v.error?.code ?? null,
        failureField: v.error?.diagnostic?.field ?? null,
        failureStatement: v.error?.diagnostic?.statement ?? null,
        error: v.error?.message ?? null,
        sent: v.sent,
        cap: v.maxRequests,
        macroDone: v.macro.completed,
        macroTotal: v.macro.total,
        microDone: v.batches.filter(b => b.status === 'staged').length,
        microTotal: v.batches.length,
        canResume: v.canResume,
        baseRevision: v.baseRevision,
        savedRevision: v.savedRevision,
        commitId: v.commitId,
      },
      tables,
      runs: [...logs.values()].reverse(),
      history: history.slice().reverse(),
      selected,
      checkpoint,
      invalidated:
        recovery?.pending.map(p => ({
          id: p.commitId,
          seq: p.seq,
          reason: p.reason === 'dependency' ? '剧情/楼层依赖失效，待明确重算' : '完整性未通过，不采用结果',
        })) ?? [],
      impact:
        afterSeq === undefined
          ? null
          : {
              afterSeq,
              commits: tail.length,
              messageIds: [...new Set(tail.map(h => h.messageId))],
              detail:
                '后续依赖属于当前分支。这里只预览范围；不删除聊天、不续发 AI、不清空历史。重新生成可能收费，需新锚点和显式确认。',
            },
      restore: restore
        ? {
            sourceId: restore.sourceId,
            preview: restore.preview,
            canConfirm:
              restoreCurrent &&
              allowed() &&
              !runActive &&
              (!draft || restoreOwned) &&
              live.status !== 'pending' &&
              !!options.restoreSpec,
            reason: !restoreCurrent
              ? '预览已过期，请重新检查并预览'
              : !options.restoreSpec
                ? '未接入可信当前楼层捕捉；仅可预览'
                : '将追加一次恢复提交，保留原历史；不会请求 AI。之后世界书若已接入须重新同步。',
          }
        : null,
      notices: [
        '本地开发页尚未并入 alpha.16 发布入口，不是当前酒馆插件已升级。',
        '自动开关仅在本实例保留，默认关闭；刷新恢复不会自动继续发送请求。',
        '宏观 → 微观 → 整轮一次保存；失败不推进成功频率或正式版本。',
        '运行日志最多保留本实例 64 条；跨刷新仅采用 T10 已存运行记录，未保存的阶段细节不伪造恢复。',
        '分支/复制需指定独立目标聊天、身份和锚点映射；本页只展示来源和影响范围，不猜测目标或合并分支。',
        ...(recovery?.notices ?? []),
      ],
    });
  }
  async function refresh() {
    const ticket = ++epoch;
    let readArchive = false;
    busy = true;
    error = null;
    emit();
    try {
      recovery = null;
      const recovered = options.readRecovery ? await options.readRecovery() : null;
      if (closed || ticket !== epoch) return;
      recovery = recovered;
      const scope = service.view().scope;
      const observed = await validateT4Archive(await options.store.read(scope));
      if (!same(observed.scope, scope)) throw new Error('scope');
      if (closed || ticket !== epoch) return;
      archive = observed;
      readArchive = true;
      const f = capture();
      const run = await createT7Run({
        runId: 't11-preflight',
        state: f.live.formal,
        input: f.input,
        prompts: f.prompts,
        api: f.api,
      });
      const macro = await run.plan('macro'),
        micro = await run.plan('micro'),
        prereq = run.view().prerequisites;
      if (closed || ticket !== epoch || capture().key !== f.key) return;
      const waiting = f.input.proofs.some(p => p.required && p.state === 'waiting');
      const fatal =
        [...macro.tables, ...micro.tables].some(t => t.blocked) ||
        prereq.reports.some(p => p.required && !p.valid && p.state !== 'waiting');
      cached = { key: f.key, input: f.input, macro, micro, ready: prereq.ready, waiting, fatal };
      // Persisted interruptions are display-only; never resume an old private stage or send on refresh.
      for (const record of recovered?.runs ?? [])
        if (!logs.has(record.runId))
          logs.set(record.runId, {
            ...record,
            source: 'recovered',
            messageId: '',
            swipeId: '',
            cap: record.maxRequests,
            saved: record.status === 'committed',
            effective: record.status === 'committed' ? true : null,
            commitId: observed.commits.find(c => c.runId === record.runId)?.commitId ?? null,
            label:
              record.status === 'committed'
                ? '已保存运行'
                : record.status === 'abandoned'
                  ? '已明确放弃'
                  : '中断/过期，未自动续跑',
            error: record.status === 'committed' ? null : '刷新后不恢复未保存暂存；先查看存档与费用未知提示。',
          });
      message = '只读检查完成；没有生成、保存或同步世界书。';
    } catch {
      if (ticket === epoch && !closed) {
        cached = null;
        // A failed host dependency tail can still have a verified ancestor. Only retain an exact
        // previously validated prefix matching the independently recovered head and state.
        if (archive && recovery?.status === 'restored-ancestor' && same(recovery.scope, service.view().scope)) {
          const prefix = { ...archive, commits: archive.commits.filter(c => c.seq <= recovery!.head!.seq) };
          archive = same(headT4Token(prefix), recovery.head) ? prefix : null;
        } else if (!readArchive || (archive && !same(headT4Token(archive), service.headToken()))) archive = null;
        if (recovery && !['ready', 'restored-ancestor'].includes(recovery.status)) archive = null;
        error = '读取或准备检查失败；未采用缓存顶替存档，也未执行生成。检查存档、输入、提示词和 API 配置。';
      }
    } finally {
      if (ticket === epoch && !closed) {
        for (const item of logs.values())
          if (item.saved && item.commitId && recovery?.pending.some(p => p.commitId === item.commitId)) {
            item.effective = false;
            item.label = '原提交已保存，但当前剧情依赖失效';
          } else if (item.saved && item.commitId) {
            item.effective = archive?.commits.some(c => c.commitId === item.commitId) ? true : null;
          }
        while (logs.size > 64) logs.delete(logs.keys().next().value!);
        busy = false;
        emit();
      }
    }
  }
  async function dispatch(source: 'manual' | 'automatic') {
    if (closed || dispatching || restoring) return false;
    dispatching = true;
    error = null;
    emit();
    let claim: { assertCurrent(): void; finish(): void } | null = null;
    try {
      await refresh();
      // dispatching is temporarily ignored only for this entry's own permission check.
      dispatching = false;
      if (!view().canStart || (source === 'automatic' && !autoEnabled)) {
        message = '未启动：先处理准备检查中的缺项/草稿或上一轮。';
        emit();
        return false;
      }
      dispatching = true;
      const f = capture(),
        runId = options.nextRunId?.() ?? `t11-${crypto.randomUUID().replaceAll('-', '')}`;
      if (options.claimDispatch) {
        claim = options.claimDispatch(source, f.input);
        if (!claim) {
          message = '本轮已被领取；未启动重复请求，也不自动重跑失败结果。';
          return false;
        }
        claim.assertCurrent();
      }
      logs.set(runId, {
        runId,
        source,
        messageId: f.input.anchor.messageId,
        swipeId: f.input.anchor.swipeId,
        status: 'queued',
        label: '正在领取同轮触发权',
        saved: false,
        effective: null,
        commitId: null,
        sent: 0,
        cap: 0,
        error: null,
      });
      const started = await round.start(runId);
      if (started.runId !== runId) logs.delete(runId);
      dispatching = false;
      remember();
      emit();
      // Caller receives the completion, but no second scheduler or new request budget exists here.
      await started.done;
      remember();
      await refresh();
      return true;
    } catch {
      error = '本轮未能启动/完成；正式版本以存档回执为准，请查看阶段或楼层记录。';
      return false;
    } finally {
      claim?.finish();
      dispatching = false;
      if (!closed) emit();
    }
  }
  const idleForRecovery = () =>
    !closed &&
    !dispatching &&
    !restoring &&
    !active(round.view()) &&
    !service.view().busy &&
    service.view().status !== 'pending' &&
    !editing() &&
    allowed();
  function restoreGuard() {
    if (
      !restore ||
      !idleForRecovery() ||
      !same(service.headToken(), restore.head) ||
      canonicalT4Json(capture().input) !== restore.input
    )
      throw new Error('stale');
    const d = service.view().draft;
    if (d && service.view().status !== 'saved' && !same(d, restore.prepared)) throw new Error('draft');
  }
  const dispatches = new Set<Promise<boolean>>();
  const track = (task: Promise<boolean>) => {
    dispatches.add(task);
    void task.then(
      () => dispatches.delete(task),
      () => dispatches.delete(task),
    );
    return task;
  };
  const trackedDispatch = (source: 'manual' | 'automatic') => track(dispatch(source));
  return {
    view,
    refresh,
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    selectPage(value: T11Page) {
      if (!['overview', 'automatic', 'history'].includes(value)) return;
      page = value;
      emit();
    },
    navigate(destination: T11Destination) {
      options.navigate?.(destination);
    },
    hasNavigation: !!options.navigate,
    setAutomatic(enabled: boolean) {
      autoEnabled = enabled === true;
      if (!autoEnabled) {
        const current = logs.get(round.view().runId ?? '');
        if (current?.source === 'automatic' && active(round.view())) round.cancel();
      }
      message = autoEnabled
        ? '自动入口已开启；仅接收明确的本轮剧情/前置事件，不因打开页面或检查而触发。'
        : '自动入口已关闭；本实例不再领取自动任务。';
      emit();
    },
    settled: async () => {
      await Promise.all([...dispatches]);
    },
    start: () => trackedDispatch('manual'),
    trigger(event: 'assistant-completed' | 'prerequisite-changed') {
      if (!autoEnabled || !['assistant-completed', 'prerequisite-changed'].includes(event))
        return Promise.resolve(false);
      return trackedDispatch('automatic');
    },
    cancel() {
      if ((active(round.view()) || round.view().canResume) && !restoring) round.cancel();
    },
    resume() {
      return track(
        (async () => {
          if (!view().canResume) return false;
          let claim: { assertCurrent(): void; finish(): void } | undefined;
          try {
            claim = options.claimResume?.(capture().input);
            claim?.assertCurrent();
            await round.resume();
            await refresh();
            return true;
          } catch {
            error = '不能续跑；检查剩余额度、同轮暂存和基准是否仍有效。';
            emit();
            return false;
          } finally {
            claim?.finish();
          }
        })(),
      );
    },
    async queryReceipt() {
      if (!view().canQuery) return false;
      try {
        if (round.view().status === 'pending') await round.reconcile();
        else await service.reconcile();
        if (restore?.prepared && service.view().status === 'saved') restore = null;
        await refresh();
        return true;
      } catch {
        error = '保存回执仍未确认；只查询，不重新生成或覆盖。';
        emit();
        return false;
      }
    },
    async reloadFormal() {
      if (!view().canReload) return false;
      try {
        await service.reconcile();
        await refresh();
        return true;
      } catch {
        error = '重新载入未成功；未生成或保存内容。';
        emit();
        return false;
      }
    },
    selectHistory(id: string) {
      if (id !== 'genesis' && !archive?.commits.some(c => c.commitId === id)) return false;
      selectedId = id;
      emit();
      return true;
    },
    previewRestore() {
      error = null;
      try {
        if (
          !idleForRecovery() ||
          !archive ||
          selectedId === undefined ||
          !same(headT4Token(archive), service.headToken()) ||
          (service.view().draft && service.view().status !== 'saved')
        )
          throw new Error('busy');
        const f = capture();
        const sourceId = selectedId === 'genesis' ? null : selectedId;
        const target =
          sourceId === null ? archive.genesis : archive.commits.find(c => c.commitId === sourceId)!.snapshot.state;
        restore = {
          sourceId,
          head: f.live.head,
          input: canonicalT4Json(f.input),
          prepared: null,
          preview: createT4PreviewModel({
            status: 'private',
            scope: f.live.scope,
            base: maskT11State(f.live.formal, f.live.formal),
            draft: maskT11State(target, f.live.formal),
            anchor: f.input.anchor,
            kind: 'restore',
          }),
        };
        message = '恢复差异仅预览；确认才会追加新提交。所有字段（含未公开字段）恢复到选定检查点，不只恢复可见差异。';
        emit();
        return true;
      } catch {
        error = '暂时不能预览恢复：先结束运行/编辑、核对存档并选择有效检查点。';
        emit();
        return false;
      }
    },
    async confirmRestore(consent: boolean) {
      if (consent !== true || !options.restoreSpec) return false;
      error = null;
      try {
        restoreGuard();
        const selectedRestore = restore!;
        if (!selectedRestore.prepared) {
          // Read/capture may await. Check again before replacing any service draft.
          restoring = true;
          emit();
          const spec = await options.restoreSpec();
          restoring = false;
          restoreGuard();
          restoring = true;
          selectedRestore.prepared = await service.prepareRestore({
            ...spec,
            sourceCommitId: selectedRestore.sourceId,
          });
        } else restoring = true;
        restoreAbort = new AbortController();
        await service.save({
          signal: restoreAbort.signal,
          authorize: () => {
            if (
              closed ||
              !allowed() ||
              active(round.view()) ||
              !same(service.headToken(), selectedRestore.head) ||
              canonicalT4Json(capture().input) !== selectedRestore.input ||
              !same(service.view().draft, selectedRestore.prepared)
            )
              throw new Error('stale');
          },
        });
        restore = null;
        message = '恢复已确认：已追加新提交，原历史保留；没有请求 AI 或写世界书。';
        return true;
      } catch {
        error =
          service.view().status === 'pending'
            ? '恢复保存回执未知；仅查询结果，不能重试生成。'
            : '恢复没有确认保存；草稿可能保留。核对基准后可重试同一保存，不调用 AI。';
        return false;
      } finally {
        restoring = false;
        restoreAbort = null;
        const actionError = error,
          actionMessage = message;
        if (!closed) await refresh();
        if (actionError) error = actionError;
        message = actionMessage;
        emit();
      }
    },
    cancelRestore() {
      if (restoring || service.view().status === 'pending') return false;
      if (restore?.prepared && same(service.view().draft, restore.prepared) && service.view().status !== 'saved')
        service.cancelDraft();
      restore = null;
      emit();
      return true;
    },
    close() {
      closed = true;
      epoch++;
      autoEnabled = false;
      unsubscribe();
      unsubscribeService();
      unsubscribeProjection?.();
      round.cancel();
      restoreAbort?.abort();
      listeners.clear();
    },
  };
}
export type T11Controller = ReturnType<typeof createT11Controller>;
