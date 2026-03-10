import { NextRequest, NextResponse } from "next/server";
import { initDatabase } from "@/lib/db";
import { adminAuth } from "@/lib/firebaseAdmin";

/**
 * GET /api/wardrobe
 *   → returns all wardrobe items for the authenticated user
 *
 * POST /api/wardrobe
 *   body: { name, category, colors?, fit?, size?, seasons?, occasions?, notes? }
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
      clothingType?: "top" | "bottom";
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
    const body = await request.json();
    const {
      name,
      clothingType = "top",
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
    } = body;

    if (!name || !category) {
      return NextResponse.json(
        { error: "name and category are required" },
        { status: 400 },
      );
    }

    const { WardrobeItem } = await initDatabase();
    const clothingTypeToSave = clothingType === "bottom" ? "bottom" : "top";
    const itemDoc = await WardrobeItem.create({
      user: userId,
      name: String(name).trim(),
      clothingType: clothingTypeToSave,
      category: String(category).trim(),
      subCategory: String(subCategory || "").trim() || undefined,
      pattern: String(pattern || "").trim() || undefined,
      colors: Array.isArray(colors) ? colors : [],
      layerRole: String(layerRole || "").trim() || undefined,
      fit: String(fit || "").trim() || undefined,
      size: String(size || "").trim() || undefined,
      seasons: Array.isArray(seasons) ? seasons : [],
      occasions: Array.isArray(occasions) ? occasions : [],
      notes: String(notes || "").trim() || undefined,
      isAvailable: Boolean(isAvailable),
    });

    return NextResponse.json(
      {
        item: {
          id: itemDoc._id.toString(),
          name: itemDoc.name,
          clothingType: itemDoc.clothingType ?? "top",
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

