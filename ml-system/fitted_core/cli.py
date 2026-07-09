"""Spearhead C6 manual / H40 run path — eyeball believability against a real generator.

The non-test entry point (spearhead.md §B/§J): drive the golden corpus through the rescue
pipeline and print the mechanical metrics, the surfaced ways-to-wear, and a believability
rubric template for a human to fill in.

    # Real OpenAI run (needs OPENAI_API_KEY) — reproduce the historical H40
    # believability measurement, not the current M5 default:
    python -m fitted_core.cli --closet tests/fixtures/corpus/green_shirt.json --model gpt-4o --temperature 0.8
    python -m fitted_core.cli --corpus-dir tests/fixtures/corpus --runs 5 --model gpt-4o --temperature 0.8

    # Hermetic demo (no key, no network) — replays each case's canned_response:
    python -m fitted_core.cli --closet tests/fixtures/corpus/green_shirt.json --dry-run

This is the **only** place ``OpenAIGenerator`` is constructed (the ``openai`` import stays
lazy/local inside it, spearhead.md §B), so importing this module needs neither the dependency
nor a key — only a real ``--closet``/``--corpus-dir`` run without ``--dry-run`` does. Tests
drive the harness with stubs/replays and never reach the real generator (spearhead.md §A/§I).

Sources: docs/plans/spearhead.md §B/§E/§J, §H (last row — the missing-key error lives here only).
"""

import argparse
import os
import sys
import time
from typing import Callable, Optional, Sequence

from fitted_core.evaluation import (
    CorpusCase,
    GenerationCost,
    aggregate,
    aggregate_cost,
    aggregate_daily,
    evaluate_case,
    evaluate_daily_case,
    format_aggregate,
    format_cost_aggregate,
    format_daily_aggregate,
    format_daily_evaluation,
    format_evaluation,
    load_corpus_case,
    load_corpus_dir,
    load_daily_corpus_case,
    load_daily_corpus_dir,
    replay_generator_for,
)
from fitted_core.generation import (
    RESPONSE_FORMAT_JSON_OBJECT,
    Generator,
    OpenAIGenerator,
    ReplayGenerator,
)

# An empty-envelope replay for a --dry-run case that carries no canned_response (a pre-GPT
# exit never calls the generator; if it somehow does, an empty envelope yields a graceful
# insufficient — never a crash). Real generation is the only way to exercise such a case.
_EMPTY_ENVELOPE = '{"outfits": []}'


def _generator_surface_kwargs(model: str) -> dict:
    """Keep the M5 live defaults on GPT-5.x, but do not leak GPT-5-only params into
    historical/manual gpt-4o reruns (H40 provenance).
    """
    if model.startswith("gpt-5"):
        return {}
    return {
        "reasoning_effort": None,
        "response_format": RESPONSE_FORMAT_JSON_OBJECT,
        "prompt_cache_retention": None,
    }


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python -m fitted_core.cli",
        description="Run the Spearhead golden corpus through the rescue pipeline (C6/H40).",
    )
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument(
        "--closet", metavar="PATH", help="a single corpus case JSON file to run"
    )
    source.add_argument(
        "--corpus-dir", metavar="DIR", help="run every *.json case in this directory"
    )
    parser.add_argument(
        "--intent",
        choices=("rescue", "daily"),
        default="rescue",
        help="which render intent to evaluate (default: rescue). daily = the M5 C8 F3 daily "
        "mechanical read (a daily corpus carries no forced_item_id).",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="replay each case's canned_response instead of calling OpenAI (no key needed)",
    )
    parser.add_argument(
        "--model",
        default="gpt-5.4-mini",
        help="OpenAI model for a real run (default: gpt-5.4-mini)",
    )
    parser.add_argument(
        "--temperature",
        type=float,
        default=0.5,
        help="sampling temperature — higher widens the vibe range (default: 0.5)",
    )
    parser.add_argument(
        "--max-completion-tokens",
        type=int,
        default=None,
        help="optional max_completion_tokens for a real run",
    )
    parser.add_argument(
        "--runs",
        type=int,
        default=1,
        help="run each case K times and print an aggregate (run-to-run variance, H4)",
    )
    return parser


def _make_generator_factory(
    args: argparse.Namespace, case: CorpusCase
) -> Callable[[], Generator]:
    """A zero-arg factory yielding a FRESH ``Generator`` per run (spearhead.md §B).

    ``--dry-run`` replays the case's canned response (an empty envelope when it has none);
    otherwise a real ``OpenAIGenerator`` with the chosen model/temperature. A fresh instance
    per run keeps multi-run replay state from leaking across runs and lets a real run sample
    independently each time.
    """
    if args.dry_run:
        if case.canned_response is not None:
            return lambda: replay_generator_for(case)
        return lambda: ReplayGenerator(_EMPTY_ENVELOPE)
    return lambda: OpenAIGenerator(
        model=args.model,
        temperature=args.temperature,
        max_completion_tokens=args.max_completion_tokens,
        **_generator_surface_kwargs(args.model),
    )


def _run_case(
    case: CorpusCase, make_generator: Callable[[], Generator], runs: int, intent: str
) -> tuple[str, list[GenerationCost]]:
    """Evaluate one case ``runs`` times; return the report (+ aggregate when runs > 1) and the
    per-run cost records (rolled into the global §E latency/$/rescue summary by ``main``).

    ``intent`` selects the evaluator: rescue re-derives stages over the closed ``rescue()``; daily
    reads the metrics off ``render_with_trace``'s trace (F3)."""
    if intent == "daily":
        evals = [evaluate_daily_case(case, make_generator()) for _ in range(runs)]
        report = format_daily_evaluation(evals[0])
        if runs > 1:
            agg = aggregate_daily([e.metrics for e in evals])
            report = report + "\n" + format_daily_aggregate(agg)
        return report, [e.cost for e in evals]
    evaluations = [evaluate_case(case, make_generator()) for _ in range(runs)]
    report = format_evaluation(evaluations[0])
    if runs > 1:
        agg = aggregate([e.metrics for e in evaluations])
        report = report + "\n" + format_aggregate(agg)
    return report, [e.cost for e in evaluations]


def _load_cases(args: argparse.Namespace) -> list[CorpusCase]:
    load_one = load_daily_corpus_case if args.intent == "daily" else load_corpus_case
    load_dir = load_daily_corpus_dir if args.intent == "daily" else load_corpus_dir
    if args.closet:
        return [load_one(args.closet)]
    return load_dir(args.corpus_dir)


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = _build_parser().parse_args(argv)

    if args.runs < 1:
        print("error: --runs must be >= 1", file=sys.stderr)
        return 2

    # The missing-key guard lives here only (spearhead.md §H last row): a real run needs a key,
    # so fail early and clearly with a --dry-run pointer rather than deep in the openai client.
    if not args.dry_run and not os.environ.get("OPENAI_API_KEY"):
        print(
            "error: OPENAI_API_KEY is not set — a real run needs it.\n"
            "       Re-run with --dry-run to replay each case's canned response without a key.",
            file=sys.stderr,
        )
        return 2

    try:
        cases = _load_cases(args)
    except (OSError, ValueError, KeyError) as exc:
        print(f"error: could not load corpus: {exc}", file=sys.stderr)
        return 2

    mode = "dry-run (replayed)" if args.dry_run else f"real OpenAI model={args.model}"
    print(
        f"# Spearhead C6 eval — intent={args.intent} — {len(cases)} case(s) — {mode} "
        f"— runs={args.runs}\n"
    )

    started = time.perf_counter()
    all_costs: list[GenerationCost] = []
    for case in cases:
        make_generator = _make_generator_factory(args, case)
        report, costs = _run_case(case, make_generator, args.runs, args.intent)
        print(report)
        print()
        all_costs.extend(costs)
    elapsed = time.perf_counter() - started
    print(format_cost_aggregate(aggregate_cost(all_costs)))
    print(f"# done in {elapsed:.2f}s")
    return 0


if __name__ == "__main__":  # pragma: no cover — module-run entry only
    sys.exit(main())
