/* Content script (classic script, not a module). READ-ONLY: it returns the visible text of the page
 * on request and never writes into, clicks or submits anything on the site. */
(function () {
  if (globalThis.__pmLoaded) return;
  globalThis.__pmLoaded = true;

  const DEFAULT_TIMEOUTS = { extract: 15000, poll: 200 };
  const MIN_PROFILE_CHARS = 150;
  const MAX_CHARS = 50000;
  const NAME_STOPWORDS = new Set(['welcome', 'eharmony', 'profile', 'home', 'login', 'sign', 'your', 'the', 'match', 'matches', 'dating']);
  // Boilerplate that follows the profile on the site's pages (filter/preference lists): cut it to save tokens.
  const TAIL_MARKERS = [/\bMEMBER PREFERENCES\b/, /\bFILTER MEMBERS ACCORDING TO\b/i];

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const fail = (code, error) => ({ ok: false, code, error });

  function pageText() {
    const raw = String(document.body.innerText ?? document.body.textContent ?? '');
    let text = raw.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    for (const re of TAIL_MARKERS) {
      const m = re.exec(text);
      if (m && m.index >= MIN_PROFILE_CHARS) text = text.slice(0, m.index).trim();
    }
    return text;
  }

  function guessName() {
    const valid = (w) => {
      const word = String(w || '').replace(/[^\p{L}'’-]/gu, '');
      return word.length >= 2 && word.length <= 30 && !NAME_STOPWORDS.has(word.toLowerCase()) ? word : '';
    };
    const h1 = document.querySelector('h1');
    const fromH1 = h1 ? valid(norm(h1.textContent).split(/[\s,|·\-–]+/)[0]) : '';
    if (fromH1) return fromH1;
    return valid(norm(document.title).split(/[\s,|·\-–]+/)[0]);
  }

  async function extractProfile(options = {}) {
    const t = { ...DEFAULT_TIMEOUTS, ...(options.timeouts || {}) };
    if (/\/(log-?in|sign-?in)\b/i.test(location.pathname)) return fail('LOGIN_REQUIRED', 'You are not logged in. Log in to the site first.');
    // Wait until the text is long enough and has stopped changing (SPA pages render late).
    let last = -1;
    let stable = 0;
    let text = '';
    const end = Date.now() + t.extract;
    while (Date.now() < end) {
      text = pageText();
      if (text.length >= MIN_PROFILE_CHARS && text.length === last) { if (++stable >= 2) break; } else stable = 0;
      last = text.length;
      await sleep(t.poll);
    }
    if (text.length < MIN_PROFILE_CHARS) {
      if (document.querySelector('input[type="password"]')) return fail('LOGIN_REQUIRED', 'You are not logged in. Log in to the site first.');
      return fail('PROFILE_EMPTY', 'The profile text did not load (page too short).');
    }
    return { ok: true, text: text.slice(0, MAX_CHARS), hintName: guessName(), url: location.href, title: document.title };
  }

  async function handle(msg) {
    try {
      switch (msg.type) {
        case 'PING': return { ok: true };
        case 'EXTRACT': return await extractProfile(msg.options);
        default: return fail('UNKNOWN_MESSAGE', `Unknown message type: ${msg.type}`);
      }
    } catch (err) {
      return fail(err?.code || 'CONTENT_ERROR', err?.message || String(err));
    }
  }

  globalThis.__pmContent = { extractProfile, handle };

  if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (!msg || msg.source !== 'pm') return false;
      handle(msg).then(sendResponse);
      return true;
    });
  }
})();
