/** Same-parent-page dispatch ownership. Not a server lock or a cross-tab guarantee. */
import { canonicalT4Json, normalizeT4Scope, type T4Scope } from './t4-protocol';
import type { T7Input } from './t7-input';
const key = Symbol.for('world-evolution.t15.trigger-owner.v1');
interface Registry {
  protocol: 't15-trigger-owner/1';
  owner: object | null;
  attempts: Map<string, { owner: object; active: boolean }>;
}
export function acquireT15TriggerOwner(target: object, assertNoLegacy: () => void, capacity = 256) {
  if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 1024) throw new Error('触发记录容量无效');
  assertNoLegacy();
  const shared = target as { [key]?: Registry };
  let registry = shared[key];
  if (!registry) {
    registry = { protocol: 't15-trigger-owner/1', owner: null, attempts: new Map() };
    Object.defineProperty(shared, key, { value: registry });
  }
  if (
    registry.protocol !== 't15-trigger-owner/1' ||
    !registry.attempts ||
    typeof registry.attempts.has !== 'function' ||
    typeof registry.attempts.set !== 'function' ||
    typeof registry.attempts.size !== 'number' ||
    registry.owner
  )
    throw new Error('已有另一个世界演变入口；未取得触发所有权');
  const owned = registry,
    token = Object.freeze({});
  owned.owner = token;
  let closed = false,
    outstanding = 0;
  const owns = () => !closed && owned.owner === token;
  const release = () => {
    if (closed && outstanding === 0 && owned.owner === token) owned.owner = null;
  };
  const identity = (scope: T4Scope, anchor: T7Input['anchor']) => {
    const normalized = normalizeT4Scope(scope);
    if (normalized.chatId !== anchor.chatId || !anchor.messageId || !anchor.swipeId || !anchor.inputFingerprint)
      throw new Error('触发身份无效');
    return canonicalT4Json({ scope: normalized, anchor });
  };
  function assertAvailable() {
    if (!owns()) throw new Error('触发所有权已撤销');
    assertNoLegacy();
  }
  function activate(id: string, entry: { owner: object; active: boolean }) {
    entry.active = true;
    outstanding++;
    let finished = false;
    return {
      assertCurrent() {
        assertAvailable();
        if (owned.attempts.get(id) !== entry || entry.owner !== token || !entry.active || finished)
          throw new Error('本轮触发权失效');
      },
      finish() {
        if (finished) return;
        finished = true;
        entry.active = false;
        outstanding--;
        release();
      },
    };
  }
  return {
    owns,
    assertAvailable,
    claim(scope: T4Scope, anchor: T7Input['anchor']) {
      assertAvailable();
      const id = identity(scope, anchor);
      if (owned.attempts.has(id)) return null;
      if (owned.attempts.size >= capacity) throw new Error('触发账本已满；不会删除去重记录后自动重发');
      const entry = { owner: token, active: false };
      owned.attempts.set(id, entry);
      return activate(id, entry);
    },
    canContinue(scope: T4Scope, anchor: T7Input['anchor']) {
      try {
        assertAvailable();
        const entry = owned.attempts.get(identity(scope, anchor));
        return entry?.owner === token && !entry.active;
      } catch {
        return false;
      }
    },
    /** Only the controller's same-instance T9 continuation path calls this after canResume. */
    continueClaim(scope: T4Scope, anchor: T7Input['anchor']) {
      assertAvailable();
      const id = identity(scope, anchor),
        entry = owned.attempts.get(id);
      if (!entry || entry.owner !== token || entry.active) throw new Error('不能重新领取其他入口的续跑');
      return activate(id, entry);
    },
    assertClaim(scope: T4Scope, anchor: T7Input['anchor']) {
      assertAvailable();
      const entry = owned.attempts.get(identity(scope, anchor));
      if (entry?.owner !== token || !entry.active) throw new Error('本轮没有领取有效触发权');
    },
    close() {
      closed = true;
      release();
    },
  };
}
export type T15TriggerOwner = ReturnType<typeof acquireT15TriggerOwner>;

/** Read-only inventory. Unknown/unsupported inventory fails closed; never toggles other scripts. */
export function assertT15NoOtherEntries(trees: ScriptTree[][], currentScriptId: string) {
  if (!currentScriptId || trees.length !== 3) throw new Error('无法检查旧入口；请先停用旧世界演变脚本');
  const inspect = (script: Script) => {
    if (!script || script.type !== 'script' || typeof script.enabled !== 'boolean' || typeof script.id !== 'string')
      throw new Error('脚本清单格式不支持');
    if (!script.enabled || script.id === currentScriptId) return;
    if (typeof script.name !== 'string' || typeof script.content !== 'string') throw new Error('脚本清单不完整');
    if (
      /世界演[变化]|WorldEvolution/i.test(script.name) ||
      /(?:世界演变|%E4%B8%96%E7%95%8C%E6%BC%94%E5%8F%98)|world_evolution_settings_v1/i.test(script.content) ||
      (script.data && Object.hasOwn(script.data, 'world_evolution_settings_v1'))
    )
      throw new Error('检测到其他启用的世界演变入口；请在脚本库停用旧脚本，而不只是关闭自动开关');
  };
  for (const list of trees) {
    if (!Array.isArray(list)) throw new Error('脚本清单不可用');
    for (const item of list) {
      if (item?.type === 'script') inspect(item);
      else if (item?.type === 'folder' && typeof item.enabled === 'boolean' && Array.isArray(item.scripts)) {
        if (item.enabled) item.scripts.forEach(inspect);
      } else throw new Error('脚本清单格式不支持');
    }
  }
}
