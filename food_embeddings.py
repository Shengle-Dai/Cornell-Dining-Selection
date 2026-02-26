"""food2vec model loading, ingredient embedding, and vector operations."""

import re
from typing import List, Optional

import numpy as np
from food2vec.semantic_nutrition import Estimator

EMBEDDING_DIM = 300  # food2vec uses 300-dim vectors


class FoodVectorModel:
    """Wraps the food2vec Estimator for ingredient-level embeddings."""

    def __init__(self) -> None:
        self._estimator = Estimator(demo_warning=False)
        self._vocab = set(self._estimator.embedding_dictionary.keys())

    @property
    def vocab_size(self) -> int:
        return len(self._vocab)

    def has_word(self, word: str) -> bool:
        return word.lower() in self._vocab

    def get_vector(self, word: str) -> Optional[np.ndarray]:
        """Get embedding for a single word. Returns None if not in vocab."""
        w = word.lower().strip()
        if w in self._vocab:
            return self._estimator.embed(w)
        # Try individual tokens for multi-word ingredients
        tokens = w.split()
        if len(tokens) > 1:
            vecs = [self._estimator.embed(t) for t in tokens if t in self._vocab]
            if vecs:
                return np.mean(vecs, axis=0)
        return None

    def embed_ingredients(self, ingredients: List[str]) -> Optional[np.ndarray]:
        """Average the vectors of all recognized ingredients.

        Returns None if no ingredients have vectors.
        """
        vecs = []
        for ing in ingredients:
            v = self.get_vector(ing)
            if v is not None:
                vecs.append(v)
        if not vecs:
            return None
        return np.mean(vecs, axis=0).astype(np.float32)


def normalize_dish_name(name: str) -> str:
    """Normalize a dish name for cache keying.

    Strips Chinese translations in parens, lowercases, collapses whitespace.
    """
    name = re.sub(r"\s*\(.*?\)\s*", "", name)
    return re.sub(r"\s+", " ", name.strip().lower())


def cosine_similarity(a: List[float], b: List[float]) -> float:
    """Cosine similarity between two vectors."""
    a_arr = np.array(a, dtype=np.float32)
    b_arr = np.array(b, dtype=np.float32)
    dot = np.dot(a_arr, b_arr)
    norm_a = np.linalg.norm(a_arr)
    norm_b = np.linalg.norm(b_arr)
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return float(dot / (norm_a * norm_b))
