# Fitted v1.2 — Scope & Boundary Decisions

Settled scope/boundary calls for the v1.2 refactor that are **not** resolutions of a PDF
ambiguity (those live in `docs/plans/spec-resolutions.md`). Same precedence weight as a
resolution. R-numbers are **shared and stable across both docs** — `spec-resolutions.md`
keeps a one-line stub at each moved R's original position so a search for "R7"/"R8" still
lands a pointer here.

---

### R7 — Host, not frame: the shell persists; the recommendation vertical is replaced wholesale

**Question.** Integrate the v1.2 engine into the existing app, or rebuild greenfield around
`fitted_core` using the old code as inspiration?

**Decision.** Neither extreme — **the old app is a host, not a frame.** Full greenfield rejected
(weeks of commodity shell work in Brian's weakest suit, deletes the M6 A/B control arm, breaks
the working-app-at-every-step property). But nothing in the new engine bends to old behavior —
the recommendation **vertical is replaced outright**, not integrated-with.

- **Persists as host infrastructure:** Firebase auth (`sessionId = userId` requires it, §3.1),
  wardrobe upload/CV pipeline (the data faucet — but see the W-track note in `spec-resolutions.md`
  §4), profile + wardrobe UI, Mongo plumbing.
- **Replaced wholesale at M5/M6, written clean against the spec:** `recommend/route.ts`,
  `regenerate/route.ts`, the recommendation display UI (§17 contract). Old code is reference
  for mapping logic only, never a behavioral baseline.
- **Retired: the Gemini `PreferenceSummary` path** (`preferences/summarize` +
  `lib/runPersonalizationSummary.ts`). Three stacking reasons: (1) no slot in the §16 prompt
  contract — v1.2 personalization is additive from `OutfitInteraction`, and attribute-level
  taste learning is a §21 non-goal; (2) leaving an LLM-summarized taste profile in the
  treatment arm **contaminates M6 lift attribution**; (3) deletion-license test: nothing in
  the new path calls it. **Sequencing:** freeze the old vertical (incl. Gemini) as the M5
  fallback arm; delete the entire arm — and the `GEMINI_API_KEY` dependency — at M6.
- **The entire integration surface is four contact points:** auth token → userId;
  `WardrobeItemDocument → fitted_core.WardrobeItem` adapter; `wardrobeVersion` increment in
  wardrobe mutation routes; `OutfitInteraction` writes.
- **Open at M6 (deferred):** permanent kill switch — keep a minimal OpenAI-direct path forever,
  vs. accept "Fly down → friendly error" once the service has earned trust.

**Implements:** M5 (flag + frozen fallback arm), M6 (arm deletion).

### R8 — `sessionId = userId`, always; anonymous sessions dropped *(resolves §3.1 scope)*

The spec's anonymous-cookie session (§3.1, ~24h cookie) serves no real user: the recommendation
flow is auth-gated (the `recommend`, `wardrobe`, `preferences`, and `interactions` routes verify
a Firebase Bearer token), and an anonymous visitor has no wardrobe to recommend from.
**Decision:** drop anonymous support. `sessionId = userId` unconditionally — no cookie
machinery, no expiry logic. Simplifies the seed, the cache key, and the M5 adapter. If a
try-before-signup flow ever materializes, it re-enters as a new resolution with its own session
design.

**Correction (do not restate "every route requires a token").** The recommendation vertical is
token-verified, but the app is **not** uniformly authenticated: `auth/sync`, `account`,
`images/[imageId]`, and `cv/infer` trust body-supplied identity or are unauthenticated. R8's
scope rests only on the *recommendation* routes being auth-gated — which holds. The
unauthenticated retained-host routes are a separate **trust-boundary integration gate**, see
`spec-resolutions.md` §4 ("Retained-host trust boundaries").

**Implements:** M5 (adapter supplies userId as sessionId). M0-5's seed API is unaffected
(takes sessionId as an opaque string).
