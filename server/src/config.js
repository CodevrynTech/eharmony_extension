export class ConfigError extends Error {}

const LABEL_RE = /^[A-Za-z0-9_-]{1,32}$/;
const MIN_TOKEN_LENGTH = 16;

function int(env, name, def, min, max) {
  const raw = env[name];
  if (raw === undefined || raw === '') return def;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new ConfigError(`${name} must be an integer between ${min} and ${max}`);
  }
  return n;
}

/**
 * LICENSES="alice:<token>:30,bob:<token>"   (label:token[:dailyLimit])
 * API_TOKEN="<token>" is still accepted as a single license labelled "default".
 * Error messages only ever mention labels, never tokens.
 */
export function parseLicenses(env, defaultLimit) {
  const licenses = [];
  const add = (label, token, dailyLimit) => {
    if (!LABEL_RE.test(label)) throw new ConfigError(`License label "${label}" must be 1-32 letters, digits, "_" or "-"`);
    if (token.length < MIN_TOKEN_LENGTH) throw new ConfigError(`License "${label}": token must be at least ${MIN_TOKEN_LENGTH} characters`);
    if (!Number.isInteger(dailyLimit) || dailyLimit < 1 || dailyLimit > 5000) {
      throw new ConfigError(`License "${label}": daily limit must be an integer between 1 and 5000`);
    }
    if (licenses.some((l) => l.label === label)) throw new ConfigError(`Duplicate license label "${label}"`);
    if (licenses.some((l) => l.token === token)) throw new ConfigError(`License "${label}" reuses another license's token`);
    licenses.push({ label, token, dailyLimit });
  };

  for (const entry of (env.LICENSES || '').split(',').map((s) => s.trim()).filter(Boolean)) {
    const parts = entry.split(':');
    const [label, token, limitRaw] = parts;
    if (parts.length < 2 || parts.length > 3 || !label || !token) {
      throw new ConfigError(`Invalid LICENSES entry for "${label || '?'}" (expected label:token[:dailyLimit])`);
    }
    add(label, token, limitRaw === undefined || limitRaw === '' ? defaultLimit : Number(limitRaw));
  }
  const legacy = (env.API_TOKEN || '').trim();
  if (legacy) add('default', legacy, defaultLimit);
  if (!licenses.length) {
    throw new ConfigError('Set LICENSES (label:token[:dailyLimit],...) or API_TOKEN. Each token must be at least 16 characters');
  }
  return licenses;
}

export function loadConfig(env = process.env) {
  const apiKey = (env.GEMINI_API_KEY || '').trim();
  if (!apiKey) throw new ConfigError('GEMINI_API_KEY is required (get one at https://aistudio.google.com/apikey)');

  const defaultDailyQuota = int(env, 'DEFAULT_DAILY_QUOTA', 50, 1, 5000);
  // Hosting platforms (Render sets RENDER=true / NODE_ENV=production) need a public bind address.
  const hosted = Boolean(env.RENDER) || env.NODE_ENV === 'production';
  const host = (env.HOST || (hosted ? '0.0.0.0' : '127.0.0.1')).trim();

  const extensionIds = (env.ALLOWED_EXTENSION_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
  for (const id of extensionIds) {
    if (!/^[a-p]{32}$/.test(id)) throw new ConfigError(`ALLOWED_EXTENSION_IDS contains an invalid extension id: "${id}"`);
  }

  return Object.freeze({
    apiKey,
    licenses: Object.freeze(parseLicenses(env, defaultDailyQuota)),
    port: int(env, 'PORT', 3000, 1, 65535),
    host,
    // On loopback we defend against DNS rebinding with a Host allow-list; on a public host the license token is the guard.
    publicMode: !['127.0.0.1', 'localhost', '::1'].includes(host),
    allowedExtensionIds: Object.freeze(extensionIds),
    model: (env.GEMINI_MODEL || 'gemini-2.5-flash').trim(),
    requestTimeoutMs: int(env, 'REQUEST_TIMEOUT_MS', 30000, 1000, 120000),
    maxRetries: int(env, 'GEMINI_MAX_RETRIES', 2, 0, 5),
    rateLimitPerMin: int(env, 'RATE_LIMIT_PER_MIN', 30, 1, 600),
    geminiBaseUrl: (env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, ''),
  });
}
