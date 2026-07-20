import { NextRequest, NextResponse } from "next/server";
import { Types } from "mongoose";
import { initDatabase } from "@/lib/db";
import { adminAuth } from "@/lib/firebaseAdmin";
import { MAX_WARDROBE_IMAGE_BYTES, uploadWardrobeImage } from "@/lib/imageStorage";
import { allowRequest } from "@/lib/rateLimit";
import { OBJECT_ID_RE } from "@/lib/formats";
import { isImagePathReferenced } from "@/lib/imageReferences";

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
    const { WardrobeItem, WardrobeImage, GenerationSnapshot, User } = await initDatabase();

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

    // 2) If it already has an image, note it: the budget below credits it ONLY when it will actually
    // be freed (a same-item replace must not false-reject at the margin), and it is deleted only
    // AFTER the budget admits the new image — delete-then-reject would destroy the old photo and
    // leave a dangling imagePath. EXCEPTION (§D2/REPLACE-1, lib/imageReferences): if a
    // GenerationSnapshot references the old image, it is KEPT (corpus provenance for the M6
    // image-embedding re-measure), so it is NOT deleted AND its bytes are NOT credited — old + new
    // both consume space in that case.
    const oldPath = (existingItem as { imagePath?: unknown } | null)?.imagePath;
    const oldPathStr = typeof oldPath === "string" ? oldPath : undefined;
    let oldImageId: string | undefined;
    let oldImageBytes = 0;
    let oldImageReferenced = false;
    if (oldPathStr?.startsWith("mongo:")) {
      const sliced = oldPathStr.slice("mongo:".length);
      // imagePath is PATCH-able as a plain string, so a garbage "mongo:notanid" is reachable —
      // an unguarded ObjectId cast here would 500 and brick this item's uploads until re-PATCHed.
      // Non-hex ⇒ treat as no old image; the successful upload below overwrites the bad pointer.
      if (OBJECT_ID_RE.test(sliced)) {
        oldImageId = sliced;
        const oldDoc = (await WardrobeImage.findOne({ _id: oldImageId, user: userId })
          .select("sizeBytes")
          .lean()) as { sizeBytes?: number } | null;
        oldImageBytes = oldDoc?.sizeBytes ?? 0;
        oldImageReferenced = await isImagePathReferenced(GenerationSnapshot, userId, oldPathStr);
      }
    }

    // 3) Per-user byte budget. Credit the old image's bytes only if it will be freed (unreferenced);
    // a kept, snapshot-referenced old image stays, so both it and the new image count.
    const totals = (await WardrobeImage.aggregate([
      { $match: { user: new Types.ObjectId(userId) } },
      { $group: { _id: null, total: { $sum: "$sizeBytes" } } },
    ]).exec()) as { total?: number }[];
    const storedBytes = totals[0]?.total ?? 0;
    const creditBytes = oldImageReferenced ? 0 : oldImageBytes;
    if (storedBytes - creditBytes + bytes.length > MAX_USER_IMAGE_BYTES) {
      return NextResponse.json(
        { error: "Image storage limit reached — delete some photos to add more" },
        { status: 413 }
      );
    }

    // 4) Budget admitted — delete the old image UNLESS a snapshot references it (then keep it).
    if (oldImageId && !oldImageReferenced) {
      await WardrobeImage.deleteOne({ _id: oldImageId, user: userId }).exec();
    }

    // 5) Store new image
    const { imagePath } = await uploadWardrobeImage({
      userId,
      wardrobeItemId,
      bytes,
      contentType,
    });

    // 6) Update wardrobe item with new pointer
    await WardrobeItem.updateOne(
      { _id: wardrobeItemId, user: userId },
      { $set: { imagePath } }
    ).exec();

    // Erasure-race close (§23-H43): if the account was deleted while this authed upload was in flight,
    // the new WardrobeImage row (real photo bytes) must not survive "delete me". Mirror the writer-side
    // guards (mlRecommend.ts / interactions.ts).
    if (!(await User.exists({ _id: userId }))) {
      await WardrobeImage.deleteMany({ user: userId });
      await WardrobeItem.deleteMany({ user: userId });
      return NextResponse.json({ error: "Account no longer exists" }, { status: 401 });
    }

    return NextResponse.json({ imagePath });
  } catch (err) {
    console.error("wardrobe image upload error:", err);
    // Known storage-layer rejections get their real status + copy; everything else is a generic
    // 500 — the raw err.message (Mongoose/driver text) must never reach the browser.
    const message = err instanceof Error ? err.message : "";
    if (message.startsWith("Image too large")) {
      return NextResponse.json({ error: message }, { status: 413 });
    }
    if (message === "Unsupported image type") {
      return NextResponse.json(
        { error: "That file isn't a usable JPEG, PNG, or WEBP — try exporting it as JPEG first" },
        { status: 415 }
      );
    }
    return NextResponse.json({ error: "Upload failed — try again" }, { status: 500 });
  }
}
