# Track 2 "stable version" audit — handoff prompt

> Paste the block below into a fresh Claude Code session to run the deep audit-and-harden campaign
> before pushing to a new stable version. Authored 2026-07-17 (synthesis of a creative-angles
> brainstorm + a Fable ambition-lens seat). Brian pushes/deploys manually; the audit session never does.

---

```
You are running an audit-and-harden campaign on Fitted, a live outfit-recommender. Your mission:
drive this repo to a new STABLE, PUSH-SAFE state that (a) heavily vets a just-landed diff and
(b) audits the whole codebase from many angles, so the app works end-to-end for a real
non-technical friend AND faithfully advances the current step of the ambition. You COMMIT on main;
you NEVER push and NEVER deploy — Brian does that manually after you converge. THINK HARD and be
CREATIVE: invent your own audit angles; do not run a checklist.

═══════════════════════════════════════════════════════════════════════════
THE MOMENT (why this audit exists — internalize before touching anything)
═══════════════════════════════════════════════════════════════════════════
Fitted is LIVE with real money: https://fitted-three.vercel.app (Vercel) → a Fly render service
(fitted-render-service.fly.dev, pinned to exactly 1 machine) → an Atlas M0 database. It is about to
be handed to 3–5 friends to collect ML training data — photos + category-deep closets + honest
accept/reject feedback — for the M6/H26 "catalog→closet transfer" re-measure. This is Track 2:
data collection, not a launch.

The audit's job is to protect a DOUBLE-SIDED promise (a green build that keeps only one side has
FAILED this milestone):
  • The friend must FEEL rung-1 of the experience: their real clothes, believable outfits, a real
    "here's how to wear the piece you avoid" rescue framing, and ONE taught StyleMove — not a
    generic outfit app that happens to store snapshots (Spec §1–§3).
  • The friend's use must ACTUALLY FEED the re-measure: a photo-less item contributes ZERO to the
    image-embedding measure; negative sampling needs category depth; decidability needs ~30–60
    positively-labeled outfits across the cohort (runbook §8 Lane-F note).

TWO failure classes dominate everything; every finding should ladder to one, or to a concrete
correctness/security/data-loss defect:
  1. SILENTLY-USELESS DATA. The app runs fine, the friend is happy, and the accumulating corpus is
     scientifically worthless (photo-less items, no category depth, feedback not bound to what it
     judged, Brian's test cruft indistinguishable from real data). WORSE than a crash: invisible
     until M6 and irreversible (snapshots are append-only).
  2. THE FRIEND QUITS OR IS MISLED. A non-technical person hits a dead-end, a confusing degraded
     state, or — the ambition's cardinal sin — a manipulative/dishonest nudge, and abandons.
Rank findings by RECOVERABILITY: a bug that corrupts the accumulating corpus or the cross-runtime
wire/snapshot contract is UNRECOVERABLE and outranks any UI bug, because every friend outfit bakes
it in irreversibly.

═══════════════════════════════════════════════════════════════════════════
READING LIST (read first; VERIFY, do not trust any summary — including this prompt's)
═══════════════════════════════════════════════════════════════════════════
- CLAUDE.md — conventions, the build-and-audit loop, deletion license, out-of-scope, memory rules.
- docs/Fitted_Spec_v2.md — canonical spec. Focus: §1 (green-shirt promise), §2–3 (product loop +
  ANTI-CAPTURE), §5 (what the engine IS today vs staged), §11 (edge model), §15/15.1
  (GenerationSnapshot contract), §16 (feedback), §18 (W-track / ingestion), §23 (Open Holes).
  Spec wins over deployed behavior; if spec disagrees with THIS prompt, verify against code.
- docs/plans/wardrobe-ingestion-honesty-pass.md — THE just-landed diff and primary heavy target.
  Read D1–D5, its out-of-scope, cosmetic residuals, and the (Brian-approved-provisional) copy.
- docs/plans/m5-c8-half2-runbook.md §8 — the LIVE deployed state + friend-onboarding ask (single
  source of truth for what is deployed; note the deployed build is BEHIND main until Brian redeploys).
- docs/plans/track2-audit-campaign.md — the prior campaign (methods, residuals, registered chips).
  Do NOT re-run its lanes verbatim; extend past them.
- Source: fitted/app/**, fitted/lib/**, fitted/models/**, ml-system/fitted_core/**,
  ml-system/service/**, and tests under fitted/tests/** + ml-system/tests/** + service/tests/**.

═══════════════════════════════════════════════════════════════════════════
SCOPE
═══════════════════════════════════════════════════════════════════════════
IN SCOPE:
- HEAVY hunk-by-hunk vetting of the just-landed ingestion honesty pass. Compute its exact range
  yourself (git log; ~b1215625..HEAD, CONVERGED-per-its-doc but UNPUSHED). Also treat everything
  unaudited since the last pushed/certified state (af836070) as fresh surface — a "CONVERGED"
  banner is NOT a certification you inherit; re-audit it cold with fresh eyes.
- WHOLE-CODEBASE audit from many angles, prioritized by the two failure classes and the live-money,
  friend-facing, ML-data-collection reality.
OUT OF SCOPE (do not do; register as chips if warranted) — and CRITICALLY, do NOT fail the audit
for the absence of these; this is a data-collection MVP, not the north-star:
- The [NEXT]/[STAGED] ambition: the learned style graph, edge strengthening, "it remembered / it
  learned your taste," boards, routines, the full Lens surface, the graph reveal, translate /
  outfit_upgrade, explainability beyond the StyleMove. These are deferred BY DESIGN.
- The clothingType/category derivation seam, new category vocabulary, any clothingType-surfacing/
  correcting UI (§18 W-track + the H52 one-way door), hard photo-block, live depth-nudge/progress
  mechanics, any backend/route/model/wire-shape change to the ingestion path.
- CV ingestion (deliberately off), W-track richness, taxonomy migration, the M6 training itself.
- Public launch / growth / marketing / scaling; visual try-on; frontend redesign for taste;
  meetings/ and team/ artifacts.
- Rewriting the friend copy into a final voice — that is Brian's. The copy is Brian-approved-
  provisional ("for now"), so audit it AS the shipping copy: you MAY (and should) flag a string
  that is factually MISLEADING (an honesty defect), but you do not restyle for taste.
- Pushing or deploying. Ever.
THE GUARD ON THE LINE: out-of-scope must not become ambition-shrink. Test for any missing
capability — does its absence make the friend's DATA dishonest, the felt rung-1 promise FALSE, or
the copy a LIE? If yes it's in scope regardless of rung. If no, register it and move on. And the
converse trap: "stable" must NEVER be redefined down to "a generic outfit app that stores
snapshots" — if the deployed app IS that, the finding is load-bearing even though every test is
green, because the thing being declared stable is the PROMISE, not the process table.

═══════════════════════════════════════════════════════════════════════════
THE CREATIVE MANDATE (this is the point — do not run a checklist)
═══════════════════════════════════════════════════════════════════════════
THINK first, hard, and invent your own audit angles grounded in THIS app at THIS moment. The seed
angles below are a floor, not a ceiling. For each angle you run, WRITE DOWN the 10–15 SPECIFIC
doubts it will chase before spawning it (the "named-suspicious-areas" probe has out-performed every
vague sweep in this project). Seed angles:

  A. LITERAL-BYTE DATA PROVENANCE (crown jewel) — follow ONE uploaded photo AND one accept/reject
     tap end-to-end: browser downscale → wire → Mongo → the corpusReadback verifier → the shape
     M6/H26's image-embedding re-measure actually consumes. Find every point where collected data
     silently degrades to ZERO ML value. Is a client-downscaled ~1MB image even embeddable? Does a
     label stay bound to the candidate it judged?
  B. NEW FRIEND'S FIRST 20 MINUTES — simulate a real non-technical person start→finish (webview
     sign-in block, empty wardrobe, photo-hero, save, ~15 items, first recommendation, reaction).
     Score every friction/dead-end/confusing state; judge whether the honesty pass KEEPS its promise.
  C. CONFUSED-CHAOTIC-FRIEND INPUT — 12MB HEIC, screenshot, renamed-PDF `.jpg`, emoji in a color
     field, double-tap save, backgrounded tab mid-render, 200 items, denied camera, near-45s-timeout
     wifi, no-photo saves. Each must degrade LEGIBLY and never corrupt the corpus.
  D. HONESTY-OF-THE-HONESTY-PASS (recursive) — audit every user-facing copy string against what the
     code LITERALLY does. One already-caught claim was fixed (the photo copy no longer says the photo
     "powers the recommendations" — H33/mlRequestAdapter.ts: imageUrl never reaches the stylist
     prompt; the photo powers the EXPERIMENT); VERIFY that fix is complete and consistent everywhere,
     then hunt for OTHER gaps. Prime remaining suspects: does "won't count toward the experiment"
     match reality — is a photo-less item actually excluded from the M6 measure, or does it silently
     contribute zero while still generating snapshots (and is that distinction honest to the friend)?
     Does any string imply learning/memory/"your style graph" the current rung can't cash? A false
     claim in an honesty pass is the sharpest possible finding — Fable-seat it.
  E. SILENT-FAILURE / DEGRADED-STATE LEGIBILITY (Brian-not-in-the-room) — render timeout, 500,
     rate-limit, cold start, M0 connection cap, and the two experiment-enders: OpenAI $10 cap hit
     mid-collection, M0 storage filling. Does each fail loud-and-honest to the FRIEND, and does
     BRIAN find out, or does collection die silently?
  F. INTEGRATION SEAMS between the new diff and the rest — verify the "no wire-shape change" claim
     BYTE-FOR-BYTE (collapsed-behind-<details> fields still submit the exact shape route+Mongoose+
     Python adapter expect); swatchColor() parity form vs item-card; crop-guard × CV-off × edit-photo
     composition; the new jsdom jest project coexisting with the node project (no double-run, real
     floor). Cross-runtime drift Python↔TS↔Mongoose is a first-class defect.
  G. ANTI-CAPTURE / DARK-PATTERN (product ethics) — the ambition forbids manipulation. Is the photo
     strong-nudge over the guilt line? Any streak/completeness mechanic? A friction ASYMMETRY that
     makes "like" cheaper than "dislike" (silently poisoning labels toward positivity)? Any copy
     implying "learned your taste" when personalization is designed-not-demonstrated? Is like/dislike
     framed as "would you actually wear this?" (the label the re-measure trains on) or "rate the app"?
  H. MONEY & ABUSE ON A PUBLIC URL — can a stranger who finds the URL burn the render budget or fill
     the M0? Is the 1-machine Fly pin load-bearing AND fragile (Fly already auto-spawned a 2nd HA
     machine once — a redeploy could silently double the rate ceiling)? Any spend circuit-breaker
     beyond a watched dashboard?
  I. CORPUS SCIENTIFIC VALIDITY (distinct from provenance) — can M6 cleanly separate friend data
     from Brian's live test cruft (his 8 placeholder items + 3 test snapshots + 2 interactions still
     sit in the live DB)? Do re-rolls/rescues bias the positive/negative balance or double-count?
     Does the "accepted" proxy conflate "liked the card" with "would actually wear it"? Can Brian see
     PER-FRIEND corpus health (photo coverage, category depth, label balance, cadence) WITHOUT
     archaeology, so a starving cohort is caught in week 1 not at M6 entry?
  J. VERIFY-THE-GREEN — actually RUN the claimed floors (npm test [both jest projects], npm run
     build, tsc, pytest across ml-system/tests + service/tests) on THIS exact tree. Does the new
     jsdom project run and count? Are the floors real NOW or aspirational? Do not build on unverified
     "clean."
  K. DEPLOYED-VS-MAIN DRIFT — the live URL serves the pre-honesty-pass build until Brian redeploys.
     Is "push + redeploy BOTH halves before the first friend" unambiguous, and is every runbook §8
     deployed-state claim still literally true?
  L. TRUST FLOOR / PRIVACY — the deletion promise ("erases everything of yours, immediately and
     irreversibly") must be OBSERVED live, not asserted; the runbook's throwaway-account erasure
     loop is an OPEN pre-recruiting check — treat it as a GATE, and confirm the DELETE cascade + the
     in-flight-render self-erase race actually cover every owned collection. Plus small dignity
     failures that make a friend quit silently: mangled item names echoed back, an outfit repeating
     the same 3 items every render, absurd combinations delivered with confident copy.
  M. DEVICE REALITY — friends are on phones. The honesty pass is ALL client UI. Does the lightbox,
     the <details> toggle, touch targets, and a real 4000×3000 HEIC downscale work on mobile Safari,
     not just a dev laptop?

Invent beyond these. A good new angle names a SPECIFIC way THIS app fails its friend or its data.

═══════════════════════════════════════════════════════════════════════════
THE AMBITION & USER-ORIENTATION LENS (Fable seat — audit the promise, not just the process table)
═══════════════════════════════════════════════════════════════════════════
Run a FABLE-model seat (Agent model:"fable") that judges promise-fidelity, not correctness. It must
ask, at minimum, and push past these:
  Q1 SILENT SCIENCE STARVATION (the #1 Track 2 failure) — audit the YIELD path, not the write path:
     for each way a friend naturally uses the app (skips photos, adds 10 tops + 1 shoe, likes
     everything, visits twice and quits), trace what lands in the corpus and whether it COUNTS. Then:
     can Brian see per-friend corpus health so a starving cohort is caught early? (feeds angle I)
  Q2 GREEN-SHIRT FELT PAYOFF vs generic outfit app — is rescue_item findable and framed as rescue
     ("show me how to wear this piece I never wear"), or an engineering-labeled button? Do the paths
     read as three risk-graded options with a taught StyleMove, or three interchangeable cards? Does
     daily feel closet-grounded ("it used MY clothes, named right")? Mechanical checks prove the
     FIELDS exist; judge whether the EXPERIENCE delivers them.
  Q3 FIRST-RUN: HOOK OR CHORE — how many minutes of typing between sign-in and first believable
     outfit? Is there an honest early-value moment (a render after 5–8 items)? Do thin/empty states
     speak honestly (notEnoughItems, flag-off degraded, no-photo wardrobe) or look broken? Do NOT
     resolve by demanding gamified progress mechanics.
  Q4 ANTI-CAPTURE LINE HELD EVERYWHERE — (feeds angle G) the honesty pass drew it right (nudge not
     block, no progress guilt); verify it held elsewhere.
  Q5 OVER-PROMISE vs WRAPPER TRUTH — Spec §5 is honest that the engine today is a closet-grounded
     GPT stylist, not a learned graph. Audit every user-facing string for claims the current rung
     cannot cash ("it learns," "your style graph," "it remembers"). (feeds angle D)
  Q6 TRUST FLOOR — the live erasure test as a gate; dignity failures. (feeds angle L)
MERIT (audit whether the ambition is worth its cost at this rung, separately from fidelity; findings
must be sayable even if uncomfortable):
  M1 Can 3–5 friend closets actually POWER the decision this data exists to make? Do the honest
     arithmetic against Lane-F numbers (~8–15 usable outfits/friend, category-depth needs, dropout).
     If plausible yield can't reach decidability, say so NOW — a campaign that can't decide is a
     ritual, not science.
  M2 Is the green-shirt wedge still the right first felt moment given the engine is a GPT stylist
     today? If rescue feels interchangeable with "any LLM + a closet list," retention for the weeks-
     long collection window must lean on Brian's out-of-band relationship, not wow — name which is
     carrying the load so expectations are honest.
  M3 Does the data-collection incentive bend the product against its anti-capture soul (this is the
     first milestone where Brian profits from user behavior — labels)? Is the honesty-pass posture
     (nudge + honest label + out-of-band ask) recorded somewhere durable as the precedent for all
     future yield-vs-integrity calls?

═══════════════════════════════════════════════════════════════════════════
PROVEN METHODS (baked in — use them; push beyond them)
═══════════════════════════════════════════════════════════════════════════
- Fan out PARALLEL, FRESH-CONTEXT, REPORT-ONLY auditor subagents, one per angle, each handed its
  10–15 named doubts. Auditors find and cite; they do not edit.
- Include the FABLE seat above for ambition-merit + taste + product-ethics + the honesty-of-copy call.
- ABSENCE-SHAPED DEFECT hunting: audit what ISN'T written — the missing catch, bound, dry-run, the
  unhandled quantifier path, the failure with no user-visible surface. Enumerate every path,
  fault-inject every stage, check bounds in pairs.
- VERIFY EVERY FINDING AGAINST SOURCE before acting — read the cited file:line / section / string
  yourself. Never trust a subagent's finding as authoritative. A wrong finding acted on is worse
  than a missed one.
- Severity-grade. "LOAD-BEARING" = would mislead an implementer, mis-store/corrupt/poison data or
  the corpus, break a downstream seam, mislead or lose a friend, or ship broken. Phrasing nits never
  block — report-and-move-on or chip.
- MUTATION-VERIFY any new load-bearing test: mutate the code it guards, confirm it goes red, revert.
- A cross-runtime fact (enum/clamp/regex/wire-field-set spanning Python↔TS↔Mongoose) needs a single
  source OR a same-commit cross-runtime equality test — never a hand-copied mirror.

═══════════════════════════════════════════════════════════════════════════
EXECUTION MODEL & COMMIT DISCIPLINE
═══════════════════════════════════════════════════════════════════════════
- You are the coordinator. Auditors report; YOU verify against source, then land fixes SERIALLY: one
  focused commit per angle/theme on main; tsc(scoped) + eslint(touched) + jest + pytest + build
  green per landing. Commit messages end with the Co-Authored-By trailer per CLAUDE.md. Never push.
- Later rounds treat earlier rounds' fixes as auditable surface, not trusted — fixes regress
  (proven 3× in this project).
- CLOSE THE DOC LOOP in the same commit as the code: reconcile Fitted_Spec_v2.md / the active plan
  when a fix diverges (conflicts are bugs); flip any resolved §23 hole to IMPLEMENTED + code cite;
  no forward-looking "→ implement at Cn" pointer may outlive its fix.
- Keep a live tracker (extend docs/plans/track2-audit-campaign.md or a new dated plan under
  docs/plans/) with the lane roster, findings, severities, and what landed — legible + resumable.
- Register genuinely out-of-scope discoveries as chips; do not scope-creep.
- If usage/context runs critically low, follow CLAUDE.md's recovery backstop (safe stop +
  docs/sessions/RECOVERY.md) before the next risky edit.

═══════════════════════════════════════════════════════════════════════════
DEFINITION OF DONE — "STABLE, PUSH-SAFE"
═══════════════════════════════════════════════════════════════════════════
Done ONLY when ALL hold:
  1. CONVERGENCE, not punch-list-executed: a FRESH-context round on the FINAL post-fix tree returns
     ZERO load-bearing findings. The last word must come from un-anchored eyes on the finished state.
  2. GREEN VERIFIED, not claimed: npm test (both jest projects), npm run build, tsc, and pytest all
     pass on the committed tree; floors held or grew (never shrank), run-verified this session;
     working tree clean; all work committed on main.
  3. The two dominant failure classes are specifically cleared: (a) no path where a friend's photo or
     feedback silently fails to become ML-usable data or is indistinguishable from test cruft; (b) no
     friend-facing dead-end, misleading claim, or manipulative nudge on the changed surface, and every
     degraded/failure state is legible.
  4. The double-sided promise is affirmatively met: a friend can, in one session, feel the rung-1
     payoff (real clothes, believable outfits, real rescue framing, a taught StyleMove) AND produce
     data that genuinely feeds the re-measure. If the deployed app is "a generic outfit app that
     stores snapshots," that is a load-bearing finding even with all tests green.
  5. The honesty-pass diff vetted hunk-by-hunk; its "no wire-shape / no backend change" claims
     verified byte-for-byte; cross-runtime facts test-guarded; the photo-copy honesty question ruled on.
  6. Docs conflict-free: Fitted_Spec_v2.md, runbook §8 deployed-state claims, and the active plan all
     agree with the committed code; every closed §23 hole shows IMPLEMENTED + cite.
  7. A closing report that NAMES residuals and any unaudited surface — never "all clean." Honest
     remainder + registered chips + the EXACT set of commits Brian must push and the restated
     precondition (push + redeploy BOTH halves, and run the throwaway-account erasure test, BEFORE
     the first friend). Closure that omits residuals is not closure.

Begin by reading the reading list and computing the exact diff ranges. Then THINK HARD about your
angle set — write your named doubts down — before you spawn a single auditor.
```
