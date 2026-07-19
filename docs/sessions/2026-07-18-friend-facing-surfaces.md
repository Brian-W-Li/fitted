# Friend-facing surface map — 2026-07-18

Read-only trace of every friend-facing surface (4 parallel lanes: generation, add-to-wardrobe,
regenerate+feedback, display+shell), verified against source. Purpose: find honest-vs-misleading gaps
and dead-ends before recruiting. This is a punch-list, not fixes.

Overall: the app is **broadly honest** — no over-promising, trust boundaries intact, delete/erasure copy
accurate, most error copy non-blaming. The material weaknesses are **absent explanations** and a few
**misleading dead-ends**, not dishonest claims.

## Correction to the earlier hypothesis
I earlier guessed the *daily* path lacks a pre-GPT structural check and wastes a GPT call on a no-bottom
closet. **The trace refutes that.** Daily short-circuits pre-GPT via `sampler.candidate_requested == 0`
(`n_tops*n_bottoms + n_dresses == 0`, `sampler.py:305–332`), so a genuine "2 tops + 1 shoe, no bottom"
closet exits pre-GPT with an honest "add a top and bottom, or a dress" message and **spends no GPT** — in
daily *and* both rescue variants. The real defect is the *post-GPT* message on a **buildable-but-thin**
closet (F1 below), which is what actually gets shown once a closet can build ≥1 outfit but < 3 distinct.

---

## The per-slot insufficiency matrix (the original question)

| Closet shape | Intent | Pre-GPT short-circuit? | Flag | Friend sees | GPT spent | Verdict |
|---|---|---|---|---|---|---|
| no bottoms (tops≥1, no dress) | daily | YES | notEnoughItems | "add a top and bottom, or a dress, to get daily outfit ideas" (`rescue.py:1364`) | No | honest |
| no tops (bottoms≥1, no dress) | daily | YES | notEnoughItems | same | No | honest (slightly generic) |
| no bottoms, rescue a **top** | rescue | YES | notEnoughItems | "add a bottom to build an outfit around this top" (`rescue.py:301`) | No | honest+actionable |
| no tops, rescue a **bottom** | rescue | YES | notEnoughItems | "add a top to build an outfit around this bottom" (`:304`) | No | honest |
| no base, rescue **shoe/outer** | rescue | YES | notEnoughItems | "add a top and bottom, or a dress, to layer this onto" (`:309`) | No | honest |
| no shoes / no outerwear (has top+bottom) | either | No | — | outfits render (optional slots) | Yes | fine |
| rescue a **dress** | rescue | No (dress = complete base) | — | outfits (or F1 if thin) | Yes | fine |
| **buildable but THIN** (e.g. 1 top + 1 bottom → <3 distinct) | daily | No | insufficientAfterGeneration | "couldn't assemble enough distinct ways to wear this item right now — try regenerating" (`rescue.py:746`) | **Yes** | **MISLEADING (F1)** |
| over-constrained by locks/dislikes (regen) | either | YES | notEnoughItems | "your locks and dislikes rule out every outfit … loosen them" (`:1369`) | No | honest |

`N_SURFACED=3` (`config.py`) is the "distinct outfits" target; a closet that can't produce 3 distinct combos hits F1.

---

## Ranked punch-list (what's worth fixing before recruiting)

### Top tier — real friend-facing traps / corpus-quality

**F1 — Generation: "try regenerating" is misleading on a thin/capped closet** *(the one Brian hit)*
`_INSUFFICIENT_AFTER_GENERATION_HINT` (`rescue.py:746`) fires post-GPT when < 3 distinct outfits survive.
Two problems: (a) it says "ways to wear **this item**" even in **daily**, which has no forced item; (b)
"**try regenerating**" is false advice when the shortfall is **combinatorial** (thin closet) — a retry burns
another GPT call for the same capped result. Only honest for a **stochastic** GPT failure (parse-fail/
refusal). Fix: daily-specific copy + gate "try regenerating" on a stochastic-failure signal vs. a structural
pool cap (the trace already distinguishes them).

**F2 — Add-wardrobe: Category defaults to "Top", its "*" is illusory → silent corpus mis-slotting**
The Category `<select>` always has a value (`top`), so the "required" gate never fires
(`wardrobe/page.tsx:320,858–868`; `wardrobeValidation.ts:44–62`). A friend who forgets to change it saves a
shoe/jacket as `top`. `deriveClothingType` keyword-rescue catches some, but a plainly-named item mis-slots
silently, and clothingType is invisible/uncorrectable in the UI. **Corrupts the M6 corpus.** Fix: a "Select…"
placeholder that forces a real choice.

**F3 — Display: no in-UI explanation of Reliable/Bridge/Stretch or safe/noticeable/bold** *(Brian's confusion)*
The two most prominent badges on every card (`dashboard/page.tsx:478–522`) have **zero** tooltip/legend/"?".
The risk badge even renders the **raw enum** ("noticeable"), not a friendly phrase. The rescue ring *does*
have a hover title (`:565`) — the pattern exists, just not applied here. Fix: tooltips/legend + friendly
phrasing for risk.

**F4 — Display: cold-start (~20–40s) shows no feedback beyond a disabled "Generating…" button**
(`dashboard/page.tsx:814–819,1043–1050`). Results cleared to null; no spinner/progress/"first request can
take ~30s" copy. A friend may think it froze and leave. Inconsistent: the **regenerate** modal *does* have a
spinner. Fix: spinner + first-request-latency hint on the main Generate flow.

### Mid tier

**F5 — Feedback: no way to undo/correct a like or dislike in the UI** (`dashboard/page.tsx:531,541–553`).
Once tapped, buttons vanish; only a badge remains. Server fully supports correction (append-only + H61
latest-state) — purely a missing affordance. A mis-tap sticks for the session.

**F6 — Add-wardrobe: transient CV-optimistic window** (`wardrobe/page.tsx:648,1545`). On modal open,
`cvUnavailable` starts false; for up to ~3s (until the `/api/cv/status` probe resolves) the friend sees
"Upload a photo and we'll suggest category, colors…" + an enabled "Analyze photo" button. CV is permanently
off in prod, so clicking it in that window fails. Fix: default `cvUnavailable=true` (optimistic-off).

**F7 — Add-wardrobe: "style-matching experiment" jargon leaks to friends** (nudge `:1123`, tooltip `:1190`,
guide `:709/:815`, header `:1524`). Honest but researcher-speak a recruited friend has no context for.
Soften to plain language ("a clear photo helps the most").

### Lower / minor

- **F8** — Auth: dev-toned errors leak to friends — `auth/unauthorized-domain` says "add this domain in
  Firebase Console" (`signin:15–17`); an uncoded Firebase error surfaces its raw `.message` (`:30`).
- **F9** — No `error.tsx`/`global-error.tsx`/`not-found.tsx` anywhere under `app/` — an uncaught render error
  or bad URL falls to Next's bare default (no branded recovery).
- **F10** — `notEnoughItems` empty state has no link to `/wardrobe` (`dashboard:205`), unlike the rescue nudge
  and history-empty which both link out.
- **F11** — HEIC gets a generic "Only JPEG, PNG, or WEBP" rejection (`wardrobe:395`), no convert hint.
- **F12** — Edit mode can't fully clear a stored photo, only replace it (`wardrobe:1103–1111`; likely D2-intended).
- **F13** — Regenerate button shows on already-liked/disliked cards and silently replaces the whole list
  (`dashboard:525–530`).
- **F14** — Raw engineer-toned lock errors leak on infeasible regenerate locks ("more than one lock occupies
  the top slot", `mlRecommend.ts:246`).
- **F15** — Pre-GPT daily "not enough" copy is generic ("add a top and bottom" even when the friend already
  has tops) — the rescue variants are precise, daily isn't (`rescue.py:1364`).
- **F16** — Partial render (1–2 of 3 outfits) silently drops the insufficient hint (`dashboard:1055` wins over
  `emptyStateMessage`); friend never sees "only 2 this time".
- **F17** — The 8 engineFailureVocab codes (refusal/truncated/empty_valid_set/…) collapse to 2 browser
  outcomes; the friend can't tell "model refused" from "ran out of tokens" (corpus keeps the detail —
  acceptable for a friend build).

---

## Verified-clean (no action)
Regenerate correctly presents as fresh generation (not re-rank) with a no-wipe safeguard; feedback taps get
instant acks with correct rollback and a server-side-derive trust boundary; delete-account copy is specific
and matches the erasure code; rate-limit/service/dropped-connection copy is honest; save flows, required-field
markers (Name*/Category*), and validation errors are accurate; the append-only + H61 latest-state machinery
is intact. Full per-lane tables are in the four tracer transcripts (this session).
