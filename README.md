# Campus Meal Pick (CMP)

Automated daily AI-powered dining recommendations (top 3 picks per meal) from Cornell West Campus eateries, delivered via email.

## How it works

1. **Scrape** — Launches headless Chromium via Playwright, navigates to `now.dining.cornell.edu/eateries`, clicks the "West" campus tab, and extracts each dining hall's meal menus (categories + individual dishes)
2. **Analyze** — Sends the scraped menu data to an LLM via the Groq API with a customizable system prompt (`prompt.md`) that encodes food preferences and decision rules
3. **Rank** — LLM returns JSON with top 3 eatery picks per meal (breakfast/brunch, lunch, dinner), each with recommended dishes and Chinese translations
4. **Email** — Formats the picks into a styled HTML email and sends to all subscribers via Gmail SMTP, each with a personalized HMAC-signed unsubscribe link

## Architecture

```
┌─────────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Cloudflare Worker   │────▶│  GitHub Actions   │────▶│  Verification   │
│  (subscription API)  │     │  (send_verif.)    │     │  Email (SMTP)   │
└─────────────────────┘     └──────────────────┘     └─────────────────┘
         │ KV
         ▼
┌──────────────────────────────────────────────────────────────────────┐
│  GitHub Actions (daily cron)                                         │
│  Playwright scrape → Groq LLM → Sanitize → Build HTML → Send emails │
└──────────────────────────────────────────────────────────────────────┘
```

**Subscription flow:** User submits email on the Worker landing page → Worker dispatches GitHub Actions to send a verification email → User clicks confirm link → Worker verifies HMAC token and stores email in Cloudflare KV → Daily emails begin.

## Setup

### Prerequisites

- Python 3.9+
- Node.js (for Cloudflare Worker development)
- A [Gmail app password](https://support.google.com/accounts/answer/185833)
- A [Groq API key](https://console.groq.com/)
- A Cloudflare account (for the subscription Worker)

### Install

```bash
# Python recommender
pip install -r requirements.txt
python -m playwright install chromium

# Cloudflare Worker
cd worker
npm install
```

### Environment variables

Create a `.env` file in the project root:

```
GROQ_API_KEY=gsk_...
GMAIL_USER=you@gmail.com
GMAIL_APP_PASSWORD=abcd efgh ijkl mnop
TO_EMAIL=fallback@example.com
HMAC_SECRET=your-secret-key
GH_PAT_TOKEN=ghp_...
WORKER_BASE_URL=https://your-worker.workers.dev
```

| Variable             | Required | Description                                              |
| -------------------- | -------- | -------------------------------------------------------- |
| `GROQ_API_KEY`       | Yes      | Groq API key                                             |
| `GROQ_MODEL`         | No       | Model name (default: `openai/gpt-oss-120b`)              |
| `GMAIL_USER`         | Yes      | Gmail address used to send emails                        |
| `GMAIL_APP_PASSWORD` | Yes      | Gmail app password                                       |
| `TO_EMAIL`           | No       | Fallback comma-separated recipients (if KV is empty)     |
| `HMAC_SECRET`        | Yes      | Shared secret for HMAC token signing                     |
| `GH_PAT_TOKEN`       | Yes      | GitHub PAT with repo dispatch permission                 |
| `WORKER_BASE_URL`    | Yes      | Base URL of the deployed Cloudflare Worker               |

### Cloudflare Worker setup

```bash
cd worker

# Local development
npm run sync-env    # Copies HMAC_SECRET and GH_PAT_TOKEN from ../.env to .dev.vars
npm run dev         # Starts local dev server at localhost:8787

# Production
wrangler secret put HMAC_SECRET
wrangler secret put GH_PAT_TOKEN
npm run deploy
```

The Worker's `GH_OWNER` and `GH_REPO` are configured in `wrangler.toml` under `[vars]`.

### Customize recommendations

Edit `prompt.md` to change food preferences, decision rules, and output style. The default prompt is tuned for a student who prefers Chinese/Asian comfort foods and includes Chinese dish name translations.

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

- **`prompt.md`** — LLM system prompt controlling food preferences and recommendation style
- **Meal buckets** — `EVENT_BUCKET` in `recommend_daily.py` maps meal panel titles (Breakfast, Brunch, Lunch, Late Lunch, Dinner) to three buckets
- **Eatery denylist** — `EATERY_DENYLIST` in `recommend_daily.py` to exclude specific eateries
