import { randomUUID } from "node:crypto";
import { MAX_USER_IMAGE_BYTES, UPLOAD_RATE_MAX, MAX_WARDROBE_IMAGE_REQUEST_BYTES } from "@/lib/wardrobeLimits";
import { NextRequest, NextResponse } from "next/server";
import { Types } from "mongoose";
import { initDatabase } from "@/lib/db";
import { verifyFirebaseUser } from "@/lib/apiAuth";
import { uploadWardrobeImage } from "@/lib/imageStorage";
import { allowRequest } from "@/lib/rateLimit";
import { OBJECT_ID_RE } from "@/lib/formats";
import { reclaimWardrobeImage } from "@/lib/imageRetention";
import {
  attachmentCAS, attachmentImageIds, attachmentState, mongoImageId,
  primaryImageRef, MAX_SUPPLEMENTAL_IMAGES, type RawAttachments,
} from "@/lib/imageAttachments";

const UPLOAD_RATE_WINDOW_MS = 10 * 60 * 1000;
type Database = Awaited<ReturnType<typeof initDatabase>>;
type Context = { models: Database; userId: string; imageId?: string; lease?: string; linkUncertain?: boolean };

/** Cleanup remains independent of the mutation's success, including ambiguous insert/update
 * acknowledgments. Unknown CAS results retain their lease. Account erasure ignores all pins
 * and is checked even if cleanup fails. Image insertion has its own transactional owner fence;
 * erasure safety does not depend on this process reaching cleanup. */
async function finishMutation(context: Context) {
  const { models, userId, imageId, lease } = context;
  if (imageId && lease && !context.linkUncertain) {
    try {
      await models.WardrobeImage.updateOne(
        { _id: imageId, user: userId, attachmentLease: lease },
        { $unset: { attachmentLease: "" } },
      ).exec();
      await reclaimWardrobeImage(models, userId, imageId);
    } catch (error) {
      console.error("Photo attachment cleanup incomplete:", error);
    }
  }
  try {
    if (!(await models.User.exists({ _id: userId, erasureStarted: { $ne: true } }))) {
      await models.WardrobeImage.deleteMany({ user: userId });
      await models.WardrobeItem.deleteMany({ user: userId });
      return NextResponse.json({ error: "Account no longer exists" }, { status: 401 });
    }
  } catch (error) {
    console.error("Photo attachment account reconciliation incomplete:", error);
  }
}

async function conflict(models: Database, userId: string, itemId: string, error: string) {
  const current = await models.WardrobeItem.findOne({ _id: itemId, user: userId }).lean();
  return NextResponse.json({ error, ...(current ? { attachments: attachmentState(current as RawAttachments) } : {}) }, { status: 409 });
}
function validView(view: unknown): view is "primary" | "supplemental" {
  return view === "primary" || view === "supplemental";
}
function failedUpload(error: unknown) {
  console.error("wardrobe image upload error:", error);
  const message = error instanceof Error ? error.message : "";
  if (message.startsWith("Image too large")) return NextResponse.json({ error: message }, { status: 413 });
  if (message === "Unsupported image type") return NextResponse.json({
    error: "That file isn't a usable JPEG, PNG, or WEBP — try exporting it as JPEG first",
  }, { status: 415 });
  return NextResponse.json({ error: "Upload failed — reload this item before trying again" }, { status: 500 });
}

/** Multipart file; omitted view preserves legacy primary replacement. Supplemental without
 * imageRef appends, with imageRef replaces that exact current view. No refs can be attached from
 * the client. A 409 carries current attachments; unknown outcomes require reload before retry. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let context: Context | undefined;
  const response = await (async () => {
    try {
      const auth = await verifyFirebaseUser(request);
      if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
      const { id: itemId } = await params;
      const { userId } = auth;
      if (!OBJECT_ID_RE.test(itemId)) return NextResponse.json({ error: "Item not found" }, { status: 404 });
      if (!allowRequest(`wardrobe-image:${userId}`, UPLOAD_RATE_MAX, UPLOAD_RATE_WINDOW_MS)) {
        return NextResponse.json({ error: "Too many photo uploads at once — wait a moment and try again" }, { status: 429 });
      }
      const length = Number.parseInt(request.headers.get("content-length") ?? "", 10);
      if (Number.isFinite(length) && length > MAX_WARDROBE_IMAGE_REQUEST_BYTES) {
        return NextResponse.json({ error: "Image too large (max 5MB)" }, { status: 413 });
      }
      const form = await request.formData();
      const file = form.get("file");
      const view = form.get("view") ?? "primary";
      const target = form.get("imageRef");
      if (!validView(view) || (target !== null && (typeof target !== "string" || !target))) {
        return NextResponse.json({ error: "Invalid photo view or imageRef" }, { status: 400 });
      }
      if (!(file instanceof File)) return NextResponse.json({ error: "Missing file (expected form field named 'file')" }, { status: 400 });
      const bytes = Buffer.from(await file.arrayBuffer());
      const models = await initDatabase();
      context = { models, userId };
      const raw = await models.WardrobeItem.findOne({ _id: itemId, user: userId }).lean();
      if (!raw) return NextResponse.json({ error: "Wardrobe item not found (or not owned by user)" }, { status: 404 });
      const captured = raw as RawAttachments;
      const state = attachmentState(captured);
      const index = typeof target === "string" ? state.supplementalImages.indexOf(target) : -1;
      if (target && ((view === "supplemental" && index < 0) || (view === "primary" && target !== primaryImageRef(captured)))) {
        return conflict(models, userId, itemId, "This photo changed — reload and try again");
      }
      if (view === "supplemental" && !target && state.supplementalImages.length >= MAX_SUPPLEMENTAL_IMAGES) {
        return conflict(models, userId, itemId, "This garment already has two additional views");
      }
      // Historic bytes and all leases count. Replacement requires temporary headroom; concurrent
      // account admission remains the existing courtesy budget, not a new quota claim.
      const totals = await models.WardrobeImage.aggregate([
        { $match: { user: new Types.ObjectId(userId) } },
        { $group: { _id: null, total: { $sum: "$sizeBytes" } } },
      ]).exec() as { total?: number }[];
      if ((totals[0]?.total ?? 0) + bytes.length > MAX_USER_IMAGE_BYTES) {
        return NextResponse.json({ error: "Photo storage limit reached. Try a smaller photo; photos saved with outfits also count." }, { status: 413 });
      }
      // Store first, leased from birth. Preassigned ID lets finally reconcile even a lost insert
      // acknowledgement. Every upload writes a fresh ID; clients cannot reattach settled old bytes.
      context.imageId = new Types.ObjectId().toString();
      context.lease = randomUUID();
      const { imagePath } = await uploadWardrobeImage({
        userId, wardrobeItemId: itemId, imageId: context.imageId, attachmentLease: context.lease,
        bytes, contentType: file.type || "application/octet-stream",
      });
      const next = { ...state, supplementalImages: [...state.supplementalImages] };
      const unset: Record<string, string> = {};
      if (view === "primary") {
        next.imagePath = imagePath;
        if (Object.hasOwn(captured, "imageUrl")) { delete next.imageUrl; unset.imageUrl = ""; }
      } else if (target) next.supplementalImages[index] = imagePath;
      else next.supplementalImages.push(imagePath);
      context.linkUncertain = true;
      const linked = await models.WardrobeItem.collection.updateOne(
        { _id: new Types.ObjectId(itemId), user: new Types.ObjectId(userId), ...attachmentCAS(captured) },
        { $set: { ...(view === "primary" ? { imagePath } : {}), supplementalImages: next.supplementalImages, updatedAt: new Date() },
          ...(Object.keys(unset).length ? { $unset: unset } : {}) },
      );
      context.linkUncertain = false;
      if (!linked.matchedCount) return conflict(models, userId, itemId, "This item changed during upload — reload and try again");
      const retained = new Set(attachmentImageIds(next));
      for (const imageId of attachmentImageIds(captured)) {
        if (!retained.has(imageId)) await reclaimWardrobeImage(models, userId, imageId);
      }
      return NextResponse.json({ ok: true, ...next });
    } catch (error) {
      return failedUpload(error);
    }
  })();
  if (context) {
    const erased = await finishMutation(context);
    if (erased) return erased;
  }
  return response;
}

/** Remove only the exact currently attached ref; primary removal clears legacy fallback too. */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let context: Context | undefined;
  const response = await (async () => {
    try {
      const auth = await verifyFirebaseUser(request);
      if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
      const { id: itemId } = await params;
      const { userId } = auth;
      if (!OBJECT_ID_RE.test(itemId)) return NextResponse.json({ error: "Item not found" }, { status: 404 });
      let body: unknown;
      try { body = await request.json(); }
      catch { return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 }); }
      if (typeof body !== "object" || body === null || Array.isArray(body)) return NextResponse.json({ error: "Invalid photo removal" }, { status: 400 });
      const { view, imageRef } = body as { view?: unknown; imageRef?: unknown };
      if (!validView(view) || typeof imageRef !== "string" || !imageRef || (view === "supplemental" && !mongoImageId(imageRef))) {
        return NextResponse.json({ error: "A photo view and exact current imageRef are required" }, { status: 400 });
      }
      const models = await initDatabase();
      context = { models, userId };
      const raw = await models.WardrobeItem.findOne({ _id: itemId, user: userId }).lean();
      if (!raw) return NextResponse.json({ error: "Item not found" }, { status: 404 });
      const captured = raw as RawAttachments;
      const next = attachmentState(captured);
      if ((view === "primary" && imageRef !== primaryImageRef(captured)) || (view === "supplemental" && !next.supplementalImages.includes(imageRef))) {
        return conflict(models, userId, itemId, "This photo changed — reload and try again");
      }
      if (view === "primary") { delete next.imagePath; delete next.imageUrl; }
      else next.supplementalImages = next.supplementalImages.filter(ref => ref !== imageRef);
      const changed = await models.WardrobeItem.collection.updateOne(
        { _id: new Types.ObjectId(itemId), user: new Types.ObjectId(userId), ...attachmentCAS(captured) },
        { $set: { supplementalImages: next.supplementalImages, updatedAt: new Date() },
          ...(view === "primary" ? { $unset: { imagePath: "", imageUrl: "" } } : {}) },
      );
      if (!changed.matchedCount) return conflict(models, userId, itemId, "This item changed — reload and try again");
      const retained = new Set(attachmentImageIds(next));
      for (const imageId of attachmentImageIds(captured)) {
        if (!retained.has(imageId)) await reclaimWardrobeImage(models, userId, imageId);
      }
      return NextResponse.json({ ok: true, ...next });
    } catch (error) {
      console.error("wardrobe image removal error:", error);
      return NextResponse.json({ error: "Photo removal failed — reload this item before trying again" }, { status: 500 });
    }
  })();
  if (context) {
    const erased = await finishMutation(context);
    if (erased) return erased;
  }
  return response;
}
