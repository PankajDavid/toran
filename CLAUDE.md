# UtsavIQ — project rules for AI coding agents

GenAI planning assistant for Indian weddings, birthdays and community events:
budgets, timelines, vendor checklists, personalised ideas.
Built for PromptWars Virtual (Google x Hack2Skill). Deadline: ~1 Nov 2026.

## CORE ARCHITECTURE RULE (non-negotiable)
- Every number and date is computed by deterministic TypeScript in `src/engine/`.
- The LLM (Gemini) only writes creative text: themes, decor, menu ideas,
  invitation wording, short explanations.
- If LLM output contains amounts or dates, ignore them. Never display LLM numbers.
- Vendor checklist = categories + questions. NEVER invent vendor names, phones, businesses.

## Stack
- Node 22 + TypeScript + Express 5, plain HTML/CSS/vanilla TS frontend (no frameworks).
- Gemini API (structured JSON output) — added on Day 2.
- Tests: Vitest. Validation: zod.
- Deploy: Docker image (Railway now; Cloud Run compatible). Repo must stay small (<10MB).

## Security rules (Infinite India Security Audit Protocol v2.3 — applicable subset)
- LLM output is untrusted: validate with zod; render with textContent only, never innerHTML.
- User free text goes into prompts as clearly delimited data, never as instructions.
- Rate-limit every endpoint per IP; stricter limit on the Gemini endpoint.
- Cap all input lengths; JSON body limit 10kb.
- `stripOverrideHeaders` is the first middleware.
- No CORS headers sent (same-origin only). If cross-origin is ever needed: explicit allowlist.
- Generic error messages to clients; details only in server logs.
- Never log request bodies, names, phone numbers or other user details.
- API keys only in platform env vars / secret manager. No secrets in git. `.env.example` only.
- Debounce/throttle the generate button (≥2000ms) on the frontend.

## Scope by day
1. Engine + tests + server skeleton + deploy (done Day 1)
2. Gemini layer: schema, validation, fallback when Gemini fails
3. UI: budget, timeline, checklist, ideas, what-if sliders, PDF export
4. Tests, security pass, accessibility, README
5. Blog + LinkedIn + demo video, submit

## Testing rule
After tests pass, deliberately break something and confirm a test fails ("test the tests").
Run `npm test` before every commit.
