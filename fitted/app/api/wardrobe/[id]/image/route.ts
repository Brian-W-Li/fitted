import { NextRequest, NextResponse } from "next/server";
import { Types } from "mongoose";
import { initDatabase } from "@/lib/db";
import { adminAuth } from "@/lib/firebaseAdmin";
import { MAX_WARDROBE_IMAGE_BYTES, uploadWardrobeImage } from "@/lib/imageStorage";
import { allowRequest } from "@/lib/rateLimit";

const MAX_MULTIPART_OVERHEAD_BYTES = 64 * 1024;
const MAX_WARDROBE_IMAGE_REQUEST_BYTES =
  MAX_WARDROBE_IMAGE_BYTES + MAX_MULTIPART_OVERHEAD_BYTES;

// Per-user image-storage budget (§I): sign-up is open Google auth and the shared Atlas M0 is
// 512MB, so per-image caps alone don't bound an account (300 items × 5MB ≫ the cluster). 80MB
// is ~6× a real closet fully photographed through the client downscale (~15–50 images × ≤1MB).
// Summed over the stored `sizeBytes` column at upload time — cheap at friends scale.
export const MAX_USER_IMAGE_BYTES = 80 * 1024 * 1024;
// Courtesy pacing against a runaway upload loop (per-instance, best-effort — same posture as the
// CV route's limiter; the byte budget above is the hard bound).
const UPLOAD_RATE_MAX = 30;
const UPLOAD_RATE_WINDOW_MS = 10 * 60 * 1000;

async function getUserIdFromRequest(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return { error: "Missing or invalid Authorization header", status: 401 as const };
  }

  const idToken = authHeader.slice("Bearer ".length).trim();

  try {
    const decoded = await adminAuth.verifyIdToken(idToken);
    const firebaseUid = decoded.uid;

    const { User } = await initDatabase();
    const user = await User.findOne({
      authProvider: "firebase",
      authId: firebaseUid,
    }).exec();

    if (!user) return { error: "User not found", status: 404 as const };
    return { userId: user._id.toString() };
  } catch (err) {
    console.error("verifyIdToken failed:", err);
    return { error: "Invalid or expired token", status: 401 as const };
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userResult = await getUserIdFromRequest(request);
    if ("error" in userResult) {
      return NextResponse.json({ error: userResult.error }, { status: userResult.status });
    }

    const { id: wardrobeItemId } = await params;
    const userId = userResult.userId;

    if (!allowRequest(`wardrobe-image:${userId}`, UPLOAD_RATE_MAX, UPLOAD_RATE_WINDOW_MS)) {
      return NextResponse.json(
        { error: "Too many photo uploads at once — wait a moment and try again" },
        { status: 429 }
      );
    }

    const contentLength = request.headers.get("content-length");
    const parsedContentLength =
      contentLength === null ? undefined : Number.parseInt(contentLength, 10);
    if (
      parsedContentLength !== undefined &&
      Number.isFinite(parsedContentLength) &&
      parsedContentLength > MAX_WARDROBE_IMAGE_REQUEST_BYTES
    ) {
      return NextResponse.json(
        { error: "Image too large (max 5MB)" },
        { status: 413 }
      );
    }

    const form = await request.formData();
    const file = form.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "Missing file (expected form field named 'file')" },
        { status: 400 }
      );
    }

    const contentType = file.type || "application/octet-stream";
    const bytes = Buffer.from(await file.arrayBuffer());

    // attach pointer on WardrobeItem (user-scoped)
    const { WardrobeItem, WardrobeImage } = await initDatabase();

    // 1) Load current item so we can see its existing imagePath
    const existingItem = await WardrobeItem.findOne({
      _id: wardrobeItemId,
      user: userId,
    }).lean();

    if (!existingItem) {
      return NextResponse.json(
        { error: "Wardrobe item not found (or not owned by user)" },
        { status: 404 }
      );
    }

    // 2) If it already has an image, delete the old WardrobeImage doc
    const oldPath = (existingItem as { imagePath?: unknown } | null)?.imagePath;
    const oldPathStr = typeof oldPath === "string" ? oldPath : undefined;
    if (oldPathStr?.startsWith("mongo:")) {
      const oldImageId = oldPathStr.slice("mongo:".length);
      await WardrobeImage.deleteOne({ _id: oldImageId, user: userId }).exec();
    }

    // 3) Per-user byte budget — after the old-image delete so a same-item replace never
    // false-rejects at the margin.
    const totals = (await WardrobeImage.aggregate([
      { $match: { user: new Types.ObjectId(userId) } },
      { $group: { _id: null, total: { $sum: "$sizeBytes" } } },
    ]).exec()) as { total?: number }[];
    const storedBytes = totals[0]?.total ?? 0;
    if (storedBytes + bytes.length > MAX_USER_IMAGE_BYTES) {
      return NextResponse.json(
        { error: "Image storage limit reached — delete some photos to add more" },
        { status: 413 }
      );
    }

    // 4) Store new image
    const { imagePath } = await uploadWardrobeImage({
      userId,
      wardrobeItemId,
      bytes,
      contentType,
    });

    // 5) Update wardrobe item with new pointer
    await WardrobeItem.updateOne(
      { _id: wardrobeItemId, user: userId },
      { $set: { imagePath } }
    ).exec();

    return NextResponse.json({ imagePath });
  } catch (err) {
    console.error("wardrobe image upload error:", err);
    const message = err instanceof Error ? err.message : "Upload failed";
    const status = message.startsWith("Image too large") ? 413 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
