import mongoose from "mongoose";

/**
 * Re-use the existing Mongoose connection across hot reloads
 * to avoid creating multiple connections in dev/serverless.
 */
let cached = (global as unknown as { mongoose?: { conn: typeof mongoose | null; promise: Promise<typeof mongoose> | null } }).mongoose;

if (!cached) {
  cached = (global as unknown as { mongoose?: { conn: typeof mongoose | null; promise: Promise<typeof mongoose> | null } }).mongoose = {
    conn: null,
    promise: null,
  };
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
      autoIndex: true,
      maxPoolSize: 5,
    });
  }

  cached.conn = await cached.promise;
  return cached.conn;
}
