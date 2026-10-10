/** One explicit transfer transaction against the same T4 authority. Opening the page never mutates anything. */
import { cloneT2Json, normalizeT2Template, type T2Json } from './t2-template';
import { createT2EmptyWorld } from './t2-values';
import { normalizeT9Ledger, recoverT9Ledger } from './t9-ledger';
import {
  fingerprintT4,
  normalizeT4Scope,
  normalizeT4State,
  validateT4Archive,
  type T4Archive,
  type T4Scope,
  type T4State,
} from './t4-protocol';
import { headT4Token, type T4ArchiveGateway, type T4HeadToken } from './t4-store';
import type { T4CommitService, T4Executor, T4RunSpec } from './t4-service';
import { validateT6Sqlite } from './t6-workbench';
import { planT6Migration } from './t6-migration';
import type { T10RecoveryView } from './t10-recovery';
import {
  copyT13,
  exportT13Archive,
  fenceT13,
  parseT13Text,
  readT13File,
  redactT13,
  sameT13,
  sealT13File,
  stateT13File,
  templateT13File,
  T13Error,
  type T13File,
  type T13Kind,
} from './t13-backup';
import { objectT13, kindT13Legacy, planT13Legacy } from './t13-legacy';
import type { T13Evidence } from './t13-evidence';
export type T13Path = 'legacy' | 'restore' | 'copy' | 'template' | 'audit' | 'clear';
export interface T13Report {
  path: T13Path;
  valid: boolean;
  sourceKind: string;
  sourceFingerprint: string;
  target: T4Scope;
  rows: { tableId: string; name: string; count: number }[];
  mapping: T13Evidence['mapping'];
  limitations: string[];
  issues: string[];
  redactions: number;
  status: 'preview' | 'saved' | 'already-imported' | 'audit';
}
export interface T13View {
  busy: boolean;
  closed: boolean;
  pending: boolean;
  canSave: boolean;
  hasBackup: boolean;
  consent: boolean;
  report: T13Report | null;
  error: string | null;
  message: string;
  scope: T4Scope;
  backupReady: boolean;
  privateAllowed: boolean;
  sourceAvailable: boolean;
}
export interface T13Options {
  scope: T4Scope;
  service: T4CommitService;
  store: T4ArchiveGateway;
  execute: T4Executor;
  runSpec: () => Promise<T4RunSpec>;
  canUse?: () => boolean;
  readRecovery?: () => Promise<T10RecoveryView>;
  canBackupPrivate: () => boolean;
  readSecrets?: () => readonly string[];
  /** Trusted, explicitly invoked read-only adapter. Never live legacy store's mutating initializer. */
  readLegacy?: () => Promise<unknown>;
  afterSaved?: () => void;
}
interface Plan {
  base: T4HeadToken;
  candidate: T4State;
  evidence: T13Evidence;
  preparedId: string | null;
  generation: number;
}
const errorMessages: Record<T13Error['code'], string> = {
  FORMAT: '格式、版本、身份或字段不符合要求；未保存。',
  SIZE: '文件或数据超过安全上限；未截断或保存。',
  INTEGRITY: '内容或历史指纹损坏；请保留原件并检查备份来源。',
  SECRET: '材料含凭据或受保护密钥；请先清理凭据，不会破坏签封历史来强行导出。',
  PRIVATE: '完整备份或导入涉及非公开资料；缺少本地授权或明确确认。',
  CONFLICT: '已有资料、重复身份或锁定内容冲突；不会自动覆盖。',
  REFERENCE: '关联不存在或不能唯一确认；可明确选择仅保留原文，否则停止。',
  STALE: '源、当前世界或草稿已变化；请重新预览并备份。',
  CONFIRM: '请先备份当前版本并确认影响范围。',
  BUSY: '其他草稿或运行正在占用世界；请先完成或取消。',
  PENDING: '保存结果未知；只允许查询确认，不重复执行。',
  CLOSED: '向导已关闭。',
  TARGET: '来源或目标世界不匹配；不能沿用外部聊天的活跃身份。',
  READ: '读取或宿主持久能力未确认；不切换权威。',
  SOURCE: '未找到可识别的旧存档；不会自动创建旧库。',
};
/** Avoid using imported new permissions to unlock/write old protected data. */
function protect(base: T4State, next: T4State): void {
  for (const table of base.template.tables) {
    const replacement = next.template.tables.find(t => t.id === table.id);
    if ((!table.visibility.user || table.locked) && !sameT13(table, replacement ?? null))
      throw new T13Error('CONFLICT');
    for (const field of table.fields)
      if (!field.visibility.user && !sameT13(field, replacement?.fields.find(f => f.id === field.id) ?? null))
        throw new T13Error('CONFLICT');
    for (const row of base.data.tables[table.id]) {
      const other = next.data.tables[table.id]?.find(r => r.meta.id === row.meta.id);
      if (sameT13(row, other ?? null)) continue;
      if (
        !table.visibility.user ||
        table.locked ||
        row.meta.locked ||
        !row.meta.visibility.user ||
        (!other && !table.permissions.manual.delete) ||
        (other && !table.permissions.manual.update)
      )
        throw new T13Error('CONFLICT');
      for (const field of table.fields)
        if (
          !sameT13(
            { present: Object.hasOwn(row.values, field.id), value: row.values[field.id] ?? null },
            { present: other ? Object.hasOwn(other.values, field.id) : false, value: other?.values[field.id] ?? null },
          ) &&
          (!field.visibility.user ||
            (!!other && (field.readonly || !field.permissions.manualWrite)) ||
            row.meta.lockedFieldIds.includes(field.id))
        )
          throw new T13Error('CONFLICT');
      if (
        other &&
        (!sameT13(row.meta.lockedFieldIds, other.meta.lockedFieldIds) ||
          !sameT13(row.meta.visibility, other.meta.visibility))
      )
        throw new T13Error('CONFLICT');
    }
    if (
      !table.permissions.manual.insert &&
      (next.data.tables[table.id] ?? []).some(r => !base.data.tables[table.id].some(o => o.meta.id === r.meta.id))
    )
      throw new T13Error('CONFLICT');
  }
}
export function createT13Controller(options: T13Options) {
  const scope = normalizeT4Scope(copyT13(options.scope)),
    service = options.service;
  let busy = false,
    closed = false,
    consent = false,
    generation = 0,
    error: string | null = null,
    message = '',
    report: T13Report | null = null,
    plan: Plan | null = null;
  let backup: { head: T4HeadToken; file: T13File; acknowledged: boolean } | null = null,
    exported: T13File | null = null;
  const listeners = new Set<() => void>();
  const secrets = () => [...(options.readSecrets?.() ?? [])];
  const allowed = () => !closed && (options.canUse?.() ?? scope.mode === 't4-sandbox');
  const notify = () => {
    for (const listener of listeners) listener();
  };
  const freshBackup = () => !!backup?.acknowledged && sameT13(backup.head, service.headToken());
  const ownsDraft = () => !!plan?.preparedId && plan.preparedId === service.view().draft?.commit?.commitId;
  const guard = () => {
    if (closed) throw new T13Error('CLOSED');
    if (!allowed() || !sameT13(service.view().scope, scope)) throw new T13Error('READ');
    const view = service.view();
    if (view.status === 'pending') throw new T13Error('PENDING');
    if (view.busy || view.status === 'saving' || (view.draft && view.status !== 'saved' && !ownsDraft()))
      throw new T13Error('BUSY');
  };
  const source = async () => {
    guard();
    const archive = await validateT4Archive(await options.store.read(scope));
    guard();
    if (!sameT13(archive.scope, scope) || !sameT13(headT4Token(archive), service.headToken()))
      throw new T13Error('STALE');
    if (scope.mode === 't10-host') {
      const recovery = await options.readRecovery?.();
      guard();
      if (
        !recovery ||
        !recovery.writable ||
        recovery.status !== 'ready' ||
        recovery.source === 'unverified-host' ||
        !sameT13(recovery.scope, scope) ||
        !sameT13(recovery.head, service.headToken())
      )
        throw new T13Error('READ');
    }
    guard();
    if (!sameT13(headT4Token(archive), service.headToken())) throw new T13Error('STALE');
    fenceT13(archive, secrets());
    return archive;
  };
  const invalidate = () => {
    generation++;
    consent = false;
    if (ownsDraft() && service.view().status !== 'pending' && !service.view().busy) service.cancelDraft();
    plan = null;
    report = null;
  };
  const attempt = async <T>(fn: () => Promise<T>): Promise<T | null> => {
    if (busy) {
      error = errorMessages.BUSY;
      notify();
      return null;
    }
    busy = true;
    error = null;
    notify();
    try {
      return await fn();
    } catch (e) {
      error = e instanceof T13Error ? errorMessages[e.code] : '校验或保存未完成；保持原世界，先查询保存结果。';
      return null;
    } finally {
      busy = false;
      notify();
    }
  };
  const view = (): T13View =>
    redactT13(
      {
        busy,
        closed,
        pending: service.view().status === 'pending',
        canSave:
          !busy &&
          !closed &&
          allowed() &&
          consent &&
          freshBackup() &&
          !!plan &&
          !!report?.valid &&
          !service.view().busy &&
          (service.view().draft === null || service.view().status === 'saved' || ownsDraft()) &&
          sameT13(plan.base, service.headToken()) &&
          service.view().status !== 'pending',
        hasBackup: freshBackup(),
        consent,
        report,
        error,
        message,
        scope,
        backupReady: !!backup && sameT13(backup.head, service.headToken()),
        privateAllowed: options.canBackupPrivate(),
        sourceAvailable: !!options.readLegacy,
      },
      secrets(),
    ).value as unknown as T13View;
  const unsubscribe = service.subscribe(() => {
    if (plan && !sameT13(plan.base, service.headToken()) && service.view().status !== 'saved') consent = false;
    notify();
  });
  const preview = async (input: unknown, path: T13Path, settings: { replace: boolean; keepUnresolved: boolean }) => {
    guard();
    invalidate();
    const own = generation;
    const frozen = cloneT2Json(input),
      archive = await source(),
      base = service.view().formal,
      head = service.headToken();
    let candidate: T4State, evidence: T13Evidence, sourceKind: string;
    if (path === 'legacy') {
      let raw = frozen,
        legacyFile: T13File | null = null;
      if (objectT13(frozen).format === 'world-evolution-transfer') {
        legacyFile = await readT13File(frozen, secrets());
        if (legacyFile.kind !== 'legacy') throw new T13Error('FORMAT');
        raw = objectT13(legacyFile.payload).material;
      }
      const legacy = await planT13Legacy(raw, base, settings.keepUnresolved, secrets());
      candidate = legacy.state;
      evidence = legacy.evidence;
      if (legacyFile) {
        evidence.sourceFingerprint = String(objectT13(legacyFile.payload).sourceFingerprint);
        evidence.redactions += Number(objectT13(legacyFile.payload).redactions);
        evidence.material = legacyFile as unknown as T2Json;
        evidence.materialFingerprint = await fingerprintT4(legacyFile);
        evidence.limitations.push('来自凭据脱敏的旧材料备份；原始摘要是审计声明，不是身份授权或原件签名。');
      }
      sourceKind = evidence.sourceKind;
    } else {
      const file = await readT13File(frozen, secrets());
      sourceKind = file.kind;
      if (path === 'audit') {
        if (file.kind !== 'history' && file.kind !== 'world') throw new T13Error('FORMAT');
        report = {
          path,
          valid: true,
          sourceKind,
          sourceFingerprint: file.fingerprint,
          target: scope,
          rows: [],
          mapping: [],
          limitations: ['完整旧历史已验证；此入口只读，不执行其中 SQL、不恢复资料或续发请求。'],
          issues: [],
          redactions: 0,
          status: 'audit',
        };
        message = '历史审计校验完成；没有写入。';
        return;
      }
      if (path === 'template') {
        const template = templateT13File(file);
        template.id = base.template.id;
        const migrated = planT6Migration(base, template, { mappings: [], allowRemoval: settings.replace });
        if (!migrated.state) throw new T13Error('CONFLICT');
        candidate = migrated.state;
        evidence = {
          version: 1,
          action: 'template',
          sourceKind: 'template',
          sourceFingerprint: file.fingerprint,
          material: file as unknown as T2Json,
          materialFingerprint: await fingerprintT4(file),
          redactions: 0,
          mapping: [],
          limitations: ['只导入模板；已有资料按 T6 规则预检，缺失/类型变化不会自动猜值。'],
        };
      } else {
        const loaded = await stateT13File(file);
        candidate = loaded.state;
        const originalScope = loaded.archive?.scope ?? normalizeT4Scope(objectT13(file.payload).scope);
        if (path === 'copy') {
          if (originalScope.worldId === scope.worldId) throw new T13Error('TARGET');
        } else if (path === 'restore') {
          if (!sameT13(originalScope, scope)) throw new T13Error('TARGET');
        } else throw new T13Error('FORMAT');
        const ledger = loaded.archive ? recoverT9Ledger(loaded.archive) : objectT13(file.payload).ledger;
        candidate.template.id = base.template.id;
        candidate.template.templateVersion = base.template.templateVersion + 1;
        candidate.data = {
          ...candidate.data,
          worldId: scope.worldId,
          branchId: scope.branchId,
          revision: base.data.revision,
          templateId: candidate.template.id,
          templateVersion: candidate.template.templateVersion,
        };
        for (const rows of Object.values(candidate.data.tables))
          for (const row of rows) {
            row.meta.createdAtRevision = base.data.revision;
            row.meta.updatedAtRevision = base.data.revision;
          }
        candidate = normalizeT4State(candidate);
        evidence = {
          version: 1,
          action: 'snapshot',
          sourceKind: file.kind as 'world' | 'data',
          sourceFingerprint: file.fingerprint,
          material: file as unknown as T2Json,
          materialFingerprint: await fingerprintT4(file),
          redactions: 0,
          mapping: [],
          limitations: [
            '只把已验证的当前检查点追加到目标世界；来源历史独立保存在审计材料中，不继承外部活跃锚点、队列或世界书 UID。',
            '世界书状态不会从备份直接设为已同步；保存后需重新检查/同步投影。API 路由引用不含凭据，不可用时停止。',
          ],
          ledger: ledger === null ? null : normalizeT9Ledger(ledger, candidate),
        };
      }
    }
    fenceT13(evidence, secrets());
    guard();
    if (own !== generation) throw new T13Error('STALE');
    const imported = archive.commits.find(
      c => c.transfer?.action === evidence.action && c.transfer.sourceFingerprint === evidence.sourceFingerprint,
    );
    if (imported && (path === 'legacy' || path === 'copy')) {
      report = {
        path,
        valid: false,
        sourceKind,
        sourceFingerprint: evidence.sourceFingerprint,
        target: scope,
        rows: [],
        mapping: [],
        limitations: ['该来源已迁移；重复请求不新增版本，也不覆盖迁移后的人工修改。需要恢复时请使用楼层历史恢复。'],
        issues: [],
        redactions: evidence.redactions,
        status: 'already-imported',
      };
      message = '该备份已在当前分支处理过；未再次导入。';
      return;
    }
    if (path !== 'template' && !settings.replace && Object.values(base.data.tables).some(rows => rows.length))
      throw new T13Error('CONFLICT');
    protect(base, candidate);
    await validateT6Sqlite(candidate, options.execute);
    guard();
    if (own !== generation || !sameT13(head, service.headToken())) throw new T13Error('STALE');
    plan = {
      base: head,
      candidate: copyT13(candidate),
      evidence: copyT13(evidence),
      preparedId: null,
      generation: own,
    };
    report = {
      path,
      valid: true,
      sourceKind,
      sourceFingerprint: evidence.sourceFingerprint,
      target: scope,
      rows: candidate.template.tables
        .filter(t => t.visibility.user)
        .map(t => ({
          tableId: t.id,
          name: t.name,
          count: candidate.data.tables[t.id].filter(r => r.meta.visibility.user).length,
        })),
      mapping: evidence.mapping,
      limitations: evidence.limitations,
      issues: [],
      redactions: evidence.redactions,
      status: 'preview',
    };
    message = '预检完成，仍是草稿；备份当前版本并确认后才保存。';
  };
  return {
    isBusy: () => busy,
    view,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    consent(value: boolean) {
      consent = value;
      notify();
    },
    acknowledgeBackup(value: boolean) {
      if (backup && sameT13(backup.head, service.headToken())) backup.acknowledged = value;
      notify();
    },
    async backup(kind: Exclude<T13Kind, 'legacy'>, includePrivate: boolean) {
      return attempt(async () => {
        const archive = await source(),
          head = headT4Token(archive);
        const file = await exportT13Archive(archive, kind, options.canBackupPrivate(), includePrivate, secrets());
        guard();
        if (!sameT13(head, service.headToken())) throw new T13Error('STALE');
        if (!options.canBackupPrivate()) throw new T13Error('PRIVATE');
        fenceT13(file, secrets());
        exported = copyT13(file);
        if (kind === 'world') backup = { head, file: copyT13(file), acknowledged: false };
        message = '备份已在内存生成；请导出并在外部保存文件。关闭页面前未导出的备份会丢失。';
        return copyT13(file);
      });
    },
    getExport() {
      if (!options.canBackupPrivate()) throw new T13Error('PRIVATE');
      if (!exported) throw new T13Error('SOURCE');
      fenceT13(exported, secrets());
      return copyT13(exported);
    },
    async previewText(text: string, path: Exclude<T13Path, 'clear'>, replace = false, keepUnresolved = false) {
      return attempt(async () => {
        try {
          await preview(parseT13Text(text), path, { replace, keepUnresolved });
        } catch (e) {
          if (service.view().status !== 'pending') {
            report = {
              path,
              valid: false,
              sourceKind: '未通过预检',
              sourceFingerprint: '',
              target: scope,
              rows: [],
              mapping: [],
              limitations: [],
              issues: [e instanceof T13Error ? errorMessages[e.code] : '结构、类型或完整存档校验失败；未截断或保存。'],
              redactions: 0,
              status: 'preview',
            };
          }
          throw e;
        }
      });
    },
    async readOldSource() {
      return attempt(async () => {
        if (!options.readLegacy) throw new T13Error('SOURCE');
        const raw = copyT13(await options.readLegacy());
        await preview(raw, 'legacy', { replace: false, keepUnresolved: false });
        return;
      });
    },
    async exportLegacyOriginal(text: string, includePrivate: boolean) {
      return attempt(async () => {
        guard();
        if (!options.canBackupPrivate() || !includePrivate) throw new T13Error('PRIVATE');
        const raw = parseT13Text(text);
        kindT13Legacy(raw);
        const clean = redactT13(raw, secrets());
        exported = await sealT13File(
          'legacy',
          {
            sourceFingerprint: await fingerprintT4(raw),
            material: clean.value,
            redactions: clean.redactions,
          },
          secrets(),
        );
        guard();
        if (!options.canBackupPrivate()) {
          exported = null;
          throw new T13Error('PRIVATE');
        }
        fenceT13(exported, secrets());
        message = '旧材料备份已生成；除凭据外保留原始数据、未知字段和历史。原来源未修改。';
        return copyT13(exported);
      });
    },
    async previewClear() {
      return attempt(async () => {
        guard();
        invalidate();
        const archive = await source(),
          base = service.view().formal;
        const own = generation;
        if (!freshBackup()) throw new T13Error('CONFIRM');
        const template = copyT13(base.template);
        template.templateVersion++;
        const data = createT2EmptyWorld(template, scope.worldId, scope.branchId);
        data.revision = base.data.revision;
        const candidate = normalizeT4State({ template, data });
        protect(base, candidate);
        await validateT6Sqlite(candidate, options.execute);
        guard();
        if (own !== generation || !sameT13(headT4Token(archive), service.headToken())) throw new T13Error('STALE');
        plan = {
          base: headT4Token(archive),
          candidate,
          evidence: {
            version: 1,
            action: 'clear',
            sourceKind: 'clear',
            sourceFingerprint: await fingerprintT4({ head: headT4Token(archive), action: 'clear' }),
            material: { backupFingerprint: backup!.file.fingerprint },
            materialFingerprint: await fingerprintT4({ backupFingerprint: backup!.file.fingerprint }),
            mapping: [],
            redactions: 0,
            ledger: null,
            limitations: [
              '只清空当前世界/分支的业务行与演变进度；保留模板、历史、剧情、旧库、MVU 与其他插件资料。',
              '清空是一个新版本；刷新以空版本为权威，不从旧缓存或旧库自动补种。历史恢复仍可由用户明确选择。',
              '本步骤不写世界书；旧投影必须单独检查/清理，不会声称主 AI 已不再使用旧条目。',
            ],
          },
          preparedId: null,
          generation,
        };
        report = {
          path: 'clear',
          valid: true,
          sourceKind: 'clear',
          sourceFingerprint: plan.evidence.sourceFingerprint,
          target: scope,
          rows: [],
          mapping: [],
          limitations: plan.evidence.limitations,
          issues: [],
          redactions: 0,
          status: 'preview',
        };
        message = '清空范围已预览；再次确认后追加一个空版本，不删除剧情或旧来源。';
      });
    },
    async save() {
      return attempt(async () => {
        guard();
        const current = plan;
        if (!current || !consent || !freshBackup()) throw new T13Error('CONFIRM');
        if (!sameT13(current.base, service.headToken())) throw new T13Error('STALE');
        await source();
        fenceT13(current.evidence, secrets());
        if (!current.preparedId) {
          const spec = copyT13(await options.runSpec());
          guard();
          if (current !== plan || current.generation !== generation || !consent) throw new T13Error('STALE');
          const prepared = await service.prepareMigration({
            ...spec,
            state: current.candidate,
            transfer: current.evidence,
          });
          if (!prepared.commit) throw new T13Error('TARGET');
          current.preparedId = prepared.commit.commitId;
        }
        const authorized = () => {
          if (
            closed ||
            !allowed() ||
            current !== plan ||
            current.generation !== generation ||
            !consent ||
            !freshBackup() ||
            !sameT13(current.base, service.headToken())
          )
            throw new T13Error('STALE');
          fenceT13(current.evidence, secrets());
        };
        await service.save({ authorize: authorized });
        if (service.view().status !== 'saved') throw new T13Error('PENDING');
        report!.status = 'saved';
        plan = null;
        consent = false;
        message = '当前目标世界已独立读回确认；旧来源保留，世界书仍须单独同步。';
        try {
          options.afterSaved?.();
        } catch {
          /* Consumer callback cannot undo durable save. */
        }
      });
    },
    async query() {
      return attempt(async () => {
        if (closed) throw new T13Error('CLOSED');
        if (!allowed()) throw new T13Error('READ');
        if (!ownsDraft()) throw new T13Error('BUSY');
        const result = await service.reconcile();
        if (result.status === 'saved') {
          if (report) report.status = 'saved';
          plan = null;
          consent = false;
          message = '查询已确认保存成功；没有重新执行 SQL、迁移或 API。';
          try {
            options.afterSaved?.();
          } catch {
            /* confirmed */
          }
        } else message = '尚未确认保存；保留草稿和旧来源。';
      });
    },
    cancel() {
      if (busy || service.view().status === 'pending') return;
      invalidate();
      error = null;
      message = '已取消私有草稿；正式世界与旧来源未改变。';
      notify();
    },
    close() {
      closed = true;
      consent = false;
      generation++;
      unsubscribe();
      listeners.clear();
      if (ownsDraft() && !service.view().busy && service.view().status !== 'pending') service.cancelDraft();
      plan = null;
      exported = null;
      backup = null;
    },
  };
}
export type T13Controller = ReturnType<typeof createT13Controller>;
