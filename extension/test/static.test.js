import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('every element id used by panel.js exists in panel.html', () => {
  const html = read('panel/panel.html');
  const js = read('panel/panel.js');
  const htmlIds = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  const used = new Set([...js.matchAll(/\$\('([^']+)'\)/g)].map((m) => m[1]));
  const fields = js.match(/const FIELDS = \[([\s\S]*?)\];/)[1].match(/'([^']+)'/g).map((s) => s.slice(1, -1));
  for (const f of fields) used.add(f);
  for (const name of ['generate', 'settings']) used.add(`tab-${name}`);
  assert.deepEqual([...used].filter((id) => !htmlIds.has(id)), []);
});

test('manifest references files that exist and matches allowed hosts', () => {
  const m = JSON.parse(read('manifest.json'));
  assert.equal(m.manifest_version, 3);
  for (const p of [m.background.service_worker, m.side_panel.default_path, ...m.content_scripts.flatMap((c) => c.js)]) {
    assert.ok(fs.existsSync(path.join(root, p)), `${p} missing`);
  }
  for (const perm of ['storage', 'scripting', 'tabs', 'clipboardWrite', 'sidePanel']) assert.ok(m.permissions.includes(perm));
  assert.ok(m.host_permissions.includes('https://*.eharmony.com/*'));
  assert.ok(m.host_permissions.includes('https://*.onrender.com/*'));
  assert.deepEqual(m.optional_host_permissions, ['https://*/*']);
  assert.deepEqual(m.content_scripts[0].matches, ['https://*.eharmony.com/*']);
});

test('panel html links existing css/js', () => {
  const html = read('panel/panel.html');
  for (const m of html.matchAll(/(?:href|src)="([^"]+\.(?:css|js))"/g)) {
    assert.ok(fs.existsSync(path.join(root, 'panel', m[1])), `${m[1]} missing`);
  }
});

test('background commands match panel commands', () => {
  const bg = read('src/background.js');
  const panel = read('panel/panel.js');
  const sent = new Set([...panel.matchAll(/command\('([A-Za-z]+)'/g)].map((m) => m[1]));
  const handled = new Set([...bg.matchAll(/case '([A-Za-z]+)'/g)].map((m) => m[1]));
  for (const s of sent) assert.ok(handled.has(s), `background does not handle "${s}"`);
});

test('content script message types match what the controller sends', () => {
  const content = read('src/content.js');
  const ctrl = read('lib/controller.js');
  for (const m of ctrl.matchAll(/type: '([A-Z_]+)'/g)) assert.ok(content.includes(`case '${m[1]}'`), `content lacks ${m[1]}`);
});

test('extension code never writes to or submits the site (read-only guarantee)', () => {
  for (const f of ['src/content.js', 'src/background.js', 'src/chrome-adapters.js', 'lib/controller.js']) {
    const code = read(f);
    assert.ok(!/\.click\(|\.submit\(|execCommand|dispatchEvent|\.value\s*=|insertText|\.innerHTML\s*=|\.textContent\s*=/.test(code), `${f} contains a DOM write/click`);
  }
});

test('side panel opens from the toolbar icon and a keyboard shortcut is declared and handled', () => {
  const m = JSON.parse(read('manifest.json'));
  assert.equal(m.action.default_popup, undefined);
  const cmd = m.commands['generate-message'];
  assert.ok(cmd.suggested_key.default);
  const bg = read('src/background.js');
  assert.ok(bg.includes("'generate-message'"));
  assert.ok(bg.includes('openPanelOnActionClick: true'));
  // the panel and background must agree on the message source
  assert.ok(bg.includes("'pm-panel'") && read('panel/panel.js').includes("'pm-panel'"));
});
