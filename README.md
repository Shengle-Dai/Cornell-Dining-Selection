# Campus Meal Pick (CMP)

Automated daily AI-powered dining recommendations from Cornell West Campus eateries, personalized per-user via food2vec embeddings and delivered via email.

## How it works

1. **Scrape** — Launches headless Chromium via Playwright, navigates to Cornell dining, clicks the "West" campus tab, and extracts each dining hall's meal menus (categories + individual dishes)
2. **Embed** — New dishes are sent to a Groq LLM for ingredient extraction, then embedded into 300-dim vectors using food2vec and cached in Supabase
3. **Rank** — For each user, computes cosine similarity between their preference vector and dish vectors to find the top-3 eateries per meal. Users without preferences get LLM-based fallback recommendations
4. **Email** — Formats personalized picks into a styled HTML email with HMAC-signed rating links and sends via Gmail SMTP

## Architecture

```
┌─────────────────────┐     ┌──────────────────────┐     ┌─────────────────┐
│  Cloudflare Worker   │     │  Supabase             │     │  GitHub Actions  │
│  (landing page,      │────▶│  (PostgreSQL+pgvector, │◀────│  (daily cron)    │
│   OAuth, ratings)    │     │   Google OAuth, RLS)   │     │                  │
└─────────────────────┘     └──────────────────────┘     └─────────────────┘
                                       ▲
                                       │
                              ┌────────┴────────┐
                              │  Python Pipeline  │
                              │  (scrape, embed,  │
                              │   rank, email)    │
                              └─────────────────┘
```

**Auth flow:** Landing page → "Sign in with Google" → Supabase OAuth → callback extracts token → redirect to `/onboarding` (if no prefs) or confirmation page. Only `.edu` emails allowed (enforced by DB trigger).

**Recommendation flow:** Scrape → embed new dishes → fetch user prefs from Supabase → rank dishes by hybrid score (cosine similarity + Jaccard flavor/method + cuisine match) → send personalized email with rating links.

**Rating flow:** User clicks thumbs up/down in email → Worker validates HMAC token → upserts into `ratings` table + sets `vector_stale = TRUE` → Python pipeline recomputes preference vector on next daily run.

**Unsubscribe flow:** HMAC-signed URL in email → Worker verifies → sets `profiles.subscribed = FALSE` via Supabase service role.

## Setup

### Prerequisites

- Python 3.11+
- Node.js (for Cloudflare Worker development)
- A [Gmail app password](https://support.google.com/accounts/answer/185833)
- A [Groq API key](https://console.groq.com/)
- A Cloudflare account (for the Worker)
- A [Supabase](https://supabase.com/) project with Google OAuth enabled

### Install

```bash
# Python recommender
pip install -r requirements.txt
python -m playwright install chromium

# Cloudflare Worker
cd worker
npm install
```

### Supabase setup

1. Create a Supabase project and enable the Google OAuth provider
2. Run `supabase/schema.sql` in the SQL editor (creates tables, triggers, RLS policies, pgvector extension)
3. Configure Google OAuth to restrict to `.edu` emails

### Environment variables

Create a `.env` file in the project root:

```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
GROQ_API_KEY=gsk_...
GMAIL_USER=you@gmail.com
GMAIL_APP_PASSWORD=abcd efgh ijkl mnop
TO_EMAIL=fallback@example.com
HMAC_SECRET=your-secret-key
WORKER_BASE_URL=https://your-worker.workers.dev
```

| Variable                   | Required | Description                                             |
| -------------------------- | -------- | ------------------------------------------------------- |
| `SUPABASE_URL`             | Yes      | Supabase project URL                                    |
| `SUPABASE_SERVICE_ROLE_KEY`| Yes      | Supabase service role key (bypasses RLS)                |
| `GROQ_API_KEY`             | Yes      | Groq API key for LLM calls                              |
| `GROQ_MODEL`               | No       | Model name (default: `openai/gpt-oss-120b`)             |
| `GMAIL_USER`               | Yes      | Gmail address used to send emails                       |
| `GMAIL_APP_PASSWORD`       | Yes      | Gmail app password                                      |
| `TO_EMAIL`                 | No       | Fallback comma-separated recipients (if no subscribers) |
| `HMAC_SECRET`              | Yes      | Shared secret for HMAC token signing                    |
| `WORKER_BASE_URL`          | Yes      | Base URL of the deployed Cloudflare Worker              |

### Cloudflare Worker setup

```bash
cd worker

# Local development
npm run sync-env    # Copies HMAC_SECRET and SUPABASE_SERVICE_ROLE_KEY from ../.env to .dev.vars
npm run dev         # Starts local dev server at localhost:8787

# Production
wrangler secret put HMAC_SECRET
wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npm run deploy
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `WORKER_ORIGIN` are configured in `worker/wrangler.toml` under `[vars]`.

## Usage

### Run locally

```bash
python recommend_daily.py
```

### Automated (GitHub Actions)

The included workflow (`.github/workflows/eatery_recommend.yml`) runs daily at 10:00 AM UTC. Trigger manually:

```bash
gh workflow run "CMP Daily Recommendation"
```

Store the environment variables as repository secrets in GitHub.

## Configuration

- **`prompt.md`** — LLM system prompt controlling ingredient extraction and cold-start fallback recommendations
- **Meal buckets** — `EVENT_BUCKET` in `recommend_daily.py` maps meal panel titles (Breakfast, Brunch, Lunch, Late Lunch, Dinner) to three buckets
- **Eatery denylist** — `EATERY_DENYLIST` in `recommend_daily.py` to exclude specific eateries

## Database schema

Supabase PostgreSQL with pgvector:

- **`profiles`** — user profiles (auto-created on OAuth sign-up via trigger), `subscribed` flag
- **`dishes`** — normalized dish data with 300-dim pgvector embeddings + `flavor_profiles`, `cooking_methods`, `cuisine_type`, `dietary_attrs`, `dish_type` (main/side/condiment/beverage/dessert)
- **`user_preferences`** — `initial_ingredients` + continuous JSONB weight dicts `flavor_weights`, `method_weights`, `cuisine_weights` (initialized 1.0 at onboarding, updated from ratings) + `dietary_restrictions` + computed preference vector, `vector_stale` flag
- **`ratings`** — per-user dish ratings (+1/-1), linked to `dishes` and `daily_menus`
- **`daily_menus`** — daily dish-to-eatery-to-bucket mapping for rating links
