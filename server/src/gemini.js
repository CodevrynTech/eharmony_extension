import { buildSystemInstruction, buildUserContent } from './prompt.js';
import { cleanMessage, cleanName } from './sanitize.js';

export class GeminiError extends Error {
  constructor(code, message, { status = 502, retryable = false } = {}) {
    super(message);
    this.name = 'GeminiError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function extractText(data) {
  if (data?.promptFeedback?.blockReason) {
    throw new GeminiError('BLOCKED', `Gemini blocked the request (${data.promptFeedback.blockReason})`, { status: 422 });
  }
  const cand = data?.candidates?.[0];
  if (!cand) throw new GeminiError('EMPTY_RESPONSE', 'Gemini returned no candidates', { retryable: true });
  if (cand.finishReason && !['STOP', 'MAX_TOKENS'].includes(cand.finishReason)) {
    throw new GeminiError('BLOCKED', `Gemini stopped early (${cand.finishReason})`, { status: 422 });
  }
  const text = (cand.content?.parts || []).map((p) => p.text || '').join('').trim();
  if (!text) throw new GeminiError('EMPTY_RESPONSE', 'Gemini returned empty text', { retryable: true });
  return text;
}

function parseJson(text) {
  const stripped = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    const value = JSON.parse(stripped);
    if (!value || typeof value !== 'object') throw new Error('not an object');
    return value;
  } catch {
    throw new GeminiError('BAD_JSON', 'Gemini returned malformed JSON', { retryable: true });
  }
}

async function callOnce(config, fetchImpl, body) {
  const url = `${config.geminiBaseUrl}/models/${encodeURIComponent(config.model)}:generateContent`;
  let res;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': config.apiKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(config.requestTimeoutMs),
    });
  } catch (err) {
    const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    throw new GeminiError(timedOut ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_UNREACHABLE',
      timedOut ? 'Gemini request timed out' : 'Could not reach Gemini', { status: 504, retryable: true });
  }
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json())?.error?.message || ''; } catch { /* ignore */ }
    if ((res.status === 400 && /api key/i.test(detail)) || res.status === 401 || res.status === 403) {
      throw new GeminiError('UPSTREAM_AUTH', 'Gemini rejected the API key or access is denied', { status: 502 });
    }
    if (res.status === 429) {
      throw new GeminiError('UPSTREAM_RATE_LIMIT', 'Gemini rate limit / quota reached', { status: 429, retryable: true });
    }
    if (res.status >= 500) {
      throw new GeminiError('UPSTREAM_ERROR', `Gemini server error (${res.status})`, { status: 503, retryable: true });
    }
    throw new GeminiError('UPSTREAM_BAD_REQUEST', `Gemini rejected the request (${res.status}) ${detail}`.trim(), { status: 502 });
  }
  return res.json();
}

export function createGenerator(config, fetchImpl = globalThis.fetch, sleepImpl = sleep) {
  return async function generate(input) {
    const body = {
      systemInstruction: { parts: [{ text: buildSystemInstruction(input) }] },
      contents: [{ role: 'user', parts: [{ text: buildUserContent(input) }] }],
      generationConfig: {
        temperature: 0.8,
        maxOutputTokens: 2048,
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: { firstName: { type: 'STRING' }, message: { type: 'STRING' } },
          required: ['firstName', 'message'],
        },
      },
    };

    let lastErr;
    for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
      try {
        const data = await callOnce(config, fetchImpl, body);
        const parsed = parseJson(extractText(data));
        const firstName = cleanName(parsed.firstName) || cleanName(input.hintName);
        const message = cleanMessage(parsed.message, { name: firstName, maxChars: input.maxChars });
        if (message.length < 20) throw new GeminiError('BAD_OUTPUT', 'Gemini message was too short', { retryable: true });
        return { firstName, message };
      } catch (err) {
        lastErr = err;
        if (!(err instanceof GeminiError) || !err.retryable || attempt === config.maxRetries) break;
        await sleepImpl(Math.min(4000, 400 * 2 ** attempt));
      }
    }
    throw lastErr;
  };
}
