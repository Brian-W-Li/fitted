"""The eval driver — the metric-computation half (C3) + the C4 gated EMISSION half (§3/§6/§11/§12/§15).

The **computation half** (C3) turns a frozen embedding cache + a strict-disjoint corpus + a trained
head into the **in-memory** CI suite the gates read: it scores the §4 eval sets (`build_pairwise` /
`build_fitb` / `build_outfit_level`) with the trained pairwise head, its zero-shot cosine floor, and the
capacity-matched item-level ablation, then runs the `metrics.py` cluster-bootstrap CIs — the gate-A
added-value, gate-D outfit-AUC + FITB, the pinned pair-level seam diff (`AUC_catalog_pair −
AUC_pair_item_level`, §C.2), and the §C.6 popularity diagnostics — plus the co-occurrence leak-detector
assertion. It returns `MetricSuite` objects in memory and **never writes `metrics.json` or prints a
number**.

The **emission half** (C4, below) is the blindness gate's teeth (§1/§12). `emit_metrics` **refuses to
write any held-out test-set number** until all four unlock files
(`preregistration.md` + `preregistration.json` + `judge_addendum.md` + a schema-valid
`closet_manifest.json`) are committed and validate (`.md`/`.json` prereg agreement; the judge addendum's
determinism envelope schema-valid and **frozen**, not a scaffold; the closet manifest schema-valid +
the C4 referential checks), the sealed C3 `selection.json` binds the checkpoint, and their git blob
hashes / sha256s + the head commit are recorded into `metrics.json._meta`. Gate B's judge arm joins the
scalar `judge_runs.ndjson` ledger (`gpt_judge`) and the paired **two-stage** bootstrap (§11). Only then
does `metrics.json` first materialize the test-set trained-head + judge fields (closet/transfer stage to
C5; the gate-application verdict half is C6). Reference:
docs/plans/h26-compatibility-spike-v2.md §3 / §6 / §11 / §12 / §15 (artifact dataflow).
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Protocol

from baselines import (
    LeakCheck,
    cooccurrence_leak_check,
    cosine_edge_scorer,
    popularity_edge_scores,
    popularity_fitb_hits,
    popularity_outfit_scores,
)
from coherence import COHERENCE_RULE, fitb_question_is_coherent
from data_loader import (
    Corpus,
    Edge,
    FitbQuestion,
    Item,
    OutfitPair,
    build_fitb,
    build_outfit_level,
    build_pairwise,
    load_json_strict,
)
from embed import EmbeddingCache
from gpt_judge import (
    INCONSISTENT_HALF,
    INCONSISTENT_MISS,
    gate_b_verdicts,
    group_samples,
    judge_gate_b_hits,
    read_ledger,
    two_stage_paired_fitb_diff_ci,
)
from metrics import (
    CI,
    EdgeScore,
    auc_ci,
    fitb_candidate_scores,
    fitb_ci,
    fitb_hit,
    mean_edge_score,
    paired_auc_diff_ci,
)


# --------------------------------------------------------------------------- #
# Edge scoring (a trained head as an EdgeScore callable; the cosine floor lives in baselines)
# --------------------------------------------------------------------------- #
def head_edge_scorer(head, cache: EmbeddingCache, item_index: dict[str, Item]) -> EdgeScore:
    """Wrap a trained head (`PairwiseEdgeHead` or `ItemLevelHead`) into the `(i, j) -> float` callable
    `metrics.py` consumes, scoring over the frozen embeddings + the unordered type pair. The head is
    symmetric, so the per-pair score is memoized on the sorted pair (one forward per distinct edge —
    the FITB/outfit aggregations revisit edges). torch is imported lazily so the pure wiring below
    stays importable without it."""
    import torch

    from train_head import type_pair_index

    head.eval()
    memo: dict[tuple[str, str], float] = {}

    def edge(i: str, j: str) -> float:
        key = (i, j) if i <= j else (j, i)
        cached = memo.get(key)
        if cached is not None:
            return cached
        ei = torch.from_numpy(cache.vec(i)[None, :])
        ej = torch.from_numpy(cache.vec(j)[None, :])
        pair = torch.tensor([type_pair_index(item_index[i].type, item_index[j].type)])
        with torch.no_grad():
            val = float(head(ei, ej, pair).item())
        memo[key] = val
        return val

    return edge


# --------------------------------------------------------------------------- #
# Edge list -> aligned cluster scores (the §11 cluster units)
# --------------------------------------------------------------------------- #
def iter_pairwise_clusters(edges: Sequence[Edge]) -> list[tuple[Edge, Edge]]:
    """Pair `build_pairwise`'s strictly-interleaved `[pos, neg, pos, neg, …]` list into
    `(positive, negative)` clusters — the §11 pair-level bootstrap unit. Asserts the interleaving so a
    loader change that breaks it fails loud rather than silently mis-aligning the paired CIs."""
    if len(edges) % 2 != 0:
        raise ValueError(f"pairwise edges must be an even interleaved [pos, neg, …] list, got {len(edges)}")
    clusters = list(zip(edges[0::2], edges[1::2]))
    for pos, neg in clusters:
        if pos.label != 1 or neg.label != 0:
            raise ValueError("pairwise edges are not interleaved positive,negative (build_pairwise contract)")
    return clusters


def pairwise_pos_neg(edges: Sequence[Edge], edge_score: EdgeScore) -> tuple[list[float], list[float]]:
    """Aligned `(pos_scores, neg_scores)` over the pair clusters — `pos[k]`/`neg[k]` are the same
    cluster, so `auc_ci` / `paired_auc_diff_ci` resample at the (positive, negative) pair unit (§11)."""
    clusters = iter_pairwise_clusters(edges)
    pos = [edge_score(p.a, p.b) for p, _ in clusters]
    neg = [edge_score(n.a, n.b) for _, n in clusters]
    return pos, neg


def outfit_pos_neg(
    outfit_pairs: Sequence[OutfitPair], edge_score: EdgeScore
) -> tuple[list[float], list[float]]:
    """Aligned `(pos_scores, neg_scores)` for the gate-D outfit-level AUC: each outfit scored as the
    mean edge-compat over its edges (§6), positive vs its same-category-corrupted negative (§4).
    Cluster = the source outfit (§11)."""
    pos = [mean_edge_score(op.positive, edge_score) for op in outfit_pairs]
    neg = [mean_edge_score(op.negative, edge_score) for op in outfit_pairs]
    return pos, neg


def fitb_hits(questions: Sequence[FitbQuestion], edge_score: EdgeScore) -> list[float]:
    """Per-question FITB@4 credit: each candidate scored by mean edge-compat with the partial outfit,
    `fitb_hit` reads the argmax with the `1/k` tie rule (§3). Cluster = the question (§11)."""
    return [
        fitb_hit(fitb_candidate_scores(q.retained, q.candidates, edge_score), q.correct_index)
        for q in questions
    ]


# --------------------------------------------------------------------------- #
# The in-memory metric suite (NO emission — §1/§15)
# --------------------------------------------------------------------------- #
@dataclass(frozen=True)
class MetricSuite:
    """Every CI the gates + diagnostics read, computed in memory (NOT written to `metrics.json` —
    that unlocks at C4). Field names mirror `metrics.schema.json` so the C4 emission half maps them
    1:1. The valid-split selection metric is NOT here — it stayed sealed inside `train_head` (§1)."""

    # Gate A (added value) — pair-level
    AUC_catalog_pair: CI
    AUC_zero_shot_cosine: CI
    gate_A_diff: CI
    # Gate D (absolute floor) — outfit-level + full FITB
    outfit_auc: CI
    fitb_trained_full: CI
    # Baseline ladder readout
    fitb_zero_shot_cosine: CI
    # Seam ablation (§6/§C.2) — the pinned pair-level falsification metric + descriptive readouts
    AUC_pair_item_level: CI
    seam_diff_pairwise_minus_item_level: CI
    outfit_auc_item_level: CI
    fitb_item_level_full: CI
    # Popularity-confound diagnostics (§C.6) — AUC_pop_* trigger the confound label vs the 0.55
    # margin; fitb_popularity is REPORTED-only, read against the 0.25 chance floor (never a gate)
    AUC_pop_edge: CI
    AUC_pop_outfit: CI
    fitb_popularity: CI
    # Co-occurrence leak detector (§C.6 — must read chance)
    leak: LeakCheck


def compute_metric_suite(
    cache: EmbeddingCache,
    corpus: Corpus,
    pairwise_head,
    item_level_head,
    *,
    seed: int,
    split: str = "test",
    b: int = 10_000,
    assert_leak: bool = True,
    leak_outfit_tol: float = 1e-3,
) -> MetricSuite:
    """Wire the held-out `split` (default test) through the §4 constructions and compute every CI the
    A/D gates + the seam ablation + the popularity diagnostics need (gate B's judge arm is C4).

    Returns an in-memory `MetricSuite` — it does **not** write `metrics.json` or print a number (the
    §1 blindness boundary; the C4 unlock owns emission). `assert_leak=True` runs the co-occurrence
    leak-detector assertion (a pure check on the *negative sampler*, independent of the model — it
    holds for any correct §4 construction), failing loud if the negatives leaked a category signal."""
    split_data = corpus.splits[split]
    item_index = corpus.item_index

    edges, _ = build_pairwise(split_data, item_index, seed)
    questions, _ = build_fitb(split_data, item_index, seed)
    outfit_pairs, _ = build_outfit_level(split_data, item_index, seed)
    clusters = iter_pairwise_clusters(edges)

    trained = head_edge_scorer(pairwise_head, cache, item_index)
    item_level = head_edge_scorer(item_level_head, cache, item_index)
    cosine = cosine_edge_scorer(cache)

    # Pair-level (gate A + the seam diff)
    pos_tr, neg_tr = pairwise_pos_neg(edges, trained)
    pos_zs, neg_zs = pairwise_pos_neg(edges, cosine)
    pos_il, neg_il = pairwise_pos_neg(edges, item_level)
    auc_catalog = auc_ci(pos_tr, neg_tr, seed=seed, b=b)
    auc_zero_shot = auc_ci(pos_zs, neg_zs, seed=seed, b=b)
    gate_a = paired_auc_diff_ci(pos_tr, neg_tr, pos_zs, neg_zs, seed=seed, b=b)
    auc_item = auc_ci(pos_il, neg_il, seed=seed, b=b)
    seam = paired_auc_diff_ci(pos_tr, neg_tr, pos_il, neg_il, seed=seed, b=b)

    # Outfit-level (gate D + item-level descriptive)
    opos_tr, oneg_tr = outfit_pos_neg(outfit_pairs, trained)
    opos_il, oneg_il = outfit_pos_neg(outfit_pairs, item_level)
    outfit_auc = auc_ci(opos_tr, oneg_tr, seed=seed, b=b)
    outfit_auc_item = auc_ci(opos_il, oneg_il, seed=seed, b=b)

    # FITB (gate D full + cosine ladder readout + item-level descriptive)
    fitb_tr = fitb_ci(fitb_hits(questions, trained), seed=seed, b=b)
    fitb_zs = fitb_ci(fitb_hits(questions, cosine), seed=seed, b=b)
    fitb_il = fitb_ci(fitb_hits(questions, item_level), seed=seed, b=b)

    # Popularity-confound diagnostics (§C.6 — no embeddings). Edge/outfit AUC trigger the confound
    # label vs the 0.55 margin; the FITB most-popular-candidate accuracy is REPORTED-only (the
    # answer-selection shortcut the AUC forms miss), read against the 0.25 chance floor — never a gate.
    pop = split_data.popularity
    pe_pos, pe_neg = popularity_edge_scores(clusters, pop)
    po_pos, po_neg = popularity_outfit_scores(outfit_pairs, pop)
    auc_pop_edge = auc_ci(pe_pos, pe_neg, seed=seed, b=b)
    auc_pop_outfit = auc_ci(po_pos, po_neg, seed=seed, b=b)
    fitb_pop = fitb_ci(popularity_fitb_hits(questions, pop), seed=seed, b=b)

    # Leak detector (§C.6 — must read chance; a check on the negative sampler, not the model)
    leak = cooccurrence_leak_check(split_data, item_index, clusters, questions, outfit_pairs)
    if assert_leak:
        leak.assert_chance(outfit_tol=leak_outfit_tol)

    return MetricSuite(
        AUC_catalog_pair=auc_catalog,
        AUC_zero_shot_cosine=auc_zero_shot,
        gate_A_diff=gate_a,
        outfit_auc=outfit_auc,
        fitb_trained_full=fitb_tr,
        fitb_zero_shot_cosine=fitb_zs,
        AUC_pair_item_level=auc_item,
        seam_diff_pairwise_minus_item_level=seam,
        outfit_auc_item_level=outfit_auc_item,
        fitb_item_level_full=fitb_il,
        AUC_pop_edge=auc_pop_edge,
        AUC_pop_outfit=auc_pop_outfit,
        fitb_popularity=fitb_pop,
        leak=leak,
    )


# =========================================================================== #
# C4 EMISSION HALF — the four-file unlock + first metrics.json (§1 / §12 / §15)
# =========================================================================== #
ROOT_DIR = os.path.dirname(__file__)
SEED = 20260629
SPLIT_LOADER = "load_corpus(strict_disjoint=True)"
UNLOCK_FILES = ("preregistration.md", "preregistration.json", "judge_addendum.md", "closet_manifest.json")
METRICS_SCHEMA = "metrics.schema.json"
JUDGE_ADDENDUM_SCHEMA = "judge_addendum.schema.json"
CLOSET_SCHEMA = "closet_manifest.schema.json"
CLOSET_CATEGORY_REFERENCE = "closet_category_reference.json"
SELECTION_SCHEMA = "selection.schema.json"


class UnlockError(RuntimeError):
    """`evaluate.py` refused to emit `metrics.json`. The `reason` distinguishes a halt-and-ask boundary
    (selection.json/closet_manifest.json absent, the addendum still a scaffold — kickoff B2/B3) from a
    validation bug to fix. As long as this can raise, no held-out test-set number reaches disk (§1)."""


# --------------------------------------------------------------------------- #
# Git seam (injected so the unit suite exercises the unlock without a temp repo)
# --------------------------------------------------------------------------- #
@dataclass(frozen=True)
class FileIdentity:
    """A committed file's identity for the `_meta.unlock_files` record. `committed` is True iff the
    path is git-tracked AND its working-tree bytes equal the HEAD blob — so the recorded `git_blob_sha`
    is genuinely the committed object the freeze rests on (a dirty/uncommitted freeze file refuses)."""

    git_blob_sha: str
    committed: bool


class GitInfo(Protocol):
    def identity(self, path: str) -> FileIdentity: ...
    def head_commit(self) -> str: ...


class RealGit:
    """The default git seam — shells to `git` to blob-hash a path and read HEAD. The unit suite injects
    a fake instead, so the unlock logic is tested without a real commit; one test exercises this real
    path against the already-committed freeze files."""

    def __init__(self, repo_root: str = ROOT_DIR) -> None:
        self.repo_root = repo_root

    def _git(self, *args: str) -> str:
        return subprocess.run(
            ["git", "-C", self.repo_root, *args], capture_output=True, text=True, check=True
        ).stdout.strip()

    def identity(self, path: str) -> FileIdentity:
        working = self._git("hash-object", path)
        rel = os.path.relpath(path, self.repo_root)
        try:
            committed_blob = self._git("rev-parse", f"HEAD:./{rel}")
        except subprocess.CalledProcessError:
            return FileIdentity(git_blob_sha=working, committed=False)  # untracked / not in HEAD
        return FileIdentity(git_blob_sha=working, committed=(committed_blob == working))

    def head_commit(self) -> str:
        return self._git("rev-parse", "HEAD")


# --------------------------------------------------------------------------- #
# Unlock-file helpers
# --------------------------------------------------------------------------- #
def _file_sha256(path: str) -> str:
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def _read_text(path: str) -> str:
    with open(path, encoding="utf-8") as f:
        return f.read()


def _load_schema(path: str) -> dict:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def _validate_against_schema(instance, schema_path: str, *, what: str) -> None:
    """Schema-validate `instance`, re-raising a jsonschema failure as an `UnlockError` (a refusal, not a
    crash) so the emission path uniformly declines on any invalid unlock file."""
    import jsonschema

    try:
        jsonschema.Draft202012Validator(_load_schema(schema_path)).validate(instance)
    except jsonschema.ValidationError as e:
        raise UnlockError(f"{what} failed schema {os.path.basename(schema_path)}: {e.message}") from e


def extract_envelope(md_text: str) -> dict:
    """Pull the machine-readable determinism envelope (the first ```json fenced block) out of
    `judge_addendum.md` — the §1 "enforceable, not honor-system" form `evaluate.py` parses directly. A
    missing block or unparseable JSON is an `UnlockError` (the addendum is malformed/scaffolded)."""
    m = re.search(r"```json\s*\n(.*?)\n```", md_text, re.DOTALL)
    if not m:
        raise UnlockError("judge_addendum.md has no ```json determinism-envelope block")
    try:
        env = json.loads(m.group(1))
    except (json.JSONDecodeError, ValueError) as e:
        raise UnlockError(f"judge_addendum.md envelope is not valid JSON: {e}") from e
    if not isinstance(env, dict):
        raise UnlockError("judge_addendum.md envelope must be a JSON object")
    return env


def _prereg_md_json_agree(root_dir: str) -> None:
    """Enforce that `preregistration.json` (the machine mirror) agrees with `preregistration.md` (the
    human authority) on the load-bearing literals (§1: the two "must agree"). Mirrors the C2 freeze
    test, but as a *runtime* unlock precondition: a frozen one-way-door doc that silently disagrees
    with its mirror would let `evaluate.py` gate on a threshold the prose never states."""
    p = load_json_strict(os.path.join(root_dir, "preregistration.json"))
    md = _read_text(os.path.join(root_dir, "preregistration.md"))
    g = p["gates"]
    floors = {c["metric"]: c["floor"] for c in g["D"]["conjuncts"]}
    required_literals = [
        str(g["B"]["delta"]),                           # 0.05
        str(floors["outfit_auc"]),                      # 0.81
        str(floors["fitb_trained_full"]),               # 0.5
        str(p["reported_transfer"]["drop"]["healthy_if_leq"]),    # 0.12
        str(p["reported_transfer"]["closet_floor"]["healthy_if_geq"]),  # 0.7
        str(p["analyst_pins"]["popularity_confound_response"]["blind_margin_auc"]),  # 0.55
        str(p["headline_cell"]["seed"]),                # 20260629
    ]
    # the .md writes the FITB floor as "0.50" and the AUC band as "0.70"/"0.50"; accept the json's
    # canonical numeric OR its 2-dp written form, so an honest formatting difference is not a false alarm.
    written = {"0.5": "0.50", "0.7": "0.70"}
    for lit in required_literals:
        if lit not in md and written.get(lit, lit) not in md:
            raise UnlockError(
                f"preregistration.json / .md disagree: the frozen literal {lit!r} is in the .json "
                f"mirror but not the .md authority (§1 — the two must agree)"
            )
    # Gate A's threshold is 0.0 (added value > 0) — a NON-distinctive substring ("0.05" contains "0.0"),
    # so a literal check for it is vacuous and can never fail. Bind the gate-A leg by its distinctive
    # metric EXPRESSION instead, which the .md authority states verbatim (with a U+2212 minus, not the
    # .json mirror's ASCII hyphen — reuse the .json's field names + swap the glyph so the check tracks a
    # metric-name change while ignoring the honest glyph difference).
    gate_a_expr = g["A"]["metric"].replace("-", "−")
    if gate_a_expr not in md:
        raise UnlockError(
            f"preregistration.json / .md disagree: the .md authority does not state gate A's metric "
            f"expression {gate_a_expr!r} (§1 — the two must agree on the added-value gate)"
        )


def closet_referential_checks(closet: dict, reference: dict) -> None:
    """The C4 referential checks the schema cannot express (build doc §1/§12/§15-C4): every outfit item
    id is declared in `items`, item ids are unique, and every non-null `polyvore_category_id` exists in
    `closet_category_reference.json`. (The `clothing_type` ↔ `type_map` label-slip cross-check is a C5
    `domain_probe.py` concern — neither the schema nor this existence check catches it, by design.)"""
    declared: set[str] = set()
    for it in closet["items"]:
        iid = it["item_id"]
        if iid in declared:
            raise UnlockError(f"closet_manifest.json declares item_id {iid!r} more than once")
        declared.add(iid)
    ref_ids = set(reference["categories"])
    for it in closet["items"]:
        cid = it["polyvore_category_id"]
        if cid is not None and cid not in ref_ids:
            raise UnlockError(
                f"closet_manifest.json item {it['item_id']!r} has polyvore_category_id {cid!r} "
                f"absent from {CLOSET_CATEGORY_REFERENCE}"
            )
    for o in closet["outfits"]:
        for iid in o["item_ids"]:
            if iid not in declared:
                raise UnlockError(
                    f"closet_manifest.json outfit {o['set_id']!r} references undeclared item {iid!r}"
                )


def _require_present(path: str, *, reason_if_absent: str) -> None:
    if not os.path.exists(path):
        raise UnlockError(reason_if_absent)


def assert_calibration_disjoint(cal_ids: set[str], gated_ids: set[str], *, label: str) -> None:
    """The blindness invariant made mechanical (§1/§8/§F): the human-agreement calibration set that
    selected the judge envelope must share NO question with a gated set — tuning the judge on a gated
    question is the forbidden path. Raises `UnlockError` on any overlap, naming a few offenders."""
    overlap = sorted(cal_ids & gated_ids)
    if overlap:
        raise UnlockError(
            f"calibration set overlaps the {label} question set on {len(overlap)} id(s) "
            f"(e.g. {overlap[:5]}) — the judge was tuned on a gated question (§1 blindness violation)"
        )


def _calibration_question_ids(root_dir: str, envelope: dict, git: GitInfo | None = None) -> set[str]:
    """Load + integrity-check the human calibration manifest the judge addendum binds, returning its
    question ids. The manifest is sha-bound by the addendum (`calibration_set.manifest_sha256`) and is
    part of the freeze, so it must be present, committed-clean, and hash-match. Its `question_ids` feed
    the §F disjointness assertions (gate-B here; gate-D full in `materialize_metrics_json`)."""
    cal = envelope["calibration_set"]
    cal_path = os.path.join(root_dir, cal["manifest_path"])
    _require_present(
        cal_path,
        reason_if_absent=(
            f"the judge addendum binds calibration manifest {cal['manifest_path']!r} but it is absent — "
            f"the human-label calibration set is part of the C4 freeze (§F)"
        ),
    )
    if _file_sha256(cal_path) != cal["manifest_sha256"]:
        raise UnlockError(
            f"calibration manifest {cal['manifest_path']!r} sha256 does not match the addendum's "
            f"calibration_set.manifest_sha256 (the bound human-label set was edited after the freeze)"
        )
    git = git or RealGit(root_dir)
    if not git.identity(cal_path).committed:
        raise UnlockError(f"calibration manifest {cal['manifest_path']!r} is not committed-clean (must be in git before unlock)")
    manifest = load_json_strict(cal_path)
    return set(manifest["question_ids"])


def assert_gate_d_disjoint(
    root_dir: str, envelope: dict, full_fitb_set_ids, *, git: GitInfo | None = None
) -> None:
    """The gate-D leg of the §F blindness invariant, factored out of `materialize_metrics_json` so it is
    hermetically testable (materialize itself needs torch + the built cache). The human calibration set
    that tuned the judge must be disjoint from the **FULL gate-D test FITB set** (the gate-B leg is
    enforced separately, hermetically, in `validate_unlock_files`). Loads + integrity-checks the bound
    calibration manifest, then asserts no shared question id."""
    cal_ids = _calibration_question_ids(root_dir, envelope, git=git)
    assert_calibration_disjoint(cal_ids, set(full_fitb_set_ids), label="gate_D_full_fitb")


def validate_unlock_files(
    root_dir: str = ROOT_DIR, git: GitInfo | None = None
) -> tuple[dict, dict]:
    """The blindness gate (§1/§12). Validate + hash-record the four unlock files and bind the sealed
    `selection.json`, returning `(unlock_files_meta, selection_meta)` for `metrics.json._meta`. Raises
    `UnlockError` on ANY refusal — an absent selection.json/closet_manifest.json (kickoff B2/B3), a
    judge addendum still a scaffold (`frozen:false` fails its schema), a `.md`/`.json` prereg
    disagreement, a closet referential break, or an uncommitted/dirty freeze file — so no test-set
    number can be emitted until the freeze is genuinely complete and committed."""
    git = git or RealGit(root_dir)

    # --- selection.json binding (the B2 halt: absent until the embedding-cache training run) ---
    selection_path = os.path.join(root_dir, "selection.json")
    _require_present(
        selection_path,
        reason_if_absent=(
            "selection.json is absent — DEFERRED until the one-time embedding cache is built and "
            "train_head.py writes the sealed checkpoint (kickoff B2). Build the cache + run train_head, "
            "commit selection.json, then re-run the unlock."
        ),
    )
    selection = load_json_strict(selection_path)
    _validate_against_schema(selection, os.path.join(root_dir, SELECTION_SCHEMA), what="selection.json")
    from train_head import manifest_hashes

    if selection["manifest_hashes"] != manifest_hashes(root_dir):
        raise UnlockError(
            "selection.json manifest_hashes no longer bind the current frozen artifacts "
            "(preregistration.json / fitb_manifest.json / embedding_manifest / type_map) — re-run the "
            "selection before unlocking"
        )
    sel_id = git.identity(selection_path)
    if not sel_id.committed:
        raise UnlockError("selection.json is not committed-clean (the sealed checkpoint must be in git before unlock)")
    selection_meta = {
        "path": "selection.json",
        "schema": SELECTION_SCHEMA,
        "git_blob_sha": sel_id.git_blob_sha,
        "sha256": _file_sha256(selection_path),
        "validated": True,
        "checkpoint_id": selection["checkpoint_id"],
        "checkpoint_sha256": selection["checkpoint_sha256"],
    }

    # --- the four unlock files: presence, content validity, then committed-clean hash record ---
    for name in UNLOCK_FILES:
        _require_present(
            os.path.join(root_dir, name),
            reason_if_absent=(
                f"{name} is absent — the four-file unlock is incomplete"
                + (" (label your worn outfits into closet_manifest.json — kickoff B3)"
                   if name == "closet_manifest.json" else "")
            ),
        )

    _prereg_md_json_agree(root_dir)

    envelope = extract_envelope(_read_text(os.path.join(root_dir, "judge_addendum.md")))
    _validate_against_schema(
        envelope, os.path.join(root_dir, JUDGE_ADDENDUM_SCHEMA), what="judge_addendum.md envelope"
    )  # frozen:true is a schema const -> a scaffold (frozen:false / placeholders) is refused here

    # The judge envelope was tuned on a human calibration set that must touch NO gated question (§1/§8/
    # §F) — make that mechanical, not honor-system: the addendum binds the calibration manifest by sha,
    # so verify the committed manifest matches and its question ids are disjoint from the committed
    # gate-B set. (The full gate-D superset check needs the corpus -> materialize_metrics_json.)
    cal_ids = _calibration_question_ids(root_dir, envelope, git=git)
    order = load_json_strict(os.path.join(root_dir, "fitb_order.json"))
    assert_calibration_disjoint(cal_ids, set(order["gate_b_set_ids"]), label="gate_B")

    closet = load_json_strict(os.path.join(root_dir, "closet_manifest.json"))
    _validate_against_schema(closet, os.path.join(root_dir, CLOSET_SCHEMA), what="closet_manifest.json")
    reference = load_json_strict(os.path.join(root_dir, CLOSET_CATEGORY_REFERENCE))
    closet_referential_checks(closet, reference)

    unlock_files: dict[str, dict] = {}
    for name in UNLOCK_FILES:
        path = os.path.join(root_dir, name)
        ident = git.identity(path)
        if not ident.committed:
            raise UnlockError(
                f"{name} is not committed-clean — the freeze must be in git (and undirtied) before the "
                f"unlock records its blob sha (§1 build-order teeth)"
            )
        unlock_files[name] = {
            "path": name,
            "git_blob_sha": ident.git_blob_sha,
            "sha256": _file_sha256(path),
            "validated": True,
        }
    return unlock_files, selection_meta


# --------------------------------------------------------------------------- #
# Gate B (judge arm) — ledger -> trained/judge FITB + the paired two-stage diffs (§8/§11/§12)
# --------------------------------------------------------------------------- #
@dataclass(frozen=True)
class GateBMetrics:
    """The gate-B comparison on the kept (non-dropped) shared question set. `fitb_*_gateB` are the
    cluster-bootstrap point CIs; the two `gate_B_diff_*` are the PAIRED TWO-STAGE diffs (cluster +
    judge-sample resample, §11) under the two §12 conventions — the gated quantities."""

    arm: str
    n_kept: int
    n_dropped: int
    fitb_trained_gateB: CI
    fitb_judge_gateB: CI
    gate_B_diff_inconsistent_miss: CI
    gate_B_diff_inconsistent_half: CI


def assert_ledger_snapshot(ledger_rows: Sequence[dict], arm: str, expected_snapshot: str) -> None:
    """Bind the committed judge ledger to the frozen judge snapshot (§8 — the dated snapshot freezes at
    C4 and does not move). Every arm-matching row's `model_snapshot` must equal the frozen envelope's
    `model_snapshot`; a mismatch means the gate-B parity number was produced by a model different from the
    one the addendum froze (e.g. a mid-spike production bump, or a stray `--snapshot`), which would
    silently misrepresent the headline artifact's provenance. Raises `UnlockError` naming the offenders."""
    seen = {row["model_snapshot"] for row in ledger_rows if row["arm"] == arm}
    bad = sorted(s for s in seen if s != expected_snapshot)
    if bad:
        raise UnlockError(
            f"judge_runs.ndjson arm {arm!r} was scored by model snapshot(s) {bad} but the frozen "
            f"judge_addendum.md binds {expected_snapshot!r} (§8 — the dated snapshot does not move after "
            f"C4); the gate-B number's provenance would not match the freeze"
        )


def assert_ledger_committed(root_dir: str, ledger_path: str, *, git: GitInfo | None = None) -> str:
    """Emit preflight (§8/§12): the gate-B judge ledger must EXIST and be committed-clean before the
    multi-hour `emit` retrain, and its sha256 binds the emitted gate-B numbers to the exact committed
    ledger bytes (`metrics.json._meta.judge_ledger_sha256`). Returns that sha256. Raises `UnlockError`
    if the ledger is absent, or present-but-uncommitted/dirty (a dirty ledger could carry paid results
    not reflected in git — refuse UP FRONT rather than after hours of retrain). Injectable git seam so the
    guard is hermetically testable; `RealGit.identity` reports an untracked ledger as `committed=False`."""
    _require_present(
        ledger_path,
        reason_if_absent=(
            f"the gate-B judge ledger {os.path.basename(ledger_path)!r} is absent — run `run_judge.py "
            f"gate-b` to score the judge (and commit judge_runs.ndjson) before `emit`"
        ),
    )
    git = git or RealGit(root_dir)
    if not git.identity(ledger_path).committed:
        raise UnlockError(
            f"{os.path.basename(ledger_path)} is not committed-clean — commit the gate-B ledger before "
            f"`emit` so the emitted gate-B numbers bind to the exact committed bytes (§8/§12 provenance); "
            f"a dirty/uncommitted ledger is refused before the expensive retrain, not after it"
        )
    return _file_sha256(ledger_path)


def assert_ledger_unchanged_since_preflight(
    root_dir: str, ledger_path: str, preflight_sha: str, *, git: GitInfo | None = None
) -> str:
    """Re-verify the gate-B ledger RIGHT BEFORE it is consumed (§8/§12 provenance). The emit retrain takes
    HOURS, during which `judge_runs.ndjson` could change on disk (a re-run `gate-b`, a manual edit) — so the
    preflight sha could bind DIFFERENT bytes than the ones `compute_gate_b`/coherence actually score.
    Require the ledger is STILL committed-clean AND its sha is unchanged since the preflight, and return
    that (unchanged) sha for `metrics.json._meta.judge_ledger_sha256`. Raises `UnlockError` on any change,
    so the recorded provenance sha is provably the sha of the consumed bytes, never a stale preflight value."""
    consumed = assert_ledger_committed(root_dir, ledger_path, git=git)
    if consumed != preflight_sha:
        raise UnlockError(
            f"judge_runs.ndjson changed on disk during the emit retrain (preflight sha {preflight_sha} != "
            f"read-time sha {consumed}) — re-run emit against a stable committed ledger so the recorded "
            f"provenance sha binds the bytes actually scored (§8/§12)"
        )
    return consumed


def compute_gate_b(
    gate_b_questions: Sequence[FitbQuestion],
    edge_score: EdgeScore,
    ledger_rows: Sequence[dict],
    *,
    arm: str,
    seed: int = SEED,
    b: int = 10_000,
    expected_k: int | None = None,
    expected_snapshot: str | None = None,
) -> GateBMetrics:
    """Join the scalar judge ledger to the gate-B prefix questions, collapse to per-question verdicts,
    and compute the gate-B CIs. Dropped questions (no parseable judge sample) are excluded from BOTH the
    trained and judge sides (like-for-like, §12); inconsistent questions are kept and scored a miss/0.5
    by convention. The trained head re-scores only the KEPT questions so the paired diff is aligned.
    `fitb_judge_gateB` is the standalone judge readout under the headline `inconsistent = miss`
    convention; the gated quantities are the two `gate_B_diff_*` paired two-stage diffs. `expected_k`
    (the frozen judge K) enforces ledger completeness/idempotency in `group_samples`; `expected_snapshot`
    (the frozen judge model) binds the ledger's provenance to the addendum (§8)."""
    if expected_snapshot is not None:
        assert_ledger_snapshot(ledger_rows, arm, expected_snapshot)
    per_question = group_samples(ledger_rows, gate_b_questions, arm=arm, expected_k=expected_k)
    gb = gate_b_verdicts(per_question)
    kept = set(gb.kept_question_ids)
    kept_questions = [q for q in gate_b_questions if q.set_id in kept]
    trained_hits = fitb_hits(kept_questions, edge_score)
    judge_hits_miss = judge_gate_b_hits(gb.verdicts, INCONSISTENT_MISS)
    return GateBMetrics(
        arm=arm,
        n_kept=len(gb.kept_question_ids),
        n_dropped=len(gb.dropped_question_ids),
        fitb_trained_gateB=fitb_ci(trained_hits, seed=seed, b=b),
        fitb_judge_gateB=fitb_ci(judge_hits_miss, seed=seed, b=b),
        gate_B_diff_inconsistent_miss=two_stage_paired_fitb_diff_ci(
            trained_hits, gb.verdicts, gb.samples_by_id, convention=INCONSISTENT_MISS, seed=seed, b=b
        ),
        gate_B_diff_inconsistent_half=two_stage_paired_fitb_diff_ci(
            trained_hits, gb.verdicts, gb.samples_by_id, convention=INCONSISTENT_HALF, seed=seed, b=b
        ),
    )


def compute_coherence_sensitivity(
    gate_b_questions: Sequence[FitbQuestion],
    full_questions: Sequence[FitbQuestion],
    item_index: dict[str, Item],
    edge_score: EdgeScore,
    ledger_rows: Sequence[dict],
    *,
    arm: str,
    seed: int = SEED,
    b: int = 10_000,
    expected_k: int | None = None,
) -> dict:
    """The pre-registered coherence-sliced sensitivity (§F amendment 2026-07-01 / build doc §12 —
    REPORTED, NEVER GATING; the gates read the standard unfiltered sets). Polyvore's ~13-14% incoherent
    questions (`coherence.fitb_question_is_coherent`) cannot discriminate candidates (all 4 share the
    clash status, §4 same-fine-category), but two residual mechanisms both push TOWARD a gate-B pass:
    noise questions attenuate a true trained-vs-judge gap toward parity, and an LLM asked to complete an
    already-complete outfit can answer erratically -> order-inconsistent -> scored a miss (the §12
    judge handicap). So report, per slice: the gate-B paired diffs under BOTH conventions, the judge's
    inconsistency rate (the balk detector), and the gate-D trained FITB. Pre-committed response: if the
    coherent-slice gate-B verdict disagrees with the headline, results.md labels gate B
    "coherence-sensitive (disclosed)" — gate numbers never move."""
    flags = {q.set_id: fitb_question_is_coherent(q, item_index) for q in gate_b_questions}
    slices = {
        "coherent": [q for q in gate_b_questions if flags[q.set_id]],
        "flagged": [q for q in gate_b_questions if not flags[q.set_id]],
    }
    out: dict = {"rule": COHERENCE_RULE,
                 "n_gate_b_coherent": len(slices["coherent"]),
                 "n_gate_b_flagged": len(slices["flagged"])}
    for name, qs in slices.items():
        # A slice with no KEPT question — empty (a fully-one-sided prefix) or every question
        # judge-dropped (no parseable sample) — has nothing for the two-stage bootstrap: emit
        # null CIs and keep the counts. This is a reported-never-gating diagnostic; it must
        # degrade to nulls, never raise past the gates.
        per_question = group_samples(ledger_rows, qs, arm=arm, expected_k=expected_k) if qs else []
        gb = gate_b_verdicts(per_question)
        if not gb.verdicts:
            out[f"gate_B_diff_inconsistent_miss_{name}"] = None
            out[f"gate_B_diff_inconsistent_half_{name}"] = None
            out[f"judge_inconsistent_rate_{name}"] = None
            continue
        kept = set(gb.kept_question_ids)
        kept_qs = [q for q in qs if q.set_id in kept]
        trained_hits = fitb_hits(kept_qs, edge_score)
        out[f"gate_B_diff_inconsistent_miss_{name}"] = _ci(two_stage_paired_fitb_diff_ci(
            trained_hits, gb.verdicts, gb.samples_by_id, convention=INCONSISTENT_MISS, seed=seed, b=b))
        out[f"gate_B_diff_inconsistent_half_{name}"] = _ci(two_stage_paired_fitb_diff_ci(
            trained_hits, gb.verdicts, gb.samples_by_id, convention=INCONSISTENT_HALF, seed=seed, b=b))
        n_inconsistent = sum(1 for v in gb.verdicts if v.status == "inconsistent")
        out[f"judge_inconsistent_rate_{name}"] = n_inconsistent / len(gb.verdicts)
    for name, pred in (("coherent", True), ("flagged", False)):
        qs = [q for q in full_questions if fitb_question_is_coherent(q, item_index) is pred]
        out[f"fitb_trained_full_{name}"] = _ci(fitb_ci(fitb_hits(qs, edge_score), seed=seed, b=b)) if qs else None
    return out


# --------------------------------------------------------------------------- #
# Assemble + emit metrics.json (the gated write — refuses unless the unlock passes)
# --------------------------------------------------------------------------- #
def _ci(c: CI) -> dict:
    return {"point": c.point, "low": c.low, "high": c.high, "b": c.b}


def assemble_metrics(
    suite: MetricSuite,
    gate_b: GateBMetrics,
    *,
    unlock_files: dict,
    selection_meta: dict,
    git_commit: str,
    seed: int = SEED,
    stage: str = "C4",
    coherence: dict | None = None,
    judge_ledger_sha256: str | None = None,
) -> dict:
    """Map the in-memory CI suite + the gate-B judge comparison to the `metrics.schema.json` field set.
    Emits the C4 required set (gate A/B/D) plus the always-available diagnostics + seam pair-level fields
    (load-bearing for the C6 mandatory popularity re-run + the seam verdict). The closet/transfer fields
    stage to C5 and `seam_holm_adjusted_p` to C6 (the family-wise correction over the executed ablation
    family), so they are deliberately absent at stage C4 (schema-legal — optional until C5/C6).
    `judge_ledger_sha256`, when provided by the RUN-phase emit, binds the gate-B numbers to the exact
    committed `judge_runs.ndjson` bytes (§8/§12); it is optional so the hermetic emit tests omit it."""
    meta = {
        "stage": stage,
        "seed": seed,
        "split_loader": SPLIT_LOADER,
        "git_commit": git_commit,
        "unlock_files": unlock_files,
        "selection": selection_meta,
    }
    if judge_ledger_sha256 is not None:
        meta["judge_ledger_sha256"] = judge_ledger_sha256   # provenance: the exact committed gate-B ledger
    return {
        "_meta": meta,
        # Gate A (added value) — pair-level
        "AUC_catalog_pair": _ci(suite.AUC_catalog_pair),
        "AUC_zero_shot_cosine": _ci(suite.AUC_zero_shot_cosine),
        "gate_A_diff": _ci(suite.gate_A_diff),
        # Gate B (FITB non-inferiority vs the judge) — the paired two-stage diffs under both conventions
        "fitb_trained_gateB": _ci(gate_b.fitb_trained_gateB),
        "fitb_judge_gateB": _ci(gate_b.fitb_judge_gateB),
        "gate_B_diff_inconsistent_miss": _ci(gate_b.gate_B_diff_inconsistent_miss),
        "gate_B_diff_inconsistent_half": _ci(gate_b.gate_B_diff_inconsistent_half),
        # Gate D (absolute floor) — outfit-level + full FITB
        "outfit_auc": _ci(suite.outfit_auc),
        "fitb_trained_full": _ci(suite.fitb_trained_full),
        # Popularity-confound diagnostics (§C.6 — load-bearing for the C6 mandatory sensitivity re-run).
        # AUC_pop_* trigger the confound label vs the 0.55 margin; fitb_popularity is REPORTED-only
        # (most-popular-candidate FITB accuracy vs the 0.25 chance floor — the answer-selection shortcut
        # the AUC diagnostics miss), never a moved gate.
        "AUC_pop_edge": _ci(suite.AUC_pop_edge),
        "AUC_pop_outfit": _ci(suite.AUC_pop_outfit),
        "fitb_popularity": _ci(suite.fitb_popularity),
        # Baseline-ladder + seam-ablation readouts (the seam CI is the C6 falsification statistic's input)
        "fitb_zero_shot_cosine": _ci(suite.fitb_zero_shot_cosine),
        "AUC_pair_item_level": _ci(suite.AUC_pair_item_level),
        "seam_diff_pairwise_minus_item_level": _ci(suite.seam_diff_pairwise_minus_item_level),
        "outfit_auc_item_level": _ci(suite.outfit_auc_item_level),
        "fitb_item_level_full": _ci(suite.fitb_item_level_full),
        # Coherence-sliced sensitivity (§F amendment 2026-07-01 — REPORTED, NEVER GATING; absent only
        # in legacy/partial assemblies).
        **({"coherence_sensitivity": coherence} if coherence is not None else {}),
    }


def emit_metrics(
    suite: MetricSuite,
    gate_b: GateBMetrics,
    *,
    root_dir: str = ROOT_DIR,
    out_path: str | None = None,
    git: GitInfo | None = None,
    seed: int = SEED,
    stage: str = "C4",
    coherence: dict | None = None,
    judge_ledger_sha256: str | None = None,
) -> dict:
    """First-emit `metrics.json` — but ONLY after the four-file unlock validates (§1/§12). Validates the
    unlock files (every freeze file must be committed-clean — no bypass) + binds the sealed selection,
    assembles the field set, **re-validates it against `metrics.schema.json`**, then writes. Any
    `UnlockError` from the gate means no file is written, so a held-out test-set number never reaches
    disk while the freeze is incomplete (the blindness teeth). `judge_ledger_sha256` (from the RUN-phase
    emit) is recorded in `_meta` to bind the gate-B numbers to the exact committed ledger (§8/§12)."""
    git = git or RealGit(root_dir)
    unlock_files, selection_meta = validate_unlock_files(root_dir, git)
    metrics = assemble_metrics(
        suite, gate_b, unlock_files=unlock_files, selection_meta=selection_meta,
        git_commit=git.head_commit(), seed=seed, stage=stage, coherence=coherence,
        judge_ledger_sha256=judge_ledger_sha256,
    )
    _validate_against_schema(metrics, os.path.join(root_dir, METRICS_SCHEMA), what="assembled metrics.json")
    out_path = out_path or os.path.join(root_dir, "metrics.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(metrics, f, indent=2)
    return metrics


# --------------------------------------------------------------------------- #
# C5 merge — fold domain_probe.py's closet_metrics.json into metrics.json (§15 artifact dataflow)
# --------------------------------------------------------------------------- #
def merge_closet_metrics(
    root_dir: str = ROOT_DIR, git: GitInfo | None = None, out_path: str | None = None
) -> dict:
    """Merge the C5 closet/transfer fields (`AUC_closet_pair` + `catalog_closet_drop`) from
    `closet_metrics.json` into the emitted `metrics.json`, advancing `_meta.stage` to C5. The
    closet scoring lives in a separate script (`domain_probe.py`) so the gate authority stays one
    file; this merge is where its output re-enters the gated artifact — so it re-verifies the
    binds rather than trusting them: the probe's checkpoint sha must equal the sealed selection's,
    its closet-manifest sha must equal the unlock record's, its catalog cross-check AUC must equal
    the emitted `AUC_catalog_pair.point` (all three prove the probe scored the same frozen world
    the emission did), and the four-file freeze must still validate with UNCHANGED hashes."""
    git = git or RealGit(root_dir)
    metrics_path = os.path.join(root_dir, "metrics.json")
    closet_path = os.path.join(root_dir, "closet_metrics.json")
    _require_present(metrics_path, reason_if_absent="metrics.json is absent — the C4 emission must run before the C5 merge")
    _require_present(closet_path, reason_if_absent="closet_metrics.json is absent — run domain_probe.py first (§15-C5)")
    metrics = load_json_strict(metrics_path)
    closet = load_json_strict(closet_path)

    cm = closet["_meta"]
    if cm["checkpoint_sha256"] != metrics["_meta"]["selection"]["checkpoint_sha256"]:
        raise UnlockError(
            "closet_metrics.json was scored with a checkpoint different from the sealed selection "
            f"({cm['checkpoint_sha256']} != {metrics['_meta']['selection']['checkpoint_sha256']}) — "
            "the drop would mix two heads; re-run domain_probe.py against the sealed checkpoint"
        )
    recorded_closet_sha = metrics["_meta"]["unlock_files"]["closet_manifest.json"]["sha256"]
    if cm["closet_manifest_sha256"] != recorded_closet_sha:
        raise UnlockError(
            "closet_metrics.json was scored from a closet_manifest.json different from the unlock "
            f"record ({cm['closet_manifest_sha256']} != {recorded_closet_sha}) — the transfer probe's "
            "frozen dataset drifted; re-freeze is not allowed post-unlock (§12)"
        )
    if cm["catalog_auc_point_crosscheck"] != metrics["AUC_catalog_pair"]["point"]:
        raise UnlockError(
            "closet_metrics.json's re-scored catalog AUC does not reproduce the emitted "
            f"AUC_catalog_pair.point ({cm['catalog_auc_point_crosscheck']} != "
            f"{metrics['AUC_catalog_pair']['point']}) — the probe and the emission disagree on the "
            "catalog side of the drop"
        )
    # The freeze must still be intact AND identical to what the emission recorded — a freeze file
    # edited between emit and merge would silently re-home the closet fields under different terms.
    fresh_unlock, fresh_selection = validate_unlock_files(root_dir, git)
    if fresh_unlock != metrics["_meta"]["unlock_files"]:
        raise UnlockError(
            "the four unlock files' hashes changed since the C4 emission — metrics.json's recorded "
            "freeze no longer matches the working tree; resolve the drift before merging (§1/§12)"
        )
    if fresh_selection["checkpoint_sha256"] != metrics["_meta"]["selection"]["checkpoint_sha256"]:
        raise UnlockError("selection.json's sealed checkpoint sha changed since the C4 emission")

    merged = dict(metrics)
    merged["AUC_closet_pair"] = closet["AUC_closet_pair"]
    merged["catalog_closet_drop"] = closet["catalog_closet_drop"]
    merged["_meta"] = {
        **metrics["_meta"],
        # C6 finalization owns the C6 stamp; a (re-)merge never downgrades it.
        "stage": metrics["_meta"]["stage"] if metrics["_meta"]["stage"] == "C6" else "C5",
        "git_commit": git.head_commit(),
        "closet_metrics_sha256": _file_sha256(closet_path),
    }
    _validate_against_schema(merged, os.path.join(root_dir, METRICS_SCHEMA), what="merged metrics.json")
    out_path = out_path or metrics_path
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(merged, f, indent=2)
    return merged


# =========================================================================== #
# C6 — finalize (seam Holm p + the two mandatory sensitivity blocks) + the gate half (§12/§15-C6)
# =========================================================================== #
def _load_item_level_head(root_dir: str, emitted: dict, cache, corpus):
    """Load the item-level ablation checkpoint and BIND it by exact reproduction: `selection.json`
    seals only the pairwise head (its schema admits no ablation), so the item-level blob's identity
    is proven by re-scoring the catalog pairs and reproducing the emitted `AUC_pair_item_level` CI
    bit-for-bit (same seed → same bootstrap stream → any weight difference would move it). Returns
    `(head, pos_il, neg_il, auc_ci_il)`; raises `UnlockError` if no/ambiguous blob or a mismatch."""
    import glob as _glob

    import torch

    from data_loader import build_pairwise
    from train_head import ItemLevelHead

    pattern = os.path.join(root_dir, "checkpoints", f"item_level_*_seed{SEED}.pt")
    blobs = sorted(_glob.glob(pattern))
    if len(blobs) != 1:
        raise UnlockError(
            f"expected exactly one item-level checkpoint blob at {pattern!r}, found {len(blobs)} — "
            f"regenerate deterministically with train_head.py (the blob is gitignored)"
        )
    head = ItemLevelHead()
    head.load_state_dict(torch.load(blobs[0], weights_only=True))
    edges, _ = build_pairwise(corpus.splits["test"], corpus.item_index, SEED)
    scorer = head_edge_scorer(head, cache, corpus.item_index)
    pos_il, neg_il = pairwise_pos_neg(edges, scorer)
    ci_il = auc_ci(pos_il, neg_il, seed=SEED, b=emitted["AUC_pair_item_level"]["b"])
    if _ci(ci_il) != emitted["AUC_pair_item_level"]:
        raise UnlockError(
            f"item-level checkpoint {os.path.basename(blobs[0])!r} does not reproduce the emitted "
            f"AUC_pair_item_level ({_ci(ci_il)} != {emitted['AUC_pair_item_level']}) — a stale/foreign "
            f"ablation blob; regenerate with train_head.py"
        )
    return head, pos_il, neg_il


def finalize_metrics(root_dir: str = ROOT_DIR, git: GitInfo | None = None, *, b: int = 10_000) -> dict:
    """The C6 finalization (HEAVY — roughly an hour of bootstraps): compute `seam_holm_adjusted_p`
    (§C.5 — the executed ablation family is {shape diff} alone, the matched-base and judge-ablation
    rungs never ran, so m = 1 and Holm-adjusted = raw), the MANDATORY §C.6 popularity-matched
    sensitivity re-run (the pre-registered diagnostic fired: AUC_pop_outfit > 0.55), and the §C.7
    3-seed robustness footnote — then stamp `_meta.stage = "C6"`. Every recomputed quantity that
    also exists in the emitted metrics.json must reproduce it EXACTLY before being trusted (the
    bit-determinism binds); sensitivity numbers are REPORTED-only and never move a gate."""
    import numpy as np

    import sensitivity as sn
    from baselines import cosine_edge_scorer
    from data_loader import build_pairwise, load_headline_corpus
    from domain_probe import load_sealed_pairwise_head
    from embed import HEADLINE, load_cache
    from train_head import set_determinism

    git = git or RealGit(root_dir)
    metrics_path = os.path.join(root_dir, "metrics.json")
    _require_present(metrics_path, reason_if_absent="metrics.json is absent — emit (C4) + merge-closet (C5) must run before finalize")
    metrics = load_json_strict(metrics_path)
    if metrics["_meta"]["stage"] not in ("C5", "C6"):
        raise UnlockError(
            f"finalize requires stage C5 (closet merged), got {metrics['_meta']['stage']!r} — run "
            f"domain_probe.py + `evaluate.py merge-closet` first (§15 artifact dataflow)"
        )
    fresh_unlock, fresh_selection = validate_unlock_files(root_dir, git)
    if fresh_unlock != metrics["_meta"]["unlock_files"]:
        raise UnlockError("the four unlock files' hashes changed since emission — resolve before finalize (§1/§12)")
    prereg = load_json_strict(os.path.join(root_dir, "preregistration.json"))

    set_determinism(SEED)
    corpus = load_headline_corpus(verbose=False)
    cache = load_cache(HEADLINE)
    pairwise_head, _selection = load_sealed_pairwise_head(root_dir)
    trained = head_edge_scorer(pairwise_head, cache, corpus.item_index)
    cosine = cosine_edge_scorer(cache)
    test_split = corpus.splits["test"]

    # --- the seam Holm p, off the SAME replicate stream as the emitted seam CI (§C.5) ----------
    edges, _ = build_pairwise(test_split, corpus.item_index, SEED)
    pos_tr, neg_tr = pairwise_pos_neg(edges, trained)
    from metrics import auc_pos_neg

    if auc_pos_neg(pos_tr, neg_tr) != metrics["AUC_catalog_pair"]["point"]:
        raise UnlockError("re-scored catalog AUC does not reproduce the emitted point — stale checkpoint/cache")
    _il_head, pos_il, neg_il = _load_item_level_head(root_dir, metrics, cache, corpus)
    px, nx = np.asarray(pos_tr, float), np.asarray(neg_tr, float)
    py, ny = np.asarray(pos_il, float), np.asarray(neg_il, float)

    def seam_stat(idx: np.ndarray) -> float:
        return auc_pos_neg(px[idx], nx[idx]) - auc_pos_neg(py[idx], ny[idx])

    point, boot = sn.bootstrap_with_replicates(len(px), seam_stat, seed=SEED, b=b)
    lo, hi = np.quantile(boot, [0.025, 0.975])
    derived = {"point": float(point), "low": float(lo), "high": float(hi), "b": b}
    if derived != metrics["seam_diff_pairwise_minus_item_level"]:
        raise UnlockError(
            f"the seam bootstrap replicates do not reproduce the emitted seam CI ({derived} != "
            f"{metrics['seam_diff_pairwise_minus_item_level']}) — the Holm p would come from a "
            f"different distribution than the emitted CI (§C.5)"
        )
    seam_p = sn.two_sided_boot_p(boot)  # executed family m=1 -> Holm-adjusted == raw (§C.5)

    # --- mandatory §C.6 popularity-matched re-run + §C.7 seed robustness (REPORTED only) -------
    pop_block = sn.compute_popularity_matched(
        test_split, corpus.item_index, trained, cosine, seed=SEED, b=b
    )
    seed_pins = prereg["analyst_pins"]["seed"]
    seed_block = sn.compute_seed_robustness(
        test_split, corpus.item_index, trained, cosine, metrics, prereg["gates"],
        seeds=seed_pins["robustness_footnote"], headline_seed=seed_pins["headline"], b=b,
    )

    final = dict(metrics)
    final["seam_holm_adjusted_p"] = seam_p
    final["popularity_matched_sensitivity"] = pop_block
    final["seed_robustness"] = seed_block
    final["_meta"] = {**metrics["_meta"], "stage": "C6", "git_commit": git.head_commit()}
    _validate_against_schema(final, os.path.join(root_dir, METRICS_SCHEMA), what="finalized metrics.json")
    with open(metrics_path, "w", encoding="utf-8") as f:
        json.dump(final, f, indent=2)
    return final


def apply_gates(metrics: dict, prereg: dict) -> dict:
    """The mechanical gate-application half (§12/§15-C6): read the finalized metrics.json against
    the FROZEN preregistration.json thresholds (parsed, never re-typed) and return the full verdict
    structure. Pure — no compute, no I/O; `main('verdict')` prints it. The near-gate rule is
    uniform: every conjunct passes only if its 95% CI is wholly on the pass side; gate B
    additionally fails as "underpowered / inconclusive" if the adjudicating (inconsistent = miss)
    paired-diff half-width exceeds the frozen δ — applied VERBATIM (preregistration.md §B), with
    the margin disclosed rather than reinterpreted when it lands close."""
    g = prereg["gates"]
    delta = g["B"]["delta"]

    a_ci = metrics["gate_A_diff"]
    a_pass = a_ci["low"] > g["A"]["threshold"]

    def b_leg(ci: dict) -> dict:
        hw = (ci["high"] - ci["low"]) / 2.0
        non_inf = ci["low"] >= -delta
        powered = hw <= delta
        state = ("underpowered / inconclusive" if not powered
                 else "pass" if non_inf else "fail")
        return {"ci": ci, "half_width": hw, "non_inferiority": non_inf, "powered": powered,
                "state": state}

    b_miss = b_leg(metrics["gate_B_diff_inconsistent_miss"])   # the adjudicating convention (§B)
    b_half = b_leg(metrics["gate_B_diff_inconsistent_half"])   # the conservative cross-check
    b_pass = b_miss["state"] == "pass"
    # Vacuity guard (§B): gate B is informative only if the image-only judge is above chance@4.
    b_vacuous = metrics["fitb_judge_gateB"]["low"] <= 0.25

    d_floors = {c["metric"]: c["floor"] for c in g["D"]["conjuncts"]}
    d_legs = {m: {"ci": metrics[m], "floor": f, "pass": metrics[m]["low"] >= f}
              for m, f in d_floors.items()}
    d_pass = all(leg["pass"] for leg in d_legs.values())

    verdict = "GO" if (a_pass and b_pass and d_pass) else "NO-GO"

    # Reported transfer (former gate C) — descriptive band reads, never in the AND-gate (§12).
    rt = prereg["reported_transfer"]
    transfer = {
        "drop": {"ci": metrics["catalog_closet_drop"], "read": "CI_high",
                 "healthy_if_leq": rt["drop"]["healthy_if_leq"],
                 "within_band": metrics["catalog_closet_drop"]["high"] <= rt["drop"]["healthy_if_leq"]},
        "closet_floor": {"ci": metrics["AUC_closet_pair"], "read": "CI_low",
                         "healthy_if_geq": rt["closet_floor"]["healthy_if_geq"],
                         "within_band": metrics["AUC_closet_pair"]["low"] >= rt["closet_floor"]["healthy_if_geq"]},
    }

    # §C.6 popularity-confound label (the diagnostic trigger reads the AUC point vs the blind margin).
    margin = prereg["analyst_pins"]["popularity_confound_response"]["blind_margin_auc"]
    pop_triggered = (metrics["AUC_pop_edge"]["point"] > margin
                     or metrics["AUC_pop_outfit"]["point"] > margin)

    # §C.8 pre-committed response: coherence-sensitive label iff the coherent-slice gate-B verdict
    # (same mechanical legs, adjudicating convention) disagrees with the headline gate-B verdict.
    coherent_slice_ci = (metrics.get("coherence_sensitivity") or {}).get("gate_B_diff_inconsistent_miss_coherent")
    coherent_state = b_leg(coherent_slice_ci)["state"] if coherent_slice_ci else None
    coherence_sensitive = coherent_state is not None and coherent_state != b_miss["state"]

    # §C.2/§C.5 seam claim (descriptive corroboration, not a gate).
    seam_p = metrics.get("seam_holm_adjusted_p")
    seam_ci = metrics["seam_diff_pairwise_minus_item_level"]
    alpha = prereg["analyst_pins"]["family_wise_correction"]["alpha_fw"]
    seam_falsified = seam_p is not None and seam_p < alpha and seam_ci["low"] > 0

    return {
        "verdict": verdict,
        "A": {"ci": a_ci, "threshold": g["A"]["threshold"], "pass": a_pass},
        "B": {"delta": delta, "adjudication_convention": g["B"]["adjudication_convention"],
              "miss": b_miss, "half": b_half, "pass": b_pass,
              "conventions_agree": b_miss["state"] == b_half["state"],
              "power_margin_miss": b_miss["half_width"] - delta,
              "vacuous": b_vacuous},
        "D": {"legs": d_legs, "pass": d_pass},
        "reported_transfer": transfer,
        "popularity_confounded_disclosed": pop_triggered,
        "coherence_sensitive_disclosed": coherence_sensitive,
        "coherent_slice_gate_b_state": coherent_state,
        "seam": {"holm_adjusted_p": seam_p, "ci": seam_ci,
                 "item_level_falsified": seam_falsified},
        "seed_robustness_agree": (metrics.get("seed_robustness") or {}).get("verdicts_agree"),
    }


def _print_verdict(v: dict) -> None:
    a, b_, d = v["A"], v["B"], v["D"]
    print(f"[h26 C6] ===== MECHANICAL VERDICT (A AND B AND D): {v['verdict']} =====")
    print(f"  [A] added value: CI_low {a['ci']['low']:+.4f} > {a['threshold']} -> {'PASS' if a['pass'] else 'FAIL'}")
    m = b_["miss"]
    print(f"  [B] FITB non-inferiority vs judge (adjudication: inconsistent=miss, delta={b_['delta']}):")
    print(f"      miss: CI [{m['ci']['low']:+.4f}, {m['ci']['high']:+.4f}] "
          f"(CI_low >= -delta: {'yes' if m['non_inferiority'] else 'NO'}); "
          f"half-width {m['half_width']:.6f} {'<=' if m['powered'] else '>'} delta -> state: {m['state'].upper()}")
    h = b_["half"]
    print(f"      half (cross-check): CI [{h['ci']['low']:+.4f}, {h['ci']['high']:+.4f}]; "
          f"half-width {h['half_width']:.6f} -> state: {h['state'].upper()}")
    if not m["powered"]:
        print(f"      power letter-check: half-width exceeds delta by {b_['power_margin_miss']:+.6f} "
              f"at the frozen N cap -> gate B = 'underpowered / inconclusive' -> no-go "
              f"(preregistration.md §B, applied verbatim; delta never widens, N is capped)")
    print(f"      conventions agree: {b_['conventions_agree']}; vacuity: "
          f"{'VACUOUS (judge ~ chance)' if b_['vacuous'] else 'non-vacuous (judge above chance@4)'}")
    for metric_name, leg in d["legs"].items():
        print(f"  [D] {metric_name}: CI_low {leg['ci']['low']:.4f} >= {leg['floor']} -> "
              f"{'PASS' if leg['pass'] else 'FAIL'}")
    t = v["reported_transfer"]
    print("  Reported transfer (former gate C — descriptive, NOT in the AND-gate):")
    print(f"      drop CI_high {t['drop']['ci']['high']:.4f} vs band <= {t['drop']['healthy_if_leq']}: "
          f"{'within' if t['drop']['within_band'] else 'OUTSIDE'} band")
    print(f"      closet AUC CI_low {t['closet_floor']['ci']['low']:.4f} vs band >= "
          f"{t['closet_floor']['healthy_if_geq']}: "
          f"{'within' if t['closet_floor']['within_band'] else 'OUTSIDE'} band (M6 re-measure entry condition)")
    print(f"  Labels: popularity-confounded (disclosed): {v['popularity_confounded_disclosed']}; "
          f"coherence-sensitive (disclosed): {v['coherence_sensitive_disclosed']}")
    s = v["seam"]
    if s["holm_adjusted_p"] is not None:
        print(f"  Seam (§C.2): Holm p = {s['holm_adjusted_p']:.6g}, CI_low {s['ci']['low']:+.4f} -> "
              f"item-level {'FALSIFIED on our data' if s['item_level_falsified'] else 'not decisively falsified'}")
    if v["seed_robustness_agree"] is not None:
        print(f"  3-seed robustness footnote: verdicts agree across seeds: {v['seed_robustness_agree']}")


# --------------------------------------------------------------------------- #
# RUN-phase orchestration (needs the built cache + the committed freeze — gated by B1-B3)
# --------------------------------------------------------------------------- #
def materialize_metrics_json(
    *,
    arm: str,
    ledger_path: str,
    gate_b_n: int,
    root_dir: str = ROOT_DIR,
    seed: int = SEED,
    b: int = 10_000,
    git: GitInfo | None = None,
) -> dict:
    """The real C4 emission (RUN phase — only after kickoff B1-B3 clear). Re-derives BOTH heads
    deterministically (binding the pairwise checkpoint to the sealed `selection.json` sha), computes the
    full metric suite, re-verifies the gate-B prefix is a prefix of the frozen `fitb_order.json`, scores
    the trained head + reads the judge ledger over that prefix, and emits `metrics.json` through the
    gated `emit_metrics`. Heavy deps (torch / cache) are imported here, so the module stays importable
    for the hermetic unit suite."""
    import fitb_order
    from data_loader import build_fitb, load_headline_corpus
    from embed import HEADLINE, load_cache
    from train_head import ItemLevelHead, PairwiseEdgeHead, checkpoint_sha256
    from train_head import run as train_run

    # The gate-B metrics.json fields ARE the frozen headline arm by definition (§1/§8/§12) — the
    # ablation arms (image_title/text_attribute) are reported in results.md, never through the gate.
    prereg = load_json_strict(os.path.join(root_dir, "preregistration.json"))
    headline_arm = prereg["headline_cell"]["judge"]["arm"]
    if arm != headline_arm:
        raise UnlockError(
            f"gate-B emission arm {arm!r} != the frozen headline_cell.judge.arm {headline_arm!r}; the "
            f"gated metrics.json fields must be the headline arm (ablation arms go in results.md only)"
        )
    # K + the dated snapshot are frozen in the judge addendum — pass them as the ledger completeness (§8
    # exactly-K) + provenance (§8 snapshot-does-not-move) checks. (The addendum is fully schema-validated
    # in emit_metrics -> validate_unlock_files; here we only read the two values the ledger must match.)
    envelope = extract_envelope(_read_text(os.path.join(root_dir, "judge_addendum.md")))
    k_samples = envelope.get("k_samples")
    model_snapshot = envelope.get("model_snapshot")

    selection = load_json_strict(os.path.join(root_dir, "selection.json"))
    order = load_json_strict(os.path.join(root_dir, "fitb_order.json"))
    cap = order["gate_b_cap"]
    if not 1 <= gate_b_n <= cap:
        raise ValueError(f"gate_b_n {gate_b_n} must be in [1, {cap}] (a prefix of the frozen gate-B order)")

    # --- PREFLIGHT before the multi-hour retrain (Task 8B / §8 / §12) ---------------------------------
    # Fail fast: the full four-file unlock must validate AND the gate-B ledger must be committed-clean
    # BEFORE re-deriving both heads (hours) — refuse a bad freeze up front, never after the compute is
    # spent. `assert_ledger_committed` also returns the ledger sha256 that binds the emitted gate-B
    # numbers to the exact committed bytes (`metrics.json._meta.judge_ledger_sha256`). `emit_metrics`
    # re-runs `validate_unlock_files` at write time; running it here too is cheap + idempotent.
    git = git or RealGit(root_dir)
    validate_unlock_files(root_dir, git)
    ledger_sha = assert_ledger_committed(root_dir, ledger_path, git=git)
    print(  # the ONE emit warning (Task 3) — printed only AFTER the preflight passes, before any heavy work
        "[emit] re-deriving BOTH heads over the frozen 6-config grid (12 trainings x up to 50 epochs, "
        "single-thread — HOURS) + the ~50-min metric suite (B=10,000 cluster bootstraps). Expected; do "
        "NOT interrupt."
    )

    cache = load_cache(HEADLINE)
    corpus = load_headline_corpus(verbose=False)
    fitb_order.verify_fitb_order(order, corpus)  # the gate-B prefix binds the SAME frozen order

    c3 = train_run(cache, corpus, seed=seed, write=False)  # deterministic re-derivation of both heads
    if checkpoint_sha256(c3.pairwise.best_state) != selection["checkpoint_sha256"]:
        raise UnlockError("re-derived pairwise checkpoint does not match the sealed selection.json sha")
    pw, il = PairwiseEdgeHead(), ItemLevelHead()
    pw.load_state_dict(c3.pairwise.best_state)
    il.load_state_dict(c3.item_level.best_state)

    suite = compute_metric_suite(cache, corpus, pw, il, seed=seed, b=b)
    questions, _ = build_fitb(corpus.splits["test"], corpus.item_index, seed)
    # Mechanical blindness check on the FULL gate-D FITB set (the corpus is available here): the human
    # calibration set that tuned the judge must touch NO gated question (§1/§8/§F). validate_unlock_files
    # also enforces the gate-B subset hermetically; this is the complete superset check.
    assert_gate_d_disjoint(root_dir, envelope, {q.set_id for q in questions}, git=git)
    gate_b_questions = questions[:gate_b_n]
    if [q.set_id for q in gate_b_questions] != order["gate_b_set_ids"][:gate_b_n]:
        raise UnlockError(  # bind the EMITTED prefix to the frozen order explicitly (not just via seed ==)
            "gate-B prefix set_ids do not match the frozen fitb_order.json['gate_b_set_ids'] — the seed/"
            "constructor drifted; the emitted gate-B number would bind the wrong questions (§12 tripwire)"
        )
    edge_score = head_edge_scorer(pw, cache, corpus.item_index)
    # Re-verify the ledger is UNCHANGED + still committed-clean immediately before consuming it: the retrain
    # took hours, so bind metrics.json._meta.judge_ledger_sha256 to the bytes actually scored below, never
    # the stale preflight sha (§8/§12 provenance race). Both consumers (compute_gate_b + coherence) read
    # the rows produced here, after this check.
    ledger_sha_consumed = assert_ledger_unchanged_since_preflight(root_dir, ledger_path, ledger_sha, git=git)
    ledger_rows = read_ledger(ledger_path)
    gate_b = compute_gate_b(
        gate_b_questions, edge_score, ledger_rows, arm=arm, seed=seed, b=b,
        expected_k=k_samples, expected_snapshot=model_snapshot,
    )
    coherence = compute_coherence_sensitivity(
        gate_b_questions, questions, corpus.item_index, edge_score, ledger_rows,
        arm=arm, seed=seed, b=b, expected_k=k_samples,
    )
    return emit_metrics(suite, gate_b, root_dir=root_dir, git=git, seed=seed, coherence=coherence,
                        judge_ledger_sha256=ledger_sha_consumed)


def main(argv: Sequence[str] | None = None) -> None:
    """`evaluate.py` is a library plus two post-unlock CLI verbs. The real `metrics.json`
    materialization (`materialize_metrics_json`) is gated on the built embedding cache + the
    committed four-file freeze (kickoff B1-B3) and is invoked by the RUN-phase driver, not here —
    there is no entrypoint that emits or prints a model number before the unlock (the §1 blindness
    boundary). `merge-closet` folds the C5 `closet_metrics.json` into the already-emitted
    `metrics.json` (§15 artifact dataflow). `argv` defaults to no command (the explainer) — the
    script entry below passes the real `sys.argv`, so a library call to `main()` never picks up a
    host process's arguments."""
    argv = list(argv or ())
    if argv == ["merge-closet"]:
        merged = merge_closet_metrics()
        a, d = merged["AUC_closet_pair"], merged["catalog_closet_drop"]
        print(f"[h26 C5] merged closet/transfer fields into metrics.json (stage {merged['_meta']['stage']})")
        print(f"[h26 C5] AUC_closet_pair = {a['point']:.4f} [{a['low']:.4f}, {a['high']:.4f}]  "
              f"(reference band: CI_low >= 0.70, descriptive)")
        print(f"[h26 C5] catalog_closet_drop = {d['point']:.4f} [{d['low']:.4f}, {d['high']:.4f}]  "
              f"(reference band: CI_high <= 0.12, descriptive)")
        return
    if argv:
        raise SystemExit(f"unknown evaluate.py command {argv!r} (known: merge-closet)")
    print(
        "[h26 C4] evaluate.py = the metric-computation half (C3) + the gated emission half (C4). "
        "metrics.json first materializes via materialize_metrics_json ONLY after the four unlock files "
        "(preregistration.md/.json + judge_addendum.md + closet_manifest.json) are committed and "
        "validate, the sealed selection.json binds, and the judge ledger exists (§1/§12/§15). No "
        "test-set number is materialized until then. Post-unlock commands: merge-closet (C5)."
    )


if __name__ == "__main__":
    import sys

    main(sys.argv[1:])
