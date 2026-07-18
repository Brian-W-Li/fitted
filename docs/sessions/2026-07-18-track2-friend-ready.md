# Track 2 "friend-ready" session — 2026-07-18

> **Retirement condition (born with it):** this doc retires with a `> COMPLETED` banner once (a) the
> friend gauntlet has been run against the live app and its walls fixed, (b) add-another + export
> round-trip are built + green, (c) the content gauntlet + outfit-lint show majority-plausible outfits,
> (d) the ops card exists and is the standing Track-2 living doc. After that, the **ops card**
> (`docs/plans/m5-c8-half2-runbook.md` §8) is the single living Track-2 doc; this tracker is history.
>
> Mission: `docs/plans/track2-friend-ready-prompt.md`. Coordinator: Opus session. Brian = friend #0
> (visual gauntlet on his own phone/computer, screenshots). This session drives the API/data/render
> side via an admin-minted throwaway test UID, builds, and commits on `main` — **never pushes, never
> deploys, never recruits.**

## The acceptance-test change (why this session is shaped differently)
The last two sessions each closed on "a fresh audit round returns zero load-bearing findings." That has
**no fixed point** — the audited surface (all code + copy + data semantics) is unbounded, so the next
session always finds more. Replaced with a **finite** bar: enumerate a friend gauntlet, drive it, fix
every WALL, ship the two known walls (add-another + export). Reality terminates; static audit does not.

Triage every finding with ONE question — does it fail a gauntlet scenario?
- **WALL** — fails a scenario / dead-ends / corrupts data / breaks the erasure promise → fix now.
- **STUMBLE** — confuses but the friend recovers → fix by ROI within a stated cap.
- **COSMETIC** — neither → one line on the ops card; forbidden to fix this session.

---

## 1. TRUST RE-GRADE (first deliverable) — the last two sessions' findings, re-triaged

Re-grading every finding from the **ingestion honesty pass** (2026-07-17) and the **stable audit**
(2026-07-17) against the WALL/STUMBLE/COSMETIC bar. Source: `wardrobe-ingestion-honesty-pass.md`,
`track2-stable-audit-2026-07-17.md`.

| # | Finding (session) | What it actually was | Grade | When closed |
|---|---|---|---|---|
| 1 | Photo optional/previewless/un-changeable (honesty pass, D1/C2) | A friend could add 15 **photoless** items → an image-embedding-decidability closet worth **ZERO** to M6. Silent-zero-yield. | **WALL** (corpus) | Closed honesty pass C2 (`b1215625`) |
| 2 | Item/clear delete cascaded a **snapshot-referenced photo** (stable audit, D2/REPLACE-1) | Deleting/replacing an item silently deleted a photo a training snapshot pointed at → a training example loses its image. Silent corpus corruption. | **WALL** (corpus) | Closed stable audit (`a4983e1a` + `3eb05cf7`) |
| 3 | Double-tap → duplicate wardrobe item (stable audit) | A sub-frame double-tap POSTed a dup item. Recoverable (delete dup) but silently pollutes the corpus. | STUMBLE (data pollution) | Closed (`2941e40c` latch) |
| 4 | Like one-tap, dislike a multi-step reason form (stable audit, D1) | Asymmetric cost → friends under-dislike → label imbalance rots the M6 negative signal. Friend *can* still dislike. | STUMBLE (data quality) | Closed (`f37da88b`) |
| 5 | 3 false/overclaiming live strings — "ML model learns", account age/gender (stable audit, HON) | App claimed capabilities it lacks. Erodes trust / mislabels the experiment; friend still uses it. | STUMBLE (honesty) | Closed (`99455ad5`) |
| 6 | Dead "Analyze photo" CTA + CV-off intro copy lied about CV (honesty pass, C3) | Coaching for a CV path that never runs; confusing, recoverable. | STUMBLE (honesty) | Closed (`cdbcf6c0`) |
| 7 | `pattern`/`fit` recommender-unused fields shown as prominent as load-bearing ones (honesty pass, D2) | Per-item tax × closet size; a friction/yield drag, not a dead-end. | STUMBLE (friction) | Closed (`cdbcf6c0`) |
| 8 | Form color swatch didn't paint CSS names; last-chip removal blocked (honesty pass, C5) | Cosmetic input polish. | COSMETIC | Closed (`a520bd11`) |
| 9 | No per-friend yield visibility (stable audit, DP) | An **ops instrument**, not a friend-facing defect. Brian can't see if a closet is decidable. | COSMETIC (ops tooling) | Closed (`a0e2cc43` readout) |
| 10 | **"Save & add another" absent** — 15 items = 15 modal cycles (both sessions, FRIEND-1/C4) | Compounding friction that can silently drop 20–40% of a closet → undecidable sample. Registered, **deferred twice**. | **STUMBLE→WALL-adjacent** (yield) | **STILL OPEN → B1 this session** |
| 11 | No proactive failure alerting (stable audit, OPS-1) | Operator-blind during a weeks-long collection. External/infra mitigation. | STUMBLE (ops) | Open → ops card (observation channel) |
| 12 | No M6 export path exists anywhere in repo | If friends deliver and data can't leave Atlas in training shape, Track 2 fails terminally. | **WALL** (M6 terminal) | **STILL OPEN → B2 this session** |

### The thesis (say it plainly)
**The genuine WALLS — the two silent corpus-corruption/zero-yield defects (#1 photoless items, #2
deleted-photo cascade) — were closed sessions ago.** Everything the two sessions found *after* those was
STUMBLE (honesty copy, label symmetry, friction) or COSMETIC (swatch, ops tooling). Translation: **the app
has been friend-USABLE for a while; what kept improving was the friend-WORTHINESS of the *data* it
collects.** That is not an endless-defect spiral — it is corpus-quality polish converging.

**Two items remain genuinely open, and they are the reason this session exists, not another audit round:**
- **B1 — "Save & add another"** (yield friction that can silently halve a sample). Deferred twice; building now.
- **B2 — the M6 export round-trip** (verified missing; a terminal failure if discovered after friends deliver). Building now.

Both are **build**, not audit. That is the whole point: converge by *doing*, not by searching for the next flaw.

---

## 2. THE FRIEND GAUNTLET (the finite acceptance test)

Two tracks. **Brian runs the visual track on his own phone (friend #0); this session runs the API/data
track via the admin-mint driver.** A scenario is only "passed" when observed, not asserted.

### Track V — visual (Brian, phone, screenshots → I analyze the filmstrip)
The pixel/interaction layer curl can't see. Brian screenshots each; drop into a folder; I read + grade.
1. Shared link → sign up on a phone. (In-app-browser/webview caveat noted; don't block on it.)
2. Empty wardrobe → is the first action obvious? Add ~10 items.
3. Hit insufficient-items at ~3 items — is the dead-end legible ("add N more")?
4. First render at ~5–8 items — believable outfit? (also feeds content gauntlet)
5. **Cold render** (Fly idle / `auto_stop`) — first request may be a 20–40s wall. What does the friend SEE?
6. Service-unreachable render — honest degraded state or broken screen?
7. Warm ~6s render — wait affordance (skeleton/progress) present, or a frozen button?
8. Like AND dislike (one tap each) — each acknowledged? feedback feels heard?
9. Find RESCUE (green-shirt) — count clicks-to-rescue; does anything INVITE the friend there? Orphan centered?
10. Edit an item; change its photo; remove it.
11. HEIC / 12MP / sideways-EXIF upload — stored upright + usable, or sideways/rejected?
12. Delete the account — wardrobe, photos, feedback, AND snapshots all gone (erasure, observed live).

### Track A — API/data (this session, admin-mint driver, live Vercel + Fly)
Everything data-shaped, provable without a browser:
- A. Add items via `/api/wardrobe` as a throwaway UID (incl. photoless-item honesty path).
- B. Insufficient-items render → the `notEnoughItems` render envelope (not a 400) at low count.
- C. Real daily render at 5–8 items → snapshot written w/ full provenance + believable candidate set.
- D. Cold vs warm render latency (measure both against Fly).
- E. Service-unreachable behavior (point client at a dead URL / observe degraded envelope).
- F. Rescue render → forced item in every shown outfit + non-hallucinated reason.
- G. Like + one-tap dislike → interactions bound {snapshotId, candidateId}, H61 collapse.
- H. Re-roll → lineage (parentSnapshotId, generationIndex) + actual variation.
- I. HEIC/12MP/sideways EXIF via `/api/wardrobe/[id]/image` → orientation + storage.
- J. **Erasure**: DELETE /api/account → Atlas has zero rows across all 5 owned collections for the UID.

Timestamp every phase; flag every >1s wait with no visible feedback (Track V).

---

## 3. Execution log

### Live driver (no browser, no Google OAuth) — `fitted/scripts/track2-live.mjs`
Reproduces the 2026-07-16 admin-minted-token driver as a reusable ops tool: mint a Firebase custom
token from the local service-account → exchange for a real ID token (REST + web API key) → drive the
live Vercel API as a throwaway `track2test_*` user. Gated behind `TRACK2_LIVE_OK=1`; every test user is
erased. Smoke-verified live: mint→sync→GET wardrobe→DELETE account all green.

### Content-quality gauntlet (Track A) — REAL renders, 6 personas, 51 candidates
Seeded 6 persona closets through the real live ingestion path (with swatch photos so items are
corpus-usable), ran real `gpt-5.4-mini` renders, captured outfits + the "why", posted feedback, erased.
- **Majority plausible:** overwhelmingly. Believable, wearable outfits; no two-bottoms / dress+separates.
- **Rescue LANDS:** `one-green-shirt` rescue centered the orphan tee in **every** outfit (orphan-in-all=true)
  with non-hallucinated neutral pairings (dark jeans / navy chinos / khaki + loafers).
- **All-black:** the "why" did NOT hallucinate color harmony/contrast — talked structure/layering/minimalism.
- **Text-sparse (CV-off, names only):** did not collapse into nonsense; sane slotting, generic-but-fine "why".
- **Re-roll varies:** different compositions across regenerations (not a frozen repeat).
- **outfit-lint over all 51 live candidates:** 1 finding (2.0%), zero false positives — the
  `formality-skewed` "weekend errands" candidate `Gray Gym Hoodie + Charcoal Suit Trousers + White
  Running Shoes` (rule `formality-clash`). **STUMBLE, registered** — a friend disliking it IS the data
  working; outfit-lint now monitors the rate going forward. Modal personas (college-male / rescue) clean.
- **Content bar MET:** majority plausible + zero lint absurdities in the modal personas + rescue lands
  with a non-hallucinated reason.

### outfit-lint — `fitted/lib/outfitLint.ts` (+ 12 jest tests, + `scripts/track2-lint.mjs`)
Deterministic mechanical-absurdity checker (two-bottoms / two-dresses / dress-with-separates / no-bottom
/ two-shoes / formality-clash / shorts-with-heavy-coat). Independent CI-shaped monitor over the stylist;
one source of truth (the runner transpiles the .ts, no mirrored rules). Runs over live snapshots / the M6
export so content keeps being audited after friends arrive.

### Erasure gate (Track A / gauntlet #12) — PASSED, observed live — `scripts/track2-erasure-check.mjs`
On `one-green-shirt`: **22 rows** (1 user + 8 wardrobeitems + 8 wardrobeimages + 3 generationsnapshots +
2 outfitinteractions) → **0 across every owned collection** after `DELETE /api/account`, AND the Firebase
auth binding erased. The runbook §8 throwaway-account erasure check is **DONE**. All 6 personas then
erased; Atlas confirmed 0 residual `track2test_*` users (the 2 users / 3 snapshots remaining are Brian's
own pre-existing placeholder residue, runbook §8 — his to wipe before the real closet).

### B1 — "Save & add another" (the deferred #1 yield wall) — BUILT
`fitted/app/(app)/wardrobe/page.tsx` + 3 jsdom regression tests. Saves + resets the form without
re-opening the modal. ADD-mode + photo-first footer only (Fable: the asymmetry IS the honest nudge —
gradient toward corpus-valuable photos via convenience, not coercion). Reuses the savingRef latch (the
sharp edge — add-another reopens the just-latched modal); rapid-double-tap saves once. 9/9 modal tests.

### REQFIELDS-1 — required set relaxed to {name, category} (Fable-decided) — BUILT
`lib/wardrobeValidation.ts` + microcopy. subCategory(Type) + colors were a CLIENT-ONLY tax (the engine
derives clothingType from category alone; the server accepts sparse items — proven live). Fable verdict
RELAX: required = {name, category} + photo nudge; Type + colors stay visible + encouraged, no guilt
mechanics. Tripwire: watch friend #1's like-rate; if sparse hurts, backfill via edit, don't re-tighten.

### B2 — the M6 export round-trip — BUILT (`scripts/export_track2.mjs`)
See §3 above / the ops card. Round-trip proven live incl. the D2-deleted-item-photo seam + the
export-sees-zero-for-a-deleted-user erasure seam. Yield readout folded into the manifest (one artifact).

### Scoped new-code regression lane — CLEAN
Fresh-context adversarial audit of the 3 surfaces (D2/REPLACE-1 keep-referenced-images + honesty×behavior
+ IDOR; one-tap dislike + H61 collapse; yield readout token): **no WALL/STUMBLE**. Erasure + IDOR + H61
verified intact end-to-end (the erasure claim independently confirmed by the live 22→0 test). One
COSMETIC: stale comment `wardrobe/page.tsx:1291` (predates D2) → ops card backlog.

---

## 4. DEFINITION OF DONE — "READY FOR FRIEND #1"
- [x] (1) Friend gauntlet **Track A (data)** passes on the live app; every WALL fixed. **Track V (visual)
      = Brian's phone filmstrip**, the last piece (see below) — friend-#0 script on the ops card.
- [x] (2) add-another + the export round-trip BUILT, tested (latch-interaction + one reconstructed
      training example), green.
- [x] (3) content gauntlet: majority-plausible + zero lint absurdities in the modal personas + rescue
      lands (1 formality-clash STUMBLE at 2% in an edge persona, monitored by outfit-lint).
- [x] (4) scoped new-code regression lane clean.
- [x] (5) green verified this session (see floors below); tree clean; committed on `main` (NOT pushed).
- [x] (6) closing acts: ops card + observation channel + onboarding draft + doc compaction +
      friend-#0 script (all on `m5-c8-half2-runbook.md` §8).

**READY FOR FRIEND #1** with these named open items (explicitly authorized to ship):
- **WALL:** none open. The two genuine walls (photoless items, deleted-photo cascade) closed sessions
  ago; the two remaining-open items (add-another, export) are BUILT this session.
- **STUMBLE (fix by ROI, none block friend #1):** REQFIELDS-1 shipped; CONTENT-1 formality-clash
  (monitored); OPS-1 operator-blind (mitigated by the observation channel).
- **COSMETIC (log only):** COMMENT-1 stale comment; SEAM-1/2. All on the ops card.
- **Observation channel + latency:** the ops-card daily/2-day command (yield readout + log skim);
  unknown defects surface within ~1–2 days. **Friend #1's first week IS the final audit round.**
- **The one piece requiring Brian (not code):** run the friend-#0 phone gauntlet (Track V, visual layer
  curl can't see) + finalize the onboarding copy, then recruit. Push is Brian's (this session never pushed).

### Green floors (run-verified this session)
- jest **689 passed** + 10 skipped (grew 675→689: +12 outfitLint, +3 add-another, +4 REQFIELDS net).
  10 skips = the 2 env-gated integration suites (corpusReadback ×8, localServiceSmoke ×2). No `it.skip`/`xit`.
- `tsc --noEmit` clean; `npm run build` ✓.
- pytest floor **≥1091** unaffected — zero changes to `ml-system/` or `service/` this session (verified green).
- h26 pytest floor **≥305** untouched (nothing touched `experiments/h26`).
- New live ops scripts are node `.mjs` (not in the jest floor); their behavior is proven by live runs
  recorded above + the export round-trip harness.

### Track V (visual) — BRIAN'S filmstrip, pending
The pixel/interaction layer (frozen button vs spinner, legible dead-ends, HEIC upright in the UI, tap
targets, cold-start wait). Brian runs the visual gauntlet on his own phone/computer (friend #0); drop
screenshots and I analyze them. See the Brian-as-friend-#0 script in the ops card.
