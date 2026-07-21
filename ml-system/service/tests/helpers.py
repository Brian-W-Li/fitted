"""Test drivers for the C3 service — a canned env, a request-body builder, and a tiny
in-memory ASGI driver (no httpx/uvicorn; the hermetic suite stays dependency-free)."""

from __future__ import annotations

import asyncio
import copy
import json
from typing import Any, Mapping, Optional, Sequence

from fitted_core.models import Role
from service.app import create_app
from tests.helpers import StubGenerator

ENV = {
    "OPENAI_API_KEY": "sk-test-not-a-real-key",
    "SERVICE_KEY_CURRENT": "current-service-key",
    "SERVICE_KEY_NEXT": "next-service-key",
}
AUTH = {"X-Fitted-Service-Key": ENV["SERVICE_KEY_CURRENT"]}


class FakeClock:
    def __init__(self, start: float = 1000.0) -> None:
        self.now = start

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


def make_app(
    responses: str | Sequence[str] = "{}",
    *,
    env: Optional[Mapping[str, str]] = None,
    clock: Optional[FakeClock] = None,
    generator: Optional[object] = None,
):
    """An app wired to a StubGenerator (or any injected generator). Returns (app, generator)."""
    stub = generator if generator is not None else StubGenerator(responses)
    app = create_app(
        dict(ENV if env is None else env),
        generator_factory=lambda config: stub,
        clock=clock if clock is not None else FakeClock(),
    )
    return app, stub


def http(
    app,
    method: str,
    path: str,
    *,
    headers: Optional[Mapping[str, str]] = None,
    body: bytes = b"",
    json_body: Optional[dict] = None,
    chunks: Optional[list[bytes]] = None,
    receive: Any = None,
) -> tuple[int, Any]:
    """Drive the ASGI callable with one request; returns (status, parsed JSON body)."""
    return asyncio.run(
        http_async(
            app,
            method,
            path,
            headers=headers,
            body=body,
            json_body=json_body,
            chunks=chunks,
            receive=receive,
        )
    )


async def http_async(
    app,
    method: str,
    path: str,
    *,
    headers: Optional[Mapping[str, str]] = None,
    body: bytes = b"",
    json_body: Optional[dict] = None,
    chunks: Optional[list[bytes]] = None,
    receive: Any = None,
) -> tuple[int, Any]:
    """The awaitable core of ``http`` — for tests that drive several requests on ONE loop
    (e.g. the serialization pin, which needs two requests in flight concurrently)."""
    if json_body is not None:
        body = json.dumps(json_body).encode("utf-8")
    if chunks is None:
        chunks = [body]
    request_messages = [
        {"type": "http.request", "body": chunk, "more_body": i < len(chunks) - 1}
        for i, chunk in enumerate(chunks)
    ]
    sent: list[dict] = []
    iterator = iter(request_messages)

    async def default_receive():
        return next(iterator)

    async def send(message):
        sent.append(message)

    scope = {
        "type": "http",
        "method": method,
        "path": path,
        "headers": [
            (key.lower().encode("latin-1"), value.encode("latin-1"))
            for key, value in (headers or {}).items()
        ],
    }
    await app(scope, receive if receive is not None else default_receive, send)
    status = sent[0]["status"]
    raw = b"".join(m.get("body", b"") for m in sent if m["type"] == "http.response.body")
    return status, (json.loads(raw) if raw else None)


# --- request-body builders ---------------------------------------------------


def wire_item(item_id: str, clothing_type: str, **overrides) -> dict:
    item = {
        "id": item_id,
        "name": f"{item_id} name",
        "clothingType": clothing_type,
        "warmth": 5,
        "styleTags": ["solid"],
        "colorTags": ["navy"],
        "occasionTags": ["casual"],
        "material": None,
        "formality": None,
        "imageUrl": f"https://img/{item_id}.png",
    }
    item.update(overrides)
    return item


def daily_wardrobe() -> list[dict]:
    return [
        wire_item("t1", "top"),
        wire_item("t2", "top"),
        wire_item("b1", "bottom"),
        wire_item("b2", "bottom"),
        wire_item("s1", "shoes"),
    ]


def render_body(**overrides) -> dict:
    body: dict = {
        "snapshotId": "65a1f0000000000000000001",
        "requestId": "41111111-1111-4111-8111-111111111111",
        "sessionId": "user-service",
        "intent": "daily",
        "generationIndex": 0,
        "parentSnapshotId": None,
        "controls": {"lockedItemIds": [], "dislikedItemIds": []},
        "lens": {
            "occasion": "weekend brunch",
            "weather": "mild",
            "weatherRaw": "72F sunny",
            "location": "Santa Barbara, CA",
            "forcedItemId": None,
            "seedDate": "2026-07-07",
            "constraints": {},
        },
        "wardrobe": daily_wardrobe(),
        "wardrobeVersion": 3,
        "interactionCountAtRequest": 0,
        "behavioralRows": {"recentSnapshots": [], "interactionRows": []},
        "generator": {
            "provider": "openai",
            "model": "gpt-5.4-mini",
            "temperature": 0.5,
            "maxCompletionTokens": 2200,
            # The full static API surface the §A wire expectation now exact-matches (§A.6/§G).
            "apiSurface": "chat_completions",
            "responseFormat": "json_schema_strict",
            "reasoningEffort": "none",
            "storeMode": "none",
            "promptCacheRetention": "in_memory",
            "timeoutSeconds": 30.0,
            "maxRetries": 0,
        },
    }
    body = copy.deepcopy(body)
    for key, value in overrides.items():
        if isinstance(value, dict) and isinstance(body.get(key), dict):
            body[key].update(value)
        else:
            body[key] = value
    return body


def rescue_body(**overrides) -> dict:
    body = render_body(intent="rescue_item", lens={"forcedItemId": "t1"})
    for key, value in overrides.items():
        if isinstance(value, dict) and isinstance(body.get(key), dict):
            body[key].update(value)
        else:
            body[key] = value
    return body


# A valid child (re-roll) parent ref — 24-hex ObjectId, mirrors test_render_contract's re-roll id.
CHILD_PARENT_ID = "65a1f0000000000000000002"


def regen_body(**overrides) -> dict:
    """A child/re-roll render (generationIndex=1 + a real parent). Controls are regenerate-
    lineage ONLY (§C.3 root-controls invariant), so any request carrying non-empty controls
    must be child-shaped. Compose with intent=/lens= overrides for a rescue re-roll."""
    return render_body(generationIndex=1, parentSnapshotId=CHILD_PARENT_ID, **overrides)


# --- §12 envelope builders (mirror tests/test_snapshot.py's shape) -----------


def outfit(items: list[tuple[str, Role]], changed: list[str], *, style_move: bool = True) -> dict:
    out: dict = {"items": [{"itemId": i, "role": r.value} for i, r in items]}
    if style_move:
        out["styleMove"] = {
            "moveType": "layer",
            "changedItemIds": list(changed),
            "oneSentence": "An idea.",
        }
    return out


def envelope(*outfits: dict) -> str:
    return json.dumps({"outfits": list(outfits)})


def daily_envelope() -> str:
    """Three valid daily outfits over daily_wardrobe()."""
    return envelope(
        outfit([("t1", Role.base_top), ("b1", Role.base_bottom)], ["t1"]),
        outfit([("t2", Role.base_top), ("b2", Role.base_bottom)], ["t2"]),
        outfit([("t1", Role.base_top), ("b2", Role.base_bottom), ("s1", Role.shoes)], ["s1"]),
    )
