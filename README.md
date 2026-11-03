# Profile Message Writer

Chrome extension + local Node server. You open a profile, click **Generate**, and the extension reads the page text,
asks Gemini (through your local server) for a personalised first message, and shows it in a **side panel** next to the
page with a **Copy** button. **You paste and send it yourself.** The extension never types into or clicks anything on the site.

```
open profile ──page text──▶ extension ──HTTP (token)──▶ localhost:3000 ──▶ Gemini
side panel: "Hi Anna! …"  [Copy] ◀── extension ◀──────────── JSON ◀────────────┘
```

No database: settings, the daily counter and the last message live in `chrome.storage.local`; the Gemini key lives
only in the server `.env`.

## Setup (5 minutes)

1. `pnpm install`
2. Copy `.env.example` to `.env`; set `GEMINI_API_KEY` (https://aistudio.google.com/apikey) and `API_TOKEN`
   (any 16+ char secret: `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`).
3. `pnpm start` — keep this terminal open.
4. Chrome → `chrome://extensions` → turn on **Developer mode** → **Load unpacked** → select the `extension` folder.
   (Without Developer mode Chrome disables unpacked extensions.)
5. Click the extension icon (opens the side panel) → **Settings** → paste the same token → **Save** → **Test connection**.

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

* `pnpm test` — 55 tests (server, Gemini client with mocked HTTP, extension logic, content script on jsdom fixtures,
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

The server binds to `127.0.0.1`, requires `Authorization: Bearer <API_TOKEN>` (constant-time compare), rejects
non-local `Host` headers (DNS rebinding) and any `Origin` that is not `chrome-extension://`, rate-limits, validates
input and size-limits bodies. Profile text is wrapped as untrusted data in the prompt, and links/emails are stripped
from the output.

```
server/src      config · prompt · gemini client · express app
extension/lib   settings · cap · urls · api · controller (pure, tested)
extension/src   background worker · chrome adapters · content script (read-only)
extension/panel side panel UI
```
