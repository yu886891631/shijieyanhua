/** Explicit real-API transport. No startup requests, implicit credentials, redirects or host saves. */
import { WorldEvolutionApiClientError, type WorldEvolutionApiFetch } from '../api-client';

export interface T15ApiTransport {
  readonly mode: 'real-api';
  dispatch(url: string, init: RequestInit): Promise<Response>;
}

/** Integration code supplies fetch and a synchronous, current-session permission check.
 * A user-imported JSON flag can never supply this function. Rechecked on each retry. */
export function createT15ApiTransport(options: {
  fetchImpl: WorldEvolutionApiFetch;
  authorize: () => void;
}): T15ApiTransport {
  const fetchImpl = options.fetchImpl,
    authorize = options.authorize;
  return Object.freeze({
    mode: 'real-api' as const,
    async dispatch(endpoint: string, init: RequestInit) {
      let url: URL;
      try {
        url = new URL(endpoint);
      } catch {
        throw new WorldEvolutionApiClientError('CONFIG', 'API 端点无效', false);
      }
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.hash ||
        init.method !== 'POST' ||
        typeof init.body !== 'string' ||
        init.body.length > 1_000_000 ||
        !init.signal
      ) {
        throw new WorldEvolutionApiClientError('CONFIG', 'API 请求不符合安全传输范围', false);
      }
      const headers = new Headers(init.headers);
      if (headers.get('Content-Type') !== 'application/json' || !/^Bearer \S/.test(headers.get('Authorization') ?? ''))
        throw new WorldEvolutionApiClientError('CONFIG', 'API 请求配置不完整', false);
      // Do not inherit browser cookies or allow a redirect to carry the configured credential elsewhere.
      const request: RequestInit = { ...init, headers, credentials: 'omit', redirect: 'error', cache: 'no-store' };
      if (init.signal.aborted) throw Object.assign(new Error('已取消'), { name: 'AbortError' });
      try {
        const verdict = authorize();
        if (verdict !== undefined) {
          // Do not await an async permission check or allow its rejection to escape as an unhandled promise.
          void Promise.resolve(verdict).catch(() => {});
          throw new Error('授权检查必须同步完成');
        }
      } catch {
        throw new WorldEvolutionApiClientError('CONFIG', '当前会话未获准发送真实请求', false);
      }
      if (init.signal.aborted) throw Object.assign(new Error('已取消'), { name: 'AbortError' });
      return fetchImpl(url.href, request);
    },
  });
}
