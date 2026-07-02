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
    # Popularity-confound diagnostics (§C.6)
    AUC_pop_edge: CI
    AUC_pop_outfit: CI
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

    # Popularity-confound diagnostics (§C.6 — no embeddings)
    pop = split_data.popularity
    pe_pos, pe_neg = popularity_edge_scores(clusters, pop)
    po_pos, po_neg = popularity_outfit_scores(outfit_pairs, pop)
    auc_pop_edge = auc_ci(pe_pos, pe_neg, seed=seed, b=b)
    auc_pop_outfit = auc_ci(po_pos, po_neg, seed=seed, b=b)

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
        str(g["A"]["threshold"]),                       # 0.0
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
    written = {"0.5": "0.50", "0.7": "0.70", "0.0": "0.0"}
    for lit in required_literals:
        if lit not in md and written.get(lit, lit) not in md:
            raise UnlockError(
                f"preregistration.json / .md disagree: the frozen literal {lit!r} is in the .json "
                f"mirror but not the .md authority (§1 — the two must agree)"
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
        if not qs:
            out[f"gate_B_diff_inconsistent_miss_{name}"] = None
            out[f"gate_B_diff_inconsistent_half_{name}"] = None
            out[f"judge_inconsistent_rate_{name}"] = None
            continue
        per_question = group_samples(ledger_rows, qs, arm=arm, expected_k=expected_k)
        gb = gate_b_verdicts(per_question)
        kept = set(gb.kept_question_ids)
        kept_qs = [q for q in qs if q.set_id in kept]
        trained_hits = fitb_hits(kept_qs, edge_score)
        out[f"gate_B_diff_inconsistent_miss_{name}"] = _ci(two_stage_paired_fitb_diff_ci(
            trained_hits, gb.verdicts, gb.samples_by_id, convention=INCONSISTENT_MISS, seed=seed, b=b))
        out[f"gate_B_diff_inconsistent_half_{name}"] = _ci(two_stage_paired_fitb_diff_ci(
            trained_hits, gb.verdicts, gb.samples_by_id, convention=INCONSISTENT_HALF, seed=seed, b=b))
        n_inconsistent = sum(1 for v in gb.verdicts if v.status == "inconsistent")
        out[f"judge_inconsistent_rate_{name}"] = (
            n_inconsistent / len(gb.verdicts) if gb.verdicts else None)
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
) -> dict:
    """Map the in-memory CI suite + the gate-B judge comparison to the `metrics.schema.json` field set.
    Emits the C4 required set (gate A/B/D) plus the always-available diagnostics + seam pair-level fields
    (load-bearing for the C6 mandatory popularity re-run + the seam verdict). The closet/transfer fields
    stage to C5 and `seam_holm_adjusted_p` to C6 (the family-wise correction over the executed ablation
    family), so they are deliberately absent at stage C4 (schema-legal — optional until C5/C6)."""
    return {
        "_meta": {
            "stage": stage,
            "seed": seed,
            "split_loader": SPLIT_LOADER,
            "git_commit": git_commit,
            "unlock_files": unlock_files,
            "selection": selection_meta,
        },
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
        # Popularity-confound diagnostics (§C.6 — load-bearing for the C6 mandatory sensitivity re-run)
        "AUC_pop_edge": _ci(suite.AUC_pop_edge),
        "AUC_pop_outfit": _ci(suite.AUC_pop_outfit),
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
) -> dict:
    """First-emit `metrics.json` — but ONLY after the four-file unlock validates (§1/§12). Validates the
    unlock files (every freeze file must be committed-clean — no bypass) + binds the sealed selection,
    assembles the field set, **re-validates it against `metrics.schema.json`**, then writes. Any
    `UnlockError` from the gate means no file is written, so a held-out test-set number never reaches
    disk while the freeze is incomplete (the blindness teeth)."""
    git = git or RealGit(root_dir)
    unlock_files, selection_meta = validate_unlock_files(root_dir, git)
    metrics = assemble_metrics(
        suite, gate_b, unlock_files=unlock_files, selection_meta=selection_meta,
        git_commit=git.head_commit(), seed=seed, stage=stage, coherence=coherence,
    )
    _validate_against_schema(metrics, os.path.join(root_dir, METRICS_SCHEMA), what="assembled metrics.json")
    out_path = out_path or os.path.join(root_dir, "metrics.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(metrics, f, indent=2)
    return metrics


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
    ledger_rows = read_ledger(ledger_path)
    gate_b = compute_gate_b(
        gate_b_questions, edge_score, ledger_rows, arm=arm, seed=seed, b=b,
        expected_k=k_samples, expected_snapshot=model_snapshot,
    )
    coherence = compute_coherence_sensitivity(
        gate_b_questions, questions, corpus.item_index, edge_score, ledger_rows,
        arm=arm, seed=seed, b=b, expected_k=k_samples,
    )
    return emit_metrics(suite, gate_b, root_dir=root_dir, git=git, seed=seed, coherence=coherence)


def main() -> None:
    """`evaluate.py` is a library: the C3 computation half + the C4 gated emission half above. The real
    `metrics.json` materialization (`materialize_metrics_json`) is gated on the built embedding cache +
    the committed four-file freeze (kickoff B1-B3) and is invoked by the RUN-phase driver, not here —
    there is no entrypoint that emits or prints a model number before the unlock (the §1 blindness boundary)."""
    print(
        "[h26 C4] evaluate.py = the metric-computation half (C3) + the gated emission half (C4). "
        "metrics.json first materializes via materialize_metrics_json ONLY after the four unlock files "
        "(preregistration.md/.json + judge_addendum.md + closet_manifest.json) are committed and "
        "validate, the sealed selection.json binds, and the judge ledger exists (§1/§12/§15). No "
        "test-set number is materialized until then."
    )


if __name__ == "__main__":
    main()
