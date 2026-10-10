/** Source receipts are live adapter capabilities, never flags loaded from a preset/chat. */
import { cloneT2Json, type T2Json } from './t2-template';
import { fingerprintT4, normalizeT4Scope, type T4Scope } from './t4-protocol';
import { normalizeT10Document, sameT10, stampedT10Messages, type T10Document } from './t10-host-protocol';
import { normalizeT7Input, inspectT7Prerequisites, type T7Input, type T7Proof, type T7Segment } from './t7-input';

export type T15Source = 'mvu' | 'database';
export interface T15SourceSelection {
  /** Explicit persisted field path, not an entire chat/script-variable dump. */
  path: string[];
  label: string;
  tableIds: string[];
}
export interface T15SourcePort {
  read(): Promise<T10Document>;
  /** A monotonically increasing binding/swipe/content invalidation counter. */
  epoch(): number;
}
interface Receipt {
  token: object;
  serial: number;
  state: T7Proof['state'];
  reason: string;
  expected: T2Json[] | null;
}
const copy = <T>(value: T): T => cloneT2Json(value) as unknown as T;
function selected(root: unknown, path: string[]): T2Json {
  let value = cloneT2Json(root);
  if (!path.length || path.some(k => !k || ['__proto__', 'constructor', 'prototype'].includes(k)))
    throw new Error('前置资料路径无效');
  for (const key of path) {
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, key)) throw new Error('前置资料尚未保存');
    value = (value as Record<string, T2Json>)[key];
  }
  return value;
}
async function inputFromDocument(value: T10Document, scope: T4Scope, eligibleRound: number) {
  const doc = normalizeT10Document(value),
    normalized = normalizeT4Scope(scope);
  const messages = stampedT10Messages(doc);
  const last = messages.at(-1);
  if (normalized.mode !== 't10-host' || !last || last.message.role !== 'assistant' || last.message.is_hidden)
    throw new Error('请等待当前助手剧情保存；不能以旧助手楼层代替当前回复');
  const story = messages
    .filter(m => m.message.role !== 'system' && !m.message.is_hidden)
    .slice(-200)
    .map(m => ({
      messageId: m.active.messageId,
      role: m.message.role as 'user' | 'assistant',
      text: m.message.swipes[m.message.swipe_id],
    }));
  const input = normalizeT7Input({
    anchor: {
      chatId: normalized.chatId,
      messageId: last.active.messageId,
      swipeId: last.active.swipeId,
      inputFingerprint: await fingerprintT4(story),
    },
    worldId: normalized.worldId,
    branchId: normalized.branchId,
    eligibleRound,
    story,
    segments: [],
    proofs: [],
    selected: [],
    progress: {},
    now: null,
  });
  return input;
}
export async function captureT15Input(port: T15SourcePort, scope: T4Scope, eligibleRound: number): Promise<T7Input> {
  port = Object.freeze({ ...port });
  scope = normalizeT4Scope(scope);
  const stamp = port.epoch(),
    input = await inputFromDocument(await port.read(), scope, eligibleRound);
  if (stamp !== port.epoch()) throw new Error('读取期间聊天已变化');
  return input;
}
/** begin/end are called only by a trusted source adapter with a bound whole-run terminal signal.
 * A generic table-update/MVU-ended notification can only call hint(), never complete(). */
export function createT15Prerequisites(options: {
  port: T15SourcePort;
  scope: T4Scope;
  input: T7Input;
  sources: { id: T15Source; required: boolean; selections: T15SourceSelection[] }[];
}) {
  options = Object.freeze({ ...options, port: Object.freeze({ ...options.port }) });
  const input = normalizeT7Input(options.input),
    scope = normalizeT4Scope(options.scope),
    sources = copy(options.sources),
    startEpoch = options.port.epoch();
  if (
    scope.chatId !== input.anchor.chatId ||
    scope.worldId !== input.worldId ||
    scope.branchId !== input.branchId ||
    new Set(sources.map(s => s.id)).size !== sources.length ||
    sources.some(s => !['mvu', 'database'].includes(s.id))
  )
    throw new Error('前置来源身份无效');
  for (const s of sources) {
    if (s.selections.length > 64) throw new Error('前置资料选择过多');
    if (
      s.selections.some(
        p =>
          !p.label.trim() ||
          p.label.length > 160 ||
          !p.path.length ||
          p.path.some(k => !k || ['__proto__', 'constructor', 'prototype'].includes(k)),
      )
    )
      throw new Error('前置资料选择无效');
  }
  const receipts = new Map<T15Source, Receipt>();
  let closed = false,
    revoked = false,
    serial = 0,
    revision = 0,
    verifiedRevision = -1,
    refreshing = false;
  let output = copy(input);
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const fn of listeners) {
      try {
        fn();
      } catch {
        /* A view is not authority. */
      }
    }
  };
  const valid = () => !closed && !revoked && startEpoch === options.port.epoch();
  function changed() {
    revision++;
    verifiedRevision = -1;
    notify();
  }
  function source(id: T15Source) {
    const found = sources.find(s => s.id === id);
    if (!found || !valid()) throw new Error('前置来源已撤销');
    return found;
  }
  function proof(id: T15Source): T7Proof {
    const r = receipts.get(id),
      s = sources.find(s => s.id === id)!;
    return {
      sourceId: id,
      required: s.required,
      state: valid() ? (r?.state ?? 'waiting') : 'unverifiable',
      identity: { ...input.anchor, worldId: input.worldId, branchId: input.branchId },
      sourceCommitId: r ? `source-${id}-${r.serial}` : null,
      resultFingerprint: null,
      persisted: false,
      requirePersisted: true,
      reason: r?.reason ?? '等待本轮完整完成信号与独立保存确认',
    };
  }
  return {
    readInput: () => {
      const next = copy(output);
      if (!valid() || verifiedRevision !== revision) {
        next.proofs = sources.map(s => proof(s.id));
        next.segments = [];
        for (const p of next.proofs) if (p.state === 'success') p.state = 'waiting';
      }
      return normalizeT7Input(next);
    },
    ready: () =>
      valid() &&
      verifiedRevision === revision &&
      output.proofs.every(p => !p.required || ['success', 'disabled', 'frequency-skipped'].includes(p.state)),
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    begin(id: T15Source, anchor: T7Input['anchor']) {
      source(id);
      if (!sameT10(anchor, input.anchor)) throw new Error('前置开始信号不是当前回复');
      const token = Object.freeze({});
      receipts.set(id, { token, serial: ++serial, state: 'waiting', reason: '本轮前置正在处理', expected: null });
      changed();
      return token;
    },
    complete(id: T15Source, token: object, values: unknown[]) {
      const s = source(id),
        r = receipts.get(id);
      if (
        !r ||
        r.token !== token ||
        r.state !== 'waiting' ||
        !s.selections.length ||
        values.length !== s.selections.length
      )
        throw new Error('迟到、重复或缺少整轮完成证据的信号');
      r.expected = values.map(cloneT2Json);
      r.state = 'success';
      r.reason = '已收到本轮终态，仍需独立读回确认';
      changed();
    },
    hint(id: T15Source, reason: string) {
      source(id);
      // Even after success, a new unsaved update revokes permission; a hint cannot restore it.
      receipts.set(id, { token: {}, serial: ++serial, state: 'unverifiable', reason, expected: null });
      changed();
    },
    skip(id: T15Source, state: 'disabled' | 'frequency-skipped' | 'not-installed', reason: string) {
      source(id);
      if (!reason.trim()) throw new Error('跳过原因不能为空');
      receipts.set(id, { token: {}, serial: ++serial, state, reason, expected: null });
      changed();
    },
    fail(id: T15Source, token: object) {
      source(id);
      const r = receipts.get(id);
      if (!r || r.token !== token) return;
      r.state = 'failure';
      r.expected = null;
      r.reason = '本轮前置失败或取消，未启动演变';
      changed();
    },
    async refresh() {
      if (!valid() || refreshing) throw new Error('前置检查已撤销或正在进行');
      refreshing = true;
      const checkRevision = revision;
      try {
        const current = await captureT15Input(options.port, scope, input.eligibleRound);
        if (!sameT10(current.anchor, input.anchor) || !sameT10(current.story, input.story))
          throw new Error('剧情或 swipe 已变化');
        const doc = normalizeT10Document(await options.port.read()),
          last = doc.messages.at(-1)!;
        const segments: T7Segment[] = [],
          proofs: T7Proof[] = [];
        for (const s of sources) {
          const p = proof(s.id),
            r = receipts.get(s.id);
          if (p.state === 'success' && r?.expected) {
            const root = s.id === 'mvu' ? last.swipes_data[last.swipe_id] : last;
            const values = s.selections.map(v => selected(root, v.path));
            if (sameT10(values, r.expected)) {
              const items = values.map((value, i) => ({
                source: s.id,
                sourceId: s.id,
                label: s.selections[i].label,
                tableIds: s.selections[i].tableIds,
                text: JSON.stringify(value),
              }));
              if (items.some(v => v.text.length > 100000)) throw new Error('前置资料过大，请缩小选择');
              segments.push(...items);
              p.persisted = true;
              p.resultFingerprint = await fingerprintT4(items);
              p.reason = '本轮整轮终态、当前剧情/swipe 与服务端保存字段一致';
            } else {
              p.state = 'waiting';
              p.reason = '本轮结果尚未在当前回复中完整读回；没有采用旧资料';
            }
          }
          proofs.push(p);
        }
        if (!valid() || checkRevision !== revision) throw new Error('检查期间前置结果已变化');
        // Recheck after the second independent read: it may have changed without a host event.
        const latest = await captureT15Input(options.port, scope, input.eligibleRound);
        if (!sameT10(latest.anchor, input.anchor) || !sameT10(latest.story, input.story)) throw new Error('剧情已变化');
        const finalDoc = normalizeT10Document(await options.port.read()),
          finalLast = finalDoc.messages.at(-1)!;
        const finalInput = await inputFromDocument(finalDoc, scope, input.eligibleRound);
        if (!sameT10(finalInput.anchor, input.anchor) || !sameT10(finalInput.story, input.story))
          throw new Error('最终来源回复已变化');
        for (const s of sources) {
          const r = receipts.get(s.id);
          if (r?.expected && proofs.find(p => p.sourceId === s.id)?.persisted) {
            const root = s.id === 'mvu' ? finalLast.swipes_data[finalLast.swipe_id] : finalLast;
            if (
              !sameT10(
                s.selections.map(v => selected(root, v.path)),
                r.expected,
              )
            )
              throw new Error('保存结果在复核中变化');
          }
        }
        output = normalizeT7Input({ ...input, segments, proofs });
        const report = await inspectT7Prerequisites(output);
        if (!valid() || checkRevision !== revision) throw new Error('检查期间前置结果已变化');
        verifiedRevision = revision;
        notify();
        return report;
      } catch (error) {
        verifiedRevision = -1;
        throw error;
      } finally {
        refreshing = false;
      }
    },
    invalidate() {
      revoked = true;
      changed();
    },
    close() {
      if (closed) return;
      closed = true;
      changed();
      listeners.clear();
    },
  };
}
export type T15Prerequisites = ReturnType<typeof createT15Prerequisites>;
