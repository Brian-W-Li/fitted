"""Step-4 driver: run the live `gpt-5.4-mini` judge (your key, your terminal) — pilot -> gate-B -> emit.

Brian runs this; the OpenAI key stays in his shell (`OPENAI_API_KEY`), never with the assistant. Three
subcommands mirror the §8/§12 RUN sequence (all image-only, the headline arm):

    # 1. CALIBRATION PILOT — tune K against the panel's consensus labels (calibration_set.json), BLIND to test.
    .venv/bin/python run_judge.py pilot --k 3            # try a few K; pick the most human-agreeing + stable
    # -> then freeze judge_addendum.md (fill the envelope from the pilot; commit it) BEFORE the next step.

    # 2. GATE-B RUN — the frozen-envelope judge over the gate-B prefix -> judge_runs.ndjson (committed).
    .venv/bin/python run_judge.py gate-b --n 100         # the above-chance/position-flip pilot prefix first
    .venv/bin/python run_judge.py gate-b --n 500         # extend if the half-width needs it (<= cap)

    # 3. EMIT — the four-file unlock -> metrics.json (needs selection.json + judge_addendum.md + closet_manifest.json).
    .venv/bin/python run_judge.py emit --n 500

Blindness: the pilot scores the judge against the panel's consensus labels + reports the judge's above-chance
FITB — it never reads a trained-head number; the freeze (K/prompt) is fixed from the pilot BEFORE any gate-B trained
vs judge comparison (`emit`). Reference: docs/plans/h26-compatibility-spike-v2.md §8/§11/§12/§15.
"""

from __future__ import annotations

import argparse
import os

from data_loader import FitbQuestion, build_fitb, load_headline_corpus, load_json_strict
from gpt_judge import (
    OpenAIJudgeClient,
    group_samples,
    parse_choice,  # noqa: F401  (re-exported convenience for interactive debugging)
    run_arm,
    verdict_for,
)

ROOT_DIR = os.path.dirname(__file__)
SEED = 20260629
IMAGE_ONLY = "image_only"
DEFAULT_MAX_TOKENS = 16
DEFAULT_RETRY_BUDGET = 2
PILOT_LEDGER = os.path.join(ROOT_DIR, "calibration_pilot.ndjson")   # NOT committed (judge calibration)
GATE_B_LEDGER = os.path.join(ROOT_DIR, "judge_runs.ndjson")         # the committed gate-B ledger
RAW_PAYLOADS = os.path.join(ROOT_DIR, "raw_payloads")               # gitignored


def _snapshot(cli: str | None) -> str:
    # The dated snapshot production serves (verify it is still served at run time — §8). Overridable.
    return cli or "gpt-5.4-mini-2026-03-17"


def _provider(questions: list[FitbQuestion]):
    from live_content import ParquetContentProvider

    item_ids = {i for q in questions for i in (*q.retained, *q.candidates)}
    return ParquetContentProvider(item_ids)


def _calibration_questions() -> tuple[list[FitbQuestion], dict[str, int]]:
    cal = load_json_strict(os.path.join(ROOT_DIR, "calibration_set.json"))
    qs = [
        FitbQuestion(r["set_id"], tuple(r["retained"]), tuple(r["candidates"]), r["correct_index"], r["answer_category"])
        for r in cal["questions"]
    ]
    human = {r["set_id"]: r["human_choice"] for r in cal["questions"]}
    return qs, human


def cmd_pilot(args) -> None:
    """Run the judge on the calibration set (image-only) and report how well it matches the PANEL's
    consensus labels + its stability, for a given K — the envelope-selection signal (§8). Writes a throwaway pilot ledger."""
    questions, human = _calibration_questions()
    if os.path.exists(PILOT_LEDGER):
        os.remove(PILOT_LEDGER)                       # fresh pilot each run (K sweep)
    provider = _provider(questions)
    client = OpenAIJudgeClient(_snapshot(args.snapshot))
    run_arm(
        questions, arm=IMAGE_ONLY, client=client, provider=provider, k_samples=args.k,
        max_tokens=args.max_tokens, retry_budget=args.retry_budget, model_snapshot=_snapshot(args.snapshot),
        ledger_path=PILOT_LEDGER, payload_dir=RAW_PAYLOADS,
    )
    per_q = group_samples(_read(PILOT_LEDGER), questions, arm=IMAGE_ONLY, expected_k=args.k)
    r = pilot_summary(per_q, human)
    print(f"[pilot K={args.k}] {r['n']} calibration questions")
    print(f"  human-agreement (consistent): {r['agree']}/{r['consistent']} = "
          f"{r['agree'] / max(r['consistent'],1):.1%}  <- tune K to maximize")
    print(f"  above-chance FITB vs Polyvore answer: {r['correct_vs_polyvore']}/{r['consistent']} = "
          f"{r['correct_vs_polyvore'] / max(r['consistent'],1):.1%} (chance 25%)")
    print(f"  position-flip / inconsistent: {r['inconsistent']}/{r['n']} = "
          f"{r['inconsistent'] / max(r['n'],1):.1%} | dropped: {r['dropped']}")
    print("  -> pick the K with the best human-agreement + acceptable flip rate, then freeze judge_addendum.md.")


def pilot_summary(per_question, human: dict[str, int]) -> dict:
    """Pure: collapse the pilot's per-question judge verdicts into its BLIND report counts. Agreement is
    judge-vs-`human` (the panel's consensus forced-choice label — the §F judge-selection target), and is kept
    strictly separate from `correct_vs_polyvore` (judge-vs-the-Polyvore-answer, the above-chance check).
    Tuning K to the human label is the ONLY blind path; tuning to the Polyvore answer would re-import the
    co-occurrence memorization confound (§1/§8/§F) — so this split is load-bearing, hence its own tested
    helper. Neither count is a trained-head number (blindness preserved)."""
    agree = consistent = inconsistent = dropped = correct_vs_polyvore = 0
    for s in per_question:
        v = verdict_for(s)
        if v.status == "dropped":
            dropped += 1
            continue
        if v.status == "inconsistent":
            inconsistent += 1
            continue
        consistent += 1
        if v.forward_verdict == human[s.question_id]:     # judge-vs-panel-consensus label (the selection target)
            agree += 1
        if v.forward_verdict == s.correct_index:          # judge-vs-Polyvore answer (above-chance only)
            correct_vs_polyvore += 1
    return {"n": len(list(per_question)), "agree": agree, "consistent": consistent,
            "inconsistent": inconsistent, "dropped": dropped, "correct_vs_polyvore": correct_vs_polyvore}


def cmd_gate_b(args) -> None:
    """Run the frozen-envelope judge over the first N gate-B test questions (image-only) -> the committed
    judge_runs.ndjson, then report the above-chance FITB + position-flip rate (the §8 scale-up signal).

    This step scores held-out TEST questions and its number could retro-influence the judge freeze, so it
    is gated by the SAME build-order teeth `emit` uses (§1 "enforced by build order, not honor system"):
    `judge_addendum.md` must be schema-valid **frozen:true** AND committed-clean, and the whole determinism
    envelope (K, snapshot, max_tokens, retry_budget) is read FROM the frozen addendum — never a CLI default
    that could silently diverge from what `emit` binds (§8 dated-snapshot rule). The gate-B question prefix
    is drift-checked against the frozen `fitb_order.json` BEFORE any token is spent."""
    env = require_frozen_envelope()
    k = env["k_samples"]
    snapshot = env["model_snapshot"]
    max_tokens = env["max_tokens"]
    retry_budget = env["retry_budget"]
    corpus = load_headline_corpus(verbose=False)
    order = load_json_strict(os.path.join(ROOT_DIR, "fitb_order.json"))
    if not 1 <= args.n <= order["gate_b_cap"]:
        raise SystemExit(f"--n {args.n} must be in [1, {order['gate_b_cap']}]")
    from fitb_order import verify_fitb_order

    verify_fitb_order(order, corpus)                  # fail loud on constructor/corpus/seed drift BEFORE spend
    questions, _ = build_fitb(corpus.splits["test"], corpus.item_index, SEED)
    gate_b = questions[:args.n]
    if [q.set_id for q in gate_b] != order["gate_b_set_ids"][:args.n]:
        raise SystemExit(                             # bind the SCORED prefix to the frozen order explicitly
            "gate-B prefix set_ids do not match fitb_order.json['gate_b_set_ids'] — run_judge.SEED has "
            "drifted from the frozen order's seed; the judge would score the wrong questions (§12 tripwire)"
        )
    if os.path.exists(GATE_B_LEDGER):
        os.remove(GATE_B_LEDGER)                      # regenerate the full prefix (idempotent + no dupes)
    provider = _provider(gate_b)
    client = OpenAIJudgeClient(snapshot)
    run_arm(
        gate_b, arm=IMAGE_ONLY, client=client, provider=provider, k_samples=k,
        max_tokens=max_tokens, retry_budget=retry_budget, model_snapshot=snapshot,
        ledger_path=GATE_B_LEDGER, payload_dir=RAW_PAYLOADS,
    )
    per_q = group_samples(_read(GATE_B_LEDGER), gate_b, arm=IMAGE_ONLY, expected_k=k)
    r = gate_b_summary(per_q)
    print(f"[gate-b N={args.n}] judge FITB vs Polyvore answer (consistent): {r['correct']}/{r['consistent']} = "
          f"{r['correct'] / max(r['consistent'],1):.1%} (chance 25% — the above-chance check)")
    print(f"  position-flip/inconsistent: {r['inconsistent']}/{r['n']} | dropped: {r['dropped']}")
    print("  -> if clearly above chance and the eventual gate-B CI half-width <= delta, this N is enough; else extend.")


def gate_b_summary(per_question) -> dict:
    """Pure: the gate-b scale-up readout — the judge's above-chance FITB (judge-vs-Polyvore-answer over the
    consistent, non-dropped questions) + the position-flip/drop counts (§8). This is the judge's OWN number
    (never the trained head's), reported post-freeze to decide whether N is enough."""
    correct = consistent = inconsistent = dropped = 0
    for s in per_question:
        v = verdict_for(s)
        if v.status == "dropped":
            dropped += 1
        elif v.status == "inconsistent":
            inconsistent += 1
        else:
            consistent += 1
            correct += int(v.forward_verdict == s.correct_index)
    return {"n": len(list(per_question)), "correct": correct, "consistent": consistent,
            "inconsistent": inconsistent, "dropped": dropped}


def cmd_emit(args) -> None:
    """The gated four-file unlock -> metrics.json (RUN). Delegates to evaluate.materialize_metrics_json,
    which binds the sealed selection, enforces the headline arm + calibration disjointness, and refuses
    unless all four unlock files are committed + valid."""
    from evaluate import materialize_metrics_json

    metrics = materialize_metrics_json(arm=IMAGE_ONLY, ledger_path=GATE_B_LEDGER, gate_b_n=args.n)
    print(f"[emit] metrics.json written (stage {metrics['_meta']['stage']}). Gate-application verdict is C6.")


def _read(path: str) -> list[dict]:
    from gpt_judge import read_ledger

    return read_ledger(path)


def require_frozen_envelope(*, root_dir: str = ROOT_DIR, git=None) -> dict:
    """Return the judge determinism envelope ONLY if `judge_addendum.md` is genuinely committed-frozen —
    the gate-B build-order teeth (§1). Mirrors `evaluate.validate_unlock_files`' addendum checks so a
    gate-B run can't score held-out test questions off a scaffold / half-filled / uncommitted addendum
    (which would let the judge freeze be tuned against a gated number): the envelope must schema-validate
    (`frozen:true` + non-placeholder hashes are schema consts) AND the file must be committed-clean. Raises
    `SystemExit` with an actionable message on any failure."""
    from evaluate import (
        JUDGE_ADDENDUM_SCHEMA,
        RealGit,
        UnlockError,
        _read_text,
        _validate_against_schema,
        extract_envelope,
    )

    path = os.path.join(root_dir, "judge_addendum.md")
    try:
        env = extract_envelope(_read_text(path))
        _validate_against_schema(env, os.path.join(root_dir, JUDGE_ADDENDUM_SCHEMA), what="judge_addendum.md envelope")
    except UnlockError as e:
        raise SystemExit(
            f"judge_addendum.md is not a valid FROZEN envelope ({e}) — freeze it (frozen:true + real "
            f"hashes) from the calibration pilot BEFORE the gate-B run (§1 blindness order)"
        ) from e
    git = git or RealGit(root_dir)
    if not git.identity(path).committed:
        raise SystemExit(
            "judge_addendum.md is not committed-clean — commit the frozen addendum BEFORE the gate-B run "
            "so the judge freeze provably precedes any held-out-test judge number (§1 build-order teeth)"
        )
    return env


def main() -> None:
    p = argparse.ArgumentParser(description="H26 live judge runner (Step 4).")
    sub = p.add_subparsers(dest="cmd", required=True)
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--snapshot", default=None, help="dated gpt-5.4-mini snapshot (default gpt-5.4-mini-2026-03-17)")
    common.add_argument("--max-tokens", type=int, default=DEFAULT_MAX_TOKENS, dest="max_tokens")
    common.add_argument("--retry-budget", type=int, default=DEFAULT_RETRY_BUDGET, dest="retry_budget")
    pp = sub.add_parser("pilot", parents=[common], help="tune K against your calibration labels")
    pp.add_argument("--k", type=int, required=True)
    pp.set_defaults(func=cmd_pilot)
    # gate-b reads snapshot/K/max_tokens/retry_budget FROM the frozen addendum (no CLI overrides, so it
    # cannot silently diverge from what emit binds — §8 dated-snapshot rule / §1 build-order teeth).
    pg = sub.add_parser("gate-b", help="frozen-envelope judge over the gate-B prefix (envelope read from judge_addendum.md)")
    pg.add_argument("--n", type=int, required=True)
    pg.set_defaults(func=cmd_gate_b)
    pe = sub.add_parser("emit", help="the four-file unlock -> metrics.json")
    pe.add_argument("--n", type=int, required=True)
    pe.set_defaults(func=cmd_emit)
    args = p.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
