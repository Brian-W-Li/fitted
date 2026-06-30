"""Materialize + hash the gate-B seed-ordered FITB question list (C3 — before any model number).

Build doc §12: *"C2 freezes the constructor (`data_loader.build_fitb`), seed, strict-disjoint loader,
`type_map.json`, and source hashes in `fitb_manifest.json`; **C3 materializes/hashes the regenerated
ordered question list before any model number**, and C4's only degree of freedom is the prefix length
N."* `fitb_manifest.json` froze the *rules* at C2; this module realizes them at C3 into the committed
`fitb_order.json` — the seed-ordered question sequence's content hash (the drift tripwire C4's prefix
binds to) + the gate-B working prefix, materialized **before any model number exists**.

Why this is a real C3 artifact even though `selection.json` is deferred: the order depends only on the
corpus + the frozen seed (`build_fitb`), **not** on the embedding cache, so it can be — and is —
materialized now, before the one-time embedding pass. **Blindness:** it carries NO metric value, only
question identities + a hash; it is the *question-set* freeze the gate-B prefix selection (C4) reads,
never a model number (build doc §1/§12). Reference: docs/plans/h26-compatibility-spike-v2.md §12 / §15.
"""

from __future__ import annotations

import hashlib
import json
import os

from data_loader import Corpus, FitbQuestion, build_fitb, load_headline_corpus, load_json_strict

ROOT_DIR = os.path.dirname(__file__)
SEED = 20260629
SPLIT_LOADER = "load_corpus(strict_disjoint=True)"
FITB_SPLIT = "test"  # gate D = the full held-out test FITB; gate B = a prefix of it (fitb_manifest)


def _file_sha256(path: str) -> str:
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def _question_record(q: FitbQuestion) -> list:
    """The drift-detecting identity of one FITB question: its outfit id, the retained partial outfit,
    the ordered candidate set (answer + distractors, post seeded-shuffle), the correct slot, and the
    answer category. Any change in the constructor's output — a re-shuffle, a different distractor draw
    — changes this, so the order hash is a real tripwire, not just a length check."""
    return [q.set_id, list(q.retained), list(q.candidates), q.correct_index, q.answer_category]


def _order_sha256(questions: list[FitbQuestion]) -> str:
    """sha256 of the canonical-serialized **ordered** question sequence — the build doc §12 tripwire.
    Order-sensitive (a re-shuffle changes it), so C4's prefix is provably a prefix of THIS frozen
    order."""
    payload = json.dumps([_question_record(q) for q in questions], separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def materialize_fitb_order(corpus: Corpus, *, seed: int = SEED, root_dir: str = ROOT_DIR) -> dict:
    """Build the seed-ordered FITB questions on the strict-disjoint test split and assemble the
    `fitb_order.json` dict: the full-order hash (gate-D set + the gate-B prefix tripwire), the gate-B
    prefix hash, the gate-B prefix's `set_id`s (transparency), and the provenance binding it to the
    frozen rules. Reads the `gate_B` cap + pilot from `fitb_manifest.json` (single-source). Carries
    **no model number** (§1)."""
    manifest = load_json_strict(os.path.join(root_dir, "fitb_manifest.json"))
    cap = manifest["allocation"]["gate_B"]["cap"]
    pilot = manifest["allocation"]["gate_B"]["pilot_prefix"]

    questions, skipped = build_fitb(corpus.splits[FITB_SPLIT], corpus.item_index, seed)
    gate_b = questions[:cap]
    return {
        "_README": (
            "C3 materialization of the gate-B seed-ordered FITB question list (build doc §12), frozen "
            "BEFORE any model number. order_sha256 is the drift tripwire over the FULL ordered test "
            "FITB set (gate D); the gate-B set is its first `gate_b_cap` questions; C4's only freedom "
            "is the prefix length N (<= cap) over THIS frozen order (never a re-selection of which "
            "questions). Regenerate + verify with fitb_order.verify_fitb_order. No metric value here."
        ),
        "spike": "h26",
        "stage": "C3",
        "seed": seed,
        "split_loader": SPLIT_LOADER,
        "fitb_split": FITB_SPLIT,
        "constructor": "data_loader.build_fitb",
        "constructor_source_sha256": _file_sha256(os.path.join(root_dir, "data_loader.py")),
        "type_map_sha256": _file_sha256(os.path.join(root_dir, "type_map.json")),
        "fitb_manifest_sha256": _file_sha256(os.path.join(root_dir, "fitb_manifest.json")),
        "n_questions_full": len(questions),
        "n_skipped": skipped,
        "gate_b_cap": cap,
        "gate_b_pilot_prefix": pilot,
        "n_gate_b": len(gate_b),
        "order_sha256": _order_sha256(questions),
        "gate_b_order_sha256": _order_sha256(gate_b),
        "gate_b_set_ids": [q.set_id for q in gate_b],
    }


def verify_fitb_order(order: dict, corpus: Corpus, *, root_dir: str = ROOT_DIR) -> None:
    """Re-derive the order from the corpus + the order's own seed and fail loud on ANY drift — the C4
    precondition (the gate-B prefix must be a prefix of the SAME frozen order C3 hashed). Checks the
    full-order + gate-B hashes and that the gate-B `set_id`s reproduce."""
    fresh = materialize_fitb_order(corpus, seed=order["seed"], root_dir=root_dir)
    for field in ("order_sha256", "gate_b_order_sha256", "n_questions_full", "gate_b_set_ids"):
        if fresh[field] != order[field]:
            raise ValueError(
                f"fitb_order drift in {field!r}: the regenerated gate-B order does not match the "
                f"committed fitb_order.json (constructor/corpus/seed changed). C4's prefix would bind "
                f"the wrong question set."
            )


def write_fitb_order(corpus: Corpus, *, seed: int = SEED, root_dir: str = ROOT_DIR) -> str:
    """Materialize the gate-B order and write `fitb_order.json` (committed at C3). Returns the path."""
    order = materialize_fitb_order(corpus, seed=seed, root_dir=root_dir)
    path = os.path.join(root_dir, "fitb_order.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(order, f, indent=1)
    return path


def main() -> None:
    """Materialize the REAL gate-B order from the strict-disjoint corpus and write `fitb_order.json`.
    Needs only the dataset (present locally) + the frozen seed — NOT the embedding cache — so it runs
    at C3 before the one-time embedding pass."""
    corpus = load_headline_corpus(verbose=False)
    path = write_fitb_order(corpus)
    order = load_json_strict(path)
    # Provenance only — NO metric value (§1).
    print(f"[h26 C3] wrote {path}")
    print(f"[h26 C3] n_questions_full={order['n_questions_full']} (skipped {order['n_skipped']}) "
          f"gate_b={order['n_gate_b']}/{order['gate_b_cap']}")
    print(f"[h26 C3] order_sha256={order['order_sha256']}")


if __name__ == "__main__":
    main()
