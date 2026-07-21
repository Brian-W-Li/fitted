"""The pre-registered gate-B POWER EXTENSION — a follow-up measurement, not a rewrite of H26.

H26's frozen verdict stands as recorded: NO-GO by the letter, because gate B read "underpowered /
inconclusive" at the frozen N = 500 cap (`fitb_manifest.json` allocation.gate_B: *"if N caps at 500
and half_width > 0.05, gate B = underpowered -> no-go"* — applied verbatim; miss-convention
half-width 0.050302 > delta by +0.000302 while the CI sat wholly above +delta). `results.md` §10
pre-identified the extension lever: *"a larger judged question budget shrinks the 0.0003 half-width
overshoot — the cap was a cost choice, not a data limit; 13,395 frozen-ordered questions remain
unjudged."* This module IS that lever, run with the same freeze discipline the original had:

  - **Nothing frozen is edited.** `fitb_manifest.json`, `fitb_order.json`, `judge_runs.ndjson`,
    `metrics.json` stay byte-identical (their sha binds keep holding). The extension judges
    questions [500:N_ext] of the SAME C3-frozen full order (`order_sha256` proves it is a longer
    prefix, never a re-selection) into a SEPARATE ledger (`judge_runs_extension.ndjson`), and its
    analysis lands in a SEPARATE `metrics_extension.json`.
  - **One-shot, frozen before spend.** `gate_b_extension.json` freezes N_ext + the extension
    question ids + the input shas BEFORE any new token; `run` refuses unless that file AND the
    original judge addendum are frozen:true + committed-clean (the same build-order teeth
    `run_judge.cmd_gate_b` has). No second extension without a new dated freeze file.
  - **Optional-stopping disclosure (recorded in the freeze file):** the extension is decided AFTER
    seeing the N=500 result, so the extended read is a *sequential* estimate, not the original
    single-look pre-registration. It is honest because (a) the extension was pre-identified in the
    frozen results as the power lever, (b) N_ext is fixed once, in advance, by power math — never
    "extend until it passes", and (c) the N=500 record is preserved verbatim; `metrics_extension.json`
    is reported alongside it, feeding the M6 entry condition (Spec §20 / results.md §10) — it never
    overwrites the frozen H26 verdict.
  - **Resume-safe append.** The extension ledger is append-only; a question is complete iff both
    orders carry the frozen K distinct sample_index rows (`group_samples` keep-last dedup makes a
    partial re-run idempotent). A crash/interrupt costs nothing: re-run the same command and it
    skips every complete question before constructing the API client.

SETUP (done in the tooling session, committed BEFORE any spend):

    .venv/bin/python gate_b_extension.py freeze --n 1000 --date 2026-07-21   # materialize gate_b_extension.json
    git add gate_b_extension.json && git commit                             # `run` refuses until committed

RUN SEQUENCE (Brian's terminal — `OPENAI_API_KEY` in the shell, ~$2, ~1-3 h, resume-safe):

    .venv/bin/python gate_b_extension.py run          # judge questions [500:N_ext]; rerun to resume
    git add judge_runs_extension.ndjson && git commit # bind the paid rows (analyze refuses otherwise)
    .venv/bin/python gate_b_extension.py analyze      # no spend; writes metrics_extension.json + verdict

Reference: docs/plans/h26-compatibility-spike-v2.md §8/§12; results.md §2/§10.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os

from data_loader import FitbQuestion, build_fitb, load_headline_corpus, load_json_strict
from fitb_order import _order_sha256, verify_fitb_order
from gpt_judge import group_samples, read_ledger, run_arm
from run_judge import IMAGE_ONLY, SEED, _provider, gate_b_summary, require_frozen_envelope

ROOT_DIR = os.path.dirname(__file__)
EXT_FREEZE = "gate_b_extension.json"
EXT_LEDGER = "judge_runs_extension.ndjson"           # committed after the run (separate from the frozen 500)
ORIGINAL_LEDGER = "judge_runs.ndjson"                # frozen — never appended to, never deleted
METRICS_EXT = "metrics_extension.json"
N_ORIGINAL = 500                                     # the frozen gate_b_cap (fitb_manifest.json)


def _file_sha256(path: str) -> str:
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


# --------------------------------------------------------------------------- #
# Freeze materialization (pure core + the I/O wrapper) — run ONCE, committed before any spend
# --------------------------------------------------------------------------- #
def build_extension_freeze(
    questions: list[FitbQuestion], order: dict, *, n_ext: int, binds: dict, frozen_date: str
) -> dict:
    """Assemble the extension freeze dict from the already-verified frozen order. Pure — the CLI
    wrapper supplies the corpus-built `questions`, the loaded `fitb_order.json`, and the input-sha
    `binds`. Carries NO model number (the same §1 discipline as `fitb_order.json`): question ids +
    hashes only; the power rationale cites the frozen H26 record, not a new metric."""
    if not N_ORIGINAL < n_ext <= order["n_questions_full"]:
        raise ValueError(
            f"n_ext {n_ext} must be in ({N_ORIGINAL}, {order['n_questions_full']}] — a longer prefix "
            f"of the frozen order (the first {N_ORIGINAL} are already judged in {ORIGINAL_LEDGER})"
        )
    if [q.set_id for q in questions[:N_ORIGINAL]] != order["gate_b_set_ids"]:
        raise ValueError(
            "the rebuilt question order's first 500 set_ids do not match the frozen "
            "fitb_order.json['gate_b_set_ids'] — constructor/seed drift; refusing to freeze an "
            "extension of the wrong order"
        )
    return {
        "_README": (
            "Pre-registered gate-B POWER EXTENSION freeze (results.md §10 lever). The extension set "
            f"is questions [{N_ORIGINAL}:{n_ext}] of the SAME C3-frozen full order fitb_order.json "
            "binds (order_sha256 unchanged — a longer prefix, never a re-selection). ONE-SHOT: n_ext "
            "is fixed here, in advance, by power math; no further extension without a NEW dated "
            "freeze file. Judged into judge_runs_extension.ndjson under the SAME frozen judge "
            "envelope (judge_addendum.md — K/snapshot/max_tokens/conventions unchanged); analyzed by "
            "gate_b_extension.py analyze into metrics_extension.json with the SAME frozen letter "
            "(preregistration.json gates.B: CI_low >= -delta AND half_width <= delta, "
            "inconsistent=miss adjudicating). The frozen H26 N=500 verdict (NO-GO, underpowered by "
            "+0.000302) is NEVER rewritten — this is the sequential follow-up read feeding the M6 "
            "entry condition (Spec §20). Optional-stopping disclosure: the extension was decided "
            "after the N=500 result was known; it is reported as a sequential estimate alongside "
            "the frozen single-look record, never in place of it."
        ),
        "spike": "h26",
        "stage": "EXT",
        "frozen": True,
        "frozen_date": frozen_date,
        "seed": order["seed"],
        "n_original": N_ORIGINAL,
        "n_ext": n_ext,
        "power_rationale": (
            f"frozen miss-convention half-width 0.050302 at N=500 (metrics.json); half-width scales "
            f"~1/sqrt(N), so N_ext={n_ext} projects ~{0.050302 * (N_ORIGINAL / n_ext) ** 0.5:.4f} "
            f"vs delta 0.05. STRESS ANCHOR (chosen once, by power math, never 'extend until it passes'): "
            f"the projection survives a 25% half-width inflation for higher new-question variance — "
            f"~{0.050302 * (N_ORIGINAL / n_ext) ** 0.5 * 1.25:.4f} still <= 0.05 — so N_ext is decisively "
            f"powered under a conservative stress, not creeping to the boundary (same construction, same "
            f"frozen seeded order, exchangeable draw). Location is not at risk: the N=500 point estimate is "
            f"+0.27, ~32 points above the -delta boundary, so only the WIDTH (power) is in play."
        ),
        "binds": binds,
        "extension_prefix_sha256": _order_sha256(questions[:n_ext]),
        "extension_new_set_ids": [q.set_id for q in questions[N_ORIGINAL:n_ext]],
    }


def cmd_freeze(args) -> None:
    """Materialize + write `gate_b_extension.json` (one-shot: refuses if it already exists). Binds
    the frozen inputs by sha — including the original committed ledger, asserted equal to the sha
    `metrics.json` recorded, so the extension provably extends the exact paid run it claims to."""
    path = os.path.join(ROOT_DIR, EXT_FREEZE)
    if os.path.exists(path):
        raise SystemExit(
            f"{EXT_FREEZE} already exists — the extension freeze is ONE-SHOT. A new extension needs "
            f"a deliberate new dated freeze (delete/rename the old file only as an explicit decision)."
        )
    corpus = load_headline_corpus(verbose=False)
    order = load_json_strict(os.path.join(ROOT_DIR, "fitb_order.json"))
    verify_fitb_order(order, corpus)                  # the frozen order still reproduces bit-for-bit
    questions, _ = build_fitb(corpus.splits["test"], corpus.item_index, SEED)
    original_ledger_sha = _file_sha256(os.path.join(ROOT_DIR, ORIGINAL_LEDGER))
    recorded = load_json_strict(os.path.join(ROOT_DIR, "metrics.json"))["_meta"]["judge_ledger_sha256"]
    if original_ledger_sha != recorded:
        raise SystemExit(
            f"{ORIGINAL_LEDGER} sha {original_ledger_sha[:12]}… != metrics.json._meta.judge_ledger_"
            f"sha256 {recorded[:12]}… — the frozen ledger has drifted; refusing to freeze an "
            f"extension against unverified paid rows"
        )
    selection = load_json_strict(os.path.join(ROOT_DIR, "selection.json"))
    binds = {
        "fitb_order_file_sha256": _file_sha256(os.path.join(ROOT_DIR, "fitb_order.json")),
        "full_order_sha256": order["order_sha256"],
        "judge_addendum_file_sha256": _file_sha256(os.path.join(ROOT_DIR, "judge_addendum.md")),
        "original_ledger_sha256": original_ledger_sha,
        "selection_checkpoint_sha256": selection["checkpoint_sha256"],
    }
    freeze = build_extension_freeze(questions, order, n_ext=args.n, binds=binds, frozen_date=args.date)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(freeze, f, indent=1)
    print(f"[ext] wrote {path} (n_ext={args.n}, {args.n - N_ORIGINAL} new questions)")
    print(f"[ext] extension_prefix_sha256={freeze['extension_prefix_sha256']}")
    print("[ext] COMMIT this file — `run` refuses until it is committed-clean (build-order teeth).")


# --------------------------------------------------------------------------- #
# Teeth + binds (shared by run/analyze) — all checks fire BEFORE any token is spent
# --------------------------------------------------------------------------- #
def require_extension_freeze(*, root_dir: str = ROOT_DIR, git=None) -> dict:
    """Return the extension freeze ONLY if `gate_b_extension.json` is frozen:true, committed-clean,
    and its input binds still match the frozen files on disk — the same build-order teeth
    `require_frozen_envelope` gives the judge addendum. Raises SystemExit with an actionable
    message on any failure."""
    from evaluate import RealGit

    path = os.path.join(root_dir, EXT_FREEZE)
    if not os.path.exists(path):
        raise SystemExit(f"{EXT_FREEZE} not found — run `gate_b_extension.py freeze --n <N>` and commit it first")
    ext = load_json_strict(path)
    if ext.get("frozen") is not True:
        raise SystemExit(f"{EXT_FREEZE} is not frozen:true — the extension must be frozen before any spend")
    git = git or RealGit(root_dir)
    if not git.identity(path).committed:
        raise SystemExit(
            f"{EXT_FREEZE} is not committed-clean — commit the freeze BEFORE the run so the extension "
            f"target provably precedes the new judge numbers (build-order teeth)"
        )
    for fname, key in (("fitb_order.json", "fitb_order_file_sha256"),
                       ("judge_addendum.md", "judge_addendum_file_sha256"),
                       (ORIGINAL_LEDGER, "original_ledger_sha256")):
        got = _file_sha256(os.path.join(root_dir, fname))
        if got != ext["binds"][key]:
            raise SystemExit(
                f"{fname} sha {got[:12]}… != the extension freeze's bind {ext['binds'][key][:12]}… — "
                f"a frozen input drifted after the extension froze; refusing"
            )
    return ext


def bind_extension_questions(ext: dict, order: dict, questions: list[FitbQuestion]) -> list[FitbQuestion]:
    """Assert the rebuilt order still IS the frozen order the extension froze against — the original
    500-prefix ids, the extension ids, and the full extension-prefix content hash — then return the
    extension slice [N_ORIGINAL:n_ext]. Fails loud BEFORE any spend (the §12 tripwire pattern)."""
    n_ext = ext["n_ext"]
    if [q.set_id for q in questions[:N_ORIGINAL]] != order["gate_b_set_ids"]:
        raise SystemExit("rebuilt order's first 500 set_ids drifted from fitb_order.json — refusing (§12 tripwire)")
    if [q.set_id for q in questions[N_ORIGINAL:n_ext]] != ext["extension_new_set_ids"]:
        raise SystemExit(
            f"rebuilt order's [{N_ORIGINAL}:{n_ext}] set_ids do not match {EXT_FREEZE}'s frozen "
            f"extension_new_set_ids — the judge would score the wrong questions; refusing"
        )
    if _order_sha256(questions[:n_ext]) != ext["extension_prefix_sha256"]:
        raise SystemExit(f"extension prefix content hash drifted from {EXT_FREEZE} — refusing (§12 tripwire)")
    return questions[N_ORIGINAL:n_ext]


# --------------------------------------------------------------------------- #
# Resume planning (pure) — a complete question is never re-paid, an incomplete one always re-runs
# --------------------------------------------------------------------------- #
def plan_resume(
    ledger_rows: list[dict], ext_questions: list[FitbQuestion], *, k_samples: int, arm: str = IMAGE_ONLY
) -> tuple[list[FitbQuestion], list[FitbQuestion]]:
    """Split the extension questions into (done, todo) against the append-only extension ledger. A
    question is DONE iff both orders carry exactly the frozen K distinct sample_index rows after
    keep-last dedup (`group_samples`' completeness rule — a dropped sample is a final outcome and
    counts; a missing order / short K means a crashed write and the question re-runs whole, which
    the keep-last dedup makes idempotent). Rows for a question outside the extension set fail loud
    — a foreign/corrupt ledger must never be silently extended."""
    ext_ids = {q.set_id for q in ext_questions}
    by_q: dict[str, dict[str, set[int]]] = {}
    for row in ledger_rows:
        if row["arm"] != arm:
            continue
        if row["question_id"] not in ext_ids:
            raise ValueError(
                f"{EXT_LEDGER} carries rows for question {row['question_id']!r} outside the frozen "
                f"extension set — foreign/corrupt ledger; refusing to extend it"
            )
        by_q.setdefault(row["question_id"], {"forward": set(), "reverse": set()})[row["order"]].add(row["sample_index"])
    want = set(range(k_samples))
    done, todo = [], []
    for q in ext_questions:
        rec = by_q.get(q.set_id)
        (done if rec is not None and rec["forward"] == want and rec["reverse"] == want else todo).append(q)
    return done, todo


def assert_choice_ranges(ledger_rows: list[dict], questions: list[FitbQuestion], *, arm: str = IMAGE_ONLY) -> None:
    """Fail loud on any cached row whose non-null `choice` is out of `[0, n_candidates)` for its question
    (§23-H56 hardening note 2). Live writes are already safe — `parse_choice` rejects out-of-range at
    write time — so this guards a *corrupt/hand-edited* cached ledger row: `assert_scalar_only` checks
    only int/null, and `collapse_question`'s reverse remap (`n-1-c`) would otherwise turn an out-of-range
    `choice` into a silent miss (a negative canonical index, never a fail). Rows for a `question_id` not
    among `questions` are left to the membership guards (`plan_resume` on the extension ledger; the frozen
    original's sha bind on the frozen 500) — this helper judges RANGE only, for questions it knows."""
    n_by_id = {q.set_id: len(q.candidates) for q in questions}
    for row in ledger_rows:
        if row["arm"] != arm:
            continue
        n = n_by_id.get(row["question_id"])
        c = row["choice"]
        if n is not None and c is not None and not (0 <= c < n):
            raise ValueError(
                f"cached judge row for question {row['question_id']!r} carries choice {c} out of range "
                f"[0, {n}) — a corrupt/hand-edited ledger; refusing (it would silently count as a miss)"
            )


# --------------------------------------------------------------------------- #
# run — the paid half (resume-safe; teeth fire before the client exists)
# --------------------------------------------------------------------------- #
def cmd_run(args) -> None:
    """Judge the extension questions under the frozen envelope, appending to the extension ledger.
    All teeth + binds fire before the OpenAI client is constructed; every complete question is
    skipped, so re-running after an interrupt costs only the incomplete remainder."""
    env = require_frozen_envelope(root_dir=ROOT_DIR)                 # the original addendum teeth
    ext = require_extension_freeze(root_dir=ROOT_DIR)                # the extension freeze teeth
    k, snapshot = env["k_samples"], env["model_snapshot"]
    corpus = load_headline_corpus(verbose=False)
    order = load_json_strict(os.path.join(ROOT_DIR, "fitb_order.json"))
    verify_fitb_order(order, corpus)
    questions, _ = build_fitb(corpus.splits["test"], corpus.item_index, SEED)
    ext_questions = bind_extension_questions(ext, order, questions)

    ledger_path = os.path.join(ROOT_DIR, EXT_LEDGER)
    rows = read_ledger(ledger_path) if os.path.exists(ledger_path) else []
    for row in rows:
        if row["arm"] != IMAGE_ONLY:
            raise SystemExit(
                f"{EXT_LEDGER} carries a row for arm {row['arm']!r} != the headline {IMAGE_ONLY!r} — the "
                f"extension judges the image-only arm only; foreign ledger, refusing"
            )
        if row["model_snapshot"] != snapshot:
            raise SystemExit(
                f"{EXT_LEDGER} carries rows from snapshot {row['model_snapshot']!r} != the frozen "
                f"{snapshot!r} — foreign ledger; refusing"
            )
    assert_choice_ranges(rows, ext_questions)         # corrupt cached choice fails loud BEFORE any spend
    done, todo = plan_resume(rows, ext_questions, k_samples=k)
    print(f"[ext run] {len(ext_questions)} extension questions: {len(done)} already complete, {len(todo)} to judge "
          f"(K={k}, both orders — ~{len(todo) * 2 * k} calls). Resume-safe: interrupt + rerun any time.")
    if not todo:
        print(f"[ext run] nothing to do — {EXT_LEDGER} is complete. Commit it, then `analyze`.")
        return

    from gpt_judge import OpenAIJudgeClient  # constructed only after every gate passed

    provider = _provider(todo)
    client = OpenAIJudgeClient(snapshot)
    for i, q in enumerate(todo, start=1):
        run_arm(
            [q], arm=IMAGE_ONLY, client=client, provider=provider, k_samples=k,
            max_tokens=env["max_tokens"], retry_budget=env["retry_budget"], model_snapshot=snapshot,
            ledger_path=ledger_path, payload_dir=os.path.join(ROOT_DIR, "raw_payloads"),
        )
        if i % 10 == 0 or i == len(todo):
            print(f"[ext run] {len(done) + i}/{len(ext_questions)} questions complete")
    per_q = group_samples(read_ledger(ledger_path), ext_questions, arm=IMAGE_ONLY, expected_k=k)
    r = gate_b_summary(per_q)
    print(f"[ext run] extension judge readout (judge-only, §8 style): "
          f"{r['correct']}/{r['consistent']} consistent-correct, {r['inconsistent']} inconsistent, {r['dropped']} dropped")
    print(f"[ext run] DONE. Commit {EXT_LEDGER}, then run `gate_b_extension.py analyze`.")


# --------------------------------------------------------------------------- #
# analyze — the free half: frozen letter over the combined N_ext prefix -> metrics_extension.json
# --------------------------------------------------------------------------- #
def extension_letter(ci: dict, delta: float) -> dict:
    """The frozen gate-B letter applied to one convention's paired-diff CI — a VERBATIM mirror of
    `evaluate.apply_gates`' inner `b_leg` (which is function-local and can't be imported; the
    equality is pinned by test_gate_b_extension against the frozen metrics.json record, per the
    mirror-needs-a-test rule): half_width = (high-low)/2; non-inferior iff low >= -delta; powered
    iff half_width <= delta; state = underpowered/inconclusive unless powered, else pass/fail."""
    hw = (ci["high"] - ci["low"]) / 2.0
    non_inf = ci["low"] >= -delta
    powered = hw <= delta
    state = ("underpowered / inconclusive" if not powered else "pass" if non_inf else "fail")
    return {"ci": ci, "half_width": hw, "non_inferiority": non_inf, "powered": powered, "state": state}


def _ci_dict(ci) -> dict:
    return {"point": ci.point, "low": ci.low, "high": ci.high, "b": ci.b}


def cmd_analyze(args) -> None:
    """Score the trained head + the combined (frozen 500 + extension) judge ledger over the first
    n_ext questions of the frozen order and apply the frozen gate-B letter -> metrics_extension.json.
    No spend. Loads the sealed checkpoint from disk and verifies its content sha against
    selection.json (the same bind `materialize_metrics_json` enforces, without the hours-long
    re-derivation). Both ledgers must be committed-clean so the emitted shas bind real bytes."""
    import torch

    from embed import HEADLINE, load_cache
    from evaluate import assert_ledger_committed, compute_gate_b, head_edge_scorer
    from train_head import PairwiseEdgeHead, checkpoint_sha256

    env = require_frozen_envelope(root_dir=ROOT_DIR)
    ext = require_extension_freeze(root_dir=ROOT_DIR)
    k, snapshot = env["k_samples"], env["model_snapshot"]
    n_ext = ext["n_ext"]

    original_sha = assert_ledger_committed(ROOT_DIR, os.path.join(ROOT_DIR, ORIGINAL_LEDGER))
    ext_sha = assert_ledger_committed(ROOT_DIR, os.path.join(ROOT_DIR, EXT_LEDGER))

    corpus = load_headline_corpus(verbose=False)
    order = load_json_strict(os.path.join(ROOT_DIR, "fitb_order.json"))
    verify_fitb_order(order, corpus)
    questions, _ = build_fitb(corpus.splits["test"], corpus.item_index, SEED)
    ext_questions = bind_extension_questions(ext, order, questions)   # analyze scores the full prefix

    # The extension ledger must carry EXACTLY the frozen extension set, complete — before the combined
    # read. `plan_resume` fails loud on any row outside the frozen [500:n_ext] set (a foreign/corrupt row
    # carrying a first-500 question_id would otherwise keep-last OVERRIDE the frozen judge verdicts in the
    # concatenated read — the "frozen verdict rewritten" failure this whole design exists to prevent) and,
    # requiring `todo == []`, that every extension question is present at the frozen K in both orders.
    ext_rows = read_ledger(os.path.join(ROOT_DIR, EXT_LEDGER))
    _, todo = plan_resume(ext_rows, ext_questions, k_samples=k)
    if todo:
        raise SystemExit(
            f"{EXT_LEDGER} is incomplete — {len(todo)} of {len(ext_questions)} extension questions are "
            f"not judged at the frozen K={k} in both orders; run `gate_b_extension.py run` to finish, "
            f"commit, then analyze"
        )

    selection = load_json_strict(os.path.join(ROOT_DIR, "selection.json"))
    if selection["checkpoint_sha256"] != ext["binds"]["selection_checkpoint_sha256"]:
        raise SystemExit(
            f"selection.json checkpoint sha {selection['checkpoint_sha256'][:12]}… != the extension "
            f"freeze's bind {ext['binds']['selection_checkpoint_sha256'][:12]}… — the sealed selection "
            f"drifted after the extension froze; refusing to score a different head than the one bound"
        )
    tc = selection["training_config"]
    ckpt = os.path.join(ROOT_DIR, "checkpoints", f"pairwise_edge_{tc['config_id']}_seed{tc['seed']}.pt")
    if not os.path.exists(ckpt):
        raise SystemExit(
            f"{ckpt} not found — checkpoints are gitignored (regenerable from the seed); re-derive "
            f"via train_head.run before analyzing"
        )
    state = torch.load(ckpt, map_location="cpu", weights_only=True)
    if checkpoint_sha256(state) != selection["checkpoint_sha256"]:
        raise SystemExit(
            "on-disk pairwise checkpoint sha != the sealed selection.json sha — re-derive the heads "
            "(train_head.run, deterministic from the seed) and retry; refusing to score an "
            "unverified head"
        )
    head = PairwiseEdgeHead()
    head.load_state_dict(state)
    edge_score = head_edge_scorer(head, load_cache(HEADLINE), corpus.item_index)

    rows = read_ledger(os.path.join(ROOT_DIR, ORIGINAL_LEDGER)) + ext_rows
    assert_choice_ranges(rows, questions[:n_ext])     # corrupt cached choice fails loud before scoring
    print(f"[ext analyze] scoring N={n_ext} (frozen 500 + {n_ext - N_ORIGINAL} extension) — "
          f"B=10,000 two-stage bootstraps, a few minutes")
    gb = compute_gate_b(
        questions[:n_ext], edge_score, rows, arm=IMAGE_ONLY, seed=SEED, b=10_000,
        expected_k=k, expected_snapshot=snapshot,
    )
    delta = load_json_strict(os.path.join(ROOT_DIR, "preregistration.json"))["gates"]["B"]["delta"]
    miss = extension_letter(_ci_dict(gb.gate_B_diff_inconsistent_miss), delta)
    half = extension_letter(_ci_dict(gb.gate_B_diff_inconsistent_half), delta)

    out = {
        "_README": (
            "Gate-B POWER-EXTENSION read at the pre-frozen N_ext (gate_b_extension.json) — the "
            "results.md §10 power lever, feeding the M6 entry condition (Spec §20). A sequential "
            "follow-up estimate reported ALONGSIDE the frozen single-look metrics.json record "
            "(optional-stopping disclosure in the freeze file); it never rewrites the frozen H26 "
            "N=500 verdict. Letter applied verbatim from preregistration.json gates.B "
            "(inconsistent=miss adjudicates; the half convention is the conservative cross-check). "
            "This re-run INHERITS the sealed verdict letter (verdict = A AND B AND D; "
            "underpowered_is_no_go = true) — it does NOT re-litigate the prereg (§23-H56 note 1): if "
            "`judge_above_chance` is false at N_ext the B-read is vacuous and, per the frozen letter, "
            "the underpowered corner still adjudicates NO-GO; the GO decision would rest on A AND D."
        ),
        "spike": "h26",
        "stage": "EXT",
        "n_ext": n_ext,
        "n_kept": gb.n_kept,
        "n_dropped": gb.n_dropped,
        "delta": delta,
        "fitb_trained_gateB_ext": _ci_dict(gb.fitb_trained_gateB),
        "fitb_judge_gateB_ext": _ci_dict(gb.fitb_judge_gateB),
        "gate_B_diff_inconsistent_miss_ext": miss,
        "gate_B_diff_inconsistent_half_ext": half,
        "judge_above_chance": gb.fitb_judge_gateB.low > 0.25,   # the §B vacuity read at N_ext
        "conventions_agree": miss["state"] == half["state"],
        "_meta": {
            "emitted_by": "gate_b_extension.py analyze",
            "extension_freeze_sha256": _file_sha256(os.path.join(ROOT_DIR, EXT_FREEZE)),
            "original_ledger_sha256": original_sha,
            "extension_ledger_sha256": ext_sha,
            "judge_addendum_sha256": ext["binds"]["judge_addendum_file_sha256"],
            "checkpoint_sha256": selection["checkpoint_sha256"],
        },
    }
    path = os.path.join(ROOT_DIR, METRICS_EXT)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=1)
    print(f"[ext analyze] wrote {path}")
    print(f"[ext analyze] adjudicating (inconsistent=miss): diff {miss['ci']['point']:+.4f} "
          f"[{miss['ci']['low']:+.4f}, {miss['ci']['high']:+.4f}], half-width {miss['half_width']:.6f} "
          f"{'<=' if miss['powered'] else '>'} delta {delta} -> state: {miss['state'].upper()}")
    print(f"[ext analyze] cross-check (inconsistent=half): state {half['state'].upper()} "
          f"(conventions {'agree' if out['conventions_agree'] else 'DISAGREE — disclose'})")
    print(f"[ext analyze] judge above chance@4 at N_ext: {out['judge_above_chance']} "
          f"(CI_low {gb.fitb_judge_gateB.low:.4f} vs 0.25) — if false the B-read is vacuous and the "
          f"sealed letter's underpowered corner still adjudicates NO-GO (inherited, not re-litigated)")
    print("[ext analyze] Commit metrics_extension.json; fold the outcome into results.md §10 next session.")


def main() -> None:
    p = argparse.ArgumentParser(description="H26 gate-B power extension (pre-registered follow-up).")
    sub = p.add_subparsers(dest="cmd", required=True)
    pf = sub.add_parser("freeze", help="one-shot: materialize + write gate_b_extension.json (commit before run)")
    pf.add_argument("--n", type=int, required=True, help="N_ext — the extended prefix length over the frozen order")
    pf.add_argument("--date", required=True, help="freeze date, YYYY-MM-DD (recorded verbatim)")
    pf.set_defaults(func=cmd_freeze)
    pr = sub.add_parser("run", help="judge the extension questions (paid; resume-safe append)")
    pr.set_defaults(func=cmd_run)
    pa = sub.add_parser("analyze", help="frozen letter over the combined N_ext prefix -> metrics_extension.json")
    pa.set_defaults(func=cmd_analyze)
    args = p.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
