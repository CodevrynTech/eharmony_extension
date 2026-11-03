import crypto from 'node:crypto';
import express from 'express';
import { GeminiError } from './gemini.js';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const sha = (v) => crypto.createHash('sha256').update(String(v)).digest();
const safeEqual = (a, b) => crypto.timingSafeEqual(sha(a), sha(b));

function validateGenerateBody(body) {
  const str = (v, name, { min = 0, max, required = false } = {}) => {
    if (v === undefined || v === null || v === '') {
      if (required) throw new HttpError(400, 'VALIDATION', `${name} is required`);
      return '';
    }
    if (typeof v !== 'string') throw new HttpError(400, 'VALIDATION', `${name} must be a string`);
    const t = v.trim();
    if (t.length < min) throw new HttpError(400, 'VALIDATION', `${name} is too short`);
    if (t.length > max) throw new HttpError(400, 'VALIDATION', `${name} is too long (max ${max})`);
    return t;
  };
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'VALIDATION', 'JSON body required');
  }
  const maxChars = body.maxChars === undefined ? 400 : body.maxChars;
  if (!Number.isInteger(maxChars) || maxChars < 100 || maxChars > 1000) {
    throw new HttpError(400, 'VALIDATION', 'maxChars must be an integer between 100 and 1000');
  }
  return {
    profileText: str(body.profileText, 'profileText', { min: 100, max: 100000, required: true }),
    hintName: str(body.hintName, 'hintName', { max: 100 }),
    tone: str(body.tone, 'tone', { max: 100 }) || 'warm, friendly and genuine',
    language: str(body.language, 'language', { max: 50 }) || 'English',
    senderContext: str(body.senderContext, 'senderContext', { max: 500 }),
    maxChars,
  };
}

function createRateLimiter(limit, windowMs, now) {
  const hits = [];
  return () => {
    const t = now();
    while (hits.length && t - hits[0] >= windowMs) hits.shift();
    if (hits.length >= limit) return false;
    hits.push(t);
    return true;
  };
}

const utcDay = (ms) => new Date(ms).toISOString().slice(0, 10);

export function createApp({ config, generate, log = () => {}, now = Date.now }) {
  const app = express();
  app.disable('x-powered-by');

  // Per-license state. In memory: quotas reset on restart/redeploy (documented in the README).
  const usage = new Map(); // label -> { day, used }
  const limiters = new Map(); // label -> allow()
  const usageFor = (license) => {
    const day = utcDay(now());
    let u = usage.get(license.label);
    if (!u || u.day !== day) { u = { day, used: 0 }; usage.set(license.label, u); }
    return u;
  };
  const limiterFor = (license) => {
    if (!limiters.has(license.label)) limiters.set(license.label, createRateLimiter(config.rateLimitPerMin, 60000, now));
    return limiters.get(license.label);
  };

  // Liveness probe for the hosting platform: public, no data.
  app.get('/healthz', (req, res) => res.json({ ok: true }));

  app.use((req, res, next) => {
    // Loopback mode: block DNS rebinding with a Host allow-list. Public mode relies on the license token.
    if (!config.publicMode) {
      const host = String(req.headers.host || '').replace(/:\d+$/, '');
      if (!LOCAL_HOSTS.has(host)) return next(new HttpError(403, 'FORBIDDEN_HOST', 'Only local access is allowed'));
    }
    // Only the extension may call the API from a browser: no Origin (service worker) or a chrome-extension origin.
    const origin = req.headers.origin;
    if (origin) {
      const m = /^chrome-extension:\/\/([a-p]{32})$/.exec(origin);
      const allowed = m && (config.allowedExtensionIds.length === 0 || config.allowedExtensionIds.includes(m[1]));
      if (!allowed) return next(new HttpError(403, 'FORBIDDEN_ORIGIN', 'Origin not allowed'));
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Vary', 'Origin');
    }
    if (req.method === 'OPTIONS') return res.status(204).end();
    next();
  });

  // Authenticate before parsing bodies so anonymous callers cannot make us parse large payloads.
  app.use('/api', (req, res, next) => {
    const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
    let found = null;
    if (m) for (const l of config.licenses) if (safeEqual(m[1], l.token)) found = l; // no early exit
    if (!found) return next(new HttpError(401, 'UNAUTHORIZED', 'Invalid or missing license token'));
    req.license = found;
    next();
  });

  app.use(express.json({ limit: '300kb' }));

  app.get('/api/health', (req, res) => {
    const u = usageFor(req.license);
    res.json({ ok: true, model: config.model, quota: { limit: req.license.dailyLimit, used: u.used } });
  });

  app.post('/api/generate', async (req, res, next) => {
    const license = req.license;
    let reserved = null;
    try {
      if (!limiterFor(license)()) throw new HttpError(429, 'RATE_LIMITED', 'Too many requests, slow down');
      const input = validateGenerateBody(req.body);
      const u = usageFor(license);
      if (u.used >= license.dailyLimit) {
        throw new HttpError(429, 'QUOTA_EXCEEDED', `Daily quota of ${license.dailyLimit} messages is used up. It resets at 00:00 UTC.`);
      }
      u.used += 1; // reserve first so concurrent requests cannot overshoot the quota
      reserved = u;
      const started = Date.now();
      const result = await generate(input);
      log('generate ok', { license: license.label, ms: Date.now() - started, chars: result.message.length, used: u.used });
      res.json({ ...result, quota: { limit: license.dailyLimit, used: u.used } });
    } catch (err) {
      if (reserved) reserved.used -= 1; // failed generations are free
      next(err);
    }
  });

  app.use((req, res, next) => next(new HttpError(404, 'NOT_FOUND', 'Not found')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    let status = 500;
    let code = 'INTERNAL';
    let message = 'Internal server error';
    if (err instanceof HttpError || err instanceof GeminiError) {
      status = err.status; code = err.code; message = err.message;
    } else if (err?.type === 'entity.parse.failed') {
      status = 400; code = 'BAD_JSON'; message = 'Malformed JSON body';
    } else if (err?.type === 'entity.too.large') {
      status = 413; code = 'TOO_LARGE'; message = 'Request body too large';
    } else {
      log('unhandled error', { name: err?.name, message: err?.message });
    }
    res.status(status).json({ error: { code, message } });
  });

  return app;
}
