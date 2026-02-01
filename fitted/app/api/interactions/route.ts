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

export async function POST(request: NextRequest) {
  try {
    const userResult = await getUserIdFromRequest(request);
    if ("error" in userResult) {
      return NextResponse.json(
        { error: userResult.error },
        { status: userResult.status }
      );
    }

    const { userId } = userResult;
    const body = await request.json();
    const { itemIds, action, occasion } = body;

    if (!itemIds || !Array.isArray(itemIds) || itemIds.length === 0) {
      return NextResponse.json(
        { error: "itemIds array is required" },
        { status: 400 }
      );
    }

    if (!action || !["accepted", "rejected"].includes(action)) {
      return NextResponse.json(
        { error: "action must be 'accepted' or 'rejected'" },
        { status: 400 }
      );
    }

    const { OutfitInteraction } = await initDatabase();

    const interaction = await OutfitInteraction.create({
      user: userId,
      items: itemIds,
      action: action,
      context: {
        occasion: occasion || "casual",
      },
    });

    return NextResponse.json({
      success: true,
      interaction: {
        id: interaction._id.toString(),
        action: interaction.action,
      },
    });
  } catch (error) {
    console.error("Error saving interaction:", error);
    return NextResponse.json(
      { error: "Failed to save interaction" },
      { status: 500 }
    );
  }
}
