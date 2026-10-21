// Authenticated API session for the platform.
//
// Authentication is two-layered:
//   * a session cookie (read from the browser, never stored by this tool)
//   * an AUTH_TOKEN header, re-read from /api/v6/user on every session
//
// The token is short lived and rotated by the server, so it is always fetched
// fresh instead of being persisted.

import { log, redact, USER_AGENT } from './util.mjs';

export const API_BASE = 'https://www.hoepliacademy.it';
export const READER_BASE = 'https://my.hoepliacademy.it';

export class SessionError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
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

  async request(path, { method = 'GET', body, headers = {}, retry = true } = {}) {
    const init = { method, headers: this.headers(headers) };
    if (body !== undefined) {
      init.body = typeof body === 'string' ? body : JSON.stringify(body);
      init.headers['Content-Type'] = 'application/json';
    }
    const res = await fetch(API_BASE + path, init);
    if (res.status === 401 && retry && this.token) {
      log.debug('token rejected, refreshing');
      await this.refreshToken();
      return this.request(path, { method, body, headers, retry: false });
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new SessionError(
        `${method} ${path} -> HTTP ${res.status} ${redact(text).slice(0, 200)}`,
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
    const res = await fetch(`${API_BASE}/api/v6/user`, { headers: this.headers({ AUTH_TOKEN: undefined }) });
    if (!res.ok) throw new SessionError(`cannot refresh session: HTTP ${res.status}`, res.status);
    const user = await res.json();
    this.token = user?.auth_token || null;
    if (!this.token) throw new SessionError('server did not return an auth_token');
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
