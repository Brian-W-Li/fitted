"""Non-learned baselines + the two harness sanity diagnostics (§7 / §C.6).

The reported baseline ladder is three numbers (§7): the **same-backbone zero-shot cosine floor**
(here), the trained pairwise head (`train_head.py`), and the `gpt-5.4-mini` judge (C4). Only the
zero-shot cosine isolates what *training* adds over the frozen FashionSigLIP representation — the
trained head must beat **its own backbone's** cosine (gate A), so this floor is load-bearing, not a
formality.

**Outside the ladder** sit two pre-registered sanity diagnostics (§4 / §C.6), neither a beatable
rung:

  1. **Category-pair co-occurrence — a leak detector** (`category_cooccurrence_edge_scorer`). A score
     that is a pure function of the unordered *category* pair scores a positive and its
     same-fine-category negative **identically** (the swap preserves the category pair), so by
     construction it reads chance — **edge AUC ≈ 0.50, FITB ≈ 0.25, outfit AUC ≈ 0.50**. A deviation
     means the negative sampler leaked a category signal; `cooccurrence_leak_check` asserts it.
  2. **Item-popularity — a confound diagnostic, NOT chance-by-construction** (`popularity_*_scores`).
     A real co-worn positive partner is selection-biased toward popular items; a uniformly-drawn
     same-category negative is on average *less* popular, so a popularity-only score can discriminate
     **without any compatibility signal**. The blind margin is **0.55** (§C.6): if the edge- or
     outfit-level popularity AUC exceeds it, the headline is labeled "popularity-confounded
     (disclosed)" and a sensitivity re-run reports — gate numbers do not move. The §C.6 score form is
     pinned: "popularity" = an item's split outfit-frequency (`SplitData.popularity`); the **edge**
     score is the popularity of the *varying* endpoint (`pop(replaced)` for the positive vs `pop(b′)`
     for the matched negative — the shared anchor cancels); the **outfit** score is the mean
     item-popularity over the outfit's items. No embeddings enter the popularity diagnostic.

Everything is pure given a `Corpus`/`SplitData` and (for cosine) a frozen `EmbeddingCache`; no module
re-embeds. Reference: docs/plans/h26-compatibility-spike-v2.md §7 (ladder) / §4 + §C.6 (diagnostics).
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Sequence
from dataclasses import dataclass

import numpy as np

from data_loader import Edge, FitbQuestion, Item, OutfitPair, SplitData
from embed import EmbeddingCache
from metrics import EdgeScore, auc_pos_neg, fitb_candidate_scores, fitb_hit, mean_edge_score

# The §C.6 popularity blind margin (frozen in preregistration.json). Imported by evaluate.py for the
# diagnostic trigger; defined here next to the score forms it gates.
POPULARITY_BLIND_MARGIN = 0.55


# --------------------------------------------------------------------------- #
# Baseline 1 — same-backbone zero-shot cosine (the binding non-learned floor, §7)
# --------------------------------------------------------------------------- #
def cosine_edge_scorer(cache: EmbeddingCache) -> EdgeScore:
    """`edge(i, j) -> cosine(emb_i, emb_j)` over the frozen L2-normalized embeddings. Because the
    cache rows are L2-normalized (verified at load), cosine is the plain dot product. This is the
    zero-shot floor gate A measures the trained head against (§7) — no training, the representation
    as-shipped."""
    def edge(i: str, j: str) -> float:
        return float(np.dot(cache.vec(i), cache.vec(j)))

    return edge


# --------------------------------------------------------------------------- #
# Diagnostic 1 — category-pair co-occurrence leak detector (§4 / §C.6)
# --------------------------------------------------------------------------- #
def category_cooccurrence_counts(
    split: SplitData, item_index: dict[str, Item]
) -> dict[frozenset, int]:
    """`{category_id, category_id} -> #co-worn item pairs of that category pair in the split`. A
    same-category pair (two tops) keys on a singleton frozenset — consistent for both the positive and
    its same-category negative, which is exactly why the resulting score reads chance (§C.6)."""
    counts: dict[frozenset, int] = defaultdict(int)
    for o in split.outfits:
        ids = o.item_ids
        for a in range(len(ids)):
            for b in range(a + 1, len(ids)):
                key = frozenset((item_index[ids[a]].category_id, item_index[ids[b]].category_id))
                counts[key] += 1
    return dict(counts)


def category_cooccurrence_edge_scorer(
    split: SplitData, item_index: dict[str, Item]
) -> EdgeScore:
    """A leak-detector edge scorer that depends ONLY on the unordered category pair (§C.6). On the §4
    same-fine-category negatives it MUST read chance; `cooccurrence_leak_check` asserts it. It carries
    zero item-level compatibility signal, so it is never a reported rung — a margin over it would be a
    category-leak artifact, not a result."""
    counts = category_cooccurrence_counts(split, item_index)

    def edge(i: str, j: str) -> float:
        return float(counts.get(frozenset((item_index[i].category_id, item_index[j].category_id)), 0))

    return edge


@dataclass(frozen=True)
class LeakCheck:
    """The three chance-by-construction leak-detector readouts (§C.6). `assert_chance` raises if any
    deviates beyond tolerance — the negative sampler leaked a category signal."""

    edge_auc: float
    fitb_acc: float
    outfit_auc: float

    def assert_chance(
        self, *, edge_tol: float = 1e-9, fitb_tol: float = 1e-9, outfit_tol: float = 1e-3
    ) -> "LeakCheck":
        # Edge + FITB are EXACT by construction (identical pos/neg category-pair multisets -> 0.50;
        # all four same-category candidates tie -> 0.25). Outfit-level is "≈0.50" not "==0.50": the
        # category multiset is preserved but `mean_edge_score` sums in a shuffled item order, so the
        # positive/negative outfit scores agree only to floating-point order (metrics.mean_edge_score
        # FP trap-guard) -> a small, non-leak deviation, bounded well under any real category leak.
        if abs(self.edge_auc - 0.50) > edge_tol:
            raise AssertionError(f"co-occurrence edge AUC {self.edge_auc} != 0.50 (category leak in the negatives)")
        if abs(self.fitb_acc - 0.25) > fitb_tol:
            raise AssertionError(f"co-occurrence FITB {self.fitb_acc} != 0.25 (category leak in the FITB distractors)")
        if abs(self.outfit_auc - 0.50) > outfit_tol:
            raise AssertionError(f"co-occurrence outfit AUC {self.outfit_auc} !≈ 0.50 (category leak in the corruption)")
        return self


def cooccurrence_leak_check(
    split: SplitData,
    item_index: dict[str, Item],
    clusters: Sequence[tuple[Edge, Edge]],
    questions: Sequence[FitbQuestion],
    outfit_pairs: Sequence[OutfitPair],
) -> LeakCheck:
    """Compute the three §C.6 leak-detector values from the category-only scorer on the constructed
    eval sets (pair clusters, FITB questions, gate-D outfit pairs). The caller builds the sets once
    (via `data_loader.build_pairwise/build_fitb/build_outfit_level`) and passes them — so the leak
    check scores the *same* questions the metrics do, not a re-rolled set."""
    edge = category_cooccurrence_edge_scorer(split, item_index)
    pos = [edge(p.a, p.b) for p, _ in clusters]
    neg = [edge(n.a, n.b) for _, n in clusters]
    edge_auc = auc_pos_neg(pos, neg)

    hits = [
        fitb_hit(fitb_candidate_scores(q.retained, q.candidates, edge), q.correct_index)
        for q in questions
    ]
    fitb_acc = float(np.mean(hits)) if hits else 0.25

    opos = [mean_edge_score(op.positive, edge) for op in outfit_pairs]
    oneg = [mean_edge_score(op.negative, edge) for op in outfit_pairs]
    outfit_auc = auc_pos_neg(opos, oneg)
    return LeakCheck(edge_auc=edge_auc, fitb_acc=fitb_acc, outfit_auc=outfit_auc)


# --------------------------------------------------------------------------- #
# Diagnostic 2 — item-popularity confound (§4 / §C.6; the pinned score form)
# --------------------------------------------------------------------------- #
def _pop(popularity: dict[str, int], item_id: str) -> float:
    """An item's split outfit-frequency (`SplitData.popularity`); 0 for an item absent from the split
    (the diagnostic is split-scoped, like the negatives it interrogates)."""
    return float(popularity.get(item_id, 0))


def popularity_edge_scores(
    clusters: Sequence[tuple[Edge, Edge]], popularity: dict[str, int]
) -> tuple[list[float], list[float]]:
    """The §C.6 edge popularity diagnostic, per (positive, negative) pair cluster: the popularity of
    the *varying* endpoint. For the positive that is the original co-worn partner that was swapped out
    (`neg.replaced`); for the negative it is the drawn `b′` (`neg.b`). The shared anchor cancels (it is
    identical in both), so the score isolates the candidate's marginal outfit-frequency — exactly the
    §4 selection-bias confound. Returns aligned `(pos_scores, neg_scores)` for `auc_pos_neg`."""
    pos: list[float] = []
    neg: list[float] = []
    for _, n in clusters:
        if n.replaced is None:
            raise ValueError("popularity edge diagnostic needs a §4 negative carrying its `replaced` endpoint")
        pos.append(_pop(popularity, n.replaced))  # the positive's varying partner
        neg.append(_pop(popularity, n.b))         # the negative draw b'
    return pos, neg


def popularity_outfit_scores(
    outfit_pairs: Sequence[OutfitPair], popularity: dict[str, int]
) -> tuple[list[float], list[float]]:
    """The §C.6 outfit-level popularity diagnostic: the mean item-popularity over the outfit's items
    (positive = the real items; negative = the same-category replacements). Full-item-replacement
    negatives draw uniformly-sampled (on average less-popular) items for every slot, amplifying the
    same confound at the outfit level. Returns aligned `(pos_scores, neg_scores)`."""
    pos = [float(np.mean([_pop(popularity, i) for i in op.positive])) for op in outfit_pairs]
    neg = [float(np.mean([_pop(popularity, i) for i in op.negative])) for op in outfit_pairs]
    return pos, neg
