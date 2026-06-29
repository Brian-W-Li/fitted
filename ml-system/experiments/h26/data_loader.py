"""Polyvore Outfits-Disjoint loader + the §4 negative-sampling contract.

The H26 spike measures content-compatibility on the Polyvore **Outfits-Disjoint** split.
NOTE: the shipped split is NOT strictly item-disjoint — measured against the real JSON, the
gated **test** split shares 84 of 70,035 items with train (0.12% — effectively disjoint,
disclosed at the C2 freeze), while **valid** shares 25.8% of its items with train and is used
only for sealed checkpoint selection, never the reported metric. (Test also shares 34 items with
valid; immaterial — valid is selection-only and never enters a reported metric.) The exact disjointness
property + any purge decision freeze in the C2 pre-registration (build doc §2/§12). This
module is the single home for:

  1. Loading the shipped JSON (item metadata + the `disjoint/` outfit splits) and applying
     the frozen `type_map.json` `category_id` -> 5-value `clothingType` mapping, dropping
     non-garment accessories and any outfit left with < 2 clothing items.
  2. Constructing the evaluation pairs/questions under the §4 contract — **same-fine-category
     (same `category_id`) negatives that never co-occur with the anchor(s), split-scoped, no
     cross-leak**. Three constructions: pair-level edges (gate-A AUC), FITB@4 (gate-B), and
     corrupted outfits (gate-D outfit-level AUC).

Everything here is pure given a `Corpus`; the heavy O(pairs) constructions are on-demand
(`load_corpus` only parses + indexes + prints counts). Negatives are seed-parameterized — the
frozen seed + manifests land in the C2 pre-registration (build doc §1/§15). Reference:
`docs/plans/h26-compatibility-spike-v2.md` §4 (negative contract) / §15 (build ladder).
"""

from __future__ import annotations

import json
import os
import random
from collections import defaultdict
from dataclasses import dataclass

DEFAULT_DATA_ROOT = os.path.join(os.path.dirname(__file__), "data", "polyvore_outfits")
FIVE_TYPES = ("top", "bottom", "dress", "outer_layer", "shoes")  # fitted/lib/clothingType.ts
EXCLUDED = "excluded"
SPLITS = ("train", "valid", "test")


# --------------------------------------------------------------------------- #
# Data structures
# --------------------------------------------------------------------------- #
@dataclass(frozen=True)
class Item:
    """One Polyvore garment, resolved through `type_map.json`.

    `type` is a 5-value `clothingType` or ``"excluded"``. `category_id` is the
    same-category equivalence key for negative sampling (§4): it matches **Vasileva 2018's
    published 153-category negative-sampling grain**, so the negatives stay comparable to the
    cited AUC/FITB anchors — that comparability, *not* "no finer label exists," is why it is the
    key. (`categories.csv`'s fine-name column is non-injective — one `category_id` spans several
    fine names, e.g. id 11 = shirt/sleeveless top/sweater/top — so it carries no usable per-item
    fine label anyway.) **Trap-guard:** the metadata also carries a finer-looking `catgeories`
    breadcrumb (present for ~30% of items, brand-noisy, partial coverage); do **not** switch the
    negative key to it — it would over-harden negatives (a blouse-vs-sweater negative inside one
    `category_id`) and break comparability to the published anchors. `semantic` is the item's own
    authoritative `semantic_category` (the coarser 11-value grain).
    """

    item_id: str
    category_id: str
    semantic: str
    type: str


@dataclass(frozen=True)
class Outfit:
    set_id: str
    item_ids: tuple[str, ...]  # clothing-only, post type-filter, len >= 2


@dataclass(frozen=True)
class Edge:
    """A scored pair for pair-level AUC. `label` 1 = co-worn positive, 0 = §4 negative."""

    a: str
    b: str
    label: int
    anchor: str | None = None    # negatives: the kept anchor `b'` was drawn non-co-occurring with
    replaced: str | None = None  # negatives: the positive partner `b'` substitutes for (same category)


@dataclass(frozen=True)
class FitbQuestion:
    """Fill-in-the-blank@4: `retained` partial outfit + 4 `candidates` (one correct)."""

    retained: tuple[str, ...]
    candidates: tuple[str, ...]
    correct_index: int
    answer_category: str


@dataclass(frozen=True)
class OutfitPair:
    """Gate-D outfit-level item: a real outfit vs one same-category-multiset corruption."""

    set_id: str
    positive: tuple[str, ...]
    negative: tuple[str, ...]


@dataclass
class SplitData:
    """Per-split outfits + the indices the §4 constructions need (all split-scoped)."""

    name: str
    outfits: list[Outfit]
    cooccur: dict[str, set[str]]       # item -> items co-worn with it (this split, clothing-only)
    by_cat: dict[str, list[str]]       # category_id -> items present (this split)
    popularity: dict[str, int]         # item -> #outfits containing it (item-popularity diagnostic, §4)
    raw_outfits: int = 0
    dropped_outfits: int = 0           # dropped: < 2 clothing items after exclusion
    item_slots_raw: int = 0            # total item references in raw outfits
    item_slots_excluded: int = 0       # references dropped by the accessory/swimwear exclusion


@dataclass
class Corpus:
    item_index: dict[str, Item]        # global: every item_id -> Item (excluded ones kept, type="excluded")
    type_map: dict[str, dict]          # category_id -> {fine, semantic, type, ...}
    splits: dict[str, SplitData]
    data_root: str


# --------------------------------------------------------------------------- #
# Loading
# --------------------------------------------------------------------------- #
def load_type_map(data_root: str = DEFAULT_DATA_ROOT) -> dict[str, dict]:
    """Load the frozen fine-category -> 5-type mapping (`categories` block of type_map.json)."""
    path = os.path.join(os.path.dirname(__file__), "type_map.json")
    with open(path, encoding="utf-8") as f:
        doc = json.load(f)
    cats = doc["categories"]
    for cid, row in cats.items():
        if row["type"] not in FIVE_TYPES and row["type"] != EXCLUDED:
            raise ValueError(f"type_map.json category {cid!r} has invalid type {row['type']!r}")
    return cats


def load_item_index(data_root: str, type_map: dict[str, dict]) -> dict[str, Item]:
    """Resolve every metadata item through `type_map`. Raises if a category_id is unmapped
    (the frozen map must cover the corpus — proven once, re-checked on every load)."""
    with open(os.path.join(data_root, "polyvore_item_metadata.json"), encoding="utf-8") as f:
        meta = json.load(f)
    index: dict[str, Item] = {}
    for item_id, m in meta.items():
        cid = m["category_id"]
        row = type_map.get(cid)
        if row is None:
            raise ValueError(f"item {item_id!r} has category_id {cid!r} absent from type_map.json")
        index[item_id] = Item(
            item_id=item_id,
            category_id=cid,
            semantic=m.get("semantic_category", ""),  # the item's own authoritative semantic
            type=row["type"],
        )
    return index


def load_split(data_root: str, split: str, item_index: dict[str, Item]) -> SplitData:
    """Load one disjoint split, type-filter outfits, and build the split-scoped indices."""
    return make_split_data(split, read_raw_outfits(data_root, split), item_index)


def read_raw_outfits(data_root: str, split: str) -> list[tuple[str, list[str]]]:
    """Read one split's shipped outfit JSON as ``(set_id, [item_id, ...])`` tuples (no filtering)."""
    with open(os.path.join(data_root, "disjoint", f"{split}.json"), encoding="utf-8") as f:
        raw = json.load(f)
    return [(o["set_id"], [it["item_id"] for it in o["items"]]) for o in raw]


def purge_train_overlap(
    raw_test: list[tuple[str, list[str]]], train_item_ids: set[str]
) -> list[tuple[str, list[str]]]:
    """Drop test outfits that share ANY item with train — the strict item-disjoint headline
    (§2). The shipped 'disjoint' split is only near-disjoint (test shares 84 items / 47 outfits
    with train); purging those outfits makes the gated test set literally item-disjoint so its
    AUC/FITB is an honest generalization number. Valid's larger train overlap is NOT purged
    (valid is sealed-selection-only, never reported) — it is disclosed instead.

    Conservative by design: `train_item_ids` is keyed on RAW (pre-type-filter) train ids, so an
    overlap on an *excluded accessory* still purges the test outfit (47 outfits; keying on
    clothing-only scored ids would purge 39). Over-purging 8 already-scored-item-disjoint outfits
    only strengthens the disjointness claim, so the raw-id key is intentional."""
    return [(sid, ids) for sid, ids in raw_test if not (set(ids) & train_item_ids)]


def make_split_data(
    name: str, raw_outfits: list[tuple[str, list[str]]], item_index: dict[str, Item]
) -> SplitData:
    """Filter raw outfits (drop non-garment items, then outfits with < 2 clothing items) and
    build the split-scoped co-occurrence / category / popularity indices. The pure core of
    `load_split`, shared with tests so synthetic corpora exercise the same path (§4)."""
    outfits: list[Outfit] = []
    dropped = 0
    slots_raw = 0
    slots_excluded = 0
    for set_id, ids in raw_outfits:
        slots_raw += len(ids)
        missing = [i for i in ids if i not in item_index]
        if missing:
            raise ValueError(f"outfit {set_id!r} references items absent from metadata: {missing}")
        clothing = [i for i in ids if item_index[i].type in FIVE_TYPES]
        slots_excluded += len(ids) - len(clothing)  # accessory/swimwear exclusions only
        # Drop duplicate item references — a real Polyvore data-entry artifact (5 train outfits
        # repeat a clothing item_id). An undeduped repeat makes iter_positive_edges emit a
        # singleton pair that crashes build_pairwise and self-pollutes cooccur/popularity. Dedup
        # AFTER counting exclusions (a duplicate is not an excluded accessory) and order-
        # preserving (so the seeded negative draw stays reproducible).
        clothing = list(dict.fromkeys(clothing))
        if len(clothing) < 2:  # no edge -> drop (§4)
            dropped += 1
            continue
        outfits.append(Outfit(set_id=set_id, item_ids=tuple(clothing)))

    cooccur: dict[str, set[str]] = defaultdict(set)
    by_cat: dict[str, list[str]] = defaultdict(list)
    popularity: dict[str, int] = defaultdict(int)
    seen_in_cat: dict[str, set[str]] = defaultdict(set)
    for o in outfits:
        for i in o.item_ids:
            popularity[i] += 1
            cid = item_index[i].category_id
            if i not in seen_in_cat[cid]:
                seen_in_cat[cid].add(i)
                by_cat[cid].append(i)
        for idx, i in enumerate(o.item_ids):
            for j in o.item_ids[idx + 1:]:
                cooccur[i].add(j)
                cooccur[j].add(i)

    return SplitData(
        name=name,
        outfits=outfits,
        cooccur=dict(cooccur),
        by_cat=dict(by_cat),
        popularity=dict(popularity),
        raw_outfits=len(raw_outfits),
        dropped_outfits=dropped,
        item_slots_raw=slots_raw,
        item_slots_excluded=slots_excluded,
    )


def load_corpus(
    data_root: str = DEFAULT_DATA_ROOT, verbose: bool = True, strict_disjoint: bool = False
) -> Corpus:
    """Load the full disjoint corpus and (verbose) print the raw/post-filter/dropped counts
    the build doc requires be printed at load (§15 C1).

    `strict_disjoint=False` (default) loads the shipped JSON faithfully — the split is only
    near-disjoint (test shares 84 items / 47 outfits with train). `strict_disjoint=True` is the
    **pre-registered headline option** (§2): it purges those test outfits so the gated test set
    is literally item-disjoint from train. Valid's larger train overlap is disclosed, not purged
    (valid is sealed-selection-only)."""
    type_map = load_type_map(data_root)
    item_index = load_item_index(data_root, type_map)
    raw = {s: read_raw_outfits(data_root, s) for s in SPLITS}
    purged = 0
    if strict_disjoint:
        train_items = {i for _, ids in raw["train"] for i in ids}
        before = len(raw["test"])
        raw["test"] = purge_train_overlap(raw["test"], train_items)
        purged = before - len(raw["test"])
    splits = {s: make_split_data(s, raw[s], item_index) for s in SPLITS}
    corpus = Corpus(item_index=item_index, type_map=type_map, splits=splits, data_root=data_root)
    if verbose:
        print(_load_report(corpus))
        if strict_disjoint:
            print(f"  strict_disjoint: purged {purged} test outfits sharing an item with train")
    return corpus


def _load_report(corpus: Corpus) -> str:
    n_excluded_cats = sum(1 for r in corpus.type_map.values() if r["type"] == EXCLUDED)
    lines = [
        f"[h26 data] Polyvore Outfits-Disjoint loaded from {corpus.data_root}",
        f"  items in metadata: {len(corpus.item_index)} | type_map categories: "
        f"{len(corpus.type_map)} ({n_excluded_cats} excluded)",
        "  split   raw_outfits  kept   dropped(<2)   excluded_item_slots",
    ]
    for s in SPLITS:
        d = corpus.splits[s]
        kept = len(d.outfits)
        drop_pct = 100.0 * d.dropped_outfits / d.raw_outfits if d.raw_outfits else 0.0
        excl_pct = 100.0 * d.item_slots_excluded / d.item_slots_raw if d.item_slots_raw else 0.0
        lines.append(
            f"  {s:<6}  {d.raw_outfits:>9}  {kept:>5}  "
            f"{d.dropped_outfits:>5} ({drop_pct:4.1f}%)  "
            f"{d.item_slots_excluded:>7} ({excl_pct:4.1f}%)"
        )
    return "\n".join(lines)


# --------------------------------------------------------------------------- #
# §4 negative-sampling constructions (pure; seed-parameterized)
# --------------------------------------------------------------------------- #
def _draw_same_cat(
    split: SplitData,
    item_index: dict[str, Item],
    category_id: str,
    forbidden: set[str],
    rng: random.Random,
    k: int = 1,
) -> list[str] | None:
    """Draw `k` distinct same-category items not in `forbidden`. None if the pool is too small."""
    pool = [x for x in split.by_cat.get(category_id, []) if x not in forbidden]
    if len(pool) < k:
        return None
    return rng.sample(pool, k)


def iter_positive_edges(split: SplitData) -> set[frozenset]:
    """Distinct co-worn unordered pairs across the split (each counted once)."""
    edges: set[frozenset] = set()
    for o in split.outfits:
        ids = o.item_ids
        for idx, i in enumerate(ids):
            for j in ids[idx + 1:]:
                edges.add(frozenset((i, j)))
    return edges


def build_pairwise(
    split: SplitData, item_index: dict[str, Item], seed: int
) -> tuple[list[Edge], int]:
    """Pair-level AUC set (gate A): every co-worn pair (label 1) + one same-category,
    anchor-non-co-occurring negative each (label 0), balanced 1:1. Returns (edges, n_skipped)
    where skipped = positives with no eligible negative (category pool exhausted).

    Note for C2: positives are distinct pairs deduped across outfits (`iter_positive_edges`), so an
    edge has no unique source outfit (38 of 44,759 test pairs are co-worn in >1 outfit). The §11
    cluster-bootstrap unit for pair-level AUC is therefore the (positive, negative) pair, not the
    source outfit — pin this in the C2 preregistration."""
    rng = random.Random(seed)
    edges: list[Edge] = []
    skipped = 0
    for pair in sorted(iter_positive_edges(split), key=lambda p: tuple(sorted(p))):
        i, j = sorted(pair)
        edges.append(Edge(a=i, b=j, label=1))
        # pick which endpoint is the kept anchor; replace the other (seeded coin). If the
        # replaced endpoint's category pool is exhausted, try replacing the OTHER endpoint
        # before skipping — only drop the edge when neither orientation yields a negative.
        first, second = (i, j) if rng.random() < 0.5 else (j, i)
        neg = None
        for anchor, replaced in ((first, second), (second, first)):
            cat = item_index[replaced].category_id
            forbidden = set(split.cooccur.get(anchor, ())) | {anchor, replaced}
            drawn = _draw_same_cat(split, item_index, cat, forbidden, rng, k=1)
            if drawn is not None:
                neg = Edge(a=anchor, b=drawn[0], label=0, anchor=anchor, replaced=replaced)
                break
        if neg is None:
            skipped += 1
            continue
        edges.append(neg)
    return edges, skipped


def build_fitb(
    split: SplitData, item_index: dict[str, Item], seed: int
) -> tuple[list[FitbQuestion], int]:
    """FITB@4 (gate B): per eligible outfit hold one item out; 3 distractors of the answer's
    category, each non-co-occurring with EVERY retained item (the §4 multi-anchor rule).
    Returns (questions, n_skipped) where skipped = outfits with < 3 eligible distractors."""
    rng = random.Random(seed)
    questions: list[FitbQuestion] = []
    skipped = 0
    for o in split.outfits:
        ids = list(o.item_ids)
        answer = rng.choice(ids)
        retained = tuple(i for i in ids if i != answer)
        cat = item_index[answer].category_id
        forbidden: set[str] = {answer, *retained}
        for r in retained:
            forbidden |= split.cooccur.get(r, set())
        distractors = _draw_same_cat(split, item_index, cat, forbidden, rng, k=3)
        if distractors is None:
            skipped += 1
            continue
        candidates = [answer, *distractors]
        rng.shuffle(candidates)
        questions.append(
            FitbQuestion(
                retained=retained,
                candidates=tuple(candidates),
                correct_index=candidates.index(answer),
                answer_category=cat,
            )
        )
    return questions, skipped


def build_outfit_level(
    split: SplitData, item_index: dict[str, Item], seed: int, retries: int = 8
) -> tuple[list[OutfitPair], int]:
    """Gate-D outfit-level set: each real outfit (positive) vs one corruption that replaces
    EVERY item with a same-category item, preserving the category multiset, sharing no item
    with the positive, and with the replacements mutually non-co-occurring (a constructed
    non-outfit). Returns (pairs, n_skipped) where skipped = outfits the CSP could not fill."""
    rng = random.Random(seed)
    pairs: list[OutfitPair] = []
    skipped = 0
    for o in split.outfits:
        originals = set(o.item_ids)
        negative: list[str] | None = None
        for _ in range(retries):
            order = list(o.item_ids)
            rng.shuffle(order)
            chosen: list[str] = []
            chosen_set: set[str] = set()
            ok = True
            for it in order:
                cat = item_index[it].category_id
                forbidden = originals | chosen_set
                for c in chosen:
                    forbidden |= split.cooccur.get(c, set())
                pool = [x for x in split.by_cat.get(cat, []) if x not in forbidden]
                if not pool:
                    ok = False
                    break
                pick = rng.choice(pool)
                chosen.append(pick)
                chosen_set.add(pick)
            if ok:
                negative = chosen
                break
        if negative is None:
            skipped += 1
            continue
        pairs.append(OutfitPair(set_id=o.set_id, positive=o.item_ids, negative=tuple(negative)))
    return pairs, skipped
