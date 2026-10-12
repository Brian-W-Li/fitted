import { Types } from "mongoose";
import { initDatabase } from "@/lib/db";

export type ImageUploadResult = {
  imagePath: string; // store this in WardrobeItem.imagePath
};

export type UploadInput = {
  userId: string;          // Mongo user _id (string)
  wardrobeItemId: string;  // Mongo wardrobe item _id (string)
  imageId?: string;
  attachmentLease?: string;
  bytes: Buffer;
  contentType: string;     // "image/jpeg" | "image/png" | ...
};

export const MAX_WARDROBE_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB

function assertAllowedImageType(contentType: string) {
  const allowed = new Set(["image/jpeg", "image/png", "image/webp"]);
  if (!allowed.has(contentType)) throw new Error("Unsupported image type");
}

/** Magic-byte sniff — the declared contentType is client-supplied and can lie (the real case: a
 *  .heic renamed .jpg gets browser type image/jpeg, fails the client decode, and the downscale
 *  fallback uploads the original bytes — stored trusting the type, it renders as a permanently
 *  broken tile with no error anywhere). The stored contentType is the SNIFFED truth, never the
 *  declared one. */
function sniffImageFormat(bytes: Buffer): "image/jpeg" | "image/png" | "image/webp" | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 12 &&
    bytes.toString("latin1", 0, 4) === "RIFF" &&
    bytes.toString("latin1", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

export async function uploadWardrobeImage(input: UploadInput): Promise<ImageUploadResult> {
  assertAllowedImageType(input.contentType);
  const sniffed = sniffImageFormat(input.bytes);
  if (sniffed === null) throw new Error("Unsupported image type");

  // Hard cap to avoid Mongo 16MB doc limits (and base64 bloat)
  if (input.bytes.length > MAX_WARDROBE_IMAGE_BYTES) {
    throw new Error("Image too large (max 5MB)");
  }

  const base64 = input.bytes.toString("base64");

  const { User, WardrobeImage } = await initDatabase();
  const imageId = input.imageId ?? new Types.ObjectId().toString();
  const session = await User.db.startSession();
  try {
    // Both writes commit atomically. The owner increment is a real write conflict with
    // erasure's barrier; a read-only owner check cannot fence a delayed image insert.
    // Standalone Mongo rejects the transaction before it stores any bytes. No fallback.
    await session.withTransaction(async () => {
      const admitted = await User.updateOne(
        { _id: input.userId, erasureStarted: { $ne: true } },
        { $inc: { imageWriteVersion: 1 } }, { session },
      );
      if (!admitted.matchedCount) throw new Error("Account no longer accepts photo uploads");
      await WardrobeImage.create([{
        _id: imageId,
        ...(input.attachmentLease ? { attachmentLease: input.attachmentLease } : {}),
        user: input.userId,
        wardrobeItem: input.wardrobeItemId,
        base64,
        contentType: sniffed,
        sizeBytes: input.bytes.length,
      }], { session });
    }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } });
  } finally {
    await session.endSession();
  }
  return { imagePath: `mongo:${imageId}` };
}
