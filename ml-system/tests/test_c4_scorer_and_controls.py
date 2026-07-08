"""M5 C4 — the H28 scorer seam (§E) + the regenerate vertical controls (§C.3).

Covers, per the C4 acceptance + Mutation-hardening list (m5-cutover.md):
  - the OutfitScorer producer exercise: every SCORED candidate carries non-null [0,1]
    compat/vis (the H48 *sibling* — incl. scored-but-unshown);
  - the H48 *headline*: a variant-cap loser keeps its Step-5 breakdown AND gets compat/vis
    (uniform scoreTrace surface), while a Step-4 hard-filter drop carries NEITHER (G12 inverse);
  - the closed M3 rank()/rank_with_audit result+scored stay byte-stable (no order change);
  - diagnostics.ranker carries reducer_config_version + the reduced RankerContext signals;
  - scorer.available flips True on a healthy write, stays False on a degenerate one;
  - regen controls: a locked item is dropped post-validation if missing, a disliked item never
    surfaces (Step-4), and the payload's controls block mirrors the request (F6).
"""

import dataclasses
import json

from fitted_core import snapshot_serde
from fitted_core.models import ItemType, Role, WardrobeItem
from fitted_core.ranker import ScoreBreakdown, rank, rank_with_audit
from fitted_core.reducers import REDUCER_CONFIG_VERSION, BehavioralSignals
from fitted_core.rescue import RenderRequest, render_with_trace
from fitted_core.scorer import OutfitScore
from fitted_core.snapshot import (
    EngineFailure,
    build_degenerate_payload,
    build_snapshot_payload,
)
from tests.helpers import StubGenerator
from tests.test_ranker import _candidate, _ctx


def _item(item_id: str, item_type: ItemType) -> WardrobeItem:
    return WardrobeItem(item_id, item_id, item_type, warmth=5, image_url=f"{item_id}.jpg",
                        color_tags=["navy"], style_tags=["solid"], occasion_tags=["casual"])


def _vp(item_id: str, role: Role) -> dict:
    return {"itemId": item_id, "role": role.value}


def _outfit(items: list[tuple[str, Role]], changed: list[str]) -> dict:
    return {
        "items": [_vp(i, r) for i, r in items],
        "styleMove": {"moveType": "style", "changedItemIds": list(changed), "oneSentence": "An idea."},
    }


def _envelope(*outfits: dict) -> str:
    return json.dumps({"outfits": list(outfits)})


def _daily(wardrobe, **kwargs) -> RenderRequest:
    return RenderRequest(
        wardrobe=wardrobe, forced_item_id=None, occasion="weekday work", weather="mild",
        session_id="c4-session", wardrobe_version=1, intent="daily", **kwargs,
    )


def _payload(request, envelope, **overrides):
    trace = render_with_trace(request, StubGenerator(envelope))
    kwargs = dict(
        candidate_cache_key="ck-c4", request_id="c4111111-1111-4111-8111-111111111111",
        generator_provider="openai", generator_model="gpt-5.4-mini", generator_temperature=0.5,
        generator_max_completion_tokens=2200,
    )
    kwargs.update(overrides)
    return build_snapshot_payload(trace, request, **kwargs), trace


# A variant-cap scenario: one base_key (t1:b1) with 4 shoe variants, k=n_surfaced=2 so the cap
# is NOT relaxed by the fallback ladder (2 survive, 2 stick in .filtered as diversity_capped).
def _variant_cap_request(**overrides):
    wardrobe = [
        _item("t1", ItemType.top), _item("b1", ItemType.bottom),
        _item("s1", ItemType.shoes), _item("s2", ItemType.shoes), _item("s3", ItemType.shoes),
    ]
    return _daily(wardrobe, k=2, n_surfaced=2, **overrides)


def _variant_cap_envelope() -> str:
    return _envelope(
        _outfit([("t1", Role.base_top), ("b1", Role.base_bottom)], ["t1"]),
        _outfit([("t1", Role.base_top), ("b1", Role.base_bottom), ("s1", Role.shoes)], ["s1"]),
        _outfit([("t1", Role.base_top), ("b1", Role.base_bottom), ("s2", Role.shoes)], ["s2"]),
        _outfit([("t1", Role.base_top), ("b1", Role.base_bottom), ("s3", Role.shoes)], ["s3"]),
    )


# ============================ §E — the producer scorer exercise ============================


def test_every_scored_candidate_carries_non_null_compat_vis():
    # H48 sibling: a scored-but-unshown candidate (variant-cap loser is scored under the relaxed
    # ladder here — k large) still carries finite [0,1] compat/vis, not just shown candidates.
    wardrobe = [_item("t1", ItemType.top), _item("b1", ItemType.bottom),
                _item("b2", ItemType.bottom), _item("s1", ItemType.shoes)]
    request = _daily(wardrobe, n_surfaced=1)  # 1 surfaced, ≥2 scored → a scored-but-unshown exists
    env = _envelope(
        _outfit([("t1", Role.base_top), ("b1", Role.base_bottom)], ["t1"]),
        _outfit([("t1", Role.base_top), ("b2", Role.base_bottom)], ["t1"]),
    )
    payload, _ = _payload(request, env)
    scored = [c for c in payload.candidates if c.score_trace is not None]
    assert len(scored) >= 2
    for c in scored:
        assert c.score_trace.compatibility is not None and 0.0 <= c.score_trace.compatibility <= 1.0
        assert c.score_trace.visibility is not None and 0.0 <= c.score_trace.visibility <= 1.0
    assert any(not c.shown for c in scored), "a scored-but-unshown candidate must be present (H48 sibling)"


def test_variant_cap_loser_keeps_breakdown_and_compat_vis():
    # H48 headline: a variant-cap-dropped candidate (dropStage=ranker/diversity_capped) carries its
    # Step-5 breakdown AND non-null compat/vis — the uniform scoreTrace surface (breakdown ⇒ compat/vis).
    payload, trace = _payload(_variant_cap_request(), _variant_cap_envelope())
    capped = [c for c in payload.candidates
              if c.drop_stage == "ranker" and c.drop_reason == "ranker_diversity_capped"]
    assert capped, "the variant cap must strand ≥1 Step-4-passing candidate (k not relaxed)"
    for c in capped:
        assert c.score_trace is not None
        bd = c.score_trace.score_breakdown
        assert bd is not None  # the preserved Step-5 breakdown
        assert c.score_trace.compatibility is not None and 0.0 <= c.score_trace.compatibility <= 1.0
        assert c.score_trace.visibility is not None and 0.0 <= c.score_trace.visibility <= 1.0
        # N4/G12: a scoreBreakdown-carrying candidate must have rankerScore == Σ(the 7 terms) — a
        # capped loser with a null rankerScore would be rejected by the C5 G12 helper.
        assert c.score_trace.ranker_score is not None
        assert c.score_trace.ranker_score == sum(bd.values())
        assert c.style_move is not None
        assert c.style_move["changed_item_ids"]


def test_step4_hard_drop_carries_no_score_trace():
    # G12 inverse: a Step-4 contextual-dislike drop never reached scoring → NO breakdown, NO
    # scoreTrace (the helper must not demand a trace on an unscored drop).
    wardrobe = [_item("t1", ItemType.top), _item("b1", ItemType.bottom), _item("s1", ItemType.shoes)]
    request = _daily(wardrobe, disliked_item_ids=("s1",))
    env = _envelope(
        _outfit([("t1", Role.base_top), ("b1", Role.base_bottom)], ["t1"]),
        _outfit([("t1", Role.base_top), ("b1", Role.base_bottom), ("s1", Role.shoes)], ["s1"]),
    )
    payload, _ = _payload(request, env)
    dropped = [c for c in payload.candidates if c.drop_reason == "ranker_contextual_disliked"]
    assert dropped, "the s1 outfit must be contextually dropped"
    for c in dropped:
        assert c.score_trace is None  # no breakdown ⇒ no scoreTrace (G12 inverse)
        assert c.style_move is not None  # still a valid GPT candidate; only Step-4 filtered


def test_shown_compat_vis_unchanged_by_the_scorer_seam():
    # The scorer occupant is the SAME pure functions the response layer bucketed path/risk from,
    # so a shown candidate's compat/vis equals the build_trace variant's (byte-identical).
    payload, trace = _payload(_variant_cap_request(), _variant_cap_envelope())
    by_sig = {v.full_signature: v for v in trace.build_trace.all_variants}
    shown = [c for c in payload.candidates if c.shown]
    assert shown
    for c in shown:
        v = by_sig[c.full_signature]
        assert c.score_trace.compatibility == v.compatibility
        assert c.score_trace.visibility == v.visibility


def test_scorer_available_true_on_healthy_false_on_degenerate():
    payload, _ = _payload(_variant_cap_request(), _variant_cap_envelope())
    assert payload.scorer == {"kind": "cold_start", "model_id": None, "available": True}
    # a degenerate write did no scoring → available stays False
    request = _daily([_item("t1", ItemType.top), _item("b1", ItemType.bottom)])
    degenerate = build_degenerate_payload(
        request, EngineFailure(stage="pre_generation", code="internal_exception"),
        candidate_cache_key="ck", request_id="c4111111-1111-4111-8111-111111111112",
        generator_provider="openai", generator_model="gpt-5.4-mini", generator_temperature=0.5,
        generator_max_completion_tokens=2200,
    )
    assert degenerate.scorer["available"] is False


def test_custom_outfit_scorer_is_exercised_over_scored_candidates():
    # Prove the seam is a real injection point M6 fills — a stub scorer's values reach scoreTrace.
    def stub_scorer(slot_map, items_by_id, request):
        return OutfitScore(compatibility=0.42, visibility=0.17, signal_score=None)

    payload, _ = _payload(_variant_cap_request(), _variant_cap_envelope(), outfit_scorer=stub_scorer)
    scored = [c for c in payload.candidates if c.score_trace is not None]
    assert scored
    for c in scored:
        assert c.score_trace.compatibility == 0.42 and c.score_trace.visibility == 0.17


# ============================ §E/§H — diagnostics.ranker provenance ============================


def test_diagnostics_ranker_carries_reducer_provenance_and_reduced_signals():
    wardrobe = [_item("t1", ItemType.top), _item("b1", ItemType.bottom)]
    request = _daily(wardrobe)
    signals = BehavioralSignals(
        item_affinity={"t1": 3, "b1": 1},
        liked_full_signatures=frozenset({"t1:b1|outer=none|shoes=none"}),
        shown_full_signatures=("prior-sig",),
        recent_disliked_base_keys=("x:y",),
        recent_disliked_item_ids=("z1",),
    )
    trace = render_with_trace(
        request, StubGenerator(_envelope(_outfit([("t1", Role.base_top), ("b1", Role.base_bottom)], ["t1"]))),
        behavioral_signals=signals,
    )
    payload = build_snapshot_payload(
        trace, request, candidate_cache_key="ck", request_id="c4111111-1111-4111-8111-111111111113",
        generator_provider="openai", generator_model="gpt-5.4-mini", generator_temperature=0.5,
        generator_max_completion_tokens=2200,
    )
    ranker = payload.diagnostics.ranker
    assert ranker["reducer_config_version"] == REDUCER_CONFIG_VERSION
    assert ranker["item_affinity"] == {"t1": 3, "b1": 1}
    assert ranker["liked_full_signatures"] == ["t1:b1|outer=none|shoes=none"]
    assert ranker["shown_full_signatures"] == ["prior-sig"]
    assert ranker["recent_disliked_base_keys"] == ["x:y"]
    assert ranker["recent_disliked_item_ids"] == ["z1"]


def test_diagnostics_ranker_item_affinity_keys_survive_serde():
    # itemAffinity is a DATA-keyed Map (item id → count): an id like "my_item" must NOT be
    # camelCased to "myItem" crossing the wire (registered in _OPAQUE_VALUE_KEYS).
    wardrobe = [_item("my_item", ItemType.top), _item("b1", ItemType.bottom)]
    request = _daily(wardrobe)
    signals = BehavioralSignals(
        item_affinity={"my_item": 2}, liked_full_signatures=frozenset(),
        shown_full_signatures=(), recent_disliked_base_keys=(), recent_disliked_item_ids=(),
    )
    trace = render_with_trace(
        request, StubGenerator(_envelope(_outfit([("my_item", Role.base_top), ("b1", Role.base_bottom)], ["my_item"]))),
        behavioral_signals=signals,
    )
    payload = build_snapshot_payload(
        trace, request, candidate_cache_key="ck", request_id="c4111111-1111-4111-8111-111111111114",
        generator_provider="openai", generator_model="gpt-5.4-mini", generator_temperature=0.5,
        generator_max_completion_tokens=2200,
    )
    wire = snapshot_serde.to_wire(dataclasses.asdict(payload))
    assert wire["diagnostics"]["ranker"]["itemAffinity"] == {"my_item": 2}  # key verbatim, not "myItem"
    # full round-trip is byte-stable
    assert snapshot_serde.from_wire(json.loads(json.dumps(wire)))["diagnostics"]["ranker"]["item_affinity"] == {"my_item": 2}


# ============================ H48 headline — the ranker sibling ============================


def test_rank_with_audit_preserves_variant_cap_loser_breakdown_only():
    # 3 shoe variants of one base_key, k=2 → the cap strands 1 as diversity_capped WITH a Step-5
    # breakdown; a contextual-dislike drop stays breakdown-less. rank()/result/scored untouched.
    variants = [
        _candidate(source_index=0, top="t1", bottom="b1", shoes=None),
        _candidate(source_index=1, top="t1", bottom="b1", shoes="s1"),
        _candidate(source_index=2, top="t1", bottom="b1", shoes="s2"),
    ]
    ctx = _ctx(k=2)
    audit = rank_with_audit(variants, ctx)
    capped = [f for f in audit.filtered if f.drop_reason == "ranker_diversity_capped"]
    assert capped, "the variant cap must strand a candidate at k=2"
    for f in capped:
        assert isinstance(f.score_breakdown, ScoreBreakdown)  # H48 headline: Step-5 breakdown kept
    # determinism/no-order-change guard: the public result + scored funnel are unchanged.
    assert audit.result == rank(variants, ctx)
    assert audit.scored[: len(audit.result.outfits)] == audit.result.outfits


def test_rank_with_audit_step4_drop_has_no_breakdown():
    # A contextual-dislike drop never reached scoring → score_breakdown is None (G12 inverse).
    survivor = _candidate(source_index=0, top="t1", bottom="b1")
    disliked = _candidate(source_index=1, top="t1", bottom="bX")
    audit = rank_with_audit([survivor, disliked], _ctx(contextual_disliked_item_ids=frozenset({"bX"})))
    dropped = [f for f in audit.filtered if f.drop_reason == "ranker_contextual_disliked"]
    assert dropped and all(f.score_breakdown is None for f in dropped)


# ============================ §C.3 — regen controls (engine) ============================


def test_disliked_item_never_appears_in_the_surfaced_set():
    wardrobe = [_item("t1", ItemType.top), _item("b1", ItemType.bottom),
                _item("b2", ItemType.bottom), _item("s1", ItemType.shoes)]
    request = _daily(wardrobe, disliked_item_ids=("s1",))
    env = _envelope(
        _outfit([("t1", Role.base_top), ("b1", Role.base_bottom)], ["t1"]),
        _outfit([("t1", Role.base_top), ("b2", Role.base_bottom), ("s1", Role.shoes)], ["s1"]),
    )
    result = render_with_trace(request, StubGenerator(env)).result
    for variant in result.variants:
        assert "s1" not in {item_id for item_id, _ in variant.items}


def test_locked_optional_item_omitted_is_dropped_post_validation():
    # An OPTIONAL lock (shoes) is the case the post-validate drop actually catches: a base-only
    # outfit passes M2 validation but omits the locked shoes → lock_unsatisfied drop (never silent).
    # (A required-slot lock instead prunes the pool so non-lock candidates fail validation first.)
    wardrobe = [_item("t1", ItemType.top), _item("b1", ItemType.bottom), _item("s1", ItemType.shoes)]
    request = _daily(wardrobe, locked_item_ids=("s1",))
    base_only = _envelope(_outfit([("t1", Role.base_top), ("b1", Role.base_bottom)], ["t1"]))
    trace = render_with_trace(request, StubGenerator(base_only))
    lock_drops = [d for d in trace.rescue_drops if d.drop_reason == "lock_unsatisfied"]
    assert lock_drops and all(d.drop_stage == "render" for d in lock_drops)
    assert trace.result.variants == ()  # the only candidate omits the locked shoes → nothing surfaces

    # positive: a candidate that includes the locked shoes surfaces and carries it.
    with_lock = _envelope(
        _outfit([("t1", Role.base_top), ("b1", Role.base_bottom), ("s1", Role.shoes)], ["s1"])
    )
    ok = render_with_trace(request, StubGenerator(with_lock)).result
    assert ok.variants and all("s1" in {i for i, _ in v.items} for v in ok.variants)


class _NoCallGenerator:
    """A generator that fails loudly if invoked — proves a pre-GPT short-circuit spent nothing."""

    def generate(self, prompt):  # noqa: ARG002
        raise AssertionError("generator must not be called on a controls-unbuildable render")


def test_controls_unbuildable_short_circuits_pre_gpt_with_distinct_hint():
    # A dress base exists (buildable WITHOUT controls), but locking the top invalidates the one_piece
    # path and there is no bottom → the engine returns a valid not_enough render pre-GPT (zero generator
    # calls), with the controls discriminator hint — never a raise, never a spend, never contract_invalid.
    from fitted_core.rescue import _CONTROLS_UNBUILDABLE_HINT, _DAILY_NOT_ENOUGH_HINT

    wardrobe = [_item("t1", ItemType.top), _item("d1", ItemType.dress)]
    request = _daily(wardrobe, locked_item_ids=("t1",))
    trace = render_with_trace(request, _NoCallGenerator())  # AssertionError if generation runs
    assert trace.result.not_enough_items is True
    assert trace.result.reason_hint == _CONTROLS_UNBUILDABLE_HINT
    assert trace.result.reason_hint != _DAILY_NOT_ENOUGH_HINT  # distinct from understocked
    assert trace.attempts == ()  # no generation attempt was made
    assert trace.prompt_pool, "the lock-scoped engine-visible pool is still captured for the corpus"


def test_dislike_removing_every_base_short_circuits_pre_gpt():
    # No locks; the closet is buildable (t1+b1) but disliking the only bottom removes every base →
    # valid not_enough render pre-GPT, no spend (the §C.3 dislike-exhausts-base valid-empty case).
    from fitted_core.rescue import _CONTROLS_UNBUILDABLE_HINT

    wardrobe = [_item("t1", ItemType.top), _item("b1", ItemType.bottom)]
    request = _daily(wardrobe, disliked_item_ids=("b1",))
    trace = render_with_trace(request, _NoCallGenerator())
    assert trace.result.not_enough_items is True
    assert trace.result.reason_hint == _CONTROLS_UNBUILDABLE_HINT


def test_no_controls_render_never_short_circuits_on_buildability():
    # Byte-identity guard: a no-control render must NEVER hit the controls short-circuit (a buildable
    # closet renders normally). Uses the fake generator; the short-circuit would AssertionError-free
    # skip generation, so reaching generation proves it did not fire.
    wardrobe = [_item("t1", ItemType.top), _item("b1", ItemType.bottom)]
    request = _daily(wardrobe)  # no locks, no dislikes
    trace = render_with_trace(
        request, StubGenerator(_envelope(_outfit([("t1", Role.base_top), ("b1", Role.base_bottom)], ["t1"])))
    )
    assert trace.attempts, "a no-control buildable render must generate (short-circuit must not fire)"
    assert trace.result.not_enough_items is False


def test_controls_block_authored_from_the_request():
    # F6: the payload's controls mirror the request's normalized locked/disliked ids exactly.
    wardrobe = [_item("t1", ItemType.top), _item("b1", ItemType.bottom)]
    request = _daily(wardrobe, locked_item_ids=("t1",), disliked_item_ids=("z9",))
    payload, _ = _payload(
        request,
        _envelope(_outfit([("t1", Role.base_top), ("b1", Role.base_bottom)], ["t1"])),
    )
    assert payload.controls == {"locked_item_ids": ["t1"], "disliked_item_ids": ["z9"]}


def test_controls_empty_present_on_a_non_regen_render():
    wardrobe = [_item("t1", ItemType.top), _item("b1", ItemType.bottom)]
    payload, _ = _payload(
        _daily(wardrobe),
        _envelope(_outfit([("t1", Role.base_top), ("b1", Role.base_bottom)], ["t1"])),
    )
    assert payload.controls == {"locked_item_ids": [], "disliked_item_ids": []}  # empty, never absent
