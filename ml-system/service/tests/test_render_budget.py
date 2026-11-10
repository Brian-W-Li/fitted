"""Fake-clock regressions: no sleeps or real provider calls."""
from service.tests.helpers import AUTH, FakeClock, http, make_app, render_body

class TimedGenerator:
    def __init__(self, clock, elapsed):
        self.clock, self.elapsed = clock, elapsed
        self.call_count = 0
        self.timeouts = []
    def generate(self, prompt):
        self.call_count += 1
        self.clock.advance(self.elapsed)
        return '{ bad'
    def generate_with_timeout(self, prompt, timeout_seconds):
        self.timeouts.append(timeout_seconds)
        return self.generate(prompt)


def test_slow_first_attempt_preserved_without_unbudgeted_repair():
    clock = FakeClock()
    generator = TimedGenerator(clock, 29)
    app, _ = make_app(generator=generator, clock=clock)
    status, body = http(app, "POST", "/render", headers=AUTH, json_body=render_body())
    assert status == 200 and body["degenerate"]
    assert generator.call_count == 1
    assert len(body["payload"]["generationAttempts"]) == 1
    assert body["payload"]["generationAttempts"][0]["rawText"] == '{ bad'
    assert generator.timeouts == [30]


def test_fast_format_failure_gets_only_remaining_budget():
    clock = FakeClock()
    generator = TimedGenerator(clock, 10)
    app, _ = make_app(generator=generator, clock=clock)
    status, body = http(app, "POST", "/render", headers=AUTH, json_body=render_body())
    assert status == 200 and body["degenerate"]
    assert generator.call_count == 2
    assert generator.timeouts == [30, 22]
    assert [a["isRepair"] for a in body["payload"]["generationAttempts"]] == [False, True]
