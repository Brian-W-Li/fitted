# Friend-facing surface backlog — 2026-07-18

Living residual list from a 4-lane read-only trace (generation, add-to-wardrobe, regenerate+feedback,
display+shell) of every friend-facing surface. The app is **broadly honest** (no over-promising, trust
boundaries intact, delete/erasure copy accurate); the weaknesses are absent explanations + a few
misleading dead-ends. **F1–F4 shipped (`c73ccf99`); F5–F17 below are the remaining polish before/around
recruiting.**

## Per-slot insufficiency (verified empirically against the render service)

| Closet | Pre-GPT short-circuit? | Friend sees | GPT spent |
|---|---|---|---|
| missing a base slot (no top / no bottom / no base for a shoe) | YES | intent-specific "add a top and bottom…" / "add a bottom to build around this top" | No |
| missing only shoes / outerwear (has top+bottom) | No | outfits (optional slots) | Yes |
| buildable but thin (< 3 distinct outfits) | No | the F1 honest hint ("add a few more pieces … or try again") | Yes |
| over-constrained by locks/dislikes (regen) | YES | "your locks and dislikes rule out every outfit … loosen them" | No |

A "2 tops + 1 shoe, no bottom" closet exits **pre-GPT, no spend**, with an honest message (empirically
confirmed) — the "try regenerating" message only ever appeared once a closet was buildable-but-thin.

## Remaining backlog (F5–F17)

**Mid**
- **F5** — No way to undo/correct a like or dislike in the UI (`dashboard/page.tsx:531,541`). Server
  supports it (append-only + H61 latest-state); a mis-tap sticks. The History copy even says "to change
  your mind, just react again" — but re-surfacing that exact outfit is near-impossible, so it over-promises.
  Fix: flip a reaction directly on the History page (it has the snapshot+candidate).
- **F6** — ~3s CV-optimistic window on the add modal (`wardrobe/page.tsx:648,1545`): before the
  `/api/cv/status` probe resolves the friend sees "we'll suggest category, colors…" + an enabled "Analyze
  photo" that fails (CV is off in prod). Fix: default `cvUnavailable=true` (optimistic-off).
- **F7** — "style-matching experiment" jargon leaks to friends (nudge `:1123`, tooltip `:1190`, guide, header).
  Honest but researcher-speak. Soften to plain language.

**Minor**
- **F8** — Dev-toned auth errors leak: `auth/unauthorized-domain` → "add this domain in Firebase Console"
  (`signin:15`); uncoded errors surface raw `.message` (`:30`).
- **F9** — No `error.tsx`/`global-error.tsx`/`not-found.tsx` under `app/` — uncaught error / bad URL falls to
  Next's bare default.
- **F10** — `notEnoughItems` empty state has no link to `/wardrobe` (`dashboard:205`).
- **F11** — HEIC gets a generic "JPEG/PNG/WEBP only" rejection (`wardrobe:395`), no convert hint.
- **F12** — Edit mode can't fully clear a stored photo, only replace it (`wardrobe:1103`; likely D2-intended).
- **F13** — Regenerate button shows on already-liked/disliked cards and silently replaces the whole list.
- **F14** — Raw engineer-toned lock errors leak on infeasible regenerate locks (`mlRecommend.ts:246`).
- **F15** — Pre-GPT daily "not enough" copy is generic ("add a top and bottom" even when the friend has tops).
- **F16** — Partial render (1–2 of 3) silently drops the insufficient hint (`dashboard:1055` wins).
- **F17** — The 8 engineFailureVocab codes collapse to 2 browser outcomes (corpus keeps detail — acceptable).

## Verified clean (no action)
Regenerate (fresh gen, not re-rank, no-wipe safeguard); feedback acks (instant, correct rollback,
server-side-derive trust boundary); delete/erasure copy; save flows + required markers + validation.
Full per-lane detail is in the four tracer transcripts (git history / this session).
