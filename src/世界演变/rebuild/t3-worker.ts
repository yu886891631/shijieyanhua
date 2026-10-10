import { createT3BrowserRuntime } from './t3-browser-runtime';
import { executeT3Request } from './t3-engine';
import {
  T3_DOMAIN_ERROR_CODES,
  type T3WorkerDomainErrorCode,
  type T3WorkerExecuteMessage,
  type T3WorkerResultMessage,
} from './t3-runtime';

type T3WorkerScope = {
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  postMessage(message: T3WorkerResultMessage): void;
};

const scope = globalThis as unknown as T3WorkerScope;
let consumed = false;

// This module is a worker-only entry. It is not imported by the current production script.
scope.addEventListener('message', async event => {
  if (consumed) return;
  consumed = true;
  try {
    const input = event.data;
    if (
      input === null ||
      typeof input !== 'object' ||
      Object.getPrototypeOf(input) !== Object.prototype ||
      Object.keys(input).sort().join(',') !== 'request,type' ||
      (input as { type?: unknown }).type !== 'execute'
    ) {
      throw new Error('SQLite Worker 请求格式不匹配。');
    }
    const SQL = await createT3BrowserRuntime();
    const result = executeT3Request(SQL, (input as T3WorkerExecuteMessage).request);
    scope.postMessage({ type: 'result', result });
  } catch (error) {
    // Raw parser/constraint messages may contain SQL or private values; only structured locations cross the boundary.
    const message = 'SQLite Worker 初始化或执行未通过校验。';
    const object =
      error !== null && typeof error === 'object'
        ? (error as { code?: unknown; statementIndex?: unknown; fieldId?: unknown; tableId?: unknown })
        : {};
    const code: T3WorkerDomainErrorCode =
      typeof object.code === 'string' && T3_DOMAIN_ERROR_CODES.includes(object.code as T3WorkerDomainErrorCode)
        ? (object.code as T3WorkerDomainErrorCode)
        : 'WORKER_EXECUTION';
    const statementIndex =
      Number.isSafeInteger(object.statementIndex) &&
      (object.statementIndex as number) >= 0 &&
      (object.statementIndex as number) < 32
        ? (object.statementIndex as number)
        : undefined;
    const fieldId =
      typeof object.fieldId === 'string' &&
      /^[a-z][a-z0-9_-]{0,63}$/.test(object.fieldId) &&
      !['constructor', 'prototype'].includes(object.fieldId)
        ? object.fieldId
        : undefined;
    const tableId =
      typeof object.tableId === 'string' &&
      /^[a-z][a-z0-9_-]{0,63}$/.test(object.tableId) &&
      !['constructor', 'prototype'].includes(object.tableId)
        ? object.tableId
        : undefined;
    scope.postMessage({
      type: 'error',
      error: {
        code,
        message,
        ...(statementIndex === undefined ? {} : { statementIndex }),
        ...(fieldId === undefined ? {} : { fieldId }),
        ...(tableId === undefined ? {} : { tableId }),
      },
    });
  }
});
