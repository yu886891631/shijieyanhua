import type { T3Request, T3Result } from './t3-engine';
import { cloneT2Json } from './t2-template';
import { freezeT3Request, normalizeT3Result } from './t3-result';

export type T3WorkerEventType = 'message' | 'error' | 'messageerror';
export type T3WorkerEvent = { data?: unknown; message?: string; preventDefault?: () => void };
export type T3WorkerListener = (event: T3WorkerEvent) => void;

/** Only this transport can stop a synchronous SQLite job while it is running. */
export interface T3WorkerPort {
  addEventListener(type: T3WorkerEventType, listener: T3WorkerListener): void;
  removeEventListener(type: T3WorkerEventType, listener: T3WorkerListener): void;
  postMessage(message: T3WorkerExecuteMessage): void;
  terminate(): void;
}

export type T3WorkerExecuteMessage = { type: 'execute'; request: T3Request };
export const T3_DOMAIN_ERROR_CODES = Object.freeze([
  'INPUT',
  'SQL',
  'AUTHORIZATION',
  'LIMIT',
  'DATA',
  'CONSTRAINT',
  'WORKER_EXECUTION',
] as const);
export type T3WorkerDomainErrorCode = (typeof T3_DOMAIN_ERROR_CODES)[number];
export type T3WorkerErrorDetails = { statementIndex?: number; fieldId?: string; tableId?: string };
export type T3WorkerErrorPayload = T3WorkerErrorDetails & { code: T3WorkerDomainErrorCode; message: string };
export type T3WorkerResultMessage =
  | { type: 'result'; result: T3Result }
  | { type: 'error'; error: T3WorkerErrorPayload };
export type T3RuntimeErrorCode = 'ABORTED' | 'TIMEOUT' | 'WORKER_START' | 'WORKER_ERROR' | 'PROTOCOL';

export class T3RuntimeError extends Error {
  readonly code: T3RuntimeErrorCode;
  readonly domainCode?: T3WorkerDomainErrorCode;
  readonly details?: Readonly<T3WorkerErrorDetails>;

  constructor(
    code: T3RuntimeErrorCode,
    message: string,
    domain?: { code: T3WorkerDomainErrorCode; details: T3WorkerErrorDetails },
  ) {
    super(message);
    this.name = 'T3RuntimeError';
    this.code = code;
    if (domain) {
      this.domainCode = domain.code;
      this.details = Object.freeze({ ...domain.details });
    }
  }
}

function validateTimeout(timeoutMs: number): number {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
    throw new T3RuntimeError('PROTOCOL', 'SQLite 工作超时必须是 1–60000 毫秒的整数。');
  }
  return timeoutMs;
}

function isPlainRecord(input: unknown): input is Record<string, unknown> {
  return input !== null && typeof input === 'object' && Object.getPrototypeOf(input) === Object.prototype;
}

function transportMessage(input: unknown, request: T3Request): T3WorkerResultMessage {
  try {
    input = cloneT2Json(input);
  } catch {
    throw new T3RuntimeError('PROTOCOL', 'SQLite Worker 返回了非 JSON 或过大的消息。');
  }
  if (!isPlainRecord(input)) throw new T3RuntimeError('PROTOCOL', 'SQLite Worker 返回了无效消息。');
  if (input.type === 'result' && Object.keys(input).sort().join(',') === 'result,type' && isPlainRecord(input.result)) {
    try {
      return { type: 'result', result: normalizeT3Result(input.result, request) };
    } catch {
      throw new T3RuntimeError('PROTOCOL', 'SQLite Worker 返回了无效结果或不匹配的世界身份。');
    }
  }
  if (
    input.type === 'error' &&
    Object.keys(input).sort().join(',') === 'error,type' &&
    isPlainRecord(input.error) &&
    Object.keys(input.error).every(key => ['code', 'message', 'statementIndex', 'fieldId', 'tableId'].includes(key)) &&
    Object.hasOwn(input.error, 'code') &&
    Object.hasOwn(input.error, 'message') &&
    typeof input.error.code === 'string' &&
    T3_DOMAIN_ERROR_CODES.includes(input.error.code as T3WorkerDomainErrorCode) &&
    typeof input.error.message === 'string' &&
    input.error.message.length > 0 &&
    input.error.message.length <= 2000 &&
    (!Object.hasOwn(input.error, 'statementIndex') ||
      (Number.isSafeInteger(input.error.statementIndex) &&
        (input.error.statementIndex as number) >= 0 &&
        (input.error.statementIndex as number) < 32)) &&
    (!Object.hasOwn(input.error, 'fieldId') ||
      (typeof input.error.fieldId === 'string' &&
        /^[a-z][a-z0-9_-]{0,63}$/.test(input.error.fieldId) &&
        !['constructor', 'prototype'].includes(input.error.fieldId))) &&
    (!Object.hasOwn(input.error, 'tableId') ||
      (typeof input.error.tableId === 'string' &&
        /^[a-z][a-z0-9_-]{0,63}$/.test(input.error.tableId) &&
        !['constructor', 'prototype'].includes(input.error.tableId)))
  ) {
    return input as T3WorkerResultMessage;
  }
  throw new T3RuntimeError('PROTOCOL', 'SQLite Worker 消息格式不匹配。');
}

export type T3RunOptions = { signal?: AbortSignal; timeoutMs?: number };
export type T3WorkerRunner = { run(request: T3Request, options?: T3RunOptions): Promise<T3Result> };

/** One fresh worker per request. No shared database, worker pool, persistence, or host access. */
export function createT3WorkerRunner(workerFactory: () => T3WorkerPort, defaultTimeoutMs = 10_000): T3WorkerRunner {
  validateTimeout(defaultTimeoutMs);
  return {
    run(request, options = {}) {
      return new Promise<T3Result>((resolve, reject) => {
        const timeoutMs = validateTimeout(options.timeoutMs ?? defaultTimeoutMs);
        const signal = options.signal;
        if (signal?.aborted) {
          reject(new T3RuntimeError('ABORTED', 'SQLite 工作已取消；没有接受结果。'));
          return;
        }
        let frozen: T3Request;
        try {
          frozen = freezeT3Request(request);
        } catch {
          reject(new T3RuntimeError('PROTOCOL', 'SQLite 请求不是有效的纯 JSON 世界快照；没有启动工作。'));
          return;
        }
        let worker: T3WorkerPort | undefined;
        let settled = false;
        const cleanup = () => {
          clearTimeout(timer);
          signal?.removeEventListener('abort', abort);
          if (worker) {
            for (const [type, listener] of listeners) {
              try {
                worker.removeEventListener(type, listener);
              } catch {
                // Always attempt termination even if a broken adapter fails cleanup.
              }
            }
            try {
              worker.terminate();
            } catch {
              // The result stays rejected/settled; cleanup errors must not replace it.
            }
          }
        };
        const finish = (result?: T3Result, error?: Error) => {
          if (settled) return;
          settled = true;
          cleanup();
          if (error) reject(error);
          else resolve(result!);
        };
        const abort = () => finish(undefined, new T3RuntimeError('ABORTED', 'SQLite 工作已取消；没有接受结果。'));
        const message: T3WorkerListener = event => {
          try {
            const reply = transportMessage(event.data, frozen);
            if (reply.type === 'result') finish(reply.result);
            else
              finish(
                undefined,
                new T3RuntimeError('WORKER_ERROR', 'SQLite 工作未通过校验；请查看错误类别和结构化位置。', {
                  code: reply.error.code,
                  details: {
                    ...(reply.error.statementIndex === undefined ? {} : { statementIndex: reply.error.statementIndex }),
                    ...(reply.error.fieldId === undefined ? {} : { fieldId: reply.error.fieldId }),
                    ...(reply.error.tableId === undefined ? {} : { tableId: reply.error.tableId }),
                  },
                }),
              );
          } catch (error) {
            finish(undefined, error instanceof Error ? error : new T3RuntimeError('PROTOCOL', 'SQLite 消息无效。'));
          }
        };
        const workerError: T3WorkerListener = event => {
          event.preventDefault?.();
          finish(undefined, new T3RuntimeError('WORKER_ERROR', 'SQLite Worker 执行失败，没有接受结果。'));
        };
        const messageError: T3WorkerListener = () =>
          finish(undefined, new T3RuntimeError('PROTOCOL', 'SQLite Worker 无法解码消息，没有接受结果。'));
        const listeners: [T3WorkerEventType, T3WorkerListener][] = [
          ['message', message],
          ['error', workerError],
          ['messageerror', messageError],
        ];
        const timer = setTimeout(
          () => finish(undefined, new T3RuntimeError('TIMEOUT', 'SQLite 工作超时，Worker 已终止；没有接受结果。')),
          timeoutMs,
        );
        signal?.addEventListener('abort', abort, { once: true });
        try {
          worker = workerFactory();
          for (const [type, listener] of listeners) worker.addEventListener(type, listener);
          // An adapter may synchronously abort during creation. Never start that job.
          if (signal?.aborted) abort();
          if (!settled) worker.postMessage({ type: 'execute', request: frozen });
          else cleanup();
        } catch {
          finish(undefined, new T3RuntimeError('WORKER_START', 'SQLite Worker 启动或发送失败，没有接受结果。'));
        }
      });
    },
  };
}

/** The caller provides a locally bundled worker source, not a URL or CDN import. */
export function createT3BrowserWorkerFactory(workerSource: string): () => T3WorkerPort {
  if (typeof workerSource !== 'string' || workerSource.trim().length === 0) {
    throw new T3RuntimeError('WORKER_START', '缺少本地 SQLite Worker bundle。');
  }
  return () => {
    const url = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }));
    let nativeWorker: Worker;
    try {
      nativeWorker = new Worker(url, { name: 'world-evolution-sqlite-t3' });
    } catch (error) {
      URL.revokeObjectURL(url);
      throw error;
    }
    let released = false;
    return {
      addEventListener: (type, listener) => nativeWorker.addEventListener(type, listener as EventListener),
      removeEventListener: (type, listener) => nativeWorker.removeEventListener(type, listener as EventListener),
      postMessage: message => nativeWorker.postMessage(message),
      terminate() {
        if (released) return;
        released = true;
        try {
          nativeWorker.terminate();
        } finally {
          URL.revokeObjectURL(url);
        }
      },
    };
  };
}
