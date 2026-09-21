export class RunCancelledError extends Error {
  constructor(message = 'TaskAbortedByUser') {
    super(message);
    this.name = 'RunCancelledError';
  }
}

let abortController: AbortController | null = null;
let runEpoch = 0;
const activeGenerationIds = new Set<string>();

export function beginRun(): { signal: AbortSignal; epoch: number } {
  abortController?.abort();
  abortController = new AbortController();
  activeGenerationIds.clear();
  const epoch = ++runEpoch;
  return { signal: abortController.signal, epoch };
}

export function endRun(epoch?: number): void {
  if (epoch !== undefined && epoch !== runEpoch) return;
  abortController = null;
  activeGenerationIds.clear();
}

export function getRunEpoch(): number {
  return runEpoch;
}

export function getRunSignal(): AbortSignal | undefined {
  return abortController?.signal;
}

export function registerGenerationId(generationId: string): void {
  if (generationId) activeGenerationIds.add(generationId);
}

export function unregisterGenerationId(generationId: string): void {
  activeGenerationIds.delete(generationId);
}

export function requestCancelRun(): void {
  for (const id of activeGenerationIds) {
    try {
      stopGenerationById(id);
    } catch {
      // ignore
    }
  }
  activeGenerationIds.clear();
  abortController?.abort();
}

export function checkRunCancelled(signal?: AbortSignal): void {
  if (signal?.aborted || abortController?.signal.aborted) {
    throw new RunCancelledError();
  }
}

export function isRunCancelled(signal?: AbortSignal): boolean {
  return Boolean(signal?.aborted || abortController?.signal.aborted);
}

export async function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  checkRunCancelled(signal);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = () => {
      cleanup();
      reject(new RunCancelledError());
    };
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

type SchedulerWithYield = { yield: () => Promise<void> };

function getSchedulerYield(): (() => Promise<void>) | undefined {
  const scheduler = (globalThis as typeof globalThis & { scheduler?: Partial<SchedulerWithYield> }).scheduler;
  return typeof scheduler?.yield === 'function' ? scheduler.yield.bind(scheduler) : undefined;
}

/** 把控制权交还浏览器一拍，便于绘制与点击；取消时立即抛错，不用 setTimeout 当竞态补丁。 */
export async function yieldToMain(signal?: AbortSignal): Promise<void> {
  checkRunCancelled(signal);
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let channel: MessageChannel | undefined;
    const onAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new RunCancelledError());
    };
    const cleanup = () => {
      signal?.removeEventListener('abort', onAbort);
      channel?.port1.close();
      channel?.port2.close();
    };
    const finish = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    const yieldFn = getSchedulerYield();
    if (yieldFn) {
      yieldFn().then(finish, fail);
      return;
    }
    channel = new MessageChannel();
    channel.port1.onmessage = finish;
    channel.port2.postMessage(undefined);
  });
  checkRunCancelled(signal);
}

export type SerialGate = {
  run<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T>;
};

/** 阶段内 FIFO 串行门闩：一次只跑一段 CPU 工作，等待者可被取消且必须 release。 */
export function createSerialGate(): SerialGate {
  let tail: Promise<void> = Promise.resolve();
  return {
    async run<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
      const prev = tail;
      let release!: () => void;
      tail = new Promise<void>(resolve => {
        release = resolve;
      });
      try {
        await prev;
        checkRunCancelled(signal);
        await yieldToMain(signal);
        return await fn();
      } finally {
        release();
      }
    },
  };
}
