/**
 * In-memory Mongo harness — the first brick of the C5 test pyramid (docs/plans/post-m5-reset.md
 * R2). The pre-C5 suite is entirely `validateSync()` (shape-only, no DB), which cannot catch a
 * strict-mode field-strip on `.create()` — the exact defect class that hid D-1/D-2
 * (m5-cutover.md §J). This harness stands up a REAL mongod (mongodb-memory-server) and connects
 * mongoose to it, so a test can write a document and READ IT BACK, observing what actually
 * persists rather than what the schema claims to accept.
 *
 * NOT a `*.test.ts` file, so jest never runs it as a suite — it is imported by round-trip tests.
 *
 * Usage:
 *   let harness: MongoHarness;
 *   beforeAll(async () => { harness = await startMemoryMongo([GenerationSnapshot]); });
 *   afterAll(async () => { await harness.stop(); });
 *   afterEach(async () => { await harness.clear(); });
 */
import mongoose, { type Model } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";

export interface MongoHarness {
  /** The running in-memory server (exposed for advanced cases; most tests only need clear/stop). */
  server: MongoMemoryServer;
  /** Drop every document in every collection — call in afterEach for per-test isolation. */
  clear: () => Promise<void>;
  /** Disconnect mongoose + stop the server — call in afterAll. */
  stop: () => Promise<void>;
}

/**
 * Boot an in-memory mongod, connect the default mongoose connection to it, and build the
 * indexes for the given models (via `Model.init()`, matching `lib/db.ts`). Index builds are
 * required for the §C.4 partial-unique-index / `E11000` idempotency tests to be real.
 */
export async function startMemoryMongo(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  models: Model<any>[] = [],
): Promise<MongoHarness> {
  const server = await MongoMemoryServer.create();
  await mongoose.connect(server.getUri());
  // Build declared indexes against the (empty) DB, same mechanism as lib/db.ts initDatabase().
  await Promise.all(models.map((m) => m.init()));

  return {
    server,
    async clear() {
      const { collections } = mongoose.connection;
      await Promise.all(Object.values(collections).map((c) => c.deleteMany({})));
    },
    async stop() {
      await mongoose.disconnect();
      await server.stop();
    },
  };
}
