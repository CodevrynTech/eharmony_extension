import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeSettings, DEFAULT_SETTINGS, readinessProblem } from '../lib/settings.js';
import { dayKey, normalizeCounter, incrementCounter, remaining } from '../lib/cap.js';
import { isAllowedUrl } from '../lib/urls.js';
import { createApi } from '../lib/api.js';
import { AppError } from '../lib/errors.js';

const good = { ...DEFAULT_SETTINGS, apiToken: 'a'.repeat(20) };

test('settings: valid input passes and numeric strings are coerced', () => {
  const r = sanitizeSettings({ ...good, dailyLimit: '15', maxChars: '300' });
  assert.deepEqual(r.errors, []);
  assert.equal(r.settings.dailyLimit, 15);
  assert.equal(r.settings.maxChars, 300);
});

test('settings: rejects bad cap, token, url, tone, length', () => {
  const bad = (patch) => sanitizeSettings({ ...good, ...patch }).errors;
  assert.ok(bad({ dailyLimit: 0 }).length);
  assert.ok(bad({ dailyLimit: 501 }).length);
  assert.ok(bad({ dailyLimit: 1.5 }).length);
  assert.ok(bad({ dailyLimit: 'abc' }).length);
  assert.ok(bad({ apiToken: 'short' }).length);
  assert.ok(bad({ serverUrl: 'https://example.com' }).length);
  assert.ok(bad({ serverUrl: 'http://192.168.1.5:3000' }).length);
  assert.ok(bad({ tone: '' }).length);
  assert.ok(bad({ maxChars: 50 }).length);
  assert.ok(bad({ senderContext: 'x'.repeat(501) }).length);
  assert.deepEqual(bad({ serverUrl: 'http://localhost:4000/' }), []);
});

test('settings: readiness reports the first problem', () => {
  assert.match(readinessProblem({ ...DEFAULT_SETTINGS }), /Fix settings first/);
  assert.equal(readinessProblem(good), '');
});

test('cap: day key, reset, increment, remaining', () => {
  const t = new Date(2026, 10, 3, 23, 59).getTime();
  assert.equal(dayKey(t), '2026-11-03');
  assert.deepEqual(normalizeCounter(undefined, t), { date: '2026-11-03', count: 0 });
  assert.deepEqual(normalizeCounter({ date: '2026-11-02', count: 9 }, t), { date: '2026-11-03', count: 0 });
  assert.deepEqual(normalizeCounter({ date: '2026-11-03', count: -4 }, t), { date: '2026-11-03', count: 0 });
  const c1 = incrementCounter(undefined, t);
  assert.equal(incrementCounter(c1, t).count, 2);
  assert.equal(remaining(5, { date: '2026-11-03', count: 3 }, t), 2);
  assert.equal(remaining(5, { date: '2026-11-03', count: 9 }, t), 0);
});

test('urls: allowed hosts only, https only', () => {
  assert.ok(isAllowedUrl('https://www.eharmony.com/x'));
  assert.ok(isAllowedUrl('https://eharmony.com/x'));
  assert.ok(!isAllowedUrl('http://www.eharmony.com/x'));
  assert.ok(!isAllowedUrl('https://eharmony.com.evil.com/x'));
  assert.ok(!isAllowedUrl('https://noteharmony.com/x'));
  assert.ok(!isAllowedUrl('javascript:alert(1)'));
  assert.ok(!isAllowedUrl(''));
});

const settings = { serverUrl: 'http://127.0.0.1:3000', apiToken: 't'.repeat(20), tone: 'warm', language: 'English', senderContext: '', maxChars: 400 };
const resp = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

test('api: generate sends auth + settings and returns result', async () => {
  let seen;
  const api = createApi(async (url, opts) => { seen = { url, opts }; return resp(200, { firstName: 'Anna', message: 'hello there friend' }); });
  const r = await api.generate(settings, { profileText: 'x'.repeat(200), hintName: 'A' });
  assert.deepEqual(r, { firstName: 'Anna', message: 'hello there friend' });
  assert.equal(seen.url, 'http://127.0.0.1:3000/api/generate');
  assert.equal(seen.opts.headers.authorization, `Bearer ${settings.apiToken}`);
  assert.equal(JSON.parse(seen.opts.body).maxChars, 400);
});

test('api: error mapping', async () => {
  const run = (fetchImpl) => createApi(fetchImpl).generate(settings, { profileText: 'x', hintName: '' });
  const kind = async (fetchImpl) => { try { await run(fetchImpl); } catch (e) { assert.ok(e instanceof AppError); return e.kind; } return 'none'; };
  assert.equal(await kind(async () => { throw new TypeError('fetch failed'); }), 'fatal');
  assert.equal(await kind(async () => resp(401, { error: { code: 'UNAUTHORIZED', message: 'no' } })), 'fatal');
  assert.equal(await kind(async () => resp(502, { error: { code: 'UPSTREAM_AUTH', message: 'bad key' } })), 'fatal');
  assert.equal(await kind(async () => resp(429, { error: { code: 'UPSTREAM_RATE_LIMIT', message: 'q' } })), 'transient');
  assert.equal(await kind(async () => resp(503, { error: { code: 'UPSTREAM_ERROR', message: 'q' } })), 'transient');
  assert.equal(await kind(async () => resp(500, null)), 'transient');
  assert.equal(await kind(async () => resp(400, { error: { code: 'VALIDATION', message: 'short' } })), 'item');
  assert.equal(await kind(async () => resp(422, { error: { code: 'BLOCKED', message: 'blocked' } })), 'item');
  assert.equal(await kind(async () => resp(200, { firstName: 'A' })), 'transient');
  const timeout = Object.assign(new Error('t'), { name: 'TimeoutError' });
  assert.equal(await kind(async () => { throw timeout; }), 'transient');
});

test('api: health', async () => {
  const api = createApi(async () => resp(200, { ok: true, model: 'm' }));
  assert.deepEqual(await api.health(settings), { ok: true, model: 'm' });
});
