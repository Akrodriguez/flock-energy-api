import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PortalClient } from '../src/services/portalClient.js';
import { UpstreamError } from '../src/utils/errors.js';

const config = {
  PORTAL_BASE_URL: 'https://portal.test',
  PORTAL_USERNAME: 'user@test',
  PORTAL_PASSWORD: 'secret-pw',
  PORTAL_TIMEOUT_MS: 1000,
};

const jsonRes = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const loginRes = (token = 'tok1') => {
  const headers = new Headers({ 'content-type': 'application/json' });
  headers.append('set-cookie', `__Secure-better-auth.session_token=${token}; Max-Age=3600; Path=/; HttpOnly; Secure; SameSite=Lax`);
  return new Response(JSON.stringify({ type: 'redirect', status: 303, location: '/meters' }), { status: 200, headers });
};

// Fake portal: records calls; `data` decides what /portal/* returns.
function fakePortal({ data = () => jsonRes({ ok: true }), login = loginRes } = {}) {
  const calls = [];
  let tokenN = 0;
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    calls.push({ path: u.pathname + u.search, method: init.method ?? 'GET', init });
    if (u.pathname === '/login') return login(`tok${++tokenN}`);
    return data(init, calls);
  };
  return { fetchImpl, calls, logins: () => calls.filter((c) => c.path === '/login').length };
}

test('logs in once and reuses the session cookie', async () => {
  const p = fakePortal();
  const client = new PortalClient(config, { fetchImpl: p.fetchImpl });
  await client.getJson('/portal/a');
  await client.getJson('/portal/b');
  assert.equal(p.logins(), 1);
  const dataCall = p.calls.find((c) => c.path === '/portal/b');
  assert.match(dataCall.init.headers.cookie, /__Secure-better-auth\.session_token=tok1/);
});

test('login posts the form fields and an Origin header', async () => {
  const p = fakePortal();
  await new PortalClient(config, { fetchImpl: p.fetchImpl }).getJson('/portal/a');
  const login = p.calls.find((c) => c.path === '/login');
  assert.equal(login.method, 'POST');
  assert.equal(login.init.body.get('email'), 'user@test');
  assert.equal(login.init.headers.origin, 'https://portal.test');
});

test('concurrent first requests share a single login', async () => {
  const p = fakePortal();
  const client = new PortalClient(config, { fetchImpl: p.fetchImpl });
  await Promise.all([client.getJson('/portal/a'), client.getJson('/portal/b'), client.getJson('/portal/c')]);
  assert.equal(p.logins(), 1);
});

test('re-logs in before the cookie expires', async () => {
  let t = 0;
  const p = fakePortal();
  const client = new PortalClient(config, { fetchImpl: p.fetchImpl, now: () => t });
  await client.getJson('/portal/a');
  t = 3_600_000 - 30_000; // inside the 60s safety margin
  await client.getJson('/portal/a');
  assert.equal(p.logins(), 2);
});

test('a 401 triggers one re-login and one retry', async () => {
  let first = true;
  const p = fakePortal({
    data: () => {
      if (first) { first = false; return jsonRes({ error: 'unauthorized' }, 401); }
      return jsonRes({ data: [1] });
    },
  });
  const out = await new PortalClient(config, { fetchImpl: p.fetchImpl }).getJson('/portal/a');
  assert.deepEqual(out, { status: 200, data: { data: [1] } });
  assert.equal(p.logins(), 2);
});

test('persistent 401 becomes UPSTREAM_AUTH_FAILED, not a client 401', async () => {
  const p = fakePortal({ data: () => jsonRes({ error: 'unauthorized' }, 401) });
  await assert.rejects(
    new PortalClient(config, { fetchImpl: p.fetchImpl }).getJson('/portal/a'),
    (e) => e instanceof UpstreamError && e.code === 'UPSTREAM_AUTH_FAILED' && e.status === 502,
  );
});

test('a redirect to the login page is treated as an expired session', async () => {
  const p = fakePortal({ data: () => new Response(null, { status: 302, headers: { location: '/login' } }) });
  await assert.rejects(
    new PortalClient(config, { fetchImpl: p.fetchImpl }).getJson('/portal/a'),
    (e) => e.code === 'UPSTREAM_AUTH_FAILED',
  );
  assert.equal(p.logins(), 2);
});

test('rejected credentials fail without leaking the password', async () => {
  const p = fakePortal({ login: () => jsonRes({ type: 'failure', status: 400 }) });
  await assert.rejects(
    new PortalClient(config, { fetchImpl: p.fetchImpl }).getJson('/portal/a'),
    (e) => e.code === 'UPSTREAM_AUTH_FAILED' && !e.message.includes('secret-pw'),
  );
});

test('HTML instead of JSON is an upstream error', async () => {
  const p = fakePortal({ data: () => new Response('<html>login</html>', { status: 200, headers: { 'content-type': 'text/html' } }) });
  await assert.rejects(new PortalClient(config, { fetchImpl: p.fetchImpl }).getJson('/portal/a'), (e) => e.status === 502);
});

test('malformed JSON is an upstream error', async () => {
  const p = fakePortal({ data: () => new Response('{nope', { status: 200, headers: { 'content-type': 'application/json' } }) });
  await assert.rejects(new PortalClient(config, { fetchImpl: p.fetchImpl }).getJson('/portal/a'), (e) => e.message.includes('malformed'));
});

test('portal 5xx is an upstream error', async () => {
  const p = fakePortal({ data: () => jsonRes({}, 503) });
  await assert.rejects(new PortalClient(config, { fetchImpl: p.fetchImpl }).getJson('/portal/a'), (e) => e.status === 502);
});

test('404 is returned to the caller, not thrown', async () => {
  const p = fakePortal({ data: () => jsonRes({ error: 'not_found', message: 'Meter not found' }, 404) });
  const out = await new PortalClient(config, { fetchImpl: p.fetchImpl }).getJson('/portal/meters/J999999/energy');
  assert.equal(out.status, 404);
});

test('timeouts map to 504', async () => {
  const fetchImpl = async (url) => {
    if (new URL(url).pathname === '/login') return loginRes();
    throw Object.assign(new Error('timed out'), { name: 'TimeoutError' });
  };
  await assert.rejects(new PortalClient(config, { fetchImpl }).getJson('/portal/a'), (e) => e.status === 504 && e.code === 'UPSTREAM_TIMEOUT');
});

test('network failure maps to UPSTREAM_UNREACHABLE', async () => {
  const fetchImpl = async () => { throw new TypeError('fetch failed'); };
  await assert.rejects(new PortalClient(config, { fetchImpl }).getJson('/portal/a'), (e) => e.code === 'UPSTREAM_UNREACHABLE');
});