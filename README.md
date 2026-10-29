# Toran · every celebration, sorted

[![CI](https://github.com/PankajDavid/toran/actions/workflows/ci.yml/badge.svg)](https://github.com/PankajDavid/toran/actions/workflows/ci.yml)

A GenAI planning assistant for Indian weddings, birthdays, kitty parties and community events: exact budgets, timelines, vendor checklists, a quote checker and personalised ideas.

**Live:** https://toran.up.railway.app · Built for **PromptWars Virtual** (Google × Hack2Skill)

> **Every number is calculated by code, traced to a source, or read from a quote in your hand.**

## Why Toran is different

Most AI planners ask a language model to write the budget. Language models are bad at arithmetic and happily invent vendors and prices. Toran splits the work:

| Part | Who does it | Why |
|---|---|---|
| Budget split, per-guest costs, re-balancing after bookings | Deterministic TypeScript (`src/engine/`) | Exact to the rupee, instant, tested |
| Timeline, deadlines, late tasks, calendar file | Deterministic TypeScript | Dates are calculated, never guessed |
| Quote checks: maths, GST, minimums, missing items, advance | Deterministic TypeScript | A rule either passes or it doesn't |
| "Toran suggests" next actions | Deterministic TypeScript, user approves each | AI-free proposals, nothing runs without a tap |
| Vendors | Real Google Maps listings or ones you add | **Never invented** |
| Understanding Hinglish answers, reading a quote photo | Gemini (extracts only; you confirm) | Language and documents are where AI shines |
| Themes, decor, menu, invitation wording, tips | Gemini | Creative text; any money amounts are stripped |

## Features

1. **Guided interview**: type or speak in English or Hinglish ("beti ki shaadi 14 feb, 250 log, 20 lakh, Ludhiana, pure veg"). Local parsing first; Gemini only fills gaps. Every guess is shown and editable.
2. **Exact budget**: split by event type and style (Punjabi, South Indian, Bengali, Christian weddings; kids/adult/milestone birthdays; kitty and anniversary parties; jagran, langar, Diwali mela, society functions). Record real costs and the budget re-balances: savings go to the buffer, overspend comes out of it first.
3. **Timeline**: every task dated back from the event day. Short notice compresses the plan and flags late tasks instead of showing impossible past dates.
4. **Vendors**: questions to ask per category, real vendors from Google Maps (search by city or "near me", location rounded to ~1 km on the phone), a tracker from *to contact* to *confirmed*, WhatsApp the questions in one tap. Confirming a vendor books their price into the budget.
5. **Quote Checker**: photograph a quotation. Gemini reads it into a table, you confirm every line, then code checks line maths, GST, minimum plate guarantees, items families assume are included, advance over 50% and refund terms, and writes a polite WhatsApp message with every question. Save quotes to compare; book the one you pick.
6. **Toran suggests**: the next useful action, worked out by code: book the most urgent vendor, tick an overdue task, over budget, balances due, add deadlines to your calendar, save a backup. Approve or "Not now".
7. **Ideas, Invitation, Tips**: personalised by Gemini, filtered for diet (veg/Jain) and stripped of any prices.
8. **Share and keep**: WhatsApp summary, plan link (the plan travels in the link, never on our server), calendar file (.ics), PDF, backup file and restore, installable app (PWA).

## GenAI services used

- **Gemini 3.8 Flash** (`@google/genai`, structured JSON output): reads quote photos and PDFs into line items; writes themes, decor, menu, invitation wording and tips.
- **Gemini 3.5 Flash-Lite**: understands free-form interview answers in English and Hinglish.
- **Google Maps Platform, Places API (New)**: real vendor listings with ratings, address, phone and Maps link.
- Every AI feature has a non-AI fallback (local parser, curated ideas, manual quote entry), so the app works even when AI is down.

We also tried Gemini's Google Search grounding for live market prices. Production logs showed the model did not reliably run the search, so answers came back without sources. Toran refuses unsourced prices, so the feature now opens code-built Google searches ("Check prices online") instead. Details in the commit history.

## Security

- LLM output is untrusted: validated with zod, rendered with `textContent` only (no `innerHTML` anywhere).
- User text, documents and web content go to the model as delimited data; prompts tell it to ignore instructions inside them. City names are validated (letters only, max 4 words) before they reach any search.
- Uploads: type checked by the file's first bytes (not the claimed type), 8 MB cap, held in memory only, never written to disk or logged. Photos are re-encoded on the phone, which strips GPS data.
- Rate limits on every endpoint, stricter for AI (20/min), quote reading (8/min) and Places (10/min); 10 kb JSON body limit.
- Helmet with a strict Content Security Policy; no CORS (same-origin only); method-override headers stripped first.
- Generic error messages to clients; logs carry only method, path, status and timing, never bodies, names, phones or locations.
- No accounts, no database: plans live in the browser. API keys only in the host's environment variables. Container runs as a non-root user.

## Testing

```bash
npm install
npm test          # 340 unit and API tests
npm run test:coverage  # coverage: 98% of lines, 88% of branches; CI fails below 95% / 85%
npm run typecheck
npm run lint      # Biome: lint + format check (TypeScript, browser JS, CSS)
npm run check     # all three, as CI runs on every push
npm run test:e2e  # 30 browser tests (Playwright) on a phone and a desktop screen
```

Tests cover the budget (every line adds up to the exact total for every event type), timeline, bookings and re-balancing, the quote checks, suggestions (every rupee figure traced to the plan), the calendar file format, the interview parser, idea sanitising, Places result filtering and the HTTP API (validation, upload checks, offline fallbacks). AI is faked through an injected `AiClient`.

Browser tests (`e2e/`) drive the real app on a phone and a desktop screen: the Hinglish interview, exact budget totals, tabs and keyboard navigation, bookings, Toran suggests, the calendar file, Google Maps search (fake listings, no key needed), the Quote Checker, never booking a vendor twice, backup and restore, the plan link, no horizontal scrolling, and an axe accessibility scan of every screen. After tests pass we deliberately break the code to confirm a test fails.

## Accessibility

Keyboard-operable throughout (sections menu is an ARIA tablist with arrow keys), visible focus, skip link, labelled form fields, live regions for chat and results, 44 px touch targets, reduced-motion support, works at 320 px wide.

## Architecture

```
public/            Plain HTML and CSS, PWA files (no framework, no build step)
public/js/         Browser ES modules, one job each (none over 300 lines), type-checked with checkJs:
                   interview, plan, nav, costs, booking, vendors, vendor-find, vendor-contact,
                   quote, quote-read, quote-verdict, ideas, share, files, suggest, install, store, dom, format, main
src/engine/        Deterministic planner: budget, timeline, vendors, deals, quote checks, suggestions, calendar
src/interview/     Local Hinglish parser + interview flow (AI only for gaps)
src/ai/            Gemini client (injectable), ideas, quote reader
src/places/        Google Places client with result validation
src/app.ts         Express 5 routes, security middleware, rate limits
```

## Run locally

```bash
cp .env.example .env   # add GEMINI_API_KEY and GOOGLE_MAPS_API_KEY (both optional)
npm run dev            # http://localhost:8080
```

The Dockerfile runs on any container host (Railway, Google Cloud Run).

## Licence

MIT
