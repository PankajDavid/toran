# Architecture

Toran is a small Node server and a framework-free browser app. The one rule that shapes everything:

> **Every number is calculated by code, traced to a source, or read from a quote in your hand.**

The language model never decides an amount or a date. It reads (what people type, what a quotation shows) and writes (ideas, invitation wording). Plain TypeScript does every calculation and every check, and is tested.

## Request flow

```
Browser (public/js, ES modules)                     Server (src/, Express 5)
───────────────────────────────                     ─────────────────────────────────────────
interview.js ── POST /api/interview ──────────────▶ interview/  local Hinglish parser first,
                                                               Gemini Flash-Lite only for gaps
plan.js ─────── POST /api/plan ───────────────────▶ engine/     budget, timeline, vendors,
                (plan input + bookings + done)                 bookings, suggestions (no AI)
quote-read.js ─ POST /api/quote/read (photo/PDF) ─▶ ai/quoteReader  Gemini Flash reads lines
quote-verdict ─ POST /api/quote/check ────────────▶ engine/quote    plain-code checks, incl. GST amount vs rate
vendor-find.js  POST /api/vendors/find ───────────▶ places/     Google Places (New)
ideas.js ────── POST /api/ideas ──────────────────▶ ai/ideas    Gemini writes; code filters
files.js ────── POST /api/calendar ───────────────▶ engine/ics  RFC 5545 calendar file
```

There is no database and no login. The plan lives in the browser (`localStorage`), travels in the plan link's `#fragment` (never sent to a server), and can be saved as a backup file. The server recalculates the plan from scratch on every request and keeps nothing.

## Server (`src/`)

| Folder | What it does | AI? |
|---|---|---|
| `engine/` | Budget split (largest-remainder rounding, so lines add up to the rupee), timeline (dated back from the event, compressed when late), vendor checklist, bookings and re-balancing, Toran suggests, quote checks, calendar file | No |
| `engine/data/` | Reference tables kept apart from the logic: vendor categories and questions, planning tasks with lead times, the wording the Quote Checker looks for. Budget shares and limits are in `engine/config.ts` | No |
| `interview/` | Local parser for English/Hinglish (dates, guests, lakh/crore, cities, diet), the question flow, validation of every field | Only for gaps |
| `ai/` | One injectable `AiClient` for Gemini (structured JSON output), the quote reader, ideas. Every reply is re-validated with zod | Yes |
| `places/` | Google Places client; query built by code from a fixed term and a validated city; results filtered | No (Google Maps) |
| `routes/` | One small Express router per feature (interview, plan and calendar, quote, ideas, vendors), each given its dependencies (AI, Places, today's date, limits) so tests can fake them | |
| `http/` | Security headers and override-header stripping, one rate-limit helper with every limit in one table, the 404 and generic error handlers | |
| `app.ts` | Composition only: middleware order, static files, `/health`, then the routers | |

## Browser (`public/js/`)

One module per job, none over 300 lines, type-checked with `checkJs`. All text is inserted with `textContent` via the `el()` helper; there is no `innerHTML`.

| Module | Job |
|---|---|
| `main.js` | Entry point: buttons, restore on open |
| `store.js` | State object, `localStorage`, API calls, AI throttle |
| `dom.js`, `format.js` | Element builder, typed lookups, money/date formatting, labels |
| `interview.js` | Chat, quick answers, voice input |
| `plan.js`, `nav.js`, `costs.js` | Plan screen, section tabs, booking and cost forms |
| `booking.js` | Recording deals on budget lines, never twice for the same vendor |
| `vendors.js`, `vendor-find.js`, `vendor-contact.js` | Vendor tracker, Google Maps search, WhatsApp questions |
| `quote.js`, `quote-read.js`, `quote-verdict.js` | Quote Checker: start, read and confirm, verdict |
| `ideas.js`, `suggest.js` | Ideas/invitation/tips; approve-before-act suggestions |
| `share.js`, `files.js`, `install.js` | WhatsApp, plan link, backup/restore, calendar, install |

## Styles (`public/css/`)

One stylesheet per area, linked in cascade order: `base` (brand colour tokens, reset, buttons, form fields) first, then `layout`, one file per feature, the plan-ready animation, and `print` last so the PDF rules win. A test checks that every stylesheet is linked and cached for offline use. When the old single 1,700-line file was split, the computed style of every element was compared before and after in 11 app states, on phone, laptop and wide screens, for screen and print: identical.

## Where AI sits, and the guard around each use

| Use | Model | Guard |
|---|---|---|
| Understanding answers | Gemini 3.5 Flash-Lite | Local parser runs first; AI fields validated per field; local readings win; guesses are shown for the user to confirm |
| Reading a quotation | Gemini 3.8 Flash | File type checked by bytes; document sent as data; output validated; user confirms every line; code does the checks; text addressed to an AI is flagged |
| Ideas, invitation, tips | Gemini 3.8 Flash | Any money amount dropped; veg/Jain enforced by code; curated offline ideas when AI is down |

## Quality gates (CI on every push)

`npm audit` (production) · TypeScript strict (server) and `checkJs` (browser) · Biome lint and format, cognitive complexity ≤ 20 per function · 355 unit and API tests with coverage ≥ 95% lines · build · 34 Playwright browser tests on phone and desktop, including an axe WCAG 2.2 AA scan of 13 screens and states.
