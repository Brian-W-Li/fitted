"""Measure the sealed pairwise head's per-edge CPU latency — the trained-side ops numbers the
`results.md` §1 systems table cites (§9 of the build doc: report the head's per-edge inference
latency alongside the judge's measured synchronous latency).

Two reads, both single-thread CPU over the frozen embedding cache:
  * batch-1  — the public `evaluate.head_edge_scorer` path, one fresh edge per call (memo-cold);
  * batched  — one `head(...)` forward over N_BATCHED random edges (the graph-scoring regime).

Latency is machine- and load-dependent (unlike every metric in metrics.json it is NOT
deterministic), so the output artifact `bench_head.json` records the date, machine, and torch
version alongside the numbers — a dated measurement, not a frozen quantity. Needs the local
cache + checkpoints (gitignored; regenerate via build_cache_and_select.py / train_head.py).

Run:  .venv/bin/python bench_head.py
"""

from __future__ import annotations

import datetime
import json
import os
import platform
import random
import time

N_BATCH1 = 1_000
N_BATCHED = 100_000
OUT = os.path.join(os.path.dirname(__file__), "bench_head.json")


def main() -> None:
    import numpy as np
    import torch

    import evaluate as ev
    from data_loader import load_headline_corpus
    from domain_probe import load_sealed_pairwise_head
    from embed import HEADLINE, load_cache
    from train_head import type_pair_index

    torch.set_num_threads(1)
    head, _selection = load_sealed_pairwise_head(os.path.dirname(__file__) or ".")
    head.eval()
    cache = load_cache(HEADLINE)
    corpus = load_headline_corpus(verbose=False)
    ids = [i for i in cache.ids if i in corpus.item_index][: 2 * N_BATCH1 + 200]
    scorer = ev.head_edge_scorer(head, cache, corpus.item_index)

    pairs = list(zip(ids[: N_BATCH1 + 100], ids[N_BATCH1 + 100 : 2 * N_BATCH1 + 200]))
    for a, b in pairs[:100]:  # warm-up (imports, allocator)
        scorer(a, b)
    t0 = time.perf_counter()
    for a, b in pairs[100 : N_BATCH1 + 100]:  # every edge distinct -> memo never hits
        scorer(a, b)
    batch1_ms = (time.perf_counter() - t0) / N_BATCH1 * 1e3

    rnd = random.Random(0)
    big = [(rnd.choice(ids), rnd.choice(ids)) for _ in range(N_BATCHED)]
    ea = torch.from_numpy(np.stack([cache.vec(a) for a, _ in big]))
    eb = torch.from_numpy(np.stack([cache.vec(b) for _, b in big]))
    tp = torch.tensor([type_pair_index(corpus.item_index[a].type, corpus.item_index[b].type)
                       for a, b in big])
    with torch.no_grad():
        head(ea[:1000], eb[:1000], tp[:1000])  # warm-up
        t0 = time.perf_counter()
        head(ea, eb, tp)
        batched_s = time.perf_counter() - t0

    result = {
        "date": datetime.date.today().isoformat(),
        "machine": f"{platform.machine()} / {platform.platform()}",
        "torch": torch.__version__,
        "torch_num_threads": 1,
        "n_batch1_edges": N_BATCH1,
        "batch1_ms_per_edge": round(batch1_ms, 4),
        "n_batched_edges": N_BATCHED,
        "batched_us_per_edge": round(batched_s / N_BATCHED * 1e6, 3),
        "batched_edges_per_s": round(N_BATCHED / batched_s),
        "note": "dated machine-dependent measurement, NOT a frozen/deterministic quantity",
    }
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
