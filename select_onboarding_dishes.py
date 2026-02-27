"""Select 10 maximally diverse main dishes to show during onboarding.

Algorithm: greedy farthest-point selection on 300-dim food2vec embeddings.
Marks selected dishes with is_onboarding_dish = TRUE in Supabase.

Usage:
    python select_onboarding_dishes.py
"""

import os
import sys

import numpy as np
from dotenv import load_dotenv

load_dotenv()


def main() -> int:
    from supabase_client import SupabaseClient

    db = SupabaseClient()

    # Fetch all main dishes that have embeddings
    print("Fetching main dishes with embeddings from Supabase...")
    resp = (
        db.client.table("dishes")
        .select("id, source_name, embedding")
        .eq("dish_type", "main")
        .not_.is_("embedding", "null")
        .execute()
    )

    rows = resp.data
    if not rows:
        print(
            "No main dishes with embeddings found. Run the pipeline first to populate dishes."
        )
        return 1

    # Parse embeddings
    valid = []
    for row in rows:
        vec = db._vector_to_list(row.get("embedding"))
        if vec and len(vec) == 300:
            valid.append(
                (row["id"], row["source_name"], np.array(vec, dtype=np.float32))
            )

    if len(valid) < 10:
        print(
            f"Only {len(valid)} main dishes with valid embeddings found (need at least 10)."
        )
        return 1

    print(
        f"Found {len(valid)} main dishes with embeddings. Selecting 10 most diverse..."
    )

    # Normalize all vectors to unit length
    ids = [v[0] for v in valid]
    names = [v[1] for v in valid]
    matrix = np.stack([v[2] for v in valid])  # shape: (N, 300)
    norms = np.linalg.norm(matrix, axis=1, keepdims=True)
    norms = np.where(norms == 0, 1.0, norms)
    matrix = matrix / norms

    # Greedy farthest-point selection
    # Start with dish 0, then each step pick the dish that maximizes
    # minimum cosine distance to all already-selected dishes.
    # cosine distance = 1 - cosine_similarity (since vectors are normalized: sim = dot product)
    N = len(valid)
    selected_indices = [0]
    # min_dist[i] = min cosine distance from dish i to any selected dish
    sim_to_first = matrix @ matrix[0]  # shape: (N,)
    min_dist = 1.0 - sim_to_first

    for _ in range(9):
        # Pick the dish with the largest min distance
        # Mask already-selected
        for idx in selected_indices:
            min_dist[idx] = -1.0
        next_idx = int(np.argmax(min_dist))
        selected_indices.append(next_idx)
        # Update min distances
        sim_to_new = matrix @ matrix[next_idx]
        dist_to_new = 1.0 - sim_to_new
        min_dist = np.minimum(min_dist, dist_to_new)

    selected_ids = {ids[i] for i in selected_indices}
    all_ids = set(ids)

    print("Selected dishes:")
    for i in selected_indices:
        print(f"  [{ids[i]}] {names[i]}")

    # Update is_onboarding_dish flags
    print("\nUpdating database...")

    # Set TRUE for selected (one update per dish — avoids GENERATED ALWAYS identity issue)
    for did in selected_ids:
        db.client.table("dishes").update({"is_onboarding_dish": True}).eq(
            "id", did
        ).execute()

    # Set FALSE for non-selected (batch update)
    non_selected_ids = list(all_ids - selected_ids)
    if non_selected_ids:
        batch_size = 100
        for start in range(0, len(non_selected_ids), batch_size):
            batch = non_selected_ids[start : start + batch_size]
            db.client.table("dishes").update({"is_onboarding_dish": False}).in_(
                "id", batch
            ).execute()

    print(
        f"Done. {len(selected_ids)} onboarding dishes marked, {len(non_selected_ids)} cleared."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
