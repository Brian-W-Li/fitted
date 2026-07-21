"""Serialization pin — renders currently execute ON the single ASGI event loop.

``async def app`` calls ``service.handle_render(raw)`` synchronously (service/app.py), and the
generator inside is the blocking sync OpenAI SDK call (fitted_core/generation.py) — so while one
render is in flight the event loop is held and every other request, **including /readyz**, waits
behind it. Under the 1-machine Fly pin that makes effective render concurrency exactly 1: a
burst of simultaneous first renders queues serially and the tail can cross the Next-side 45s
abort (the friend-evening failure mode — runbook §8 pre-recruit checklist: stagger onboarding).

This test PINS the current serial behavior; it is a documented liability, not an endorsement.
The fix (dispatching ``handle_render`` off the loop — an executor/worker design call registered
in runbook §8 / Spec §23) is EXPECTED to flip the ordering asserted here: when it lands, this
test goes red and must be rewritten to assert the opposite order (readyz completes while the
render is parked). That flip is the fix's proof.
"""

from __future__ import annotations

import asyncio
import threading

from service.tests.helpers import AUTH, http_async, make_app, render_body


class _BlockingGenerator:
    """A generator that parks inside ``generate`` until released FROM ANOTHER THREAD.

    The release can never come from the event loop itself — the whole point is that the loop
    is held while ``generate`` runs — so anything loop-side waiting on it would deadlock.
    """

    def __init__(self) -> None:
        self.entered = threading.Event()
        self.release = threading.Event()
        self.call_count = 0
        self.prompts: list = []

    def generate(self, prompt) -> str:
        self.call_count += 1
        self.prompts.append(prompt)
        self.entered.set()
        if not self.release.wait(timeout=15):
            raise RuntimeError("release never fired — releaser thread died?")
        # Content is irrelevant to the pin: schema-invalid JSON walks the normal
        # repair→degenerate path and still yields a 200 envelope.
        return "{}"


def test_in_flight_render_blocks_readyz_until_it_finishes() -> None:
    generator = _BlockingGenerator()
    app, _ = make_app(generator=generator)

    # Releaser thread: once the render is parked inside generate(), hold the loop briefly,
    # then release. (threading.Event.wait in generate() blocks the LOOP thread; only this
    # background thread can un-park it.)
    def _releaser() -> None:
        if generator.entered.wait(timeout=15):
            generator.release.set()

    releaser = threading.Thread(target=_releaser, daemon=True)
    releaser.start()

    order: list[str] = []

    async def scenario() -> tuple[int, int]:
        async def render() -> int:
            status, _ = await http_async(
                app, "POST", "/render", headers=AUTH, json_body=render_body()
            )
            order.append("render")
            return status

        async def readyz() -> int:
            # One explicit yield so this task starts strictly AFTER the render task has
            # taken its first scheduling slot (where it parks inside generate, holding the
            # loop). If renders ran off-loop, this near-instant probe would finish FIRST —
            # the ordering below is the discriminating assertion, not wall-clock timing.
            await asyncio.sleep(0)
            status, _ = await http_async(app, "GET", "/readyz")
            order.append("readyz")
            return status

        render_task = asyncio.ensure_future(render())
        readyz_task = asyncio.ensure_future(readyz())
        return await render_task, await readyz_task

    render_status, readyz_status = asyncio.run(scenario())
    releaser.join(timeout=15)

    assert render_status == 200  # degenerate-but-valid envelope; the request completed
    assert readyz_status == 200
    # THE PIN: the readyz probe — issued while the render held the loop — could only
    # complete after the render finished. Serial by construction, concurrency = 1.
    assert order == ["render", "readyz"]
    assert generator.call_count >= 1
