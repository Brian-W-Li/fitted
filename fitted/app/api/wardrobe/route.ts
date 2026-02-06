import { NextRequest, NextResponse } from "next/server";
import { initDatabase } from "@/lib/db";
import { adminAuth } from "@/lib/firebaseAdmin";

/**
 * GET /api/wardrobe
 *   → returns all wardrobe items for the authenticated user
 *
 * POST /api/wardrobe
 *   body: { name, category, colors?, fit?, size?, formality?, seasons?, occasions?, notes? }
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
      category: string;
      colors?: string[];
      fit?: string;
      size?: string;
      formality?: string;
      seasons?: string[];
      occasions?: string[];
      notes?: string;
      imagePath?: string;
    };

    const items = (await WardrobeItem.find({ user: userId })
      .sort({ updatedAt: -1 })
      .lean()
      .exec()) as unknown as WardrobeItemLean[];

    return NextResponse.json({
      items: items.map((item) => ({
        id: item._id.toString(),
        name: item.name,
        category: item.category,
        colors: item.colors ?? [],
        fit: item.fit ?? "",
        size: item.size ?? "",
        formality: item.formality ?? "",
        seasons: item.seasons ?? [],
        occasions: item.occasions ?? [],
        notes: item.notes ?? "",
        imagePath: item.imagePath ?? undefined,
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
      category,
      colors = [],
      fit = "",
      size = "",
      formality = "",
      seasons = [],
      occasions = [],
      notes = "",
    } = body;

    if (!name || !category) {
      return NextResponse.json(
        { error: "name and category are required" },
        { status: 400 },
      );
    }

    const { WardrobeItem } = await initDatabase();

    const itemDoc = await WardrobeItem.create({
      user: userId,
      name: String(name).trim(),
      category: String(category).trim(),
      colors: Array.isArray(colors) ? colors : [],
      fit: String(fit || "").trim() || undefined,
      size: String(size || "").trim() || undefined,
      formality: String(formality || "").trim() || undefined,
      seasons: Array.isArray(seasons) ? seasons : [],
      occasions: Array.isArray(occasions) ? occasions : [],
      notes: String(notes || "").trim() || undefined,
    });

    return NextResponse.json(
      {
        item: {
          id: itemDoc._id.toString(),
          name: itemDoc.name,
          category: itemDoc.category,
          colors: itemDoc.colors ?? [],
          fit: itemDoc.fit ?? "",
          size: itemDoc.size ?? "",
          formality: itemDoc.formality ?? "",
          seasons: itemDoc.seasons ?? [],
          occasions: itemDoc.occasions ?? [],
          notes: itemDoc.notes ?? "",
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


