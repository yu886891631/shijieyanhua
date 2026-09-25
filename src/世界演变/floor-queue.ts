export type WorldEvolutionQueueSource = 'generation-ended' | 'workflow-completed' | 'manual' | 'retry';

export type WorldEvolutionQueueTask = {
  chatKey: string;
  messageId: number;
  source: WorldEvolutionQueueSource;
  enqueuedAt: number;
  attempt: number;
};

export type WorldEvolutionQueueResult = {
  status: string;
  messageId: number;
  error?: string;
};

export type WorldEvolutionQueueSnapshot = {
  pending: WorldEvolutionQueueTask[];
  running: WorldEvolutionQueueTask | null;
};

type QueueOptions = {
  maxRetries?: number;
  retryDelayMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  onStateChange?: (snapshot: WorldEvolutionQueueSnapshot) => void;
};

export type WorldEvolutionQueueConfig = {
  maxRetries?: number;
  retryDelayMs?: number;
};

type WaitingTask = {
  task: WorldEvolutionQueueTask;
  resolve: (result: WorldEvolutionQueueResult) => void;
  reject: (error: unknown) => void;
  promise: Promise<WorldEvolutionQueueResult>;
};

const defaultSleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/**
 * 数据库式的单并发楼层队列：
 * - 同一聊天/楼层只保留一份任务；
 * - 任务始终串行执行，避免两个 AI 结果同时覆盖世界状态；
 * - 失败可自动重试，最终结果仍由调用方决定如何记录。
 */
export class WorldEvolutionFloorQueue {
  private readonly pending: WaitingTask[] = [];
  private readonly pendingByKey = new Map<string, WaitingTask>();
  private running: WaitingTask | null = null;
  private runningPromise: Promise<WorldEvolutionQueueResult> | null = null;
  private pumpRunning = false;
  private maxRetries: number;
  private retryDelayMs: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly onStateChange?: (snapshot: WorldEvolutionQueueSnapshot) => void;

  public constructor(
    private readonly runner: (task: WorldEvolutionQueueTask) => Promise<WorldEvolutionQueueResult>,
    options?: QueueOptions,
  ) {
    this.maxRetries = Math.max(0, Math.floor(options?.maxRetries ?? 2));
    this.retryDelayMs = Math.max(0, Math.floor(options?.retryDelayMs ?? 1500));
    this.now = options?.now ?? Date.now;
    this.sleep = options?.sleep ?? defaultSleep;
    this.onStateChange = options?.onStateChange;
  }

  public getSnapshot(): WorldEvolutionQueueSnapshot {
    return {
      pending: this.pending.map(item => ({ ...item.task })),
      running: this.running ? { ...this.running.task } : null,
    };
  }

  public configure(config: WorldEvolutionQueueConfig): void {
    if (config.maxRetries != null && Number.isFinite(config.maxRetries)) {
      this.maxRetries = Math.max(0, Math.floor(config.maxRetries));
    }
    if (config.retryDelayMs != null && Number.isFinite(config.retryDelayMs)) {
      this.retryDelayMs = Math.max(0, Math.floor(config.retryDelayMs));
    }
  }

  public schedule(
    chatKey: string,
    messageId: number,
    source: WorldEvolutionQueueSource,
  ): Promise<WorldEvolutionQueueResult> {
    const key = this.keyOf(chatKey, messageId);
    const existing = this.pendingByKey.get(key);
    if (existing) return existing.promise;
    if (this.running && this.keyOf(this.running.task.chatKey, this.running.task.messageId) === key) {
      return this.runningPromise ?? Promise.resolve({ status: 'deduped', messageId });
    }

    const task: WorldEvolutionQueueTask = {
      chatKey,
      messageId,
      source,
      enqueuedAt: this.now(),
      attempt: 0,
    };
    let resolvePromise!: (result: WorldEvolutionQueueResult) => void;
    let rejectPromise!: (error: unknown) => void;
    const promise = new Promise<WorldEvolutionQueueResult>((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });
    const waiting: WaitingTask = { task, resolve: resolvePromise, reject: rejectPromise, promise };
    this.pending.push(waiting);
    this.pendingByKey.set(key, waiting);
    this.emitState();
    void this.pump();
    return promise;
  }

  public cancel(chatKey: string, messageId: number): boolean {
    const key = this.keyOf(chatKey, messageId);
    const waiting = this.pendingByKey.get(key);
    if (!waiting) return false;
    const index = this.pending.indexOf(waiting);
    if (index >= 0) this.pending.splice(index, 1);
    this.pendingByKey.delete(key);
    waiting.resolve({ status: 'cancelled', messageId });
    this.emitState();
    return true;
  }

  private async pump(): Promise<void> {
    if (this.pumpRunning) return;
    this.pumpRunning = true;
    try {
      while (this.pending.length > 0) {
        const waiting = this.pending.shift()!;
        this.pendingByKey.delete(this.keyOf(waiting.task.chatKey, waiting.task.messageId));
        this.running = waiting;
        this.runningPromise = waiting.promise;
        this.emitState();
        const result = await this.runWithRetries(waiting.task);
        this.running = null;
        this.runningPromise = null;
        waiting.resolve(result);
        this.emitState();
      }
    } catch (error) {
      // runner 的异常也必须释放队列，防止一次异常永久卡死后续楼层。
      const waiting = this.running;
      this.running = null;
      if (waiting) waiting.reject(error);
      this.emitState();
    } finally {
      this.pumpRunning = false;
      if (this.pending.length > 0) void this.pump();
    }
  }

  private async runWithRetries(task: WorldEvolutionQueueTask): Promise<WorldEvolutionQueueResult> {
    let lastResult: WorldEvolutionQueueResult = {
      status: 'failed',
      messageId: task.messageId,
      error: '任务未执行',
    };
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      task.attempt = attempt + 1;
      try {
        lastResult = await this.runner({ ...task });
      } catch (error) {
        lastResult = {
          status: 'failed',
          messageId: task.messageId,
          error: error instanceof Error ? error.message : String(error),
        };
      }
      if (lastResult.status !== 'failed' || attempt >= this.maxRetries) return lastResult;
      if (this.retryDelayMs > 0) await this.sleep(this.retryDelayMs);
    }
    return lastResult;
  }

  private keyOf(chatKey: string, messageId: number): string {
    return `${chatKey}\u0000${messageId}`;
  }

  private emitState(): void {
    this.onStateChange?.(this.getSnapshot());
  }
}

export type StableReadOptions<T> = {
  read: () => Promise<T> | T;
  equals?: (left: T, right: T) => boolean;
  pollMs?: number;
  stableSamples?: number;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
};

/**
 * 等待宿主楼层物化完成。数据库也采用“延迟 + 再读取”的思路；
 * 这里用连续相同快照作为稳定判据，测试时可注入 sleep。
 */
export async function waitForStableSnapshot<T>(options: StableReadOptions<T>): Promise<T> {
  const equals = options.equals ?? Object.is;
  const pollMs = Math.max(0, options.pollMs ?? 200);
  const stableSamples = Math.max(1, Math.floor(options.stableSamples ?? 2));
  const timeoutMs = Math.max(pollMs, options.timeoutMs ?? 5000);
  const sleep = options.sleep ?? defaultSleep;
  const startedAt = Date.now();
  let previous = await options.read();
  let stableCount = 1;

  while (stableCount < stableSamples && Date.now() - startedAt <= timeoutMs) {
    if (pollMs > 0) await sleep(pollMs);
    const current = await options.read();
    if (equals(previous, current)) stableCount += 1;
    else stableCount = 1;
    previous = current;
  }
  return previous;
}
