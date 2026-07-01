"""RUN-phase B2 driver: build the FashionSigLIP embedding cache, then write the sealed selection.json.

The one-time pass C3/C4 deferred (needs the gated mvasil parquet + HF auth + the local dataset). Best
run in a terminal that can stay up for a few hours — it is a single-thread CPU job by contract (the
bit-exact determinism is the headline win; a GPU would change the envelope the selection binds):

    cd ml-system/experiments/h26
    .venv/bin/python build_cache_and_select.py

It (1) loads the strict-disjoint headline corpus + the scorable item universe (every item in a kept
outfit across train/valid/test — 83,178 items), (2) builds the FROZEN embedding cache
(`embed.build_cache`, fail-loud if the backbone revision drifts from the C2-frozen SHA or any item is
missing from the parquet), and (3) runs the deterministic grid (`train_head.main`) -> the sealed
`selection.json` (checkpoint id/config/hash + convergence, NO metric value — the §1 blindness contract).

The cache blobs land under `embeddings/` (gitignored, regenerable from the seed); commit `selection.json`
+ the populated `embedding_manifest_fashionsiglip.json` cache-content fields. The cache build buffers all
embeddings in memory and writes once at the end, so a mid-run kill leaves no partial cache. To split the
two heavy phases (so a training hiccup never forces a re-embed), run the cache build alone first:
`python -c "from build_cache_and_select import build_cache_only; build_cache_only()"`, then `python
train_head.py`.
"""

from data_loader import load_headline_corpus
from embed import HEADLINE, build_cache

import train_head


def _scorable_item_ids(corpus) -> list[str]:
    """Every item that can be scored = the union of kept-outfit items across all splits (the §4 AUC
    negatives + FITB distractors are drawn from these same by-category pools, so this covers them too)."""
    return sorted({i for s in corpus.splits.values() for o in s.outfits for i in o.item_ids})


def build_cache_only() -> None:
    corpus = load_headline_corpus(verbose=True)
    ids = _scorable_item_ids(corpus)
    print(f"[b2] embedding {len(ids)} scorable items (FashionSigLIP frozen, single backbone pass)", flush=True)
    build_cache(ids, key=HEADLINE)  # multi-hour on CPU; fail-loud on revision drift / missing id
    print("[b2] cache built + verified against the frozen C2 manifest", flush=True)


def main() -> None:
    build_cache_only()
    print("[b2] running the deterministic single-thread selection grid", flush=True)
    train_head.main()  # loads the cache, runs the 6-config grid x 2 heads -> selection.json (no metric value)
    print("[b2] DONE. Commit selection.json (+ the populated embedding manifest cache fields).", flush=True)


if __name__ == "__main__":
    main()
