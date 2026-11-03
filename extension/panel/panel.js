import { DEFAULT_SETTINGS, sanitizeSettings } from '../lib/settings.js';
import { normalizeCounter } from '../lib/cap.js';
import { createApi } from '../lib/api.js';

const $ = (id) => document.getElementById(id);
const FIELDS = ['serverUrl', 'apiToken', 'tone', 'language', 'maxChars', 'senderContext'];
const WORKING_STALE_MS = 120000;
const GENERATE_LABEL = 'Generate message for the open profile';

let state = { settings: { ...DEFAULT_SETTINGS }, counter: null, last: null, status: null };
let ownRequest = false; // true while this panel itself awaits a generate() response (avoids duplicate toasts)
let seenStatusAt = Date.now();
let seenLastAt = 0;
let toastTimer;

function toast(text, kind = 'ok') {
  const el = $('toast');
  el.textContent = text;
  el.className = kind;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, kind === 'error' ? 8000 : 3500);
}

async function command(type) {
  const res = await chrome.runtime.sendMessage({ source: 'pm-panel', type });
  if (!res) throw new Error('The background worker did not respond. Reload the extension.');
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

async function load() {
  const stored = await chrome.storage.local.get(['settings', 'counter', 'last', 'status']);
  state = {
    settings: { ...DEFAULT_SETTINGS, ...(stored.settings || {}) },
    counter: stored.counter || null,
    last: stored.last || null,
    status: stored.status || null,
  };
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

const isWorking = () => state.status?.state === 'working' && Date.now() - state.status.at < WORKING_STALE_MS;

function render() {
  const counter = normalizeCounter(state.counter, Date.now());
  const limit = state.settings.dailyLimit;
  $('todayText').textContent = `${counter.count} / ${limit}`;
  $('todayBar').style.width = `${Math.min(100, (counter.count / limit) * 100)}%`;
  $('todayBar').parentElement.classList.toggle('full', counter.count >= limit);
  if (document.activeElement !== $('quickLimit')) $('quickLimit').value = limit;

  const working = isWorking();
  $('btnGenerate').disabled = working;
  $('btnRegen').disabled = working;
  $('btnGenerate').textContent = working ? 'Reading profile and writing…' : GENERATE_LABEL;

  const last = state.last;
  $('result').hidden = !last;
  if (last) {
    $('resultText').textContent = last.message;
    $('resultFor').textContent = last.name ? `Message for ${last.name}` : 'Last message';
  }
}

function fillSettingsForm() {
  for (const f of FIELDS) $(f).value = state.settings[f] ?? '';
}

function readSettingsForm() {
  const out = {};
  for (const f of FIELDS) out[f] = $(f).value;
  return out;
}

async function guard(fn) {
  try {
    return await fn();
  } catch (err) {
    toast(err.message || String(err), 'error');
    return undefined;
  }
}

// ---------- tabs ----------
for (const tab of document.querySelectorAll('nav [role=tab]')) {
  tab.addEventListener('click', () => {
    for (const t of document.querySelectorAll('nav [role=tab]')) t.setAttribute('aria-selected', String(t === tab));
    for (const name of ['generate', 'settings']) $(`tab-${name}`).hidden = name !== tab.dataset.tab;
  });
}

// ---------- generate ----------
async function generate() {
  ownRequest = true;
  try {
    const result = await guard(() => command('generate'));
    if (result) {
      const copied = await copyToClipboard(result.message);
      toast(copied ? 'Done — message copied to clipboard.' : 'Done. Press Copy to copy the message.');
    }
  } finally {
    ownRequest = false;
  }
}
$('btnGenerate').addEventListener('click', generate);
$('btnRegen').addEventListener('click', generate);

$('btnCopy').addEventListener('click', async () => {
  if (!state.last) return;
  toast((await copyToClipboard(state.last.message)) ? 'Copied.' : 'Could not copy — select the text and press Ctrl+C.');
});

/** Quick edit of the daily limit; validates only that field so it works before the token is set. */
$('quickLimit').addEventListener('change', () => guard(async () => {
  const probe = { ...state.settings, apiToken: state.settings.apiToken || 'x'.repeat(16), dailyLimit: $('quickLimit').value };
  const { settings, errors } = sanitizeSettings(probe);
  if (errors.length) { render(); throw new Error(errors[0]); }
  await chrome.storage.local.set({ settings: { ...state.settings, dailyLimit: settings.dailyLimit } });
  toast('Saved.');
}));

// ---------- settings ----------
$('btnSave').addEventListener('click', () => guard(async () => {
  const { settings, errors } = sanitizeSettings({ ...state.settings, ...readSettingsForm() });
  if (errors.length) throw new Error(errors[0]);
  await chrome.storage.local.set({ settings });
  fillSettingsForm();
  toast('Settings saved.');
}));

$('btnTest').addEventListener('click', () => guard(async () => {
  const { settings, errors } = sanitizeSettings({ ...state.settings, ...readSettingsForm() });
  const relevant = errors.filter((e) => /URL|token/i.test(e));
  if (relevant.length) throw new Error(relevant[0]);
  const r = await createApi().health(settings);
  toast(`Connected. Model: ${r.model}`);
}));

// ---------- live updates (also covers the keyboard-shortcut flow, which runs in the background) ----------
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local') return;
  const status = changes.status?.newValue;
  const last = changes.last?.newValue;
  await load();
  render();
  if (ownRequest) return;
  if (status?.error && status.at > seenStatusAt) {
    seenStatusAt = status.at;
    toast(status.error, 'error');
  }
  if (last && last.at > seenLastAt) {
    seenLastAt = last.at;
    const copied = await copyToClipboard(last.message);
    toast(copied ? 'New message ready — copied to clipboard.' : 'New message ready. Press Copy to copy it.');
  }
});

await load();
seenLastAt = state.last?.at || 0;
fillSettingsForm();
render();
