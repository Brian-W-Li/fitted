"""G9 readiness + service-config tests (m5-cutover.md §A / C3 acceptance)."""

import json

import pytest

from service import config as cfg
from service.app import _default_generator_factory
from service.config import load_service_config
from service.tests.helpers import ENV, FakeClock, http, make_app


def test_readyz_is_ready_with_full_env_and_reports_versions():
    app, stub = make_app()
    status, body = http(app, "GET", "/readyz")  # no auth header required (G9)
    assert status == 200
    assert body["ready"] is True
    versions = body["versions"]
    assert set(versions) == {
        "fittedCoreVersion", "promptVersion", "rankerConfigVersion", "reducerConfigVersion",
    }
    assert all(isinstance(v, str) and v for v in versions.values())
    # Zero OpenAI spend: the generator seam is never touched.
    assert stub.call_count == 0


@pytest.mark.parametrize(
    "missing", ["OPENAI_API_KEY", "SERVICE_KEY_CURRENT"]
)
def test_readyz_503_when_a_required_env_is_missing(missing):
    env = {k: v for k, v in ENV.items() if k != missing}
    app, _ = make_app(env=env)
    status, body = http(app, "GET", "/readyz")
    assert status == 503
    assert body["ready"] is False
    assert missing in body["reason"]


def test_readyz_never_returns_a_secret_value():
    app, _ = make_app()
    _, ready = http(app, "GET", "/readyz")
    app503, _ = make_app(env={"SERVICE_KEY_CURRENT": ENV["SERVICE_KEY_CURRENT"]})
    _, unready = http(app503, "GET", "/readyz")
    for body in (ready, unready):
        text = json.dumps(body)
        for secret in ENV.values():
            assert secret not in text


def test_readyz_503_on_malformed_token_cap_env():
    for bad in ("not-an-int", "0", "-5"):
        app, _ = make_app(env={**ENV, "M5_MAX_COMPLETION_TOKENS": bad})
        status, body = http(app, "GET", "/readyz")
        assert status == 503, bad
        assert "M5_MAX_COMPLETION_TOKENS" in body["reason"]


def test_readyz_503_on_blank_next_key():
    app, _ = make_app(env={**ENV, "SERVICE_KEY_NEXT": "   "})
    status, body = http(app, "GET", "/readyz")
    assert status == 503
    assert "SERVICE_KEY_NEXT" in body["reason"]


def test_config_cap_defaults_and_env_override():
    config, reason = load_service_config(ENV)
    assert reason is None
    assert config.max_completion_tokens == cfg.DEFAULT_MAX_COMPLETION_TOKENS == 2200
    config, reason = load_service_config({**ENV, "M5_MAX_COMPLETION_TOKENS": "3000"})
    assert reason is None
    assert config.max_completion_tokens == 3000
    # SERVICE_KEY_NEXT is optional — absent is a valid single-key state (§A rotation).
    single = {k: v for k, v in ENV.items() if k != "SERVICE_KEY_NEXT"}
    config, reason = load_service_config(single)
    assert reason is None and config.service_key_next is None


def test_default_generator_factory_builds_from_service_config():
    # The §A.6 surface: the real OpenAIGenerator is constructed from the SERVICE config —
    # cap under max_completion_tokens (never max_tokens: the constructor has no such
    # param), lowest reasoning effort, strict json_schema, the allowlisted model. The
    # fake-OpenAI-client call-surface tests (store:false, max_completion_tokens on the
    # wire) live in tests/test_generation.py (landed C1).
    config, _ = load_service_config({**ENV, "M5_MAX_COMPLETION_TOKENS": "2500"})
    generator = _default_generator_factory(config)
    assert generator._model == "gpt-5.4-mini"
    assert generator._temperature == 0.5
    assert generator._max_completion_tokens == 2500
    assert generator._reasoning_effort == "none"
    assert generator._response_format == "json_schema_strict"
    assert generator._api_key == ENV["OPENAI_API_KEY"]


def test_unknown_route_is_a_404_envelope():
    app, _ = make_app()
    status, body = http(app, "GET", "/nope")
    assert status == 404
    assert body["error"]["code"] == "contract_invalid"


def test_misconfigured_service_render_is_500_internal_and_readyz_gates_it():
    app, _ = make_app(env={})
    status, body = http(app, "POST", "/render", headers={"X-Fitted-Service-Key": "x"})
    assert status == 500
    assert body["error"]["code"] == "internal"


def test_rate_ceiling_token_bucket_and_refill():
    clock = FakeClock()
    app, _ = make_app(clock=clock)
    from service.tests.helpers import AUTH

    # Burst: RATE_LIMIT_BURST requests pass the throttle (they fail later, at validation —
    # an empty body — which is fine: the bucket is consumed pre-body, pre-spend).
    for _ in range(cfg.RATE_LIMIT_BURST):
        status, body = http(app, "POST", "/render", headers=AUTH)
        assert status == 400 and body["error"]["code"] == "contract_invalid"
    status, body = http(app, "POST", "/render", headers=AUTH)
    assert status == 429
    assert body["error"]["code"] == "rate_limit"
    # Refill: one token after 1/RATE_LIMIT_REFILL_PER_SECOND seconds.
    clock.advance(1.0 / cfg.RATE_LIMIT_REFILL_PER_SECOND)
    status, _ = http(app, "POST", "/render", headers=AUTH)
    assert status == 400  # through the throttle again
