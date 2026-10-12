# Fitted

Fitted builds outfit suggestions from clothes a person owns, then helps them return
to a suggestion, adapt it to another situation, plan a look and record what they
actually wore. The Next.js app is in `fitted/`; the Python engine and render service
are in `ml-system/`.

The application source includes owned-item rescue, saved proposals, same-situation
exploration, weather and removable-layer context, dated plans, explicit wear memory,
correction and retraction. Suggestions, plans, reactions and actual wear remain
separate records. Account deletion fences new owned writes and supports manual
recovery for interrupted cleanup. Wardrobe clear reports acknowledged deletion,
partial photo cleanup or an uncertain result and reloads the current closet.

The [hosted app](https://fitted-three.vercel.app) was updated on 2026-10-11 from
source commit `fe8618eed`. Release checks verified retained Firebase sign-in/session
admission, owned photos, one ordinary-deadline recommendation and exact saved
proposal return. Wear/planning/photo mutations, owner denial and account deletion
pass the compiled synthetic journey; hosted destructive lifecycle tests were not
run. No repeated
personal benefit or learned-model improvement is claimed. A trained head has no
production ranking vote. The historical design documents describe earlier work;
source and executable tests establish current behavior. This source import omits the local participant ledgers and wardrobe walkthrough,
and does not include the local private branch history.

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
The ordinary web client deadline is 45 seconds; its synthetic failure regression
checks honest degradation without saving a proposal or mutating the closet.
Hosted budgets and provider cancellation remain separate checks.

Originally a UCSB CS 148 team project; contributors remain in Git history.
Licensed under MIT.
