type AcquireOptions = {
  signal?: AbortSignal;
  /** 优先尝试该路由（须仍在链内且有空闲槽位） */
  preferredRoute?: string;
};

type Waiter = {
  resolve: (route: string) => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
};

export class TaskApiRouteConcurrencyPool {
  private readonly activeCounts = new Map<string, number>();
  private readonly waitQueue: Waiter[] = [];

  constructor(
    private readonly routes: readonly string[],
    private readonly maxPerRouteByRoute: ReadonlyMap<string, number>,
  ) {
    for (const route of routes) {
      this.activeCounts.set(route, 0);
    }
  }

  getRoutes(): readonly string[] {
    return this.routes;
  }

  getMaxPerRoute(route: string): number {
    return this.maxPerRouteByRoute.get(route) ?? 0;
  }

  getActiveCount(route: string): number {
    return this.activeCounts.get(route) ?? 0;
  }

  private getCap(route: string): number {
    const configured = this.maxPerRouteByRoute.get(route) ?? 0;
    return configured <= 0 ? Number.POSITIVE_INFINITY : configured;
  }

  private findAvailableRoute(preferredRoute?: string): string | null {
    if (preferredRoute && this.routes.includes(preferredRoute)) {
      const preferredActive = this.activeCounts.get(preferredRoute) ?? 0;
      if (preferredActive < this.getCap(preferredRoute)) return preferredRoute;
    }
    for (const route of this.routes) {
      const active = this.activeCounts.get(route) ?? 0;
      if (active < this.getCap(route)) return route;
    }
    return null;
  }

  private occupy(route: string): void {
    this.activeCounts.set(route, (this.activeCounts.get(route) ?? 0) + 1);
  }

  async acquire(options?: AcquireOptions): Promise<string> {
    const signal = options?.signal;
    if (signal?.aborted) {
      throw new DOMException('工作流已取消', 'AbortError');
    }

    const immediate = this.findAvailableRoute(options?.preferredRoute);
    if (immediate) {
      this.occupy(immediate);
      return immediate;
    }

    return new Promise<string>((resolve, reject) => {
      const waiter: Waiter = { resolve, reject, signal };
      if (signal) {
        const onAbort = () => {
          const idx = this.waitQueue.indexOf(waiter);
          if (idx >= 0) this.waitQueue.splice(idx, 1);
          reject(new DOMException('工作流已取消', 'AbortError'));
        };
        waiter.onAbort = onAbort;
        signal.addEventListener('abort', onAbort, { once: true });
      }
      this.waitQueue.push(waiter);
    });
  }

  release(route: string, preferNextOn?: string): void {
    const active = this.activeCounts.get(route) ?? 0;
    this.activeCounts.set(route, Math.max(0, active - 1));
    this.dispatchWaiters(preferNextOn ?? route);
  }

  private dispatchWaiters(preferredRoute?: string): void {
    let prefer = preferredRoute;
    while (this.waitQueue.length > 0) {
      const route = this.findAvailableRoute(prefer);
      if (!route) break;

      const waiter = this.waitQueue.shift()!;
      if (waiter.signal?.aborted) {
        waiter.reject(new DOMException('工作流已取消', 'AbortError'));
        continue;
      }
      if (waiter.onAbort && waiter.signal) {
        waiter.signal.removeEventListener('abort', waiter.onAbort);
      }

      this.occupy(route);
      waiter.resolve(route);
      prefer = undefined;
    }
  }

  async run<T>(fn: (route: string) => Promise<T>, options?: AcquireOptions): Promise<T> {
    const route = await this.acquire(options);
    try {
      return await fn(route);
    } finally {
      this.release(route);
    }
  }
}

export class RouteConcurrencyPoolRegistry {
  private readonly pools = new Map<string, TaskApiRouteConcurrencyPool>();

  getOrCreate(
    key: string,
    routes: readonly string[],
    maxPerRouteByRoute: ReadonlyMap<string, number>,
  ): TaskApiRouteConcurrencyPool | null {
    if (routes.length === 0) return null;
    const existing = this.pools.get(key);
    if (existing) return existing;
    const pool = new TaskApiRouteConcurrencyPool(routes, maxPerRouteByRoute);
    this.pools.set(key, pool);
    return pool;
  }
}

export function buildRoutePoolKey(
  taskScopeId: string,
  presetChain: readonly string[],
  limits: ReadonlyMap<string, number>,
): string {
  const limitPart = presetChain.map(route => `${route}:${limits.get(route) ?? 0}`).join('>');
  return `${taskScopeId}::${limitPart}`;
}
