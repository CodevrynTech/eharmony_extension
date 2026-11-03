import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../src/app.js';
import { loadConfig, parseLicenses, ConfigError } from '../src/config.js';
import { GeminiError } from '../src/gemini.js';

const T1 = 'a'.repeat(20);
const T2 = 'b'.repeat(20);
const base = { GEMINI_API_KEY: 'k' };
const EXT = `chrome-extension://${'a'.repeat(32)}`;

test('parseLicenses: label:token[:limit], defaults, legacy API_TOKEN', () => {
  const l = parseLicenses({ LICENSES: `alice:${T1}:30, bob:${T2}`, API_TOKEN: 'c'.repeat(20) }, 50);
  assert.deepEqual(l.map((x) => [x.label, x.dailyLimit]), [['alice', 30], ['bob', 50], ['default', 50]]);
});

test('parseLicenses rejects bad input without leaking tokens', () => {
  const bad = (env) => {
    try { parseLicenses(env, 50); } catch (e) { assert.ok(e instanceof ConfigError); return e.message; }
    return null;
  };
  assert.match(bad({}), /Set LICENSES/);
  assert.match(bad({ LICENSES: 'alice:short' }), /at least 16/);
  assert.match(bad({ LICENSES: `al ice:${T1}` }), /label/);
  assert.match(bad({ LICENSES: `alice:${T1}:0` }), /daily limit/);
  assert.match(bad({ LICENSES: `alice:${T1}:abc` }), /daily limit/);
  assert.match(bad({ LICENSES: `alice:${T1},alice:${T2}` }), /Duplicate/);
  assert.match(bad({ LICENSES: `alice:${T1},bob:${T1}` }), /reuses/);
  assert.match(bad({ LICENSES: 'alice' }), /Invalid LICENSES/);
  for (const env of [{ LICENSES: `alice:${T1}:0` }, { LICENSES: `alice:${T1},bob:${T1}` }]) {
    assert.ok(!bad(env).includes(T1));
  }
});

test('config: loopback by default, public bind on Render, extension ids validated', () => {
  assert.equal(loadConfig({ ...base, LICENSES: `a:${T1}` }).host, '127.0.0.1');
  assert.equal(loadConfig({ ...base, LICENSES: `a:${T1}` }).publicMode, false);
  const hosted = loadConfig({ ...base, LICENSES: `a:${T1}`, RENDER: 'true', PORT: '10000' });
  assert.equal(hosted.host, '0.0.0.0');
  assert.equal(hosted.publicMode, true);
  assert.equal(hosted.port, 10000);
  assert.throws(() => loadConfig({ ...base, LICENSES: `a:${T1}`, ALLOWED_EXTENSION_IDS: 'nope' }), ConfigError);
  assert.deepEqual(
    loadConfig({ ...base, LICENSES: `a:${T1}`, ALLOWED_EXTENSION_IDS: 'a'.repeat(32) }).allowedExtensionIds,
    ['a'.repeat(32)],
  );
});

function start(env, generate, clock) {
  const config = loadConfig({ ...base, ...env });
  return new Promise((resolve) => {
    const app = createApp({ config, generate, now: clock ? () => clock.t : Date.now });
    const server = app.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

function request(port, { method = 'GET', path = '/', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const opts = { host: '127.0.0.1', port, method, path, headers: { ...(data ? { 'content-type': 'application/json' } : {}), ...headers } };
    const req = http.request(opts, (res) => {
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => resolve({ status: res.statusCode, json: buf ? JSON.parse(buf) : null }));
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

const auth = (t) => ({ authorization: `Bearer ${t}` });
const valid = { profileText: 'x'.repeat(150) };
const ok = async () => ({ firstName: 'Anna', message: 'A message that is long enough for tests.' });

test('each license authenticates independently; unknown tokens are rejected', async () => {
  const { server, port } = await start({ LICENSES: `alice:${T1}:5,bob:${T2}:7` }, ok);
  try {
    assert.equal((await request(port, { path: '/api/health', headers: auth('c'.repeat(20)) })).status, 401);
    const a = await request(port, { path: '/api/health', headers: auth(T1) });
    const b = await request(port, { path: '/api/health', headers: auth(T2) });
    assert.deepEqual(a.json.quota, { limit: 5, used: 0 });
    assert.deepEqual(b.json.quota, { limit: 7, used: 0 });
  } finally { server.close(); }
});

test('quota is per license, enforced, counted only on success, and resets at UTC midnight', async () => {
  const clock = { t: Date.parse('2026-11-03T12:00:00Z') };
  let fail = false;
  const gen = async () => {
    if (fail) throw new GeminiError('UPSTREAM_ERROR', 'down', { status: 503 });
    return ok();
  };
  const { server, port } = await start({ LICENSES: `alice:${T1}:2,bob:${T2}:1`, RATE_LIMIT_PER_MIN: '100' }, gen, clock);
  try {
    const post = (t) => request(port, { method: 'POST', path: '/api/generate', headers: auth(t), body: valid });
    assert.equal((await post(T1)).status, 200);
    fail = true;
    assert.equal((await post(T1)).status, 503); // a failed call must not use quota
    fail = false;
    const second = await post(T1);
    assert.equal(second.status, 200);
    assert.deepEqual(second.json.quota, { limit: 2, used: 2 });
    const blocked = await post(T1);
    assert.equal(blocked.status, 429);
    assert.equal(blocked.json.error.code, 'QUOTA_EXCEEDED');
    assert.equal((await post(T2)).status, 200); // bob unaffected
    assert.equal((await post(T2)).status, 429);

    clock.t = Date.parse('2026-11-04T00:00:01Z');
    assert.equal((await post(T1)).status, 200);
    const h = await request(port, { path: '/api/health', headers: auth(T1) });
    assert.deepEqual(h.json.quota, { limit: 2, used: 1 });
  } finally { server.close(); }
});

test('concurrent requests cannot overshoot the quota', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const gen = async () => { await gate; return ok(); };
  const { server, port } = await start({ LICENSES: `alice:${T1}:2`, RATE_LIMIT_PER_MIN: '100' }, gen);
  try {
    const post = () => request(port, { method: 'POST', path: '/api/generate', headers: auth(T1), body: valid });
    const calls = [post(), post(), post(), post()];
    await new Promise((r) => setTimeout(r, 150));
    release();
    const statuses = (await Promise.all(calls)).map((r) => r.status).sort();
    assert.deepEqual(statuses, [200, 200, 429, 429]);
  } finally { server.close(); }
});

test('healthz is public with no data; public mode skips the Host allow-list', async () => {
  const { server, port } = await start({ LICENSES: `alice:${T1}`, HOST: '0.0.0.0' }, ok);
  try {
    const h = await request(port, { path: '/healthz', headers: { host: 'my-app.onrender.com' } });
    assert.deepEqual(h.json, { ok: true });
    const api = await request(port, { path: '/api/health', headers: { ...auth(T1), host: 'my-app.onrender.com' } });
    assert.equal(api.status, 200);
  } finally { server.close(); }
  const local = await start({ LICENSES: `alice:${T1}` }, ok);
  try {
    const evil = { ...auth(T1), host: 'evil.example' };
    assert.equal((await request(local.port, { path: '/api/health', headers: evil })).status, 403);
    assert.equal((await request(local.port, { path: '/healthz', headers: { host: 'evil.example' } })).status, 200);
  } finally { local.server.close(); }
});

test('ALLOWED_EXTENSION_IDS restricts which extension may call the API', async () => {
  const { server, port } = await start({ LICENSES: `alice:${T1}`, ALLOWED_EXTENSION_IDS: 'b'.repeat(32) }, ok);
  try {
    const get = (origin) => request(port, { path: '/api/health', headers: { ...auth(T1), ...(origin ? { origin } : {}) } });
    assert.equal((await get(EXT)).status, 403);
    assert.equal((await get(`chrome-extension://${'b'.repeat(32)}`)).status, 200);
    assert.equal((await get()).status, 200); // the service worker sends no Origin
    assert.equal((await get('https://evil.example')).status, 403);
  } finally { server.close(); }
});

test('rate limit is per license', async () => {
  const { server, port } = await start({ LICENSES: `alice:${T1},bob:${T2}`, RATE_LIMIT_PER_MIN: '1' }, ok);
  try {
    const post = (t) => request(port, { method: 'POST', path: '/api/generate', headers: auth(t), body: valid });
    assert.equal((await post(T1)).status, 200);
    assert.equal((await post(T1)).status, 429);
    assert.equal((await post(T2)).status, 200);
  } finally { server.close(); }
});
