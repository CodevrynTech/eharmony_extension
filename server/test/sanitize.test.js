import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanName, cleanMessage } from '../src/sanitize.js';

test('cleanName keeps first token, letters only, capitalised', () => {
  assert.equal(cleanName('anna maria'), 'Anna');
  assert.equal(cleanName("  O'Neil "), "O'Neil");
  assert.equal(cleanName('J0hn!'), 'Jhn');
  assert.equal(cleanName('Zoë'), 'Zoë');
});

test('cleanName rejects empty / too short / non-string', () => {
  assert.equal(cleanName(''), '');
  assert.equal(cleanName('A'), '');
  assert.equal(cleanName(null), '');
  assert.equal(cleanName(42), '');
  assert.equal(cleanName('123'), '');
});

test('cleanMessage strips links, emails, greeting and collapses whitespace', () => {
  const out = cleanMessage('Hi Anna,\n  I loved your hiking photos https://x.com/a and mail me a@b.com.  What trail is your favourite?', { name: 'Anna' });
  assert.equal(out, 'I loved your hiking photos and mail me What trail is your favourite?');
  assert.ok(!/https?:|@/.test(out));
  assert.ok(!/^hi/i.test(out));
});

test('cleanMessage removes a leading repeated name', () => {
  assert.equal(cleanMessage('Anna, your love of cooking stood out to me. What do you cook?', { name: 'Anna' }),
    'Your love of cooking stood out to me. What do you cook?');
});

test('cleanMessage truncates on sentence boundary under maxChars', () => {
  const long = 'First sentence is here and fine. ' + 'Second sentence goes on and on and on. '.repeat(30);
  const out = cleanMessage(long, { maxChars: 120 });
  assert.ok(out.length <= 121);
  assert.ok(out.endsWith('.'));
});

test('cleanMessage hard-truncates a single long run without spaces issues', () => {
  const out = cleanMessage('word '.repeat(200), { maxChars: 100 });
  assert.ok(out.length <= 101);
  assert.ok(out.endsWith('…'));
});

test('cleanMessage returns empty for non-strings', () => {
  assert.equal(cleanMessage(undefined), '');
  assert.equal(cleanMessage({}), '');
});
