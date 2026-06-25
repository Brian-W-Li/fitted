"""C6 evaluation harness — golden corpus, mechanical metrics, failure attribution (spearhead.md §E).

The strict validator is the oracle, so most of pressure-testing the rescue vertical is
automatable. This module runs golden forced-item rescue cases through the **real**
``rescue()`` pipeline (the single source of truth for the product) and collects mechanical
metrics, while attributing any shortfall to its stage by **instrumenting the pipeline
externally** (spearhead.md §E, resolved option a):

  - The case's generator is wrapped in a ``RecordingGenerator`` so every raw output
    ``rescue()`` saw is captured.
  - The product ``RescueResult`` is read for the rank/spread stages (``ranked``, ``variants``,
    ``fallback_stage``, ``spread_collapsed``, ``insufficient_after_generation``).
  - The early stages (``parse_gpt_json`` → ``validate_gpt_payload`` → ``_drop_invalid``) are
    **re-run over the captured output** to disambiguate parse-fail vs validator-reject vs
    rescue-drop — all of which otherwise collapse to ``ranked.outfits == ()`` in the
    product result. ``RescueResult`` is **not** widened with diagnostic fields (spearhead.md
    §E: stays product/runtime-shaped); the harness reconstructs the cause externally.

The re-derivation mirrors ``rescue()`` steps 1–7 using its own pure helpers (deterministic
from the request), so the captured-output replay reproduces exactly what ``rescue()`` saw.
The product-equality test in ``tests/test_evaluation.py`` guards against drift.

This module imports **no** ``openai`` — it takes an injected ``Generator``, so the hermetic
pytest suite drives it with a stub/replay and a live key is needed only in ``cli.py``
(spearhead.md §A/§I). The believability rubric (the irreducible human part, §E) is captured,
never computed, and never a production gate (spearhead.md §E / §G "bucket, never gate").

Sources: docs/Fitted_Spec_v2.md §21 (evaluation levels), docs/plans/spearhead.md §E/§J.
"""

import json
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping, Optional, Sequence

from fitted_core.config import DEFAULT_K, N_SURFACED
from fitted_core.generation import GenerationPrompt, Generator, ReplayGenerator
from fitted_core.models import WardrobeItem
from fitted_core.rescue import (
    RescueRequest,
    RescueResult,
    _build_prompt,
    _build_request_context,
    _drop_invalid,
    _filled_slot_ids,
    _flatten_pool,
    _generate_and_parse,
    _resolve_forced_item,
    _resolve_shape,
    _scope_pool_to_forced,
    rescue,
)
from fitted_core.response import OutfitVariant
from fitted_core.sampler import ColdStartSignalScorer, build_candidate_pool
from fitted_core.validator import Issue, validate_gpt_payload


# ============================================================================
# generator instrumentation (external attribution — never widens RescueResult)
# ============================================================================


class RecordingGenerator:
    """Wraps any ``Generator`` and records every ``(prompt, raw)`` call (spearhead.md §E).

    Lets the harness call the real ``rescue()`` once (one set of live generations) and then
    re-run the early stages over the *captured* raw output — so a non-deterministic real
    generator is sampled exactly once per rescue, never twice. ``raw_outputs`` is the ordered
    list of raw responses (length 1 normally, 2 when the §12 repair retry fired, 0 on a
    pre-GPT exit).
    """

    def __init__(self, inner: Generator) -> None:
        self._inner = inner
        self.calls: list[tuple[GenerationPrompt, str]] = []
        self.latencies: list[float] = []  # per-call wall-clock seconds (C6 telemetry, §E)
        self.usages: list[Optional[dict]] = []  # per-call token usage when the backend exposes it

    def generate(self, prompt: GenerationPrompt) -> str:
        start = time.perf_counter()
        raw = self._inner.generate(prompt)
        self.latencies.append(time.perf_counter() - start)
        # Observational only: the real OpenAIGenerator records `last_usage`; stubs/replays do
        # not, so this is None under the hermetic suite (no token data, no OpenAI — §E).
        self.usages.append(getattr(self._inner, "last_usage", None))
        self.calls.append((prompt, raw))
        return raw

    @property
    def raw_outputs(self) -> list[str]:
        return [raw for _, raw in self.calls]

    @property
    def call_count(self) -> int:
        return len(self.calls)

    @property
    def latency_s(self) -> float:
        """Total wall-clock across this rescue's generation call(s) (incl. a repair retry)."""
        return sum(self.latencies)


# ============================================================================
# corpus loading
# ============================================================================


@dataclass(frozen=True)
class CorpusCase:
    """One golden stress case (spearhead.md §E; schema in tests/fixtures/corpus/README.md).

    ``request`` is the ready-to-run rescue input; ``canned_response`` is the raw generator
    text to replay for a hermetic / ``--dry-run`` run (``None`` for pre-GPT-exit cases that
    never generate). ``stresses`` records which §E corpus bullets the case exercises.
    """

    case_id: str
    description: str
    stresses: tuple[str, ...]
    request: RescueRequest
    canned_response: Optional[str]


def _item_from_dict(d: Mapping[str, object]) -> WardrobeItem:
    """One corpus item dict → ``WardrobeItem`` (the README case schema).

    Only ``id``/``type``/``warmth`` are load-bearing; ``image_url`` defaults to ``"<id>.jpg"``
    (it is stripped from the GPT payload anyway, §12) and the tag/material/formality fields are
    optional because CV legitimately omits them (the missing-attributes case). ``type`` is the
    wire string; ``WardrobeItem.__post_init__`` coerces it to ``ItemType`` (raising on unknown).
    """
    item_id = str(d["id"])
    return WardrobeItem(
        id=item_id,
        name=str(d.get("name", item_id)),
        type=d["type"],  # ItemType coercion + unknown-type guard in __post_init__
        warmth=int(d.get("warmth", 5)),
        image_url=str(d.get("image_url", f"{item_id}.jpg")),
        style_tags=list(d.get("style_tags", [])),
        color_tags=list(d.get("color_tags", [])),
        occasion_tags=list(d.get("occasion_tags", [])),
        material=d.get("material"),
        formality=d.get("formality"),
    )


def _canned_to_raw(canned: object) -> Optional[str]:
    """Normalize the optional ``canned_response`` to the raw text a ``Generator`` returns.

    A JSON object is serialized to the strict §12 envelope text; a string is replayed verbatim
    (so a case can carry deliberately-invalid JSON to exercise the repair path); absent → None.
    """
    if canned is None:
        return None
    if isinstance(canned, str):
        return canned
    return json.dumps(canned)


def load_corpus_case(path: Path | str) -> CorpusCase:
    """Load one corpus ``*.json`` file into a ``CorpusCase`` (spearhead.md §E/§J)."""
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    req = data["request"]
    case_id = str(data["case_id"])
    request = RescueRequest(
        wardrobe=[_item_from_dict(item) for item in data["wardrobe"]],
        forced_item_id=str(req["forced_item_id"]),
        occasion=str(req["occasion"]),
        weather=str(req["weather"]),
        session_id=str(req.get("session_id", f"corpus-{case_id}")),
        wardrobe_version=int(req.get("wardrobe_version", 1)),
        generation_index=int(req.get("generation_index", 0)),
        k=int(req.get("k", DEFAULT_K)),
        n_surfaced=int(req.get("n_surfaced", N_SURFACED)),
        date=req.get("date"),
    )
    return CorpusCase(
        case_id=case_id,
        description=str(data.get("description", "")),
        stresses=tuple(data.get("stresses", [])),
        request=request,
        canned_response=_canned_to_raw(data.get("canned_response")),
    )


def load_corpus_dir(directory: Path | str) -> list[CorpusCase]:
    """Load every ``*.json`` corpus case in ``directory``, sorted by filename (deterministic)."""
    return [load_corpus_case(p) for p in sorted(Path(directory).glob("*.json"))]


def replay_generator_for(case: CorpusCase) -> ReplayGenerator:
    """A ``ReplayGenerator`` over the case's canned response (hermetic / ``--dry-run`` driver).

    Raises if the case has no ``canned_response`` (a pre-GPT-exit case never generates, so
    there is nothing to replay — the caller should run such a case with a real generator or
    expect the pre-GPT exit).
    """
    if case.canned_response is None:
        raise ValueError(
            f"corpus case {case.case_id!r} has no canned_response to replay "
            "(it is a pre-GPT-exit case, or needs a real generator)"
        )
    return ReplayGenerator(case.canned_response)


# ============================================================================
# mechanical metrics
# ============================================================================


@dataclass(frozen=True)
class CaseMetrics:
    """Mechanical metrics for one rescue run (spearhead.md §E; the validator is the oracle).

    Generator-agnostic and fully deterministic for a fixed generator output — the hermetic
    suite asserts exact values; a real run histograms them across K. The histograms key on
    ``IssueCode``/cell **wire labels** (strings) so they JSON-serialize for a report.
    """

    case_id: str
    # pre-GPT structural gate (§G step 2)
    not_enough_items: bool
    reason_hint: Optional[str]
    generator_calls: int  # 0 on a pre-GPT exit; 1 normally; 2 when the repair retry fired
    # parse stage (re-run over the captured generator output)
    parse_success: bool  # a parseable payload after the one §12 repair
    repair_used: bool  # the repair retry fired (the initial output failed to parse)
    # validator stage (re-run over the captured output)
    candidates_validated: int  # accepted (structurally valid, deduped) candidates
    forced_item_included: int  # of those, how many include the forced item
    style_move_present: int  # of those, how many carry a valid StyleMove
    rejection_histogram: dict[str, int]  # IssueCode value → reject count
    warning_histogram: dict[str, int]  # IssueCode value → warning count
    # rescue-drop stage (the two decision-8 drops, attributed)
    survivors: int  # candidates after _drop_invalid (forced + StyleMove present)
    dropped_missing_forced: int  # dropped for omitting the forced item
    dropped_missing_style_move: int  # dropped for an absent/invalid StyleMove
    # rank stage (read off the product RescueResult)
    ranked_count: int  # len(result.ranked.outfits)
    fallback_stage: Optional[str]  # raw ranker diagnostic (how hard it worked to fill k)
    # response stage (read off the product RescueResult)
    variant_count: int  # surfaced variants (≤ n_surfaced)
    spread_collapsed: bool  # could not fill distinct (path, risk) cells
    cells: dict[str, int]  # "<path>/<risk>" → count over surfaced variants
    insufficient_after_generation: bool  # rescue's own post-generation shortfall flag


def _histogram(issues: Sequence[Issue]) -> dict[str, int]:
    hist: dict[str, int] = {}
    for issue in issues:
        key = issue.code.value
        hist[key] = hist.get(key, 0) + 1
    return hist


def _cell_histogram(variants: Sequence[OutfitVariant]) -> dict[str, int]:
    hist: dict[str, int] = {}
    for variant in variants:
        key = f"{variant.option_path.value}/{variant.risk.value}"
        hist[key] = hist.get(key, 0) + 1
    return hist


def _pre_gpt_metrics(case: CorpusCase, result: RescueResult) -> CaseMetrics:
    """Metrics for a pre-GPT ``not_enough_items`` exit — no generation, no candidates."""
    return CaseMetrics(
        case_id=case.case_id,
        not_enough_items=True,
        reason_hint=result.reason_hint,
        generator_calls=0,
        parse_success=False,
        repair_used=False,
        candidates_validated=0,
        forced_item_included=0,
        style_move_present=0,
        rejection_histogram={},
        warning_histogram={},
        survivors=0,
        dropped_missing_forced=0,
        dropped_missing_style_move=0,
        ranked_count=0,
        fallback_stage=None,
        variant_count=0,
        spread_collapsed=False,
        cells={},
        insufficient_after_generation=False,
    )


# ============================================================================
# generation cost telemetry (C6 eval only — latency, tokens, $/rescue; §E)
# ============================================================================

# Per-1M-token USD rates, (prompt, completion). ESTIMATES used solely for the $/rescue
# figure — update if OpenAI pricing changes; an unlisted model yields est_cost_usd=None
# (latency + token counts still report). NEVER a product input (spearhead.md §E).
MODEL_PRICING: dict[str, tuple[float, float]] = {
    "gpt-4o": (2.50, 10.00),
    "gpt-4o-2024-08-06": (2.50, 10.00),
    "gpt-4o-mini": (0.15, 0.60),
    "gpt-4.1": (2.00, 8.00),
    "gpt-4.1-mini": (0.40, 1.60),
}


def _estimate_cost_usd(
    model: Optional[str],
    prompt_tokens: Optional[int],
    completion_tokens: Optional[int],
) -> Optional[float]:
    """USD estimate for one rescue's generation from its token counts (None if unknown)."""
    if model is None or prompt_tokens is None or completion_tokens is None:
        return None
    rates = MODEL_PRICING.get(model)
    if rates is None:
        return None
    in_rate, out_rate = rates
    return prompt_tokens / 1_000_000 * in_rate + completion_tokens / 1_000_000 * out_rate


@dataclass(frozen=True)
class GenerationCost:
    """Per-rescue cost telemetry (C6 eval only — §E "tokens + latency + $/rescue").

    Deliberately **separate from CaseMetrics**: latency varies run-to-run, so keeping it out
    of CaseMetrics preserves the deterministic mechanical-metrics equality the hermetic suite
    asserts. Latency is always measured; token counts / cost are populated only when the
    generator exposes usage (the real ``OpenAIGenerator``) — ``None`` under the hermetic
    stub/replay (no OpenAI). Never read by product code; never widens ``RescueResult``.
    """

    case_id: str
    model: Optional[str]
    generator_calls: int  # 0 on a pre-GPT exit; 1 normally; 2 when the repair retry fired
    latency_s: float
    prompt_tokens: Optional[int]
    completion_tokens: Optional[int]
    total_tokens: Optional[int]
    est_cost_usd: Optional[float]


def _sum_tokens(usages: Sequence[Optional[dict]], key: str) -> Optional[int]:
    """Sum a usage field across the rescue's call(s); ``None`` if any call lacked usage."""
    if not usages or any(u is None for u in usages):
        return None
    total = 0
    for u in usages:
        value = u.get(key)  # type: ignore[union-attr]  # None-guarded above
        if value is None:
            return None
        total += int(value)
    return total


def _build_cost(
    case_id: str, model: Optional[str], recording: "RecordingGenerator"
) -> GenerationCost:
    """Assemble one rescue's ``GenerationCost`` from the recording (latency + summed usage)."""
    prompt_tokens = _sum_tokens(recording.usages, "prompt_tokens")
    completion_tokens = _sum_tokens(recording.usages, "completion_tokens")
    total_tokens = _sum_tokens(recording.usages, "total_tokens")
    return GenerationCost(
        case_id=case_id,
        model=model,
        generator_calls=recording.call_count,
        latency_s=recording.latency_s,
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        total_tokens=total_tokens,
        est_cost_usd=_estimate_cost_usd(model, prompt_tokens, completion_tokens),
    )


@dataclass(frozen=True)
class CaseEvaluation:
    """A case's metrics, the product result, and cost telemetry (the CLI reads all three)."""

    case: CorpusCase
    metrics: CaseMetrics
    result: RescueResult
    cost: GenerationCost


def evaluate_case(case: CorpusCase, generator: Generator) -> CaseEvaluation:
    """Run one case through ``rescue()`` and collect metrics + stage attribution (§E).

    The generator is sampled **once** (wrapped in a ``RecordingGenerator``); the product
    ``RescueResult`` is authoritative for rank/spread, and the early stages are re-run over
    the captured output to attribute any shortfall to parse vs validator vs rescue-drop.
    """
    request = case.request
    model = getattr(generator, "_model", None)  # known for OpenAIGenerator; None for stubs
    recording = RecordingGenerator(generator)
    result = rescue(request, recording)  # the product — the single source of truth
    cost = _build_cost(case.case_id, model, recording)  # C6 telemetry (latency/tokens/$)

    # Pre-GPT structural exit (§G step 2): no generation occurred → nothing to attribute.
    if result.not_enough_items:
        return CaseEvaluation(case, _pre_gpt_metrics(case, result), result, cost)

    # --- external stage attribution over the CAPTURED generator output (§E option a) ---
    # Re-derive the exact pure inputs rescue() used (deterministic from `request`): forced
    # item + shape, the seeded sampler pool, the forced-item scoping, and the prompt (which
    # carries the validator's candidate bound). This mirrors rescue() steps 1/3/4/5-6; the
    # product-equality test guards it against drift.
    forced_item = _resolve_forced_item(request.wardrobe, request.forced_item_id)
    _, valid_types = _resolve_shape(forced_item.type)
    sampler_result = build_candidate_pool(
        request.wardrobe, _build_request_context(request), ColdStartSignalScorer()
    )
    scoped = _scope_pool_to_forced(sampler_result.pool, forced_item, valid_types)
    prompt = _build_prompt(scoped, request, forced_item)

    # Replay rescue()'s OWN parse+repair over the recorded output → the identical payload,
    # so parse_success/repair_used are reconstructed without a second live generation.
    payload = _generate_and_parse(ReplayGenerator(recording.raw_outputs), prompt)
    parse_success = payload is not None
    repair_used = recording.call_count >= 2

    rejection_histogram: dict[str, int] = {}
    warning_histogram: dict[str, int] = {}
    candidates = []
    if payload is not None:
        validation = validate_gpt_payload(
            payload, _flatten_pool(scoped), prompt.candidate_requested
        )
        candidates = validation.candidates
        rejection_histogram = _histogram(validation.rejections)
        warning_histogram = _histogram(validation.warnings)

    forced_id = forced_item.id
    forced_included = sum(1 for c in candidates if forced_id in _filled_slot_ids(c.slot_map))
    style_present = sum(1 for c in candidates if c.style_move is not None)
    # Drop attribution mirrors _drop_invalid's order: missing-forced is checked first.
    dropped_forced = sum(
        1 for c in candidates if forced_id not in _filled_slot_ids(c.slot_map)
    )
    dropped_move = sum(
        1
        for c in candidates
        if forced_id in _filled_slot_ids(c.slot_map) and c.style_move is None
    )
    survivors = len(_drop_invalid(candidates, forced_id))

    metrics = CaseMetrics(
        case_id=case.case_id,
        not_enough_items=False,
        reason_hint=result.reason_hint,
        generator_calls=recording.call_count,
        parse_success=parse_success,
        repair_used=repair_used,
        candidates_validated=len(candidates),
        forced_item_included=forced_included,
        style_move_present=style_present,
        rejection_histogram=rejection_histogram,
        warning_histogram=warning_histogram,
        survivors=survivors,
        dropped_missing_forced=dropped_forced,
        dropped_missing_style_move=dropped_move,
        ranked_count=len(result.ranked.outfits) if result.ranked is not None else 0,
        fallback_stage=result.fallback_stage.value if result.fallback_stage else None,
        variant_count=len(result.variants),
        spread_collapsed=result.spread_collapsed,
        cells=_cell_histogram(result.variants),
        insufficient_after_generation=result.insufficient_after_generation,
    )
    return CaseEvaluation(case, metrics, result, cost)


# ============================================================================
# run-to-run aggregation (§E variance → H4)
# ============================================================================


@dataclass(frozen=True)
class AggregateMetrics:
    """K-run aggregate for one case (spearhead.md §E "run-to-run variance" → H4).

    Rates are means over the runs; histograms are summed. With a deterministic stub every run
    is identical (variance 0) — the signal is meaningful only against a real generator.
    """

    case_id: str
    runs: int
    parse_success_rate: float
    repair_rate: float
    mean_candidates: float
    forced_inclusion_rate: float  # mean (forced_item_included / candidates_validated)
    style_move_rate: float  # mean (style_move_present / candidates_validated)
    mean_survivors: float
    mean_ranked: float
    mean_variants: float
    spread_collapsed_rate: float
    insufficient_rate: float
    rejection_histogram: dict[str, int]  # summed over runs
    cell_histogram: dict[str, int]  # summed over runs


def _ratio(numer: int, denom: int) -> float:
    return numer / denom if denom else 0.0


def aggregate(metrics_list: Sequence[CaseMetrics]) -> AggregateMetrics:
    """Aggregate K ``CaseMetrics`` for one case into rates + summed histograms (§E)."""
    if not metrics_list:
        raise ValueError("aggregate() needs at least one CaseMetrics")
    n = len(metrics_list)
    case_id = metrics_list[0].case_id

    def mean(values: Sequence[float]) -> float:
        return sum(values) / n

    rejection_histogram: dict[str, int] = {}
    cell_histogram: dict[str, int] = {}
    for m in metrics_list:
        for code, count in m.rejection_histogram.items():
            rejection_histogram[code] = rejection_histogram.get(code, 0) + count
        for cell, count in m.cells.items():
            cell_histogram[cell] = cell_histogram.get(cell, 0) + count

    return AggregateMetrics(
        case_id=case_id,
        runs=n,
        parse_success_rate=mean([1.0 if m.parse_success else 0.0 for m in metrics_list]),
        repair_rate=mean([1.0 if m.repair_used else 0.0 for m in metrics_list]),
        mean_candidates=mean([m.candidates_validated for m in metrics_list]),
        forced_inclusion_rate=mean(
            [_ratio(m.forced_item_included, m.candidates_validated) for m in metrics_list]
        ),
        style_move_rate=mean(
            [_ratio(m.style_move_present, m.candidates_validated) for m in metrics_list]
        ),
        mean_survivors=mean([m.survivors for m in metrics_list]),
        mean_ranked=mean([m.ranked_count for m in metrics_list]),
        mean_variants=mean([m.variant_count for m in metrics_list]),
        spread_collapsed_rate=mean(
            [1.0 if m.spread_collapsed else 0.0 for m in metrics_list]
        ),
        insufficient_rate=mean(
            [1.0 if m.insufficient_after_generation else 0.0 for m in metrics_list]
        ),
        rejection_histogram=rejection_histogram,
        cell_histogram=cell_histogram,
    )


# ============================================================================
# believability rubric (the irreducible human part — captured, never a gate)
# ============================================================================

# The §E believability dimensions. Captured by a human against real output; NEVER turned
# into a production gate or candidate filter (spearhead.md §E / §G "bucket, never gate").
RUBRIC_QUESTIONS: dict[str, str] = {
    "stylist_endorse": "Would a stylist endorse these as real, wearable outfits? (1-5)",
    "style_move_correct": "Does each StyleMove name a real, correct styling reason? (1-5)",
    "stretch_believable": "Is the bold/stretch option a believable stretch, not absurd? (1-5)",
    "weather_aware": "Are the outfits appropriate for the stated weather? (1-5)",
    "occasion_appropriate": "Are the outfits appropriate for the stated occasion? (1-5)",
    "rescues_forced_item": "Do the outfits genuinely make the forced item wearable? (1-5)",
}
# NOTE: there is deliberately no subjective "spread across options" dimension — spread is
# measured MECHANICALLY (CaseMetrics.cells / spread_collapsed), not rated by hand; any
# residual nuance goes in `notes` (spearhead.md §E: the validator/metrics are the oracle).


@dataclass
class BelievabilityRubric:
    """Small-N human ratings for one rescue (spearhead.md §E; mutable — filled by a reviewer).

    Each score is 1-5 (``None`` = un-rated). These are **descriptive evidence**, not a gate:
    nothing in the pipeline reads them (spearhead.md §E "do not turn subjective rubric results
    into hard production gates"). The H40 verdict (promote a vision generator, H33) is a human
    call recorded against these, never an automated branch.
    """

    stylist_endorse: Optional[int] = None
    style_move_correct: Optional[int] = None
    stretch_believable: Optional[int] = None
    weather_aware: Optional[int] = None
    occasion_appropriate: Optional[int] = None
    rescues_forced_item: Optional[int] = None
    notes: str = ""


def render_rubric_template() -> str:
    """A human-fill-in believability rubric (printed by the CLI after the variants, §E)."""
    lines = ["Believability rubric (fill in by hand — descriptive evidence, not a gate):"]
    for field_name, question in RUBRIC_QUESTIONS.items():
        lines.append(f"  [ ] {field_name:20s} __/5  — {question}")
    lines.append("  notes: ____________________________________________")
    return "\n".join(lines)


# ============================================================================
# human-readable rendering (the CLI eyeball surface)
# ============================================================================


def _items_by_id(case: CorpusCase) -> dict[str, WardrobeItem]:
    return {item.id: item for item in case.request.wardrobe}


def format_variant(
    index: int, variant: OutfitVariant, items_by_id: Mapping[str, WardrobeItem]
) -> str:
    """One surfaced variant as human-readable text (names + roles + path/risk + StyleMove)."""
    pieces = []
    for item_id, role in variant.items:
        name = items_by_id[item_id].name if item_id in items_by_id else item_id
        pieces.append(f"{name} [{role.value}]")
    header = (
        f"  ({index}) {variant.option_path.value} / {variant.risk.value}"
        f"   compat={variant.compatibility:.2f} vis={variant.visibility:.2f}"
        f" score={variant.score:.2f}"
    )
    move = variant.style_move
    return "\n".join(
        [
            header,
            "      " + "  +  ".join(pieces),
            f'      StyleMove ({move.move_type}): "{move.one_sentence}"',
        ]
    )


def _format_histogram(label: str, hist: Mapping[str, int]) -> str:
    if not hist:
        return f"  {label}: (none)"
    body = ", ".join(f"{k}={v}" for k, v in sorted(hist.items()))
    return f"  {label}: {body}"


def _format_cost_line(cost: GenerationCost) -> str:
    """One case's cost telemetry line (latency always; tokens/$ only on a real run, §E)."""
    if cost.total_tokens is None:
        tokens = "n/a"
    else:
        tokens = f"{cost.total_tokens} (p{cost.prompt_tokens}/c{cost.completion_tokens})"
    dollars = "n/a" if cost.est_cost_usd is None else f"${cost.est_cost_usd:.5f}"
    return (
        f"  latency={cost.latency_s:.2f}s  tokens={tokens}  est_cost={dollars}"
        f"  model={cost.model or 'n/a'}"
    )


def format_evaluation(evaluation: CaseEvaluation) -> str:
    """The full human-readable report for one case: header, metrics, variants, attribution, rubric."""
    case, metrics, result = evaluation.case, evaluation.metrics, evaluation.result
    items_by_id = _items_by_id(case)
    out: list[str] = []
    out.append("=" * 78)
    out.append(f"CASE  {case.case_id}")
    out.append(f"  {case.description}")
    if case.stresses:
        out.append(f"  stresses: {', '.join(case.stresses)}")
    out.append(
        f"  forced={case.request.forced_item_id}  occasion={case.request.occasion!r}"
        f"  weather={case.request.weather}"
    )
    out.append("-" * 78)

    if metrics.not_enough_items:
        out.append(f"PRE-GPT not_enough_items — no generation. hint: {metrics.reason_hint}")
        out.append("=" * 78)
        return "\n".join(out)

    out.append("Mechanical metrics:")
    out.append(
        f"  generator_calls={metrics.generator_calls}"
        f"  parse_success={metrics.parse_success}  repair_used={metrics.repair_used}"
    )
    out.append(
        f"  candidates_validated={metrics.candidates_validated}"
        f"  forced_included={metrics.forced_item_included}"
        f"  style_move_present={metrics.style_move_present}"
    )
    out.append(
        f"  survivors={metrics.survivors}"
        f"  (dropped: missing_forced={metrics.dropped_missing_forced},"
        f" missing_style_move={metrics.dropped_missing_style_move})"
    )
    out.append(
        f"  ranked_count={metrics.ranked_count}  variant_count={metrics.variant_count}"
        f"  spread_collapsed={metrics.spread_collapsed}"
        f"  insufficient_after_generation={metrics.insufficient_after_generation}"
    )
    out.append(f"  fallback_stage={metrics.fallback_stage}")
    out.append(_format_histogram("rejections", metrics.rejection_histogram))
    out.append(_format_histogram("warnings", metrics.warning_histogram))
    out.append(_format_histogram("cells", metrics.cells))
    out.append(_format_cost_line(evaluation.cost))
    out.append("-" * 78)

    out.append(f"Surfaced ways to wear (n={metrics.variant_count}):")
    if result.variants:
        for i, variant in enumerate(result.variants, start=1):
            out.append(format_variant(i, variant, items_by_id))
    else:
        out.append("  (none surfaced)")
    out.append("-" * 78)
    out.append(render_rubric_template())
    out.append("=" * 78)
    return "\n".join(out)


def format_aggregate(agg: AggregateMetrics) -> str:
    """A K-run aggregate as human-readable text (the CLI ``--runs`` summary, §E variance)."""
    out = [
        f"AGGREGATE  {agg.case_id}  over {agg.runs} run(s):",
        f"  parse_success_rate={agg.parse_success_rate:.2f}"
        f"  repair_rate={agg.repair_rate:.2f}",
        f"  mean_candidates={agg.mean_candidates:.2f}"
        f"  forced_inclusion_rate={agg.forced_inclusion_rate:.2f}"
        f"  style_move_rate={agg.style_move_rate:.2f}",
        f"  mean_survivors={agg.mean_survivors:.2f}"
        f"  mean_ranked={agg.mean_ranked:.2f}  mean_variants={agg.mean_variants:.2f}",
        f"  spread_collapsed_rate={agg.spread_collapsed_rate:.2f}"
        f"  insufficient_rate={agg.insufficient_rate:.2f}",
        _format_histogram("rejections (summed)", agg.rejection_histogram),
        _format_histogram("cells (summed)", agg.cell_histogram),
    ]
    return "\n".join(out)


# ============================================================================
# cost / latency aggregation (§E "latency p50/p95 + $/rescue")
# ============================================================================


@dataclass(frozen=True)
class CostAggregate:
    """Aggregate latency/token/cost across rescues (C6 eval — §E p50/p95 + $/rescue).

    Pre-GPT (0-call) rescues are excluded from every figure — they make no generation, so
    they would skew latency and cost toward zero. Token/cost totals are ``None`` unless every
    counted rescue exposed usage (so a dry-run or hermetic batch reports latency only).
    """

    rescues: int  # rescues that actually generated (>= 1 call)
    p50_latency_s: float
    p95_latency_s: float
    mean_latency_s: float
    total_tokens: Optional[int]
    mean_total_tokens: Optional[float]
    est_total_cost_usd: Optional[float]
    est_cost_per_rescue_usd: Optional[float]


def _percentile(values: Sequence[float], p: float) -> float:
    """Nearest-rank percentile (``p`` in [0, 100]); ``0.0`` for an empty sequence."""
    if not values:
        return 0.0
    ordered = sorted(values)
    idx = int(round((p / 100.0) * (len(ordered) - 1)))
    idx = max(0, min(len(ordered) - 1, idx))
    return ordered[idx]


def aggregate_cost(costs: Sequence[GenerationCost]) -> CostAggregate:
    """Aggregate per-rescue costs → p50/p95 latency, token totals, and $/rescue (§E)."""
    generating = [c for c in costs if c.generator_calls >= 1]
    n = len(generating)
    if n == 0:
        return CostAggregate(0, 0.0, 0.0, 0.0, None, None, None, None)
    latencies = [c.latency_s for c in generating]
    have_tokens = all(c.total_tokens is not None for c in generating)
    total_tokens = (
        sum(c.total_tokens for c in generating if c.total_tokens is not None)
        if have_tokens
        else None
    )
    have_cost = all(c.est_cost_usd is not None for c in generating)
    est_total = (
        sum(c.est_cost_usd for c in generating if c.est_cost_usd is not None)
        if have_cost
        else None
    )
    return CostAggregate(
        rescues=n,
        p50_latency_s=_percentile(latencies, 50),
        p95_latency_s=_percentile(latencies, 95),
        mean_latency_s=sum(latencies) / n,
        total_tokens=total_tokens,
        mean_total_tokens=(total_tokens / n) if total_tokens is not None else None,
        est_total_cost_usd=est_total,
        est_cost_per_rescue_usd=(est_total / n) if est_total is not None else None,
    )


def format_cost_aggregate(agg: CostAggregate) -> str:
    """The global cost/latency summary line block (the CLI prints it once at the end, §E)."""
    if agg.rescues == 0:
        return "# cost / latency: no generating rescues (all pre-GPT exits)"
    lines = [
        f"# cost / latency over {agg.rescues} generating rescue(s):",
        f"#   latency  p50={agg.p50_latency_s:.2f}s  p95={agg.p95_latency_s:.2f}s"
        f"  mean={agg.mean_latency_s:.2f}s",
    ]
    if agg.total_tokens is None:
        lines.append("#   tokens   n/a (generator exposed no usage — hermetic/dry-run)")
    else:
        lines.append(
            f"#   tokens   total={agg.total_tokens}  mean={agg.mean_total_tokens:.0f}"
        )
    if agg.est_cost_per_rescue_usd is None:
        lines.append("#   est cost n/a (no usage or unpriced model)")
    else:
        lines.append(
            f"#   est cost total=${agg.est_total_cost_usd:.5f}"
            f"  per-rescue=${agg.est_cost_per_rescue_usd:.5f}"
        )
    return "\n".join(lines)
