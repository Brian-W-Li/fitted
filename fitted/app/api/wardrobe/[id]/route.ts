import { NextRequest, NextResponse } from "next/server";
import { initDatabase } from "@/lib/db";
import { adminAuth } from "@/lib/firebaseAdmin";
import { CLOTHING_TYPES, deriveClothingType, type ClothingType } from "@/lib/clothingType";
import { deriveWarmth } from "@/lib/deriveWarmth";
import { WARMTH_MIN, WARMTH_MAX } from "@/lib/warmth";
import { validateWardrobePatchPayload } from "@/lib/wardrobeRequestValidation";
import { isImagePathReferenced } from "@/lib/imageReferences";

async function getUserIdFromRequest(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return { error: "Missing or invalid Authorization header", status: 401 };
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

    if (!user) {
      return { error: "User not found", status: 404 };
    }

    return { userId: user._id.toString() };
  } catch (error) {
    console.error("Error verifying Firebase token:", error);
    return { error: "Invalid or expired token", status: 401 };
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const userResult = await getUserIdFromRequest(request);
    if ("error" in userResult) {
      return NextResponse.json(
        { error: userResult.error },
        { status: userResult.status },
      );
    }

    const { userId } = userResult;
    const { id: itemId } = await params;
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Request body must be valid JSON" },
        { status: 400 },
      );
    }

    const validation = validateWardrobePatchPayload(body);
    if (!validation.ok) {
      return NextResponse.json(
        { error: validation.error },
        { status: 400 },
      );
    }

    const { WardrobeItem } = await initDatabase();

    const { update, suppliedWarmth, hasSuppliedWarmth, warmthDrivingFieldsChanged } =
      validation.value;
    if (
      typeof update.clothingType === "string" &&
      !CLOTHING_TYPES.includes(update.clothingType as ClothingType)
    ) {
      // An invalid explicit clothingType is IGNORED (key deleted) so the taxonomy re-derive below
      // can still run — mirroring the POST route's invalid-falls-back-to-classification semantics.
      // The old normalizeClothingType coerce here silently stored "top" AND suppressed the
      // re-derive (the legacy coerce-to-top funnel this module's vocabulary replaced).
      delete update.clothingType;
    }

    // warmth (§6.1): stored, NOT read-time-derived — so an edit must not leave it stale, since it
    // feeds training truth via the snapshot (§15.1) and the ranker's warmth band. Honor a valid
    // explicit warmth (the correction path — W-track review form / user); else re-derive when a
    // warmth-driving field changes, from the merged (update-over-existing) values. Mirrors the POST
    // handler; closes the §23-H47 staleness gap.
    if (
      hasSuppliedWarmth &&
      typeof suppliedWarmth === "number" &&
      Number.isInteger(suppliedWarmth) &&
      suppliedWarmth >= WARMTH_MIN &&
      suppliedWarmth <= WARMTH_MAX
    ) {
      update.warmth = suppliedWarmth;
    } else if (warmthDrivingFieldsChanged) {
      const existing = await WardrobeItem.findOne({ _id: itemId, user: userId })
        .select("name category subCategory seasons")
        .lean<{ name?: string; category?: string; subCategory?: string; seasons?: string[] }>()
        .exec();
      if (existing) {
        update.warmth = deriveWarmth({
          name: (update.name as string) ?? existing.name,
          category: (update.category as string) ?? existing.category,
          subCategory: (update.subCategory as string) ?? existing.subCategory,
          seasons: (update.seasons as string[]) ?? existing.seasons,
        });
      }
    }

    // clothingType (§10.3): the same staleness rule as warmth — stored, NOT read-time-derived, and
    // it decides which outfit SLOT the item occupies, so a corrected Category/Type dropdown must
    // re-derive it or the item is offered in the wrong slot forever (the edit form never sends
    // clothingType). Driving fields are the STRUCTURED taxonomy inputs only (category/subCategory/
    // layerRole) — deliberately NOT `name`: a bare rename must never clobber an explicitly-set
    // clothingType (the W-track correction path; pinned by the edit-ingestion test). An explicit
    // valid clothingType in the body (normalized above) still wins outright.
    // ⚠ Scope of that guarantee: the trigger is key-PRESENCE, and the UI edit modal sends the
    // taxonomy fields on every save — so every modal edit re-derives, and the no-clobber promise
    // protects API-shaped renames only. Benign while nothing sets an explicit divergent type; the
    // future W-track correction form MUST echo clothingType or its correction is silently lost on
    // the next modal edit (§23-H52 records that obligation).
    const typeDrivingFieldsChanged = ["category", "subCategory", "layerRole"].some(
      (f) => f in update,
    );
    if (typeof update.clothingType !== "string" && typeDrivingFieldsChanged) {
      const existing = await WardrobeItem.findOne({ _id: itemId, user: userId })
        .select("name category subCategory layerRole")
        .lean<{ name?: string; category?: string; subCategory?: string; layerRole?: string }>()
        .exec();
      if (existing) {
        update.clothingType = deriveClothingType({
          name: (update.name as string) ?? existing.name,
          category: (update.category as string) ?? existing.category,
          subCategory: (update.subCategory as string) ?? existing.subCategory,
          layerRole: (update.layerRole as string) ?? existing.layerRole,
        });
      }
    }

    const doc = await WardrobeItem.findOneAndUpdate(
      { _id: itemId, user: userId },
      { $set: update },
      { new: true },
    ).exec();

    if (!doc) {
      return NextResponse.json(
        { error: "Item not found" },
        { status: 404 },
      );
    }

    return NextResponse.json({
      item: {
        id: doc._id.toString(),
        name: doc.name,
        clothingType: doc.clothingType ?? "top",
        warmth: (doc as unknown as { warmth?: number }).warmth,
        category: doc.category,
        subCategory: doc.subCategory ?? "",
        pattern: doc.pattern ?? "",
        colors: doc.colors ?? [],
        layerRole: doc.layerRole ?? "",
        fit: doc.fit ?? "",
        size: doc.size ?? "",
        seasons: doc.seasons ?? [],
        occasions: doc.occasions ?? [],
        notes: doc.notes ?? "",
        isAvailable: doc.isAvailable ?? true,
        imagePath: doc.imagePath ?? undefined,
        createdAt: (doc as unknown as { createdAt?: Date }).createdAt?.toISOString(),
        updatedAt: (doc as unknown as { updatedAt?: Date }).updatedAt?.toISOString(),
      },
    });
  } catch (error) {
    console.error("Error updating wardrobe item:", error);
    return NextResponse.json(
      { error: "Failed to update wardrobe item" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const userResult = await getUserIdFromRequest(request);
    if ("error" in userResult) {
      return NextResponse.json(
        { error: userResult.error },
        { status: userResult.status },
      );
    }

    const { userId } = userResult;
    const { id: itemId } = await params;

    const { WardrobeItem, WardrobeImage, GenerationSnapshot } = await initDatabase();

    const doc = await WardrobeItem.findOneAndDelete({
      _id: itemId,
      user: userId,
    }).exec();

    if (!doc) {
      return NextResponse.json(
        { error: "Item not found" },
        { status: 404 },
      );
    }

    // Best-effort cleanup of the linked WardrobeImage — UNLESS a GenerationSnapshot references it.
    // A referenced image is corpus provenance for the M6 image-embedding re-measure (§D2 /
    // lib/imageReferences); hard-deleting it would silently void the image side of every already-
    // labeled outfit built from this item. Kept images are still purged on account-delete (erasure).
    const imagePath = (doc as { imagePath?: unknown }).imagePath;
    const imagePathStr = typeof imagePath === "string" ? imagePath : undefined;
    if (imagePathStr?.startsWith("mongo:")) {
      const imageId = imagePathStr.slice("mongo:".length);
      try {
        if (!(await isImagePathReferenced(GenerationSnapshot, userId, imagePathStr))) {
          await WardrobeImage.deleteOne({ _id: imageId, user: userId }).exec();
        }
      } catch (e) {
        // Log and continue; the main deletion has already succeeded
        console.error("Failed to delete linked wardrobe image:", e);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Error deleting wardrobe item:", error);
    return NextResponse.json(
      { error: "Failed to delete wardrobe item" },
      { status: 500 },
    );
  }
}
