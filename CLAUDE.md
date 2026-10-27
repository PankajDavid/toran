# Bandobast — project rules for AI coding agents

GenAI planning assistant for Indian weddings, birthdays, kitty parties and community events.
Pitch: "Every number is calculated by code, traced to a source, or read from a quote in your hand."
Built for PromptWars Virtual Challenge 5 (Google x Hack2Skill). Final deadline: 1 Nov 2026, 11:59 PM IST.
Concept doc: https://claude.ai/artifact/KSkuKFyLLpA5ofmtNtTP99

## CORE ARCHITECTURE RULE (non-negotiable)
- Every calculated number and date comes from deterministic TypeScript in `src/engine/`.
- The LLM (Gemini) does three jobs only: understand what users say (interview), read documents
  (vendor quotes), and write creative text (themes, decor, menu, invitation wording).
- The LLM may EXTRACT numbers the user stated or a document shows (e.g. "15 lakh", a quote line).
  Extracted values are always shown to the user for confirmation and re-validated by code.
- The LLM never INVENTS amounts or dates. Creative text containing amounts is dropped.
- Web prices only with a source URL returned by search grounding; shown as ranges, labelled
  "for budgeting only, confirm with the vendor".
- Vendors are real Google Places listings or user-entered. NEVER invent vendor names, phones, businesses.
- AI proposes actions; code checks them; the user approves each one before anything happens.

## Stack
- Node 22 + TypeScript + Express 5, plain HTML/CSS/vanilla JS frontend (no frameworks).
- Gemini via `@google/genai`, structured JSON output. Model from env `GEMINI_MODEL`
  (default `gemini-3.8-flash`). Every AI feature has a non-AI fallback.
- No database, no login: plan state lives in the browser (localStorage + backup file).
- Tests: Vitest. Validation: zod. Deploy: Docker on Railway (Cloud Run compatible). Repo < 10MB.

## Security rules (Infinite India Security Audit Protocol v2.3 — applicable subset)
- LLM output is untrusted: validate with zod; render with textContent only, never innerHTML.
- User text, documents and web pages go into prompts as delimited data, never as instructions.
- Rate-limit every endpoint per IP; stricter limits on AI, Places and search endpoints.
- Cap all input lengths; JSON body limit 10kb (uploads have their own size/type limits).
- `stripOverrideHeaders` is the first middleware. No CORS headers (same-origin only).
- Generic error messages to clients; details only in server logs.
- Never log request bodies, uploaded files, names, phone numbers or other user details.
- API keys only in platform env vars. No secrets in git. `.env.example` only.
- Throttle AI-triggering buttons (≥2000ms) on the frontend.

## Build plan
- 27 Oct: engine, tests, deploy, AI layer, interview engine, ideas
- 28 Oct: interview UI with voice, planner screens
- 29 Oct: Quote Checker (read, confirm table, checks, compare, shortlist, deal closed)
- 30 Oct: Find vendors (Places + grounded prices), agent cards, calendar file, backup — first submission
- 31 Oct: accessibility, tests, real-quote testing
- 1 Nov: video, LinkedIn, submission texts

## Testing rule
After tests pass, deliberately break something and confirm a test fails ("test the tests").
Run `npm test` before every commit. AI is faked in tests via the injected `AiClient`.
