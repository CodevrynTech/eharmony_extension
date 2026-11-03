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

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

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

function createRateLimiter(limit, windowMs = 60000, now = Date.now) {
  const hits = [];
  return () => {
    const t = now();
    while (hits.length && t - hits[0] >= windowMs) hits.shift();
    if (hits.length >= limit) return false;
    hits.push(t);
    return true;
  };
}

export function createApp({ config, generate, log = () => {} }) {
  const app = express();
  app.disable('x-powered-by');
  const allow = createRateLimiter(config.rateLimitPerMin);

  // Block DNS-rebinding and calls from ordinary web pages: only local hosts, and
  // only requests with no Origin (extension service worker) or a chrome-extension origin.
  app.use((req, res, next) => {
    const host = String(req.headers.host || '').replace(/:\d+$/, '');
    if (!LOCAL_HOSTS.has(host)) return next(new HttpError(403, 'FORBIDDEN_HOST', 'Only local access is allowed'));
    const origin = req.headers.origin;
    if (origin && !origin.startsWith('chrome-extension://')) {
      return next(new HttpError(403, 'FORBIDDEN_ORIGIN', 'Origin not allowed'));
    }
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Vary', 'Origin');
    }
    if (req.method === 'OPTIONS') return res.status(204).end();
    next();
  });

  app.use(express.json({ limit: '300kb' }));

  app.use('/api', (req, res, next) => {
    const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
    if (!m || !safeEqual(m[1], config.apiToken)) return next(new HttpError(401, 'UNAUTHORIZED', 'Invalid or missing API token'));
    next();
  });

  app.get('/api/health', (req, res) => res.json({ ok: true, model: config.model }));

  app.post('/api/generate', async (req, res, next) => {
    try {
      if (!allow()) throw new HttpError(429, 'RATE_LIMITED', 'Too many requests, slow down');
      const input = validateGenerateBody(req.body);
      const started = Date.now();
      const result = await generate(input);
      log('generate ok', { ms: Date.now() - started, chars: result.message.length });
      res.json(result);
    } catch (err) {
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
