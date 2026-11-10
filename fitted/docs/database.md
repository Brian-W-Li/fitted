# Database source map

This is a navigation guide, not a second schema specification. Models and storage helpers establish current behavior; [spec §§6/15/16](../../docs/Fitted_Spec_v2.md#6-data-model) own design/lifecycle contracts. [Root setup](../../README.md#run-locally) owns environment prerequisites.

## Connection and admission

[initDatabase](../lib/db.ts) connects and initializes registered models. Production automatic index creation is disabled; admission verifies required existing indexes rather than creating them. Identity/snapshot admission and owned writes require the appropriate indexes and transaction-capable MongoDB. Use the [connection configuration](../lib/mongodb.ts), [identity admission](../lib/identityAdmission.ts) and root setup for the executable boundary.

## Storage owners

| Record | Source owner | Meaning |
|---|---|---|
| Identity, profile and plans | [User](../models/User.ts), [planning store](../lib/outfitPlanning/store.ts) | Plans are dated intent references, not reported wear. |
| Current wardrobe | [WardrobeItem](../models/WardrobeItem.ts) | Owned garment facts, availability and image references. |
| Owned images | [WardrobeImage](../models/WardrobeImage.ts) | Primary/supplemental images; captured source-photo retention is a separate lifecycle. |
| Shown-generation evidence | [GenerationSnapshot](../models/GenerationSnapshot.ts) | Live immutable captured inputs/funnel/shown identity with sanctioned redaction; it is not dormant. |
| Reactions | [OutfitInteraction](../models/OutfitInteraction.ts), [interaction handlers](../lib/interactions.ts) | Snapshot-bound accepted/rejected proxies; unused enum/scope fields do not imply implemented learning. |
| Actual wear | [OutfitExperience](../models/OutfitExperience.ts), [experience contract](../lib/outfitExperience/contract.ts), [store](../lib/outfitExperience/store.ts) | Separate confirmed composition, context, revisions and optional outcome; not a like or a plan. |

## Ownership and deletion

Scope reads and writes to the authenticated owner and validate referenced-source ownership. Account erasure fences in-flight writes and sweeps registered owned content; plans disappear with their owner. [User cascade](../models/User.ts), [account handler](../app/api/account/route.ts) and [erasure recovery](../lib/resumeUserErasure.ts) own that implementation. Do not replace the account route with a raw model delete and assume it proves the same concurrent-write/Firebase guarantees. [Manual recovery](../../docs/Fitted_Spec_v2.md#151-generationsnapshot--the-contract-next) resumes a deletion already requested. Item removal, wardrobe clearing, experience removal and account erasure have distinct semantics; use their governing helpers and tests.
