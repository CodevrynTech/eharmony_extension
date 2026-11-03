import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { GeminiError } from '../src/gemini.js';

const TOKEN = 't'.repeat(24);
const config = loadConfig({ GEMINI_API_KEY: 'k', API_TOKEN: TOKEN, RATE_LIMIT_PER_MIN: '3' });

function start(generate, cfg = config) {
  return new Promise((resolve) => {
    const server = createApp({ config: cfg, generate }).listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

function request(port, { method = 'GET', path = '/', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body));
    const req = http.request({ host: '127.0.0.1', port, method, path, headers: { ...(data ? { 'content-type': 'application/json' } : {}), ...headers } }, (res) => {
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, json: buf ? JSON.parse(buf) : null }));
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

const auth = { authorization: `Bearer ${TOKEN}` };
const valid = { profileText: 'x'.repeat(150), hintName: 'Anna' };

test('health requires a valid token', async () => {
  const { server, port } = await start(async () => ({}));
  try {
    assert.equal((await request(port, { path: '/api/health' })).status, 401);
    assert.equal((await request(port, { path: '/api/health', headers: { authorization: 'Bearer wrong' } })).status, 401);
    const ok = await request(port, { path: '/api/health', headers: auth });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.ok, true);
  } finally { server.close(); }
});

test('rejects foreign Host and web-page Origin, allows chrome-extension origin', async () => {
  const { server, port } = await start(async () => ({}));
  try {
    assert.equal((await request(port, { path: '/api/health', headers: { ...auth, host: 'evil.example' } })).status, 403);
    assert.equal((await request(port, { path: '/api/health', headers: { ...auth, origin: 'https://evil.example' } })).status, 403);
    const ext = await request(port, { path: '/api/health', headers: { ...auth, origin: 'chrome-extension://abc' } });
    assert.equal(ext.status, 200);
    assert.equal(ext.headers['access-control-allow-origin'], 'chrome-extension://abc');
    const pre = await request(port, { method: 'OPTIONS', path: '/api/generate', headers: { origin: 'chrome-extension://abc' } });
    assert.equal(pre.status, 204);
  } finally { server.close(); }
});

test('generate passes validated, defaulted input to generator', async () => {
  let got;
  const { server, port } = await start(async (i) => { got = i; return { firstName: 'Anna', message: 'A fine message that is long enough.' }; });
  try {
    const r = await request(port, { method: 'POST', path: '/api/generate', headers: auth, body: valid });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json, { firstName: 'Anna', message: 'A fine message that is long enough.' });
    assert.equal(got.maxChars, 400);
    assert.equal(got.language, 'English');
    assert.equal(got.hintName, 'Anna');
  } finally { server.close(); }
});

test('generate validation errors return 400 and never call generator', async () => {
  let calls = 0;
  const { server, port } = await start(async () => { calls++; return {}; }, loadConfig({ GEMINI_API_KEY: 'k', API_TOKEN: TOKEN }));
  try {
    const post = (body) => request(port, { method: 'POST', path: '/api/generate', headers: auth, body });
    assert.equal((await post({})).status, 400);
    assert.equal((await post({ profileText: 'short' })).status, 400);
    assert.equal((await post({ ...valid, maxChars: 5 })).status, 400);
    assert.equal((await post({ ...valid, tone: 5 })).status, 400);
    assert.equal((await post([1])).status, 400);
    assert.equal((await post('{bad json')).json.error.code, 'BAD_JSON');
    assert.equal(calls, 0);
  } finally { server.close(); }
});

test('upstream errors are mapped with status and code', async () => {
  const { server, port } = await start(async () => { throw new GeminiError('UPSTREAM_RATE_LIMIT', 'quota', { status: 429 }); });
  try {
    const r = await request(port, { method: 'POST', path: '/api/generate', headers: auth, body: valid });
    assert.equal(r.status, 429);
    assert.equal(r.json.error.code, 'UPSTREAM_RATE_LIMIT');
  } finally { server.close(); }
});

test('unexpected errors become generic 500 without leaking details', async () => {
  const { server, port } = await start(async () => { throw new Error('secret internals'); });
  try {
    const r = await request(port, { method: 'POST', path: '/api/generate', headers: auth, body: valid });
    assert.equal(r.status, 500);
    assert.ok(!JSON.stringify(r.json).includes('secret'));
  } finally { server.close(); }
});

test('rate limiter blocks after the configured number of requests', async () => {
  const { server, port } = await start(async () => ({ firstName: 'A', message: 'm'.repeat(30) }));
  try {
    const post = () => request(port, { method: 'POST', path: '/api/generate', headers: auth, body: valid });
    assert.equal((await post()).status, 200);
    assert.equal((await post()).status, 200);
    assert.equal((await post()).status, 200);
    assert.equal((await post()).status, 429);
  } finally { server.close(); }
});

test('unknown route returns 404 json', async () => {
  const { server, port } = await start(async () => ({}));
  try {
    const r = await request(port, { path: '/api/nope', headers: auth });
    assert.equal(r.status, 404);
    assert.equal(r.json.error.code, 'NOT_FOUND');
  } finally { server.close(); }
});
