/**
 * Dev utility — seed a handful of test wardrobe items through the REAL M4 ingestion
 * derivation (`deriveClothingType` + `deriveWarmth`) and the `WardrobeItem` model, so the
 * data path can be exercised against a local Mongo without the browser/auth layer.
 *
 *   npx tsx scripts/seed-test-wardrobe.ts
 *
 * Attaches the items to the first user in the DB (sign in to the app once first).
 * Local-dev only; not part of the app.
 */
import { readFileSync } from "fs";
import { resolve } from "path";
import mongoose from "mongoose";
import { deriveClothingType } from "@/lib/clothingType";
import { deriveWarmth } from "@/lib/deriveWarmth";
import { parseMongoUri, isWipeAllowed } from "@/lib/wipeGuard";
import WardrobeItem from "@/models/WardrobeItem";
import User from "@/models/User";

function loadEnvLocal() {
  try {
    const envFile = readFileSync(resolve(__dirname, "../.env.local"), "utf8");
    for (const line of envFile.split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i === -1) continue;
      if (!process.env[t.slice(0, i).trim()]) process.env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
    }
  } catch {
    /* rely on existing env */
  }
}

const TEST_ITEMS: Array<{
  category: string;
  subCategory?: string;
  name: string;
  seasons?: string[];
  layerRole?: string;
}> = [
  { category: "footwear", subCategory: "dress shoes", name: "Black Oxford Dress Shoes" },
  { category: "one piece", subCategory: "dress", name: "Floral Midi Dress" },
  { category: "top", subCategory: "t-shirt", name: "White Cotton Tee", seasons: ["Summer"] },
  { category: "bottom", subCategory: "jeans", name: "Blue Denim Jeans" },
  { category: "top", subCategory: "sweater", name: "Chunky Wool Sweater", seasons: ["Winter"] },
  { category: "top", name: "Wool Overcoat" },
];

async function main() {
  loadEnvLocal();
  const uri = process.env.MONGODB_URI || "mongodb://localhost:27017/fitted-dev";

  // Safety gate (same host allowlist as scripts/wipe-db.ts): the reused CS148 .env.local
  // may point MONGODB_URI at the SHARED team Atlas cluster. This seed writes test items
  // onto the OLDEST real user, so refuse a non-allowlisted host unless FITTED_ALLOW_WIPE=1.
  const { host } = parseMongoUri(uri);
  if (!isWipeAllowed(host)) {
    console.error(
      `Refusing to seed: MONGODB_URI host "${host}" is not on the localhost/fitted-dev allowlist.\n` +
        `If this really is a throwaway dev DB, re-run with FITTED_ALLOW_WIPE=1.`,
    );
    process.exit(1);
  }

  await mongoose.connect(uri);

  const user = await User.findOne().sort({ createdAt: 1 }).exec();
  if (!user) {
    console.error("No user found — sign in to the app once first so a user exists.");
    await mongoose.disconnect();
    process.exit(1);
  }
  console.log(`Seeding ${TEST_ITEMS.length} items for user ${user._id}\n`);

  for (const it of TEST_ITEMS) {
    const clothingType = deriveClothingType(it);
    const warmth = deriveWarmth(it);
    await WardrobeItem.create({
      user: user._id,
      name: it.name,
      category: it.category,
      subCategory: it.subCategory,
      seasons: it.seasons ?? [],
      clothingType,
      warmth,
      isAvailable: true,
    });
    console.log(`  ${it.name.padEnd(28)} → clothingType=${clothingType.padEnd(11)} warmth=${warmth}`);
  }

  await mongoose.disconnect();
  console.log("\n✅ Seeded.");
  process.exit(0);
}

main().catch(async (err) => {
  console.error("❌ Seed failed:", err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
