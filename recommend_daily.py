import asyncio
import hashlib
import hmac
import os
import sys
import json
import re
import smtplib
from dataclasses import dataclass
from datetime import datetime
from email.message import EmailMessage
from html import escape
from typing import Any, Dict, List, Tuple
from urllib.parse import quote

from dotenv import load_dotenv
from openai import OpenAI
from playwright.async_api import async_playwright

load_dotenv()  # no-op when .env is absent (e.g. GitHub Actions)

try:
    from zoneinfo import ZoneInfo
except ImportError:
    print("ERROR: zoneinfo not available. Use Python 3.9+.", file=sys.stderr)
    raise

LOCAL_TZ = ZoneInfo("America/New_York")

EATERY_DENYLIST = {"104West!"}
PROMPT_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "prompt.md")

# Map meal title (with " Menu" stripped) to our three buckets
EVENT_BUCKET = {
    "Breakfast": "breakfast_brunch",
    "Brunch": "breakfast_brunch",
    "Lunch": "lunch",
    "Late Lunch": "lunch",
    "Dinner": "dinner",
}


@dataclass
class MenuSlice:
    eatery_name: str
    location: str
    bucket: str
    event_descriptions: List[str]
    categories: List[str]
    items: List[str]
    menu_summary: str


def load_prompt() -> str:
    with open(PROMPT_PATH, "r", encoding="utf-8") as f:
        return f.read().strip()


MEAL_BUCKETS = ("breakfast_brunch", "lunch", "dinner")


async def scrape_menus(local_dt: datetime) -> Dict[str, List[MenuSlice]]:
    by_bucket: Dict[str, List[MenuSlice]] = {k: [] for k in MEAL_BUCKETS}

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        # Retry navigation up to 3 times for transient network errors
        for attempt in range(3):
            try:
                await page.goto(
                    "https://now.dining.cornell.edu/eateries",
                    wait_until="networkidle",
                )
                break
            except Exception as e:
                if attempt < 2:
                    print(f"WARNING: page.goto attempt {attempt+1} failed: {e}, retrying...", file=sys.stderr)
                    await asyncio.sleep(3)
                else:
                    raise

        # Wait for cards to appear
        await page.wait_for_selector("app-card", timeout=15000)

        # Click the "West" campus tab
        west_tab = page.locator("text=West").first
        await west_tab.click()
        await page.wait_for_timeout(1500)

        cards = await page.locator("app-card").all()
        for card in cards:
            try:
                # Extract eatery name
                name_el = card.locator(".eateries-name a")
                name = (await name_el.text_content() or "").strip()
                if not name or name in EATERY_DENYLIST:
                    continue

                # Extract location
                location = ""
                loc_spans = card.locator(".eateries-name span")
                count = await loc_spans.count()
                if count > 0:
                    location = (await loc_spans.last.text_content() or "").strip()

                # Extract description (menu_summary)
                menu_summary = ""
                about_el = card.locator(".eateries-about-short")
                if await about_el.count() > 0:
                    menu_summary = (await about_el.first.text_content() or "").strip()

                # Check for mat-expansion-panel menus (skip non-dining eateries)
                panels = await card.locator("mat-expansion-panel").all()
                if not panels:
                    continue

                # Accumulate per bucket
                acc: Dict[str, Dict[str, Any]] = {}

                for panel in panels:
                    # Extract meal name from panel title
                    title_el = panel.locator("mat-panel-title")
                    title_text = (await title_el.text_content() or "").strip()
                    # Strip " Menu" suffix: "Breakfast Menu" -> "Breakfast"
                    meal_name = re.sub(r"\s*Menu\s*$", "", title_text).strip()

                    bucket = EVENT_BUCKET.get(meal_name)
                    if not bucket:
                        continue

                    # Expand the panel if not already expanded
                    panel_classes = await panel.get_attribute("class") or ""
                    if "mat-expanded" not in panel_classes:
                        await panel.click()
                        await page.wait_for_timeout(300)

                    # Extract categories
                    cat_els = await panel.locator(".eateries-menu-category").all()
                    cats = []
                    for cel in cat_els:
                        ct = (await cel.text_content() or "").strip()
                        if ct:
                            cats.append(ct)

                    # Extract items (separated by " • ")
                    item_els = await panel.locator(".eateries-menu-items").all()
                    items = []
                    for iel in item_els:
                        raw = (await iel.text_content() or "").strip()
                        if raw:
                            for part in raw.split(" • "):
                                part = part.strip()
                                if part:
                                    items.append(part)

                    if bucket not in acc:
                        acc[bucket] = {"descs": [], "items": [], "cats": []}
                    acc[bucket]["descs"].append(meal_name)
                    acc[bucket]["items"].extend(items)
                    acc[bucket]["cats"].extend(cats)

                for bucket, d in acc.items():
                    # Deduplicate while preserving order
                    seen = set()
                    uniq_items = []
                    for x in d["items"]:
                        if x not in seen:
                            seen.add(x)
                            uniq_items.append(x)

                    seen = set()
                    uniq_cats = []
                    for x in d["cats"]:
                        if x not in seen:
                            seen.add(x)
                            uniq_cats.append(x)

                    if not uniq_items and not uniq_cats:
                        continue

                    by_bucket[bucket].append(
                        MenuSlice(
                            eatery_name=name,
                            location=location,
                            bucket=bucket,
                            event_descriptions=sorted(set(d["descs"])),
                            categories=uniq_cats[:40],
                            items=uniq_items[:120],
                            menu_summary=menu_summary,
                        )
                    )
            except Exception as e:
                print(f"WARNING: skipped card: {e}", file=sys.stderr)
                continue

        await browser.close()

    return by_bucket


def call_llm(prompt: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    client = OpenAI(
        api_key=os.environ["GROQ_API_KEY"],
        base_url="https://api.groq.com/openai/v1/",
    )
    model = os.environ.get("GROQ_MODEL", "").strip() or "openai/gpt-oss-120b"

    resp = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": prompt},
            {
                "role": "user",
                "content": f"Choose winners for today. Data:\n{json.dumps(payload, ensure_ascii=False)}",
            },
        ],
        response_format={"type": "json_object"},
    )

    text = resp.choices[0].message.content
    if not text:
        raise RuntimeError("LLM returned empty response")
    return json.loads(text)


def sanitize_result(
    result: Any, menus: Dict[str, List[MenuSlice]]
) -> Dict[str, Any]:
    """Validate and fix LLM output: enforce structure, dedupe eateries, cap picks."""
    if not isinstance(result, dict):
        result = {}

    valid_eateries: Dict[str, set] = {}
    for bucket, slices in menus.items():
        valid_eateries[bucket] = {ms.eatery_name for ms in slices}

    for bucket in MEAL_BUCKETS:
        meal = result.get(bucket)
        if not isinstance(meal, dict):
            result[bucket] = {"picks": []}
            continue

        picks = meal.get("picks")
        if not isinstance(picks, list):
            meal["picks"] = []
            continue

        # Deduplicate eateries and ensure each pick has required fields
        seen: set = set()
        clean: list = []
        for p in picks:
            if not isinstance(p, dict):
                continue
            eatery = p.get("eatery", "")
            if not isinstance(eatery, str) or not eatery:
                continue
            if eatery in seen:
                continue
            seen.add(eatery)
            dishes = p.get("dishes", [])
            if not isinstance(dishes, list):
                dishes = []
            clean.append({"eatery": eatery, "dishes": [str(d) for d in dishes]})

        meal["picks"] = clean[:3]

    return result


def generate_unsub_token(email: str, secret: str) -> str:
    """Generate an HMAC-SHA256 token for unsubscribe links."""
    return hmac.new(secret.encode(), email.lower().encode(), hashlib.sha256).hexdigest()


def build_email(
    local_dt: datetime,
    result: Dict[str, Any],
    menus: Dict[str, List[MenuSlice]],
    unsubscribe_url: str = "",
    rating_base_url: str = "",
    recipient_email: str = "",
    recipient_token: str = "",
    daily_menu_lookup: Dict[int, Dict] = None,
    date_str_iso: str = "",
) -> Tuple[str, str]:
    date_str = local_dt.strftime("%a, %b %d, %Y")
    subject = f"CMP — West Campus Dining Picks — {date_str}"

    # Location lookup
    loc: Dict[str, str] = {}
    for bucket, lst in menus.items():
        for ms in lst:
            loc[ms.eatery_name] = ms.location

    # Build reverse lookup: (normalized_name, eatery, bucket) -> daily_menus.id
    menu_id_lookup: Dict[str, int] = {}
    if daily_menu_lookup:
        for menu_id, info in daily_menu_lookup.items():
            key = f"{info.get('normalized', '')}|{info.get('eatery', '')}|{info.get('bucket', '')}"
            menu_id_lookup[key] = menu_id

    meal_labels = [
        ("Breakfast / Brunch", "breakfast_brunch"),
        ("Lunch", "lunch"),
        ("Dinner", "dinner"),
    ]

    def _rating_links(dish_name: str, eatery: str, bucket: str) -> str:
        if not rating_base_url or not recipient_email or not recipient_token or not daily_menu_lookup:
            return ""
        from food_embeddings import normalize_dish_name
        norm = normalize_dish_name(dish_name)
        key = f"{norm}|{eatery}|{bucket}"
        menu_id = menu_id_lookup.get(key)
        if not menu_id:
            return ""
        base = (
            f"{rating_base_url}/api/rate"
            f"?email={quote(recipient_email)}&token={recipient_token}"
            f"&menu_id={menu_id}&date={date_str_iso}"
        )
        return (
            f' <a href="{escape(base + "&rating=up")}" '
            f'style="text-decoration:none;font-size:14px;" title="I like this">&#128077;</a>'
            f' <a href="{escape(base + "&rating=down")}" '
            f'style="text-decoration:none;font-size:14px;" title="Not for me">&#128078;</a>'
        )

    def _pick_html(rank: int, pick: Dict[str, Any], bucket: str) -> str:
        raw_name = pick.get("eatery", "")
        name = escape(raw_name)
        dishes = pick.get("dishes", [])
        labels = {0: "#1 Pick", 1: "#2 Pick", 2: "#3 Pick", 3: "#4 Pick"}
        colors = {0: "#d35400", 1: "#7f8c8d", 2: "#7f8c8d", 3: "#7f8c8d"}
        label = labels.get(rank, f"#{rank+1} Pick")
        color = colors.get(rank, "#7f8c8d")
        location = escape(loc.get(raw_name, ""))
        loc_line = f'<div style="color:#888;font-size:13px;">{location}</div>' if location else ""
        dishes_line = ""
        if dishes:
            items_html = "".join(
                f"<li>{escape(d)}{_rating_links(d, raw_name, bucket)}</li>"
                for d in dishes
            )
            dishes_line = f'<ul style="color:#555;font-size:13px;margin:4px 0 0 0;padding-left:20px;">{items_html}</ul>'
        return (
            f'<div style="margin-bottom:10px;">'
            f'<span style="background:{color};color:#fff;padding:2px 8px;border-radius:4px;'
            f'font-size:12px;font-weight:bold;">{label}</span> '
            f'<strong style="font-size:15px;">{name}</strong>'
            f'{loc_line}'
            f'{dishes_line}'
            f'</div>'
        )

    sections_html = ""
    for title, key in meal_labels:
        obj = result.get(key, {}) if isinstance(result, dict) else {}
        picks = obj.get("picks", [])
        inner = ""
        if not picks:
            inner = '<p style="color:#999;">No recommendation (no matching menu found).</p>'
        else:
            for i, p in enumerate(picks[:4]):
                inner += _pick_html(i, p, key)
        sections_html += (
            f'<div style="margin-bottom:24px;">'
            f'<h2 style="margin:0 0 8px 0;font-size:18px;color:#2c3e50;'
            f'border-bottom:2px solid #e67e22;padding-bottom:4px;">{title}</h2>'
            f'{inner}'
            f'</div>'
        )

    # Unsubscribe footer
    unsub_line = ""
    if unsubscribe_url:
        unsub_line = (
            f'<p style="font-size:11px;color:#aaa;margin-top:8px;">'
            f'<a href="{escape(unsubscribe_url)}" style="color:#aaa;">'
            f'Unsubscribe from daily picks</a></p>'
        )

    rating_hint = ""
    if rating_base_url:
        rating_hint = '<p style="font-size:11px;color:#aaa;">Rate dishes with &#128077;&#128078; to improve your recommendations.</p>'

    html = (
        f'<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;'
        f'max-width:520px;margin:0 auto;padding:16px;">'
        f'<h1 style="font-size:22px;color:#2c3e50;margin:0 0 4px 0;">'
        f'Campus Meal Pick</h1>'
        f'<p style="color:#888;font-size:13px;margin:0 0 20px 0;">'
        f'{date_str} &middot; {local_dt.strftime("%I:%M %p %Z").lstrip("0")}</p>'
        f'{sections_html}'
        f'<hr style="border:none;border-top:1px solid #eee;margin:20px 0 12px 0;">'
        f'<p style="font-size:11px;color:#aaa;">Data: now.dining.cornell.edu</p>'
        f'{rating_hint}'
        f'{unsub_line}'
        f'</div>'
    )
    return subject, html


async def main() -> int:
    local_dt = datetime.now(LOCAL_TZ)
    date_str_iso = local_dt.strftime("%Y-%m-%d")

    # Step 1: Scrape menus (unchanged)
    menus = await scrape_menus(local_dt)

    # Step 2: Load food2vec model and Supabase client
    from food_embeddings import FoodVectorModel, normalize_dish_name
    from ingredient_extractor import extract_dish_attributes_batch
    from recommendation_engine import compute_preference_vector, generate_recommendations, infer_attribute_preferences
    from supabase_client import SupabaseClient

    model = FoodVectorModel()
    db = SupabaseClient()
    print(f"food2vec loaded: {model.vocab_size} items in vocabulary.")

    # Step 3: Collect all dish names, check Supabase cache
    all_dishes: List[Tuple[str, str, str, str]] = []  # (normalized, original, eatery, bucket)
    for bucket, slices in menus.items():
        for ms in slices:
            for item in ms.items:
                all_dishes.append((normalize_dish_name(item), item, ms.eatery_name, bucket))

    unique_names = list(set(d[0] for d in all_dishes))
    print(f"Total unique dishes: {len(unique_names)}")

    cached = db.get_dishes_batch(unique_names)

    # Step 4: Extract attributes for uncached dishes + backfill cached dishes missing attributes
    uncached = [n for n in unique_names if not cached.get(n)]
    needs_attrs = [n for n in unique_names if cached.get(n) and not cached[n].get("flavor_profiles")]
    to_extract = list(set(uncached + needs_attrs))

    if to_extract:
        label_parts = []
        if uncached:
            label_parts.append(f"{len(uncached)} new")
        if needs_attrs:
            label_parts.append(f"{len(needs_attrs)} backfill")
        print(f"Extracting attributes for {len(to_extract)} dishes ({', '.join(label_parts)}) via LLM...")

        # Build normalized -> original name mapping
        name_map: Dict[str, str] = {}
        for norm, orig, _, _ in all_dishes:
            if norm not in name_map:
                name_map[norm] = orig

        originals = [name_map.get(n, n) for n in to_extract]
        attrs_map = extract_dish_attributes_batch(originals)

        # Compute embeddings and store in Supabase
        new_dishes: Dict[str, Dict] = {}
        for norm_name in to_extract:
            orig = name_map.get(norm_name, norm_name)
            attrs = attrs_map.get(orig, {})
            ings = attrs.get("ingredients", [])
            vec = model.embed_ingredients(ings)
            new_dishes[norm_name] = {
                "ingredients": ings,
                "embedding": vec.tolist() if vec is not None else None,
                "source_name": orig,
                "flavor_profiles": attrs.get("flavor_profiles", []),
                "cooking_methods": attrs.get("cooking_methods", []),
                "cuisine_type": attrs.get("cuisine_type", "other"),
                "dietary_attrs": attrs.get("dietary_attrs", []),
                "dish_type": attrs.get("dish_type", "main"),
            }
        db.upsert_dishes_batch(new_dishes)
        # Re-fetch to get IDs assigned by the database
        cached = db.get_dishes_batch(unique_names)
        print(f"  Processed {len(new_dishes)} dishes.")
    else:
        print("All dishes already cached with attributes.")

    # Step 5: Store daily menu mapping (for rating links)
    # Build dish_id map from cached data
    menu_entries: List[Dict[str, Any]] = []
    seen_combos: set = set()
    for norm_name, orig_name, eatery, bucket in all_dishes:
        dish_data = cached.get(norm_name)
        if not dish_data or "id" not in dish_data:
            continue
        combo_key = (norm_name, eatery, bucket)
        if combo_key in seen_combos:
            continue
        seen_combos.add(combo_key)
        menu_entries.append({
            "dish_id": dish_data["id"],
            "eatery": eatery,
            "bucket": bucket,
        })
    db.upsert_daily_menu(date_str_iso, menu_entries)

    # Fetch daily menu lookup for rating links
    daily_menu_lookup = db.get_daily_menu_lookup(date_str_iso)

    # Step 6: Fetch subscribers and preferences
    users = db.get_subscribed_users()
    if not users:
        # Fallback to TO_EMAIL for bootstrapping
        to_emails = [
            e.strip()
            for e in os.environ.get("TO_EMAIL", "").split(",")
            if e.strip()
        ]
        if not to_emails:
            raise RuntimeError("No subscribers found (Supabase empty and TO_EMAIL not set)")
        print(f"No Supabase subscribers; falling back to TO_EMAIL ({len(to_emails)} recipient(s)).")
        # Convert to user-like dicts for uniform handling
        users = [
            {"id": None, "email": e, "initial_ingredients": [],
             "preference_vector": None, "vector_stale": False}
            for e in to_emails
        ]
    else:
        print(f"Sending to {len(users)} subscriber(s).")

    # Recompute stale preference vectors and track rating counts
    for user in users:
        if user.get("vector_stale") and user.get("id"):
            print(f"  Recomputing preference vector for {user['email']}...")
            ratings = db.get_user_ratings(user["id"])

            liked = [
                {"name": r["dish_normalized_name"], "embedding": r["embedding"], "strength": r.get("strength", 1.0)}
                for r in ratings if r["rating"] == 1
            ]
            disliked = [
                {"name": r["dish_normalized_name"], "embedding": r["embedding"], "strength": r.get("strength", 1.0)}
                for r in ratings if r["rating"] == -1
            ]

            user["_rating_count"] = len(liked) + len(disliked)

            new_vec = compute_preference_vector(
                user.get("initial_ingredients", []),
                liked,
                disliked,
                cached,
                model,
            )
            user["preference_vector"] = new_vec
            db.update_preference_vector(user["id"], new_vec)

            inferred = infer_attribute_preferences(liked, disliked, cached)
            # Merge inferred rating signals with existing onboarding weights so that
            # the user's stated preferences (e.g. cuisine=1.0 from onboarding) are
            # preserved as a baseline that ratings adjust, not overwrite.
            merged = {}
            for key in ("flavor_weights", "method_weights", "cuisine_weights"):
                existing = user.get(key) or {}
                delta = inferred.get(key, {})
                all_keys = set(existing) | set(delta)
                merged[key] = {k: existing.get(k, 0.0) + delta.get(k, 0.0) for k in all_keys}
            if any(merged.values()):
                db.update_attribute_preferences(user["id"], **merged)
                user["flavor_weights"]  = merged["flavor_weights"]
                user["method_weights"]  = merged["method_weights"]
                user["cuisine_weights"] = merged["cuisine_weights"]
        elif user.get("id"):
            user["_rating_count"] = db.get_user_rating_count(user["id"])

    # Step 7: Generate per-user recommendations and send emails
    gmail_user = os.environ.get("GMAIL_USER", "").strip()
    gmail_app_password = os.environ.get("GMAIL_APP_PASSWORD", "").strip()
    hmac_secret = os.environ.get("HMAC_SECRET", "").strip()
    worker_url = os.environ.get("WORKER_BASE_URL", "").strip().rstrip("/")

    if not gmail_user or not gmail_app_password:
        raise RuntimeError("Missing env vars: GMAIL_USER, GMAIL_APP_PASSWORD")

    # LLM fallback: precompute once for users without preferences
    llm_result = None

    with smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=30) as smtp:
        smtp.login(gmail_user, gmail_app_password)

        for user in users:
            recipient = user["email"]
            token = generate_unsub_token(recipient, hmac_secret) if hmac_secret else ""

            # Build unsubscribe URL
            unsub_url = ""
            if hmac_secret and worker_url:
                unsub_url = (
                    f"{worker_url}/api/unsubscribe"
                    f"?email={quote(recipient)}&token={token}"
                )

            # Check if user has preference vector
            pref_vector = user.get("preference_vector")

            if pref_vector:
                # Embedding-based recommendation with hybrid scoring
                result = generate_recommendations(
                    pref_vector, menus, cached,
                    flavor_weights=user.get("flavor_weights", {}),
                    method_weights=user.get("method_weights", {}),
                    cuisine_weights=user.get("cuisine_weights", {}),
                    user_dietary=user.get("dietary_restrictions", []),
                    rating_count=user.get("_rating_count", 0),
                )
                print(f"  {recipient}: embedding-based recommendation")
            else:
                # LLM fallback (computed once, shared for all no-pref users)
                if llm_result is None:
                    print("  Computing LLM fallback recommendation...")
                    prompt = load_prompt()
                    payload = {
                        "date_local": date_str_iso,
                        "timezone": "America/New_York",
                        "campus_area_filter": "West",
                        "meals": {
                            k: [
                                {
                                    "eatery_name": ms.eatery_name,
                                    "location": ms.location,
                                    "event_descriptions": ms.event_descriptions,
                                    "menu_summary": ms.menu_summary,
                                    "categories": ms.categories,
                                    "items": ms.items,
                                }
                                for ms in v
                            ]
                            for k, v in menus.items()
                        },
                    }
                    llm_result = call_llm(prompt, payload)
                    llm_result = sanitize_result(llm_result, menus)
                result = llm_result
                print(f"  {recipient}: LLM fallback recommendation")

            # Build and send personalized email
            subject, body = build_email(
                local_dt,
                result,
                menus,
                unsubscribe_url=unsub_url,
                rating_base_url=worker_url,
                recipient_email=recipient,
                recipient_token=token,
                daily_menu_lookup=daily_menu_lookup,
                date_str_iso=date_str_iso,
            )

            msg = EmailMessage()
            msg["Subject"] = subject
            msg["From"] = gmail_user
            msg["To"] = recipient
            msg.set_content("View this email in an HTML-capable client.")
            msg.add_alternative(body, subtype="html")

            smtp.send_message(msg)
            print(f"  → Sent to {recipient}")

    print("All emails sent.")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
