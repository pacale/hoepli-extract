// Authenticated API session for the platform.
//
// Authentication is two-layered:
//   * a session cookie (read from the browser, never stored by this tool)
//   * an AUTH_TOKEN header, re-read from /api/v6/user on every session
//
// The token is short lived and rotated by the server, so it is always fetched
// fresh instead of being persisted.

import { log, redact, USER_AGENT, sleep } from './util.mjs';

export const API_BASE = 'https://www.hoepliacademy.it';
export const READER_BASE = 'https://my.hoepliacademy.it';

export class SessionError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

/** Translate a platform status into something a user can act on. */
export function describeStatus(status) {
  switch (status) {
    case 401:
      return 'HTTP 401 (session expired, sign in again)';
    case 403:
      return 'HTTP 403 (your account is not licensed for this book)';
    case 404:
      return 'HTTP 404 (the book does not exist or is not available)';
    case 429:
      return 'HTTP 429 (too many requests, slow down)';
    case 500:
    case 502:
    case 503:
      return `HTTP ${status} (the platform is having trouble, retrying)`;
    default:
      return `HTTP ${status}`;
  }
}

export class Session {
  constructor(cookie, token) {
    this.cookie = cookie;
    this.token = token;
  }

  headers(extra = {}) {
    const h = {
      Accept: 'application/json',
      'User-Agent': USER_AGENT,
      Referer: `${READER_BASE}/`,
      ...extra,
    };
    if (this.cookie) h.Cookie = this.cookie;
    if (this.token) h.AUTH_TOKEN = this.token;
    return h;
  }

  async request(path, { method = 'GET', body, headers = {}, retry = true, timeoutMs = 30000 } = {}) {
    const init = { method, headers: this.headers(headers) };
    if (body !== undefined) {
      init.body = typeof body === 'string' ? body : JSON.stringify(body);
      init.headers['Content-Type'] = 'application/json';
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res;
    try {
      res = await fetch(API_BASE + path, { ...init, signal: controller.signal });
    } catch (e) {
      clearTimeout(timer);
      const aborted = e?.name === 'AbortError';
      if (retry) {
        log.debug(`${method} ${path} ${aborted ? 'timed out' : e.message}, retrying`);
        return this.request(path, { method, body, headers, retry: false, timeoutMs });
      }
      throw new SessionError(
        aborted ? `${method} ${path} timed out after ${timeoutMs}ms` : `${method} ${path} failed: ${e.message}`
      );
    }
    clearTimeout(timer);
    if (res.status === 401 && retry && this.token) {
      log.debug('token rejected, refreshing');
      await this.refreshToken();
      return this.request(path, { method, body, headers, retry: false, timeoutMs });
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new SessionError(
        `${method} ${path} -> ${describeStatus(res.status)} ${redact(text).slice(0, 200)}`,
        res.status
      );
    }
    return res;
  }

  async json(path, options) {
    const res = await this.request(path, options);
    return res.json();
  }

  async refreshToken() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    let res;
    try {
      res = await fetch(`${API_BASE}/api/v6/user`, {
        headers: this.headers({ AUTH_TOKEN: undefined }),
        signal: controller.signal,
      });
    } catch (e) {
      clearTimeout(timer);
      throw new SessionError(`cannot refresh the session: ${e.message}`);
    }
    clearTimeout(timer);
    if (!res.ok) throw new SessionError(`cannot refresh the session: ${describeStatus(res.status)}`, res.status);
    const user = await res.json();
    this.token = user?.auth_token || null;
    if (!this.token) throw new SessionError('the server did not return an auth_token');
    return this.token;
  }

  /** Build a session from a raw Cookie header string. */
  static async fromCookieHeader(cookieHeader) {
    const session = new Session(cookieHeader, null);
    await session.refreshToken();
    return session;
  }

  /** Build a session from explicit credentials (manual/headless usage). */
  static async fromCredentials({ cookie, token } = {}) {
    if (!cookie) throw new SessionError('no cookie supplied');
    const session = new Session(cookie, token || null);
    if (!session.token) await session.refreshToken();
    return session;
  }
}

/**
 * Wait until the browser session becomes valid.
 *
 * The browser is polled every two seconds; the caller supplies the probe so
 * the behaviour can be tested without a browser.
 */
export async function waitForAuthentication({ timeoutSec = 600, probe, onTick = () => {} }) {
  const deadline = Date.now() + timeoutSec * 1000;
  let attempt = 0;
  while (Date.now() < deadline) {
    attempt++;
    try {
      const session = await probe();
      if (session) return session;
    } catch (e) {
      if (e.status && e.status !== 401) throw e;
    }
    onTick(attempt, Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    await sleep(2000);
  }
  throw new SessionError(`no valid session after ${timeoutSec} seconds`);
}
