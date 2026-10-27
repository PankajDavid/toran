# Bandobast

A GenAI planning assistant for Indian weddings, birthdays and community events — budgets, timelines, vendor checklists and personalised ideas.

Built for **PromptWars Virtual** (Google × Hack2Skill), using Claude Code as the AI build partner.

## The idea: numbers you can trust

Most AI planners ask a language model to write the budget. Language models are bad at arithmetic, so the totals often don't add up.

Bandobast splits the work:

| Part | Who does it | Why |
|---|---|---|
| Budget split, per-guest costs, warnings | Deterministic TypeScript | Always exact, instant, testable |
| Timeline and deadlines | Deterministic TypeScript | Dates are calculated, never guessed |
| Vendor checklist | Fixed templates | Real questions to ask; **no invented vendors** |
| Themes, decor, menu ideas, invitation wording | Gemini *(Day 2)* | Creative text is where AI shines |

Every budget line adds up to the exact rupee total — enforced by tests across every event type and many awkward totals.

## What it covers

- **Weddings** — Punjabi, South Indian, Bengali, Christian or other, with haldi, mehendi, sangeet, ceremony and reception functions
- **Birthdays** — kids, adults, milestones
- **Community events** — jagran, langar, Diwali mela, RWA functions
- City tiers (metro / large city / small town) for realistic food-cost checks
- Short-notice events: the timeline compresses and flags late tasks instead of showing impossible past deadlines

## API

`POST /api/plan`

```json
{
  "eventType": "wedding",
  "subType": "punjabi",
  "subEvents": ["mehendi", "sangeet", "ceremony", "reception"],
  "totalBudgetINR": 2500000,
  "guestCount": 400,
  "cityTier": 2,
  "eventDate": "2027-02-14"
}
```

Returns the budget lines, per-guest figures, timeline, vendor checklist and warnings.

## Security

- All input validated with zod; unknown fields rejected; 10kb body limit
- Rate limits on every endpoint, stricter on planning
- Helmet security headers with a strict Content Security Policy; no CORS (same-origin only)
- Method-override headers stripped before anything else runs
- Generic error messages; logs never contain request bodies or personal details
- No accounts, no database: nothing personal is stored
- Runs as a non-root user in the container

## Run locally

```bash
npm install
npm test        # 94 tests
npm run dev     # http://localhost:8080
```

## Deploy

The Dockerfile works on any container host (Railway, Google Cloud Run). Set `PORT` if your host needs it. API keys go in the host's environment variables — never in the repo.

## Licence

MIT
