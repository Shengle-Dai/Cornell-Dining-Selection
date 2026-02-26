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
            vec += LIKED_WEIGHT * (DECAY_FACTOR**i) * d_vec
            has_signal = True

    # Disliked dishes (negative signal)
    for i, entry in enumerate(disliked_dishes):
        emb = entry.get("embedding")
        if not emb:
            dish_data = dish_cache.get(entry.get("name", ""))
            emb = dish_data.get("embedding") if dish_data else None
        if emb:
            d_vec = np.array(emb, dtype=np.float32)
            vec -= DISLIKED_WEIGHT * (DECAY_FACTOR**i) * d_vec
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
) -> Dict[str, Any]:
    """Generate recommendations in the same format as the current LLM output.

    For each meal bucket:
      1. Score every dish by cosine similarity to preference_vector
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
                    score = cosine_similarity(
                        preference_vector, dish_data["embedding"]
                    )
                else:
                    score = 0.0
                scored.append((item, score))

            # Sort dishes by score descending
            scored.sort(key=lambda x: x[1], reverse=True)
            eatery_dishes[ms.eatery_name] = scored

        # Compute eatery scores (mean of top 3 dish scores)
        eatery_scores: List[Tuple[str, float, List[Tuple[str, float]]]] = []
        for eatery, dishes in eatery_dishes.items():
            top3 = dishes[:3]
            if top3:
                avg_score = sum(s for _, s in top3) / len(top3)
            else:
                avg_score = 0.0
            eatery_scores.append((eatery, avg_score, dishes))

        # Sort eateries by score, take top 3
        eatery_scores.sort(key=lambda x: x[1], reverse=True)
        picks = []
        for eatery, _, dishes in eatery_scores[:3]:
            top_dishes = [name for name, _ in dishes[:4]]
            picks.append({"eatery": eatery, "dishes": top_dishes})

        result[bucket] = {"picks": picks}

    return result
