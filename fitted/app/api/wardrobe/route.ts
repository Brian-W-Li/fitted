import { NextRequest, NextResponse } from "next/server";
import { initDatabase } from "@/lib/db";
import { adminAuth } from "@/lib/firebaseAdmin";
import { type ClothingType, CLOTHING_TYPES, deriveClothingType } from "@/lib/clothingType";
import { deriveWarmth } from "@/lib/deriveWarmth";
import { validateWardrobeCreatePayload } from "@/lib/wardrobeRequestValidation";

/**
 * GET /api/wardrobe
 *   → returns all wardrobe items for the authenticated user
 *
 * POST /api/wardrobe
 *   body: { name, category, clothingType?, warmth?, colors?, fit?, size?, seasons?, occasions?, notes?,
 *           isAvailable?, layerRole? }
 *   Server validation rejects malformed scalar/array/boolean shapes before persistence.
 *   → creates a wardrobe item tied to the authenticated user
 *
 * The user is derived from the Firebase ID token in the Authorization header:
 *   Authorization: Bearer <idToken>
 */

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

export async function GET(request: NextRequest) {
  try {
    const userResult = await getUserIdFromRequest(request);
    if ("error" in userResult) {
      return NextResponse.json(
        { error: userResult.error },
        { status: userResult.status },
      );
    }

    const { userId } = userResult;
    const { WardrobeItem } = await initDatabase();

    type WardrobeItemLean = {
      _id: { toString(): string };
      name: string;
      clothingType?: ClothingType;
      warmth?: number;
      category: string;
      subCategory?: string;
      pattern?: string;
      colors?: string[];
      layerRole?: string;
      fit?: string;
      size?: string;
      seasons?: string[];
      occasions?: string[];
      notes?: string;
      isAvailable?: boolean;
      imagePath?: string;
      createdAt?: Date;
      updatedAt?: Date;
    };

    const items = (await WardrobeItem.find({ user: userId })
      .sort({ updatedAt: -1 })
      .lean()
      .exec()) as unknown as WardrobeItemLean[];

    return NextResponse.json({
      items: items.map((item) => ({
        id: item._id.toString(),
        name: item.name,
        clothingType: item.clothingType,
        warmth: item.warmth,
        category: item.category,
        subCategory: item.subCategory ?? "",
        pattern: item.pattern ?? "",
        colors: item.colors ?? [],
        layerRole: item.layerRole ?? "",
        fit: item.fit ?? "",
        size: item.size ?? "",
        seasons: item.seasons ?? [],
        occasions: item.occasions ?? [],
        notes: item.notes ?? "",
        isAvailable: item.isAvailable ?? true,
        imagePath: item.imagePath ?? undefined,
        createdAt: item.createdAt?.toISOString(),
        updatedAt: item.updatedAt?.toISOString(),
      })),
    });
  } catch (error) {
    console.error("Error fetching wardrobe items:", error);
    return NextResponse.json(
      { error: "Failed to fetch wardrobe items" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const userResult = await getUserIdFromRequest(request);
    if ("error" in userResult) {
      return NextResponse.json(
        { error: userResult.error },
        { status: userResult.status },
      );
    }

    const { userId } = userResult;
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Request body must be valid JSON" },
        { status: 400 },
      );
    }

    const validation = validateWardrobeCreatePayload(body);
    if (!validation.ok) {
      return NextResponse.json(
        { error: validation.error },
        { status: 400 },
      );
    }

    const {
      name,
      clothingType,
      warmth,
      category,
      subCategory = "",
      pattern = "",
      colors = [],
      fit = "",
      size = "",
      seasons = [],
      occasions = [],
      notes = "",
      isAvailable = true,
      layerRole = "",
    } = validation.value;

    const { WardrobeItem } = await initDatabase();
    // Use the form-supplied clothingType when valid; otherwise classify from
    // category/name (the form does not supply it today — §10.3 ingestion classifier).
    const clothingTypeToSave: ClothingType =
      typeof clothingType === "string" && CLOTHING_TYPES.includes(clothingType as ClothingType)
        ? (clothingType as ClothingType)
        : deriveClothingType({
            category,
            subCategory,
            name,
            layerRole,
          });
    // Honor a valid supplied warmth (W-track review form / CV); else keyword-derive.
    const warmthToSave =
      typeof warmth === "number" && Number.isInteger(warmth) && warmth >= 0 && warmth <= 10
        ? warmth
        : deriveWarmth({
            category,
            subCategory,
            name,
            seasons,
          });
    const itemDoc = await WardrobeItem.create({
      user: userId,
      name,
      clothingType: clothingTypeToSave,
      warmth: warmthToSave,
      category,
      subCategory: subCategory || undefined,
      pattern: pattern || undefined,
      colors,
      layerRole: layerRole || undefined,
      fit: fit || undefined,
      size: size || undefined,
      seasons,
      occasions,
      notes: notes || undefined,
      isAvailable,
    });

    return NextResponse.json(
      {
        item: {
          id: itemDoc._id.toString(),
          name: itemDoc.name,
          clothingType: itemDoc.clothingType ?? "top",
          // Return the warmth we just derived+stored so the client mirrors GET/PATCH (no
          // refetch needed); warmth is authoritative + feeds training truth (§6.1/§15.1).
          warmth: (itemDoc as unknown as { warmth?: number }).warmth,
          category: itemDoc.category,
          subCategory: itemDoc.subCategory ?? "",
          pattern: itemDoc.pattern ?? "",
          colors: itemDoc.colors ?? [],
          layerRole: itemDoc.layerRole ?? "",
          fit: itemDoc.fit ?? "",
          size: itemDoc.size ?? "",
          seasons: itemDoc.seasons ?? [],
          occasions: itemDoc.occasions ?? [],
          notes: itemDoc.notes ?? "",
          isAvailable: itemDoc.isAvailable ?? true,
          imagePath: itemDoc.imagePath ?? undefined,
          createdAt: (itemDoc as unknown as { createdAt?: Date }).createdAt?.toISOString(),
          updatedAt: (itemDoc as unknown as { updatedAt?: Date }).updatedAt?.toISOString(),
        },
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Error creating wardrobe item:", error);
    return NextResponse.json(
      { error: "Failed to create wardrobe item" },
      { status: 500 },
    );
  }
}
