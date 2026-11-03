export class ConfigError extends Error {}

function int(env, name, def, min, max) {
  const raw = env[name];
  if (raw === undefined || raw === '') return def;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new ConfigError(`${name} must be an integer between ${min} and ${max}`);
  }
  return n;
}

export function loadConfig(env = process.env) {
  const apiKey = (env.GEMINI_API_KEY || '').trim();
  if (!apiKey) throw new ConfigError('GEMINI_API_KEY is required (get one at https://aistudio.google.com/apikey)');

  const apiToken = (env.API_TOKEN || '').trim();
  if (apiToken.length < 16) throw new ConfigError('API_TOKEN is required and must be at least 16 characters');

  return Object.freeze({
    apiKey,
    apiToken,
    port: int(env, 'PORT', 3000, 1, 65535),
    model: (env.GEMINI_MODEL || 'gemini-2.5-flash').trim(),
    requestTimeoutMs: int(env, 'REQUEST_TIMEOUT_MS', 30000, 1000, 120000),
    maxRetries: int(env, 'GEMINI_MAX_RETRIES', 2, 0, 5),
    rateLimitPerMin: int(env, 'RATE_LIMIT_PER_MIN', 30, 1, 600),
    geminiBaseUrl: (env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, ''),
  });
}
