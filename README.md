# Profile Message Writer

Chrome extension + local Node server. You open a profile, click **Generate**, and the extension reads the page text,
asks Gemini (through your local server) for a personalised first message, and shows it in a **side panel** next to the
page with a **Copy** button. **You paste and send it yourself.** The extension never types into or clicks anything on the site.

```
open profile ──page text──▶ extension ──HTTP (token)──▶ localhost:3000 ──▶ Gemini
side panel: "Hi Anna! …"  [Copy] ◀── extension ◀──────────── JSON ◀────────────┘
```

No database: settings, the daily counter and the last message live in `chrome.storage.local`; the Gemini key lives
only on the server (`.env` locally, an environment variable on Render).

## Run locally (development)

1. `pnpm install`
2. Copy `.env.example` to `.env`; set `GEMINI_API_KEY` (https://aistudio.google.com/apikey) and `API_TOKEN`
   (any 16+ char secret) — or use `LICENSES` as in the deployment section.
3. `pnpm start` — keep this terminal open.
4. Chrome → `chrome://extensions` → turn on **Developer mode** → **Load unpacked** → select the `extension` folder.
   (Without Developer mode Chrome disables unpacked extensions.)
5. Click the extension icon (opens the side panel) → **Settings** → paste the token → **Save** → **Test connection**.


## Deploy on Render (so users need no setup)

1. Push this repo to GitHub, then Render → **New → Blueprint** → select the repo (it reads `render.yaml`).
2. Fill the secrets Render asks for:
   * `GEMINI_API_KEY` — your key (it never leaves the server).
   * `LICENSES` — one entry per user, `label:token[:dailyLimit]`, comma-separated. Generate entries with
     `pnpm license acme 50` (prints the token to give the user and the entry to paste here).
   * `ALLOWED_EXTENSION_IDS` (optional) — your extension's id, to stop other extensions using the API.
3. Check `https://<your-service>.onrender.com/healthz` returns `{"ok":true}`.
4. Set `DEFAULT_SERVER_URL` in `extension/lib/config.js` to that URL.

Notes: the Starter plan is recommended (the free plan sleeps after 15 min idle and the first request takes 30–60 s).
Quotas are per license per UTC day and held in memory, so they reset if the service restarts or redeploys. To remove a
user, delete their entry from `LICENSES` and redeploy. Not tested on Render itself: the same server was verified locally
in production mode (`RENDER=true`, production dependencies only, public host, per-license quota).

## Give the extension to a user

* **Zip (free):** zip the `extension` folder (after step 4 above). The user extracts it, opens `chrome://extensions`,
  turns on **Developer mode**, clicks **Load unpacked**, then pastes their license token in the side panel's Settings.
* **Chrome Web Store, Unlisted ($5 one-time developer fee):** upload the zip; the user installs from the link with no
  Developer mode and gets automatic updates. Needs a privacy-policy URL and a review.

## Using it

1. Open a member's profile on the site.
2. Click the extension icon to open the side panel (it stays open while you work), then **Generate message for the
   open profile** — or just press **Alt+Shift+G** on the profile (change it at `chrome://extensions/shortcuts`).
3. The message appears in the panel and is copied to the clipboard. Paste it into the chat box and press Send
   yourself; the panel keeps the text visible while you do.

* **Daily limit** (Generate tab, 1–500) caps how many messages can be generated per day; it resets at local midnight
  and is editable at any time. Failed generations do not count.
* Tone, language, max length and an optional "About you" line are in Settings.

## Verified

* `pnpm test` — 64 tests (server, Gemini client with mocked HTTP, extension logic, content script on jsdom fixtures,
  static wiring, and a check that the extension code contains no DOM write/click/submit calls).
* End to end in a real Chromium with the extension loaded, a logged-in eharmony session and the real Gemini API:
  page read (preference/filter boilerplate trimmed) → server → Gemini → side panel showing a personalised message,
  button disabled while working, counter updated, clipboard copy, and live updates pushed from the background worker.
  The **Alt+Shift+G** key press itself could not be automated (browser shortcuts bypass test tooling); it is registered
  (`chrome.commands.getAll()` lists it) — press it once to confirm, and rebind it if another extension owns that combo.

## Limits

* **Not automatic sending.** eharmony's first-message box actively blocks pasted text for some accounts
  (`data-prevent-copypaste` + a dialog), and its heart button immediately sends a Like. This tool deliberately does not
  fill the box, click Like, or send — it only reads the open page. If the site shows its paste warning, type the
  message instead of pasting it.
* **Terms of Use / privacy.** Profile text is personal data sent to Google; use a paid-tier Gemini key (free tier may
  be used for model improvement). The server never logs profile text.
* To support another site, add its host to `host_permissions` and `content_scripts.matches` in `manifest.json` and
  to `ALLOWED_HOST_SUFFIXES` in `extension/lib/urls.js`.

## Security model

Every request needs `Authorization: Bearer <license token>` (constant-time compare against all licenses). Each license
has its own daily quota and per-minute rate limit; failed generations do not use quota. Only `chrome-extension://`
origins (optionally only your extension id) may call the API. Locally the server binds to `127.0.0.1` and rejects
non-local `Host` headers (DNS rebinding); on Render it binds publicly and the token is the guard. Input is validated
and bodies are size-limited. Profile text is wrapped as untrusted data in the prompt, and links/emails are stripped
from the output.

```
server/src      config · prompt · gemini client · express app
extension/lib   config · settings · cap · urls · api · controller (pure, tested)
extension/src   background worker · chrome adapters · content script (read-only)
extension/panel side panel UI
```
