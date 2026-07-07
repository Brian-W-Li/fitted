"""C6 tests — the manual/H40 CLI (spearhead.md §C C6, §B/§J).

Hermetic: only the ``--dry-run`` (replay) path and pure arg/factory helpers are exercised —
the real ``OpenAIGenerator.generate`` is NEVER called, so no live OpenAI and no ``openai``
dependency are needed (spearhead.md §A/§I, §H last row). The missing-key guard is tested by
its early, clear error (returns 2), not by reaching the network.
"""

from pathlib import Path

import pytest

from fitted_core import cli
from fitted_core.generation import OpenAIGenerator, ReplayGenerator

CORPUS_DIR = Path(__file__).parent / "fixtures" / "corpus"
GREEN = str(CORPUS_DIR / "green_shirt.json")
INSUFFICIENT = str(CORPUS_DIR / "tiny_insufficient.json")


# ============================================================================
# --dry-run (replay) — the hermetic happy path
# ============================================================================


def test_dry_run_single_case_prints_report(capsys):
    rc = cli.main(["--closet", GREEN, "--dry-run"])
    out = capsys.readouterr().out
    assert rc == 0
    assert "CASE  green_shirt" in out
    assert "Mechanical metrics:" in out
    assert "Surfaced ways to wear" in out
    assert "Believability rubric" in out
    assert "dry-run (replayed)" in out


def test_dry_run_corpus_dir_runs_every_case(capsys):
    rc = cli.main(["--corpus-dir", str(CORPUS_DIR), "--dry-run"])
    out = capsys.readouterr().out
    assert rc == 0
    for case_id in ("green_shirt", "forced_dress_tiny", "tiny_insufficient", "id_conformance"):
        assert f"CASE  {case_id}" in out


def test_dry_run_pre_gpt_case(capsys):
    # tiny_insufficient has no canned_response → CLI uses an empty-envelope replay; the case
    # exits pre-GPT anyway, so the report shows the structural insufficiency.
    rc = cli.main(["--closet", INSUFFICIENT, "--dry-run"])
    out = capsys.readouterr().out
    assert rc == 0
    assert "PRE-GPT not_enough_items" in out


def test_dry_run_with_runs_prints_aggregate(capsys):
    rc = cli.main(["--closet", GREEN, "--dry-run", "--runs", "3"])
    out = capsys.readouterr().out
    assert rc == 0
    assert "AGGREGATE  green_shirt  over 3 run(s)" in out
    assert "parse_success_rate=1.00" in out


def test_dry_run_prints_global_cost_summary(capsys):
    # The §E cost/latency summary always renders; under --dry-run there is no token usage,
    # so latency is reported while tokens/$ read n/a (no OpenAI, fully hermetic).
    rc = cli.main(["--corpus-dir", str(CORPUS_DIR), "--dry-run"])
    out = capsys.readouterr().out
    assert rc == 0
    assert "# cost / latency over" in out
    assert "latency  p50=" in out
    assert "tokens   n/a" in out  # dry-run exposes no usage


# ============================================================================
# generator selection — model/temperature configurable, no live call
# ============================================================================


def test_factory_real_path_builds_openai_generator_without_calling_it():
    case = cli.load_corpus_case(GREEN)
    args = cli._build_parser().parse_args(
        [
            "--closet",
            GREEN,
            "--model",
            "gpt-4o-mini",
            "--temperature",
            "0.3",
            "--max-completion-tokens",
            "512",
        ]
    )
    factory = cli._make_generator_factory(args, case)
    generator = factory()  # construction only — no generate(), so no openai/key needed
    assert isinstance(generator, OpenAIGenerator)
    assert generator._model == "gpt-4o-mini"  # model is configurable (C6 A/B lever)
    assert generator._temperature == 0.3  # temperature is configurable
    assert generator._max_completion_tokens == 512


def test_factory_dry_run_path_builds_replay_generator():
    case = cli.load_corpus_case(GREEN)
    args = cli._build_parser().parse_args(["--closet", GREEN, "--dry-run"])
    generator = cli._make_generator_factory(args, case)()
    assert isinstance(generator, ReplayGenerator)


# ============================================================================
# guards — missing key, bad runs, missing source, load failure
# ============================================================================


def test_real_run_without_api_key_errors_clearly(monkeypatch, capsys):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    rc = cli.main(["--closet", GREEN])  # no --dry-run, no key
    err = capsys.readouterr().err
    assert rc == 2
    assert "OPENAI_API_KEY" in err
    assert "--dry-run" in err  # the error points at the hermetic escape hatch


def test_runs_must_be_positive(monkeypatch, capsys):
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")  # past the key guard
    rc = cli.main(["--closet", GREEN, "--dry-run", "--runs", "0"])
    assert rc == 2
    assert "--runs must be >= 1" in capsys.readouterr().err


def test_missing_source_is_an_argparse_error():
    with pytest.raises(SystemExit):  # argparse required mutually-exclusive group
        cli.main(["--dry-run"])


def test_unloadable_closet_path_errors(capsys):
    rc = cli.main(["--closet", "does-not-exist.json", "--dry-run"])
    assert rc == 2
    assert "could not load corpus" in capsys.readouterr().err


# ============================================================================
# hermetic-import guarantee
# ============================================================================


def test_cli_module_has_no_openai_binding():
    import fitted_core.cli as cli_mod

    assert not hasattr(cli_mod, "openai")  # importing the CLI never imports the dependency
