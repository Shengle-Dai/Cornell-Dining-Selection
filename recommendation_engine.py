"""Embedding-based recommendation engine using food2vec dish vectors."""

from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

import numpy as np

from food_embeddings import EMBEDDING_DIM, FoodVectorModel, cosine_similarity


@dataclass
class ScoredDish:
    name: str
    eatery: str
    bucket: str
    score: float


DECAY_FACTOR = 0.95
INITIAL_WEIGHT = 1.0
LIKED_WEIGHT = 0.5
DISLIKED_WEIGHT = 0.3

VECTOR_WEIGHT = 0.75
FLAVOR_WEIGHT = 0.08
METHOD_WEIGHT = 0.07
CUISINE_WEIGHT = 0.10

DISH_TYPE_MULTIPLIER = {"main": 1.0, "side": 0.6, "dessert": 0.7, "condiment": 0.3, "beverage": 0.4}


def jaccard_similarity(a: set, b: set) -> float:
    """Compute Jaccard similarity between two sets."""
    if not a or not b:
        return 0.0
    intersection = len(a & b)
    union = len(a | b)
    return intersection / union if union > 0 else 0.0


def compute_preference_vector(
    initial_ingredients: List[str],
    liked_dishes: List[Dict],
    disliked_dishes: List[Dict],
    dish_cache: Dict[str, Optional[Dict]],
    model: FoodVectorModel,
) -> Optional[List[float]]:
    """Compute a user preference vector from initial prefs + rating history.

    Algorithm:
      pref = INITIAL_WEIGHT * mean(initial_ingredient_vectors)
           + LIKED_WEIGHT * sum(decay^i * liked_dish_vector_i)
           - DISLIKED_WEIGHT * sum(decay^i * disliked_dish_vector_i)
      normalize to unit vector

    liked/disliked_dishes: [{"name": normalized_dish_name, "date": ...}, ...]
        Ordered most recent first.
    """
    vec = np.zeros(EMBEDDING_DIM, dtype=np.float32)
    has_signal = False

    # Initial ingredient preferences
    if initial_ingredients:
        init_vec = model.embed_ingredients(initial_ingredients)
        if init_vec is not None:
            vec += INITIAL_WEIGHT * init_vec
            has_signal = True

    # Liked dishes (positive signal)
    for i, entry in enumerate(liked_dishes):
        emb = entry.get("embedding")
        if not emb:
            dish_data = dish_cache.get(entry.get("name", ""))
            emb = dish_data.get("embedding") if dish_data else None
        if emb:
            d_vec = np.array(emb, dtype=np.float32)
            strength = entry.get("strength", 1.0)
            vec += LIKED_WEIGHT * strength * (DECAY_FACTOR**i) * d_vec
            has_signal = True

    # Disliked dishes (negative signal)
    for i, entry in enumerate(disliked_dishes):
        emb = entry.get("embedding")
        if not emb:
            dish_data = dish_cache.get(entry.get("name", ""))
            emb = dish_data.get("embedding") if dish_data else None
        if emb:
            d_vec = np.array(emb, dtype=np.float32)
            strength = entry.get("strength", 1.0)
            vec -= DISLIKED_WEIGHT * strength * (DECAY_FACTOR**i) * d_vec
            has_signal = True

    if not has_signal:
        return None

    norm = np.linalg.norm(vec)
    if norm > 0:
        vec = vec / norm
    return vec.tolist()


def generate_recommendations(
    preference_vector: List[float],
    menus: Dict[str, list],
    dish_cache: Dict[str, Optional[Dict]],
    user_cuisines: Optional[List[str]] = None,
    user_flavors: Optional[List[str]] = None,
    user_methods: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """Generate recommendations using hybrid scoring.

    Scoring:
      - VECTOR_WEIGHT * cosine_similarity(pref_vector, dish_embedding)
      - FLAVOR_WEIGHT * jaccard(user_flavors, dish_flavor_profiles)
      - METHOD_WEIGHT * jaccard(user_methods, dish_cooking_methods)
      - CUISINE_WEIGHT * (1.0 if dish_cuisine in user_cuisines else 0.0)

    When no attribute preferences are set, falls back to pure cosine similarity.

    For each meal bucket:
      1. Score every dish by hybrid score
      2. For each eatery, eatery_score = mean of top 3 dish scores
      3. Rank eateries by eatery_score, take top 3
      4. For each eatery, list top 4 dishes

    Returns:
      {
        "breakfast_brunch": {"picks": [{"eatery": str, "dishes": [str, ...]}, ...]},
        "lunch": {"picks": [...]},
        "dinner": {"picks": [...]}
      }
    """
    from food_embeddings import normalize_dish_name

    # Determine if we have attribute preferences
    flavor_set = set(user_flavors) if user_flavors else set()
    method_set = set(user_methods) if user_methods else set()
    cuisine_set = set(c.lower() for c in user_cuisines) if user_cuisines else set()
    has_attr_prefs = bool(flavor_set or method_set or cuisine_set)

    result: Dict[str, Any] = {}

    for bucket, slices in menus.items():
        # Score all dishes in this bucket
        eatery_dishes: Dict[str, List[Tuple[str, float]]] = {}

        for ms in slices:
            scored: List[Tuple[str, float]] = []
            for item in ms.items:
                norm_name = normalize_dish_name(item)
                dish_data = dish_cache.get(norm_name)

                if dish_data and dish_data.get("embedding"):
                    vec_score = cosine_similarity(
                        preference_vector, dish_data["embedding"]
                    )
                else:
                    vec_score = 0.0

                if has_attr_prefs and dish_data:
                    flavor_score = jaccard_similarity(
                        flavor_set,
                        set(dish_data.get("flavor_profiles", [])),
                    )
                    method_score = jaccard_similarity(
                        method_set,
                        set(dish_data.get("cooking_methods", [])),
                    )
                    dish_cuisine = dish_data.get("cuisine_type", "other").lower()
                    cuisine_score = 1.0 if dish_cuisine in cuisine_set else 0.0

                    score = (
                        VECTOR_WEIGHT * vec_score
                        + FLAVOR_WEIGHT * flavor_score
                        + METHOD_WEIGHT * method_score
                        + CUISINE_WEIGHT * cuisine_score
                    )
                else:
                    score = vec_score

                dish_type = dish_data.get("dish_type", "main") if dish_data else "main"
                score *= DISH_TYPE_MULTIPLIER.get(dish_type, 0.5)

                scored.append((item, score))

            # Sort dishes by score descending
            scored.sort(key=lambda x: x[1], reverse=True)
            eatery_dishes[ms.eatery_name] = scored

        # Compute eatery scores (mean of top 3 dish scores + ingredient variety bonus)
        eatery_scores: List[Tuple[str, float, List[Tuple[str, float]]]] = []
        for eatery, dishes in eatery_dishes.items():
            top3 = dishes[:3]
            if top3:
                avg_score = sum(s for _, s in top3) / len(top3)
            else:
                avg_score = 0.0

            # Ingredient variety: count unique ingredients across all dishes
            all_ings: set = set()
            for dish_name, _ in dishes:
                norm = normalize_dish_name(dish_name)
                dd = dish_cache.get(norm)
                if dd:
                    all_ings.update(dd.get("ingredients", []))
            # Scale: 0 ings → 0.0, 10+ ings → 1.0
            variety_bonus = min(len(all_ings) / 10.0, 1.0)
            eatery_score = 0.85 * avg_score + 0.15 * variety_bonus

            eatery_scores.append((eatery, eatery_score, dishes))

        # Sort eateries by score, take top 4
        eatery_scores.sort(key=lambda x: x[1], reverse=True)
        picks = []
        for eatery, _, dishes in eatery_scores[:4]:
            top_dishes = [name for name, _ in dishes[:5]]
            picks.append({"eatery": eatery, "dishes": top_dishes})

        result[bucket] = {"picks": picks}

    return result
