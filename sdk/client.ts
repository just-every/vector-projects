import {operations} from './generated.js';
import type {Operations} from './generated.js';
export {operations} from './generated.js';
export type {Components, Operations} from './generated.js';

export type OperationId = keyof Operations;
export type Input<K extends OperationId> = Operations[K]['input'];
export type Output<K extends OperationId> = Operations[K]['output'];
export interface ApiResult<T> { data: T; status: number; headers: Headers }
export interface ClientOptions {
  /** Installation origin; the client selects the published API prefix. */
  baseUrl: string;
  token?: string;
  /** For example, the required checkout header for local development tokens. */
  headers?: HeadersInit;
  fetch?: typeof globalThis.fetch;
}

/** Carries the original error body and response headers without logging them. */
export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;
  readonly headers: Headers;
  constructor(response: Response, body: unknown) {
    // Do not put a URL, credential, request body or server text in the message.
    super(`Vector API request failed (HTTP ${response.status})`);
    this.name = 'ApiError';
    this.status = response.status;
    this.body = body;
    this.headers = new Headers(response.headers);
  }
}

export class VectorClient {
  readonly #origin: string;
  readonly #token?: string;
  readonly #headers: Headers;
  readonly #fetch: typeof globalThis.fetch;
  constructor(options: ClientOptions) {
    const url = new URL(options.baseUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
        url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) {
      throw new Error('Use an installation origin without credentials, a path, query or fragment');
    }
    if (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
      throw new Error('Use HTTPS except for a loopback installation');
    }
    this.#origin = url.origin;
    this.#token = options.token;
    this.#headers = new Headers(options.headers);
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  async request<K extends OperationId>(id: K, input: Input<K>, options: {signal?: AbortSignal} = {}): Promise<ApiResult<Output<K>>> {
    const operation = operations[id];
    if (!operation) throw new Error('Unknown published operation');
    const args = input as {path?: Record<string, string>; query?: Record<string, unknown>; body?: unknown};
    const path = operation.path.replace(/\{([^}]+)\}/g, (_match, key: string) => {
      const value = args.path?.[key];
      if (typeof value !== 'string' || !value || value === '.' || value === '..') throw new Error('Missing or invalid path parameter');
      return encodeURIComponent(value);
    });
    const url = new URL('/api/v1' + path, this.#origin);
    for (const [key, value] of Object.entries(args.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    const headers = new Headers(this.#headers);
    // This is a server client. Never add browser cookie authority or forward a
    // credential to a redirect destination; the caller chooses one origin.
    headers.delete('cookie');
    headers.delete('authorization');
    if (operation.authenticated && this.#token) headers.set('Authorization', 'Bearer ' + this.#token);
    headers.set('Accept', 'application/json');
    if (args.body !== undefined) headers.set('Content-Type', 'application/json');
    let response: Response;
    try {
      response = await this.#fetch(url, {method:operation.method, headers,
        body:args.body === undefined ? undefined : JSON.stringify(args.body),
        credentials:'omit', redirect:'manual', signal:options.signal});
    } catch {
      throw new Error('Vector API transport failed');
    }
    const text = await response.text();
    let data: unknown = undefined;
    if (text) {
      try { data = JSON.parse(text); } catch { data = text; }
    }
    if (!response.ok) throw new ApiError(response, data);
    return {data:data as Output<K>, status:response.status, headers:new Headers(response.headers)};
  }
}
