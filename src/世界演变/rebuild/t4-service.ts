/** T4 unified isolated commit coordinator: SQL is private until the JSON authority confirms it. */
import type { T3Request, T3Result } from './t3-engine';
import { freezeT3Request, normalizeT3Result } from './t3-result';
import { cloneT2Json } from './t2-template';
import {
  canonicalT4Json,
  diffT4States,
  fingerprintT4,
  normalizeT4Anchor,
  normalizeT4Context,
  normalizeT4Scope,
  normalizeT4State,
  sealT4Commit,
  stampT4State,
  fingerprintT4Schema,
  fingerprintT4Template,
  validateT4Archive,
  type T4Anchor,
  type T4Archive,
  type T4Commit,
  type T4Context,
  type T4Origin,
  type T4Scope,
  type T4State,
  type T4Step,
} from './t4-protocol';
import { headT4Token, T4StoreError, type T4ArchiveGateway, type T4HeadToken, type T4SandboxStore } from './t4-store';
import type { T4PreviewInput } from './t4-preview';
import { applyT5Controls, type T5Control } from './t5-controls';
import { normalizeT9Ledger, recoverT9Ledger, type T9Ledger } from './t9-ledger';

export type T4Status = 'draft' | 'private' | 'saving' | 'saved' | 'failed' | 'pending' | 'conflict' | 'cancelled';
export type T4ServiceCode =
  | 'BUSY'
  | 'CLOSED'
  | 'ABORTED'
  | 'ANCHOR'
  | 'CONFLICT'
  | 'EXECUTION'
  | 'SAVE_FAILED'
  | 'PENDING'
  | 'ARCHIVE'
  | 'INPUT';
export class T4ServiceError extends Error {
  constructor(readonly code: T4ServiceCode) {
    super(`世界演变提交：${code}`);
    this.name = 'T4ServiceError';
  }
}
export type T4Executor = (request: T3Request, options?: { signal?: AbortSignal }) => Promise<T3Result>;
export type T4Batch = Omit<T3Request, 'template' | 'data'>;
export interface T4RunSpec {
  runId: string;
  commitId: string;
  anchor: T4Anchor | null;
  context: T4Context;
}
export interface T4Prepared {
  base: T4HeadToken;
  baseState: T4State;
  kind: T4Commit['kind'];
  anchor: T4Anchor | null;
  /** Already stamped once, but still private. Null means no valid assistant anchor. */
  commit: T4Commit | null;
  state: T4State;
}
export interface T4View {
  scope: T4Scope;
  busy: boolean;
  status: T4Status;
  formal: T4State;
  head: T4HeadToken;
  lastCommit: Pick<T4Commit, 'commitId' | 'seq' | 'kind' | 'anchor'> | null;
  draft: T4Prepared | null;
  errorCode: T4ServiceCode | null;
  evolution: T9Ledger | null;
}
/** The same receipt drives T5/T9 feedback; it never grants the preview authority to save. */
export function previewT4View(view: T4View): T4PreviewInput {
  const frozen = copy(view),
    receipt = frozen.draft ? frozen.draft.commit : frozen.lastCommit;
  const input: T4PreviewInput = {
    status: frozen.status,
    scope: frozen.scope,
    base: frozen.draft?.baseState ?? frozen.formal,
    draft: frozen.draft?.state ?? null,
    anchor: frozen.draft ? frozen.draft.anchor : (receipt?.anchor ?? null),
    kind: frozen.draft?.kind ?? receipt?.kind ?? 'manual',
  };
  if (receipt) {
    input.commitId = receipt.commitId;
    input.seq = receipt.seq;
  } else if (frozen.status === 'saved' && frozen.head.seq === 0) {
    input.isGenesis = true;
    input.seq = 0;
  }
  if (frozen.errorCode) input.errorCode = frozen.errorCode;
  return input;
}
export interface T4CommitService {
  subscribe(listener: () => void): () => void;
  view(): T4View;
  headToken(): T4HeadToken;
  evolutionLedger(): T9Ledger | null;
  findEvolutionRun(anchor: T4Anchor): Pick<T4Commit, 'runId' | 'commitId' | 'seq'> | null;
  prepareSql(
    spec: T4RunSpec & { kind: 'manual' | 'model'; batches: T4Batch[]; evolution?: T9Ledger },
    options?: { signal?: AbortSignal },
  ): Promise<T4Prepared>;
  prepareControls(spec: T4RunSpec & { controls: T5Control[] }): Promise<T4Prepared>;
  prepareMigration(spec: T4RunSpec & { state: T4State; transfer?: T4Commit['transfer'] }): Promise<T4Prepared>;
  prepareRestore(spec: T4RunSpec & { sourceCommitId: string | null }): Promise<T4Prepared>;
  save(options?: { signal?: AbortSignal; authorize?: () => void }): Promise<T4View>;
  reconcile(): Promise<T4View>;
  cancelDraft(): void;
  close(): void;
}
const copy = <T>(value: T): T => cloneT2Json(value) as unknown as T;
const same = (left: unknown, right: unknown) => canonicalT4Json(left) === canonicalT4Json(right);
function requireId(value: string): void {
  if (!/^[a-z][a-z0-9_-]{0,63}$/.test(value) || ['constructor', 'prototype'].includes(value))
    throw new T4ServiceError('INPUT');
}
function runSpec(input: T4RunSpec, scope: T4Scope): T4RunSpec {
  const spec = copy(input);
  requireId(spec.runId);
  requireId(spec.commitId);
  const context = normalizeT4Context(spec.context);
  const anchor = spec.anchor === null ? null : normalizeT4Anchor(spec.anchor);
  if (anchor && (anchor.chatId !== scope.chatId || anchor.inputFingerprint !== context.inputFingerprint))
    throw new T4ServiceError('ANCHOR');
  return { runId: spec.runId, commitId: spec.commitId, context, anchor };
}

/** Rehydrate exact historical snapshots; no SQL, AI or default seeds are called here. */
function checkpoint(archive: T4Archive, throughCommitId?: string | null): T4State {
  if (throughCommitId === null) return copy(archive.genesis);
  const head =
    throughCommitId === undefined
      ? archive.commits.at(-1)
      : archive.commits.find(commit => commit.commitId === throughCommitId);
  if (throughCommitId !== undefined && !head) throw new T4ServiceError('ARCHIVE');
  return copy(head?.snapshot.state ?? archive.genesis);
}
export async function recoverT4Snapshot(input: unknown, throughCommitId?: string | null): Promise<T4State> {
  return checkpoint(await validateT4Archive(input), throughCommitId);
}

/** Incremental recovery is explicit, never an automatic second application of snapshot-covered logs. */
export async function replayT4Suffix(
  input: unknown,
  throughCommitId: string | null,
  execute: T4Executor,
): Promise<T4State> {
  const archive = await validateT4Archive(input);
  let state = checkpoint(archive, throughCommitId);
  const cutoff = throughCommitId === null ? 0 : archive.commits.find(c => c.commitId === throughCommitId)!.seq;
  for (const commit of archive.commits.filter(c => c.seq > cutoff)) {
    if ((await fingerprintT4(state)) !== commit.beforeStateFingerprint) throw new T4ServiceError('ARCHIVE');
    if (commit.kind === 'manual' || commit.kind === 'model') {
      let privateState = copy(state);
      for (const step of commit.steps) {
        if ((await fingerprintT4(privateState)) !== step.beforeFingerprint) throw new T4ServiceError('ARCHIVE');
        const { beforeFingerprint: _before, afterFingerprint: _after, ...batch } = step;
        const request = freezeT3Request({ ...batch, template: privateState.template, data: privateState.data });
        const result = normalizeT3Result(await execute(request), request);
        if (!same(result.log.sql, step.sql) || !same(result.log.parameters, step.parameters))
          throw new T4ServiceError('ARCHIVE');
        privateState = normalizeT4State({ template: privateState.template, data: result.data });
        if ((await fingerprintT4(privateState)) !== step.afterFingerprint) throw new T4ServiceError('ARCHIVE');
      }
      if (commit.controls) privateState = applyT5Controls(privateState, commit.controls);
      state = stampT4State(state, privateState);
    } else {
      // A validated migration/restore checkpoint already contains its declared historical schema/data.
      state = copy(commit.snapshot.state);
    }
    if ((await fingerprintT4(state)) !== commit.afterStateFingerprint) throw new T4ServiceError('ARCHIVE');
  }
  return state;
}

export interface T4Cache {
  scope: T4Scope;
  head: T4HeadToken;
  state: T4State;
}
export async function reconcileT4Cache(
  input: unknown,
  candidate?: unknown,
): Promise<{
  status: 'absent' | 'match' | 'discarded';
  state: T4State;
}> {
  // If authority is corrupt/unavailable, fail rather than promoting the cache to authority.
  const archive = await validateT4Archive(input);
  const state = checkpoint(archive);
  if (candidate === undefined) return { status: 'absent', state };
  try {
    const cached = copy(candidate) as T4Cache;
    if (
      same(cached.scope, archive.scope) &&
      same(cached.head, headT4Token(archive)) &&
      (await fingerprintT4(normalizeT4State(cached.state))) === headT4Token(archive).stateFingerprint
    )
      return { status: 'match', state };
  } catch {
    /* Cache rejection never changes authoritative JSON. */
  }
  return { status: 'discarded', state };
}

export async function createT4CommitService(options: {
  scope: T4Scope;
  store: T4ArchiveGateway;
  execute: T4Executor;
}): Promise<T4CommitService> {
  const scope = normalizeT4Scope(options.scope);
  const { store, execute } = options;
  if (store.mode !== scope.mode) throw new T4ServiceError('INPUT');
  let archive = await validateT4Archive(await store.read(scope));
  if (!same(archive.scope, scope)) throw new T4ServiceError('ARCHIVE');
  let formal = checkpoint(archive);
  let draft: T4Prepared | null = null;
  let status: T4Status = 'saved';
  let errorCode: T4ServiceCode | null = null;
  let busy = false;
  let closed = false;
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) {
      try {
        listener();
      } catch {
        /* Observers cannot change transaction authority. */
      }
    }
  };
  const open = () => {
    if (closed) throw new T4ServiceError('CLOSED');
  };
  const view = (): T4View => {
    const latest = archive.commits.at(-1);
    const lastCommit = latest
      ? { commitId: latest.commitId, seq: latest.seq, kind: latest.kind, anchor: latest.anchor }
      : null;
    return copy({
      scope,
      busy,
      status,
      formal,
      head: headT4Token(archive),
      lastCommit,
      draft,
      errorCode,
      evolution: recoverT9Ledger(archive),
    });
  };
  const start = (preparing = false) => {
    open();
    if (busy) throw new T4ServiceError('BUSY');
    if (status === 'pending') throw new T4ServiceError('PENDING');
    busy = true;
    if (preparing) {
      draft = null;
      errorCode = null;
    }
    notify();
  };
  const check = (signal?: AbortSignal) => {
    open();
    if (signal?.aborted) throw new T4ServiceError('ABORTED');
  };
  const requireNewRun = (spec: T4RunSpec) => {
    if (archive.commits.some(commit => commit.commitId === spec.commitId || commit.runId === spec.runId))
      throw new T4ServiceError('CONFLICT');
  };
  const installDraft = async (
    spec: T4RunSpec,
    kind: T4Commit['kind'],
    privateState: T4State,
    steps: T4Step[],
    sourceCommitId: string | null,
    controls?: T5Control[],
    evolution?: T9Ledger,
    transfer?: T4Commit['transfer'],
  ) => {
    const state = stampT4State(formal, privateState);
    const base = headT4Token(archive);
    let commit: T4Commit | null = null;
    if (spec.anchor) {
      const [templateFingerprint, schemaFingerprint] = await Promise.all([
        fingerprintT4Template(state.template),
        fingerprintT4Schema(state.template),
      ]);
      const beforeStateFingerprint = await fingerprintT4(formal);
      const afterStateFingerprint = await fingerprintT4(state);
      commit = await sealT4Commit({
        format: 'world-evolution-commit',
        version: 1,
        scope,
        runId: spec.runId,
        commitId: spec.commitId,
        parentCommitId: base.commitId,
        seq: base.seq + 1,
        baseRevision: formal.data.revision,
        kind,
        sourceCommitId,
        anchor: spec.anchor,
        context: spec.context,
        beforeStateFingerprint,
        afterStateFingerprint,
        templateFingerprint,
        schemaFingerprint,
        steps,
        ...(controls ? { controls } : {}),
        ...(evolution ? { evolution: normalizeT9Ledger(evolution, state) } : {}),
        ...(transfer ? { transfer } : {}),
        changes: diffT4States(formal, state),
        snapshot: {
          throughCommitId: spec.commitId,
          throughSeq: base.seq + 1,
          beforeFingerprint: beforeStateFingerprint,
          afterFingerprint: afterStateFingerprint,
          state,
        },
      });
    }
    open();
    draft = copy({ base, baseState: formal, kind, anchor: spec.anchor, commit, state });
    status = spec.anchor ? 'private' : 'draft';
    errorCode = spec.anchor ? null : 'ANCHOR';
    return copy(draft);
  };
  const prepareFailure = (error: unknown) => {
    draft = null;
    errorCode = error instanceof T4ServiceError ? error.code : 'EXECUTION';
    status = errorCode === 'ABORTED' || errorCode === 'CLOSED' ? 'cancelled' : 'failed';
    throw error;
  };
  const reconcile = async (): Promise<T4View> => {
    open();
    const persisted = await validateT4Archive(await store.read(scope));
    if (!same(persisted.scope, scope)) throw new T4ServiceError('ARCHIVE');
    const commit = draft?.commit;
    if (commit) {
      const observed = persisted.commits.find(c => c.commitId === commit.commitId || c.runId === commit.runId);
      if (observed && !same(observed, commit)) {
        status = 'conflict';
        errorCode = 'CONFLICT';
        throw new T4ServiceError('CONFLICT');
      }
      if (!observed) {
        if (!same(headT4Token(persisted), draft!.base)) {
          status = 'conflict';
          errorCode = 'CONFLICT';
          throw new T4ServiceError('CONFLICT');
        }
        status = 'private';
        errorCode = null;
        return view(); // Definitively not saved: the identical prepared payload may be retried.
      }
    }
    const restored = checkpoint(persisted);
    open();
    archive = persisted;
    formal = restored;
    status = 'saved';
    errorCode = null;
    if (commit && headT4Token(persisted).commitId !== commit.commitId) draft = null;
    // Keep confirmed immutable draft receipt for repeat-save idempotency until another prepare.
    return view();
  };
  return Object.freeze({
    subscribe(listener: () => void) {
      open();
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    headToken() {
      open();
      return copy(headT4Token(archive));
    },
    evolutionLedger() {
      open();
      return recoverT9Ledger(archive);
    },
    findEvolutionRun(input: T4Anchor) {
      open();
      const anchor = normalizeT4Anchor(input);
      const commit = archive.commits.find(c => c.evolution && same(c.anchor, anchor));
      return commit ? copy({ runId: commit.runId, commitId: commit.commitId, seq: commit.seq }) : null;
    },
    view() {
      open();
      return view();
    },
    async prepareControls(input: T4RunSpec & { controls: T5Control[] }) {
      start(true);
      try {
        const frozen = copy(input);
        const spec = runSpec(frozen, scope);
        requireNewRun(spec);
        return await installDraft(spec, 'manual', applyT5Controls(formal, frozen.controls), [], null, frozen.controls);
      } catch (error) {
        return prepareFailure(error);
      } finally {
        busy = false;
        notify();
      }
    },
    async prepareSql(
      input: T4RunSpec & { kind: 'manual' | 'model'; batches: T4Batch[]; evolution?: T9Ledger },
      runOptions: { signal?: AbortSignal } = {},
    ) {
      start(true);
      const signal = runOptions.signal;
      try {
        const frozen = copy(input);
        const spec = runSpec(frozen, scope);
        requireNewRun(spec);
        if (
          !['manual', 'model'].includes(frozen.kind) ||
          !Array.isArray(frozen.batches) ||
          (frozen.batches.length < 1 && !(frozen.kind === 'model' && frozen.evolution)) ||
          frozen.batches.length > 64
        )
          throw new T4ServiceError('INPUT');
        const ids = frozen.batches.map(b => b.batchId);
        if (new Set(ids).size !== ids.length) throw new T4ServiceError('INPUT');
        draft = null;
        let privateState = copy(formal);
        const steps: T4Step[] = [];
        for (const batch of frozen.batches) {
          check(signal);
          if (batch.policy.actor !== (frozen.kind === 'model' ? 'ai' : 'manual')) throw new T4ServiceError('INPUT');
          const request = freezeT3Request({ ...batch, template: privateState.template, data: privateState.data });
          const beforeFingerprint = await fingerprintT4(privateState);
          const result = normalizeT3Result(await execute(request, { signal }), request);
          check(signal);
          privateState = normalizeT4State({ template: privateState.template, data: result.data });
          const step: T4Step = {
            batchId: result.log.batchId,
            sql: result.log.sql,
            parameters: result.log.parameters,
            policy: request.policy,
            beforeFingerprint,
            afterFingerprint: await fingerprintT4(privateState),
          };
          if (request.limits) step.limits = request.limits;
          steps.push(step);
        }
        check(signal);
        if (frozen.evolution && frozen.kind !== 'model') throw new T4ServiceError('INPUT');
        const prepared = await installDraft(spec, frozen.kind, privateState, steps, null, undefined, frozen.evolution);
        check(signal);
        return prepared;
      } catch (error) {
        return prepareFailure(signal?.aborted ? new T4ServiceError('ABORTED') : error);
      } finally {
        busy = false;
        notify();
      }
    },
    async prepareMigration(input: T4RunSpec & { state: T4State; transfer?: T4Commit['transfer'] }) {
      start(true);
      try {
        const frozen = copy(input),
          spec = runSpec(frozen, scope);
        requireNewRun(spec);
        const state = normalizeT4State(frozen.state);
        if (
          state.template.id !== formal.template.id ||
          state.template.templateVersion <= formal.template.templateVersion ||
          state.data.revision !== formal.data.revision
        )
          throw new T4ServiceError('INPUT');
        return await installDraft(spec, 'migration', state, [], null, undefined, undefined, frozen.transfer);
      } catch (error) {
        return prepareFailure(error);
      } finally {
        busy = false;
        notify();
      }
    },
    async prepareRestore(input: T4RunSpec & { sourceCommitId: string | null }) {
      start(true);
      try {
        const frozen = copy(input),
          spec = runSpec(frozen, scope);
        requireNewRun(spec);
        if (frozen.sourceCommitId !== null) requireId(frozen.sourceCommitId);
        const state = checkpoint(archive, frozen.sourceCommitId);
        state.data.revision = formal.data.revision;
        return await installDraft(spec, 'restore', state, [], frozen.sourceCommitId);
      } catch (error) {
        return prepareFailure(error);
      } finally {
        busy = false;
        notify();
      }
    },
    async save(saveOptions: { signal?: AbortSignal; authorize?: () => void } = {}) {
      start();
      const signal = saveOptions.signal;
      const authorize = saveOptions.authorize;
      try {
        if (status === 'cancelled') throw new T4ServiceError('ABORTED');
        if (!draft?.commit) throw new T4ServiceError('ANCHOR');
        check(signal);
        status = 'saving';
        errorCode = null;
        notify();
        try {
          await store.compareAndSwap({
            scope,
            expected: copy(draft.base),
            commit: copy(draft.commit),
            signal,
            authorize,
          });
        } catch (error) {
          if (error instanceof T4StoreError && ['CONFLICT', 'ANCHOR', 'ABORTED', 'SAVE_FAILED'].includes(error.code)) {
            errorCode = error.code as T4ServiceCode;
            status = error.code === 'CONFLICT' ? 'conflict' : error.code === 'ABORTED' ? 'cancelled' : 'failed';
            throw new T4ServiceError(errorCode);
          }
          // ACK loss/unknown transport failure could have written. No blind retry or formal view switch.
          status = 'pending';
          errorCode = 'PENDING';
          throw new T4ServiceError('PENDING');
        }
        try {
          await reconcile();
          busy = false;
          return view();
        } catch (error) {
          if (error instanceof T4ServiceError && error.code === 'CONFLICT') throw error;
          status = 'pending';
          errorCode = 'PENDING';
          throw new T4ServiceError('PENDING');
        }
      } catch (error) {
        if (error instanceof T4ServiceError && error.code === 'ABORTED') {
          draft = null;
          status = 'cancelled';
          errorCode = 'ABORTED';
        }
        throw error;
      } finally {
        busy = false;
        notify();
      }
    },
    async reconcile() {
      open();
      if (busy) throw new T4ServiceError('BUSY');
      busy = true;
      try {
        await reconcile();
        busy = false;
        return view();
      } catch (error) {
        if (!(error instanceof T4ServiceError && error.code === 'CONFLICT')) {
          status = 'pending';
          errorCode = 'PENDING';
        }
        throw error;
      } finally {
        busy = false;
        notify();
      }
    },
    cancelDraft() {
      open();
      if (busy) throw new T4ServiceError('BUSY');
      if (status === 'pending') throw new T4ServiceError('PENDING');
      draft = null;
      status = 'cancelled';
      errorCode = 'ABORTED';
      notify();
    },
    close() {
      closed = true;
      draft = null;
      listeners.clear();
    },
  });
}

/** Single-parent fork/copy materializes only the explicitly selected immutable source state. */
export async function forkT4Sandbox(options: {
  store: T4SandboxStore;
  sourceScope: T4Scope;
  targetScope: T4Scope;
  throughCommitId: string | null;
  kind: 'copy' | 'branch';
  anchorMapping: { source: T4Anchor; target: T4Anchor }[];
}): Promise<void> {
  const { store, ...payload } = options;
  const frozen = copy(payload);
  const sourceScope = normalizeT4Scope(frozen.sourceScope),
    targetScope = normalizeT4Scope(frozen.targetScope);
  const mapping = frozen.anchorMapping.map(item => ({
    source: normalizeT4Anchor(item.source),
    target: normalizeT4Anchor(item.target),
  }));
  if (
    !['copy', 'branch'].includes(frozen.kind) ||
    same(sourceScope, targetScope) ||
    (frozen.kind === 'copy' &&
      (targetScope.worldId === sourceScope.worldId || targetScope.branchId === sourceScope.branchId)) ||
    (frozen.kind === 'branch' &&
      (targetScope.worldId !== sourceScope.worldId || targetScope.branchId === sourceScope.branchId))
  )
    throw new T4ServiceError('INPUT');
  for (const item of mapping)
    if (
      item.source.chatId !== sourceScope.chatId ||
      item.target.chatId !== targetScope.chatId ||
      item.source.inputFingerprint !== item.target.inputFingerprint
    )
      throw new T4ServiceError('ANCHOR');
  const source = await store.read(sourceScope);
  const state = await recoverT4Snapshot(source, frozen.throughCommitId);
  const sourceCommit =
    frozen.throughCommitId === null ? null : source.commits.find(c => c.commitId === frozen.throughCommitId)!;
  const dependencies = source.commits.filter(c => c.seq <= (sourceCommit?.seq ?? 0)).map(c => c.anchor);
  for (const dependency of dependencies)
    if (!mapping.some(item => same(item.source, dependency))) throw new T4ServiceError('ANCHOR');
  const origin: T4Origin = {
    kind: frozen.kind,
    sourceScope,
    sourceCommitId: sourceCommit?.commitId ?? null,
    sourceSeq: sourceCommit?.seq ?? 0,
    sourceStateFingerprint: await fingerprintT4(state),
    anchorMapping: mapping,
    sourceHistory: { ...source, commits: source.commits.filter(c => c.seq <= (sourceCommit?.seq ?? 0)) },
  };
  state.data.worldId = targetScope.worldId;
  state.data.branchId = targetScope.branchId;
  await store.initialize(targetScope, state, origin);
}
