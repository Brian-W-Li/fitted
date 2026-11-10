"""Health and overload must not wait behind synchronous provider work."""
import asyncio
import threading
from service.tests.helpers import AUTH, http_async, make_app, render_body

class BlockingGenerator:
    def __init__(self):
        self.entered = threading.Event()
        self.release = threading.Event()
        self.call_count = 0
    def generate(self, prompt):
        self.call_count += 1
        self.entered.set()
        if not self.release.wait(2):
            raise RuntimeError("test release timed out")
        return '{"outfits": []}'


def test_health_and_overload_respond_while_provider_is_parked():
    generator = BlockingGenerator()
    app, _ = make_app(generator=generator)
    async def scenario():
        task = asyncio.create_task(http_async(app, "POST", "/render", headers=AUTH, json_body=render_body()))
        try:
            assert await asyncio.to_thread(generator.entered.wait, 3)
            assert not task.done(), "render finished before the probe could run"
            status, body = await asyncio.wait_for(http_async(app, "GET", "/readyz"), .5)
            assert status == 200 and body["ready"]
            status, body = await asyncio.wait_for(http_async(app, "POST", "/render", headers=AUTH, json_body=render_body()), .5)
            assert status == 429 and body["error"]["code"] == "rate_limit"
            assert generator.call_count == 1
            # Busy must not bypass authentication.
            assert (await http_async(app, "POST", "/render", json_body=render_body()))[0] == 401
        finally:
            generator.release.set()
            await task
        assert (await http_async(app, "POST", "/render", headers=AUTH, json_body=render_body()))[0] == 200
    asyncio.run(scenario())


def test_cancelled_caller_keeps_slot_until_provider_finishes():
    generator = BlockingGenerator()
    app, _ = make_app(generator=generator)
    async def scenario():
        task = asyncio.create_task(http_async(app, "POST", "/render", headers=AUTH, json_body=render_body()))
        assert await asyncio.to_thread(generator.entered.wait, 3)
        try:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
            assert (await http_async(app, "GET", "/readyz"))[0] == 200
            assert (await http_async(app, "POST", "/render", headers=AUTH, json_body=render_body()))[0] == 429
            assert generator.call_count == 1
        finally:
            generator.release.set()
        # Wait for the parked worker to complete without issuing more paid work.
        # Access only the executor task already created by this scenario.
        workers = [t for t in asyncio.all_tasks() if t is not asyncio.current_task()]
        await asyncio.gather(*workers)
        await asyncio.sleep(0)  # task's done callback releases the admission slot
        assert (await http_async(app, "POST", "/render", headers=AUTH, json_body=render_body()))[0] == 200
    asyncio.run(scenario())


def test_failed_provider_releases_slot_and_records_dispatch():
    class FailingGenerator:
        calls = 0
        def generate(self, prompt):
            self.calls += 1
            raise RuntimeError("synthetic provider failure")
    generator = FailingGenerator()
    app, _ = make_app(generator=generator)
    async def scenario():
        for _ in range(2):
            status, body = await http_async(app, "POST", "/render", headers=AUTH, json_body=render_body())
            assert status == 200 and body["degenerate"]
            assert body["payload"]["generationAttempts"] == []
            assert body["payload"]["diagnostics"]["engineFailure"] is not None
            assert body["payload"]["diagnostics"]["parse"]["generatorCalls"] == 1
    asyncio.run(scenario())
    assert generator.calls == 2


def test_delayed_body_reader_rechecks_capacity_before_dispatch():
    """Both requests pass the first guard; only the first complete body may dispatch."""
    import json

    generator = BlockingGenerator()
    app, _ = make_app(generator=generator)

    async def scenario():
        body_started = asyncio.Event()
        body_release = asyncio.Event()

        async def delayed_receive():
            body_started.set()
            await body_release.wait()
            return {"type": "http.request", "body": json.dumps(render_body()).encode(), "more_body": False}

        delayed = asyncio.create_task(http_async(app, "POST", "/render", headers=AUTH, receive=delayed_receive))
        await asyncio.wait_for(body_started.wait(), .5)
        winning = asyncio.create_task(http_async(app, "POST", "/render", headers=AUTH, json_body=render_body()))
        try:
            assert await asyncio.to_thread(generator.entered.wait, 1)
            body_release.set()
            status, body = await asyncio.wait_for(delayed, .5)
            assert status == 429 and body["error"]["code"] == "rate_limit"
            assert generator.call_count == 1
            assert not winning.done(), "provider must remain parked during rejection"
        finally:
            body_release.set()
            generator.release.set()
            await asyncio.gather(delayed, winning)

    asyncio.run(scenario())
