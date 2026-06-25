"""C6 tests — the eval harness, golden corpus, metrics, attribution (spearhead.md §C C6, §E).

Hermetic: every test drives the harness with a ``ReplayGenerator`` / ``StubGenerator`` — no
live OpenAI, ever (§A/§I). The corpus's own ``canned_response`` is the replay source, so the
golden cases double as ``StubGenerator`` regression fixtures (§E "live findings flow back into
the hermetic suite").

Gate (§C C6): the corpus runs through the real validator; the mechanical metrics are computed;
failures are attributed to their stage externally (§E option a) without widening RescueResult;
the harness product equals ``rescue()`` (no drift) and is deterministic.
"""

from pathlib import Path

import pytest

from fitted_core.evaluation import (
    AggregateMetrics,
    BelievabilityRubric,
    RecordingGenerator,
    RUBRIC_QUESTIONS,
    aggregate,
    evaluate_case,
    format_aggregate,
    format_evaluation,
    load_corpus_case,
    load_corpus_dir,
    render_rubric_template,
    replay_generator_for,
)
from fitted_core.generation import Generator, ReplayGenerator
from fitted_core.models import ItemType, Role, WardrobeItem
from fitted_core.rescue import RescueRequest, rescue
from tests.helpers import StubGenerator

CORPUS_DIR = Path(__file__).parent / "fixtures" / "corpus"


def _case(name: str):
    return load_corpus_case(CORPUS_DIR / f"{name}.json")


def _gen(case) -> ReplayGenerator:
    """A fresh replay generator over the case's canned response (state-free per call)."""
    return replay_generator_for(case)


# ============================================================================
# corpus loading
# ============================================================================


def test_load_corpus_case_parses_request_and_canned():
    case = _case("green_shirt")
    assert case.case_id == "green_shirt"
    assert isinstance(case.request, RescueRequest)
    assert case.request.forced_item_id == "t-green"
    assert case.request.weather == "mild"
    assert case.request.k == 10 and case.request.n_surfaced == 3  # defaults applied
    assert {it.id for it in case.request.wardrobe} >= {"t-green", "b-khaki"}
    assert case.canned_response is not None  # a generating case carries a replay payload
    assert case.stresses  # the §E bullets it exercises


def test_load_corpus_case_item_coercion_and_defaults():
    # missing_attributes items omit image_url/tags/material/formality — defaults must hold.
    case = _case("missing_attributes")
    by_id = {it.id: it for it in case.request.wardrobe}
    t_cv = by_id["t-cv"]
    assert t_cv.type is ItemType.top  # wire "top" coerced to the enum
    assert t_cv.image_url == "t-cv.jpg"  # defaulted from id
    assert t_cv.color_tags == [] and t_cv.formality is None  # CV omitted → empty/None


def test_load_corpus_dir_loads_every_case():
    cases = load_corpus_dir(CORPUS_DIR)
    ids = {c.case_id for c in cases}
    assert {
        "green_shirt", "forced_bottom", "forced_dress_tiny", "forced_shoes_optional",
        "forced_outerwear", "dress_heavy", "tiny_insufficient", "hot_weather",
        "missing_attributes", "bold_statement", "duplicate_outfits", "id_conformance",
    } <= ids
    for case in cases:
        assert case.request.forced_item_id in {it.id for it in case.request.wardrobe}


def test_replay_generator_for_pre_gpt_case_raises():
    # tiny_insufficient never generates → no canned_response → nothing to replay.
    case = _case("tiny_insufficient")
    assert case.canned_response is None
    with pytest.raises(ValueError):
        replay_generator_for(case)


def test_canned_string_is_replayed_verbatim(tmp_path):
    # A string canned_response (deliberately-invalid JSON) is replayed as-is for the repair path.
    raw = '{"case_id":"x","description":"","stresses":[],"request":{"forced_item_id":"t1",' \
          '"occasion":"c","weather":"mild","session_id":"s","wardrobe_version":1},' \
          '"wardrobe":[{"id":"t1","type":"top","warmth":4},{"id":"b1","type":"bottom","warmth":5}],' \
          '"canned_response":"this is not json"}'
    p = tmp_path / "x.json"
    p.write_text(raw, encoding="utf-8")
    case = load_corpus_case(p)
    assert case.canned_response == "this is not json"  # verbatim, not JSON-serialized


# ============================================================================
# RecordingGenerator (external instrumentation — never widens RescueResult)
# ============================================================================


def test_recording_generator_passes_through_and_records():
    inner = ReplayGenerator(["A", "B"])
    rec = RecordingGenerator(inner)
    from fitted_core.generation import GenerationPrompt

    p = GenerationPrompt(system="s", user="u", candidate_requested=6)
    assert rec.generate(p) == "A"
    assert rec.generate(p) == "B"
    assert rec.call_count == 2
    assert rec.raw_outputs == ["A", "B"]
    assert isinstance(rec, Generator)


# ============================================================================
# evaluate_case — the golden cases (mechanical metrics + attribution)
# ============================================================================


def test_green_shirt_full_spread_no_losses():
    case = _case("green_shirt")
    m = evaluate_case(case, _gen(case)).metrics
    assert m.not_enough_items is False
    assert m.parse_success is True and m.repair_used is False
    assert m.candidates_validated == 3
    assert m.forced_item_included == 3 and m.style_move_present == 3
    assert m.rejection_histogram == {}  # nothing rejected
    assert m.survivors == 3
    assert m.ranked_count == 3 and m.variant_count == 3
    assert m.spread_collapsed is False  # the green shirt genuinely spreads
    assert m.insufficient_after_generation is False
    assert sum(m.cells.values()) == 3  # one cell entry per surfaced variant


def test_forced_bottom_mirrors_top_clean_spread():
    # The §E "each ItemType" case for a forced bottom — the two_piece mirror of green_shirt:
    # a clean three-survivor spread with the forced bottom pinned into every surfaced variant.
    case = _case("forced_bottom")
    assert case.request.forced_item_id == "b-cargo"
    assert {it.type for it in case.request.wardrobe if it.id == "b-cargo"} == {ItemType.bottom}
    ev = evaluate_case(case, _gen(case))
    m = ev.metrics
    assert m.not_enough_items is False
    assert m.candidates_validated == 3 and m.rejection_histogram == {}
    assert m.forced_item_included == 3 and m.style_move_present == 3
    assert m.survivors == 3 and m.ranked_count == 3 and m.variant_count == 3
    for v in ev.result.variants:
        assert ("b-cargo", Role.base_bottom) in v.items  # pinned bottom, correct role


def test_forced_shoes_drop_is_attributed_to_rescue_stage():
    # A valid base-only outfit omits the forced shoe → validator ACCEPTS it (structurally fine),
    # _drop_invalid removes it → the loss is pinned to the rescue-drop stage, not the validator.
    case = _case("forced_shoes_optional")
    m = evaluate_case(case, _gen(case)).metrics
    assert m.candidates_validated == 4  # all four are structurally valid
    assert m.rejection_histogram == {}  # none rejected by the validator
    assert m.forced_item_included == 3
    assert m.dropped_missing_forced == 1  # the base-only outfit omitting the forced shoe
    assert m.dropped_missing_style_move == 0
    assert m.survivors == 3


def test_duplicate_outfits_dedup_attributed_to_validator():
    case = _case("duplicate_outfits")
    m = evaluate_case(case, _gen(case)).metrics
    assert m.candidates_validated == 1  # M2 dedups the three identical outfits to one
    assert m.rejection_histogram.get("duplicateFullSignature") == 2
    assert m.survivors == 1
    assert m.variant_count == 1
    assert m.spread_collapsed is False  # one variant cannot share a cell
    assert m.insufficient_after_generation is True  # 1 < n_surfaced, honestly reported


def test_id_conformance_hallucination_attributed_to_validator():
    case = _case("id_conformance")
    m = evaluate_case(case, _gen(case)).metrics
    assert m.rejection_histogram.get("itemOutsideSampledPool") == 1  # the b-ghost outfit
    assert m.candidates_validated == 2  # the two well-formed outfits
    assert m.survivors == 2
    assert m.dropped_missing_forced == 0  # the forced item was present in both survivors
    assert m.insufficient_after_generation is True  # 2 < n_surfaced


def test_tiny_insufficient_is_pre_gpt_with_no_generation():
    case = _case("tiny_insufficient")
    # Any generator works — it is never called on a pre-GPT exit; assert that via call_count.
    rec = RecordingGenerator(ReplayGenerator('{"outfits": []}'))
    ev = evaluate_case(case, rec)
    m = ev.metrics
    assert m.not_enough_items is True
    assert m.generator_calls == 0 and rec.call_count == 0  # short-circuited pre-GPT
    assert m.parse_success is False and m.repair_used is False
    assert m.candidates_validated == 0 and m.survivors == 0
    assert m.ranked_count == 0 and m.variant_count == 0
    assert m.reason_hint is not None  # never silent (the add-a-bottom hint)
    assert ev.result.ranked is None


def test_missing_attributes_humble_reliable_safe_cluster():
    case = _case("missing_attributes")
    m = evaluate_case(case, _gen(case)).metrics
    assert m.variant_count == 3
    # featureless outfits all bucket to the humble default (§G sanity case).
    assert set(m.cells) == {"reliable/safe"}
    assert m.spread_collapsed is True  # one cell only → padded → collapsed


def test_forced_dress_tiny_shares_one_base_key_and_surfaces_lone_dress():
    case = _case("forced_dress_tiny")
    ev = evaluate_case(case, _gen(case))
    assert ev.metrics.ranked_count == 3  # variant_cap_relaxed re-admits past the cap of 2
    assert len({o.base_key for o in ev.result.ranked.outfits}) == 1  # shared dressId BaseKey
    lone = [
        v for v in ev.result.variants
        if v.items == (("d-navy", Role.one_piece),)  # the dress alone
    ]
    assert len(lone) == 1


def test_dress_heavy_closet_spreads_across_distinct_cells():
    # A dress-dominated closet (four dresses + a forced red heel) must produce a genuine spread:
    # one_piece bases only, the forced shoe in every variant, and three DISTINCT (path,risk)
    # cells (spread_collapsed=False) rather than clustering — the §E "dress-heavy" stress.
    case = _case("dress_heavy")
    ev = evaluate_case(case, _gen(case))
    m = ev.metrics
    assert m.candidates_validated == 4 and m.rejection_histogram == {}
    assert m.survivors == 4 and m.ranked_count == 4  # four dress+heel outfits all survive
    assert m.variant_count == 3  # spread-selected down to n_surfaced
    assert m.spread_collapsed is False  # three genuinely distinct cells, not padded
    assert len(m.cells) == 3 and set(m.cells.values()) == {1}  # one variant per distinct cell
    for v in ev.result.variants:
        assert ("s-red", Role.shoes) in v.items  # forced heel pinned into every variant
        assert any(role is Role.one_piece for _, role in v.items)  # every base is a dress


def test_hot_weather_mismatch_is_bucketed_not_gated():
    # The parka-in-hot outfit must still surface (a stretch), never be filtered out (§G bucket-not-gate).
    case = _case("hot_weather")
    ev = evaluate_case(case, _gen(case))
    assert ev.metrics.survivors == 3 and ev.metrics.variant_count == 3
    parka_variants = [
        v for v in ev.result.variants if any(iid == "o-parka" for iid, _ in v.items)
    ]
    assert len(parka_variants) == 1  # it surfaced
    assert parka_variants[0].option_path.value == "stretch"  # demoted by the weather penalty


@pytest.mark.parametrize("case_id", [
    "green_shirt", "forced_bottom", "forced_dress_tiny", "forced_shoes_optional",
    "forced_outerwear", "dress_heavy", "hot_weather", "missing_attributes",
    "bold_statement", "duplicate_outfits", "id_conformance",
])
def test_every_generating_case_holds_basic_invariants(case_id):
    case = _case(case_id)
    ev = evaluate_case(case, _gen(case))
    m = ev.metrics
    assert m.generator_calls >= 1
    assert m.variant_count <= case.request.n_surfaced
    assert m.variant_count == min(m.ranked_count, case.request.n_surfaced)
    assert m.survivors == m.ranked_count  # cold start: rank drops/reorders only, never adds
    assert sum(m.cells.values()) == m.variant_count
    # forced item is in every surfaced variant (the whole point of a rescue).
    for v in ev.result.variants:
        assert any(iid == case.request.forced_item_id for iid, _ in v.items)


# ============================================================================
# repair-path attribution (parse-fail → one re-generation → valid)
# ============================================================================


def _repair_case() -> tuple[RescueRequest, str]:
    wardrobe = [
        WardrobeItem("t1", "tee", ItemType.top, warmth=4, image_url="t1.jpg"),
        WardrobeItem("b1", "jeans", ItemType.bottom, warmth=5, image_url="b1.jpg"),
    ]
    request = RescueRequest(
        wardrobe=wardrobe, forced_item_id="t1", occasion="casual", weather="mild",
        session_id="repair", wardrobe_version=1,
    )
    valid = (
        '{"outfits":[{"items":[{"itemId":"t1","role":"base_top"},'
        '{"itemId":"b1","role":"base_bottom"}],'
        '"styleMove":{"moveType":"basic","changedItemIds":["t1"],"oneSentence":"ok"}}]}'
    )
    return request, valid


def test_repair_path_is_attributed():
    from fitted_core.evaluation import CorpusCase

    request, valid = _repair_case()
    case = CorpusCase("repair", "", (), request, None)
    # invalid-then-valid: the harness records two generator calls and recovers a payload.
    m = evaluate_case(case, StubGenerator(["this is not json", valid])).metrics
    assert m.generator_calls == 2
    assert m.repair_used is True
    assert m.parse_success is True
    assert m.candidates_validated == 1


def test_failed_repair_is_attributed_as_parse_failure():
    from fitted_core.evaluation import CorpusCase

    request, _ = _repair_case()
    case = CorpusCase("repair-fail", "", (), request, None)
    m = evaluate_case(case, StubGenerator(["nope", "still nope"])).metrics
    assert m.generator_calls == 2
    assert m.repair_used is True
    assert m.parse_success is False  # both outputs unparseable → no payload
    assert m.candidates_validated == 0
    assert m.survivors == 0
    assert m.insufficient_after_generation is True


# ============================================================================
# product equality (no drift) + determinism
# ============================================================================


def test_harness_product_equals_rescue():
    # The harness reads the product off rescue(); re-deriving stages must not change it.
    case = _case("green_shirt")
    harness_result = evaluate_case(case, _gen(case)).result
    direct_result = rescue(case.request, _gen(case))
    assert harness_result == direct_result


def test_evaluate_case_is_deterministic():
    case = _case("bold_statement")
    a = evaluate_case(case, _gen(case))
    b = evaluate_case(case, _gen(case))
    assert a.metrics == b.metrics
    assert a.result == b.result


# ============================================================================
# aggregation (run-to-run variance → H4)
# ============================================================================


def test_aggregate_over_identical_runs_has_zero_variance():
    case = _case("green_shirt")
    metrics = [evaluate_case(case, _gen(case)).metrics for _ in range(4)]
    agg = aggregate(metrics)
    assert isinstance(agg, AggregateMetrics)
    assert agg.runs == 4
    assert agg.parse_success_rate == 1.0
    assert agg.repair_rate == 0.0
    assert agg.forced_inclusion_rate == 1.0
    assert agg.mean_variants == 3.0
    assert agg.cell_histogram == {  # summed across 4 identical runs
        "reliable/safe": 4, "stretch/safe": 4, "stretch/noticeable": 4,
    }


def test_aggregate_requires_at_least_one():
    with pytest.raises(ValueError):
        aggregate([])


def test_aggregate_rejection_rate_for_lossy_case():
    case = _case("id_conformance")
    metrics = [evaluate_case(case, _gen(case)).metrics for _ in range(3)]
    agg = aggregate(metrics)
    assert agg.rejection_histogram == {"itemOutsideSampledPool": 3}
    assert agg.insufficient_rate == 1.0


# ============================================================================
# believability rubric (captured, never a gate) + rendering
# ============================================================================


def test_believability_rubric_defaults_unrated():
    rubric = BelievabilityRubric()
    assert rubric.stylist_endorse is None
    assert rubric.notes == ""
    rubric.stylist_endorse = 4  # mutable — filled by a human reviewer
    assert rubric.stylist_endorse == 4


def test_render_rubric_template_covers_every_dimension():
    text = render_rubric_template()
    for dimension in RUBRIC_QUESTIONS:
        assert dimension in text
    assert "not a gate" in text  # the §E discipline is stated on the artifact


def test_rubric_has_occasion_field_and_no_subjective_spread_field():
    import dataclasses

    # occasion-appropriateness is an explicit human dimension...
    assert "occasion_appropriate" in RUBRIC_QUESTIONS
    rubric = BelievabilityRubric()
    assert rubric.occasion_appropriate is None  # defaults un-rated
    rubric.occasion_appropriate = 5
    assert rubric.occasion_appropriate == 5
    # ...but spread is measured MECHANICALLY (cells / spread_collapsed), never hand-rated.
    assert not any("spread" in q for q in RUBRIC_QUESTIONS)
    # the dataclass and the question set stay in lockstep (every question has a scored field).
    field_names = {f.name for f in dataclasses.fields(BelievabilityRubric)} - {"notes"}
    assert field_names == set(RUBRIC_QUESTIONS)


def test_format_evaluation_contains_metrics_and_variants():
    case = _case("green_shirt")
    ev = evaluate_case(case, _gen(case))
    text = format_evaluation(ev)
    assert "CASE  green_shirt" in text
    assert "Mechanical metrics:" in text
    assert "Surfaced ways to wear" in text
    assert "Green graphic tee" in text  # an item name rendered
    assert "Believability rubric" in text


def test_format_evaluation_pre_gpt_case():
    case = _case("tiny_insufficient")
    ev = evaluate_case(case, ReplayGenerator('{"outfits": []}'))
    text = format_evaluation(ev)
    assert "PRE-GPT not_enough_items" in text


def test_format_aggregate_renders():
    case = _case("green_shirt")
    agg = aggregate([evaluate_case(case, _gen(case)).metrics for _ in range(2)])
    text = format_aggregate(agg)
    assert "AGGREGATE  green_shirt" in text
    assert "parse_success_rate=1.00" in text


# ============================================================================
# hermetic-import guarantee (no live OpenAI in the harness)
# ============================================================================


def test_evaluation_module_has_no_openai_binding():
    import fitted_core.evaluation as ev

    assert not hasattr(ev, "openai")  # the harness never imports the dependency


# ============================================================================
# cost / latency telemetry (C6 eval only — never product, never CaseMetrics, no OpenAI)
# ============================================================================


class _UsageStub:
    """Hermetic Generator that also exposes `last_usage` + `_model` like OpenAIGenerator."""

    def __init__(self, raw: str, usage: dict, model: str = "gpt-4o") -> None:
        self._raw = raw
        self.last_usage = usage
        self._model = model
        self.call_count = 0

    def generate(self, prompt) -> str:
        self.call_count += 1
        return self._raw


class _SeqUsageStub:
    """Usage-exposing stub returning canned responses in order (for the repair path)."""

    def __init__(self, responses, usages, model: str = "gpt-4o") -> None:
        self._responses = list(responses)
        self._usages = list(usages)
        self.last_usage = None
        self._model = model
        self.call_count = 0

    def generate(self, prompt) -> str:
        idx = min(self.call_count, len(self._responses) - 1)
        self.last_usage = self._usages[min(self.call_count, len(self._usages) - 1)]
        self.call_count += 1
        return self._responses[idx]


def _cost(case_id, calls, latency, total_tokens=None, est=None, model="gpt-4o"):
    from fitted_core.evaluation import GenerationCost

    pt = None if total_tokens is None else total_tokens // 2
    ct = None if total_tokens is None else total_tokens - pt
    return GenerationCost(case_id, model, calls, latency, pt, ct, total_tokens, est)


def test_cost_is_separate_from_metrics_and_hermetic_tokens_are_none():
    # Under a replay generator (no usage): latency measured, tokens/$ None, and cost lives
    # OFF CaseMetrics so mechanical-metric determinism is untouched.
    ev = evaluate_case(_case("green_shirt"), _gen(_case("green_shirt")))
    assert ev.cost.case_id == "green_shirt"
    assert ev.cost.generator_calls == 1
    assert ev.cost.latency_s >= 0.0
    assert ev.cost.prompt_tokens is None and ev.cost.total_tokens is None
    assert ev.cost.est_cost_usd is None
    assert ev.cost.model is None  # a ReplayGenerator has no _model
    assert not hasattr(ev.metrics, "latency_s")  # telemetry is not a CaseMetrics field


def test_pre_gpt_case_has_zero_call_cost():
    ev = evaluate_case(_case("tiny_insufficient"), ReplayGenerator('{"outfits": []}'))
    assert ev.cost.generator_calls == 0
    assert ev.cost.total_tokens is None and ev.cost.est_cost_usd is None


def test_cost_captures_usage_and_estimates_dollars():
    from fitted_core.evaluation import CorpusCase

    request, valid = _repair_case()
    case = CorpusCase("usage", "", (), request, None)
    usage = {"prompt_tokens": 1000, "completion_tokens": 200, "total_tokens": 1200}
    ev = evaluate_case(case, _UsageStub(valid, usage, model="gpt-4o"))
    assert ev.cost.model == "gpt-4o"
    assert ev.cost.prompt_tokens == 1000 and ev.cost.completion_tokens == 200
    assert ev.cost.total_tokens == 1200
    # gpt-4o: $2.50/1M in + $10.00/1M out → 1000*2.5e-6 + 200*1e-5 = 0.0025 + 0.0020
    assert ev.cost.est_cost_usd == pytest.approx(0.0045)


def test_repair_sums_tokens_and_calls_across_two_calls():
    from fitted_core.evaluation import CorpusCase

    request, valid = _repair_case()
    case = CorpusCase("usage-repair", "", (), request, None)
    u1 = {"prompt_tokens": 500, "completion_tokens": 10, "total_tokens": 510}
    u2 = {"prompt_tokens": 520, "completion_tokens": 200, "total_tokens": 720}
    ev = evaluate_case(case, _SeqUsageStub(["not json", valid], [u1, u2]))
    assert ev.cost.generator_calls == 2  # invalid-then-valid → repair fired
    assert ev.cost.prompt_tokens == 1020 and ev.cost.completion_tokens == 210
    assert ev.cost.total_tokens == 1230  # summed across both calls


def test_estimate_cost_usd_table_and_unknowns():
    from fitted_core.evaluation import _estimate_cost_usd

    assert _estimate_cost_usd("gpt-4o", 1_000_000, 1_000_000) == pytest.approx(12.50)
    assert _estimate_cost_usd("gpt-4o-mini", 1_000_000, 1_000_000) == pytest.approx(0.75)
    assert _estimate_cost_usd("no-such-model", 100, 100) is None  # unpriced → None
    assert _estimate_cost_usd("gpt-4o", None, 100) is None  # missing tokens → None
    assert _estimate_cost_usd(None, 100, 100) is None  # unknown model → None


def test_percentile_nearest_rank():
    from fitted_core.evaluation import _percentile

    assert _percentile([], 50) == 0.0
    assert _percentile([5.0], 95) == 5.0
    vals = [1.0, 2.0, 3.0, 4.0, 5.0]
    assert _percentile(vals, 0) == 1.0
    assert _percentile(vals, 50) == 3.0
    assert _percentile(vals, 95) == 5.0


def test_aggregate_cost_p50_p95_tokens_and_dollars():
    from fitted_core.evaluation import aggregate_cost

    costs = [
        _cost("a", 1, 1.0, total_tokens=1000, est=0.01),
        _cost("b", 1, 2.0, total_tokens=2000, est=0.02),
        _cost("c", 1, 3.0, total_tokens=3000, est=0.03),
        _cost("pre", 0, 0.0),  # pre-GPT exit — excluded from every figure
    ]
    agg = aggregate_cost(costs)
    assert agg.rescues == 3
    assert agg.p50_latency_s == 2.0 and agg.p95_latency_s == 3.0
    assert agg.mean_latency_s == pytest.approx(2.0)
    assert agg.total_tokens == 6000 and agg.mean_total_tokens == pytest.approx(2000.0)
    assert agg.est_total_cost_usd == pytest.approx(0.06)
    assert agg.est_cost_per_rescue_usd == pytest.approx(0.02)


def test_aggregate_cost_without_usage_reports_latency_only():
    from fitted_core.evaluation import aggregate_cost

    agg = aggregate_cost([_cost("a", 1, 1.0), _cost("b", 1, 3.0)])  # no tokens/$
    assert agg.rescues == 2 and agg.mean_latency_s == pytest.approx(2.0)
    assert agg.total_tokens is None and agg.est_total_cost_usd is None
    assert agg.est_cost_per_rescue_usd is None


def test_aggregate_cost_all_pre_gpt_is_empty():
    from fitted_core.evaluation import aggregate_cost

    assert aggregate_cost([_cost("pre", 0, 0.0)]).rescues == 0


def test_format_cost_aggregate_real_and_hermetic():
    from fitted_core.evaluation import aggregate_cost, format_cost_aggregate

    real = format_cost_aggregate(aggregate_cost([_cost("a", 1, 1.0, total_tokens=1000, est=0.01)]))
    assert "generating rescue(s)" in real and "latency  p50=" in real
    assert "est cost total=$" in real
    hermetic = format_cost_aggregate(aggregate_cost([_cost("a", 1, 1.0)]))
    assert "tokens   n/a" in hermetic and "est cost n/a" in hermetic


def test_format_evaluation_includes_cost_line():
    text = format_evaluation(evaluate_case(_case("green_shirt"), _gen(_case("green_shirt"))))
    assert "latency=" in text and "est_cost=" in text


def test_openai_generator_last_usage_defaults_none_without_openai():
    from fitted_core.generation import OpenAIGenerator

    gen = OpenAIGenerator(model="gpt-4o")  # construction needs no openai/key
    assert gen.last_usage is None  # no call yet
