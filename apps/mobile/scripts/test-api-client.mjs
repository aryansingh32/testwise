// Behavioural test for src/lib/api.ts (retry, timeout, token refresh, sign-out rules) against a local mock server.
// Run: pnpm --filter @testwise/mobile test:api
import { build } from 'esbuild';
import http from 'node:http';
import { strict as assert } from 'node:assert';
import { after, before, beforeEach, describe, it } from 'node:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(mkdtempSync(join(tmpdir(), 'api-client-')), 'api.mjs');

// ---- mock server: each test sets `script`, a function (req, res, n) deciding the response; n counts calls per path.
let script = () => {};
const calls = {};
const server = http.createServer((req, res) => {
  const n = (calls[req.url] = (calls[req.url] ?? 0) + 1);
  script(req, res, n);
});
const send = (res, status, body, headers = {}) => {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(body === undefined ? '' : JSON.stringify(body));
};

let api, ApiError, saveSession, loadTokens, setSignedOutHandler, store, signedOut;
before(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  process.env.EXPO_PUBLIC_API_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.EXPO_PUBLIC_API_TIMEOUT_MS = '400';
  await build({
    entryPoints: [join(here, '../src/lib/api.ts')], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent',
    define: { 'process.env.EXPO_PUBLIC_API_URL': JSON.stringify(process.env.EXPO_PUBLIC_API_URL), 'process.env.EXPO_PUBLIC_API_TIMEOUT_MS': '"400"' },
    plugins: [{
      name: 'stubs',
      setup(b) {
        b.onResolve({ filter: /^expo-constants$/ }, () => ({ path: 'expo-constants', namespace: 'stub' }));
        b.onResolve({ filter: /\/storage$/ }, () => ({ path: 'storage', namespace: 'stub' }));
        b.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => ({
          contents: a.path === 'storage'
            ? 'const m = globalThis.__mem ??= new Map(); export const storage = { get: async (k) => m.get(k) ?? null, set: async (k, v) => void m.set(k, v), remove: async (k) => void m.delete(k) };'
            : 'export default { expoConfig: { extra: {} } };',
          loader: 'js',
        }));
      },
    }],
  });
  ({ api, ApiError, saveSession, loadTokens, setSignedOutHandler } = await import(pathToFileURL(out).href));
  store = globalThis.__mem;
  setSignedOutHandler(() => { signedOut++; });
});
after(() => server.close());
beforeEach(async () => {
  for (const k of Object.keys(calls)) delete calls[k];
  signedOut = 0;
  store.clear();
  await saveSession({ accessToken: 'old-access', refreshToken: 'old-refresh' });
});

describe('transient failures', () => {
  it('retries a GET on 503 honouring Retry-After, then succeeds', async () => {
    script = (req, res, n) => (n === 1 ? send(res, 503, { message: 'busy' }, { 'retry-after': '1' }) : send(res, 200, { ok: true }));
    const t0 = Date.now();
    assert.deepEqual(await api('/x'), { ok: true });
    assert.equal(calls['/x'], 2);
    assert.ok(Date.now() - t0 >= 900, 'waited for Retry-After');
  });
  it('does NOT retry a non-idempotent POST, and flags the error transient', async () => {
    script = (req, res) => send(res, 503, { message: 'busy', requestId: 'req-abc12345' });
    await assert.rejects(api('/pay', { method: 'POST', body: {} }), (e) => e instanceof ApiError && e.status === 503 && e.transient && e.requestId === 'req-abc12345');
    assert.equal(calls['/pay'], 1);
  });
  it('retries a POST marked idempotent (autosave/submit)', async () => {
    script = (req, res, n) => (n < 3 ? send(res, 502, { message: 'bad gateway' }) : send(res, 200, { saved: 1 }));
    assert.deepEqual(await api('/save', { method: 'PUT', idempotent: true, body: {} }), { saved: 1 });
    assert.equal(calls['/save'], 3);
  });
  it('gives up after bounded retries and reports offline when the connection hangs', async () => {
    script = () => {}; // never responds -> exercises the timeout path (connection hangs like a dead mobile network)
    const t0 = Date.now();
    await assert.rejects(api('/hang'), (e) => e instanceof ApiError && e.status === 0 && e.message === 'offline' && e.transient);
    assert.equal(calls['/hang'], 3, '1 try + 2 retries');
    assert.ok(Date.now() - t0 < 6000, `bounded (${Date.now() - t0}ms)`);
  });
  it('does not retry client errors (400/404) and exposes validation issues + joined messages', async () => {
    script = (req, res) => send(res, 400, { message: 'Validation failed', issues: [{ path: 'email', message: 'Invalid' }] });
    await assert.rejects(api('/v'), (e) => e.status === 400 && e.issues[0].path === 'email' && !e.transient);
    assert.equal(calls['/v'], 1);
    script = (req, res) => send(res, 404, { message: ['a', 'b'] });
    await assert.rejects(api('/m'), (e) => e.message === 'a, b');
  });
});

describe('token refresh', () => {
  const authed = (req, res, n, ok = () => send(res, 200, { me: true })) =>
    req.headers.authorization === 'Bearer new-access' ? ok() : send(res, 401, { message: 'expired' });
  it('refreshes on 401 and retries the original request once', async () => {
    script = (req, res, n) => (req.url === '/v1/auth/refresh' ? send(res, 200, { accessToken: 'new-access', refreshToken: 'new-refresh' }) : authed(req, res, n));
    assert.deepEqual(await api('/me'), { me: true });
    assert.equal((await loadTokens()).refreshToken, 'new-refresh');
    assert.equal(signedOut, 0);
  });
  it('shares ONE refresh between parallel 401s (a rotated token can only be used once)', async () => {
    script = (req, res, n) => (req.url === '/v1/auth/refresh' ? setTimeout(() => send(res, 200, { accessToken: 'new-access', refreshToken: 'new-refresh' }), 80) : authed(req, res, n));
    await Promise.all([api('/a'), api('/b'), api('/c'), api('/d')]);
    assert.equal(calls['/v1/auth/refresh'], 1);
  });
  for (const status of [503, 429, 500]) {
    it(`KEEPS the session when the refresh endpoint answers ${status} (transient)`, async () => {
      script = (req, res) => (req.url === '/v1/auth/refresh' ? send(res, status, { message: 'busy' }) : send(res, 401, { message: 'expired' }));
      await assert.rejects(api('/me'), (e) => e instanceof ApiError && e.status === 0 && e.transient);
      assert.equal(signedOut, 0, 'must not sign out');
      assert.equal((await loadTokens()).refreshToken, 'old-refresh', 'tokens kept');
    });
  }
  it('KEEPS the session when the refresh request itself times out', async () => {
    script = (req, res) => { if (req.url !== '/v1/auth/refresh') send(res, 401, { message: 'expired' }); /* refresh hangs */ };
    await assert.rejects(api('/me'), (e) => e.status === 0);
    assert.equal(signedOut, 0);
    assert.ok(await loadTokens());
  });
  for (const status of [400, 401, 403]) {
    it(`signs out only when the server REJECTS the refresh token (${status})`, async () => {
      script = (req, res) => (req.url === '/v1/auth/refresh' ? send(res, status, { message: 'Invalid refresh token' }) : send(res, 401, { message: 'expired' }));
      await assert.rejects(api('/me'), (e) => e.status === 401);
      assert.equal(signedOut, 1);
      assert.equal(await loadTokens(), null);
    });
  }
});
