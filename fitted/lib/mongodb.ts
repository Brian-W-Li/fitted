import mongoose from "mongoose";

/**
 * Re-use the existing Mongoose connection across hot reloads
 * to avoid creating multiple connections in dev/serverless.
 */
type MongoCache = {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
};

const globalForMongo = globalThis as unknown as { mongoose?: MongoCache };
const cached: MongoCache = globalForMongo.mongoose ?? {
  conn: null,
  promise: null,
};
if (!globalForMongo.mongoose) {
  globalForMongo.mongoose = cached;
}

export async function connectMongo(): Promise<typeof mongoose> {
  if (cached.conn) return cached.conn;

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error(
      "Missing MONGODB_URI. Add it to your environment (e.g. .env.local).",
    );
  }

  if (!cached.promise) {
    cached.promise = mongoose.connect(uri, {
      // autoIndex ON in dev/test (auto-builds indexes on a fresh DB, incl. the in-memory test Mongo),
      // OFF in production: with autoIndex on, every COLD serverless instance re-synchronizes all
      // models' indexes against the (slow, free-tier M0) DB before serving its first request — a real
      // cold-start tax on a sole-user deployment. Prod indexes are already built out-of-band; a NEW
      // index (schema change) now requires a one-time manual build in prod.
      autoIndex: process.env.NODE_ENV !== "production",
      maxPoolSize: 5,
    });
  }

  cached.conn = await cached.promise;
  return cached.conn;
}
