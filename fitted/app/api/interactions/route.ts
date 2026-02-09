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
    const action = searchParams.get("action"); // "accepted" or "rejected" or null for all

    const { OutfitInteraction } = await initDatabase();

    // Calculate date one month ago
    const oneMonthAgo = new Date();
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);

    // Build query - only show interactions from the past month
    const query: Record<string, unknown> = {
      user: userId,
      createdAt: { $gte: oneMonthAgo },
    };
    if (action && ["accepted", "rejected"].includes(action)) {
      query.action = action;
    } else {
      // Only return accepted and rejected (not other action types)
      query.action = { $in: ["accepted", "rejected"] };
    }

    // Fetch interactions with populated items
    const interactions = await OutfitInteraction.find(query)
      .populate({
        path: "items",
        select: "name category colors imagePath",
      })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean()
      .exec();

    // Format the response
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const formattedInteractions = interactions.map((interaction: any) => ({
      id: interaction._id.toString(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      items: interaction.items.map((item: any) => ({
        id: item._id.toString(),
        name: item.name,
        category: item.category,
        colors: item.colors || [],
        imagePath: item.imagePath,
      })),
      action: interaction.action,
      occasion: interaction.context?.occasion || "casual",
      createdAt: interaction.createdAt,
    }));

    return NextResponse.json({
      interactions: formattedInteractions,
    });
  } catch (error) {
    console.error("Error fetching interactions:", error);
    return NextResponse.json(
      { error: "Failed to fetch interactions" },
      { status: 500 }
    );
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

export async function DELETE(request: NextRequest) {
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
    const interactionId = searchParams.get("id");

    if (!interactionId) {
      return NextResponse.json(
        { error: "Interaction ID is required" },
        { status: 400 }
      );
    }

    const { OutfitInteraction } = await initDatabase();

    // Only delete if the interaction belongs to this user
    const result = await OutfitInteraction.findOneAndDelete({
      _id: interactionId,
      user: userId,
    });

    if (!result) {
      return NextResponse.json(
        { error: "Interaction not found or not authorized" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting interaction:", error);
    return NextResponse.json(
      { error: "Failed to delete interaction" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
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
    const { id, action } = body;

    if (!id) {
      return NextResponse.json(
        { error: "Interaction ID is required" },
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

    // Only update if the interaction belongs to this user
    const result = await OutfitInteraction.findOneAndUpdate(
      { _id: id, user: userId },
      { action },
      { new: true }
    );

    if (!result) {
      return NextResponse.json(
        { error: "Interaction not found or not authorized" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      interaction: {
        id: result._id.toString(),
        action: result.action,
      },
    });
  } catch (error) {
    console.error("Error updating interaction:", error);
    return NextResponse.json(
      { error: "Failed to update interaction" },
      { status: 500 }
    );
  }
}
