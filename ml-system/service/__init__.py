"""The M5 stateless render service (m5-cutover.md §A, C3).

A thin HTTP boundary over ``fitted_core``: auth → bounds → validate → reducers →
render → snapshot payload. Pure function of its inputs — no DB credentials, no
persistence (Next owns Mongo + the write path); the service holds only the
OpenAI key and its own generator config.
"""
