import { AppError } from '../lib/errors.js';

export const chromeStore = {
  async get(key) {
    return (await chrome.storage.local.get(key))[key];
  },
  async set(key, value) {
    await chrome.storage.local.set({ [key]: value });
  },
};

export const chromeBrowser = {
  async sendToTab(tabId, msg) {
    const payload = { source: 'pm', ...msg };
    try {
      return await chrome.tabs.sendMessage(tabId, payload);
    } catch {
      // Content script missing (tab opened before install): inject once and retry.
      try {
        await chrome.scripting.executeScript({ target: { tabId }, files: ['src/content.js'] });
      } catch (err) {
        throw new AppError('item', `Cannot access the page: ${err.message}`, 'NO_ACCESS');
      }
      try {
        return await chrome.tabs.sendMessage(tabId, payload);
      } catch (err) {
        throw new AppError('item', `The page did not respond: ${err.message}`, 'NO_RESPONSE');
      }
    }
  },

  async getActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return tab ? { id: tab.id, url: tab.url || '' } : null;
  },
};
