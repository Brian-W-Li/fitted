import { NextRequest, NextResponse } from "next/server";
import { initDatabase } from "@/lib/db";
import { adminAuth } from "@/lib/firebaseAdmin";

// ============================================================================
// AUTH HELPER
// ============================================================================

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

// ============================================================================
// POST - Save outfit feedback
// ============================================================================

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
    const {
      itemIds,
      feedbackType, // "like" or "dislike"
      eventDescription,
      environment, // { temperatureHint, weatherSummary }
      perItemFeedback, // [{ itemId, liked?, disliked?, notes?, layerRole? }]
      overallNotes,
      lockedItemIds,
      regenerated = false,
    } = body;

    if (!itemIds || !Array.isArray(itemIds) || itemIds.length === 0) {
      return NextResponse.json(
        { error: "itemIds array is required" },
        { status: 400 }
      );
    }

    if (!feedbackType || !["like", "dislike"].includes(feedbackType)) {
      return NextResponse.json(
        { error: "feedbackType must be 'like' or 'dislike'" },
        { status: 400 }
      );
    }

    const { UserOutfitFeedback } = await initDatabase();

    const feedback = await UserOutfitFeedback.create({
      user: userId,
      itemIds,
      feedbackType,
      eventDescription,
      environment,
      perItemFeedback,
      overallNotes,
      lockedItemIds,
      regenerated,
    });

    return NextResponse.json({
      success: true,
      feedbackId: feedback._id.toString(),
    });
  } catch (error) {
    console.error("Error saving feedback:", error);
    const message = error instanceof Error ? error.message : "Failed to save feedback";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ============================================================================
// GET - Get user's feedback history
// ============================================================================

export async function GET(request: NextRequest) {
  try {
    const userResult = await getUserIdFromRequest(request);
    if ("error" in userResult) {
      return NextResponse.json(
        { error: userResult.error },
        { status: userResult.status }
      );
    }

    const { userId } = userResult;
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get("limit") || "50");
    const type = searchParams.get("type"); // optional: "like" or "dislike"

    const { UserOutfitFeedback, WardrobeItem } = await initDatabase();

    const query: Record<string, unknown> = { user: userId };
    if (type && ["like", "dislike"].includes(type)) {
      query.feedbackType = type;
    }

    const feedbacks = await UserOutfitFeedback.find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate({
        path: "itemIds",
        model: WardrobeItem,
        select: "name category subCategory colors layerRole imagePath",
      })
      .lean()
      .exec();

    return NextResponse.json({ feedbacks });
  } catch (error) {
    console.error("Error fetching feedback:", error);
    const message = error instanceof Error ? error.message : "Failed to fetch feedback";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
