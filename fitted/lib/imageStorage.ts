import { initDatabase } from "@/lib/db";

export type ImageUploadResult = {
  imagePath: string; // store this in WardrobeItem.imagePath
};

export type UploadInput = {
  userId: string;          // Mongo user _id (string)
  wardrobeItemId: string;  // Mongo wardrobe item _id (string)
  bytes: Buffer;
  contentType: string;     // "image/jpeg" | "image/png" | ...
};

function assertAllowedImageType(contentType: string) {
  const allowed = new Set(["image/jpeg", "image/png", "image/webp"]);
  if (!allowed.has(contentType)) throw new Error("Unsupported image type");
}

export async function uploadWardrobeImage(input: UploadInput): Promise<ImageUploadResult> {
  assertAllowedImageType(input.contentType);

  // Hard cap to avoid Mongo 16MB doc limits (and base64 bloat)
  const MAX_BYTES = 5 * 1024 * 1024; // 2MB
  if (input.bytes.length > MAX_BYTES) {
    throw new Error("Image too large (max 5MB)");
  }

  const base64 = input.bytes.toString("base64");


  const { WardrobeImage } = await initDatabase();

  const doc = await WardrobeImage.create({
    user: input.userId,
    wardrobeItem: input.wardrobeItemId,
    base64,
    contentType: input.contentType,
    sizeBytes: input.bytes.length,
  });

  return { imagePath: `mongo:${doc._id.toString()}` };
}