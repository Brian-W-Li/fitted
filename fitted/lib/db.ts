import { Types } from "mongoose";
import { connectMongo } from "@/lib/mongodb";
import OutfitInteraction from "@/models/OutfitInteraction";
import User from "@/models/User";
import WardrobeItem from "@/models/WardrobeItem";
import WardrobeImage from "@/models/WardrobeImage";
import PreferenceSummary from "@/models/PreferenceSummary";

/**
 * Connects to MongoDB and ensures indexes are registered.
 * Use this helper in API routes or server actions before DB work.
 */
export async function initDatabase() {
  await connectMongo();
  await Promise.all([
    User.init(),
    WardrobeItem.init(),
    OutfitInteraction.init(),
    WardrobeImage.init(),
    PreferenceSummary.init(),
  ]);

  return { User, WardrobeItem, OutfitInteraction, WardrobeImage, PreferenceSummary };
}

export type DatabaseModels = Awaited<ReturnType<typeof initDatabase>>;

// ---------------------------------------------------------------------------
// User-scoped query helpers (enforce access control)
// ---------------------------------------------------------------------------

type UserId = Types.ObjectId | string;

/**
 * Get all wardrobe items for a specific user.
 * Always use this instead of WardrobeItem.find() directly.
 */
export function getUserWardrobeItems(userId: UserId) {
  return WardrobeItem.find({ user: userId });
}

/**
 * Get a single wardrobe item only if it belongs to the user.
 * Returns null if not found or not owned by the user.
 */
export function getUserWardrobeItem(userId: UserId, itemId: UserId) {
  return WardrobeItem.findOne({ _id: itemId, user: userId });
}

/**
 * Get all outfit interactions for a specific user.
 */
export function getUserOutfitInteractions(userId: UserId) {
  return OutfitInteraction.find({ user: userId });
}

/**
 * Delete a user and all their associated data (wardrobe items, interactions).
 * Uses the cascade delete middleware defined on User schema.
 */
export async function deleteUserWithData(userId: UserId) {
  await initDatabase();
  const result = await User.deleteOne({ _id: userId });
  return result.deletedCount > 0;
}
