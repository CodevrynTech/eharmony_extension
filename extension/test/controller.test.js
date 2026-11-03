import test from 'node:test';
import assert from 'node:assert/strict';
import { createController, composeMessage } from '../lib/controller.js';
import { AppError } from '../lib/errors.js';
import { DEFAULT_SETTINGS } from '../lib/settings.js';

function setup({ settings = {}, tabUrl = 'https://www.eharmony.com/profile/1', page, api } = {}) {
  const mem = new Map([['settings', { ...DEFAULT_SETTINGS, apiToken: 't'.repeat(20), dailyLimit: 3, ...settings }]]);
  const store = {
    get: async (k) => (mem.has(k) ? structuredClone(mem.get(k)) : undefined),
    set: async (k, v) => { mem.set(k, structuredClone(v)); },
  };
  const clock = { t: Date.parse('2026-11-03T10:00:00') };
  const log = { sent: [], generated: 0 };
  const browser = {
    getActiveTab: async () => (tabUrl === null ? null : { id: 5, url: tabUrl }),
    sendToTab: async (tabId, msg) => {
      log.sent.push(msg);
      return page === undefined ? { ok: true, text: 'p'.repeat(300), hintName: 'Anna' } : page;
    },
  };
  const fakeApi = api || { generate: async () => { log.generated++; return { firstName: 'Anna', message: 'I loved your hiking photos. Which trail is best?' }; } };
  const c = createController({ store, browser, api: fakeApi, now: () => clock.t });
  return { c, store, clock, log, mem };
}

test('composeMessage greets by name or falls back', () => {
  assert.equal(composeMessage('Anna', 'Hello.'), 'Hi Anna! Hello.');
  assert.equal(composeMessage('', 'Hello.'), 'Hi there! Hello.');
});

test('generateCurrent reads the page, generates, stores last result and counts', async () => {
  const s = setup();
  const r = await s.c.generateCurrent();
  assert.equal(r.message, 'Hi Anna! I loved your hiking photos. Which trail is best?');
  assert.equal(r.count, 1);
  assert.equal(r.limit, 3);
  assert.deepEqual(s.log.sent, [{ type: 'EXTRACT' }]); // read-only: only ever asks the page for its text
  const last = await s.store.get('last');
  assert.equal(last.message, r.message);
  assert.equal(last.url, 'https://www.eharmony.com/profile/1');
  assert.equal((await s.store.get('counter')).count, 1);
});

test('daily cap blocks generation, is editable, and resets next day', async () => {
  const s = setup({ settings: { dailyLimit: 2 } });
  await s.c.generateCurrent();
  await s.c.generateCurrent();
  await assert.rejects(s.c.generateCurrent(), /Daily limit reached \(2\/2\)/);
  assert.equal(s.log.generated, 2);

  s.mem.set('settings', { ...s.mem.get('settings'), dailyLimit: 3 });
  assert.equal((await s.c.generateCurrent()).count, 3);
  await assert.rejects(s.c.generateCurrent(), /Daily limit reached/);

  s.clock.t += 24 * 3600 * 1000;
  const r = await s.c.generateCurrent();
  assert.equal(r.count, 1);
  assert.equal((await s.store.get('counter')).date, '2026-11-04');
});

test('failed generation does not count against the cap', async () => {
  const s = setup({ api: { generate: async () => { throw new AppError('transient', 'Gemini quota', 'X'); } } });
  await assert.rejects(s.c.generateCurrent(), /Gemini quota/);
  assert.equal(await s.store.get('counter'), undefined);
  assert.equal(await s.store.get('last'), undefined);
});

test('rejects unsupported pages, missing tab and unreadable pages', async () => {
  await assert.rejects(setup({ tabUrl: 'https://example.com/' }).c.generateCurrent(), /supported site/);
  await assert.rejects(setup({ tabUrl: null }).c.generateCurrent(), /supported site/);
  await assert.rejects(setup({ page: undefined, tabUrl: 'http://www.eharmony.com/' }).c.generateCurrent(), /supported site/);
  await assert.rejects(setup({ page: { ok: false, code: 'LOGIN_REQUIRED', error: 'Please log in' } }).c.generateCurrent(), /Please log in/);
  await assert.rejects(setup({ page: null }).c.generateCurrent(), /did not respond/);
});

test('requires valid settings before doing anything', async () => {
  const s = setup({ settings: { apiToken: '' } });
  await assert.rejects(s.c.generateCurrent(), /Fix settings first/);
  assert.equal(s.log.sent.length, 0);
});

test('concurrent calls are rejected while one is running', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const s = setup({ api: { generate: async () => { await gate; return { firstName: 'Anna', message: 'A decent message for you here.' }; } } });
  const first = s.c.generateCurrent();
  await new Promise((r) => setTimeout(r, 10));
  await assert.rejects(s.c.generateCurrent(), /Already generating/);
  release();
  await first;
  assert.equal((await s.store.get('counter')).count, 1);
});
