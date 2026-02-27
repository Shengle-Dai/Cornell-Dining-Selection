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

DISH_TYPE_MULTIPLIER = {"main": 1.0, "side": 0.6, "dessert": 0.7, "condiment": 0.0, "beverage": 0.4}


def _scoring_weights(rating_count: int) -> Tuple[float, float, float, float]:
    """Return (vector, cuisine, flavor, method) weights scaled by data density.

    Cold-start users have noisy preference vectors from sparse ratings, so
    we trust explicit onboarding attribute preferences (cuisine/flavor/method)
    more heavily until enough ratings accumulate.
    """
    if rating_count < 15:
        return 0.40, 0.25, 0.20, 0.15
    elif rating_count < 40:
        return 0.60, 0.18, 0.13, 0.09
    else:
        return VECTOR_WEIGHT, CUISINE_WEIGHT, FLAVOR_WEIGHT, METHOD_WEIGHT


def weighted_attr_score(user_weights: Dict[str, float], dish_attrs: List[str]) -> float:
    """Weighted attribute match, normalized to [0, 1].

    Sums user weights for each attribute present in the dish, then divides
    by the total positive weight mass. Negative weights clip to 0 in the result.
    """
    if not user_weights or not dish_attrs:
        return 0.0
    max_pos = sum(v for v in user_weights.values() if v > 0)
    if max_pos == 0:
        return 0.0
    raw = sum(user_weights.get(attr, 0.0) for attr in dish_attrs)
    return max(0.0, raw) / max_pos


def weighted_cuisine_score(user_weights: Dict[str, float], dish_cuisine: str) -> float:
    """Cuisine preference score, normalized to [0, 1]."""
    if not user_weights or not dish_cuisine or dish_cuisine == "other":
        return 0.0
    max_pos = sum(v for v in user_weights.values() if v > 0)
    if max_pos == 0:
        return 0.0
    return max(0.0, user_weights.get(dish_cuisine.lower(), 0.0)) / max_pos


def infer_attribute_preferences(
    liked_dishes: List[Dict],
    disliked_dishes: List[Dict],
    dish_cache: Dict[str, Optional[Dict]],
) -> Dict[str, Dict[str, float]]:
    """Infer continuous flavor/method/cuisine weights from rating history.

    Liked signals add weight (decay × strength); disliked subtract at 0.5×.
    Returns dicts suitable for direct storage as JSONB.
    """
    from collections import defaultdict

    flavor_scores: Dict[str, float] = defaultdict(float)
    method_scores: Dict[str, float] = defaultdict(float)
    cuisine_scores: Dict[str, float] = defaultdict(float)

    for i, entry in enumerate(liked_dishes):
        dish_data = dish_cache.get(entry.get("name", ""))
        if not dish_data:
            continue
        w = (DECAY_FACTOR ** i) * entry.get("strength", 1.0)
        for f in dish_data.get("flavor_profiles", []):
            flavor_scores[f] += w
        for m in dish_data.get("cooking_methods", []):
            method_scores[m] += w
        c = dish_data.get("cuisine_type", "other")
        if c and c != "other":
            cuisine_scores[c] += w

    for i, entry in enumerate(disliked_dishes):
        dish_data = dish_cache.get(entry.get("name", ""))
        if not dish_data:
            continue
        w = (DECAY_FACTOR ** i) * entry.get("strength", 1.0)
        for f in dish_data.get("flavor_profiles", []):
            flavor_scores[f] -= w * 0.5
        for m in dish_data.get("cooking_methods", []):
            method_scores[m] -= w * 0.5
        c = dish_data.get("cuisine_type", "other")
        if c and c != "other":
            cuisine_scores[c] -= w * 0.5

    return {
        "flavor_weights": dict(flavor_scores),
        "method_weights": dict(method_scores),
        "cuisine_weights": dict(cuisine_scores),
    }


def _is_dietary_compatible(dish_attrs: set, user_dietary: set) -> bool:
    """Return False if the dish conflicts with the user's dietary restrictions.

    Only filters when the dish has non-empty dietary_attrs — unknown dishes
    always pass through to avoid over-filtering.
    """
    if not dish_attrs or not user_dietary:
        return True
    for restriction in user_dietary:
        if restriction == "vegetarian" and not (dish_attrs & {"vegetarian", "vegan"}):
            return False
        elif restriction == "vegan" and "vegan" not in dish_attrs:
            return False
        elif restriction == "gluten-free" and "gluten-free" not in dish_attrs:
            return False
        elif restriction == "dairy-free" and "dairy-free" not in dish_attrs:
            return False
        elif restriction == "halal" and "halal" not in dish_attrs:
            return False
        elif restriction == "no-nuts" and "contains-nuts" in dish_attrs:
            return False
        elif restriction == "no-shellfish" and "contains-shellfish" in dish_attrs:
            return False
    return True


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
    flavor_weights: Optional[Dict[str, float]] = None,
    method_weights: Optional[Dict[str, float]] = None,
    cuisine_weights: Optional[Dict[str, float]] = None,
    user_dietary: Optional[List[str]] = None,
    rating_count: int = 0,
) -> Dict[str, Any]:
    """Generate recommendations using hybrid scoring.

    Scoring:
      - vec_w  * cosine_similarity(pref_vector, dish_embedding)
      - flavor_w  * weighted_attr_score(flavor_weights, dish_flavor_profiles)
      - method_w  * weighted_attr_score(method_weights, dish_cooking_methods)
      - cuisine_w * weighted_cuisine_score(cuisine_weights, dish_cuisine)

    Attribute weights are continuous JSONB dicts {attr: float} — positive values
    boost dishes, negative values penalize them (clipped to 0 in scoring).

    Weights (vec/cuisine/flavor/method) adjust based on rating_count: cold-start
    users trust explicit attribute preferences more; experienced users trust the
    preference vector more.

    Dishes incompatible with user_dietary restrictions are zeroed out
    (only when the dish has non-empty dietary_attrs).

    When no attribute weight dicts are provided, falls back to pure cosine similarity.

    Returns:
      {
        "breakfast_brunch": {"picks": [{"eatery": str, "dishes": [str, ...]}, ...]},
        "lunch": {"picks": [...]},
        "dinner": {"picks": [...]}
      }
    """
    from food_embeddings import normalize_dish_name

    vec_w, cuisine_w, flavor_w, method_w = _scoring_weights(rating_count)

    fw = flavor_weights or {}
    mw = method_weights or {}
    cw = cuisine_weights or {}
    dietary_set = set(user_dietary) if user_dietary else set()
    has_attr_prefs = bool(fw or mw or cw)

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

                dish_attrs = set(dish_data.get("dietary_attrs", [])) if dish_data else set()
                if not _is_dietary_compatible(dish_attrs, dietary_set):
                    scored.append((item, 0.0))
                    continue

                if has_attr_prefs and dish_data:
                    flavor_score = weighted_attr_score(fw, dish_data.get("flavor_profiles", []))
                    method_score = weighted_attr_score(mw, dish_data.get("cooking_methods", []))
                    cuisine_score = weighted_cuisine_score(cw, dish_data.get("cuisine_type", "other"))

                    score = (
                        vec_w * vec_score
                        + flavor_w * flavor_score
                        + method_w * method_score
                        + cuisine_w * cuisine_score
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
            top_dishes = [
                name for name, _ in dishes
                if (dish_cache.get(normalize_dish_name(name)) or {}).get("dish_type") != "condiment"
            ][:5]
            picks.append({"eatery": eatery, "dishes": top_dishes})

        result[bucket] = {"picks": picks}

    return result
