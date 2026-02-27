"""Python client for Supabase PostgreSQL (replaces kv_client.py).

Uses the service role key to bypass RLS — intended for the Python pipeline only.
"""

import json
import os
from datetime import datetime
from typing import Any, Dict, List, Optional

from supabase import Client, create_client


class SupabaseClient:
    """Read/write dishes, user preferences, ratings, and daily menus."""

    def __init__(self) -> None:
        url = os.environ.get("SUPABASE_URL", "").strip()
        key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
        if not url or not key:
            raise RuntimeError(
                "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars"
            )
        self.client: Client = create_client(url, key)

    @staticmethod
    def _vector_to_list(value: Any) -> Optional[List[float]]:
        """Coerce Supabase vector/text payloads into Python float lists."""
        if value is None:
            return None
        parsed = value
        if isinstance(value, str):
            value = value.strip()
            if not value:
                return None
            try:
                parsed = json.loads(value)
            except json.JSONDecodeError:
                return None
        if hasattr(parsed, "tolist"):
            parsed = parsed.tolist()
        if isinstance(parsed, (list, tuple)):
            floats: List[float] = []
            for item in parsed:
                try:
                    floats.append(float(item))
                except (TypeError, ValueError):
                    return None
            return floats
        return None

    # ─── Dishes ──────────────────────────────────────────────────────────

    def get_dishes_batch(
        self, names: List[str]
    ) -> Dict[str, Optional[Dict]]:
        """Fetch dish data for multiple normalized names.

        Returns dict mapping normalized_name -> dish dict (with 'ingredients',
        'embedding', 'source_name') or None if not found.
        """
        if not names:
            return {}

        resp = (
            self.client.table("dishes")
            .select("id, normalized_name, source_name, ingredients, embedding, flavor_profiles, cooking_methods, cuisine_type, dietary_attrs, dish_type")
            .in_("normalized_name", names)
            .execute()
        )

        found: Dict[str, Dict] = {}
        for row in resp.data:
            found[row["normalized_name"]] = {
                "id": row["id"],
                "ingredients": row["ingredients"],
                "embedding": self._vector_to_list(row.get("embedding")),
                "source_name": row["source_name"],
                "flavor_profiles": row.get("flavor_profiles", []),
                "cooking_methods": row.get("cooking_methods", []),
                "cuisine_type": row.get("cuisine_type", "other"),
                "dietary_attrs": row.get("dietary_attrs", []),
                "dish_type": row.get("dish_type", "main"),
            }

        return {n: found.get(n) for n in names}

    def upsert_dishes_batch(self, dishes: Dict[str, Dict]) -> None:
        """Bulk upsert dishes with embeddings.

        dishes: {normalized_name: {ingredients, embedding, source_name}}
        """
        if not dishes:
            return

        rows = []
        now = datetime.utcnow().isoformat() + "Z"
        for norm_name, data in dishes.items():
            rows.append(
                {
                    "normalized_name": norm_name,
                    "source_name": data.get("source_name", norm_name),
                    "ingredients": data.get("ingredients", []),
                    "embedding": data.get("embedding"),
                    "flavor_profiles": data.get("flavor_profiles", []),
                    "cooking_methods": data.get("cooking_methods", []),
                    "cuisine_type": data.get("cuisine_type", "other"),
                    "dietary_attrs": data.get("dietary_attrs", []),
                    "dish_type": data.get("dish_type", "main"),
                    "updated_at": now,
                }
            )

        self.client.table("dishes").upsert(
            rows, on_conflict="normalized_name"
        ).execute()

    def get_dish_id_map(self, names: List[str]) -> Dict[str, int]:
        """Get mapping of normalized_name -> dishes.id for a list of names."""
        if not names:
            return {}
        resp = (
            self.client.table("dishes")
            .select("id, normalized_name")
            .in_("normalized_name", names)
            .execute()
        )
        return {row["normalized_name"]: row["id"] for row in resp.data}

    # ─── Subscribers ─────────────────────────────────────────────────────

    def get_subscribed_users(self) -> List[Dict[str, Any]]:
        """Fetch all subscribed users with their preferences.

        Returns list of dicts with keys: id, email, initial_ingredients,
        preference_vector, vector_stale, flavor_weights, method_weights,
        cuisine_weights, dietary_restrictions.
        """
        resp = (
            self.client.table("profiles")
            .select(
                "id, email, "
                "user_preferences(initial_ingredients, preference_vector, vector_stale, "
                "flavor_weights, method_weights, cuisine_weights, dietary_restrictions)"
            )
            .eq("subscribed", True)
            .execute()
        )

        users = []
        for row in resp.data:
            prefs = row.get("user_preferences")
            # user_preferences is a single object (1-to-1) or None
            if isinstance(prefs, list):
                prefs = prefs[0] if prefs else None
            users.append(
                {
                    "id": row["id"],
                    "email": row["email"],
                    "initial_ingredients": (
                        prefs.get("initial_ingredients", []) if prefs else []
                    ),
                    "preference_vector": (
                        self._vector_to_list(prefs.get("preference_vector"))
                        if prefs
                        else None
                    ),
                    "vector_stale": (
                        prefs.get("vector_stale", True) if prefs else True
                    ),
                    "flavor_weights": (
                        prefs.get("flavor_weights", {}) if prefs else {}
                    ),
                    "method_weights": (
                        prefs.get("method_weights", {}) if prefs else {}
                    ),
                    "cuisine_weights": (
                        prefs.get("cuisine_weights", {}) if prefs else {}
                    ),
                    "dietary_restrictions": (
                        prefs.get("dietary_restrictions", []) if prefs else []
                    ),
                }
            )

        return users

    def get_user_rating_count(self, user_id: str) -> int:
        """Return the total number of ratings for a user."""
        resp = (
            self.client.table("ratings")
            .select("id", count="exact")
            .eq("user_id", user_id)
            .execute()
        )
        return resp.count or 0

    # ─── Ratings ─────────────────────────────────────────────────────────

    def get_user_ratings(self, user_id: str) -> List[Dict[str, Any]]:
        """Fetch a user's ratings joined with dish info, most recent first.

        Returns list of dicts: {dish_normalized_name, embedding, rating, created_at}
        """
        resp = (
            self.client.table("ratings")
            .select(
                "rating, strength, created_at, menu_date, "
                "dishes(normalized_name, embedding)"
            )
            .eq("user_id", user_id)
            .order("created_at", desc=True)
            .limit(200)
            .execute()
        )

        result = []
        for row in resp.data:
            dish = row.get("dishes") or {}
            result.append(
                {
                    "dish_normalized_name": dish.get("normalized_name", ""),
                    "embedding": self._vector_to_list(dish.get("embedding")),
                    "rating": row["rating"],
                    "strength": row.get("strength", 1.0),
                    "created_at": row["created_at"],
                }
            )
        return result

    # ─── User Preferences ────────────────────────────────────────────────

    def update_preference_vector(
        self, user_id: str, vector: Optional[List[float]]
    ) -> None:
        """Update a user's preference vector and clear stale flag."""
        self.client.table("user_preferences").upsert(
            {
                "user_id": user_id,
                "preference_vector": vector,
                "vector_stale": False,
                "updated_at": datetime.utcnow().isoformat() + "Z",
            },
            on_conflict="user_id",
        ).execute()

    def update_attribute_preferences(
        self,
        user_id: str,
        flavor_weights: Dict[str, float],
        method_weights: Dict[str, float],
        cuisine_weights: Dict[str, float],
    ) -> None:
        """Update inferred continuous flavor/method/cuisine weight dicts for a user."""
        self.client.table("user_preferences").upsert(
            {
                "user_id": user_id,
                "flavor_weights": flavor_weights,
                "method_weights": method_weights,
                "cuisine_weights": cuisine_weights,
                "updated_at": datetime.utcnow().isoformat() + "Z",
            },
            on_conflict="user_id",
        ).execute()

    # ─── Daily Menus ─────────────────────────────────────────────────────

    def upsert_daily_menu(
        self, date_str: str, entries: List[Dict[str, Any]]
    ) -> None:
        """Insert today's menu entries.

        entries: list of {dish_id, eatery, bucket}
        """
        if not entries:
            return

        rows = [
            {
                "menu_date": date_str,
                "dish_id": e["dish_id"],
                "eatery": e["eatery"],
                "bucket": e["bucket"],
            }
            for e in entries
        ]

        self.client.table("daily_menus").upsert(
            rows, on_conflict="menu_date,dish_id,eatery,bucket"
        ).execute()

    def get_daily_menu_lookup(
        self, date_str: str
    ) -> Dict[int, Dict[str, str]]:
        """Fetch daily menu entries for a date.

        Returns {daily_menus.id: {dish_id, eatery, bucket, normalized_name}}
        """
        resp = (
            self.client.table("daily_menus")
            .select("id, dish_id, eatery, bucket, dishes(normalized_name, source_name)")
            .eq("menu_date", date_str)
            .execute()
        )

        result = {}
        for row in resp.data:
            dish = row.get("dishes") or {}
            result[row["id"]] = {
                "dish_id": row["dish_id"],
                "eatery": row["eatery"],
                "bucket": row["bucket"],
                "normalized": dish.get("normalized_name", ""),
                "name": dish.get("source_name", ""),
            }
        return result

    # ─── Profile lookup by email (for HMAC action links) ────────────────

    def get_user_id_by_email(self, email: str) -> Optional[str]:
        """Look up user UUID by email. Returns None if not found."""
        resp = (
            self.client.table("profiles")
            .select("id")
            .eq("email", email.lower())
            .limit(1)
            .execute()
        )
        if resp.data:
            return resp.data[0]["id"]
        return None

    def set_unsubscribed(self, email: str) -> bool:
        """Mark a user as unsubscribed. Returns True if user found."""
        resp = (
            self.client.table("profiles")
            .update({"subscribed": False, "updated_at": datetime.utcnow().isoformat() + "Z"})
            .eq("email", email.lower())
            .execute()
        )
        return bool(resp.data)
