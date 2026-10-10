/** T12 explicit preview/check/sync/capture service. Writes only an injected guarded worldbook port. */
import { validateT4Archive, fingerprintT4, type T4Scope } from './t4-protocol';
import { headT4Token, type T4ArchiveGateway } from './t4-store';
import type { T4CommitService } from './t4-service';
import type { T10RecoveryView } from './t10-recovery';
import {
  buildT12Projection,
  T12Error,
  copyT12,
  sameT12,
  type T12Binding,
  type T12Built,
  type T12Code,
  type T12PublicEntry,
} from './t12-projection';
import {
  canWriteT12,
  canSynchronizeT12Compatibility,
  confirmedT12Book,
  diffT12Book,
  assertT12NoAmbiguousActive,
  type T12Driver,
  type T12Diff,
  type T12BookEntry,
  type T12Guard,
} from './t12-gateway';
export interface T12Options {
  scope: T4Scope;
  service: T4CommitService;
  store: T4ArchiveGateway;
  driver: T12Driver;
  readRecovery?: () => Promise<T10RecoveryView>;
  canUse?: () => boolean;
  /** Optional trusted API vault redaction fence; never shown, logged or persisted. */
  readSecrets?: () => readonly string[];
  navigateTemplate?: () => void;
}
export type T12Status = 'unchecked' | 'pending' | 'synced' | 'failed' | 'blocked' | 'stale';
export interface T12View {
  status: T12Status;
  busy: boolean;
  error: string | null;
  message: string;
  source: string;
  target: string | null;
  worldId: string;
  branchId: string;
  commitId: string | null;
  revision: number | null;
  generationId: string | null;
  isolation: string;
  evidence: string[];
  canSync: boolean;
  canRetry: boolean;
  canQuery: boolean;
  canConfigure: boolean;
  preview: T12PublicEntry[];
  tables: T12Built['tables'];
  diff: { kind: T12Diff['kind']; uid: number | null; name: string; reason: string }[];
  counts: { create: number; update: number; delete: number; deactivate: number; keep: number };
}
const messages: Record<T12Code, string> = {
  SOURCE: '当前存档无法证明是有效、已确认的正式版本。请先到楼层记录/恢复页核对。',
  TARGET: '没有匹配的当前角色卡主世界书；不会改用聊天书、附加书或新建一本书。',
  ISOLATION:
    '不能证明主 AI 捕获期间的世界隔离，或存在启用中的旧版/未确认归属 WorldEvolution 条目。保持预览，禁止写入。',
  PERMISSION: '当前权限已撤销，或投影包含受保护的凭据内容。',
  CONTENT: '导出资料含模板代码或宏执行标记；请改为普通资料文本，未让宿主执行这些内容。',
  STALE: '世界、分支、角色卡、源提交或目标书已变化；旧任务已过期，请重新检查。',
  SIZE: '导出正文/标题/关键词或整批大小超过限制；请在表级导出参数中调整，未截断或写入半份资料。',
  KEYS: '逐行导出没有可公开的非空关键词；请配置允许主 AI 读取的关键词字段，或明确改为常驻模式。',
  INTEGRITY: '投影或托管标记不完整，不能安全确认归属；未按名称猜测删除。',
  CONFLICT: '世界书已被另一项操作修改；请重新检查实时差异，未覆盖它。',
  READ: '独立读取失败；缓存账本不能冒充已同步，请稍后仅查询。',
  WRITE: '投影保存失败；世界数据仍保留，不会重新演变或重复提交。',
  PENDING: '投影尚未完整确认，主 AI 投影捕获保持阻断；先仅查询结果，再决定是否仅重试投影。',
  CONFIRM: '请先检查差异并确认只修改本插件的托管范围。',
  CLOSED: '投影服务已关闭；没有继续写入。',
};
export function createT12Controller(options: T12Options) {
  return controllerT12(options, false);
}
export function createT12CompatibilityController(options: T12Options) {
  return controllerT12(options, true);
}
function controllerT12(options: T12Options, compatibility: boolean) {
  const canSync = () =>
    compatibility ? canSynchronizeT12Compatibility(options.driver) : canWriteT12(options.driver.capabilities);
  let status: T12Status = 'unchecked',
    busy = false,
    closed = false,
    error: string | null = null,
    message = '';
  let prepared: T12Built | null = null,
    bookFingerprint: string | null = null;
  let bindingValid = true;
  let target: T12Binding | null = null,
    diff: T12Diff[] = [],
    activeAbort: AbortController | null = null;
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const fn of listeners) {
      try {
        fn();
      } catch {
        /* View listeners are not authority. */
      }
    }
  };
  const localCheck = () => {
    if (closed) throw new T12Error('CLOSED');
    if (options.canUse && !options.canUse()) throw new T12Error('PERMISSION');
    const live = options.service.view();
    if (!sameT12(live.scope, options.scope) || live.status === 'pending' || live.status === 'saving')
      throw new T12Error('SOURCE');
  };
  const current = () => {
    if (!prepared || !bindingValid) return false;
    try {
      localCheck();
      if (options.readSecrets?.().some(s => s.length && JSON.stringify(prepared).includes(s))) return false;
      return sameT12(options.service.headToken(), prepared.generation.head);
    } catch {
      return false;
    }
  };
  const view = (): T12View => {
    const actualStatus = prepared && !current() ? 'stale' : status;
    const permitted =
      canSync() && current() && !!bookFingerprint && !busy && !['blocked', 'stale'].includes(actualStatus);
    const publicByKey = new Map(prepared?.preview.map(e => [e.key, e]) ?? []);
    const counts = { create: 0, update: 0, delete: 0, deactivate: 0, keep: 0 };
    for (const d of diff) counts[d.kind]++;
    const result: T12View = copyT12({
      status: actualStatus,
      busy,
      error,
      message,
      source:
        options.driver.capabilities.environment === 'simulated'
          ? '模拟世界书（不写酒馆）'
          : options.driver.capabilities.environment === 'compatibility-host'
            ? '单活动页面兼容宿主（非原子保存）'
            : options.driver.capabilities.environment === 'verified-host'
              ? '指定范围已验证宿主'
              : '未验证宿主（只读阻断）',
      target: target?.primaryBook ?? null,
      worldId: options.scope.worldId,
      branchId: options.scope.branchId,
      commitId: prepared?.generation.head.commitId ?? null,
      revision: prepared?.generation.head.revision ?? null,
      generationId: prepared?.generation.fingerprint ?? null,
      isolation: compatibility
        ? '单活动页面、串行同步；没有主 AI 捕获锁。同步期间不要生成剧情；不支持多标签页协同。'
        : canWriteT12(options.driver.capabilities)
          ? '单活代际；同一共享边界覆盖写入与主 AI 上下文捕获。首版不支持多设备协同。'
          : '隔离/持久确认/源版本互斥未验证；预览不代表已可供主 AI 使用。',
      evidence: options.driver.capabilities.evidence,
      canSync: permitted,
      canRetry: permitted && ['failed', 'pending'].includes(actualStatus),
      canQuery: !!prepared && !busy && current(),
      canConfigure: !!options.navigateTemplate,
      preview: prepared?.preview ?? [],
      tables: prepared?.tables ?? [],
      counts,
      diff: diff.map(d => ({
        kind: d.kind,
        uid: d.uid,
        name: d.key ? (publicByKey.get(d.key)?.name ?? '受限制或已移除的托管条目') : '其他世界的本插件条目',
        reason: d.reason,
      })),
    });
    const secrets = options.readSecrets?.().filter(s => s.length) ?? [];
    const redact = (value: unknown): unknown =>
      typeof value === 'string'
        ? secrets.reduce((v, s) => v.replaceAll(s, '[凭据已隐藏]'), value)
        : Array.isArray(value)
          ? value.map(redact)
          : value && typeof value === 'object'
            ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redact(v)]))
            : value;
    return redact(result) as T12View;
  };
  const failure = (cause: unknown) => {
    const code = cause instanceof T12Error ? cause.code : 'READ';
    status = ['TARGET', 'SOURCE', 'ISOLATION', 'INTEGRITY', 'PERMISSION', 'CONTENT', 'SIZE', 'KEYS'].includes(code)
      ? 'blocked'
      : code === 'STALE' || code === 'CLOSED'
        ? 'stale'
        : code === 'PENDING' || code === 'CONFLICT'
          ? 'pending'
          : 'failed';
    error = messages[code];
    message = '世界存档未改变；没有调用演变 API，也没有重复提交。';
  };
  async function source(expected?: T12Built) {
    localCheck();
    const binding = await options.driver.current();
    if (expected && !sameT12(binding, expected.generation.binding)) throw new T12Error('STALE');
    target = copyT12(binding);
    let archive;
    try {
      archive = await validateT4Archive(await options.store.read(options.scope));
    } catch {
      throw new T12Error('SOURCE');
    }
    if (!sameT12(archive.scope, options.scope) || !sameT12(headT4Token(archive), options.service.headToken()))
      throw new T12Error('SOURCE');
    if (options.scope.mode === 't10-host') {
      const recovery = await options.readRecovery?.();
      if (
        !recovery ||
        recovery.source === 'unverified-host' ||
        recovery.status !== 'ready' ||
        recovery.binding?.characterId !== binding.characterId ||
        !sameT12(recovery.scope, options.scope) ||
        !sameT12(recovery.head, headT4Token(archive))
      )
        throw new T12Error('SOURCE');
    }
    localCheck();
    const built = await buildT12Projection(archive, binding);
    const strings = JSON.stringify(built);
    if (options.readSecrets?.().some(secret => secret.length && strings.includes(secret)))
      throw new T12Error('PERMISSION');
    if (expected && !sameT12(expected.generation, built.generation)) throw new T12Error('STALE');
    if (
      !sameT12(binding, await options.driver.current()) ||
      !sameT12(options.service.headToken(), built.generation.head)
    )
      throw new T12Error('STALE');
    return built;
  }
  const guard = (built: T12Built): T12Guard => ({
    authorize: async () => {
      await source(built);
    },
    assertCurrent: () => {
      localCheck();
      if (!sameT12(options.service.headToken(), built.generation.head)) throw new T12Error('STALE');
    },
    signal: activeAbort?.signal,
  });
  async function readback(built: T12Built) {
    const book = await options.driver.read(built.generation.binding.primaryBook!);
    diff = await diffT12Book(built.generation, book);
    bookFingerprint = await fingerprintT4(book);
    assertT12NoAmbiguousActive(book);
    const confirmed = await confirmedT12Book(built.generation, book);
    await source(built);
    if (
      !canSync() &&
      !(
        compatibility &&
        options.driver.capabilities.environment === 'compatibility-host' &&
        options.driver.capabilities.durableRead &&
        options.driver.capabilities.consistency === 'optimistic-single-page'
      )
    )
      throw new T12Error('ISOLATION'); // Unknown writes may still be queried; never automatically re-authorized.
    status = confirmed ? 'synced' : 'pending';
    error = null;
    message = confirmed
      ? compatibility
        ? '已独立读回完整投影；由角色卡世界书常规触发。没有主 AI 捕获锁，同步期间勿生成剧情。'
        : '已从独立读回确认同一完整代际。主 AI 仍须走已验证的捕获入口。'
      : '已检查实时差异；尚未同步。预览和检查不会写世界书。';
  }
  async function task(job: () => Promise<void>) {
    if (busy || closed) return view();
    busy = true;
    error = null;
    activeAbort = new AbortController();
    notify();
    try {
      await job();
    } catch (e) {
      failure(e);
    } finally {
      busy = false;
      activeAbort = null;
      notify();
    }
    return view();
  }
  const unsubscribe = options.service.subscribe(() => {
    notify();
  });
  const unsubscribeDriver = options.driver.subscribe?.(event => {
    if (closed) return;
    if (event === 'binding') {
      bindingValid = false;
      status = 'stale';
      error = messages.STALE;
    } else if (!busy && prepared) {
      status = 'pending';
      message = '世界书发生变化，请重新检查实时差异。';
    }
    notify();
  });
  return {
    isBusy: () => busy,
    view,
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    inspect: () =>
      task(async () => {
        prepared = null;
        diff = [];
        bookFingerprint = null;
        const built = await source();
        prepared = built;
        bindingValid = true;
        await readback(built);
      }),
    query: () =>
      task(async () => {
        if (!prepared) throw new T12Error('CONFIRM');
        await source(prepared);
        await readback(prepared);
      }),
    sync: (confirmed: boolean, operation: 'sync' | 'repair' | 'rebuild' = 'sync') =>
      task(async () => {
        if (!confirmed || !prepared || !bookFingerprint) throw new T12Error('CONFIRM');
        if (!canSync() || status === 'blocked') throw new T12Error('ISOLATION');
        const built = prepared;
        await source(built);
        await options.driver.synchronize({
          generation: copyT12(built.generation),
          expectedBookFingerprint: bookFingerprint,
          operation,
          ...guard(built),
        });
        await readback(built);
        if ((status as T12Status) !== 'synced') throw new T12Error('PENDING');
      }),
    /** Retry the already-bound source only. A stale old task never adopts a newly selected target. */
    retry: (confirmed: boolean) =>
      task(async () => {
        if (!confirmed || !prepared) throw new T12Error('CONFIRM');
        if (!canSync()) throw new T12Error('ISOLATION');
        const built = prepared;
        await source(built);
        await readback(built);
        if (status === 'synced') return;
        await options.driver.synchronize({
          generation: copyT12(built.generation),
          expectedBookFingerprint: bookFingerprint!,
          operation: 'repair',
          ...guard(built),
        });
        await readback(built);
        if ((status as T12Status) !== 'synced') throw new T12Error('PENDING');
      }),
    async capture<T>(consume: (entries: T12BookEntry[]) => Promise<T>): Promise<T> {
      localCheck();
      if (!canWriteT12(options.driver.capabilities)) throw new T12Error('ISOLATION');
      const built = await source();
      try {
        return await options.driver.capture({ generation: built.generation, ...guard(built) }, consume);
      } catch (e) {
        failure(e);
        notify();
        throw e instanceof T12Error ? e : new T12Error('READ');
      }
    },
    summary() {
      const v = view();
      return {
        status:
          v.status === 'synced'
            ? ('synced' as const)
            : v.status === 'failed'
              ? ('failed' as const)
              : v.status === 'unchecked' || v.status === 'blocked'
                ? ('unavailable' as const)
                : ('pending' as const),
        detail: v.error ?? v.message ?? '世界书尚未检查。',
      };
    },
    configure: () => options.navigateTemplate?.(),
    close() {
      closed = true;
      activeAbort?.abort();
      unsubscribe();
      unsubscribeDriver?.();
      notify();
      listeners.clear();
    },
  };
}
export type T12Controller = ReturnType<typeof createT12Controller>;
