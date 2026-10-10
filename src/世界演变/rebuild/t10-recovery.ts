/** Query-only recovery. Invalid tails are quarantined, never rewritten or regenerated. */
import { createT4Archive, fingerprintT4, type T4Archive, type T4Scope, type T4State } from './t4-protocol';
import { reconcileT4Cache } from './t4-service';
import { headT4Token, type T4HeadToken } from './t4-store';
import { canWriteT10, canWriteT10Compatibility, type T10Driver } from './t10-host-gateway';
import {
  T10Error,
  T10_NAMESPACE,
  captureT10Anchor,
  copyT10,
  frameT10Envelope,
  initializeT10Document,
  normalizeT10Document,
  sameT10,
  validT10Dependencies,
  validateT10Envelope,
  validateT10RunRecord,
  type T10Binding,
  type T10Dependency,
  type T10Document,
  type T10Envelope,
} from './t10-host-protocol';
import { recoverT9Ledger, type T9Ledger } from './t9-ledger';
export interface T10RecoveryView {
  source: T10Driver['capabilities']['environment'];
  status: 'empty' | 'ready' | 'restored-ancestor' | 'damaged' | 'identity-mismatch' | 'read-failed';
  writable: boolean;
  binding: T10Binding | null;
  scope: T4Scope | null;
  head: T4HeadToken | null;
  state: T4State | null;
  evolution: T9Ledger | null;
  pending: { commitId: string; seq: number; reason: 'dependency' | 'integrity' }[];
  runs: {
    runId: string;
    status: 'committed' | 'interrupted' | 'stale' | 'abandoned';
    sent: number;
    maxRequests: number;
  }[];
  cache: 'absent' | 'match' | 'discarded';
  bytes: number;
  notices: string[];
}
export async function recoverT10Document(
  input: unknown,
  source: T10RecoveryView['source'],
  candidateCache?: unknown,
): Promise<T10RecoveryView> {
  const view: T10RecoveryView = {
    source,
    status: 'damaged',
    writable: false,
    binding: null,
    scope: null,
    head: null,
    state: null,
    evolution: null,
    pending: [],
    runs: [],
    cache: 'absent',
    bytes: 0,
    notices: [
      '恢复只读取已保存 JSON，不调用 AI，不自动续发，不写世界书。',
      '跨刷新不恢复未保存的宏观/微观暂存或编辑草稿；未完成请求可能已收费。',
    ],
  };
  let doc: T10Document, frame: T10Envelope;
  try {
    doc = normalizeT10Document(input);
    view.binding = doc.binding;
    view.bytes = new TextEncoder().encode(JSON.stringify(doc.variables[T10_NAMESPACE] ?? null)).length;
    if (!Object.hasOwn(doc.variables, T10_NAMESPACE)) {
      view.status = 'empty';
      return view;
    }
    frame = frameT10Envelope(doc.variables[T10_NAMESPACE]);
    view.scope = frame.scope;
    if (!sameT10(frame.binding, doc.binding)) {
      view.status = 'identity-mismatch';
      return view;
    }
  } catch {
    return view;
  }
  let validated: T4Archive;
  try {
    const genesis = await validateT10Envelope(
      { ...frame, archive: { ...frame.archive, commits: [] }, receipts: [], runs: [] },
      doc,
    );
    validated = genesis.archive;
  } catch {
    return view;
  }
  if (
    !Array.isArray(frame.archive.commits) ||
    frame.archive.commits.length > 32 ||
    frame.receipts.length !== frame.archive.commits.length
  )
    return view;
  let failure: 'dependency' | 'integrity' | null = null;
  for (const [i, commit] of frame.archive.commits.entries()) {
    if (!failure)
      try {
        const prefix = await validateT10Envelope(
          {
            ...frame,
            archive: { ...frame.archive, commits: frame.archive.commits.slice(0, i + 1) },
            receipts: frame.receipts.slice(0, i + 1),
            runs: [],
          },
          doc,
        );
        validated = prefix.archive;
      } catch (e) {
        failure = e instanceof T10Error && e.code === 'DEPENDENCY' ? 'dependency' : 'integrity';
      }
    if (failure)
      view.pending.push({
        commitId: typeof commit?.commitId === 'string' ? commit.commitId : `invalid-${i + 1}`,
        seq: i + 1,
        reason: failure,
      });
  }
  view.state = copyT10(validated.commits.at(-1)?.snapshot.state ?? validated.genesis);
  view.head = headT4Token(validated);
  view.evolution = recoverT9Ledger(validated);
  view.status = view.pending.length ? 'restored-ancestor' : 'ready';
  for (const r of frame.runs) {
    try {
      await validateT10RunRecord(frame.scope, r);
    } catch {
      view.status = 'damaged';
      view.state = null;
      view.head = null;
      view.evolution = null;
      return view;
    }
    const committed = validated.commits.some(c => c.runId === r.runId);
    const valid = sameT10(r.base, view.head) && (await validT10Dependencies(doc, r.dependencies));
    view.runs.push({
      runId: r.runId,
      status: committed ? 'committed' : r.resolution === 'abandoned' ? 'abandoned' : valid ? 'interrupted' : 'stale',
      sent: r.sent,
      maxRequests: r.maxRequests,
    });
  }
  view.cache = (await reconcileT4Cache(validated, candidateCache)).status;
  if (view.pending.length)
    view.notices.push('已退回有效祖先；失效历史保留原档，仅供查看。正式写入需先明确处理依赖，不能自动抹除旧尾部。');
  return view;
}
export async function inspectT10Host(driver: T10Driver, candidateCache?: unknown): Promise<T10RecoveryView> {
  return inspectHost(driver, canWriteT10, candidateCache);
}
export async function inspectT10CompatibilityHost(
  driver: T10Driver,
  candidateCache?: unknown,
): Promise<T10RecoveryView> {
  const view = await inspectHost(driver, canWriteT10Compatibility, candidateCache);
  view.notices.push('纯前端兼容模式：只支持一个活动页面及串行写入，不具备跨插件/标签页原子保护。');
  return view;
}
async function inspectHost(
  driver: T10Driver,
  canWrite: (driver: T10Driver) => boolean,
  candidateCache?: unknown,
): Promise<T10RecoveryView> {
  if (!driver.capabilities.durableRead) {
    const view = await recoverT10Document(null, driver.capabilities.environment);
    view.status = 'read-failed';
    view.notices.push('宿主未提供独立持久读回；原子写入未经验证，保持只读。内存观察不能作为已存酒馆聊天的确认。');
    return view;
  }
  let binding: T10Binding;
  try {
    binding = copyT10(driver.currentBinding());
    const doc = await driver.readDurable(binding);
    if (!sameT10(binding, driver.currentBinding())) throw new T10Error('IDENTITY');
    const view = await recoverT10Document(doc, driver.capabilities.environment, candidateCache);
    view.writable =
      view.status === 'ready' &&
      canWrite(driver) &&
      !view.runs.some(r => r.status === 'interrupted' || r.status === 'stale');
    if (!canWrite(driver)) view.notices.push('当前保存模式未获准或已经失效：只读，不把内存保存当作可靠酒馆存档。');
    return view;
  } catch {
    const view = await recoverT10Document(null, driver.capabilities.environment);
    view.status = 'read-failed';
    return view;
  }
}
/** Single-parent explicit fork/copy of a validated cutoff; source is immutable and self-contained. */
export async function prepareT10Fork(options: {
  source: T10Document;
  target: T10Document;
  targetScope: T4Scope;
  throughCommitId: string | null;
  kind: 'copy' | 'branch';
  allocate: (kind: 'message' | 'swipe') => string;
}): Promise<T10Document> {
  const source = normalizeT10Document(options.source),
    target = normalizeT10Document(options.target);
  const raw = frameT10Envelope(source.variables[T10_NAMESPACE]);
  const cut =
    options.throughCommitId === null
      ? 0
      : raw.archive.commits.findIndex(c => c.commitId === options.throughCommitId) + 1;
  if (options.throughCommitId !== null && cut === 0) throw new T10Error('ARCHIVE');
  const prefix = await validateT10Envelope(
    {
      ...raw,
      archive: { ...raw.archive, commits: raw.archive.commits.slice(0, cut) },
      receipts: raw.receipts.slice(0, cut),
      runs: [],
    },
    source,
  );
  if (
    sameT10(raw.scope, options.targetScope) ||
    options.targetScope.branchId === raw.scope.branchId ||
    (options.kind === 'copy'
      ? options.targetScope.worldId === raw.scope.worldId
      : options.targetScope.worldId !== raw.scope.worldId)
  )
    throw new T10Error('IDENTITY');
  // An already-bound target is not silently overwritten; copied source metadata is only allowed
  // when it identifies the source, never a different existing target world.
  if (
    Object.hasOwn(target.variables, T10_NAMESPACE) &&
    !sameT10(frameT10Envelope(target.variables[T10_NAMESPACE]).scope, raw.scope)
  )
    throw new T10Error('IDENTITY');
  delete target.variables[T10_NAMESPACE];
  for (const m of target.messages) for (const data of m.swipes_data) delete data[T10_NAMESPACE];
  const sourceState = copyT10(prefix.archive.commits.at(-1)?.snapshot.state ?? prefix.archive.genesis);
  const state = copyT10(sourceState);
  state.data.worldId = options.targetScope.worldId;
  state.data.branchId = options.targetScope.branchId;
  const next = await initializeT10Document(target, options.targetScope, state, options.allocate);
  const mappings = [] as { source: import('./t4-protocol').T4Anchor; target: import('./t4-protocol').T4Anchor }[];
  let inherited: T10Dependency[] = [];
  const sets = [
    ...(prefix.inheritedDependencies.length ? [prefix.inheritedDependencies] : []),
    ...prefix.receipts.map(r => r.dependencies),
  ];
  for (const dependencies of sets) {
    const index = dependencies.length - 1;
    const hash =
      prefix.receipts.find(r => sameT10(r.dependencies, dependencies))?.anchor.inputFingerprint ?? '0'.repeat(64);
    const captured = await captureT10Anchor(next, options.targetScope, index, hash);
    if (
      !sameT10(
        captured.dependencies.map(d => d.bodyFingerprint),
        dependencies.map(d => d.bodyFingerprint),
      )
    )
      throw new T10Error('ANCHOR');
    if (captured.dependencies.length > inherited.length) inherited = captured.dependencies;
  }
  for (const receipt of prefix.receipts) {
    const captured = await captureT10Anchor(
      next,
      options.targetScope,
      receipt.dependencies.length - 1,
      receipt.anchor.inputFingerprint,
    );
    mappings.push({ source: receipt.anchor, target: captured.anchor });
  }
  const head = prefix.archive.commits.at(-1);
  const origin = {
    kind: options.kind,
    sourceScope: raw.scope,
    sourceCommitId: head?.commitId ?? null,
    sourceSeq: cut,
    sourceStateFingerprint: await fingerprintT4(sourceState),
    anchorMapping: mappings.filter((m, i, a) => a.findIndex(n => sameT10(n.source, m.source)) === i),
    sourceHistory: prefix.archive,
  };
  const archive = await createT4Archive(options.targetScope, state, origin);
  const frame = frameT10Envelope(next.variables[T10_NAMESPACE]);
  next.variables[T10_NAMESPACE] = copyT10({
    ...frame,
    archive,
    inheritedDependencies: inherited,
    inheritedFingerprint: await fingerprintT4({
      scope: options.targetScope,
      genesisFingerprint: archive.genesisFingerprint,
      origin: archive.origin,
      dependencies: inherited,
    }),
  }) as unknown as import('./t2-template').T2Json;
  await validateT10Envelope(next.variables[T10_NAMESPACE], next);
  return next;
}
