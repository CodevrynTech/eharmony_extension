import { DEFAULT_SERVER_URL } from './config.js';

export const DEFAULT_SETTINGS = Object.freeze({
  dailyLimit: 30,
  serverUrl: DEFAULT_SERVER_URL,
  apiToken: '',
  tone: 'warm, friendly and genuine',
  language: 'English',
  senderContext: '',
  maxChars: 400,
});

const intIn = (v, min, max) => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
};

/** Validates raw popup input. Returns { settings, errors } — only save when errors is empty. */
export function sanitizeSettings(input = {}) {
  const errors = [];
  const merged = { ...DEFAULT_SETTINGS, ...input };
  const s = {};

  s.dailyLimit = intIn(merged.dailyLimit, 1, 500);
  if (s.dailyLimit === null) errors.push('Daily limit must be a whole number between 1 and 500.');

  s.maxChars = intIn(merged.maxChars, 100, 1000);
  if (s.maxChars === null) errors.push('Max message length must be between 100 and 1000 characters.');

  const url = String(merged.serverUrl || '').trim().replace(/\/+$/, '');
  try {
    const u = new URL(url);
    const local = u.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(u.hostname);
    const remote = u.protocol === 'https:' && u.hostname.includes('.') && !u.username && !u.password;
    if (!local && !remote) throw new Error('bad');
    s.serverUrl = `${u.protocol}//${u.host}`;
  } catch {
    errors.push('Server URL must be an https address (https://your-server.example.com) or a local http address (http://127.0.0.1:3000).');
    s.serverUrl = DEFAULT_SERVER_URL;
  }

  s.apiToken = String(merged.apiToken || '').trim();
  if (s.apiToken.length < 16) errors.push('License token must be at least 16 characters.');

  const text = (key, label, max, { required = false } = {}) => {
    const v = String(merged[key] ?? '').trim();
    if (v.length > max) errors.push(`${label} must be at most ${max} characters.`);
    if (required && !v) errors.push(`${label} is required.`);
    s[key] = v.slice(0, max);
  };
  text('tone', 'Tone', 100, { required: true });
  text('language', 'Language', 50, { required: true });
  text('senderContext', 'About you', 500);

  return { settings: s, errors };
}

/** Returns a human-readable problem if the saved settings cannot be used, else ''. */
export function readinessProblem(settings) {
  const { errors } = sanitizeSettings(settings);
  return errors.length ? `Fix settings first: ${errors[0]}` : '';
}
