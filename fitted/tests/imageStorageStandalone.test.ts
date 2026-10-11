import { startMemoryMongo, type MongoHarness } from "./helpers/mongoHarness";
import User from "@/models/User";
import WardrobeImage from "@/models/WardrobeImage";
import { Types } from "mongoose";
import { uploadWardrobeImage } from "@/lib/imageStorage";
jest.mock("@/lib/db", () => ({ initDatabase: jest.fn() }));
let harness: MongoHarness;
beforeAll(async () => { harness = await startMemoryMongo([User, WardrobeImage]); }, 120_000);
afterAll(async () => { await harness.stop(); });
it("rejects a standalone Mongo deployment without an unsafe fallback or stored bytes", async () => {
  jest.requireMock("@/lib/db").initDatabase.mockResolvedValue({ User, WardrobeImage });
  const owner = await User.create({ authId: "owner", email: "owner@example.test" });
  await expect(uploadWardrobeImage({ userId: String(owner._id), wardrobeItemId: String(new Types.ObjectId()), bytes: Buffer.from("89504e470d0a1a0a", "hex"), contentType: "image/png" })).rejects.toThrow(/Transaction numbers/);
  expect(await WardrobeImage.countDocuments({})).toBe(0);
  expect((await User.findById(owner._id).select("+imageWriteVersion")).imageWriteVersion).toBeUndefined();
});
