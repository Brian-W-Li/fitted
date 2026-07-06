import { NextRequest, NextResponse } from "next/server";
import { initDatabase } from "@/lib/db";
import { adminAuth } from "@/lib/firebaseAdmin";
import { normalizeClothingType } from "@/lib/clothingType";
import { deriveWarmth } from "@/lib/deriveWarmth";
import { validateWardrobePatchPayload } from "@/lib/wardrobeRequestValidation";

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
    if (typeof update.clothingType === "string") {
      update.clothingType = normalizeClothingType(update.clothingType);
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
      suppliedWarmth >= 0 &&
      suppliedWarmth <= 10
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

    const { WardrobeItem, WardrobeImage } = await initDatabase();

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

    // Best-effort cleanup of any linked WardrobeImage document
    const imagePath = (doc as { imagePath?: unknown }).imagePath;
    const imagePathStr = typeof imagePath === "string" ? imagePath : undefined;
    if (imagePathStr?.startsWith("mongo:")) {
      const imageId = imagePathStr.slice("mongo:".length);
      try {
        await WardrobeImage.deleteOne({ _id: imageId, user: userId }).exec();
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
