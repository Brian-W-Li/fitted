import { connectMongo } from "@/lib/mongodb";
import OutfitInteraction from "@/models/OutfitInteraction";
import User from "@/models/User";
import WardrobeItem from "@/models/WardrobeItem";
import WardrobeImage from "@/models/WardrobeImage";

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
  ]);

  return { User, WardrobeItem, OutfitInteraction, WardrobeImage};
}

export type DatabaseModels = Awaited<ReturnType<typeof initDatabase>>;
