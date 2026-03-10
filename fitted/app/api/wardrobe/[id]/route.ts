import { NextRequest, NextResponse } from "next/server";
import { initDatabase } from "@/lib/db";
import { adminAuth } from "@/lib/firebaseAdmin";

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
    const body = await request.json();
    const { WardrobeItem, WardrobeImage } = await initDatabase();

    const update: Record<string, unknown> = {};
    const fields = [
      "name",
      "clothingType",
      "category",
      "subCategory",
      "pattern",
      "colors",
      "layerRole",
      "fit",
      "size",
      "seasons",
      "occasions",
      "notes",
      "imagePath",
      "isAvailable",
    ] as const;

    for (const field of fields) {
      if (field in body) {
        if (field === "colors" || field === "seasons" || field === "occasions") {
          update[field] = Array.isArray(body[field]) ? body[field] : [];
        } else if (field === "isAvailable") {
          update[field] = Boolean(body[field]);
        } else if (field === "clothingType") {
          const v = body[field];
          update[field] = v === "bottom" ? "bottom" : "top";
        } else {
          const v = body[field];
          update[field] = typeof v === "string" ? v.trim() : v;
        }
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
