import { Types } from "mongoose";
import { unretainedImageFilter } from "@/lib/imageRetention";
import { clearUserWardrobe, type ClearableModels } from "@/lib/clearWardrobe";

type DeleteReceiptStub = { acknowledged: boolean; deletedCount?: number };

function stubModels(deletedCount = 0) {
  const imageId = "a".repeat(24);
  const WardrobeItem = { deleteMany: jest.fn(() => ({ exec: async (): Promise<DeleteReceiptStub> => ({ acknowledged: true, deletedCount }) })), exists: jest.fn(async () => null) };
  const WardrobeImage = {
    distinct: jest.fn(() => ({ exec: async () => [imageId] })),
    exists: jest.fn(async () => ({ _id: imageId })),
    deleteOne: jest.fn(() => ({ exec: async () => ({ deletedCount: 1 }) })),
  };
  const GenerationSnapshot = { exists: jest.fn(() => ({ exec: async () => null })) };
  return { imageId, WardrobeItem, WardrobeImage, GenerationSnapshot,
    models: { WardrobeItem, WardrobeImage, GenerationSnapshot } as unknown as ClearableModels };
}

it("clears owner items and reclaims only settled, inactive, unreferenced bytes", async () => {
  const { models, imageId, WardrobeItem, WardrobeImage } = stubModels(3);
  const user = new Types.ObjectId();
  expect(await clearUserWardrobe(models, user)).toEqual({ deletedCount: 3, itemsCleared: true, cleanupComplete: true });
  expect(WardrobeItem.deleteMany).toHaveBeenCalledWith({ user }, { writeConcern: { w: "majority" } });
  expect(WardrobeImage.distinct).toHaveBeenCalledWith("_id", { user, ...unretainedImageFilter });
  expect(WardrobeImage.deleteOne).toHaveBeenCalledWith({ _id: imageId, user, ...unretainedImageFilter });
});
it("preserves a surviving current garment attachment", async () => {
  const { models, WardrobeItem, WardrobeImage } = stubModels();
  WardrobeItem.exists.mockResolvedValue({ _id: "active" } as never);
  expect(await clearUserWardrobe(models, new Types.ObjectId())).toEqual({ deletedCount: 0, itemsCleared: true, cleanupComplete: true });
  expect(WardrobeImage.deleteOne).not.toHaveBeenCalled();
});
it.each([
  { acknowledged: false, deletedCount: 1 },
  { acknowledged: true },
  { acknowledged: true, deletedCount: -1 },
  { acknowledged: true, deletedCount: Number.NaN },
])("does not sweep photos after an invalid deletion receipt %#", async result => {
  const { models, WardrobeItem, WardrobeImage } = stubModels();
  WardrobeItem.deleteMany.mockImplementationOnce(() => ({ exec: async () => result }));
  await expect(clearUserWardrobe(models, new Types.ObjectId())).rejects.toMatchObject({
    receipt: { deletedCount: null, itemsCleared: null, cleanupComplete: false },
  });
  expect(WardrobeImage.distinct).not.toHaveBeenCalled();
  expect(WardrobeImage.deleteOne).not.toHaveBeenCalled();
});
it("preserves snapshot evidence even for legacy image rows without retention flags", async () => {
  const { models, GenerationSnapshot, WardrobeImage } = stubModels();
  GenerationSnapshot.exists.mockImplementation(() => ({ exec: async () => ({ _id: "snapshot" }) }) as never);
  await clearUserWardrobe(models, new Types.ObjectId());
  expect(WardrobeImage.deleteOne).not.toHaveBeenCalled();
});
it("skips bytes that are still leased before reading active attachments", async () => {
  const { models, WardrobeItem, WardrobeImage } = stubModels();
  WardrobeImage.exists.mockResolvedValue(null as never);
  await clearUserWardrobe(models, new Types.ObjectId());
  expect(WardrobeItem.exists).not.toHaveBeenCalled();
  expect(WardrobeImage.deleteOne).not.toHaveBeenCalled();
});
