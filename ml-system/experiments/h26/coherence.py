"""Outfit 5-type wearability coherence — the frozen mechanical rule (preregistration.md §F amendments).

Polyvore "sets" are curatorial shopping/mood boards, not guaranteed wearable outfits: measured on the
frozen-seed constructions, ~13-14% of FITB questions have a full outfit (retained + held-out answer)
that is wear-impossible or type-duplicated (two pairs of shoes, a dress plus pants, "add a bottom" when
a bottom is already retained — the calibration draw measured 13/100, the gate-B 500 prefix 65/500, the
gate-D full set 1,964/13,895). Humans balk at judging "which item best completes it" on those; automated
scorers cannot exploit them either way, because FITB distractors are same-fine-category as the answer
(§4) — all 4 candidates share the SAME clash status, so coherence can never discriminate candidates
within a question (verified 500/500 on the gate-B prefix). Two committed uses:

1. **Calibration draw filter** (`make_calibration`): the human panel labels only coherent questions —
   the judge-selection target is "human consensus on wearable-outfit questions" (§F).
2. **Eval sensitivity flag** (`evaluate`): the gate-B/gate-D EVAL sets stay the standard, UNFILTERED
   benchmark (the Vasileva anchors were computed on the same unfiltered corpus — filtering the eval
   would break gate-D anchor comparability and inflate the floor); each question instead carries this
   mechanical flag and metrics.json reports coherent-vs-flagged slices, reported-never-gating.

The rule is deliberately STRICT — at most one item per 5-type — so layered-top outfits (tank +
cardigan: the type map folds cardigan/kimono/hoodie into `top`) read incoherent by design. That
over-flagging is disclosed, not corrected: a looser "allow two tops" rule cannot mechanically separate
tee+cardigan (wearable) from two crew-neck sweaters (a board artifact), and the strict rule errs toward
questions a human can confidently label. Metadata mislabels (e.g. a dress tagged `top`) and
source-corrupted images pass this filter — the calibration draw layers a visual-QC exclude list
(`make_calibration`) and the panel's abstain + plurality-drop machinery over it as the backstop.

Frozen pre-pilot 2026-07-01 (before any judge or test-set number existed) — preregistration.md §F.
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Iterable

from data_loader import FitbQuestion, Item

COHERENCE_RULE = "leq_one_item_per_5type_and_no_dress_with_top_or_bottom_over_retained_plus_answer"


def outfit_is_coherent(item_ids: Iterable[str], item_index: dict[str, Item]) -> bool:
    """True iff the outfit is 5-type wearable: at most one item per clothingType AND never a dress
    combined with a top or bottom. Pure; raises KeyError on an unmapped item (fail loud — a silent
    default would let an unmapped item slip through the frozen rule)."""
    counts = Counter(item_index[iid].type for iid in item_ids)
    if any(n > 1 for n in counts.values()):
        return False
    return not (counts.get("dress") and (counts.get("top") or counts.get("bottom")))


def fitb_question_is_coherent(q: FitbQuestion, item_index: dict[str, Item]) -> bool:
    """The per-question flag: coherence of the FULL outfit the question implies — retained + the
    held-out correct answer. Candidate choice cannot move the flag (all 4 candidates are
    same-fine-category, §4), so the flag is a property of the question, not of any answer."""
    return outfit_is_coherent((*q.retained, q.candidates[q.correct_index]), item_index)
