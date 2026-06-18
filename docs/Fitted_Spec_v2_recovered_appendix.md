# Appendix C - Preserved Brainstorm Material

> Recovery note: this appendix draft was prepared after the Claude Code crash to prevent brainstorm data loss before any implementation work. It is append-ready for `docs/Fitted_Spec_v2.md`, but the spec itself was not modified.
>
> Source files reviewed: `docs/CODEX_USER_STORIES.md` and `docs/CODEX_HANDOFF.md`.
>
> Selection rule: include user stories, critical edge-case notes, and important product documentation blocks that are absent from v2 or only compressed there. Body text is extracted verbatim; heading levels are demoted one level so the material nests under this appendix.
>
> Purpose: this file is the separate home for ambition, anecdotes, dream notes, and the personal/product reasons behind Fitted. Keep code-facing implementation decisions in `docs/Fitted_Spec_v2.md`; keep this appendix as the long-form memory of why the product should exist and where it could go.
>
> Provenance note: source filenames and line numbers below refer to the retired Codex brainstorm files as they existed when this appendix was created. They are retained for traceability, not as active reading-list dependencies.

## C.0 Ambition, candidate weapons, and why the product should not shrink

_Source: `docs/CODEX_HANDOFF.md` lines 40-399._
_Why preserved: This is the clearest ambition/anecdote block: the competition-correction, Blue Lock framing, candidate weapons, and Brian's warning not to reduce Fitted to a small utility._

#### Core purpose

Latest brainstorm conclusion:

> **The current strongest frame is lens-first style graph:** Fitted helps users turn a scattered
> closet into a personal style graph, where an active **board + routine + context** lens reveals
> wearable connections between clothes they already own.

This refines, rather than deletes, the earlier `Outfit Upgrade` / `StyleMove` framing:

- `Board` is the user-facing style direction.
- `StyleProfile` is the compiled/internal representation of a board or style direction.
- `Routine` is the recurring real-life context.
- `Lens` is `Board/StyleProfileSnapshot + Routine + current constraints`.
- `StyleMove` remains the visible explanation for why an outfit path works.
- `StyleEdge` is the graph relationship that remembers a useful item/outfit connection under a
  lens.

Practical implication:

> The first hook may be less "give me a bland outfit to upgrade" and more "show me how this board
> works for this routine with my closet." Outfit upgrade, hard-to-style rescue, and translate-this
> become interaction modes inside that lens-first graph.

Current best core purpose:

> **Fitted helps style-stuck wardrobe owners find the better outfit hiding in the clothes they
> already own.**

More explicit:

> Fitted is an outfit-fluency engine for people who own enough clothes and have some taste, but keep
> dressing from the same bland, safe subset because they lack fast, personal, closet-grounded styling
> guidance.

Final research push sharpened the product expression:

> **A 30-second fit upgrade loop:** start from a real outfit, hard-to-style item, or vibe; return
> safe / noticeable / bold owned-closet improvements; explain the one `StyleMove`; learn scoped
> feedback.

Business correction from Brian:

> Competitor overlap should not automatically make Fitted run away from an idea. Overlap can prove
> demand. The goal is not to find an untouched feature nobody cares about; the goal is to pick a
> painful job and do it more specifically, more deeply, or with a better product feel than broad
> competitors.

Meaning:

- Do not abandon mood boards, owned-closet recommendations, outfit planning, or wardrobe ingestion
  just because large apps touch them.
- Do avoid making any of those broad categories the whole differentiation story.
- Fitted can compete in crowded territory if it owns one sharper execution layer: fast,
  closet-grounded outfit improvement with scoped memory and low-friction ingestion.

Brian's Blue Lock / soccer framing:

> The goal-scoring space is rarely empty for long. Savvy opponents and teammates will move there
> too. The strategy is not to avoid the contested goal-smelling space; it is to arrive with a
> specific weapon.

Product translation:

- A crowded category can be the correct field to play on.
- Fitted needs a concrete "weapon", not a retreat into an irrelevant untouched niche.
- Candidate weapon: not merely owned-closet recommendations, but the fastest and most trustworthy
  `outfit -> one better styling move -> scoped learning` loop.
- If another product also recommends outfits, Fitted can still win by being more personal, more
  practical, less shopping-driven, more explainable, and better at helping the user improve their
  actual dressing behavior.

#### Reopen after competition-avoidance bias

Brian pushed back that Codex may have over-corrected during research: when a competitor had a
similar feature, Codex tended to retreat toward narrower/safer ideas. That is not necessarily good
business strategy. The current `30-second fit upgrade loop` is a **candidate weapon**, not a final
answer.

Claude/Brian should revisit earlier ideas without assuming they were correctly demoted:

- **Mood-board-to-closet translation**
  - Reopen. Competitors touching moodboards does not mean Fitted should avoid them.
  - Question: can Fitted make moodboards executable against owned clothes better than broad closet
    apps?

- **StyleProfile as product center**
  - Reopen. This may still be the deeper long-term differentiator.
  - Question: is `StyleProfile` the real weapon, with `Outfit Upgrade` as one interaction mode?

- **Style Bridge / progression**
  - Reopen. Helping users evolve from current closet to target style may be more ambitious and more
    emotionally compelling than one-off upgrades.
  - Question: can progression become the retention loop without overcomplicating v1?

- **Style Gap Map**
  - Reopen carefully. Competitors have wardrobe stats, but style-relative gap diagnosis may still be
    distinctive.
  - Question: can it stay useful without becoming fake-precision analytics or a shopping funnel?

- **Routine-attached style memory**
  - Reopen. This is very aligned with Brian's original vision.
  - Question: should routine/style memory be part of the first pivot's data model even if UI comes
    later?

- **No-buy owned-closet coach**
  - Reopen. Competitors also say "shop your closet," but trustworthiness here can be a real weapon.
  - Question: should Fitted explicitly lead with "improve before buying"?

- **Async CV / low-friction ingestion**
  - Keep. This is not the final user-facing wedge, but a poor ingestion experience kills every
    owned-closet idea.

Better strategy rubric:

- Do **not** reject an idea because competitors touch it.
- Reject or defer an idea only if it lacks a painful user job, cannot be executed better by Fitted,
  makes the core loop slower, or creates too much implementation risk for the next spec.
- Prefer contested spaces with proven demand where Fitted has a believable weapon.
- Treat the next Claude session as a real pivot discussion, not as implementation of Codex's latest
  favorite idea.

#### Defined candidate weapons after reopening

Codex's personal recommendation after the corrected research pass:

> Fitted's best weapon is **executable style memory**: the app turns a user's current style intent
> into one concrete owned-closet styling move, then remembers the result in the right context instead
> of flattening the user into one taste profile.

This combines the stronger ideas instead of choosing between them:

- `StyleProfile` gives the system declared taste and mood-board direction.
- `StyleMove` makes each recommendation useful, teachable, and visible.
- scoped feedback / style lanes keep personalization from trapping the user.
- owned-closet grounding and no-buy trust make the advice practical.

In soccer terms: the visible shot is the `StyleMove`; the weapon is the positioning and memory that
lets Fitted choose the right move for this user in this moment.

##### Weapon 1 — Executable StyleProfile + StyleMove

Thesis:

> Mood boards, prompts, routines, and feedback compile into a living `StyleProfile`; every
> recommendation returns not just an outfit, but the exact `StyleMove` that makes it work.

Why this is strongest:

- It brings back Brian's mood-board ambition without making mood boards passive scrapbooks.
- It competes in the proven owned-wardrobe space but with a sharper mechanism.
- It can support all entry points: upgrade outfit, rescue item, translate vibe, routine dressing.
- It creates a long-term memory moat without requiring massive cross-user data.
- It is technically aligned with v1.2's sampler/ranker/interaction-log direction.

First proof:

- one active text `StyleProfile`;
- one `RequestIntent`;
- three variants: `safe`, `noticeable`, `bold`;
- each variant has one `StyleMove`, matched traits, missing traits, and scoped feedback.

Hole:

- If `StyleProfile` stays a vague blob, this collapses into prompt decoration.
- Claude/Brian must define a small trait ontology before promoting it: colors, silhouette, formality,
  texture, layer role, boldness, comfort, fit looseness, style words.

##### Weapon 2 — Hard-to-Style Rescue

Thesis:

> Fitted specializes in the item the user likes but cannot wear.

Why it can win:

- This is a painfully specific human-stylist job.
- The Cut / Allison Bornstein source shows this pain clearly: people can identify problem pieces
  but do not know how to style them.
- It turns wardrobe upload into immediate value because ignored items become interactive hooks.

First proof:

- user selects one owned item;
- system forces inclusion unless impossible;
- returns easiest / balanced / interesting outfits;
- explains the item's role and what to pair against.

Hole:

- Too narrow to be the whole product.
- Best as a killer entry point under Weapon 1.

##### Weapon 3 — Mood-Board-to-Closet Translation

Thesis:

> Fitted translates a mood board or reference image into practical outfits from the user's real
> closet.

Why it can win:

- Competitors touch moodboards, but few make the board an executable profile with scoped feedback.
- Pinterest/visual culture proves that users think in images and vibes, not just item filters.
- Research on style-conditioned outfit recommendation supports the idea that style/theme can be a
  first-class condition.

First proof:

- text board or style words before visual board;
- output closest / practical / stretch variants;
- show which board traits were satisfied or missing.

Hole:

- Can become too aspirational and miss users who just want today's outfit improved.
- Should share the same `StyleProfile`/`StyleMove` substrate rather than becoming a separate product.

##### Weapon 4 — No-Buy Trust Contract

Thesis:

> Fitted earns trust by improving outfits from owned clothes before suggesting shopping.

Why it can win:

- Many apps slide toward shopping, affiliate, marketplace, or wishlist behavior.
- Real Simple's wardrobe-fatigue source explicitly says shopping can be part of the problem.
- A no-buy posture makes Fitted feel like an ally rather than a sales funnel.

First proof:

- `NoBuyMode=true`;
- no external products in recommendation output;
- gaps are descriptive, not purchase CTAs;
- metrics include accepted no-buy outfits and rescued owned items.

Hole:

- Long-term monetization gets harder if shopping is forbidden forever.
- Better framing: no-buy default, shopping later only when a real gap is proven and user asks.

##### Weapon 5 — Style Lanes / Routine-Scoped Memory

Thesis:

> The app understands different versions of the user: school, work, weekend, winter, summer,
> experimental board.

Why it can win:

- This directly matches Brian's original personalization concern.
- It solves algorithm capture better than generic likes/dislikes.
- It makes routines and seasonal style feel remembered rather than reset.

First proof:

- no full inferred-routine ML yet;
- just log `style_profile_id`, request context, season/date, and feedback reason;
- later expose lanes when enough history exists.

Hole:

- Too invisible as first pitch.
- It is a moat/support system, not the first button users tap.

##### Weapon 6 — Style Bridge / Progression

Thesis:

> Fitted helps users move from current closet habits toward a target style over time.

Why it can win:

- This is emotionally stronger than one-shot outfit generation.
- It creates retention: users return to make progress, not just ask for today's outfit.
- It can unify mood boards, no-buy, gap map, and personal rules.

First proof:

- a 7-day no-buy upgrade challenge;
- each day uses one owned item and one `StyleMove`;
- summary shows learned rules and rescued items.

Hole:

- Easy to overbuild.
- Should be a later product wrapper around proven `StyleMove` interactions.

##### Weapon ranking

Recommended ranking for the next pivot discussion:

1. **Executable StyleProfile + StyleMove** — best overall weapon.
2. **Hard-to-Style Rescue** — sharpest single user story.
3. **Mood-Board-to-Closet Translation** — most ambitious/identity-rich input mode.
4. **No-Buy Trust Contract** — strongest trust/business-positioning guardrail.
5. **Style Lanes / Routine-Scoped Memory** — strongest long-term personalization moat.
6. **Style Bridge / Progression** — strongest retention wrapper, but later.

Codex personal answer:

> The best Fitted weapon is not "AI outfit recommendations." It is **style intent made executable**:
> Fitted understands the user's current style direction and context, makes one better owned-closet
> move, and remembers whether that move fit this version of the user.

This keeps ambition high without fleeing competition. It lets Fitted enter the crowded wardrobe
assistant category with a specific ego.

#### Brian excitement correction — do not shrink the soul of the product

Brian pushed back that the `30-second fit upgrade` / `StyleMove` framing feels less exciting than
the earlier style-board-centered ambition:

- user uploads / creates their own style boards;
- boards have memory;
- recommender understands calendar/routine/context;
- the system can revive seasonal boards;
- taste is personalized but not trapping;
- recommendations change when the user's active board changes.

Interpretation:

> `StyleMove` should probably be the **visible output mechanic**, not the whole product soul.

Revised hierarchy candidate:

1. **North star:** executable `StyleProfile` / style board memory.
2. **Daily loop:** outfit upgrade, rescue item, translate board, routine dress.
3. **Output mechanic:** every result includes a concrete `StyleMove`.
4. **Learning layer:** scoped feedback by board/routine/season/context.
5. **Infrastructure:** async CV, canonical wardrobe traits, snapshots, cache/eval contracts.

Meaning:

- Do not let pain-point discipline flatten the product into a small utility.
- The app should still feel like a personalized style-memory system.
- The first MVP should probably prove the lens-first graph through daily recommendation or
  orphan-item rescue, while keeping `Outfit Upgrade` as an interaction mode inside the active lens.

Weapon-learning principle:

> The next pivot does not need to "win the game" immediately. It needs to improve Fitted's
> understanding of its true weapon.

Meaning:

- Keep the ambitious soul: style boards, memory, context, routines, calendar, evolving fashion.
- Bring specific weapons to bear: executable boards, scoped memory, StyleMoves, hard-to-style
  rescue, no-buy trust, ingestion quality.
- Treat early features as tests of which weapon is real, not as proof that the first chosen wedge is
  the final identity.
- Prefer prototypes/spec slices that teach what users actually value:
  - do they care most about board translation?
  - do they care most about rescuing ignored items?
  - do they care most about daily routine recommendations?
  - do they care most about no-buy improvement?
  - do they care most about the app remembering seasonal/routine versions of them?
- Record what each slice is testing before building it.

## C.1 Detailed user stories, decisions, and spec implications

_Source: `docs/CODEX_USER_STORIES.md` lines 54-973._
_Why preserved: The v2 spec represents the thesis and vocabulary, but not this full scenario inventory._

### Leaning Decisions

1. **Product frame: lens-first**
   - User selects board + routine, then Fitted reveals outfits and item connections under that lens.
   - This is stronger than pure request-first or pure graph-first because it joins aspiration and
     real life.

2. **Skipped options are not evidence**
   - Ignored options should not count as dislikes in early versions.
   - Train from saved, planned, worn, rated, and explicit corrections instead.

3. **Wear semantics are intent-aware**
   - `Wear this today` can count as worn immediately.
   - `Save` and `Plan` are intent signals, not wear signals.
   - Worn-but-unrated should be treated gently, not turned into homework.

4. **Boards go dormant, not dead**
   - Inactive boards should preserve compatibility and trust memory.
   - Freshness cools, exposure pressure resets, and old edges reactivate quickly when the board
     returns.

5. **Routines adapt faster than boards**
   - Boards are closer to identity memory.
   - Routines are behavior, constraints, and habits, so they should respond faster to current life.

6. **Anomalies become exceptions unless promoted**
   - Rare cold weather, laundry chaos, travel, illness, or special events should not rewrite a
     normal board by default.
   - Users need ways to suppress, quarantine, or promote those lessons.

7. **Strong edges need rotation control**
   - Positive feedback should not saturate the board with the same few outfits.
   - Trusted edges become anchors, but Fitted should keep surfacing bridge and stretch paths.

8. **Graph controls should start small**
   - First visible controls should likely be `do not learn from this`, `move to another
     board/routine`, `pin`, and `stop repeating`.
   - Full graph editing can come later.

### Core User Stories

- As a style-stuck user, I want to select a board and routine together, so that Fitted shows how my
  real clothes connect for the version of me I am dressing as today. Reasoning: aspiration alone is
  too abstract; routine alone is too practical.

- As a user with safe defaults, I want Fitted to show how familiar pieces can bridge to less familiar
  pieces, so that style progress feels wearable instead of forced. Reasoning: the safe cluster is the
  starting point, not the enemy.

- As a user with an orphan item, I want Fitted to reveal believable connections around that item, so
  that it stops feeling like a risky purchase with no path. Reasoning: the green-shirt pain is a
  missing-edge problem.

- As a board-driven user, I want to see which items are anchors, bridges, or experiments inside a
  board/routine lens, so that my closet starts feeling organized around style intent. Reasoning: the
  invisible graph needs roles the user can understand.

- As a daily user, I want reliable, bridge, and stretch outfit paths, so that I can pick the level of
  risk I can handle today. Reasoning: fashion risk changes with mood, context, schedule, and
  confidence.

- As a user trying a bold item, I want Fitted to explain why it works with specific pieces, so that I
  learn a reusable styling move. Reasoning: the product should build style fluency, not dependency.

- As a user building a board over time, I want to see my closet become more connected, so that style
  progress feels visible instead of hidden in scores. Reasoning: the emotional payoff is watching
  scattered pieces become usable.

- As a user who repeats safe outfits, I want Fitted to expand from my trusted outfits gradually, so
  that I do not feel like I am gambling with my day. Reasoning: the best path from safe to expressive
  is usually incremental.

- As a user with unused-but-compatible pieces, I want Fitted to surface clusters of trapped closet
  value, so that I can recover outfits from clothes I already own. Reasoning: unlocking owned value
  is more distinct than pushing shopping gaps.

- As a user who wants to dress like myself, I want the graph to preserve my reliable baseline while
  adding new edges, so that experimentation does not erase my identity. Reasoning: style growth needs
  stability and movement.

### Onboarding And Cold Start

- As a new user, I want to choose a board and routine before uploading everything, so that Fitted
  understands what kind of connections I care about first. Reasoning: the lens should guide ingestion
  instead of treating the closet as generic inventory.

- As a new user, I want to start with one routine like school, work, or weekends, so that I can get
  value without cataloging my whole closet. Reasoning: routine-first ingestion lowers cold-start
  friction.

- As a new user, I want to add a few outfits I already wear, so that Fitted can learn my safe hubs
  before suggesting new paths. Reasoning: existing defaults reveal the user's current graph.

- As a new user, I want to mark pieces I like but rarely wear, so that Fitted can identify orphan
  nodes early. Reasoning: the strongest early pain is often a promising item with no trusted edges.

- As a new user, I want to explain what I hoped an item would do for my style, so that Fitted
  connects it to the right board instead of judging it generically. Reasoning: purchase intent is a
  useful signal for aspirational pieces.

- As a new user, I want to mark which outfits feel too safe, just right, or too risky, so that Fitted
  can calibrate my social risk tolerance. Reasoning: risk tolerance is personal and cannot be
  inferred from item metadata alone.

- As a new user, I want to give Fitted a few "not this" examples for a board, so that it does not
  mistake broad inspiration for the exact style I want. Reasoning: negative board boundaries reduce
  vague or costume-like translation.

- As a new user, I want to connect a board image or phrase to one owned item, so that Fitted can
  start translating aspiration into my actual closet. Reasoning: boards become actionable when
  anchored to real clothes.

- As a new user with partial uploads, I want Fitted to show confidence levels on starter connections,
  so that it does not pretend it knows my full closet yet. Reasoning: cold-start trust depends on
  honest uncertainty.

- As a new user with bad lighting or incomplete item photos, I want to correct key traits quickly, so
  that early edges are not built on wrong item data. Reasoning: one wrong color, fit, or formality
  trait can distort the graph.

- As a new user, I want a starter graph preview showing anchors, bridges, and disconnected items, so
  that I can see my closet becoming a map before many outfits are worn. Reasoning: early visual
  payoff matters before the system has much feedback.

- As a new user, I want Fitted to offer one low-risk bridge for a rarely worn item, so that I can try
  progress without committing to a bold look. Reasoning: the first success should lower fear, not
  maximize novelty.

- As a new user, I want to rebuild or describe an old favorite outfit, so that Fitted can understand
  what has already worked for me. Reasoning: past success is high-quality cold-start data.

- As a new user experimenting during setup, I want to say "do not learn from this try-on," so that
  playful testing does not distort my style graph. Reasoning: onboarding exploration is not always
  real intent.

- As a new user, I want to move a worn outfit or feedback event to the right board/routine, so that
  early mistakes do not teach the wrong lens. Reasoning: users will pick the wrong lens while
  learning the system.

- As a skeptical new user, I want Fitted to explain why it created each starter connection, so that
  the graph feels understandable and editable instead of mysterious. Reasoning: explainable learning
  builds trust during cold start.

### Daily Morning And Social Risk

- As a rushed campus user, I want to choose a board and routine in a couple taps, so that Fitted knows
  both the style I am aiming for and the day I actually have. Reasoning: morning outfit choice needs
  aspiration plus context without setup work.

- As a student running late, I want one reliable option, one bridge option, and one stretch option, so
  that I can choose my risk level fast. Reasoning: three clear paths reduce decision fatigue while
  preserving agency.

- As a user afraid of looking like I am trying too hard, I want each option labeled by social risk, so
  that I know whether it reads safe, noticeable, or bold. Reasoning: outfit risk is often social
  risk.

- As a user with a green shirt I never wear, I want to tap it and see the safest pieces it connects
  to for school, so that it stops feeling like a random gamble. Reasoning: orphan items become
  wearable when they gain believable edges.

- As a user who always reaches for the white outfit, I want Fitted to keep one familiar anchor while
  changing one piece, so that style progress feels wearable instead of costume-like. Reasoning: the
  safe cluster is the launch point.

- As a morning user with ten minutes, I want a "wear this today" action, so that choosing an outfit
  can count as worn without an extra confirmation step. Reasoning: low-friction wear logging matters
  more than perfect event purity.

- As a user walking from class to work, I want to switch routines while keeping the same board, so
  that the outfit changes for practicality without losing the style direction. Reasoning: boards
  express identity; routines express the day's demands.

- As a user with a presentation after class, I want to add a constraint like "presentable later," so
  that Fitted avoids outfits that only work for the first part of my day. Reasoning: morning decisions
  often cover multiple contexts.

- As a user seeing friends or classmates often, I want Fitted to help me avoid repeating the exact
  same outfit too soon, so that trusted combos do not become stale. Reasoning: repetition risk is
  part of morning social anxiety.

- As a user who liked an outfit last week, I want Fitted to vary one edge instead of repeating it
  exactly, so that positive feedback creates range rather than saturation. Reasoning: strong edges
  should anchor exploration, not dominate it.

- As a user trying to get braver slowly, I want Fitted to show the smallest next step from my safe
  outfit, so that I can build confidence without overshooting. Reasoning: style growth is easier when
  the next move is incremental.

- As a self-conscious dresser, I want a low-risk version of a board outfit, so that I can test the
  style quietly. Reasoning: some users need social proof before bolder moves.

- As a user getting dressed for friends, I want options that balance personality and normalcy, so that
  I feel expressive without feeling exposed. Reasoning: peer environments amplify outfit anxiety.

- As a user trying a bold color, I want Fitted to ground it with safe items, so that the bold piece
  feels intentional. Reasoning: anchors reduce perceived social risk.

- As a user going to a casual routine, I want Fitted to avoid over-styled suggestions, so that I do
  not feel overdressed for the room. Reasoning: being too dressed up can feel as risky as being
  underdressed.

- As a user trying a stretch outfit, I want a fallback reliable version, so that I can retreat without
  losing the whole idea. Reasoning: reversibility makes risk easier.

- As a user who got negative attention, I want to mark an outfit as socially uncomfortable, so that
  Fitted learns the difference between bad style and bad context. Reasoning: social failure is
  scoped, not universal.

- As a user who felt great in a noticeable outfit, I want Fitted to remember why it worked, so that I
  can repeat the confidence without copying the exact look. Reasoning: the lesson matters more than
  the outfit.

### Graph And Closet Understanding

- As a user opening a board, I want to see which clothing items light up as anchors, bridges, or
  experiments, so that the board feels connected to my real closet. Reasoning: users need to see
  aspiration become wearable inventory.

- As a user with an orphan item, I want that item to appear visibly disconnected, so that I understand
  why I keep avoiding it. Reasoning: the green-shirt pain is easier to solve when missing edges are
  visible.

- As a user tapping an orphan item, I want Fitted to show the first safe edges it can create, so that
  the item stops feeling like a gamble. Reasoning: rescue starts with one believable connection.

- As a user comparing boards, I want the same item to have different connections under different
  boards, so that I understand style is contextual. Reasoning: the same green shirt may work
  differently in summer, campus, or going-out lenses.

- As a user switching routines, I want the graph to change without losing the board, so that school,
  work, and weekend constraints feel distinct. Reasoning: routine filters should reshape usable edges
  without rewriting style intent.

- As a user looking at my safe defaults, I want to see why they are hubs, so that I understand what
  makes them easy. Reasoning: safe pieces reveal the user's current graph.

- As a user trying to grow, I want Fitted to show bridge pieces between hubs and orphan items, so that
  style progress feels gradual. Reasoning: users need intermediate steps between familiar and bold.

- As a user viewing an outfit path, I want to see the edge reason between each important pair, so that
  the outfit feels explainable instead of magical. Reasoning: explanations turn recommendations into
  style fluency.

- As a user reviewing a suggested outfit, I want to know which edge is proven and which edge is new,
  so that I can judge the risk honestly. Reasoning: trust depends on separating memory from
  experimentation.

- As a user who wore a new combo, I want the graph to show that edge becoming stronger, so that my
  style progress is visible. Reasoning: the emotional payoff is watching scattered pieces connect.

- As a user who disliked a worn combo, I want the graph to weaken the specific failed edge, so that
  one bad outfit does not poison every item in it. Reasoning: negative learning must be precise.

- As a user who saves an outfit, I want the graph to mark it as an idea rather than a proven edge, so
  that planning does not become fake evidence. Reasoning: saved intent and lived wear should look
  different.

- As a user who sees repeated outfits, I want the graph to show overused edges cooling down, so that I
  understand why Fitted is rotating me toward fresh paths. Reasoning: rotation needs to feel
  deliberate.

- As a user overwhelmed by a dense graph, I want to filter to anchors, bridges, experiments, or orphan
  nodes, so that I can inspect one kind of decision at a time. Reasoning: literal graphs need focus
  controls to stay usable.

- As a user who wants outfit ideas, I want graph insights to collapse back into outfit cards, so that
  I can act without studying a diagram. Reasoning: the graph should support daily dressing, not
  replace it.

- As a user tracking progress, I want to see orphan nodes decrease and bridge edges increase over
  time, so that I know Fitted is unlocking my closet. Reasoning: the product promise is more usable
  owned clothes.

### Board, Identity, And Seasonal Lifecycle

- As a moodboard-first dresser, I want to activate a board with a routine, so that Fitted translates
  aspiration into outfits I can actually wear today. Reasoning: moodboards become useful only when
  they meet real-life constraints.

- As a seasonal style user, I want inactive boards to sleep instead of decay away, so that last
  summer's graph is recognizable when the season returns. Reasoning: seasonal identity should feel
  dormant, not deleted.

- As a returning summer-board user, I want a reactivation view, so that I can quickly see old anchors,
  stale edges, and new bridge opportunities. Reasoning: coming back to a board should be easier than
  starting from zero.

- As a user refining my identity, I want routine learning to adapt around a board without overwriting
  the board, so that my current schedule does not erase my style direction. Reasoning: routines should
  absorb behavior changes faster than identity memory.

- As a user with multiple boards, I want the same clothing item to have different roles in different
  boards, so that Fitted understands context instead of assigning one global label. Reasoning: a green
  shirt can be an anchor in one board and a stretch piece in another.

- As a user with an orphan item, I want Fitted to show the shortest bridge from my safe cluster to
  that item, so that trying it feels like a small step instead of a style gamble. Reasoning: wearable
  progress often comes from one trusted edge at a time.

- As a style learner, I want edge explanations written in the language of the active board, so that I
  understand how a connection expresses the identity I chose. Reasoning: why-it-works language should
  relate to the user's intended aesthetic, not generic rules.

- As a user who buys aspirational pieces, I want to attach purchase intent to an item, so that Fitted
  can search for the board where the item was supposed to belong. Reasoning: many orphan items are
  failed aspirations, not random mistakes.

- As a user whose style changes slowly, I want board version history, so that I can see how summer
  cool dude changed from last year to this year. Reasoning: style evolution is easier to trust when
  it is traceable.

- As a user getting bored with a board, I want Fitted to suggest evolution paths that preserve the
  board's core traits, so that refreshing the board does not feel like abandoning it. Reasoning: users
  need novelty without identity whiplash.

- As an experimenting user, I want to fork a board into a temporary branch, so that I can try a new
  direction without damaging my reliable board memory. Reasoning: reversible experimentation
  encourages risk.

- As a user with reliable anchors, I want those anchors to stay easy to find but not dominate every
  recommendation, so that trust and discovery can coexist. Reasoning: positive feedback should not
  saturate the board.

- As a user with underused clothes, I want each board to surface one promising bridge piece at a time,
  so that expansion feels manageable. Reasoning: too many weak edges at once creates overwhelm.

- As a user moving between seasons, I want transitional bridges between boards, so that summer pieces
  can evolve into fall outfits instead of disappearing overnight. Reasoning: seasonal style change is
  gradual in real life.

- As a returning user after a long gap, I want Fitted to summarize what the board remembers, so that I
  can re-enter my style graph without rereading old outfits. Reasoning: dormant memory needs
  narrative recall.

- As a user with overlapping boards, I want Fitted to show shared bridge pieces, so that I can
  understand which clothes connect multiple versions of me. Reasoning: overlap between boards is a
  high-value part of personal style.

- As an identity-focused user, I want repeated successful edges to become editable style rules, so
  that my board develops from outfit examples into reusable taste memory. Reasoning: the graph should
  mature into explainable style fluency.

- As an ambitious long-term user, I want a board archive and recap, so that I can see how my closet
  graph, anchors, bridges, and experiments changed across seasons. Reasoning: the north-star product
  is visible style evolution.

### Routine, Calendar, And Trip Planning

- As a weekly planner, I want to plan outfits under a board/routine lens, so that calendar choices
  express the right version of me without being counted as worn. Reasoning: planned intent should
  guide preparation without becoming false wear data.

- As a morning user, I want a planned outfit to become worn with one tap, so that Fitted learns only
  when I actually use it. Reasoning: planning and wearing need separate but connected states.

- As a planner, I want to save multiple candidate outfits for the same day, so that I can choose based
  on mood or weather without polluting style memory. Reasoning: options are interest signals, not
  proof of use.

- As a student with repeated class days, I want a routine template for Monday/Wednesday school, so
  that Fitted can reuse context without repeating identical outfits. Reasoning: routines should create
  rhythm while preserving freshness.

- As a commuter, I want calendar outfits to respect walking, weather, and bag constraints, so that
  planned looks survive the actual day. Reasoning: practical constraints decide whether an outfit gets
  worn.

- As a user packing for a trip, I want Fitted to build a temporary trip graph from selected items, so
  that fewer clothes can create more usable outfit paths. Reasoning: travel makes item connections
  more valuable than inventory size.

- As a trip planner, I want to mark a capsule as trip-only, so that vacation outfits do not rewrite
  my normal board or routine. Reasoning: travel style is often an exception to everyday behavior.

- As a calendar user, I want Fitted to warn me when I planned the same anchor item too often, so that
  my week does not accidentally become repetitive. Reasoning: strong edges should support rotation,
  not saturation.

- As a user with a recurring routine, I want Fitted to rotate reliable, bridge, and stretch outfits
  across the week, so that I make progress without gambling every morning. Reasoning: routine
  dressing needs both confidence and gradual exploration.

- As a traveler, I want to plan outfits by day and activity, so that sightseeing, dinner, travel days,
  and weather each get the right lens. Reasoning: trips compress many routines into a short window.

- As a user who changes plans, I want to swap the routine attached to a planned outfit, so that
  feedback lands in the correct context if my day changes. Reasoning: the right learning scope depends
  on what actually happened.

- As a planner, I want to mark an outfit as packed but not worn, so that Fitted knows it was useful
  for preparation but not validated by real use. Reasoning: packing intent is weaker than wearing.

- As a user returning from a trip, I want to rate trip outfits after the fact, so that Fitted can
  separate what looked good in planning from what worked in real life. Reasoning: post-wear feedback
  is the highest quality signal.

- As a user who overplans, I want old unused planned outfits to fade from active suggestions, so that
  stale ideas do not clutter my calendar. Reasoning: unused plans should become dormant, not
  dominant.

- As a user building a board, I want calendar planning to reveal missing bridge pieces, so that I can
  see why certain routines are hard to dress for. Reasoning: planning exposes weak spots in the graph.

- As a user repeating a routine, I want Fitted to remember outfit formulas separately from exact
  outfits, so that I can reuse a successful pattern with different pieces. Reasoning: the graph should
  learn reusable structure, not only fixed combinations.

- As a user with events, I want one-off formal or themed outfits scoped to the event, so that they do
  not distort my everyday school/work style. Reasoning: special occasions are high-signal locally but
  noisy globally.

- As a calendar user, I want to copy a successful outfit into a future date without overtraining it,
  so that reuse stays convenient but does not saturate recommendations. Reasoning: convenience should
  not be mistaken for a stronger style preference.

### Feedback And Learning Semantics

- As a daily dresser, I want marking an outfit as worn to count as meaningful feedback, so that Fitted
  learns from what I actually trust enough to leave the house in. Reasoning: wearing is stronger than
  browsing or liking.

- As a rushed morning user, I want worn outfits to default gently if I forget to rate them, so that
  Fitted learns lightly without nagging me. Reasoning: low friction matters more than perfect
  feedback.

- As a user trying a risky item, I want to rate a worn outfit as good, neutral, or bad afterward, so
  that Fitted can distinguish confidence from actual satisfaction. Reasoning: an outfit can seem
  promising but fail in real life.

- As a user comparing options, I want unchosen outfits to not count against me, so that Fitted does
  not overread silence or indecision. Reasoning: skips are ambiguous and should not become negative
  feedback.

- As a planner, I want saved outfits to stay separate from worn outfits, so that ideas do not become
  false proof. Reasoning: interest is not lived use.

- As a user who saves but never wears, I want that edge marked as curiosity, so that aspirational
  ideas do not outrank proven outfits. Reasoning: saved intent is weak signal.

- As a user who wears an outfit repeatedly, I want that edge to gain trust, so that Fitted remembers
  reliable connections. Reasoning: repeated wear is strong evidence.

- As a user with a bad wear, I want Fitted to weaken the specific edge, so that one failure does not
  poison every item. Reasoning: negative feedback must be scoped.

- As a user correcting Fitted, I want to say "right outfit, wrong board," so that the edge moves
  instead of being deleted. Reasoning: some failures are scope errors.

- As a user correcting Fitted, I want to say "right board, wrong routine," so that routine learning
  stays distinct. Reasoning: context matters.

- As a user trying a bridge piece, I want compatibility separate from confidence, so that Fitted does
  not discard a good combo I am not ready for. Reasoning: style fit and user readiness differ.

- As a user trying a bold outfit, I want Fitted to remember the styling move, so that the lesson can
  apply beyond one outfit. Reasoning: moves can generalize.

- As a user tired of repetition, I want exposure tracked separately from confidence, so that trusted
  outfits do not dominate. Reasoning: strong edges should not saturate.

- As a user inspecting an edge, I want to see whether it came from AI suggestion, save, plan, wear, or
  rating, so that learning feels accountable. Reasoning: provenance makes memory editable.

- As a user building confidence, I want edge strength to distinguish compatibility, trust,
  satisfaction, freshness, and exposure, so that the graph explains itself. Reasoning: one score hides
  too much.

### Memory, Dormancy, And Anomalies

- As a seasonal user, I want a summer board to go dormant instead of being erased, so that next summer
  its old connections come back quickly. Reasoning: style memory should reactivate, not restart.

- As a returning seasonal user, I want old board memory to come back partly cooled down, so that
  familiar edges are available without dominating the new season. Reasoning: dormant memory should be
  easy to rebuild but not stale.

- As a user whose routine changes, I want routines to adapt faster than boards, so that daily life
  shifts do not rewrite my style identity. Reasoning: routines are behavior patterns; boards are style
  memory.

- As a user with school, work, and weekend selves, I want feedback scoped to the right routine, so
  that one version of me does not flatten the others. Reasoning: global taste learning can
  overgeneralize.

- As a user trying a new aesthetic, I want Fitted to preserve my old reliable style while I
  experiment, so that exploration feels reversible. Reasoning: users take more risks when their
  baseline is safe.

- As a user in unusual weather, I want Fitted to treat rare cold-weather outfits as exceptions, so
  that four weird days do not corrupt my normal summer board. Reasoning: anomalies need temporary
  scope.

- As a user who forgot to switch boards, I want to reassign or suppress a few days of learning, so
  that the graph does not learn the wrong lesson. Reasoning: good products handle normal user
  mistakes.

- As a user who repeats a board for weeks, I want Fitted to rotate between anchors, bridges, and
  experiments, so that positive feedback does not collapse the board into a few defaults. Reasoning:
  freshness is a ranking problem, not a reason to forget taste.

- As a user returning to a dormant board, I want Fitted to summarize what it remembers, so that I can
  re-enter the board without rereading old outfits. Reasoning: dormant memory needs narrative recall.

- As a user with repeated temporary exceptions, I want Fitted to ask whether they should become normal
  memory, so that real habit changes can be promoted intentionally. Reasoning: exceptions sometimes
  become valid patterns.

### Weather, Laundry, Comfort, And Messy Real Life

- As a daily user, I want to mark an outfit as weather-forced, so that Fitted does not treat emergency
  cold or rain choices as normal board preference. Reasoning: weather can explain behavior without
  redefining style.

- As a user with laundry piling up, I want to mark key items as unavailable, so that Fitted recommends
  from what I can actually wear. Reasoning: owned clothing is not always usable clothing.

- As a user wearing backup clothes because laundry is late, I want to say "do not learn from this,"
  so that forced outfits do not become taste signals. Reasoning: necessity and preference are
  different.

- As a user with uncomfortable shoes, I want comfort feedback tied to the shoe edge, so that Fitted
  learns when an outfit looked good but failed in real life. Reasoning: wearability includes physical
  comfort.

- As a user walking a lot that day, I want Fitted to adjust outfit paths around movement, so that
  style suggestions survive my actual routine. Reasoning: practical strain changes what counts as
  wearable.

- As a user dealing with heat, I want Fitted to avoid heavy layers even if they fit the board, so that
  aesthetic matches do not ignore comfort. Reasoning: a good edge can still fail under temperature
  constraints.

- As a user who gets cold indoors, I want Fitted to learn indoor comfort separately from outdoor
  weather, so that my routine graph reflects real conditions. Reasoning: forecast data does not
  capture every environment.

- As a user having a low-confidence body day, I want to choose a comfort-first mode, so that Fitted
  supports the board without pushing risky silhouettes. Reasoning: body comfort changes risk
  tolerance.

- As a user with sensory issues, I want to flag fabrics or fits that bothered me, so that Fitted
  learns comfort limits inside each routine. Reasoning: texture and fit can decide whether an outfit
  gets repeated.

- As a user in a messy week, I want to quarantine learning for several days, so that stress, laundry,
  weather, or schedule chaos does not distort my graph. Reasoning: noisy periods produce misleading
  data.

- As a user caught in rain, I want rain substitutions treated as constraint-driven, so that waterproof
  shoes or jackets do not become stronger board anchors by accident. Reasoning: protective choices are
  often practical, not preferred.

- As a user who repeats the same hoodie during a rough week, I want Fitted to separate comfort
  reliance from style preference, so that survival outfits do not saturate recommendations. Reasoning:
  repetition can mean convenience, not love.

- As a user with changing availability, I want Fitted to rebuild outfit paths around clean clothes, so
  that orphan items can still connect when usual anchors are missing. Reasoning: constraints can
  reveal useful alternate edges.

- As a user whose planned outfit becomes too hot or cold, I want to swap pieces without losing the
  original style intent, so that the board remains intact while the outfit adapts. Reasoning:
  real-life adjustment should preserve the lens.

- As a user who cannot wear certain items because they are being repaired, stained, or missing, I want
  them marked unavailable with a reason, so that Fitted understands the absence is not preference.
  Reasoning: non-use is not always dislike.

- As a power user, I want to review anomaly-tagged outfits later, so that I can promote useful
  discoveries or discard noisy lessons. Reasoning: some exceptions become real style memory, but only
  after confirmation.

### No-Buy, Gap Diagnosis, And Trapped Closet Value

- As a no-buy user, I want Fitted to try owned-clothes connections before suggesting gaps, so that I
  trust it is helping me use my closet first. Reasoning: shopping restraint only works if the product
  does not default to purchase advice.

- As a user with orphan items, I want Fitted to find bridge outfits for pieces I already own, so that
  risky purchases can become wearable instead of wasted. Reasoning: trapped closet value is recovered
  through new edges.

- As a budget-conscious user, I want gap diagnosis to explain what role is missing, so that I
  understand the wardrobe problem without feeling pushed to shop. Reasoning: a gap should be a
  category insight, not an ad.

- As a user avoiding impulse buys, I want Fitted to show substitute owned items for a gap, so that I
  can solve outfits creatively before buying anything. Reasoning: the system should reward reuse over
  acquisition.

- As a user with too many clothes, I want Fitted to reveal unused-but-compatible clusters, so that I
  can recover value from items I forgot worked together. Reasoning: more outfits may already exist
  inside the closet.

- As a user considering a purchase, I want Fitted to test whether the item would create many useful
  edges, so that I buy only if it unlocks real outfits. Reasoning: shopping should be judged by graph
  utility.

- As a no-buy challenge user, I want Fitted to track outfits created without shopping, so that
  progress feels like skill-building instead of deprivation. Reasoning: restraint needs a positive
  feedback loop.

- As a user seeing a missing bridge category, I want Fitted to separate "nice to have" from "blocking
  gap," so that I do not overreact to every weak spot. Reasoning: not all gaps deserve action.

- As a user with a weak board, I want Fitted to show whether the issue is missing items or missing
  connections, so that I know whether to style better or eventually buy smarter. Reasoning: diagnosis
  must distinguish inventory gaps from imagination gaps.

- As a user tempted by trends, I want Fitted to compare a trend item against my existing boards and
  routines, so that I can avoid buying pieces with no real place in my life. Reasoning: trend fit
  should be contextual, not aspirational.

- As a user with a limited closet, I want Fitted to prioritize high-connectivity outfits, so that
  fewer clothes can support more routines. Reasoning: dense graphs make small wardrobes feel larger.

- As a user who owns near-duplicates, I want Fitted to show when a proposed purchase repeats an
  existing role, so that I avoid buying another version of the same safe item. Reasoning: duplicate
  role detection protects against comfort buying.

- As a user with a style board, I want gap maps scoped to that board and routine, so that missing
  categories do not become global shopping pressure. Reasoning: a gap in one lens may be irrelevant
  elsewhere.

- As a user deciding what to keep, I want Fitted to show whether an underused item has promising
  future edges, so that I do not discard trapped value too early. Reasoning: low wear does not always
  mean low potential.

- As a user reviewing my closet, I want Fitted to show the cheapest path as "use what you own,"
  "restyle," "borrow," or "buy later," so that shopping becomes the last resort. Reasoning: gap
  diagnosis should preserve restraint.

- As a user trying to buy better eventually, I want Fitted to save repeated, validated gaps over time,
  so that any future purchase is based on evidence instead of impulse. Reasoning: good shopping
  decisions should come from accumulated graph pain.

### Power-User Graph Controls

- As a power user, I want to freeze learning for a board, so that noisy weeks do not rewrite my style
  graph. Reasoning: travel, stress, weather, or laundry can create misleading behavior.

- As a power user, I want to mark an outfit as "do not learn," so that forced choices do not become
  taste signals. Reasoning: not every worn outfit represents preference.

- As a power user, I want to move an edge from one board to another, so that Fitted stores the
  connection where it actually belongs. Reasoning: users may choose the wrong active lens.

- As a power user, I want to move an edge from one routine to another, so that school, work, and
  weekend learning stay distinct. Reasoning: a good combo can fail when scoped to the wrong context.

- As a power user, I want to strengthen an edge manually, so that trusted combinations become easier
  to find immediately. Reasoning: some user knowledge should not require repeated wear to prove.

- As a power user, I want to weaken an edge manually, so that Fitted stops treating a bad connection
  as promising. Reasoning: direct correction prevents repeated bad suggestions.

- As a power user, I want to pin an edge, so that a reliable outfit stays available without dominating
  recommendations. Reasoning: anchors should be accessible but not saturating.

- As a power user, I want to suppress an edge temporarily, so that I can stop seeing a stale combo
  without deleting its history. Reasoning: boredom is different from rejection.

- As a power user, I want to apply feedback to the board only, so that style identity updates without
  changing every routine. Reasoning: some lessons are aesthetic, not practical.

- As a power user, I want to apply feedback to the routine only, so that practical context updates
  without changing the board. Reasoning: some outfits fail because of the day, not the style.

- As a power user, I want to apply feedback globally, so that universal dislikes or reliable rules
  affect all future recommendations. Reasoning: some preferences are not lens-specific.

- As a power user, I want to quarantine learning for a date range, so that a bad week can be isolated
  after it happens. Reasoning: users may realize later that recent data was noisy.

- As a power user, I want to edit the reason behind an edge, so that Fitted learns the correct styling
  logic. Reasoning: the same outfit can work for different reasons.

- As a power user, I want to split one edge into board-specific versions, so that the same items can
  mean different things in different aesthetics. Reasoning: clothing roles are contextual.

- As a power user, I want to merge duplicate edges, so that the graph stays clean when Fitted learns
  the same connection multiple ways. Reasoning: graph editing needs maintenance tools.

- As a power user, I want to lock a board's core anchors, so that urgent tweaks do not accidentally
  change the board's identity. Reasoning: fast edits need guardrails.

- As a power user, I want to create a temporary board branch, so that I can adapt to urgent conditions
  without damaging the original board. Reasoning: reversible experimentation encourages correction.

- As a power user, I want to review pending graph changes before they become permanent, so that
  automatic learning stays under my control. Reasoning: power users need a way to approve important
  memory updates.

### Explainability, Trust, And Safeguards

- As a user, I want to see why two clothing items are connected, so that Fitted feels explainable
  instead of random. Reasoning: trust starts with understanding the recommendation.

- As a user, I want each connection to show the board and routine it belongs to, so that I know the
  suggestion is scoped to the right version of me. Reasoning: style advice loses meaning when context
  is hidden.

- As a user, I want to know whether a connection came from my wear history, my rating, my board, or
  Fitted's suggestion, so that I can judge how much to trust it. Reasoning: provenance makes learning
  accountable.

- As a user, I want Fitted to explain why it repeated an outfit, so that repetition feels intentional
  rather than stale. Reasoning: reuse can mean reliability, laziness, or overconfidence.

- As a user, I want to see when Fitted is avoiding repetition on purpose, so that I understand why it
  suggests a less obvious outfit. Reasoning: exploration needs explanation to feel safe.

- As a user, I want Fitted to explain why a connection changed strength, so that I can understand what
  my behavior taught it. Reasoning: invisible learning can feel like loss of control.

- As a user, I want to see when a connection became weaker because it is stale, so that I do not
  mistake dormancy for dislike. Reasoning: old memory should feel cooled down, not erased.

- As a user, I want Fitted to explain why an old connection came back, so that revivals feel helpful
  instead of surprising. Reasoning: dormant memory should re-enter with context.

- As a cautious user, I want bold suggestions to explain the safe piece they are anchored by, so that
  risk feels wearable. Reasoning: experiments need a visible path back to confidence.

- As a user, I want to correct why a connection works or does not work, so that Fitted learns my
  reasoning instead of only my rating. Reasoning: user explanations are high-trust feedback.

- As a user, I want to mark a suggestion as "not me," so that Fitted does not keep pushing a direction
  that feels alien. Reasoning: users need protection from being over-shaped by the system.

- As a user, I want to mark a suggestion as "too repetitive," so that Fitted can keep the connection
  trusted without overusing it. Reasoning: confidence and exposure should not be the same thing.

- As a user, I want to see when weather, laundry, travel, or necessity influenced an outfit, so that
  forced choices do not become taste. Reasoning: noisy situations need visible scope.

- As a user, I want Fitted to ask before turning an exception into normal memory, so that temporary
  behavior does not rewrite my board. Reasoning: anomalies should be promoted, not silently absorbed.

- As a power user, I want to inspect the strongest lessons Fitted thinks it has learned, so that I can
  correct bad assumptions before they trap me. Reasoning: model trust depends on editable memory.

- As a long-term user, I want a recap of how a board changed and why, so that style evolution feels
  traceable rather than mysterious. Reasoning: progress is more trustworthy when the causes are
  visible.

### Failure-Mode And Boundary Stories

- As a confused new user, I want a simple "dress me today" path, so that boards, routines, and graphs
  do not block me from getting an outfit. Reasoning: the core concept may be too abstract before the
  user feels value.

- As a skeptical user, I want Fitted to explain the graph in outfit language, so that I do not feel
  like I am managing a data structure. Reasoning: the product can lose trust if the metaphor becomes
  the interface.

- As a user with a small closet, I want Fitted to avoid pretending I have endless combinations, so
  that recommendations feel honest instead of forced. Reasoning: sparse wardrobes can make graph
  language expose limitations too harshly.

- As a user with bad item photos, I want Fitted to show uncertainty before making confident fashion
  claims, so that wrong color or texture reads do not poison suggestions. Reasoning: CV errors can
  create bad edges.

- As a user whose item metadata is wrong, I want to correct an item from any recommendation, so that
  one bad label does not keep producing bad outfits. Reasoning: trust breaks when obvious mistakes are
  hard to fix.

- As a user with workplace or school dress rules, I want hard constraints to override style
  suggestions, so that Fitted never recommends something socially or practically unsafe. Reasoning:
  fashion logic is secondary to real consequences.

- As a user with cultural or personal modesty constraints, I want Fitted to learn boundaries
  explicitly, so that generic styling rules do not disrespect me. Reasoning: fashion rules are not
  universal.

- As a user with body-sensitive preferences, I want feedback framed around outfit fit and comfort, so
  that Fitted does not make body-judgment comments. Reasoning: trust can break instantly through
  careless language.

- As a user trying a new aesthetic, I want experiments separated from my main board, so that a short
  phase does not overwrite my stable style. Reasoning: curiosity should be reversible.

- As a user who hates a recommendation, I want a fast "not me" action, so that Fitted learns taste
  boundaries without requiring a detailed critique. Reasoning: some failures are obvious to the user.

- As a user who does not trust AI fashion advice, I want Fitted to admit when a suggestion is
  experimental, so that uncertainty feels transparent instead of fake confidence. Reasoning:
  overconfident wrong advice damages credibility.

- As a privacy-conscious user, I want sensitive boards, outfits, and photos to stay private by
  default, so that personal style exploration does not feel exposed. Reasoning: wardrobe data can
  reveal identity, body, lifestyle, and events.

### Undefined Decisions For Claude/Brian

1. **Main option vocabulary**
   - Recommendation: use `anchor / bridge / experiment` for graph roles, `reliable / bridge /
     stretch` for user-facing option paths, and `safe / noticeable / bold` as social-risk labels
     when useful.
   - Reasoning: graph language explains structure; risk language explains social feeling.

2. **Onboarding entry point**
   - Recommendation: start with board + routine, then guided closet ingestion.
   - Reasoning: the user should feel that Fitted is learning the version of them they care about, not
     just collecting inventory.

3. **Graph visibility**
   - Recommendation: hybrid. Outfit cards stay primary, with a web/connections view as the "closet
     coming alive" moment.
   - Reasoning: a literal graph is powerful but can become messy as the default UI.

4. **Feedback semantics**
   - Recommendation: saved, planned, packed, worn, rated, and explicit corrections teach the system;
     skipped and ignored options do not.
   - Reasoning: positive intent and explicit feedback are cleaner than inferring dislike from
     silence.

5. **Decay and dormancy**
   - Recommendation: do not decay compatibility as if it were forgotten. Let inactive boards go
     dormant, cool freshness, reset exposure pressure, and reactivate quickly.
   - Reasoning: old style memory should become quieter, not disappear.

6. **Routine adaptation**
   - Recommendation: routines should adapt faster than boards while keeping long-term trust history.
   - Reasoning: routines are current-life behavior; boards are style identity memory.

7. **Weather and anomaly handling**
   - Recommendation: unusual context creates a soft exception by default, with controls to suppress or
     promote it.
   - Reasoning: four weird days should not corrupt a board, but repeated exceptions may become
     meaningful.

8. **First visible power controls**
   - Recommendation: start with `do not learn from this`, `move to another board/routine`, `pin`,
     `stop repeating`, and maybe `mark unavailable`.
   - Reasoning: these address the highest-risk trust failures without exposing a full graph editor too
     early.

9. **No-buy and gap posture**
   - Recommendation: gaps should be diagnosis-only unless the user asks for shopping help.
   - Reasoning: Fitted should earn trust by unlocking owned clothes before suggesting purchases.

10. **Edge score model**
    - Recommendation: separate compatibility, trust, satisfaction, freshness, and exposure internally,
      even if the UI presents simple labels.
    - Reasoning: one score cannot represent whether a combo works, whether the user trusts it, whether
      it is stale, and whether it is being over-shown.

11. **Exception promotion**
    - Recommendation: exceptions should be suppressible, reviewable, and promotable.
    - Reasoning: anomalies are usually noise, but repeated anomalies can become real style memory.

12. **Literal graph editing**
    - Recommendation: defer full node/edge editing, but preserve the data model.
    - Reasoning: direct graph manipulation is powerful for power users but can overwhelm casual users.

### Spec Implications

The user stories imply these future product/data concepts:

- `Board`
- `Routine`
- `Lens` as Board / StyleProfileSnapshot + Routine + context
- `StyleProfile`
- `StyleProfileSnapshot`
- `ItemNode`
- `StyleEdge`
- `EdgeReason`
- `EdgeRole` such as anchor, bridge, experiment
- `OptionPath` such as reliable, bridge, stretch
- `VariantRisk` such as safe, noticeable, bold
- `FeedbackEvent` such as saved, planned, packed, worn, rated, corrected
- `FeedbackRating` such as good, neutral, bad
- `FeedbackReason` such as too_boring, too_much, not_practical, not_me, wrong_context,
  weather_forced, necessity, too_repetitive
- `LearningScope` such as board, routine, lens, global, exception
- `ContextOverride` for weather, laundry, travel, comfort, dress code, event, availability
- `DormantBoardState`
- `ExposurePressure`
- `EdgeProvenance`
- `AnomalyReview`
- `PowerUserGraphEdit`
- `NoBuyGapDiagnosis`

The near-term engineering rule should be:

> Keep M1-3 and the sampler/ranker substrate additive, but preserve fields and event boundaries that
> let board/routine scoped style memory exist later.

### Possible MVP Slices

1. **Lens-first daily recommendation**
   - Select board + routine.
   - Return reliable / bridge / stretch paths.
   - Each path includes one `StyleMove` and one edge reason.

2. **Orphan item rescue inside a lens**
   - User selects a rarely worn item.
   - Fitted shows the shortest bridge from safe cluster to that item.
   - Worn/rated feedback strengthens or weakens the specific edge.

3. **Scoped feedback foundation**
   - Save, plan, wear, rate, and correct are separate events.
   - Skips are logging only.
   - Feedback stores board/routine/lens/context snapshot.

4. **Dormant board memory**
   - Inactive boards cool freshness and exposure, but keep compatibility and trust.
   - Reactivated boards summarize old anchors and new bridge opportunities.

5. **Exception controls**
   - Users can mark `do not learn`, `weather-forced`, `unavailable`, or `temporary exception`.
   - Exceptions can later be suppressed or promoted.

6. **No-buy gap diagnosis**
   - Try owned-clothes bridges first.
   - Only show missing roles as diagnosis.
   - Shopping help remains opt-in.

## C.2 Fashion ontology and contextual-culture warning

_Source: `docs/CODEX_HANDOFF.md` lines 400-473._
_Why preserved: Preserves the non-universal fashion-rule warning, richer garment-role taxonomy, and culture/context notes._

#### Fashion evolution / culture / taxonomy problem

Brian raised the hardest domain issue: fashion is not a fixed rulebook. Big shirt + tiny pants can
be good; tiny shirt + big pants can also be good. Accessories, culture, subculture, gender
expression, modesty, local norms, seasons, and trend cycles all change what "works." The project
already struggled with dresses, which shows how brittle a shallow taxonomy can become.

Principle:

> Fitted should model fashion as **contextual relationships**, not universal rules.

Avoid:

- hard-coded "balanced silhouette" rules that imply one correct proportion;
- objective "fashionability" claims;
- one global style taxonomy pretending to fit all cultures;
- treating accessories as optional decoration forever;
- collapsing dresses, layers, sets, jumpsuits, uniforms, jewelry, bags, hats, and cultural garments
  into awkward top/bottom leftovers.

Needed long-term representation:

- `GarmentRole` rather than only item type:
  - base top, base bottom, full-body base, outer layer, mid layer, shoe, bag, belt, jewelry, hat,
    scarf, hosiery/socks, uniform/special, optional accessory.
- `SilhouetteRelation`:
  - oversized top + slim bottom;
  - fitted top + wide bottom;
  - volume-over-volume;
  - cropped + high-rise;
  - long-over-short;
  - intentional imbalance.
- `StyleDialect` / `StyleProfile` traits:
  - minimalist, streetwear, preppy, workwear, romantic, techwear, academic, formal, modest,
    vintage, etc., but user-editable and non-exclusive.
- `ContextConstraint`:
  - weather, walking, commute, school/work, dress code, cultural/modesty preference, comfort,
    event formality, budget/no-buy.
- `TrendPack` or external style reference layer:
  - optional, versioned, and weakly weighted;
  - should inform possibilities, not overrule the user's active board.
- `UserOverride`:
  - user correction beats model/style rules.

Practical v1 answer:

- Keep current v1.2 sampler type system for the substrate where needed.
- Do **not** pretend it is the final fashion ontology.
- In the pivot spec, introduce additive fields for richer traits/roles without blocking M1/M2:
  `role`, `layer_role`, `fit`, `silhouette`, `formality`, `material/texture`, `pattern`,
  `accessory_role`, `style_tags`, `confidence`, `reviewed`.
- Treat accessories as future first-class candidates, even if v1 only supports shoes.
- Treat dresses/full-body garments as first-class; avoid repeating the old "dress bolted onto
  top/bottom" failure.

Claude comparison note:

- This must be compared against existing v1.2 resolutions and Claude plans before promotion.
- M0/M1 should not be derailed.
- The spec-to-Markdown pivot should decide which concepts become canonical now versus future:
  `StyleProfile`, `StyleMove`, `RequestIntent`, richer `WardrobeItem` traits, accessory roles,
  routine/calendar snapshots, and scoped feedback.
- If a concept affects the sampler/ranker pipeline, it must be placed into the canonical pipeline
  rather than left as vibe text.

The product should help the user:

- wear more of what they already own;
- make outfits less bland without making them impractical or costume-like;
- understand the small change that makes an outfit work;
- rescue hard-to-style pieces;
- evolve toward a desired style without requiring a full wardrobe overhaul;
- learn from likes/dislikes without being trapped by them.


## C.3 UX speed principles and emotional neglect modes

_Source: `docs/CODEX_HANDOFF.md` lines 840-906._
_Why preserved: v2 compresses this into product principles; this keeps concrete first-screen, feedback, onboarding, copy, and neglect notes._

#### UI / UX speed principles

The UI should be built around fast entry points, not a dashboard of every feature.

First screen candidate:

- `Upgrade outfit`
- `Rescue item`
- `Translate vibe`

Result screen candidate:

- three variant cards: `safe`, `noticeable`, `bold`;
- each card shows the changed item/move first;
- explanation is one sentence by default, expandable only if wanted;
- feedback is four quick buttons: `wear it`, `too boring`, `too much`, `not practical`.

Onboarding:

- do not require complete wardrobe upload;
- ask for a starter closet: favorite top, favorite bottom, shoes, layer, one ignored item;
- allow import/photo/manual entry;
- process photos in background;
- show "active closet" count and "processing" count;
- review only low-confidence fields, not everything.

Fast interaction rules:

- never block recommendations on CV jobs still running;
- cache outfit candidates per wardrobe/profile/context snapshot;
- precompute basic item traits and compatibility candidates;
- let users start from a current outfit photo or selected items;
- keep explanations short enough to read while getting dressed.

UX copy guardrail:

- Avoid telling users they are bland.
- Say "make this more intentional", "one step sharper", "use this piece better", "less default".
- The app should feel useful and honest, not judgmental.

#### How users could feel neglected

Fitted can fail emotionally even if recommendations are technically valid.

Neglect modes:

- ignores comfort, mobility, sensory preferences, or body confidence;
- assumes fashion goals are always boldness or trendiness;
- treats work/school/cultural/religious modesty constraints as afterthoughts;
- suggests impractical shoes for walking/commute/weather;
- repeats clothes that are dirty, unavailable, damaged, or out of season;
- recommends outfits that require confidence the user did not ask for;
- turns every gap into a shopping nudge;
- over-explains and makes the user feel corrected;
- learns from one dislike and narrows too aggressively;
- fails users with partial closets, non-standard categories, plus-size concerns, gender-expression
  nuance, uniforms, laundry constraints, or limited budgets.

Design response:

- represent constraints explicitly;
- keep "bold" optional;
- make `No-buy` trustworthy;
- keep feedback scoped;
- add "not practical" as a first-class signal;
- prefer "try this one move" over lectures.


## C.4 Business, critic, and testability notes

_Source: `docs/CODEX_HANDOFF.md` lines 907-1039._
_Why preserved: Preserves growth loops, monetization guardrails, risk list, and golden-test ideas not carried verbatim into v2._

#### Business hat — making Fitted a sensation

The path to sensation is not more features. It is one repeatable moment users want to show someone.

Most promising moment:

> Before: my normal outfit. After: the one owned-closet move that made it work.

Potential growth loops:

- shareable upgrade card: before / safe / noticeable / bold;
- "rescue item" videos/cards for the piece users never wear;
- 7-day no-buy upgrade challenge;
- campus/work/weekend style lane recaps;
- "my personal style rules" share card;
- "I wore X for the first time in months" milestone;
- friend asks "upgrade my fit" without needing full social wardrobe infrastructure.

Monetization should not lead:

- free tier proves upgrade/rescue loop with limited closet/items;
- premium can unlock unlimited closet, lanes, saved rulebook, advanced history, batch upload,
  packing/capsule/gap maps;
- affiliate shopping only after no-buy trust exists and only when the app explains an actual gap.

Moat candidates:

- closet-specific feedback history;
- personal style rules;
- rescued-item history;
- scoped context memory;
- high-quality item traits;
- a curated `StyleMove` ontology and evaluation set;
- trust that Fitted improves owned-clothes outfits before selling anything.

#### Critic hat — where this falls apart

1. **Competitors are close.**
   - Acloset/Whering/Indyx already claim owned-closet outfit help.
   - Defense: Fitted must own `upgrade/rescue/style move`, not generic recommendations.

2. **Fashion advice is subjective and easy to offend.**
   - Defense: expose variants and user control; avoid objective "fashionability" claims.

3. **A text-only product may not feel magical.**
   - Defense: even before virtual try-on, use item images, changed-item highlights, and before/after
     outfit cards.

4. **CV quality can poison the whole loop.**
   - Defense: confidence states, review queue, active-only sampler visibility, manual correction.

5. **Onboarding friction is existential.**
   - Defense: starter closet, progressive upload, background queue, useful partial results.

6. **Explanations can become clutter.**
   - Defense: one sentence per outfit; details behind expand.

7. **Personalization data will be sparse.**
   - Defense: start with explicit feedback labels and deterministic rules; ML later.

8. **The app could become too many modes.**
   - Defense: the modes are entry points into the same loop: input -> 3 variants -> style move ->
     scoped feedback.

9. **Shopping pressure can destroy trust.**
   - Defense: no-buy default; gap suggestions informational first.

10. **The new pivot may outgrow v1.2.**
    - Defense: spec pivot should add request/response contracts first, not implement every feature.

#### Development-easy design

Keep the architecture boring even if the product feels ambitious.

Recommended abstractions:

- `Board`
- `Routine`
- `Lens`
- `RequestIntent`
- `WardrobeItem` with reviewed canonical traits
- `BaseOutfit`
- `CandidatePool`
- `OutfitDraft`
- `OutfitVariant`
- `StyleMove`
- `StyleEdge`
- `Explanation`
- `FeedbackEvent`
- `StyleProfile`
- `StyleLane` later

Rules:

- LLM should compose/explain from structured inputs, not invent unavailable items.
- Ranking/candidate generation should be deterministic and unit-testable.
- Every recommendation response should carry a trace: request intent, active items, constraints,
  candidate ids, variant role, style moves, explanation fields.
- Schema validation should wrap every LLM boundary.
- Keep one vertical slice first: lens-first daily recommendation or orphan-item rescue using owned
  clothes, explicit board/routine context, no visual board required, no shopping, no inferred
  routines.

#### Testing-easy design

Test the product as a set of stable contracts, not vibes.

Useful test layers:

- unit tests for item eligibility, caps, constraints, forced-item inclusion, variant roles;
- golden wardrobes for personas: student basics, office casual, sneaker-heavy, outerwear-heavy,
  incomplete closet, color-limited closet, hard-to-style statement item;
- golden requests: upgrade bland outfit, rescue item, translate vibe, bad weather, strict comfort;
- schema tests for LLM output;
- deterministic mock LLM for CI;
- property tests that recommended item ids must come from active wardrobe;
- regression tests for "no shopping items in no-buy mode";
- explanation tests that every `StyleMove` references actual changed/added items;
- offline eval labels: `wearable`, `too boring`, `too much`, `not practical`, `wrong vibe`;
- trace snapshots so failures can be debugged without rerunning models.

North-star metrics:

- time to first useful outfit;
- accepted upgrade rate;
- "just right" vs `too boring` / `too much`;
- hard-to-style item rescued/worn;
- percentage of recommendations using previously ignored items;
- owned-closet utilization;
- no-buy accepted outfits;
- repeat-session rate after first successful upgrade;
- explanation helpfulness.


## C.5 Mood-board translation behavior and wedge notes

_Source: `docs/CODEX_HANDOFF.md` lines 2762-2783._
_Why preserved: Preserves question prompts and feature concepts around closest/practical board translation and StyleGap._

#### Product behavior implied by this wedge

Fitted should eventually answer these questions:

- "What outfit in my closet gets closest to this board today?"
- "What is the practical version of this board for my current routine?"
- "Why is this outfit a good translation?"
- "What part of the board could my closet not satisfy?"
- "What changed because I switched boards?"
- "What did the system remember from last winter's version of this style?"
- "Did my dislike affect this board, this routine, or my global taste?"

This implies feature concepts:

- `StyleProfile` generated from a text or visual board.
- `StyleProfileSnapshot` attached to each recommendation request.
- outfit ranking modes such as `closest_to_board`, `practical_match`, and `balanced`.
- explanation fields for matched board traits and unsatisfied board traits.
- `StyleGap` objects for missing closet capabilities.
- feedback scoped by `style_profile_id`, `routine_id`, season, and context.
- ingestion states that separate unprocessed, processed, reviewed, active, and sampler-visible items.


## C.6 Blue-ocean feature candidates

_Source: `docs/CODEX_HANDOFF.md` lines 2883-3107._
_Why preserved: Preserves detailed north-star feature candidates that v2 only summarizes or defers._

#### Signature feature candidate: Translate This

The clearest new feature:

> **Translate This**

User action:
- user gives an inspiration image, board, phrase, or saved vibe;
- user gives optional context: class, work, date, errands, weather, comfort, boldness;
- Fitted translates it into owned-wardrobe outfits.

Output:

1. **Closest translation**
   - The outfit that best matches the source vibe from owned clothes.

2. **Wearable translation**
   - The version that preserves the vibe but respects comfort, routine, weather, and risk.

3. **Stretch translation**
   - A bolder experiment that moves the user toward the target style.

4. **Missing pieces / style gap**
   - The traits the closet cannot currently express well.
   - Example: "Your board leans oversized, soft, and layered. Your closet has the softness, but not
     the oversized outerwear or textured winter accessories."

5. **Why this works**
   - Matched traits: color, silhouette, formality, texture, layering, vibe words.
   - Unsatisfied traits: the board wanted X, closet had only Y.

This is not just recommendation. It is translation plus diagnosis.

#### Signature feature candidate: Style Gap Map

Feature:

> **Style Gap Map**

For each active `StyleProfile`, Fitted computes where the closet supports or blocks that style.

Possible gap dimensions:

- color palette coverage;
- silhouette coverage;
- layering coverage;
- formality coverage;
- seasonal/weather coverage;
- shoe/accessory support;
- texture/material support;
- pattern/print support;
- routine suitability;
- comfort/practicality constraints.

Output examples:

- "This board is 74% expressible with your active wardrobe."
- "Strong support: muted neutrals, wide-leg bottoms, casual shoes."
- "Weak support: structured outerwear, metallic accessories, cropped layers."
- "Most useful owned item for this board: black loafers."
- "Most limiting missing category: light jacket / overshirt."

Important: early versions should avoid fake precision. Percentages can be internal or replaced with
plain-language confidence buckets.

This is more defensible than generic "wardrobe stats" because it is relative to a chosen style
target, not just cost-per-wear or most-worn items.

#### Signature feature candidate: Style Bridge Plan

Feature:

> **Style Bridge Plan**

Instead of only producing today's outfit, Fitted creates a short path from current closet reality to
the target style.

Example output:

1. **Wear now**
   - 3 outfits already possible from owned clothes.

2. **Try next**
   - 2 low-risk experiments using familiar items in new combinations.

3. **Stretch**
   - 1 bolder outfit that moves closer to the board but may feel less safe.

4. **Unlock**
   - 1 missing item category that would unlock many target-style outfits.

5. **Do not buy yet**
   - categories the user thinks they need but the closet already covers.

This makes Fitted less like an outfit slot machine and more like a progression system.

Why this smells like a goal:

- It matches how people actually change style: not one perfect outfit, but a series of attempts.
- It can work without massive social graph data.
- It creates a reason to return: the user is progressing toward a style direction.
- It makes likes/dislikes more meaningful because feedback teaches which bridge steps feel wearable.
- It creates a natural future shopping lane without becoming a shopping-first app.

#### Signature feature candidate: Closet Debugger

Feature:

> **Closet Debugger**

The user asks:

- "Why do my outfits feel boring?"
- "Why can't I dress like this board?"
- "Why do I always default to the same pants?"
- "Why do my work outfits feel too formal?"
- "Why are recommendations repeating?"

Fitted answers from wardrobe structure, board traits, routine history, and feedback.

Potential diagnoses:

- too many statement tops, not enough neutral bottoms;
- no shoes that bridge casual and polished;
- active board asks for layering, but closet has few lightweight layers;
- routine constraints are too strict, so ranker collapses to the same safe outfit;
- user dislikes bold items globally, but the active board requires a bold anchor;
- missing accessories make outfits technically correct but visually unfinished.

This is compelling because most wardrobe apps show data, but fewer explain the user's style bottleneck.

#### Signature feature candidate: Style Lanes / Versions of Me

Feature:

> **Style Lanes**

Instead of one global taste profile, the user can have multiple active lanes:

- campus / school;
- work / internship;
- weekend;
- date / going out;
- cozy winter;
- summer casual;
- experimental board;
- capsule travel.

Each lane has:

- active board/profile;
- feedback memory;
- favorite outfits;
- forbidden / disliked patterns;
- routine/context defaults;
- seasonality;
- wardrobe coverage score or confidence.

This is not just "tags" or "occasions." It is scoped memory. It directly addresses Brian's fear
that liking/disliking one thing can oversteer the whole system.

#### Signature feature candidate: Anti-Algorithm Capture

Feature:

> **Anti-Algorithm Capture**

The app makes personalization intentionally bounded:

- "Apply this dislike globally or only to this board?"
- "This seems like a work-context preference. Keep it there?"
- "You liked this in winter. Revive this lane?"
- "Your recent likes are narrowing recommendations. Keep exploring?"

Do this sparingly. The value is not adding knobs; it is making the system trustworthy.

This is a product differentiator because many recommendation systems feel opaque and sticky. Fitted
can explicitly promise:

> The app learns you without trapping you.

#### Candidate strategic stack

The strongest combined product shape:

1. **Translate This**
   - The immediate, magical user-facing action.

2. **Style Gap Map**
   - The diagnosis layer that makes recommendations explainable.

3. **Style Bridge Plan**
   - The retention/progression layer.

4. **Style Lanes**
   - The memory architecture that prevents one flat profile.

5. **Async closet ingestion**
   - The substrate that makes the system practical.

This turns Fitted from:

> "an app that recommends outfits"

into:

> "an app that helps me become better at wearing the style I want, using the wardrobe I actually
> have."

#### MVP slice of the pivot

Do not build all of this at once. The smallest coherent slice:

1. `StyleProfile` from text board / style words.
2. "Translate This" request mode using one active profile and current context.
3. Return 3 outfit variants:
   - closest;
   - practical;
   - stretch.
4. Include matched traits and missing traits in the response payload.
5. Store feedback against the active profile id.

This would be enough to prove the new direction without full visual boards, virtual try-on, shopping,
or inferred routines.


## C.7 Closet-fluency feature family

_Source: `docs/CODEX_HANDOFF.md` lines 3346-3534._
_Why preserved: Preserves the local feature family around Outfit Upgrade, Rescue, Blandness Debugger, Personal Style Rules, and No-Buy Style Bridge._

#### Feature pivot from this refinement

The best feature direction is not only "Translate This." It is a family of local, closet-grounded
coaching features:

##### 1. Outfit Upgrade

User starts with a bland outfit or selected base pieces.

Fitted returns:

- "keep this";
- "swap this";
- "add this";
- "why it works";
- optional `safe`, `noticeable`, and `bold` upgrades.

Example:

> Keep the black tee and jeans. Swap white sneakers for loafers, add the olive overshirt, and roll
> the cuffs once. This keeps the outfit casual but adds a third layer, a different texture, and a
> cleaner shoe role.

Why it matters:

- It does not require the user to know the exact style target.
- It directly attacks blandness.
- It teaches through one actionable change.

##### 2. Hard-to-Style Rescue

User selects an item they own but never wear.

Fitted answers:

- why it is hard to style;
- what role it can play;
- 3 outfits using it:
  - easiest;
  - most balanced;
  - most interesting;
- what closet gap makes it harder to use.

Why it matters:

- This directly uses the "hard-to-style" insight from stylists.
- It turns ignored clothes into product moments.
- It makes wardrobe upload feel worth it.

##### 3. Blandness Debugger

Fitted analyzes repeated outfits / liked outfits / worn history and identifies why things feel flat:

- same silhouette every time;
- no third piece/layer;
- too many items with the same visual weight;
- shoes always make outfits too casual;
- no contrast in texture;
- color palette is safe but not intentional;
- missing accessories or finishing pieces;
- user has interesting items but they are isolated from basics that support them.

Output should be plain and local:

> Your closet is not boring. Your combinations are collapsing to tee + pants + sneakers. The easiest
> fix is adding one lightweight overshirt/jacket layer and rotating shoe roles.

##### 4. Personal Style Rules

Fitted gradually learns and exposes small rules from the user's own closet and feedback:

- "You usually like relaxed top + structured shoe."
- "You dislike outfits where both top and bottom are fitted."
- "You like black/olive/cream but need one lighter piece to avoid looking flat."
- "You prefer bolder items when the rest of the outfit is familiar."

Why it matters:

- This turns personalization into user understanding, not just hidden scoring.
- It makes the user better at dressing outside the app.
- It supports Brian's desire for personal memory without algorithm capture.

##### 5. No-Buy Style Bridge

A mode that intentionally forbids shopping recommendations.

Output:

- 3 ways to improve using only owned clothes;
- 1 "missing category" if unavoidable;
- 1 "do not buy yet" note if the app sees closet redundancy.

Why it matters:

- It fits time/money/commitment constraints.
- It differentiates from shopping-first AI.
- It can later become a trustworthy shopping assist because the app has proven it will not push
  buying by default.

#### The strongest product loop

Proposed loop:

1. User uploads enough closet items to create a starter wardrobe.
2. User selects:
   - a bland outfit to upgrade;
   - a hard-to-style item to rescue;
   - a mood board to translate;
   - or a routine context to dress for.
3. Fitted returns 2-3 outfit options plus a tiny explanation.
4. User likes/dislikes or says "too much / too boring / not practical."
5. Fitted updates scoped style rules.
6. Over time, the app builds:
   - outfit memory;
   - style lanes;
   - personal rules;
   - gap map;
   - no-buy bridge plan.

This is more defensible than a one-shot recommendation endpoint because it creates learning on both
sides:

- the model learns the user;
- the user learns how to use their own closet.

#### What success should feel like

For Brian-like users:

> I still look like myself, but less default.

Other good outcome phrases:

- "I used clothes I already owned."
- "I finally wore the piece I kept avoiding."
- "I understood the one thing making the outfit work."
- "I did not have to buy a whole new wardrobe."
- "The app nudged me without making me feel costumed."
- "My outfits got less bland without becoming impractical."

#### Risks / critique

1. **May sound too educational**
   - Mitigation: teach through outfit actions, not lessons.

2. **May require high-quality item attributes**
   - Mitigation: start with simple traits: category, color, formality, layer role, texture, fit
     looseness, pattern, shoe role.

3. **May overfit Brian's personal pain**
   - Counterpoint: external sources repeatedly show related pains: wardrobe fatigue, hard-to-style
     pieces, closet underuse, expensive stylist education, and men needing style fundamentals.

4. **May be hard to evaluate**
   - Candidate metrics:
     - rescued item accepted/worn;
     - percent recommendations using previously ignored items;
     - user says upgrade is `better` but still `wearable`;
     - reduction in repeated base outfit patterns;
     - feedback on "too much / too boring / just right";
     - no-buy success: outfit accepted without shopping suggestion.

5. **May conflict with fully automated recommendations**
   - This is a feature, not a bug. The wedge is not pure automation; it is guided improvement.

#### Current best pain-point statement

Best internal statement:

> Fitted targets style-stuck wardrobe owners: people who already own enough clothes but repeatedly
> dress from a bland, safe subset because they lack fast, personal, closet-grounded outfit fluency.

Best user-facing statement:

> Find the better outfit hiding in the clothes you already own.

Best feature promise:

> Upload your closet, pick a bland outfit or hard-to-style piece, and Fitted shows the safe,
> noticeable, and bold ways to make it work.

This can coexist with the previous Style Bridge / Translate This pivot:

- `Translate This` handles aspirational input.
- `Outfit Upgrade` handles bland present-state input.
- `Hard-to-Style Rescue` handles ignored-item input.
- `Style Lanes` handles context/memory.
- `No-Buy Style Bridge` handles money/commitment constraints.


## C.8 Executable style memory north-star

_Source: `docs/CODEX_HANDOFF.md` lines 3825-3991._
_Why preserved: Preserves the high-ambition product shape, tabs/modes, guardrails, and phrasing._

#### Fitted's own twist - executable style memory

The strongest synthesis remains:

> Fitted's twist is executable style memory.

Definition:

> The app stores not only what the user owns and likes, but which style intention, context, and
> version of the user a successful outfit belonged to - then uses that memory to propose the next
> wearable move.

This is different from:

- a closet catalog;
- a random outfit generator;
- a virtual dressing room;
- a shopping assistant;
- a static style quiz;
- a generic mood board;
- one global like/dislike profile.

Core loop:

1. User declares or reveals a style intention.
2. Fitted translates that intention into owned-closet possibilities.
3. Fitted returns safe / noticeable / bold options.
4. Each option has one concrete `StyleMove`.
5. User feedback is scoped to the relevant board/lane/context.
6. Fitted remembers the result as a personal style rule.
7. The next recommendation is not just better scored; it is better positioned in the user's style
   evolution.

This is the "twist at the end":

> Fitted can follow closet apps, AI stylists, Pinterest, Spotify, and human stylists, but the final
> product should feel like none of them. It should feel like a private style memory that helps the
> user become more fluent with their own taste.

#### North-star product shape

If ambition is not constrained to the next sprint, the north-star app could be:

> A personal style lab where boards, wardrobe items, routines, and feedback become evolving style
> lanes.

Main tabs/modes could eventually be:

- **Today** - context-aware outfit suggestions and quick upgrades.
- **Boards** - executable StyleProfiles from boards, phrases, references, seasons.
- **Rescue** - hard-to-style and ignored-item workflows.
- **Debugger** - diagnoses why outfits, boards, or recommendations are failing.
- **Lanes** - school/work/weekend/seasonal/experimental versions of the user.
- **Progress** - recap, no-buy wins, rescued items, bridge plan.

This is intentionally ambitious. It should not all enter v1.2. But the spec should avoid choices
that make this product shape impossible later.

#### Minimum version that preserves ambition

The smallest next spec pivot that still carries the ambition:

1. Add `RequestIntent`:
   - `daily_outfit`
   - `outfit_upgrade`
   - `rescue_item`
   - `translate_style`

2. Add `VariantRole`:
   - `safe`
   - `noticeable`
   - `bold`
   - possibly `closest` / `wearable` / `stretch` for board translation.

3. Add `StyleMove` to recommendation output:
   - move type;
   - affected slots/items;
   - short explanation;
   - matched style traits;
   - missing/substituted traits.

4. Add `StyleProfileSnapshot`:
   - user-declared style words;
   - active board/profile id;
   - target traits;
   - constraints;
   - confidence/reviewed flags.

5. Add scoped feedback:
   - `wear_it`
   - `too_boring`
   - `too_much`
   - `not_practical`
   - `wrong_context`
   - `not_me`
   - apply scope: outfit only / board-lane / global.

6. Keep CV/ingestion as substrate:
   - better item traits matter;
   - async queue matters;
   - but ingestion is not the emotional hook.

7. Keep M1-3 unblocked:
   - the sampler seam can stay additive;
   - the ambitious fields can be request/ranking/output/interaction-log additions later;
   - do not pause substrate work while the product thesis is being reviewed.

#### What to explicitly avoid

Avoid copying competitors at the wrong layer:

- Do not make "AI outfit every day" the whole promise.
- Do not make "upload your closet" the whole promise.
- Do not make "virtual try-on" the whole promise.
- Do not make "style stats" the whole promise.
- Do not make "mood boards" the whole promise.
- Do not make "shopping gaps" the whole promise.

Any of those can exist, but only as parts of the deeper promise:

> Fitted helps the user turn owned clothes and aspirational taste into wearable personal progress.

#### Hard critique of this ambition

This direction is more exciting, but it has real failure modes:

1. **Too abstract**
   - "Style evolution" can become vague unless every interaction returns concrete outfits.
   - Guardrail: every ambitious concept must produce an outfit, a `StyleMove`, or a stored scoped
     learning.

2. **Too much memory before enough usage**
   - New users will not have enough feedback for rich lanes.
   - Guardrail: start with declared profiles/boards and explicit feedback; infer later.

3. **Too much product surface**
   - Today, Boards, Rescue, Debugger, Lanes, Progress is too much for v1.
   - Guardrail: implement one loop first: `outfit -> safe/noticeable/bold -> StyleMove -> scoped
     feedback`.

4. **Fashion taxonomy brittleness**
   - The app can sound dumb if it relies on universal rules.
   - Guardrail: phrase style as contextual relationship and user preference, not objective law.

5. **AI bossiness**
   - Users may reject an app that tells them who they are.
   - Guardrail: let users edit profiles, choose scope, reject inferences, and keep exploration open.

6. **Competitor gravity**
   - Big apps can copy visible features.
   - Guardrail: the visible feature is not the moat; the moat is the accumulated scoped style memory
     and the product taste around agency.

#### Best phrasing for Claude discussion

Use this line to describe the ambition:

> Fitted should follow the proven path of digital closets, AI stylists, mood boards, personalization,
> and progress systems, but the twist is that all of those patterns serve executable style memory:
> helping the user become more fluent at dressing like themselves with the clothes they already own.

Possible spec-level one-liner:

> v1.2 should preserve the current sampler/ranker substrate while adding enough intent, variant,
> StyleMove, StyleProfileSnapshot, and scoped-feedback structure to support executable style memory
> later.


## C.9 Final expanded-story packet note

_Source: `docs/CODEX_HANDOFF.md` lines 4258-4312._
_Why preserved: Preserves the final summary of what the expanded multi-agent pass added._

#### Finalized expanded user-story packet note

After Brian asked for a heavier user-story pass, Codex ran an expanded multi-agent workshop across:

- first-week onboarding / cold start;
- rushed morning campus/work use;
- moodboard, identity, and seasonal board lifecycle;
- routine, calendar, and trip planning;
- graph/web visualization and closet understanding;
- feedback semantics and edge confidence;
- weather, laundry, comfort, and messy real-life anomalies;
- power-user graph controls;
- no-buy / gap diagnosis / trapped closet value;
- social confidence and fear of trying too hard;
- skeptical failure modes and product safeguards;
- explainability, provenance, and trust.

The standalone packet was rewritten as the cleaner source of truth for this brainstorm:

- `docs/CODEX_USER_STORIES.md`

Key additions from the expanded pass:

- planning/trip stories distinguish `planned`, `packed`, and `worn`;
- no-buy stories frame gaps as diagnosis-only unless the user asks for shopping help;
- messy-life stories distinguish preference from necessity, availability, weather, comfort, and
  forced outfits;
- social-risk stories make `safe / noticeable / bold` a user-facing confidence language,
  `anchor / bridge / experiment` a graph-role language, and `reliable / bridge / stretch` an
  option-path language;
- power-user stories add date-range quarantine, pending graph-change review, edge reason edits,
  board branches, and exception promotion;
- safeguard stories call out privacy, modesty/cultural constraints, body-sensitive language, bad CV
  traits, sparse closets, and avoiding overconfident fashion claims;
- explainability stories require edge provenance, repeated-outfit explanations, dormancy reasons,
  and "right outfit, wrong board/routine" corrections.

Vocabulary normalization from the final packet:

- user-facing board object: `Board`;
- internal compiled board/style state: `StyleProfile` / `StyleProfileSnapshot`;
- active product lens: `Board/StyleProfileSnapshot + Routine + current constraints`;
- graph role: `anchor / bridge / experiment`;
- user-facing option path: `reliable / bridge / stretch`;
- social-risk label: `safe / noticeable / bold`;
- board-translation label, when needed: `closest / wearable / stretch`;
- explicit learning events: `saved`, `planned`, `packed`, `worn`, `rated`, `corrected`;
- ratings/reasons are separate from events: `good`, `neutral`, `bad`, `too_boring`, `too_much`,
  `not_practical`, `not_me`, `wrong_context`, `weather_forced`, `necessity`, `too_repetitive`.

Most important synthesis:

> Fitted should learn from explicit events (`saved`, `planned`, `packed`, `worn`, `rated`,
> `corrected`) and scoped context, not from silence. The style graph should remember useful edges
> without letting old positives saturate recommendations or noisy life periods rewrite a board.
