/**
 * C4 migration behavioral test (clothingtype-slot-correctness §6) — exercises the REAL
 * collectDiffs/applyDiff units from scripts/migrate-clothingtype.ts over a real in-memory mongod
 * (no re-implemented cascade — the mirror-drift ban). The seeded shapes mirror the live corpus:
 * the Zhiyun suit-dress row stores the OLD classifier's "dress" over category=bottom/sub=skirt.
 */
import mongoose from "mongoose";
import { startMemoryMongo, type MongoHarness } from "./helpers/mongoHarness";
import WardrobeItem from "@/models/WardrobeItem";
import { collectDiffs, applyDiff, type WardrobeRowLean } from "../scripts/migrate-clothingtype";

let harness: MongoHarness;
const userId = new mongoose.Types.ObjectId();

beforeAll(async () => {
  harness = await startMemoryMongo([WardrobeItem]);
});
afterAll(async () => {
  await harness.stop();
});
afterEach(async () => {
  await harness.clear();
});

async function seedCloset() {
  const mk = (over: Record<string, unknown>) => ({
    user: userId,
    warmth: 5,
    colors: [],
    occasions: [],
    isAvailable: true,
    ...over,
  });
  // The live Zhiyun closet shape (plan §1): one mis-slotted row, everything else correct.
  const suitDress = await WardrobeItem.create(
    mk({ name: "suit dress", category: "bottom", subCategory: "skirt", clothingType: "dress" }),
  );
  const shirt = await WardrobeItem.create(
    mk({ name: "plaid shirt", category: "top", subCategory: "shirt", clothingType: "top" }),
  );
  const blazer = await WardrobeItem.create(
    mk({ name: "blazer", category: "top", subCategory: "coat", clothingType: "outer_layer" }),
  );
  const dress = await WardrobeItem.create(
    mk({ name: "dress", category: "one piece", clothingType: "dress" }),
  );
  return { suitDress, shirt, blazer, dress };
}

async function fetchLean(): Promise<WardrobeRowLean[]> {
  return WardrobeItem.find({})
    .select("user name category subCategory layerRole clothingType")
    .lean<WardrobeRowLean[]>()
    .exec();
}

describe("migrate-clothingtype — collectDiffs (the read-only diff)", () => {
  it("flags exactly the mis-slotted row on the live-corpus closet shape (zero collateral)", async () => {
    const { suitDress } = await seedCloset();
    const diffs = collectDiffs(await fetchLean());
    expect(diffs).toHaveLength(1);
    expect(diffs[0]).toMatchObject({
      id: suitDress._id.toString(),
      name: "suit dress",
      stored: "dress",
      derived: "bottom",
    });
  });
});

describe("migrate-clothingtype — applyDiff (the guarded targeted write)", () => {
  it("PATCHes clothingType only, leaves every other row + field untouched, and is idempotent", async () => {
    const { suitDress, blazer } = await seedCloset();
    const before = await WardrobeItem.findById(suitDress._id).lean<Record<string, unknown>>();

    const diffs = collectDiffs(await fetchLean());
    expect(await applyDiff(WardrobeItem, diffs[0])).toBe(true);

    const after = await WardrobeItem.findById(suitDress._id).lean<Record<string, unknown>>();
    expect(after!.clothingType).toBe("bottom");
    // clothingType is the ONLY field the migration may touch.
    expect(after!.name).toBe(before!.name);
    expect(after!.category).toBe(before!.category);
    expect(after!.subCategory).toBe(before!.subCategory);
    expect(after!.warmth).toBe(before!.warmth);
    // collateral check: an untouched row keeps its value.
    expect((await WardrobeItem.findById(blazer._id).lean<Record<string, unknown>>())!.clothingType).toBe(
      "outer_layer",
    );
    // idempotence: a re-scan after the migration finds nothing left to fix.
    expect(collectDiffs(await fetchLean())).toHaveLength(0);
  });

  it("optimistic guard: a row edited between scan and write is SKIPPED, never clobbered", async () => {
    const { suitDress } = await seedCloset();
    const diffs = collectDiffs(await fetchLean());
    // A friend's edit lands mid-migration (e.g. they corrected it to bottom themselves).
    await WardrobeItem.updateOne({ _id: suitDress._id }, { $set: { clothingType: "bottom" } });
    expect(await applyDiff(WardrobeItem, diffs[0])).toBe(false);
    expect(
      (await WardrobeItem.findById(suitDress._id).lean<Record<string, unknown>>())!.clothingType,
    ).toBe("bottom");
  });
});
