# Cornell Dining Selection

Automated daily AI-powered dining recommendations (top 3 picks per meal) from Cornell West Campus eateries, delivered via email.

## Setup

### Prerequisites

- Python 3.9+
- A [Gmail app password](https://support.google.com/accounts/answer/185833)
- A [DeepSeek API key](https://platform.deepseek.com/)

### Install

```bash
pip install -r requirements.txt
```

### Environment variables

Create a `.env` file in the project root (used locally; GitHub Actions uses repository secrets):

```
DEEPSEEK_API_KEY=sk-...
GMAIL_USER=you@gmail.com
GMAIL_APP_PASSWORD=abcd efgh ijkl mnop
TO_EMAIL=recipient1@example.com,recipient2@example.com
```

| Variable             | Required | Description                               |
| -------------------- | -------- | ----------------------------------------- |
| `DEEPSEEK_API_KEY`   | Yes      | DeepSeek API key                          |
| `DEEPSEEK_MODEL`     | No       | Model name (default: `deepseek-chat`)     |
| `GMAIL_USER`         | Yes      | Gmail address used to send the email      |
| `GMAIL_APP_PASSWORD` | Yes      | Gmail app password                        |
| `TO_EMAIL`           | Yes      | Comma-separated recipient email addresses |

### Customize recommendations

Edit `prompt.md` to change food preferences, decision rules, and output style. The default prompt is tuned for a student who prefers Chinese/Asian comfort foods.

## Usage

### Run locally

```bash
python recommend_daily.py
```

### Automated (GitHub Actions)

The included workflow (`.github/workflows/eatery_recommend.yml`) runs daily at 10:00 AM UTC. You can also trigger it manually from the GitHub Actions UI or with:

```bash
gh workflow run "Eatery West Campus Recommendation"
```

Store the environment variables as repository secrets in GitHub.

## Configuration

- **`prompt.md`** — LLM system prompt controlling food preferences and recommendation style
- **Meal time windows** — defined in `recommend_daily.py` (`MEAL_WINDOWS`); defaults are 6-11 AM, 11 AM-4 PM, 4-9 PM Eastern
- **Campus area filter** — `CAMPUS_AREA_ALLOWLIST` in `recommend_daily.py` (default: West)
- **Eatery denylist** — `EATERY_DENYLIST` in `recommend_daily.py` to exclude specific eateries
