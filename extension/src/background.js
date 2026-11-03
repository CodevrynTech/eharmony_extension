import { createController } from '../lib/controller.js';
import { createApi } from '../lib/api.js';
import { chromeStore, chromeBrowser } from './chrome-adapters.js';

const controller = createController({ store: chromeStore, browser: chromeBrowser, api: createApi() });

// Toolbar icon opens the side panel.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((err) => console.error('sidePanel', err));
chromeStore.set('status', { state: 'idle', at: Date.now() }).catch(() => {});

let working = false;

/** Single entry point for the button and the keyboard shortcut; mirrors progress into storage for the panel. */
async function runGenerate() {
  if (working) throw new Error('Already generating — please wait');
  working = true;
  await chromeStore.set('status', { state: 'working', at: Date.now() });
  try {
    const result = await controller.generateCurrent();
    await chromeStore.set('status', { state: 'idle', at: Date.now() });
    return result;
  } catch (err) {
    await chromeStore.set('status', { state: 'idle', error: err?.message || String(err), at: Date.now() });
    throw err;
  } finally {
    working = false;
  }
}

async function dispatch(msg) {
  switch (msg.type) {
    case 'generate': return runGenerate();
    default: throw new Error(`Unknown command: ${msg.type}`);
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.source !== 'pm-panel' || sender.id !== chrome.runtime.id) return false;
  dispatch(msg).then(
    (data) => sendResponse({ ok: true, data }),
    (err) => sendResponse({ ok: false, error: err?.message || String(err) }),
  );
  return true;
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== 'generate-message') return;
  // sidePanel.open() must run synchronously inside the user gesture, so call it before anything async.
  if (tab?.id != null) chrome.sidePanel.open({ tabId: tab.id }).catch((err) => console.error('sidePanel.open', err));
  runGenerate().catch(() => {}); // the error is already written to `status` for the panel to show
});
