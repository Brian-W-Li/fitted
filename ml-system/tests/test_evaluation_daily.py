"""Daily-intent eval harness tests (M5 C8 half-2 F3 mechanical read).

Hermetic: every test drives the harness with a ``ReplayGenerator`` over the daily corpus's own
``canned_response`` — no live OpenAI, ever. The daily path reads its metrics off
``render_with_trace``'s trace (no stage re-derivation), so these lock: the daily corpus loader
(no forced item), the trace-read metrics, determinism, aggregation, and no drift from the product
``render()``.
"""

from pathlib import Path

import pytest

from fitted_core.evaluation import (
    DailyAggregateMetrics,
    DailyCaseMetrics,
    aggregate_daily,
    evaluate_daily_case,
    format_daily_aggregate,
    format_daily_evaluation,
    load_daily_corpus_case,
    load_daily_corpus_dir,
    replay_generator_for,
)
from fitted_core.rescue import RenderRequest, render

DAILY_CORPUS_DIR = Path(__file__).parent / "fixtures" / "daily_corpus"


def _case(name: str):
    return load_daily_corpus_case(DAILY_CORPUS_DIR / f"{name}.json")


def _gen(case):
    """A fresh replay generator over the case's canned response (state-free per call)."""
    return replay_generator_for(case)


# ============================================================================
# corpus loading
# ============================================================================


def test_load_daily_corpus_case_is_daily_with_no_forced_item():
    case = _case("daily_office")
    assert case.case_id == "daily_office"
    assert isinstance(case.request, RenderRequest)
    assert case.request.intent == "daily"
    assert case.request.forced_item_id is None
    assert case.request.weather == "indoor"
    assert case.request.k == 10 and case.request.n_surfaced == 3  # defaults applied
    assert case.canned_response is not None


def test_load_daily_corpus_case_rejects_a_forced_item(tmp_path):
    # A daily case that carries forced_item_id is a rescue case in the wrong directory → loud.
    # Written to tmp_path (NOT the globbed corpus dir) so a mid-test crash can't leave a poisoned
    # fixture that load_daily_corpus_dir / the live --corpus-dir run would then trip on.
    data = (DAILY_CORPUS_DIR / "daily_office.json").read_text(encoding="utf-8").replace(
        '"session_id": "corpus-daily-office"',
        '"forced_item_id": "t-white", "session_id": "corpus-daily-office"',
    )
    tmp = tmp_path / "forced.json"
    tmp.write_text(data, encoding="utf-8")
    with pytest.raises(ValueError, match="must not set forced_item_id"):
        load_daily_corpus_case(tmp)


def test_load_daily_corpus_dir_loads_every_case():
    cases = load_daily_corpus_dir(DAILY_CORPUS_DIR)
    ids = {c.case_id for c in cases}
    assert {"daily_office", "daily_hot_weekend"} <= ids
    assert all(c.request.intent == "daily" for c in cases)


# ============================================================================
# metrics read off the trace
# ============================================================================


def test_evaluate_daily_case_reads_metrics_off_the_trace():
    case = _case("daily_office")
    ev = evaluate_daily_case(case, _gen(case))
    m = ev.metrics
    assert isinstance(m, DailyCaseMetrics)
    assert m.not_enough_items is False
    assert m.parse_success is True
    assert m.repair_used is False
    assert m.generator_calls == 1
    # all three canned outfits are structurally valid + carry a StyleMove
    assert m.candidates_validated == 3
    assert m.style_move_present == m.candidates_validated
    assert m.dropped_missing_style_move == 0
    assert m.survivors == 3
    # surfaced set is the spread-selected subset (≤ n_surfaced=3)
    assert 1 <= m.variant_count <= 3
    assert m.ranked_count >= m.variant_count
    # no forced-item field exists on the daily metrics (compile-time via the dataclass)
    assert not hasattr(m, "forced_item_included")


def test_evaluate_daily_case_is_deterministic():
    case = _case("daily_hot_weekend")
    a = evaluate_daily_case(case, _gen(case)).metrics
    b = evaluate_daily_case(case, _gen(case)).metrics
    assert a == b  # frozen dataclass equality — a fixed replay is fully deterministic


def test_daily_eval_result_matches_product_render_no_drift():
    # The harness reads render_with_trace().result; it must byte-equal the product render() under
    # the same deterministic generator (the daily analogue of the rescue product-equality guard).
    case = _case("daily_office")
    harness_result = evaluate_daily_case(case, _gen(case)).result
    product_result = render(case.request, _gen(case))
    assert harness_result == product_result


def test_hallucinated_id_shows_in_the_rejection_histogram():
    # A canned outfit referencing an item id absent from the closet is a validator rejection —
    # it must surface in the rejection histogram (the F3 "hallucinated ids" signal), not crash.
    case = _case("daily_office")
    poisoned = (
        '{"outfits": [{"items": [{"itemId": "t-GHOST", "role": "base_top"}, '
        '{"itemId": "b-charcoal", "role": "base_bottom"}], '
        '"styleMove": {"moveType": "anchor", "changedItemIds": ["b-charcoal"], '
        '"oneSentence": "A hallucinated top that is not in the closet."}}]}'
    )
    from fitted_core.generation import ReplayGenerator

    ev = evaluate_daily_case(case, ReplayGenerator(poisoned))
    m = ev.metrics
    assert m.parse_success is True
    # the ghost-id candidate is rejected (never validated), so at least one rejection is recorded
    assert sum(m.rejection_histogram.values()) >= 1
    assert m.candidates_validated == 0


def test_daily_candidate_missing_style_move_is_dropped():
    # A structurally valid outfit that OMITS styleMove validates (StyleMove is a daily DROP, not a
    # validator reject) but is then dropped — the metric that fires when a real gpt-5.4-mini omits a
    # StyleMove. Guards the coupling between _DAILY_STYLE_MOVE_DROP and the daily drop_reason source.
    case = _case("daily_office")
    mixed = (
        '{"outfits": ['
        '{"items": [{"itemId": "t-white", "role": "base_top"}, '
        '{"itemId": "b-charcoal", "role": "base_bottom"}, {"itemId": "s-derby", "role": "shoes"}], '
        '"styleMove": {"moveType": "anchor", "changedItemIds": ["b-charcoal"], '
        '"oneSentence": "A clean anchor with a real styling reason."}}, '
        '{"items": [{"itemId": "t-blue", "role": "base_top"}, '
        '{"itemId": "b-navy", "role": "base_bottom"}, {"itemId": "s-loafer", "role": "shoes"}]}'
        "]}"
    )
    from fitted_core.generation import ReplayGenerator

    m = evaluate_daily_case(case, ReplayGenerator(mixed)).metrics
    assert m.parse_success is True
    assert m.candidates_validated == 2  # both validate structurally
    assert m.style_move_present == 1  # only the first carries a StyleMove
    assert m.dropped_missing_style_move == 1  # the second is dropped for the missing move
    assert m.survivors == m.candidates_validated - m.dropped_missing_style_move  # == 1


# ============================================================================
# aggregation + formatting
# ============================================================================


def test_aggregate_daily_over_identical_runs():
    case = _case("daily_office")
    metrics = [evaluate_daily_case(case, _gen(case)).metrics for _ in range(3)]
    agg = aggregate_daily(metrics)
    assert isinstance(agg, DailyAggregateMetrics)
    assert agg.runs == 3
    assert agg.parse_success_rate == 1.0
    assert agg.repair_rate == 0.0
    assert agg.style_move_rate == 1.0  # every validated candidate carried a StyleMove
    assert agg.mean_candidates == 3.0


def test_aggregate_daily_requires_at_least_one():
    with pytest.raises(ValueError, match="at least one"):
        aggregate_daily([])


def test_format_daily_evaluation_and_aggregate_render_key_fields():
    case = _case("daily_office")
    evals = [evaluate_daily_case(case, _gen(case)) for _ in range(2)]
    report = format_daily_evaluation(evals[0])
    assert "CASE  daily_office  [daily]" in report
    assert "parse_success=True" in report
    assert "Surfaced ways to wear" in report
    agg_text = format_daily_aggregate(aggregate_daily([e.metrics for e in evals]))
    assert "[daily]" in agg_text
    assert "parse_success_rate=1.00" in agg_text
    assert "style_move_rate=1.00" in agg_text
