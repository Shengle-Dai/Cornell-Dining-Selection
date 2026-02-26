"""LLM-based ingredient extraction from dish names using Groq."""

import json
import os
from typing import Dict, List

from openai import OpenAI

BATCH_SIZE = 30

SYSTEM_PROMPT = """You are a culinary expert. Given a list of dish names, extract the likely main ingredients for each as a JSON object mapping dish name to an array of lowercase ingredient names.

Focus on ingredients that would appear in a recipe (proteins, vegetables, grains, sauces, spices). Omit cooking methods and adjectives. Keep ingredient names short (1-2 words).

Example input: ["Sweet Chili Chicken Drumsticks", "Tofu & Vegetable Lo Mein", "French Fries"]
Example output:
{
  "Sweet Chili Chicken Drumsticks": ["chicken", "chili", "sugar", "garlic", "soy sauce"],
  "Tofu & Vegetable Lo Mein": ["tofu", "noodles", "vegetables", "soy sauce", "sesame oil"],
  "French Fries": ["potato", "oil", "salt"]
}

Return ONLY the JSON object, no other text."""


def _make_client() -> OpenAI:
    return OpenAI(
        api_key=os.environ["GROQ_API_KEY"],
        base_url="https://api.groq.com/openai/v1/",
    )


def extract_ingredients_batch(dish_names: List[str]) -> Dict[str, List[str]]:
    """Extract ingredients for multiple dishes via LLM.

    Batches into groups of BATCH_SIZE to stay within token limits.
    Returns dict mapping dish_name -> list of ingredient strings.
    """
    if not dish_names:
        return {}

    client = _make_client()
    model = os.environ.get("GROQ_MODEL", "").strip() or "openai/gpt-oss-120b"
    result: Dict[str, List[str]] = {}

    for i in range(0, len(dish_names), BATCH_SIZE):
        batch = dish_names[i : i + BATCH_SIZE]
        user_msg = json.dumps(batch)

        try:
            resp = client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": user_msg},
                ],
                response_format={"type": "json_object"},
                temperature=0.1,
            )
            text = resp.choices[0].message.content or "{}"
            parsed = json.loads(text)

            for name in batch:
                ings = parsed.get(name, [])
                if isinstance(ings, list):
                    result[name] = [str(x).lower().strip() for x in ings if x]
                else:
                    result[name] = []
        except Exception as e:
            print(f"[ingredient_extractor] LLM batch failed: {e}")
            for name in batch:
                result[name] = []

    return result
