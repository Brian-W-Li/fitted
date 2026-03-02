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
- Description: `name`, `category`, `subCategory`, `colors`, `seasons`, `occasions`, `brand`, `fit`, `size`, `imageUrl`, `imagePath`, `tags`, `notes`, `isFavorite`, `lastWornAt`, `metadata`.

Indexes:
- `{ user: 1, category: 1 }` — common browse/filter by category within a user.
- `{ user: 1, tags: 1 }` — tag filters.
- `{ user: 1, isFavorite: 1 }` — favorites.
- `{ user: 1, updatedAt: -1 }` — recency for feeds/history.

### OutfitInteraction (`models/OutfitInteraction.ts`)
- Scope: required `user` plus `items` array of wardrobe item ids.
- Action: `action` enum (`generated`, `accepted`, `rejected`, `saved`, `worn`, `rated`), optional `rating`/`feedback`.
- Context: weather, temp, location, occasion, `metadata`.

Indexes:
- `{ user: 1, createdAt: -1 }` — timelines per user.
- `{ user: 1, items: 1 }` — quickly aggregate feedback for an item set.

## User association guarantee
Wardrobe items and outfit interactions require a `user` reference. Queries should always be scoped with `user` to ensure data isolation per account.

## Access control helpers (`lib/db.ts`)
Use these helpers instead of raw queries to ensure users only access their own data:

- `getUserWardrobeItems(userId)` – get all items for a user
- `getUserWardrobeItem(userId, itemId)` – get one item only if owned by user
- `getUserOutfitInteractions(userId)` – get all interactions for a user

## Cascade delete
When a user is deleted via `User.deleteOne()` or `User.findOneAndDelete()`, Mongoose middleware automatically removes all their wardrobe items and outfit interactions. Use `deleteUserWithData(userId)` from `lib/db.ts` for a clean helper.

## Extensibility
`metadata` fields in each collection allow adding new attributes later (e.g., ML outputs, stats) without breaking existing data. Add indexes as new query patterns emerge.
