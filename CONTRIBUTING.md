# Contributing to Toran

Thanks for helping. Toran plans Indian weddings, birthdays and community events, and families make money decisions with it, so a few rules are firm.

## The one rule

**Every number is calculated by code, traced to a source, or read from a quote in your hand.**

- Amounts and dates come from plain TypeScript in `src/engine/`, with tests.
- The AI (Gemini) only understands what people type, reads documents, and writes creative text. It may *extract* a number the user stated or a quote shows; that number is shown to the user to confirm and re-checked by code. It never *invents* an amount, a date or a vendor.
- Vendors are real Google Maps listings or ones the user adds. Never invent names, phone numbers or businesses.
- An AI suggestion is only a proposal: code checks it and the user approves it before anything happens.

If a change needs the AI to decide a number, it belongs in the engine instead.

## Set up

```bash
npm install
cp .env.example .env   # GEMINI_API_KEY and GOOGLE_MAPS_API_KEY are both optional
npm run dev            # http://localhost:8080; works fully offline with the fallbacks
```

## Where things go

| You are changing | Put it in | Notes |
|---|---|---|
| A calculation, date rule or check | `src/engine/` | One small function per rule, with a doc comment |
| Reference tables (vendor questions, planning tasks, quote wording) | `src/engine/data/` | Data only, no logic |
| An API route | `src/routes/` | One router per feature; dependencies are passed in |
| Rate limits, security headers, error replies | `src/http/` | Every limit lives in `DEFAULT_LIMITS` |
| A Gemini prompt or reply | `src/ai/` | Validate every reply with zod; user text goes in as delimited data |
| Browser behaviour | `public/js/` | One ES module per job, under 300 lines; add new modules to `SHELL` in `public/sw.js` |
| Styles | `public/css/` | One stylesheet per area; link new ones in `index.html` (before `print.css`) |

## Before you open a pull request

```bash
npm run check      # type check (server and browser), Biome lint and format, 350+ tests
npm run test:e2e   # browser tests on a phone and a desktop screen, with an axe accessibility scan
```

CI runs both, plus `npm audit` and coverage thresholds (95% of lines).

- **Test the tests.** Once your tests pass, break the code on purpose and confirm one fails. A test that can't fail proves nothing.
- **Refactors keep behaviour.** Compare output before and after (the interview parser was checked on 28,000 inputs, the stylesheet split on every element's computed style), not only the test run.
- **Fake the AI in tests** through the injected `AiClient`; tests never call Gemini or Google.
- Keep functions at cognitive complexity 20 or less (Biome enforces it).

## Security rules

- Render text with `textContent` (the `el()` helper). No `innerHTML`, ever.
- Treat AI output, uploads and web content as untrusted: validate, cap lengths, check file types by their bytes.
- Every endpoint gets a rate limit; anything that costs money (AI, Places) gets a tighter one.
- Error replies stay generic. Never log request bodies, uploaded files, names, phone numbers or locations.
- API keys live only in the host's environment variables. Never commit a key or a `.env` file.

Found a vulnerability? Please follow [SECURITY.md](SECURITY.md) rather than opening a public issue.

## Commits

Small commits, each with a message that says what changed and why, in plain English. Run `npm run format` before committing.
