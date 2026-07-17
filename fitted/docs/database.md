> **DEPLOYED-SCHEMA REFERENCE, NOT V2 DIRECTION.** This describes the current/legacy Mongo shape.
> For future v2 data-model targets, use `../../docs/Fitted_Spec_v2.md`. For exact current behavior,
> prefer the model source files in `../models/`.

# Database design

MongoDB + Mongoose back the data layer. Connect with `initDatabase()` from `@/lib/db`, which opens the client and registers indexes.

## Environment
- `MONGODB_URI` – full connection string (place in `.env.local` for Next.js).

## Collections

### User (`models/User.ts`)
- Identity: `authProvider`, `authId` (unique pair), `email` (unique).
- Profile: `displayName`, `photoURL`.
- `metadata`: optional free-form map for future attributes.

Indexes:
- `{ authProvider: 1, authId: 1 }` unique for auth lookup.
- `{ email: 1 }` unique for email-based queries.

### WardrobeItem (`models/WardrobeItem.ts`)
- Scope: required `user` reference so every item belongs to one user.
- Engine fields: `clothingType` (`top`/`bottom`/`dress`/`outer_layer`/`shoes`) and required `warmth` (0-10).
- Description: `name`, `category`, `subCategory`, `pattern`, `colors`, `seasons`, `occasions`, `layerRole`, `brand`, `fit`, `size`, `imageUrl`, `imagePath`, `tags`, `notes`, `isAvailable`, `isFavorite`, `lastWornAt`, `metadata`.

Indexes:
- `{ user: 1, category: 1 }` — common browse/filter by category within a user.
- `{ user: 1, tags: 1 }` — tag filters.
- `{ user: 1, isFavorite: 1 }` — favorites.
- `{ user: 1, updatedAt: -1 }` — recency for feeds/history.

### OutfitInteraction (`models/OutfitInteraction.ts`)
- Scope: required `user` plus `items` array of wardrobe item ids.
- Action: `action` enum (`generated`, `accepted`, `rejected`, `saved`, `worn`, `rated`, `planned`, `packed`, `corrected`), optional `rating`/`feedback`.
- Context: weather, temp, location, occasion, notes.
- Feedback: per-item feedback, the M5 structured "why" (`feedbackReason`: closed `codes` from `FEEDBACK_REASON_CODES` + bounded `rawText`), and the M4 nullable snapshot-binding fields (`snapshotId`, `candidateId`, `baseKey`, `fullSignature`). (`inferredWhy` is a dormant legacy column — its Gemini write-back was removed at M5; do not treat it as populated.)
- Learning scope: optional `scopeTarget` and `learningDisposition`; behavior is wired later.

Indexes:
- `{ user: 1, createdAt: -1, _id: -1 }` — timelines per user; the `_id` tie-break makes same-millisecond feedback ordering deterministic (load-bearing for the §H reducer's most-recent-first scan).
- `{ user: 1, items: 1 }` — quickly aggregate feedback for an item set.
- `{ snapshotId: 1, candidateId: 1 }` — snapshot-bound feedback joins.

### WardrobeImage (`models/WardrobeImage.ts`)
- Scope: required `user` and `wardrobeItem` references.
- Payload: `base64`, `contentType`, `sizeBytes`. `WardrobeItem.imagePath` points at the document as `mongo:<id>`.

Indexes:
- `{ user: 1, wardrobeItem: 1 }` — lookup and cleanup for a user's item image.

### GenerationSnapshot (`models/GenerationSnapshot.ts`)
- Scope: immutable M4b training-truth record, dormant until M5 writes it.
- Captures resolved lens inputs, version/provenance, item snapshots, the full candidate funnel, scores, and shown-candidate bindings.
- Mutable only through the reserved redaction fields (`redacted`, `redactedAt`, `redactionReason`).

## User association guarantee
Wardrobe items, wardrobe images, outfit interactions, and live GenerationSnapshots require a `user` reference. Queries should always be scoped with `user` to ensure data isolation per account.

## Access control helpers (`lib/db.ts`)
Use these helpers instead of raw queries to ensure users only access their own data:

- `getUserWardrobeItems(userId)` – get all items for a user
- `getUserWardrobeItem(userId, itemId)` – get one item only if owned by user
- `getUserOutfitInteractions(userId)` – get all interactions for a user

## Cascade delete
When a user is deleted via `User.deleteOne()` or `User.findOneAndDelete()`, Mongoose middleware automatically removes their wardrobe items, outfit interactions, wardrobe image documents, AND generation snapshots (account deletion is erasure — docs/Fitted_Spec_v2.md §23-H43). Use `deleteUserWithData(userId)` from `lib/db.ts` for a clean helper.

## Extensibility
`metadata` fields in each collection allow adding new attributes later (e.g., ML outputs, stats) without breaking existing data. Add indexes as new query patterns emerge.
