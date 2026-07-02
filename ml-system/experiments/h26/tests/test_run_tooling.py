"""Hermetic tests for the RUN-phase tooling (Steps 2-4) — no parquet, no network, no OpenAI.

Covers the PURE logic: the live content assembly (bytes+metadata -> ItemContent, egress-shaped per arm),
the calibration draw (valid/train-sourced -> disjoint from the test gate sets) + panel answer aggregation
(plurality/skip/drop + inter-annotator agreement), the closet assembler (plain labels -> a schema-valid closet_manifest.json +
the C4 referential checks + the mandatory label-audit block), and the live-judge DRIVER's blindness-critical
pure wiring (run_judge.pilot_summary / gate_b_summary / require_frozen_envelope). The parquet/OpenAI I/O in
these modules is exercised only by the RUN-phase commands, never here.
"""

import base64
import json
import os
import shutil

import pytest

import assemble_closet as ac
import make_calibration as mc
import run_judge as rj
from coherence import fitb_question_is_coherent
from data_loader import Corpus, FitbQuestion, Item, build_fitb, make_split_data
from gpt_judge import QuestionSamples
from live_content import item_content_from
from synthetic import make_corpus
from test_evaluate_emission import FakeGit, _addendum_md, _frozen_envelope

H26 = os.path.dirname(os.path.dirname(__file__))


# --------------------------------------------------------------------------- #
# live_content.item_content_from (pure)
# --------------------------------------------------------------------------- #
def test_item_content_from_encodes_image_and_surfaces_metadata():
    ic = item_content_from("i1", b"\xff\xd8jpegbytes", {"url_name": "navy oxford", "semantic_category": "tops"})
    assert base64.b64decode(ic.image_b64) == b"\xff\xd8jpegbytes"
    assert ic.title == "navy oxford"
    assert ic.attributes["category"] == "tops" and ic.attributes["name"] == "navy oxford"


def test_item_content_from_handles_empty_title_and_no_image():
    ic = item_content_from("i2", None, {"url_name": "", "title": "", "semantic_category": "shoes"})
    assert ic.image_b64 is None and ic.title is None      # empty title stays None (not "")
    assert ic.attributes["category"] == "shoes"


# --------------------------------------------------------------------------- #
# make_calibration — the draw is disjoint-by-construction + answers assemble
# --------------------------------------------------------------------------- #
def test_calibration_questions_are_disjoint_from_the_test_set():
    corpus = make_corpus(seed=1)
    qs = mc.build_calibration_questions(corpus, n=10, seed=99)
    cal_ids = {q.set_id for q in qs}
    test_ids = {o.set_id for o in corpus.splits["test"].outfits}
    assert len(qs) == 10
    assert cal_ids.isdisjoint(test_ids)                   # valid/train-sourced -> never a test (gated) question


def _pad_questions(n):
    return [FitbQuestion(f"p{i}", ("r",), ("a", "b", "c", "d"), 0, "11") for i in range(n)]


def test_assemble_panel_plurality_skips_and_drops():
    qs = [
        FitbQuestion("s1", ("r",), ("a", "b", "c", "d"), 0, "11"),   # A,A,B -> plurality A
        FitbQuestion("s2", ("r",), ("a", "b", "c", "d"), 2, "11"),   # A,B over 2 confident -> tie -> dropped
        FitbQuestion("s3", ("r",), ("a", "b", "c", "d"), 1, "11"),   # 1 confident -> dropped
    ] + _pad_questions(60)                                            # pad past the >=50 survivor floor
    padded = {f"p{i}": "A" for i in range(60)}
    a = {**padded, "s1": "A", "s2": "A", "s3": "A"}
    b = {**padded, "s1": "A", "s2": "B", "s3": "SKIP"}
    c = {**padded, "s1": "B", "s2": "SKIP", "s3": "SKIP"}
    manifest = mc.assemble_panel(qs, {"alice": a, "bob": b, "cara": c})
    assert manifest["single_annotator"] is False and manifest["n_annotators"] == 3
    kept = {q["set_id"]: q["human_choice"] for q in manifest["questions"]}
    assert kept["s1"] == 0                                            # plurality A,A,B -> A(0)
    assert "s2" not in kept and "s3" not in kept                      # tie + too-few-confident both dropped
    assert manifest["dropped_detail"] == {"too_few_confident": 1, "tie": 1}
    assert manifest["question_ids"] == list(kept)                     # ids track the surviving questions
    assert manifest["per_labeler_skip_rate"]["cara"] > 0             # abstentions are reported, not penalized


def test_assemble_panel_requires_three_labelers_and_the_survivor_floor():
    qs = _pad_questions(60)
    votes = {q.set_id: "A" for q in qs}
    with pytest.raises(ValueError, match="needs >= 3 labelers"):
        mc.assemble_panel(qs, {"alice": votes, "bob": votes})        # 2 labelers -> fail loud
    allskip = {q.set_id: "SKIP" for q in qs}                          # 3 labelers but all abstain -> 0 survivors
    with pytest.raises(ValueError, match="reached panel consensus"):
        mc.assemble_panel(qs, {"a": allskip, "b": allskip, "c": allskip})


def test_inter_annotator_agreement_is_pairwise_over_co_confident():
    qs = [FitbQuestion("s1", ("r",), ("a", "b", "c", "d"), 0, "11"),
          FitbQuestion("s2", ("r",), ("a", "b", "c", "d"), 0, "11")]
    a = {"s1": "A", "s2": "A"}
    b = {"s1": "A", "s2": "B"}
    c = {"s1": "B", "s2": "SKIP"}    # c abstains on s2 -> that pair is excluded, not counted as a miss
    # s1 pairs: (a,b)match,(a,c)no,(b,c)no = 1/3 ; s2 pairs (c skipped): (a,b)no = 0/1 ; total 1 of 4
    assert mc.inter_annotator_agreement({"a": a, "b": b, "c": c}, qs) == pytest.approx(1 / 4)


# --------------------------------------------------------------------------- #
# make_calibration — the §F pre-draw filters (coherence + visual-QC excludes, amendment 2026-07-01)
# --------------------------------------------------------------------------- #
def _handcrafted_corpus():
    """synthetic.make_corpus only generates COHERENT outfits, so the draw-filter tests build their own
    splits carrying deliberately incoherent Polyvore-board-style sets (two shoes / dress+bottom)
    alongside clean ones. 20 items per category so `build_fitb` always finds 3 same-category
    distractors; every outfit's full item set IS the retained+answer set, so the outfit's coherence
    decides the question's flag no matter which item build_fitb holds out."""
    cat_types = {"TC": "top", "BC": "bottom", "SC": "shoes", "DC": "dress", "OC": "outer_layer"}
    item_index, pools = {}, {}
    for cat, typ in cat_types.items():
        pools[cat] = [f"{cat.lower()}{k}" for k in range(20)]
        for iid in pools[cat]:
            item_index[iid] = Item(item_id=iid, category_id=cat, semantic=typ, type=typ)
    coherent = [(f"ok-{k}", [pools["TC"][k], pools["BC"][k], pools["SC"][k]]) for k in range(12)]
    incoherent = []
    for k in range(4):
        incoherent.append((f"twoshoes-{k}", [pools["SC"][k], pools["SC"][k + 6], pools["TC"][k + 12]]))
        incoherent.append((f"dresspants-{k}", [pools["DC"][k], pools["BC"][k + 6], pools["SC"][k + 12]]))
    splits = {
        "train": make_split_data("train", coherent[:6] + incoherent[:4], item_index),
        "valid": make_split_data("valid", coherent[6:] + incoherent[4:], item_index),
        "test": make_split_data("test", [], item_index),
    }
    type_map = {cat: {"type": typ} for cat, typ in cat_types.items()}
    return Corpus(item_index=item_index, type_map=type_map, splits=splits, data_root="<synthetic>")


def test_build_calibration_questions_filters_incoherent_questions():
    corpus = _handcrafted_corpus()
    # vacuity guard: the RAW pool genuinely contains incoherent questions the filter must remove
    raw = []
    for split in ("valid", "train"):
        qs, _ = build_fitb(corpus.splits[split], corpus.item_index, 7)
        raw.extend(qs)
    assert any(not fitb_question_is_coherent(q, corpus.item_index) for q in raw)
    picked = mc.build_calibration_questions(corpus, n=8, seed=7, excluded_items=set())
    assert len(picked) == 8
    assert all(q.set_id.startswith("ok-") for q in picked)        # no board-artifact outfit survives
    assert all(fitb_question_is_coherent(q, corpus.item_index) for q in picked)


def test_build_calibration_questions_never_draws_excluded_items():
    corpus = _handcrafted_corpus()
    unfiltered = mc.build_calibration_questions(corpus, n=6, seed=7, excluded_items=set())
    victim = unfiltered[0].retained[0]                            # provably drawn -> the exclude must bite
    picked = mc.build_calibration_questions(corpus, n=6, seed=7, excluded_items={victim})
    assert all(victim not in (*q.retained, *q.candidates) for q in picked)
    assert picked != unfiltered


def test_build_calibration_questions_draw_is_deterministic():
    corpus = _handcrafted_corpus()
    a = mc.build_calibration_questions(corpus, n=8, seed=7, excluded_items=set())
    b = mc.build_calibration_questions(corpus, n=8, seed=7, excluded_items=set())
    assert [(q.set_id, q.retained, q.candidates, q.correct_index) for q in a] == \
           [(q.set_id, q.retained, q.candidates, q.correct_index) for q in b]


# --------------------------------------------------------------------------- #
# assemble_closet — plain labels -> a schema-valid manifest + referential checks
# --------------------------------------------------------------------------- #
def _real_category(clothing_type):
    ref = json.load(open(os.path.join(H26, "closet_category_reference.json"), encoding="utf-8"))["categories"]
    return next(cid for cid, r in ref.items() if r["type"] == clothing_type)


def _closet_input(tmp, cats):
    for name in ("c001.jpg", "c014.jpg"):
        (tmp / name).write_bytes(b"\xff\xd8fakephoto" + name.encode())
    return {
        "owner_id": "owner-x",
        "consent": {"owner_id": "owner-x", "third_party_api_processing": False, "providers_photos_may_reach": []},
        "label_audit": {"second_pass_completed": True, "items_rechecked": 2, "agreement_rate": 1.0},
        "outfits": [{"set_id": "o01", "items": [
            {"item_id": "c001", "clothing_type": "top", "polyvore_category_id": cats[0],
             "fine_label_human": "navy oxford", "photo": "c001.jpg", "coarsening_note": None},
            {"item_id": "c014", "clothing_type": "bottom", "polyvore_category_id": cats[1],
             "fine_label_human": "grey chinos", "photo": "c014.jpg", "coarsening_note": None},
        ]}],
    }


def test_assemble_closet_builds_a_valid_manifest(tmp_path):
    cats = [_real_category("top"), _real_category("bottom")]
    manifest = ac.assemble_closet(_closet_input(tmp_path, cats), closet_dir=str(tmp_path))
    assert len(manifest["items"]) == 2 and manifest["outfits"][0]["item_ids"] == ["c001", "c014"]
    assert all(len(it["photo_sha256"]) == 64 for it in manifest["items"])
    assert manifest["items"][0]["photo_path"] == "closet/c001.jpg"
    ac.validate(manifest, root_dir=H26)                   # schema + C4 referential checks pass


def test_assemble_closet_rejects_bad_type_and_category(tmp_path):
    cats = [_real_category("top"), _real_category("bottom")]
    bad_type = _closet_input(tmp_path, cats)
    bad_type["outfits"][0]["items"][0]["clothing_type"] = "hat"
    with pytest.raises(ValueError, match="invalid clothing_type"):
        ac.assemble_closet(bad_type, closet_dir=str(tmp_path))
    bad_cat = _closet_input(tmp_path, ["9999", cats[1]])
    with pytest.raises(ValueError, match="absent from the reference"):
        ac.assemble_closet(bad_cat, closet_dir=str(tmp_path))


def test_assemble_closet_requires_coarsening_note_for_null_category(tmp_path):
    cats = [_real_category("top"), _real_category("bottom")]
    ci = _closet_input(tmp_path, cats)
    ci["outfits"][0]["items"][0]["polyvore_category_id"] = None   # no analog, but no note -> fail loud
    with pytest.raises(ValueError, match="coarsening_note"):
        ac.assemble_closet(ci, closet_dir=str(tmp_path))


def test_assemble_closet_requires_explicit_label_audit(tmp_path):
    # §10 integrity: omitting label_audit must FAIL LOUD, never silently default to a passing audit
    # (second_pass_completed=True / agreement_rate=1.0) — that would let the committed manifest assert an
    # audit that never happened.
    cats = [_real_category("top"), _real_category("bottom")]
    ci = _closet_input(tmp_path, cats)
    del ci["label_audit"]
    with pytest.raises(ValueError, match="explicit label_audit"):
        ac.assemble_closet(ci, closet_dir=str(tmp_path))
    ci2 = _closet_input(tmp_path, cats)
    ci2["label_audit"] = {"second_pass_completed": True}          # partial block -> still fail loud
    with pytest.raises(ValueError, match="explicit label_audit"):
        ac.assemble_closet(ci2, closet_dir=str(tmp_path))


# make_calibration.restability was removed with the single-annotator path; the panel's human-agreement
# ceiling is inter_annotator_agreement (tested above), not a self-relabel check.


# --------------------------------------------------------------------------- #
# run_judge pure wiring — the blindness-critical pilot/gate-b summaries + the freeze gate
# --------------------------------------------------------------------------- #
def _consistent_samples(qid, pick, correct):
    # both orders agree on canonical `pick` (forward=pick, reverse=n-1-pick) -> a consistent verdict.
    n = 4
    return QuestionSamples(qid, (pick, pick, pick), (n - 1 - pick, n - 1 - pick, n - 1 - pick), correct, n)


def test_pilot_summary_scores_human_not_polyvore():
    # THE blindness-critical split (§F): human-agreement counts judge-vs-YOUR-label, above-chance counts
    # judge-vs-Polyvore-answer — a mutation swapping them must change the counts. q1: judge picks 0, human
    # 0 (agree), correct 0 (also poly-correct). q2: judge picks 0, human 0 (agree), correct 1 (poly-wrong).
    per_q = [_consistent_samples("q1", 0, 0), _consistent_samples("q2", 0, 1)]
    human = {"q1": 0, "q2": 0}
    r = rj.pilot_summary(per_q, human)
    assert r["consistent"] == 2
    assert r["agree"] == 2               # both match the human label
    assert r["correct_vs_polyvore"] == 1  # only q1 matches the Polyvore answer -> the swap-mutation flips this


def test_pilot_summary_counts_dropped_and_inconsistent():
    per_q = [
        _consistent_samples("q1", 0, 0),
        QuestionSamples("q2", (None,), (3,), 0, 4),        # forward all-None -> dropped
        QuestionSamples("q3", (0, 0, 0), (0, 0, 0), 0, 4),  # reverse canonical 3 != 0 -> inconsistent
    ]
    r = rj.pilot_summary(per_q, {"q1": 0})                 # human only needs the consistent question
    assert r["dropped"] == 1 and r["inconsistent"] == 1 and r["consistent"] == 1 and r["n"] == 3


def test_gate_b_summary_counts_above_chance_hits():
    per_q = [_consistent_samples("q1", 0, 0), _consistent_samples("q2", 0, 1),
             QuestionSamples("q3", (None,), (3,), 0, 4)]
    r = rj.gate_b_summary(per_q)
    assert r["correct"] == 1 and r["consistent"] == 2 and r["dropped"] == 1 and r["n"] == 3


def _frozen_addendum_dir(tmp_path, *, frozen=True):
    root = tmp_path / "h26"
    root.mkdir()
    shutil.copy(os.path.join(H26, "judge_addendum.schema.json"), root / "judge_addendum.schema.json")
    env = _frozen_envelope()
    if not frozen:
        env["frozen"] = False
    (root / "judge_addendum.md").write_text(_addendum_md(env), encoding="utf-8")
    return str(root)


def test_require_frozen_envelope_accepts_committed_frozen(tmp_path):
    root = _frozen_addendum_dir(tmp_path)
    env = rj.require_frozen_envelope(root_dir=root, git=FakeGit())
    assert env["k_samples"] == 3 and env["model_snapshot"] == "gpt-5.4-mini-2026-03-17"


def test_require_frozen_envelope_refuses_scaffold(tmp_path):
    # the committed SCAFFOLD (frozen:false) must be refused BEFORE any gate-B spend (§1 build-order teeth)
    root = _frozen_addendum_dir(tmp_path, frozen=False)
    with pytest.raises(SystemExit, match="FROZEN"):
        rj.require_frozen_envelope(root_dir=root, git=FakeGit())


def test_require_frozen_envelope_refuses_uncommitted(tmp_path):
    # frozen-in-working-tree but NOT committed -> refuse (the judge freeze must provably precede gate-b)
    root = _frozen_addendum_dir(tmp_path)
    with pytest.raises(SystemExit, match="committed-clean"):
        rj.require_frozen_envelope(root_dir=root, git=FakeGit(committed=False))


def test_cmd_gate_b_refuses_scaffold_before_any_spend():
    # The gate-b HANDLER's first act must be the freeze gate (require_frozen_envelope), BEFORE it builds a
    # provider/client or loads the dataset — else a held-out-test judge number could be produced off an
    # unfrozen addendum. Driving the REAL cmd_gate_b against the committed SCAFFOLD (guaranteed frozen:false
    # by test_committed_judge_addendum_is_still_a_scaffold) pins that ordering: it must raise the freeze
    # refusal, not fail later on a provider/dataset access. A regression moving run_arm before the guard
    # would raise a different error here (mutation guard for the gate-b build-order teeth).
    from types import SimpleNamespace

    with pytest.raises(SystemExit, match="FROZEN"):
        rj.cmd_gate_b(SimpleNamespace(n=100))
