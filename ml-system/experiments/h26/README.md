# H26 — Content-compatibility spike (offline)

> Build doc: `docs/plans/h26-compatibility-spike-v2.md`. Spec context: `docs/Fitted_Spec_v2.md` §20, §23-H26/H28.
> Status: **C3 built (C1–C3 committed)** — C1 (scaffold + `data_loader.py` + `type_map.json` + invariant tests); C2 the metric harness (`metrics.py`: pooled AUC, outfit-level AUC, FITB@4, cluster bootstrap) + `embed.py` (FashionSigLIP frozen via open_clip — **dim 768**, revision `c56244cc`, L2-normalized; gated-parquet image source; cache builder + config manifest) + `closet_manifest.template.json` + picker + schema + **the pre-registration FREEZE** (`preregistration.md` + `preregistration.json` — headline cell + A/B/D gates δ=0.05 + analyst pins — `fitb_manifest.json` + `embedding_manifest_fashionsiglip.json` + `metrics.schema.json`, all committed **before any model number**); C3 `baselines.py` + both trained heads (`train_head.py`, 795,617 / 788,481 params) + the eval-driver **metric half** (`evaluate.py` — computation only, no emission) + the materialized gate-B `fitb_order.json` (13,895 FITB Qs, 500 gate-B). **`selection.json` is deferred** — it needs the one-time (multi-hour) FashionSigLIP embedding-cache pass; everything else is committed + tested (130 green, 1 skipped — the skip is the deferred `selection.json` drift guard). **Next: C4** (LLM-as-judge + the four-file unlock that first materializes `metrics.json`). `closet_manifest.json` freezes from the template before the C4 unlock (Brian labels his worn outfits then).

## What this is

A public-corpus baseline answering one **systems** question, not a quality contest:
**when does a tiny specialized compatibility model beat a per-edge `gpt-5.4-mini` call?**
The headline artifact is the §9 cost / determinism / availability table. The go/no-go is
A∧B∧D (§12); the catalog→closet transfer is **reported, not gated**.

## Isolation

Self-contained under `ml-system/experiments/h26/` with its own `requirements.txt`. Touches
no `fitted_core/` code and does not affect the core suite's ≥715-green floor — the main
suite is pinned to `tests/` via `ml-system/pytest.ini`, so this dir is never auto-discovered
there. Run the spike's own tests from this directory.

## Data

`data_loader.py` reads `$H26_DATA_ROOT` (default `./data/polyvore_outfits/`), the gated
`mvasil/polyvore-outfits` HF release (Vasileva 2018; originally distributed via the
`mvasil/fashion-compatibility` GitHub repo as a `polyvore_outfits` folder). **Not committed**
(gitignored). C1 needs only the JSON (`polyvore_item_metadata.json` +
`disjoint/{train,valid,test}.json`). The images are **not** loose files — at C2 they come from
the parquet configs (`load_dataset("mvasil/polyvore-outfits", "disjoint")`, an `image` column
keyed by `item_id`); see build-doc §2.

## Run

```sh
cd ml-system/experiments/h26
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
pytest                      # spike tests, isolated from the core suite
```

## Build ladder (detail: build doc §15)

C1 scaffold + loader · C2 embeddings + metrics + **FREEZE** · C3 baselines + trained head ·
C4 LLM judge · C5 domain gap · C6 report + mechanical gate.
