/**
 * T0 隔离脚手架：只有内存 fixture，没有真实 API、宿主或持久存储入口。
 * 此模块未接入任何运行脚本；scope 只在本次模块生命周期内标识实例，
 * 不是 T2 的正式 worldId 协议，也不是 T4/T10 的事务或聊天存档实现。
 */
export type T0SandboxJson = null | boolean | number | string | T0SandboxJson[] | { [key: string]: T0SandboxJson };

export type T0SandboxAiFixture = { kind: 'success'; response: T0SandboxJson } | { kind: 'failure'; message: string };

export interface T0SandboxScope {
  readonly scopeId: string;
  readonly worldId: string;
}

export interface T0SandboxOptions {
  label?: string;
  aiFixtures: readonly T0SandboxAiFixture[];
  hostJsonFixture?: T0SandboxJson;
  worldbookFixture?: readonly T0SandboxJson[];
}

export interface T0Sandbox {
  readonly mode: 'fixture-only-memory';
  readonly scope: T0SandboxScope;
  readonly ai: {
    request(scope: T0SandboxScope, input: T0SandboxJson): Promise<T0SandboxJson>;
    readRequests(scope: T0SandboxScope): T0SandboxJson[];
  };
  readonly hostJson: {
    read(scope: T0SandboxScope): T0SandboxJson | undefined;
    write(scope: T0SandboxScope, value: T0SandboxJson): void;
  };
  readonly worldbook: {
    read(scope: T0SandboxScope): T0SandboxJson[];
    replace(scope: T0SandboxScope, entries: readonly T0SandboxJson[]): void;
  };
}

export const T0_SANDBOX_PREFIX = 'world-evolution:t0:sandbox:';

let nextSandboxSequence = 0;

/** 只接受普通 JSON；不会调用外部对象的 getter、toJSON 或自定义克隆函数。 */
function cloneJson(value: T0SandboxJson): T0SandboxJson {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'object') throw new Error('T0 sandbox fixtures must contain only JSON values.');
  if (Object.getOwnPropertySymbols(value).length > 0) throw new Error('T0 sandbox JSON cannot contain symbol keys.');

  if (Array.isArray(value)) {
    const result: T0SandboxJson[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !('value' in descriptor)) throw new Error('T0 sandbox JSON arrays must contain plain values.');
      result.push(cloneJson(descriptor.value as T0SandboxJson));
    }
    if (Object.keys(value).length !== value.length) throw new Error('T0 sandbox JSON arrays cannot have extra fields.');
    return result;
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error('T0 sandbox JSON objects must be plain objects.');
  }
  const entries = Object.entries(Object.getOwnPropertyDescriptors(value)).map(([key, descriptor]) => {
    if (!('value' in descriptor) || !descriptor.enumerable) {
      throw new Error('T0 sandbox JSON objects must contain enumerable plain values.');
    }
    return [key, cloneJson(descriptor.value as T0SandboxJson)] as const;
  });
  return Object.fromEntries(entries);
}

function cloneJsonList(values: readonly T0SandboxJson[]): T0SandboxJson[] {
  return cloneJson(values as T0SandboxJson[]) as T0SandboxJson[];
}

/** 显式 fixture 工厂；不存在 live 模式，也不接受真实 API 配置或宿主回调。 */
export function createT0Sandbox(options: T0SandboxOptions): T0Sandbox {
  const label = options.label ?? 'fixture';
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(label))
    throw new Error('T0 sandbox label must be 1–64 plain identifier characters.');
  const fixtures = options.aiFixtures.map(fixture => {
    if (fixture.kind === 'success') return { kind: 'success' as const, response: cloneJson(fixture.response) };
    if (fixture.kind === 'failure' && typeof fixture.message === 'string') {
      return { kind: 'failure' as const, message: fixture.message };
    }
    throw new Error('T0 sandbox requires an explicit success or failure AI fixture.');
  });
  let hostJson = options.hostJsonFixture === undefined ? undefined : cloneJson(options.hostJsonFixture);
  let worldbook = cloneJsonList(options.worldbookFixture ?? []);
  const requests: T0SandboxJson[] = [];
  const instanceId = `${label}:${++nextSandboxSequence}`;
  const scope = Object.freeze({
    scopeId: `${T0_SANDBOX_PREFIX}memory:${instanceId}`,
    worldId: `${T0_SANDBOX_PREFIX}world:${instanceId}`,
  });

  function assertOwnScope(candidate: T0SandboxScope): void {
    if (candidate?.scopeId !== scope.scopeId || candidate?.worldId !== scope.worldId) {
      throw new Error('T0 sandbox rejects access outside its own scope.');
    }
  }

  return Object.freeze({
    mode: 'fixture-only-memory' as const,
    scope,
    ai: Object.freeze({
      async request(candidate: T0SandboxScope, input: T0SandboxJson): Promise<T0SandboxJson> {
        assertOwnScope(candidate);
        requests.push(cloneJson(input));
        const fixture = fixtures.shift();
        if (!fixture) throw new Error('T0 sandbox AI fixture queue exhausted; no real API fallback exists.');
        if (fixture.kind === 'failure') throw new Error(`T0 sandbox simulated AI failure: ${fixture.message}`);
        return cloneJson(fixture.response);
      },
      readRequests(candidate: T0SandboxScope): T0SandboxJson[] {
        assertOwnScope(candidate);
        return cloneJsonList(requests);
      },
    }),
    hostJson: Object.freeze({
      read(candidate: T0SandboxScope): T0SandboxJson | undefined {
        assertOwnScope(candidate);
        return hostJson === undefined ? undefined : cloneJson(hostJson);
      },
      write(candidate: T0SandboxScope, value: T0SandboxJson): void {
        assertOwnScope(candidate);
        hostJson = cloneJson(value);
      },
    }),
    worldbook: Object.freeze({
      read(candidate: T0SandboxScope): T0SandboxJson[] {
        assertOwnScope(candidate);
        return cloneJsonList(worldbook);
      },
      replace(candidate: T0SandboxScope, entries: readonly T0SandboxJson[]): void {
        assertOwnScope(candidate);
        worldbook = cloneJsonList(entries);
      },
    }),
  });
}
