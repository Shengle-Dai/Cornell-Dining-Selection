"""LLM-based ingredient and attribute extraction from dish names using Groq."""

import json
import os
from typing import Dict, List

from openai import OpenAI

BATCH_SIZE = 10

VALID_FLAVORS = {"savory", "sweet", "spicy", "sour", "umami", "mild", "smoky", "tangy", "rich", "fresh"}
VALID_METHODS = {"fried", "grilled", "baked", "steamed", "stir-fried", "roasted", "braised", "raw", "sauteed", "smoked"}
VALID_CUISINES = {"chinese", "japanese", "korean", "indian", "mexican", "italian", "american", "mediterranean", "thai", "vietnamese", "french", "middle-eastern", "other"}
VALID_DIETARY = {"vegetarian", "vegan", "gluten-free", "dairy-free", "halal", "contains-nuts", "contains-shellfish"}
VALID_DISH_TYPES = {"main", "side", "condiment", "beverage", "dessert"}

SYSTEM_PROMPT = """You are a culinary expert. Given a list of dish names, extract attributes for each dish as a JSON object mapping dish name to an object with these fields:

- "ingredients": array of lowercase ingredient names (proteins, vegetables, grains, sauces, spices). Keep 1-2 words each.
- "flavor_profiles": array from: savory, sweet, spicy, sour, umami, mild, smoky, tangy, rich, fresh
- "cooking_methods": array from: fried, grilled, baked, steamed, stir-fried, roasted, braised, raw, sauteed, smoked
- "cuisine_type": one of: chinese, japanese, korean, indian, mexican, italian, american, mediterranean, thai, vietnamese, french, middle-eastern, other
- "dietary_attrs": array from: vegetarian, vegan, gluten-free, dairy-free, halal, contains-nuts, contains-shellfish (only include if clearly applicable)
- "dish_type": one of: main, side, condiment, beverage, dessert

Example input: ["Sweet Chili Chicken Drumsticks", "Tofu & Vegetable Lo Mein", "French Fries"]
Example output:
{
  "Sweet Chili Chicken Drumsticks": {
    "ingredients": ["chicken", "chili", "sugar", "garlic", "soy sauce"],
    "flavor_profiles": ["sweet", "spicy", "savory"],
    "cooking_methods": ["fried"],
    "cuisine_type": "chinese",
    "dietary_attrs": [],
    "dish_type": "main"
  },
  "Tofu & Vegetable Lo Mein": {
    "ingredients": ["tofu", "noodles", "vegetables", "soy sauce", "sesame oil"],
    "flavor_profiles": ["savory", "umami"],
    "cooking_methods": ["stir-fried"],
    "cuisine_type": "chinese",
    "dietary_attrs": ["vegetarian"],
    "dish_type": "main"
  },
  "French Fries": {
    "ingredients": ["potato", "oil", "salt"],
    "flavor_profiles": ["savory"],
    "cooking_methods": ["fried"],
    "cuisine_type": "american",
    "dietary_attrs": ["vegetarian", "vegan", "dairy-free"],
    "dish_type": "side"
  }
}

Return ONLY the JSON object, no other text."""


def _make_client() -> OpenAI:
    return OpenAI(
        api_key=os.environ["GROQ_API_KEY"],
        base_url="https://api.groq.com/openai/v1/",
    )


def _validate_attrs(raw: dict) -> dict:
    """Validate and sanitize extracted dish attributes against enum sets."""
    ingredients = raw.get("ingredients", [])
    if not isinstance(ingredients, list):
        ingredients = []
    ingredients = [str(x).lower().strip() for x in ingredients if x]

    flavor_profiles = [f for f in raw.get("flavor_profiles", []) if f in VALID_FLAVORS]
    cooking_methods = [m for m in raw.get("cooking_methods", []) if m in VALID_METHODS]
    cuisine_type = raw.get("cuisine_type", "other")
    if cuisine_type not in VALID_CUISINES:
        cuisine_type = "other"
    dietary_attrs = [d for d in raw.get("dietary_attrs", []) if d in VALID_DIETARY]

    dish_type = raw.get("dish_type", "main")
    if dish_type not in VALID_DISH_TYPES:
        dish_type = "main"

    return {
        "ingredients": ingredients,
        "flavor_profiles": flavor_profiles,
        "cooking_methods": cooking_methods,
        "cuisine_type": cuisine_type,
        "dietary_attrs": dietary_attrs,
        "dish_type": dish_type,
    }


def extract_dish_attributes_batch(dish_names: List[str]) -> Dict[str, Dict]:
    """Extract ingredients and attributes for multiple dishes via LLM.

    Batches into groups of BATCH_SIZE to stay within token limits.
    Returns dict mapping dish_name -> {ingredients, flavor_profiles,
    cooking_methods, cuisine_type, dietary_attrs}.
    """
    if not dish_names:
        return {}

    client = _make_client()
    model = os.environ.get("GROQ_MODEL", "").strip() or "openai/gpt-oss-120b"
    result: Dict[str, Dict] = {}

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
                raw = parsed.get(name, {})
                # Backward compatibility: if LLM returns a plain list, treat as ingredients only
                if isinstance(raw, list):
                    raw = {"ingredients": raw}
                if isinstance(raw, dict):
                    result[name] = _validate_attrs(raw)
                else:
                    result[name] = _validate_attrs({})
        except Exception as e:
            print(f"[ingredient_extractor] LLM batch failed: {e}")
            for name in batch:
                result[name] = _validate_attrs({})

    return result


def extract_ingredients_batch(dish_names: List[str]) -> Dict[str, List[str]]:
    """Extract ingredients for multiple dishes via LLM (backward-compatible wrapper).

    Returns dict mapping dish_name -> list of ingredient strings.
    """
    attrs = extract_dish_attributes_batch(dish_names)
    return {name: data["ingredients"] for name, data in attrs.items()}
