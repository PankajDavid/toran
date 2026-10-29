# Security

Toran handles people's event plans, budgets and vendor quotations. It is built so that there is very little to steal and very little an attacker can make it do.

## Design

- **No accounts, no database.** Plans live in the user's browser. The server keeps nothing between requests.
- **Uploads** (quote photos and PDFs) are checked by their first bytes, not their name or claimed type; capped at 8 MB; held in memory for one request; never written to disk, logged, served back or opened by any parser on our server. Phones re-encode photos before upload, which strips GPS data.
- **AI output is untrusted.** Every Gemini response is validated with zod (types, lengths, ranges, allowed values) and rendered with `textContent` only; there is no `innerHTML` anywhere. Gemini has no tools and no access to keys or other users' data.
- **Prompt injection.** Documents and user text go to the model as delimited data with an instruction to ignore instructions inside them. The model only transcribes; plain code decides every finding, and the user confirms every extracted line before checks run. City names are validated (letters only, at most 4 words) before any search.
- **Rate limits** per IP on every API route, stricter for AI (20/min), quote reading (8/min) and Google Places (10/min); 10 kb JSON body limit; buttons that call AI are throttled in the browser. Google Places has a daily quota.
- **Headers.** Strict Content Security Policy (`'self'` only, no inline scripts, `object-src 'none'`, `frame-ancestors 'none'`), HSTS, `Referrer-Policy: no-referrer`, `nosniff`, a minimal `Permissions-Policy`. No CORS headers. Method-override headers are stripped before anything else runs. Nothing is loaded from third-party sites (fonts are self-hosted).
- **Logs** contain only method, path, status and timing; never bodies, names, phone numbers, locations or file contents. Clients get generic error messages.
- **Secrets** live only in the host's environment variables; `.env.example` holds names, never values. The container runs as a non-root user.
- **Dependencies** are checked by `npm audit` in CI and kept current by Dependabot.

## Reporting a vulnerability

Please open a private security advisory on GitHub (Security → Report a vulnerability) rather than a public issue. We aim to reply within 72 hours.
