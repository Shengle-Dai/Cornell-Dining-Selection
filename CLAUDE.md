# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Campus Meal Pick (CMP) is an automated pipeline that scrapes daily menus from Cornell's West Campus dining halls, analyzes them with an LLM, and emails personalized recommendations to subscribers. Three main components:

1. **Python recommender** (`recommend_daily.py`) — scrapes menus via Playwright, calls Groq LLM (OpenAI-compatible API), sends HTML emails via Gmail SMTP
2. **Cloudflare Worker** (`worker/src/index.js`) — subscription API with HMAC-verified subscribe/confirm/unsubscribe endpoints, backed by Cloudflare KV
3. **GitHub Actions** — daily cron trigger (`eatery_recommend.yml` at 10 AM UTC) and event-driven verification emails (`send_verification.yml`)

## Commands

### Python (recommender)
```bash
pip install -r requirements.txt
python -m playwright install chromium
python recommend_daily.py          # Run the full scrape → analyze → email pipeline
```

### Cloudflare Worker
```bash
cd worker
npm run sync-env    # Copy HMAC_SECRET and GH_PAT_TOKEN from ../.env to .dev.vars
npm run dev         # Local dev server at localhost:8787
npm run deploy      # Deploy to Cloudflare
```

Wrangler secrets (production): `wrangler secret put HMAC_SECRET` and `wrangler secret put GH_PAT_TOKEN`

## Architecture & Data Flow

```
Dining Website → Playwright scrape → MenuSlice[] (by meal bucket)
  → Groq LLM (prompt.md as system prompt) → JSON top-3 picks per meal
  → Sanitize & validate against scraped data
  → Build HTML email → Fetch subscribers from Worker KV (fallback: TO_EMAIL env var)
  → Gmail SMTP delivery with per-recipient HMAC unsubscribe links
```

**Subscription flow:** User POSTs email to Worker → Worker dispatches GitHub Actions (`repository_dispatch`) to send verification email → User clicks confirm link → Worker verifies HMAC token and stores email in KV.

## Key Files

- `recommend_daily.py` — All scraping, LLM, email logic. Key functions: `scrape_menus()`, `call_llm()`, `sanitize_result()`, `build_email()`, `send_emails()`
- `prompt.md` — LLM system prompt with food preferences and output format spec (strict JSON with 3 picks per meal, dishes with Chinese translations)
- `worker/src/index.js` — Cloudflare Worker with routes: `GET /`, `POST /api/subscribe`, `GET /api/confirm`, `GET /api/unsubscribe`, `GET /api/subscribers`
- `worker/wrangler.toml` — Worker config with KV namespace binding (`SUBSCRIBERS`), `GH_OWNER`/`GH_REPO` vars
- `.github/workflows/eatery_recommend.yml` — Daily cron + manual dispatch
- `.github/workflows/send_verification.yml` — Triggered by `repository_dispatch` event from Worker

## Environment Variables

Required in `.env` (and as GitHub Secrets for Actions):
`GROQ_API_KEY`, `GMAIL_USER`, `GMAIL_APP_PASSWORD`, `TO_EMAIL`, `HMAC_SECRET`, `GH_PAT_TOKEN`, `WORKER_BASE_URL`

Optional: `GROQ_MODEL` (default: `openai/gpt-oss-120b`)

Worker-specific (set in `wrangler.toml` as `[vars]`): `GH_OWNER`, `GH_REPO`
Worker secrets (set via `wrangler secret put`): `HMAC_SECRET`, `GH_PAT_TOKEN`

## Notable Patterns

- HMAC-SHA256 tokens for email verification and unsubscribe links, with constant-time comparison
- `EATERY_DENYLIST` in `recommend_daily.py` excludes specific eateries (currently `104West!`)
- `EVENT_BUCKET` dict maps meal panel titles (Breakfast, Brunch, Lunch, Late Lunch, Dinner) to three buckets: `breakfast_brunch`, `lunch`, `dinner`
- LLM output is sanitized: deduped to max 3 unique eateries per meal, validated against actual scraped eatery names
- Subscriber fetch falls back gracefully from KV to `TO_EMAIL` env var
- Uses OpenAI SDK pointed at Groq's OpenAI-compatible endpoint (`api.groq.com/openai/v1/`)
- Verification emails are sent via GitHub Actions (repository_dispatch) rather than directly from the Worker
