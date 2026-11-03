import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

const SRC = fs.readFileSync(new URL('../src/content.js', import.meta.url), 'utf8');
const FAST = { timeouts: { extract: 600, poll: 20 } };
const BIO = '<p>' + 'I love hiking, cooking Italian food and volunteering at the animal shelter. '.repeat(5) + '</p>';
const J = (x) => JSON.parse(JSON.stringify(x)); // jsdom objects live in another realm

function load(html, url = 'https://www.eharmony.com/profile/1') {
  const dom = new JSDOM(html, { url, runScripts: 'outside-only', pretendToBeVisual: true });
  dom.window.eval(SRC);
  return { win: dom.window, doc: dom.window.document, c: dom.window.__pmContent };
}

test('extract: returns text and a name hint from h1', async () => {
  const { c } = load(`<h1>Anna Smith</h1>${BIO}`);
  const r = await c.extractProfile(FAST);
  assert.equal(r.ok, true);
  assert.equal(r.hintName, 'Anna');
  assert.ok(r.text.length > 300);
});

test('extract: name hint falls back to title and ignores generic words', async () => {
  const a = load(`<title>Maria, 34 - eharmony</title>${BIO}`);
  assert.equal((await a.c.extractProfile(FAST)).hintName, 'Maria');
  const b = load(`<h1>Welcome</h1><title>Profile</title>${BIO}`);
  assert.equal((await b.c.extractProfile(FAST)).hintName, '');
});

test('extract: drops the preferences/filter boilerplate after the profile', async () => {
  const { c } = load(`<h1>Anna</h1>${BIO}<p>MEMBER PREFERENCES from 18 to 27</p><p>FILTER MEMBERS ACCORDING TO INTERESTS Jazz Blues Rock</p>`);
  const r = await c.extractProfile(FAST);
  assert.ok(!/MEMBER PREFERENCES|Jazz/.test(r.text));
  assert.ok(/hiking/.test(r.text));
});

test('extract: too-short page fails, login url and password form flagged', async () => {
  assert.equal((await load('<p>hi</p>').c.extractProfile(FAST)).code, 'PROFILE_EMPTY');
  assert.equal((await load(BIO, 'https://www.eharmony.com/login').c.extractProfile(FAST)).code, 'LOGIN_REQUIRED');
  assert.equal((await load('<input type="password">').c.extractProfile(FAST)).code, 'LOGIN_REQUIRED');
});

test('extract: waits for late-rendering content', async () => {
  const p = load('<div id="root"></div>');
  setTimeout(() => { p.doc.getElementById('root').innerHTML = BIO; }, 150);
  const r = await p.c.extractProfile({ timeouts: { extract: 2000, poll: 20 } });
  assert.equal(r.ok, true);
});

test('content script is read-only: never modifies the page', async () => {
  const html = `<h1>Anna</h1>${BIO}<form><textarea id="t">draft</textarea><button id="b">Send</button></form>`;
  const p = load(html);
  let clicked = false;
  p.doc.getElementById('b').addEventListener('click', () => { clicked = true; });
  const before = p.doc.documentElement.outerHTML;
  await p.c.handle({ type: 'EXTRACT', options: FAST });
  assert.equal(p.doc.documentElement.outerHTML, before);
  assert.equal(clicked, false);
  assert.equal(p.doc.getElementById('t').value, 'draft');
});

test('handle: ping, unknown (write-type) messages are refused', async () => {
  const { c } = load('<p>x</p>');
  assert.deepEqual(J(await c.handle({ type: 'PING' })), { ok: true });
  assert.equal((await c.handle({ type: 'NOPE' })).code, 'UNKNOWN_MESSAGE');
  assert.equal((await c.handle({ type: 'FILL', text: 'hi', send: true })).code, 'UNKNOWN_MESSAGE');
});

test('script is idempotent when injected twice', () => {
  const p = load('<p>x</p>');
  const first = p.win.__pmContent;
  p.win.eval(SRC);
  assert.equal(p.win.__pmContent, first);
});
