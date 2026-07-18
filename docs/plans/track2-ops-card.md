# Track 2 ops card — the single living doc for the friend data-collection window

> **This is the standing Track-2 operations doc.** While friends are using the live app, this is the
> one place to look: how to watch the collection, how to pull the corpus, where the known residuals
> live, and the friend-#0 self-test. Retire it only when the collection window closes (Fly app
> destroyed, corpus exported). Everything else Track-2 (audit trackers, the honesty pass) is history —
> see the `> COMPLETED` docs. Deployed state of record: `m5-c8-half2-runbook.md` §8.

## The live system (one line)
`https://fitted-three.vercel.app` (Vercel) → Fly render service `fitted-render-service.fly.dev` (pinned
to **exactly 1 machine**) → Atlas **M0** `fitted`. Engine = closet-grounded `gpt-5.4-mini` stylist +
the green-shirt "rescue". Spend backstop: OpenAI **$10/mo hard cap**. `USE_ML_SHORTLISTER=true`.

---

## OBSERVATION CHANNEL — run this every day or two while friends collect
Without a signal, friend #2 hits a wall on day 1 and you learn on day 9. Minimum viable watch = two
commands. **The closure is only honest because this channel exists** — unknown defects surface here
within ~1–2 days, and friend #1's first week IS the final audit round.

```sh
# 1. Corpus health + per-friend yield (read-only; the decidability verdict vs the 30–60 bar):
cd fitted && CORPUS_READBACK_URI="$(grep '^MONGODB_URI_ATLAS=' .env.local | cut -d= -f2-)" \
  npx jest corpusReadback --runInBand

# 2. Error/spend skim (did anything 5xx, did the machine stay at 1, is spend sane):
fly logs --app fitted-render-service | tail -50      # engine_failure / 5xx / OOM
fly scale show --app fitted-render-service           # MUST say 1 machine (see OPS-3)
#   + glance the OpenAI usage dashboard ($10 cap) and Vercel → project → Logs.
```
What "healthy" looks like: `/readyz` green, 1 Fly machine, no repeated `engine_failure`, yield climbing
toward 30–60 image-usable positive outfits across the cohort.

## PULL THE CORPUS — the M6 training export (read-only)
```sh
cd fitted && node scripts/export_track2.mjs \
  --uri "$(grep '^MONGODB_URI_ATLAS=' .env.local | cut -d= -f2-)" --out ./track2-export
# → manifest.json (counts + yield readout + decidability verdict), snapshots.jsonl, wardrobe.jsonl,
#   interactions_latest.jsonl (§H61 latest-state), training_examples.jsonl, images/<id>.<ext>.
```
The export's `manifest.json.yield` IS the yield artifact — "is the data good enough" and "what M6 trains
on" are one file, no drift. A **deleted friend exports zero** (erasure promise). Round-trip proven live:
`node scripts/track2-export-roundtrip.mjs` reconstructs one complete training example incl. a D2-retained
photo of a deleted item.

## CONTENT MONITOR — outfit-lint keeps auditing quality after friends arrive
```sh
cd fitted && npx jest outfitLint            # the unit-pinned rules
# Over live/export outfits: adapt scripts/track2-lint.mjs (currently reads the gauntlet output dir).
```
A rising `formality-clash` / `two-bottoms` / etc. rate = stylist-quality regression. Baseline this
session over 51 real candidates: **1 finding (2.0%)**, zero false positives.

## LIVE DRIVER (no browser) — reproduce any friend flow / spot-check
```sh
cd fitted && TRACK2_LIVE_OK=1 node scripts/track2-live.mjs smoke   # mint→sync→GET→erase, all green
```
Mints a throwaway `track2test_*` user via the local service-account and drives the live API as a friend
would. `scripts/track2-gauntlet.mjs run` seeds persona closets + real renders; `erase-all` cleans up;
`scripts/track2-erasure-check.mjs <slug>` proves erasure with an Atlas read-back. **Always erase test
users** (they write to the live corpus). Gated behind `TRACK2_LIVE_OK=1`; spends real OpenAI $.

---

## KNOWN RESIDUALS BACKLOG — the anti-spiral home for non-blocking findings
Every finding that does NOT fail a friend gauntlet scenario lives here, not blocking the ship. Graded
WALL (fix before a friend) / STUMBLE (fix by ROI) / COSMETIC (log only).

### STUMBLE — fix by ROI, none block friend #1
- **REQFIELDS-1 (yield tax, Fable-gated).** The client add form requires `name + category +
  subCategory(Type) + ≥1 color`; the engine/server accept items with neither subCategory nor colors
  (proven live: the text-sparse persona rendered fine). 2 extra required fields × 15 items = dropout
  risk. **Decision pending Fable** (yield vs corpus-worthiness) — relax toward `{name, category}` +
  encourage the rest, or keep. See the session tracker; do NOT change validation without the call.
- **CONTENT-1 (formality-clash, monitored).** Live gauntlet flagged `Gray Gym Hoodie + Charcoal Suit
  Trousers + White Running Shoes` (1/51 = 2%). A friend disliking a mediocre-but-sane outfit IS the
  data working; outfit-lint now tracks the rate. Not a WALL.
- **OPS-1 (operator-blind, external).** No proactive failure alerting — a $10-cap hit / M0-full / Fly
  outage silently stops collection. Mitigation = the observation channel above (manual, every 1–2 days).
  A `/readyz` uptime ping + an OpenAI usage alarm would upgrade this; external setup, Brian's.

### COSMETIC — log only (forbidden to fix mid-session; sweep later)
- **COMMENT-1.** Stale implementer comment `fitted/app/(app)/wardrobe/page.tsx:1291`
  (`// the item's photo is cascade-deleted too`) predates the D2 keep-referenced-photo change — no
  longer universally true. Not user-facing. One-line fix next time that file is open.
- **SEAM-1 / SEAM-2** (from the stable audit): client entry caps hand-copied not imported (drift setup,
  values agree); edit sends `size:""`/`notes:""` (no live UI, fresh corpus has none). Fix when next touched.

### Carried ops facts (verify each after every deploy)
- **OPS-3 — Fly can silently re-spawn a 2nd HA machine on deploy** → doubles the 12/min ceiling.
  `fly scale show` after every `fly deploy`; scale back to 1 if needed.
- **OPS-2 — the OpenAI $10 is a HARD cap** (confirmed), the one backstop everything leans on. Fine to
  lift toward ~$20 if a real cohort needs it.
- **STORAGE-1** — per-user 80MB image budget; M0 is 512MB. Safe for realistic closets (5 friends ×
  ~15–50 photos ≈ well under), not for scripted abuse. Watch M0 usage if a closet gets huge.
- **Deploys are CLI-driven, not on git push.** Web: `cd fitted && npx vercel --prod`. Service:
  `cd ml-system && fly deploy`. **Never vercel-deploy the repo root** (monorepo file-quota fail).

---

## BRIAN-AS-FRIEND-#0 — the 20-minute self-test (do this before recruiting)
If you can't get through this pleasantly on your phone with your own closet, no audit verdict matters.
If you can, your thumbs are the "ready" signal. **Screenshot each step** — that filmstrip is the visual
gauntlet (the pixel layer this session's API driver can't see: frozen button vs spinner, legible
dead-ends, HEIC upright, tap targets).

1. Open `https://fitted-three.vercel.app` on your **phone** (real browser, not an in-app webview) → sign in.
2. Empty wardrobe: is the first action obvious? Add ~10 real items. **Use "Save & add another"** — does
   the 15-item flow feel smooth now, or still heavy? (This is the B1 change; you're the first real test.)
3. Include one **HEIC**, one **huge (12MP)**, one **sideways** phone photo — does each store UPRIGHT and
   usable, or sideways/rejected? (The one a11y-adjacent trap on the critical path.)
4. Stop at ~3 items once and try to generate — is the "add N more" dead-end legible?
5. Generate a daily outfit (pick an occasion) at ~8 items — believable? Is there a spinner while it
   thinks (~6s warm), or a frozen button? Try a **cold** one (first of the day) — 20–40s wall; what do you see?
6. Like one, dislike one — each acknowledged? Feedback feel heard?
7. Find **rescue** (build around one item) — how many taps to get there? Does anything invite you? Does
   the outfit visibly center your item with a sane reason?
8. Edit an item, change its photo, remove it.
9. **Delete your account** (account page) — then confirm on the app your stuff is gone. (The erasure
   promise is proven server-side — 22 rows → 0 — but see it yourself once.)

Flag anything that made you pause >1 second with no feedback. Drop the screenshots in a folder and a
Claude session can grade the filmstrip.

## FRIEND ONBOARDING MESSAGE — draft (yours to finalize in your voice)
The recruiting message is the first UI + the honest-consent artifact. Draft below; tighten to your voice
before sending. Keep the four beats: what it is / what it isn't yet / the ~20-min ask / privacy.

> Hey — I built an outfit recommender and I'm collecting a little data from a few friends to train the
> next version. Would you spend ~20 min adding your closet and rating some outfits?
>
> What it does: you add photos of your clothes, it builds outfit suggestions from *your* actual wardrobe
> (including a "build around this piece" mode for that one thing nothing seems to match). It's early — the
> suggestions are decent, not magic yet, and that's exactly why your honest ratings help.
>
> **The most useful thing you can do: add real photos** (they're what the ML actually measures) and **rate
> honestly — a dislike helps more than a polite like.** Aim for ~15 items with a couple of each type.
>
> Open `https://fitted-three.vercel.app` on your phone (use Safari/Chrome, not the Instagram/Messenger
> in-app browser — Google sign-in blocks those). Sign in with Google.
>
> Privacy: your items, photos, and ratings live in my database for this small experiment among ~5 friends.
> Delete your account anytime (account page) and everything of yours is erased immediately and permanently.

Risk to flag: the message sets the photo + honest-dislike expectation out-of-band — that's load-bearing
(the app nudges but doesn't coerce, by design). If friends skip photos, yield stays unpowered no matter
how many snapshots they make.
