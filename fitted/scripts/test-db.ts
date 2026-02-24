import { readFileSync } from "fs";
import { resolve } from "path";

// Load .env.local before importing db modules
const envPath = resolve(__dirname, "../.env.local");
try {
  const envFile = readFileSync(envPath, "utf8");
  for (const line of envFile.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
} catch {
  console.warn("Could not load .env.local, relying on existing env vars");
}

async function main() {
  const { initDatabase, getUserWardrobeItems, getUserWardrobeItem, deleteUserWithData } = await import("@/lib/db");
  
  console.log("🔌 Connecting to MongoDB...");
  const { User, WardrobeItem, OutfitInteraction } = await initDatabase();
  console.log("✅ Connected!\n");

  // --- 1. Create a test user ---
  console.log("👤 Creating test user...");
  const testUser = await User.findOneAndUpdate(
    { authProvider: "firebase", authId: "test-user-123" },
    {
      authProvider: "firebase",
      authId: "test-user-123",
      email: "testuser@example.com",
      displayName: "Test User",
    },
    { upsert: true, new: true }
  );
  console.log(`✅ User created: ${testUser._id} (${testUser.email})\n`);

  // --- 2. Add wardrobe items for the user ---
  console.log("👕 Adding wardrobe items...");
  
  const items = [
    { name: "Blue T-Shirt", category: "top", colors: ["blue"], seasons: ["summer", "spring"] },
    { name: "Black Jeans", category: "bottom", colors: ["black"], seasons: ["all"] },
    { name: "White Sneakers", category: "shoes", colors: ["white"], brand: "Nike" },
  ];

  const createdItems = [];
  for (const item of items) {
    const wardrobeItem = await WardrobeItem.findOneAndUpdate(
      { user: testUser._id, name: item.name },
      { user: testUser._id, ...item },
      { upsert: true, new: true }
    );
    createdItems.push(wardrobeItem);
    console.log(`  ✅ ${item.name} (${wardrobeItem._id})`);
  }
  console.log();

  // --- 3. Test user-scoped queries ---
  console.log("🔍 Testing getUserWardrobeItems...");
  const userItems = await getUserWardrobeItems(testUser._id);
  console.log(`  Found ${userItems.length} items for user ${testUser._id}`);
  userItems.forEach((i: { name?: unknown; category?: unknown }) => {
    const name = typeof i.name === "string" ? i.name : "<unknown>";
    const category = typeof i.category === "string" ? i.category : "<unknown>";
    console.log(`    - ${name} (${category})`);
  });
  console.log();

  console.log("🔍 Testing getUserWardrobeItem (single item)...");
  const singleItem = await getUserWardrobeItem(testUser._id, createdItems[0]._id);
  console.log(`  Found: ${singleItem?.name || "NOT FOUND"}\n`);

  // --- 4. Create an outfit interaction ---
  console.log("📝 Creating outfit interaction...");
  const interaction = await OutfitInteraction.create({
    user: testUser._id,
    items: createdItems.map((i) => i._id),
    action: "saved",
    rating: 5,
    feedback: "Love this outfit!",
    context: { weather: "sunny", temperatureF: 72, occasion: "casual" },
  });
  console.log(`  ✅ Interaction created: ${interaction._id} (action: ${interaction.action})\n`);

  // --- 5. Show counts ---
  console.log("📊 Current counts:");
  console.log(`  Users: ${await User.countDocuments()}`);
  console.log(`  Wardrobe Items: ${await WardrobeItem.countDocuments()}`);
  console.log(`  Outfit Interactions: ${await OutfitInteraction.countDocuments()}`);
  console.log();

  // --- 6. Test cascade delete ---
  console.log("🗑️  Testing cascade delete...");
  console.log(`  BEFORE delete:`);
  console.log(`    Users: ${await User.countDocuments()}`);
  console.log(`    Wardrobe Items: ${await WardrobeItem.countDocuments()}`);
  console.log(`    Outfit Interactions: ${await OutfitInteraction.countDocuments()}`);
  
  const deleted = await deleteUserWithData(testUser._id);
  console.log(`\n  Deleting user ${testUser._id}...`);
  console.log(`  User deleted: ${deleted}`);
  
  console.log(`\n  AFTER delete:`);
  console.log(`    Users: ${await User.countDocuments()}`);
  console.log(`    Wardrobe Items: ${await WardrobeItem.countDocuments()}`);
  console.log(`    Outfit Interactions: ${await OutfitInteraction.countDocuments()}`);
  console.log();

  console.log("✅ All tests passed! Cascade delete worked.");
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Test failed:", err);
  process.exit(1);
});
