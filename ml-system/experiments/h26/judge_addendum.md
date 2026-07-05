# Judge addendum — the C4 `gpt-5.4-mini` freeze (FROZEN)

> **Status: FROZEN — K=3, image-only headline arm.** The envelope block below is `"frozen": true` with
> real hashes and the calibration + above-chance readouts from the judge-only §F panel pilot, so it now
> **passes** `judge_addendum.schema.json`. It was frozen and committed **before** any gate-B/gate-D run
> scored a held-out test question (the §1 blindness order below) — the judge envelope was fixed blind to
> every trained-head metric, tuned only against the panel's human labels. K=3 chosen from the pilot K-sweep
> (K∈{2,3,5}, indistinguishable on human-agreement within sample noise → the pre-registered prefer-K=3
> anchor stands; K=2 rejected on parse-drop robustness). The dated snapshot + envelope do **not** move
> after C4. `evaluate.py` still additionally requires the other three unlock files + the committed gate-B
> ledger before it will emit `metrics.json`.
> Authoritative spec: `docs/plans/h26-compatibility-spike-v2.md` §8 / §12 / §15-C4; `preregistration.md` §F.

This file is the C4 pre-registration **addendum**: the judge prompt + determinism envelope that §1 holds
out of the C2 freeze because they tune against the human-agreement calibration set. It is the **fourth**
unlock file. The headline cell, the A∧B∧D gates, δ, and the FITB construction already froze at C2 in
`preregistration.md` / `preregistration.json` — this addendum adds **only** the judge envelope.

## Freeze order is load-bearing (the blindness invariant, §1)

1. Run the **calibration pilot** (`run_judge.py pilot`) — the **judge-only** run on the human-agreement
   calibration set (`preregistration.md` §F): an actual-human, **diverse ≥3-person panel's** forced-choice
   label set (unique-plurality consensus over confident votes), **disjoint from the gate-B 500 and the
   gate-D full FITB set**, ≥ ~50 surviving questions. Tune the prompt / K / determinism envelope to best
   match the **human labels** — never any trained-head valid- or test-split number.
2. The calibration pilot's **above-chance readout** (`pilot_summary.correct_vs_polyvore`, image-only,
   judge-vs-Polyvore-answer) must clear 25% chance (CI low above chance); otherwise gate B is labeled
   **vacuous** (it still passes trivially, but the GO decision rests on A∧D — §8). This does not move the
   frozen gate. This readout is what fills the envelope's `above_chance_pilot` block at freeze (below) —
   its three fields are typed, so the scaffold's placeholder block fails schema validation until they are
   filled from the calibration pilot.
3. **Freeze this file** (set `"frozen": true`, fill the real prompt/calibration/commit hashes, K from the
   calibration pilot's verdict-agreement rate — **K ≥ 2, prefer K = 3** (the schema refuses K = 1, which
   makes the §11 two-stage judge-variance resample vacuous) — and `above_chance_pilot` from the
   calibration pilot's above-chance readout; N's δ-driven prefix is a *separate* `evaluate.py` degree of
   freedom) **and commit it** — **before** any `fitb_trained_gateB − fitb_judge_gateB` comparison is
   computed.
4. Only then does `evaluate.py` validate the four unlock files and first emit `metrics.json`. The
   post-freeze **gate-B pilot prefix** (`run_judge.py gate-b --n 100`, the first 100 of the C2-frozen
   `fitb_order.json`) is a **separate** run that only decides the δ-driven scale-up to ~500 — it **never**
   feeds the freeze. After the freeze the **only** post-hoc freedom is that deterministic prefix length
   **N** — never a re-selection of questions, never a re-tune of the judge.

## What freezes here

| Field | Frozen at C4 from |
|---|---|
| `model_snapshot` | the dated `gpt-5.4-mini-YYYY-MM-DD` snapshot production serves at C4 (verify it is still served; it does **not** move after C4) |
| `prompt_sha256` | sha256 of the exact committed judge prompt (`gpt_judge.SYSTEM_PROMPT` + the per-arm builder) |
| `temperature` / `k_samples` | temp 0 (smoke-tested 2026-06-28); K from the pilot's verdict-agreement rate — **must be ≥ 2** (schema-enforced: `judge_addendum.schema.json` sets `k_samples` minimum 2; K = 1 makes the §11 two-stage judge-variance resample vacuous), **prefer K = 3** if cost/latency allows |
| `both_order_policy` / `adjudication_convention` | forward + exact-reverse, consistent-only; `inconsistent = miss` headline (`inconsistent = half` cross-check) |
| `max_tokens` / `retry_budget` / `drop_policy` | the determinism envelope (unparseable-after-budget → drop + log). `max_tokens` is the envelope's completion-token cap; the SDK param is **`max_completion_tokens`** (GPT-5.x rejects `max_tokens` with a hard 400 — verified 2026-07-01; production `route.ts` sends no cap, so the judge is the first code to set one) |
| `reasoning_effort` | pinned `"none"` (the gpt-5.4-mini default, verified 2026-07-01) so a provider default change can never spend the small completion cap on hidden reasoning tokens (truncated `{"choice"}` JSON → parse-drop storms) |
| `image_detail` | pinned `"low"` on every image part. Cost-neutral on Polyvore (300×300 → 100 patches × 1.62 = 162 tok at any detail; verified 2026-07-01) but load-bearing for the C5 closet arm (real phone photos at high/auto balloon ~15× + invite server-side-resize nondeterminism) |
| `payload_logging_policy` | full payloads → gitignored `raw_payloads/`; the committed `judge_runs.ndjson` stays scalar-only (§14) |
| `calibration_set` | the manifest **path + hash** + size + source + n_annotators + inter-annotator agreement (the §F human-panel set) |
| `logprob_escape_hatch` | the C4 live re-check of whether image logprobs are available (found unavailable at design time, §8) |

**Calibration manifest contract (`calibration_set.json`, committed + sha-bound by the envelope above).** A
JSON object with a `question_ids` list (the calibration questions' ids — used by `evaluate.py` to
**mechanically** assert disjointness from the gate-B and full gate-D FITB sets, §1/§F) plus the actual human
forced-choice labels (the judge-selection target). `evaluate.py` refuses the unlock if the committed manifest's
sha256 ≠ `calibration_set.manifest_sha256`, if it is not committed-clean, or if any `question_ids` overlap a
gated set. Source it from valid/train Polyvore (or the closet) — never a test outfit a gate-D question uses (§F).

## The determinism envelope (machine-readable — `evaluate.py` parses the first ```json block)

```json
{
  "frozen": true,
  "spike": "h26",
  "model_snapshot": "gpt-5.4-mini-2026-03-17",
  "snapshot_rule": "dated_snapshot_frozen_at_C4_does_not_move_after",
  "temperature": 0,
  "k_samples": 3,
  "both_order_policy": "forward_plus_exact_reverse_consistent_only",
  "adjudication_convention": "inconsistent_is_miss",
  "conservative_cross_check_convention": "inconsistent_is_half",
  "max_tokens": 16,
  "sdk_token_param": "max_completion_tokens",
  "reasoning_effort": "none",
  "image_detail": "low",
  "retry_budget": 2,
  "drop_policy": "unparseable after the retry budget -> drop the sample + log; both models score the reduced shared question set",
  "payload_logging_policy": "full request/response payloads -> gitignored raw_payloads/; committed judge_runs.ndjson is scalar-only (question_id+order+choice+flags+provenance)",
  "system_fingerprint_policy": "logged opportunistically; may be null on gpt-5.4-mini (not the drift mechanism)",
  "prompt_sha256": "56347c30b76b5ba5170e5e3343b98f3e6d2b655f406a8d4737b3473bf21ccebd",
  "response_format": "json_object {\"choice\": \"<letter>\"}",
  "logprob_escape_hatch": {"image_logprobs_available": false, "rechecked_at_C4": false},
  "calibration_set": {
    "manifest_path": "calibration_set.json",
    "manifest_sha256": "7425af3b0125904b82049982113b7b6be97ef661a050bbbf2e48b7769f52acda",
    "size": 88,
    "source": "polyvore_valid_train_image_only_panel",
    "label_kind": "actual_human_forced_choice",
    "single_annotator": false,
    "n_annotators": 4,
    "inter_annotator_agreement": 0.4651600753295669,
    "disjoint_from": ["gate_B_set", "gate_D_full_fitb"],
    "judge_only_use": "select_judge_envelope_never_scores_trained_head"
  },
  "arms": ["image_only", "image_title", "text_attribute"],
  "above_chance_pilot": {"image_only_fitb_point": 0.5273, "image_only_fitb_ci_low": 0.3979, "above_chance": true},
  "commit_hash": "433e513d0f1803d77f10ab60683f5c0682901b1b"
}
```
