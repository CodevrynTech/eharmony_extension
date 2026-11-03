import { AppError } from './errors.js';
import { DEFAULT_SETTINGS, readinessProblem } from './settings.js';
import { normalizeCounter, incrementCounter } from './cap.js';
import { isAllowedUrl } from './urls.js';

export const composeMessage = (name, body) => `Hi ${name || 'there'}! ${body}`;

function fromContent(res) {
  if (!res) throw new AppError('item', 'The page did not respond. Reload the profile page and try again.', 'NO_RESPONSE');
  if (res.ok) return res;
  throw new AppError('item', res.error || 'Could not read the page', res.code || 'CONTENT_ERROR');
}

/**
 * Read-only workflow: read the open profile, ask the local server for a message, remember it.
 * The extension never writes into the site's chat box and never sends anything.
 *
 *  store:   { get(key), set(key, value) }
 *  browser: { getActiveTab() -> {id,url}, sendToTab(tabId, msg) -> response }
 *  api:     { generate(settings, { profileText, hintName }) -> { firstName, message } }
 */
export function createController({ store, browser, api, now = Date.now }) {
  let busy = false;

  return {
    async generateCurrent() {
      if (busy) throw new AppError('item', 'Already generating — please wait');
      busy = true;
      try {
        const settings = { ...DEFAULT_SETTINGS, ...((await store.get('settings')) || {}) };
        const problem = readinessProblem(settings);
        if (problem) throw new AppError('item', problem);

        const counter = normalizeCounter(await store.get('counter'), now());
        if (counter.count >= settings.dailyLimit) {
          throw new AppError('item', `Daily limit reached (${counter.count}/${settings.dailyLimit}). Raise it on the Generate tab to continue.`);
        }

        const tab = await browser.getActiveTab();
        if (!tab || !isAllowedUrl(tab.url)) throw new AppError('item', 'Open a profile page on the supported site first.');

        const page = fromContent(await browser.sendToTab(tab.id, { type: 'EXTRACT' }));
        const gen = await api.generate(settings, { profileText: page.text, hintName: page.hintName || '' });

        const next = incrementCounter(await store.get('counter'), now());
        await store.set('counter', next);
        const last = { name: gen.firstName, message: composeMessage(gen.firstName, gen.message), url: tab.url, at: now() };
        await store.set('last', last);
        return { ...last, count: next.count, limit: settings.dailyLimit };
      } finally {
        busy = false;
      }
    },
  };
}
