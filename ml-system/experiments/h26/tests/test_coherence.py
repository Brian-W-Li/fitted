"""Tests for the frozen 5-type wearability coherence rule (coherence.py — preregistration.md §F).

The rule is a one-way-door freeze (pre-pilot 2026-07-01), so every clause is pinned: at most one
item per 5-type, never a dress with a top or bottom, fail-loud on an unmapped item, and the
question-level flag reads ONLY retained + the held-out answer (candidate choice can never move it —
all 4 candidates are same-fine-category, §4, so the flag is a property of the question).
"""

import pytest

from coherence import COHERENCE_RULE, fitb_question_is_coherent, outfit_is_coherent
from data_loader import FitbQuestion, Item


def _index():
    types = {
        "top_a": "top", "top_b": "top",
        "bot_a": "bottom", "bot_b": "bottom",
        "dress_a": "dress",
        "shoe_a": "shoes", "shoe_b": "shoes", "shoe_c": "shoes", "shoe_d": "shoes",
        "outer_a": "outer_layer",
    }
    return {iid: Item(item_id=iid, category_id=f"c_{t}", semantic=t, type=t) for iid, t in types.items()}


# --------------------------------------------------------------------------- #
# outfit_is_coherent — the frozen rule, clause by clause
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize(
    "item_ids,expected",
    [
        (("top_a", "bot_a", "shoe_a"), True),                     # the canonical wearable outfit
        (("dress_a", "outer_a", "shoe_a"), True),                 # dress-based outfit is fine
        (("dress_a", "shoe_a"), True),                            # minimal dress outfit
        (("shoe_a", "shoe_b", "top_a"), False),                   # two shoes -> board artifact
        (("top_a", "top_b", "bot_a", "shoe_a"), False),           # two tops -> the disclosed strict over-flag
        (("dress_a", "bot_a", "shoe_a"), False),                  # dress + bottom -> wear-impossible
        (("dress_a", "top_a", "shoe_a"), False),                  # dress + top -> wear-impossible
        (("bot_a", "bot_b"), False),                              # two bottoms
    ],
)
def test_outfit_is_coherent_frozen_rule(item_ids, expected):
    assert outfit_is_coherent(item_ids, _index()) is expected


def test_outfit_is_coherent_fails_loud_on_unmapped_item():
    # A silent default would let an unmapped item slip through the frozen rule (§F) — KeyError, not False.
    with pytest.raises(KeyError):
        outfit_is_coherent(("top_a", "ghost_item"), _index())


# --------------------------------------------------------------------------- #
# fitb_question_is_coherent — the flag reads retained + answer ONLY
# --------------------------------------------------------------------------- #
def test_question_flag_is_retained_plus_answer_only():
    idx = _index()
    # retained top+bottom, held-out answer a shoe -> the implied full outfit is coherent, even though
    # a NON-answer candidate (top_b) would clash with the retained top if it were the answer.
    q = FitbQuestion("q1", retained=("top_a", "bot_a"),
                     candidates=("shoe_a", "top_b", "shoe_c", "shoe_d"),
                     correct_index=0, answer_category="c_shoes")
    assert fitb_question_is_coherent(q, idx) is True


def test_question_flag_candidate_choice_cannot_move_it():
    idx = _index()
    # The SAME retained set + the same candidate list, flag flipped ONLY by which candidate is the
    # held-out answer: answer=shoe (index 0) -> coherent; answer=second-bottom (index 1) -> flagged.
    # This pins that the flag reads q.candidates[q.correct_index], never the distractors.
    retained = ("top_a", "bot_a")
    candidates = ("shoe_a", "bot_b", "shoe_c", "shoe_d")
    coherent = FitbQuestion("q2", retained, candidates, 0, "c_shoes")
    flagged = FitbQuestion("q2", retained, candidates, 1, "c_bottom")
    assert fitb_question_is_coherent(coherent, idx) is True
    assert fitb_question_is_coherent(flagged, idx) is False


def test_question_flag_flags_a_duplicate_type_full_outfit():
    idx = _index()
    # retained already holds a shoe; the held-out answer is another shoe -> two shoes -> flagged
    # (the "add a category already present" redundant-add case the calibration draw must skip).
    q = FitbQuestion("q3", retained=("shoe_a", "top_a", "bot_a"),
                     candidates=("shoe_b", "shoe_c", "shoe_d", "top_b"),
                     correct_index=0, answer_category="c_shoes")
    assert fitb_question_is_coherent(q, idx) is False


def test_rule_constant_names_the_frozen_semantics():
    # the constant is written into metrics.json.coherence_sensitivity.rule (schema const) — pin it here
    # so a rename fails loud rather than silently breaking the schema bind.
    assert COHERENCE_RULE == (
        "leq_one_item_per_5type_and_no_dress_with_top_or_bottom_over_retained_plus_answer"
    )
