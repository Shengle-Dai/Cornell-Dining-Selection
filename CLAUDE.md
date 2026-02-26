# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Campus Meal Pick (CMP) is an automated pipeline that scrapes daily menus from Cornell's West Campus dining halls, generates personalized recommendations using food2vec embeddings, and emails them to subscribers. Four main components:

1. **Python recommender** (`recommend_daily.py` + `food_embeddings.py`, `ingredient_extractor.py`, `recommendation_engine.py`, `supabase_client.py`) — scrapes menus via Playwright, embeds dishes using food2vec, ranks per-user via cosine similarity, falls back to Groq LLM for users without preferences
2. **Cloudflare Worker** (`worker/src/index.js`) — landing page with Google OAuth, onboarding, HMAC-verified email action links (rating, unsubscribe)
3. **GitHub Actions** — daily cron trigger (`eatery_recommend.yml` at 10 AM UTC)
4. **Supabase** — Google OAuth, PostgreSQL database with pgvector for embeddings, RLS policies

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
npm install
npm run sync-env    # Copy HMAC_SECRET and SUPABASE_SERVICE_ROLE_KEY from ../.env to .dev.vars
npm run dev         # Local dev server at localhost:8787
npm run deploy      # Deploy to Cloudflare
```

Wrangler secrets (production): `wrangler secret put HMAC_SECRET` and `wrangler secret put SUPABASE_SERVICE_ROLE_KEY`

### Supabase Setup
1. Create Supabase project, enable Google OAuth provider
2. Run `supabase/schema.sql` in the SQL editor (creates tables, triggers, RLS policies, pgvector extension)
3. Configure Google OAuth to restrict to .edu emails

## Architecture & Data Flow

```
Dining Website → Playwright scrape → MenuSlice[] (by meal bucket)
  → For new dishes: Groq LLM extracts ingredients + attributes (flavors, cooking methods, cuisine, dietary) → food2vec embeds → cache in Supabase
  → Per user: hybrid score(cosine_sim + flavor/method Jaccard + cuisine match) → top-3 eateries per meal
  → Fallback: Groq LLM recommendation for users without preferences
  → Build HTML email with rating links (👍👎) → Gmail SMTP per-recipient delivery
```

**Auth flow:** Landing page → "Sign in with Google" → Supabase OAuth → callback page extracts token → redirect to `/onboarding` (if no prefs) or confirmation page. Only .edu emails allowed (enforced by DB trigger).

**Recommendation flow:** Scrape → extract dish attributes (ingredients, flavors, cooking methods, cuisine, dietary) + embed new dishes → fetch user prefs from Supabase → rank dishes by hybrid score (weighted cosine similarity + flavor/method Jaccard + cuisine match) → send personalized email with rating links.

**Rating flow:** User clicks 👍/👎 in email → Worker GET `/api/rate` validates HMAC token → upserts into `ratings` table + sets `vector_stale = TRUE` → Python pipeline recomputes preference vector on next daily run.

**Unsubscribe flow:** HMAC-signed URL in email → Worker verifies → sets `profiles.subscribed = FALSE` via Supabase service role.

**Database schema (Supabase PostgreSQL + pgvector):**
- `profiles` — user profiles (auto-created on OAuth sign-up via trigger), `subscribed` flag
- `dishes` — normalized dish data with 300-dim pgvector embeddings + `flavor_profiles`, `cooking_methods`, `cuisine_type`, `dietary_attrs`, `dish_type` (main/side/condiment/beverage/dessert)
- `user_preferences` — initial cuisine/ingredient prefs + `preferred_flavors`, `preferred_methods` + computed preference vector, `vector_stale` flag
- `ratings` — per-user dish ratings (+1/-1), linked to `dishes` and `daily_menus`
- `daily_menus` — daily dish-to-eatery-to-bucket mapping for rating links

## Key Files

- `recommend_daily.py` — Main pipeline: scrape, embed, rank, email. Key functions: `scrape_menus()`, `build_email()`, `main()`
- `food_embeddings.py` — `FoodVectorModel` wrapper around food2vec, `cosine_similarity()`, `normalize_dish_name()`
- `ingredient_extractor.py` — `extract_dish_attributes_batch()` via Groq LLM for new dishes (ingredients, flavors, cooking methods, cuisine, dietary); `extract_ingredients_batch()` backward-compatible wrapper
- `recommendation_engine.py` — `compute_preference_vector()`, `generate_recommendations()` with hybrid scoring (cosine similarity + Jaccard flavor/method + cuisine match), decay-weighted liked/disliked signals
- `supabase_client.py` — `SupabaseClient` for dishes, user prefs, ratings, daily menu CRUD via Supabase service role key
- `supabase/schema.sql` — Database schema with tables, triggers, RLS policies, pgvector index
- `prompt.md` — LLM system prompt (used for cold-start fallback and ingredient extraction)
- `worker/src/index.js` — Cloudflare Worker with routes: `GET /`, `GET /auth/callback`, `GET /onboarding`, `POST /api/preferences`, `GET /api/unsubscribe`, `GET /api/rate`
- `worker/wrangler.toml` — Worker config with Supabase vars
- `.github/workflows/eatery_recommend.yml` — Daily cron + manual dispatch

## Environment Variables

### Python pipeline (`.env` and GitHub Secrets)
- `SUPABASE_URL` — Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` — Supabase service role key (bypasses RLS)
- `GROQ_API_KEY` — Groq API key for LLM calls
- `GMAIL_USER`, `GMAIL_APP_PASSWORD` — Gmail SMTP credentials
- `TO_EMAIL` — Fallback recipients when no Supabase subscribers exist
- `HMAC_SECRET` — For generating email action link tokens
- `WORKER_BASE_URL` — Worker URL for rating/unsubscribe links in emails

Optional: `GROQ_MODEL` (default: `openai/gpt-oss-120b`)

### Worker (`wrangler.toml` vars + secrets)
- Vars: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `WORKER_ORIGIN`
- Secrets: `HMAC_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`

## Notable Patterns

- **Google OAuth** via Supabase with .edu email restriction (enforced by DB trigger on `auth.users`)
- **food2vec embeddings** (300-dim) stored as pgvector columns for ingredient-level dish similarity; vocabulary of 2572 food terms
- **Preference vector**: weighted sum of initial ingredient prefs + liked dish vectors - disliked dish vectors, with exponential decay (0.95^i) for recency
- **Hybrid scoring**: weighted sum of cosine similarity (0.55) + flavor Jaccard (0.15) + cooking method Jaccard (0.10) + cuisine match (0.20); falls back to pure cosine when user has no attribute preferences
- **Eatery scoring**: mean of top-3 dish hybrid scores per eatery per meal bucket
- **Cold-start fallback**: users without preferences get LLM-based recommendations (shared computation)
- HMAC-SHA256 tokens kept for email action links (rating 👍👎, unsubscribe) — work without login
- Python pipeline connects to Supabase directly via service role key (bypasses RLS)
- Worker uses Supabase anon key for user-facing auth, service role key for HMAC-verified actions
- `EATERY_DENYLIST` in `recommend_daily.py` excludes specific eateries (currently `104West!`)
- `EVENT_BUCKET` dict maps meal panel titles to three buckets: `breakfast_brunch`, `lunch`, `dinner`
- Subscriber fetch falls back gracefully from Supabase to `TO_EMAIL` env var
- Uses OpenAI SDK pointed at Groq's OpenAI-compatible endpoint for ingredient extraction
- Preference vectors recomputed by Python pipeline (not Worker) since food2vec runs in Python only
