# Judge addendum — the C4 `gpt-5.4-mini` freeze (SCAFFOLD — not yet frozen)

> **Status: SCAFFOLD.** The envelope block below sets `"frozen": false` with placeholder hashes, so it
> **fails** `judge_addendum.schema.json` and `evaluate.py` **refuses to emit `metrics.json`** while this
> file is a scaffold. It freezes (→ `"frozen": true`, real hashes) only at the RUN-phase step below.
> Authoritative spec: `docs/plans/h26-compatibility-spike-v2.md` §8 / §12 / §15-C4; `preregistration.md` §F.

This file is the C4 pre-registration **addendum**: the judge prompt + determinism envelope that §1 holds
out of the C2 freeze because they tune against the human-agreement calibration set. It is the **fourth**
unlock file. The headline cell, the A∧B∧D gates, δ, and the FITB construction already froze at C2 in
`preregistration.md` / `preregistration.json` — this addendum adds **only** the judge envelope.

## Freeze order is load-bearing (the blindness invariant, §1)

1. Run the **judge-only** calibration pilot on the human-agreement calibration set (`preregistration.md`
   §F): an actual-human, **diverse ≥3-person panel's** forced-choice label set (unique-plurality consensus
   over confident votes), **disjoint from the gate-B 500 and the gate-D full FITB set**, ≥ ~50 surviving
   questions. Tune the prompt / K / determinism envelope to best match the **human labels** — never any
   trained-head valid- or test-split number.
2. The ~100-Q image-only **above-chance** pilot must clear 25% chance (CI low above chance); otherwise
   gate B is labeled **vacuous** (it still passes trivially, but the GO decision rests on A∧D — §8). This
   does not move the frozen gate.
3. **Freeze this file** (set `"frozen": true`, fill the real prompt/calibration/commit hashes, K from the
   pilot's verdict-agreement rate, N's δ-driven prefix is a *separate* `evaluate.py` degree of freedom)
   **and commit it** — **before** any `fitb_trained_gateB − fitb_judge_gateB` comparison is computed.
4. Only then does `evaluate.py` validate the four unlock files and first emit `metrics.json`. After the
   freeze the **only** post-hoc freedom is the deterministic prefix length **N** over the C2-frozen
   `fitb_order.json` — never a re-selection of questions, never a re-tune of the judge.

## What freezes here

| Field | Frozen at C4 from |
|---|---|
| `model_snapshot` | the dated `gpt-5.4-mini-YYYY-MM-DD` snapshot production serves at C4 (verify it is still served; it does **not** move after C4) |
| `prompt_sha256` | sha256 of the exact committed judge prompt (`gpt_judge.SYSTEM_PROMPT` + the per-arm builder) |
| `temperature` / `k_samples` | temp 0 (smoke-tested 2026-06-28); K from the pilot's verdict-agreement rate |
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
  "frozen": false,
  "spike": "h26",
  "model_snapshot": "<gpt-5.4-mini-YYYY-MM-DD — fill at C4 from the served snapshot>",
  "snapshot_rule": "dated_snapshot_frozen_at_C4_does_not_move_after",
  "temperature": 0,
  "k_samples": null,
  "both_order_policy": "forward_plus_exact_reverse_consistent_only",
  "adjudication_convention": "inconsistent_is_miss",
  "conservative_cross_check_convention": "inconsistent_is_half",
  "max_tokens": null,
  "sdk_token_param": "max_completion_tokens",
  "reasoning_effort": "none",
  "image_detail": "low",
  "retry_budget": null,
  "drop_policy": "unparseable after the retry budget -> drop the sample + log; both models score the reduced shared question set",
  "payload_logging_policy": "full request/response payloads -> gitignored raw_payloads/; committed judge_runs.ndjson is scalar-only (question_id+order+choice+flags+provenance)",
  "system_fingerprint_policy": "logged opportunistically; may be null on gpt-5.4-mini (not the drift mechanism)",
  "prompt_sha256": "<fill at C4: sha256 of the committed judge prompt>",
  "response_format": "json_object {\"choice\": \"<letter>\"}",
  "logprob_escape_hatch": {"image_logprobs_available": false, "rechecked_at_C4": false},
  "calibration_set": {
    "manifest_path": "calibration_set.json",
    "manifest_sha256": "<fill at C4: sha256 of the calibration manifest>",
    "size": "<fill at C4: surviving consensus question count from finalize_panel>",
    "source": "polyvore_valid_train_image_only_panel",
    "label_kind": "actual_human_forced_choice",
    "single_annotator": false,
    "n_annotators": "<fill at C4: number of panel labelers (>=3)>",
    "inter_annotator_agreement": null,
    "disjoint_from": ["gate_B_set", "gate_D_full_fitb"],
    "judge_only_use": "select_judge_envelope_never_scores_trained_head"
  },
  "arms": ["image_only", "image_title", "text_attribute"],
  "above_chance_pilot": {"image_only_fitb_point": null, "image_only_fitb_ci_low": null, "above_chance": null},
  "commit_hash": "<fill at C4: the freeze commit sha>"
}
```
