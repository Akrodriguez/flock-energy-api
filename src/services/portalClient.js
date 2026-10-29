import { UpstreamError } from '../utils/errors.js';

const SESSION_MARGIN_MS = 60_000; // re-login a minute before the cookie expires
const DEFAULT_SESSION_MS = 3_600_000; // observed Max-Age=3600 on the portal's session cookie

/**
 * Talks to the Urja portal: logs in with a form POST, keeps the session cookie
 * in memory, and replays it on JSON requests under /portal/*.
 * Secrets (password, cookie values) never appear in errors or logs.
 */
export class PortalClient {
  #config;
  #fetch;
  #now;
  #cookies = new Map();
  #expiresAt = 0;
  #loginInFlight = null;

  constructor(config, { fetchImpl = fetch, now = Date.now } = {}) {
    this.#config = config;
    this.#fetch = fetchImpl;
    this.#now = now;
  }

  /** GET a JSON path. Resolves { status, data } for 200 and 404; throws UpstreamError otherwise. */
  async getJson(path) {
    await this.#ensureSession();
    let res = await this.#send(path);
    if (isAuthFailure(res)) {
      // Session expired or was revoked: log in again once, then retry once.
      this.#clearSession();
      await this.#ensureSession();
      res = await this.#send(path);
      if (isAuthFailure(res)) {
        throw new UpstreamError('Portal rejected the service session', { code: 'UPSTREAM_AUTH_FAILED' });
      }
    }
    return this.#readJson(res);
  }

  #sessionValid() {
    return this.#cookies.size > 0 && this.#now() < this.#expiresAt - SESSION_MARGIN_MS;
  }

  #clearSession() {
    this.#cookies.clear();
    this.#expiresAt = 0;
  }

  // Single-flight: concurrent callers share one login instead of stampeding the portal.
  #ensureSession() {
    if (this.#sessionValid()) return Promise.resolve();
    this.#loginInFlight ??= this.#login().finally(() => {
      this.#loginInFlight = null;
    });
    return this.#loginInFlight;
  }

  async #login() {
    const { PORTAL_USERNAME, PORTAL_PASSWORD, PORTAL_BASE_URL } = this.#config;
    const res = await this.#request('/login', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/x-www-form-urlencoded',
        // SvelteKit-style CSRF checks compare Origin on form POSTs (hypothesis; harmless otherwise).
        origin: new URL(PORTAL_BASE_URL).origin,
      },
      body: new URLSearchParams({ email: PORTAL_USERNAME, password: PORTAL_PASSWORD }),
    });

    let payload = null;
    try {
      payload = await res.json();
    } catch {
      /* handled below */
    }
    const cookies = res.headers.getSetCookie();
    if (!res.ok || payload?.type !== 'redirect' || cookies.length === 0) {
      throw new UpstreamError('Portal login failed', { code: 'UPSTREAM_AUTH_FAILED' });
    }

    this.#cookies.clear();
    let maxAgeMs = DEFAULT_SESSION_MS;
    for (const line of cookies) {
      const [pair, ...attrs] = line.split(';').map((s) => s.trim());
      const eq = pair.indexOf('=');
      if (eq < 1) continue;
      this.#cookies.set(pair.slice(0, eq), pair.slice(eq + 1));
      const maxAge = attrs.find((a) => /^max-age=/i.test(a));
      if (maxAge) maxAgeMs = Number(maxAge.split('=')[1]) * 1000 || maxAgeMs;
    }
    this.#expiresAt = this.#now() + maxAgeMs;
  }

  #send(path) {
    const cookie = [...this.#cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    return this.#request(path, { headers: { accept: 'application/json', cookie } });
  }

  async #request(path, init = {}) {
    try {
      return await this.#fetch(new URL(path, this.#config.PORTAL_BASE_URL), {
        redirect: 'manual', // a redirect to /login must not be silently followed into HTML
        signal: AbortSignal.timeout(this.#config.PORTAL_TIMEOUT_MS),
        ...init,
      });
    } catch (err) {
      if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
        throw new UpstreamError('Portal request timed out', { status: 504, code: 'UPSTREAM_TIMEOUT' });
      }
      throw new UpstreamError('Portal is unreachable', { code: 'UPSTREAM_UNREACHABLE' });
    }
  }

  async #readJson(res) {
    if (res.status !== 200 && res.status !== 404) {
      throw new UpstreamError(`Portal returned HTTP ${res.status}`);
    }
    if (!(res.headers.get('content-type') ?? '').includes('application/json')) {
      throw new UpstreamError('Portal returned a non-JSON response (possibly a login page)');
    }
    try {
      return { status: res.status, data: await res.json() };
    } catch {
      throw new UpstreamError('Portal returned malformed JSON');
    }
  }
}

function isAuthFailure(res) {
  return res.status === 401 || (res.status >= 300 && res.status < 400);
}