import test from 'node:test';
import assert from 'node:assert/strict';
import { createGenerator, GeminiError } from '../src/gemini.js';
import { loadConfig, ConfigError } from '../src/config.js';

const config = loadConfig({ GEMINI_API_KEY: 'k', API_TOKEN: 'x'.repeat(20), GEMINI_MAX_RETRIES: '2' });
const input = {
  profileText: 'p'.repeat(200), hintName: '', tone: 'warm', language: 'English', senderContext: '', maxChars: 400,
};
const ok = (obj) => ({
  ok: true, status: 200,
  json: async () => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(obj) }] } }] }),
});
const fail = (status, message = '') => ({ ok: false, status, json: async () => ({ error: { message } }) });
const noSleep = async () => {};

test('config requires key and token', () => {
  assert.throws(() => loadConfig({}), ConfigError);
  assert.throws(() => loadConfig({ GEMINI_API_KEY: 'k', API_TOKEN: 'short' }), ConfigError);
  assert.throws(() => loadConfig({ GEMINI_API_KEY: 'k', API_TOKEN: 'x'.repeat(20), PORT: 'abc' }), ConfigError);
  assert.equal(loadConfig({ GEMINI_API_KEY: 'k', API_TOKEN: 'x'.repeat(20) }).port, 3000);
});

test('happy path returns cleaned name and message, sends key header and schema', async () => {
  let seen;
  const fetchImpl = async (url, opts) => {
    seen = { url, opts };
    return ok({ firstName: 'anna', message: 'Hi Anna, I noticed you love hiking in the Alps. Which trail is your favourite?' });
  };
  const gen = createGenerator(config, fetchImpl, noSleep);
  const r = await gen(input);
  assert.equal(r.firstName, 'Anna');
  assert.equal(r.message, 'I noticed you love hiking in the Alps. Which trail is your favourite?');
  assert.match(seen.url, /models\/gemini-2\.5-flash:generateContent$/);
  assert.equal(seen.opts.headers['x-goog-api-key'], 'k');
  const body = JSON.parse(seen.opts.body);
  assert.equal(body.generationConfig.responseMimeType, 'application/json');
  assert.match(body.contents[0].parts[0].text, /<profile>/);
});

test('falls back to hint name when model returns none', async () => {
  const gen = createGenerator(config, async () => ok({ firstName: '', message: 'I really liked your bio about volunteering. What drew you to it?' }), noSleep);
  const r = await gen({ ...input, hintName: 'Maria' });
  assert.equal(r.firstName, 'Maria');
});

test('retries retryable errors then succeeds', async () => {
  let n = 0;
  const gen = createGenerator(config, async () => (++n < 3 ? fail(503) : ok({ firstName: 'Li', message: 'Your travel stories sound amazing. Where was your last trip?' })), noSleep);
  const r = await gen(input);
  assert.equal(n, 3);
  assert.equal(r.firstName, 'Li');
});

test('gives up after maxRetries on 429 and surfaces status 429', async () => {
  let n = 0;
  const gen = createGenerator(config, async () => { n++; return fail(429); }, noSleep);
  await assert.rejects(gen(input), (e) => e instanceof GeminiError && e.code === 'UPSTREAM_RATE_LIMIT' && e.status === 429);
  assert.equal(n, 3);
});

test('auth errors are not retried', async () => {
  let n = 0;
  const gen = createGenerator(config, async () => { n++; return fail(400, 'API key not valid'); }, noSleep);
  await assert.rejects(gen(input), (e) => e.code === 'UPSTREAM_AUTH');
  assert.equal(n, 1);
});

test('safety block and malformed json handled', async () => {
  const blocked = createGenerator(config, async () => ({ ok: true, status: 200, json: async () => ({ promptFeedback: { blockReason: 'SAFETY' } }) }), noSleep);
  await assert.rejects(blocked(input), (e) => e.code === 'BLOCKED' && e.status === 422);

  let n = 0;
  const bad = createGenerator(config, async () => { n++; return { ok: true, status: 200, json: async () => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'not json' }] } }] }) }; }, noSleep);
  await assert.rejects(bad(input), (e) => e.code === 'BAD_JSON');
  assert.equal(n, 3);
});

test('too-short output is retried and rejected', async () => {
  const gen = createGenerator(config, async () => ok({ firstName: 'Ann', message: 'Hi.' }), noSleep);
  await assert.rejects(gen(input), (e) => e.code === 'BAD_OUTPUT');
});

test('network failure maps to retryable unreachable error', async () => {
  const gen = createGenerator({ ...config, maxRetries: 0 }, async () => { throw new TypeError('fetch failed'); }, noSleep);
  await assert.rejects(gen(input), (e) => e.code === 'UPSTREAM_UNREACHABLE' && e.status === 504);
});

test('accepts fenced json output', async () => {
  const fenced = { ok: true, status: 200, json: async () => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '```json\n{"firstName":"Sam","message":"Your passion for jazz stood out to me. Who is your favourite artist?"}\n```' }] } }] }) };
  const r = await createGenerator(config, async () => fenced, noSleep)(input);
  assert.equal(r.firstName, 'Sam');
});
