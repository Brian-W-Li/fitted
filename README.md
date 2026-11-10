# Fitted

Fitted aims to make personal styling convenient: usable outfits from owned clothes,
meaningful personal-taste learning, and quick visual choices for real daily life.
The current app supplies wardrobe-grounded suggestions, planning and correctable
wear memory; it has not yet demonstrated personal-taste learning.

Read [the spec's ambition](docs/Fitted_Spec_v2.md#1-vision--the-green-shirt-promise)
and [the complete user stories](docs/Fitted_Spec_v2_recovered_appendix.md#c1-detailed-user-stories-decisions-and-spec-implications)
for the destination. [The documentation map](docs/README.md) identifies owners;
[the roadmap](docs/ROADMAP.md) records current work and the release boundary.
Agent execution uses [AGENTS.md](AGENTS.md). The Next.js app is in `fitted/`; the
Python engine and service are in `ml-system/`.

The application source includes owned-item rescue, saved proposals, same-situation
exploration, weather and removable-layer context, dated plans, explicit wear memory,
correction and retraction. Suggestions, plans, reactions and actual wear remain
separate records. One explicitly marked mid-layer may accompany a base tee/shirt;
a sweater may also be the sole top. S1 forwards declared pattern and fit to the
stylist and captured inputs, without guessing missing detail or changing ranking
weights. Account deletion fences new owned writes and supports manual
recovery for interrupted cleanup. Wardrobe clear reports acknowledged deletion,
partial photo cleanup or an uncertain result and reloads the current closet.

The [hosted app](https://fitted-three.vercel.app) release evidence is recorded in
[PR #2](https://github.com/Brian-W-Li/fitted/pull/2). Local candidates and their
limits live in the roadmap. Source/tests establish behavior; future design is not
a shipped claim. A trained head has no production ranking vote. The public source
excludes participant ledgers, private wardrobe cases and private branch ancestry.

For interrupted account deletion, [the manual recovery contract](docs/Fitted_Spec_v2.md#151-generationsnapshot--the-contract-next) and its linked script govern operator retry.

## Run locally

Use Node 24 (`fitted/.nvmrc`), Firebase configuration and transaction-capable MongoDB.
Copy `fitted/.env.sample` to `fitted/.env.local` and supply your own configuration.
Production identity admission needs existing unique Firebase-identity/email indexes;
snapshot admission needs its partial unique user/requestId index. Unsupported
storage fails closed. The Python service holds the model API key; never commit keys.

```sh
cd fitted
npm ci
npm run dev
npm test
npx tsc --noEmit
npm run lint
npm run build
```

The declared build uses Webpack. `npm run baseline:browser:production` builds and
starts with native `require(ESM)` disabled, isolated synthetic Mongo, Firebase Auth
emulator and a deterministic Python
stylist, then exercises the authenticated browser loop, photos and account deletion.
Add `-- --feedback-only` to that command for the scoped-feedback journey using the
same compiled app and isolated services. The server needs Fitted’s Python environment
on PATH when this worktree has no local `.venv`.
It makes no real model calls and proves neither hosted OAuth nor dressing benefit.
The development runner remains available as `npm run baseline:browser`.

```sh
cd ml-system
python -m pytest tests service/tests -q
```

Runtime updates retain a documented audit exception: Firebase's installed Firestore
package pins an older grpc-js, while this app imports App/Auth and Admin App/Auth
only and runs no gRPC server. The relevant
[authentication advisory](https://github.com/advisories/GHSA-m9gg-hp2v-232j) and
[handler-error advisory](https://github.com/advisories/GHSA-f596-whhp-79r4) concern
gRPC server APIs. This is a code-applicability exception, not a clean npm audit.
Development-tool maintenance remains deferred; this checkpoint does not claim a clean
dependency audit. The [current roadmap](docs/ROADMAP.md) owns remaining readiness work.
The ordinary web client deadline is 45 seconds; its synthetic failure regression
checks honest degradation without saving a proposal or mutating the closet.
Hosted budgets and provider cancellation remain separate checks.

Originally a UCSB CS 148 team project; contributors remain in Git history.
Code is licensed under MIT.
