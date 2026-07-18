> COMPLETED 2026-07-18 — this prompt drove the friend-ready session (built add-another + M6 export +
> outfit-lint + REQFIELDS-1; erasure gate passed live). Session note:
> `docs/sessions/2026-07-18-track2-friend-ready.md`; the living ops home is runbook §8. History only.

# Track 2 "friend-ready" handoff prompt (next session)

> Paste the block below into a fresh Claude Code session. Authored 2026-07-18 as the successor to
> `track2-stable-audit-prompt.md` (which drove the 2026-07-17 stable audit — 9 commits, deployed +
> verified). This one deliberately CHANGES the acceptance test: the last two sessions each ended
> "ready for friends" and the next found more, because "a fresh audit returns zero findings" has no
> fixed point. The fix is to stop searching the infinite space of possible flaws and start passing a
> finite list of OBSERVED friend behaviors. Synthesis of a deep Fable brainstorm + the coordinator's
> knowledge of what the stable audit already covered. Brian pushes/deploys manually; the session
> commits on main and may drive the LIVE app read-mostly, but never recruits a friend.

---

```
You are running the pre-friend "friend-ready" session on Fitted, a LIVE outfit-recommender about to
be handed to 3–5 friends for ML data collection (Track 2). Your job is NOT another static audit that
ends by declaring "ready." It is to make the app one a non-technical friend can EASILY use and that
produces data good enough to answer the M6 question — and to prove it by DRIVING THE RUNNING APP and
PASSING A FINITE LIST OF FRIEND BEHAVIORS, not by finding zero flaws (that search never terminates).
You COMMIT on main; you NEVER push, NEVER deploy, NEVER recruit a friend. THINK HARD and BE CREATIVE:
invent your own scenarios and probes; the lists below are a floor, not a ceiling.

═══════════════════════════════════════════════════════════════════════════
WHY THIS SESSION IS SHAPED DIFFERENTLY (read first — it is the whole point)
═══════════════════════════════════════════════════════════════════════════
The previous two sessions used "a fresh-context audit round returns zero load-bearing findings" as
the definition of done. That criterion has NO fixed point: the audited surface is all code + all copy
+ all data semantics, fresh agents sample a different region of an unbounded defect space each round,
so "the next session found more" is guaranteed forever. That is a wrong acceptance test, not a
diligence failure. Static audit answers "can I find a flaw?" (always yes). Brian is actually asking
"will a friend hit a wall?" — which is finite, enumerable, and OBSERVABLE.

So the spine of this session is: enumerate a FRIEND GAUNTLET (~12 concrete scenarios) up front, DRIVE
them against the live deployment in a real browser, and define done as "the gauntlet passes + the two
known walls are shipped." Every finding gets ONE triage question — does it fail a gauntlet scenario?
  • WALL (fails a scenario / dead-ends / corrupts data / breaks the erasure promise) → fix now.
  • STUMBLE (confuses but the friend recovers) → fix by ROI within a stated cap.
  • COSMETIC (neither) → one line on the ops card; you are FORBIDDEN to fix it this session.
The finite gauntlet IS the bar. Reality is the only auditor that terminates.

OPEN BY RESTORING TRUST (first deliverable, ~20 min): re-grade the last two sessions' findings
(honesty copy, D1 label symmetry, D2/REPLACE-1 image retention, the yield readout, the double-tap
latch, etc. — see the trackers) into a WALL / STUMBLE / COSMETIC table. It will almost certainly show
the WALLS were fixed sessions ago and everything since was data-quality/honesty polish — i.e., the app
has been friend-USABLE for a while; what kept improving was friend-WORTHINESS of the data. Say that
plainly. It converts "we keep finding more, it's endless" into "the walls closed early; we've been
polishing the corpus." That table is the single most trust-restoring artifact you can produce.

═══════════════════════════════════════════════════════════════════════════
THE MOMENT (internalize before touching anything)
═══════════════════════════════════════════════════════════════════════════
Live with real money: https://fitted-three.vercel.app (Vercel) → a Fly render service
(fitted-render-service.fly.dev, pinned to exactly 1 machine) → an Atlas M0 db. As of 2026-07-17 the
full stable-audit stack is pushed + BOTH halves redeployed + verified (Fly 1 machine, /readyz green;
Vercel serving the audited copy). The engine today is a closet-grounded gpt-5.4-mini stylist + the
green-shirt "rescue" moment — that IS this step of the ambition (NOT the learned style graph, which is
later by design). Decidability is MARGINAL: ~30–60 usable positively-labeled outfits across the cohort
is the bar; plausible yield is ~8–15 per friend; aim for 4–5 committed, photo-uploading friends.

The endgame reframe you must adopt and state: the closure claim is NEVER again "ready for friends." It
is "ready for FRIEND #1," with friend #1's first real week explicitly designated the final audit
round, observed through a channel that exists (see the ops card below). Explicitly authorize shipping
with named open items — that written authorization is what gets Brian out of the backseat.

═══════════════════════════════════════════════════════════════════════════
READING LIST (verify against source; do not trust any summary, including this one)
═══════════════════════════════════════════════════════════════════════════
- CLAUDE.md — conventions, build-and-audit loop, deletion license, out-of-scope, doc-lifecycle.
- docs/Fitted_Spec_v2.md — §1 (green-shirt promise), §2–3 (product loop + anti-capture), §5 (engine
  today vs staged), §15/§16 (snapshot + feedback), §18 (W-track/ingestion), §23 (open holes).
- docs/plans/track2-stable-audit-2026-07-17.md — what the last session did + its registered residuals
  (OPS-1 no alerting, FRIEND-1 add-another deferred, M6-loader notes, etc.). Do NOT re-run its lanes.
- docs/plans/m5-c8-half2-runbook.md §8 — deployed state + friend-onboarding + the yield-readout command.
- docs/plans/wardrobe-ingestion-honesty-pass.md — the ingestion surface + Brian-approved provisional copy.
- Source: fitted/app/**, fitted/lib/**, fitted/models/**, ml-system/fitted_core/**, ml-system/service/**.

═══════════════════════════════════════════════════════════════════════════
SESSION SHAPE (a session that is >50% static audit has FAILED its own design)
═══════════════════════════════════════════════════════════════════════════
~40% driving/observing the live app · ~25% building (add-another + export) · ~20% content-quality
gauntlet · ~15% scoped new-code regression + doc compaction. Orchestration: YOU are a high-reasoning
Opus coordinator (own the drive-throughs, the builds, verifying every finding against source, and the
convergence judgment). Fan out FRESH-CONTEXT report-only auditors only where a lane genuinely needs
un-anchored eyes. Use a FABLE seat (Agent model:"fable") for the judgment calls: content-quality
"would a real person wear this / does rescue LAND", the friend-onboarding message, and any
"is this right for the friend / the ambition" call. Fable judges promise-fidelity; it never lands
fixes. Workflows/ultracode optional — use only if they buy real coverage, not ceremony.

═══════════════════════════════════════════════════════════════════════════
THE FRIEND GAUNTLET (the acceptance test — drive these on the LIVE app, real browser)
═══════════════════════════════════════════════════════════════════════════
Drive an agent browser session (Playwright, iPhone viewport) against the live Vercel app with a
THROWAWAY Google account, plus a reusable fixture folder of ~15 REAL clothing photos (include one
HEIC, one 12MP monster, one sideways-EXIF shot). Screenshot every step — the deliverable is a
FILMSTRIP Brian can flip through (worth more to his trust than any report). Watch Fly + Vercel logs
live during the drive to catch 500s the UI swallows. The gauntlet (extend it):
  1. Shared link → sign up on a phone viewport. (Note the in-app-browser/webview caveat; don't block on it.)
  2. Empty wardrobe → is the first action obvious? Add ~10 items from the fixture folder.
  3. Deliberately hit the insufficient-items state at ~3 items — is the dead-end legible ("add N more")?
  4. First render at ~5–8 items — does it produce a BELIEVABLE outfit? (feeds the content gauntlet)
  5. A DELIBERATELY COLD render (let the Fly machine idle / check auto_stop in fly.toml) — first
     request of the day may be a 20–40s wall, not 6s. What does the friend SEE? (potential WALL)
  6. A service-UNREACHABLE render — honest degraded state, or a broken screen?
  7. The 6s warm render — is the wait affordance (skeleton/progress) present, or a frozen button?
  8. Like AND dislike (one tap each now) — is each acknowledged? Does feedback feel heard?
  9. Find RESCUE (the green-shirt moment) — count clicks-to-rescue; does anything INVITE the friend
     there? Does the rescue outfit visibly center the orphan item with a non-hallucinated reason?
  10. Edit an item; change its photo; remove it.
  11. HEIC / 12MP / sideways-EXIF upload — does the photo store upright and usable, or sideways/rejected?
  12. Delete the account — confirm wardrobe, photos, feedback, AND snapshots are all gone (the erasure
      promise, observed live, not asserted). This IS the throwaway-account erasure gate.
Timestamp every phase; flag every >1s wait with no visible feedback.

═══════════════════════════════════════════════════════════════════════════
THE BUILD WORK (this is where auditing yields to shipping — converge by DOING)
═══════════════════════════════════════════════════════════════════════════
B1. BUILD "Save & add another" (the deferred #1 yield wall). 15 items = 15 modal open/close cycles
    today; a friend who quits at item 6 produces an UNDECIDABLE closet — this one seam can silently
    delete 20–40% of the sample, and deferring it again while calling yield the #1 risk is incoherent.
    The jsdom+RTL harness exists (1–2 hr build). SHARP EDGE: it reopens the exact modal that just got
    the re-entrancy latch (double-tap dup fix) — carry behavioral regression tests for the latch
    interaction (rapid add-another taps, add-another mid-save). Right-sized only: NOT batch/queue
    photo upload (that's the dream, out of scope). Cheap companion: confirm the CV-off required-field
    set is truly minimal (every optional-shown-as-required field is a per-item tax × closet size).

B2. BUILD the M6 EXPORT round-trip (verified missing — no export script exists anywhere in the repo).
    If friends deliver and the data can't leave Atlas in a training shape, Track 2 succeeds
    operationally and fails terminally — discovered too late to fix. Write a READ-ONLY `export_track2`
    (Mongo URI in → versioned JSONL bundle + images dir out: WardrobeItems + GenerationSnapshots +
    OutfitInteractions + image blobs, joined). Prove it by ROUND-TRIP: export → reload → reconstruct
    ONE complete training example (outfit composition + per-H61-latest-state feedback + resolvable
    item images). Special seams THIS project just created: a D2-retained photo whose wardrobe item was
    deleted — does the join still resolve? What does export see after an account delete (must match the
    friend promise)? Then RE-POINT the corpus-yield readout at the export output so "is the data good
    enough" and "what M6 trains on" are one artifact — no drift.

═══════════════════════════════════════════════════════════════════════════
THE CONTENT-QUALITY GAUNTLET (the biggest UNCOVERED risk — outfits, not code)
═══════════════════════════════════════════════════════════════════════════
Every prior session measured parse/inclusion/schema validity — whether outfits are well-FORMED. Nobody
judged whether they're GOOD. If a modal friend closet yields mockable outfits (gym hoodie + suit pants,
an absurd "rescue"), the friend quits AND the labels rot (a dislike stops meaning "not my style" and
starts meaning "the system is broken" — poisoning the exact M6 signal). This is corpus validity in a
UX costume. Right-size the method — a CONTACT SHEET, an OUTFIT-LINT, and EYEBALLS, not an AUC harness:
  • Seed 3–5 persona closets through the REAL ingestion path: minimal college-male; 35-item
    fast-fashion with orphan statement pieces; all-black (does "why" hallucinate color harmony?);
    one-green-shirt-nothing-matches (the rescue stress case); a formality-skewed closet. Include at
    least one TEXT-SPARSE persona (CV-off, minimal manual fields) — that's what real friend data looks
    like, and sparse attributes may collapse the stylist into generic filler.
  • Real renders on the live service (a few $ of gpt-5.4-mini) → an HTML CONTACT SHEET (item images +
    names + outfit text + the "why") Brian flips through in ~5 min/persona. Judge: would-wear rate;
    mechanical absurdities; repetition across regenerations (does regenerate actually vary?); does
    rescue CENTER the orphan with a plausible reason; does the "why" claim facts NOT in the data (a
    NEW content-layer honesty surface nobody has audited).
  • SHIP an "outfit-lint": a small deterministic checker over rendered candidates for mechanical
    absurdities (two bottoms, shorts+parka, formality spread beyond a bound, an item not in the closet).
    CI-shaped artifact per CLAUDE.md — it keeps auditing content AFTER friends arrive, on every snapshot.
  • DO NOT let gpt-5.4-mini grade its own outfits (self-affinity). Fresh Claude agents + Brian's eyes.
  • Honest blocking bar: majority plausible + zero lint absurdities in the modal personas + rescue
    visibly features the orphan with a non-hallucinated reason. NOT "every outfit stylish" — friends
    disliking mediocre-but-sane outfits IS the data working.

═══════════════════════════════════════════════════════════════════════════
SCOPED NEW-CODE REGRESSION (this session's own additions — one bounded lane, half a day)
═══════════════════════════════════════════════════════════════════════════
The last session's fixes are exactly the kind that regress (proven 3× in M4). Cold-audit ONLY:
  • D2/REPLACE-1 keep-referenced-images: this CHANGED deletion semantics AFTER the copy-honesty pass —
    does the delete/clear/replace copy still tell the truth about what deletion now does (a photo can
    survive while an outfit references it)? That honesty×behavior intersection is unaudited. Also: can
    user A's retained photo become reachable from user B via any snapshot/image-route path (IDOR)?
  • One-tap dislike + H61 collapse: dislike→like→dislike resolves to the intended latest state? Rapid-tap
    abuse (low risk, quick check)?
  • Yield readout: per-friend behavioral aggregate behind one admin token — token strength; any readout
    string leaking into logs/error bodies?
Bound it: these three surfaces, adversarial, one lane, done. Everything else new rides inside the
gauntlet/build surfaces.

═══════════════════════════════════════════════════════════════════════════
CLOSING ACTS (fold in — they are load-bearing for anti-spiral, not housekeeping)
═══════════════════════════════════════════════════════════════════════════
- OPS CARD (new, the ONE living Track-2 doc): how to run the yield readout, how to run the export, how
  to read Fly/Vercel logs when a friend reports a wall, and the KNOWN-RESIDUALS BACKLOG. This is WHERE
  non-blocking findings go instead of blocking convergence — the anti-spiral mechanism.
- OBSERVATION CHANNEL (during collection): once friends start, Brian isn't watching; without a signal,
  friend #2 hits a wall day 1 and Brian learns day 9 — re-opening the loop post-launch. Minimum viable:
  ONE command Brian runs every day or two (yield readout + an error-count skim of the logs), on the ops
  card. The closure is only honest if it can say "unknown defects surface through channel X within N days."
- FRIEND ONBOARDING MESSAGE (finalize the Brian-approved-provisional copy): the recruiting message is
  the first UI — what the app is, what it isn't yet, the ~20-min ask, "rate honestly — dislikes help
  most," and the privacy/deletion promise in one sentence. Doubles as the honest-consent artifact.
  Draft it for Brian's voice; flag it as his to finalize.
- DOC COMPACTION (closing act, with consolidation): retire with `> COMPLETED` banners
  track2-audit-campaign.md + both track2-stable-audit-* docs + wardrobe-ingestion-honesty-pass.md; trim
  the accreting CLAUDE.md "current focus" paragraph (history → commits). This session's own tracker is
  born with its retirement condition in its header.
- BRIAN-AS-FRIEND-#0 SCRIPT: end by handing Brian a 20-minute script = exactly what a friend will do.
  If he can't get through it pleasantly on his phone with his own closet, no audit verdict matters; if
  he can, his own thumbs are the "ready" signal. That literally puts him in the driver's seat.

═══════════════════════════════════════════════════════════════════════════
CUT / DE-EMPHASIZE from the stable-audit prompt (already covered — do NOT re-run)
═══════════════════════════════════════════════════════════════════════════
- Money & abuse, anti-capture/dark-pattern: invite-only, 5 known friends. Done.
- Cross-runtime + deployed-vs-main drift as full lanes: reduce to "surfaces this session touched" + a
  5-minute deployed-hash check.
- Chaotic-input fuzzing: keep ONLY the weird-real-data subset (HEIC, huge photos, emoji names) inside
  the drive-through fixtures; friends aren't adversaries.
- Static copy re-review: review ONLY copy that is new or invalidated by a behavior change (deletion).
- Generic device/a11y matrix: replace with "ask Brian which phones his friends actually carry" and test
  that (probably iOS Safari + one Android Chrome) + a contrast/tap-target glance during the drive. The
  ONE a11y-adjacent trap to KEEP is photo orientation/format (HEIC/EXIF) — it's on the critical path.

═══════════════════════════════════════════════════════════════════════════
DEFINITION OF DONE — "READY FOR FRIEND #1" (ban the phrase "all clean")
═══════════════════════════════════════════════════════════════════════════
Done when: (1) the friend gauntlet PASSES on the live app (filmstrip produced), with every WALL fixed;
(2) add-another + the export round-trip are BUILT, tested (latch-interaction + one reconstructed
training example), and green; (3) the content gauntlet shows majority-plausible outfits + zero lint
absurdities in the modal personas + rescue that lands; (4) the scoped new-code regression lane is
clean; (5) green verified (jest/pytest/tsc/build run this session, floors held or grew), tree clean,
committed on main; (6) the closing acts exist (ops card + observation channel + onboarding draft + doc
compaction + Brian-as-friend-#0 script). CLOSE with: "Ready for FRIEND #1," an enumerated residual list
with WALL/STUMBLE/COSMETIC severities, the named observation channel and its latency, and the explicit
statement that friend #1's first week IS the final audit round. Explicitly authorize shipping with the
named open items. Never write "all clean."

Begin by re-grading the last two sessions' findings (the trust table), then WRITE DOWN your friend
gauntlet, then start DRIVING — before you spawn a single static-audit lane.
```
