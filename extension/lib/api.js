import { AppError } from './errors.js';

const REQUEST_TIMEOUT_MS = 120000;

function mapHttpError(status, body) {
  const code = body?.error?.code || 'HTTP_ERROR';
  const msg = body?.error?.message || `Server returned ${status}`;
  if (status === 404 && code !== 'NOT_FOUND') return new AppError('fatal', 'No server found at this address (404). Check the Server URL in Settings.', 'WRONG_URL');
  if (status === 401 || status === 403) return new AppError('fatal', `The server rejected your license token. ${msg}`, code);
  if (code === 'UPSTREAM_AUTH') return new AppError('fatal', `Gemini API key problem: ${msg}. Check GEMINI_API_KEY in the server .env.`, code);
  if (code === 'QUOTA_EXCEEDED') return new AppError('item', msg, code);
  if (status === 400 || status === 413 || status === 422) return new AppError('item', msg, code);
  if (status === 429 || status === 502 || status === 503 || status === 504 || status >= 500) return new AppError('transient', msg, code);
  return new AppError('item', msg, code);
}

export function createApi(fetchImpl = globalThis.fetch.bind(globalThis)) {
  async function call(settings, path, { method = 'GET', body } = {}) {
    let res;
    try {
      res = await fetchImpl(`${settings.serverUrl}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${settings.apiToken}`,
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
        throw new AppError('transient', 'The server timed out (it may be waking up — try again)', 'SERVER_TIMEOUT');
      }
      throw new AppError('fatal', `Cannot reach the server at ${settings.serverUrl}. Check your internet connection (or start the local server).`, 'SERVER_DOWN');
    }
    let json = null;
    try { json = await res.json(); } catch { /* non-JSON body */ }
    if (!res.ok) throw mapHttpError(res.status, json);
    if (!json) throw new AppError('transient', 'The server sent an invalid response', 'BAD_RESPONSE');
    return json;
  }

  return {
    health: (settings) => call(settings, '/api/health'),
    async generate(settings, { profileText, hintName }) {
      const out = await call(settings, '/api/generate', {
        method: 'POST',
        body: {
          profileText,
          hintName,
          tone: settings.tone,
          language: settings.language,
          senderContext: settings.senderContext,
          maxChars: settings.maxChars,
        },
      });
      if (typeof out.message !== 'string' || !out.message) {
        throw new AppError('transient', 'The server returned no message', 'BAD_RESPONSE');
      }
      return { firstName: typeof out.firstName === 'string' ? out.firstName : '', message: out.message };
    },
  };
}
