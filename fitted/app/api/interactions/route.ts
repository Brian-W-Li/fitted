import { NextRequest, NextResponse } from "next/server";
import { initDatabase } from "@/lib/db";
import { adminAuth } from "@/lib/firebaseAdmin";
import { inferWhyForInteraction } from "@/lib/gemini";

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
    const { itemIds, action, occasion, perItemFeedback, dislikedItemIds: bodyDislikedIds } = body;

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

    const { OutfitInteraction, WardrobeItem } = await initDatabase();

    // Normalize perItemFeedback from the request body
    type RawPerItemFeedback = { itemId?: unknown; disliked?: unknown; notes?: unknown };
    const normalizedPerItemFeedback = Array.isArray(perItemFeedback)
      ? (perItemFeedback as RawPerItemFeedback[])
          .filter((f) => f && typeof f.itemId === "string")
          .map((f) => ({
            itemId: f.itemId as string,
            disliked: Boolean(f.disliked),
            notes: typeof f.notes === "string" ? f.notes.slice(0, 500) : undefined,
          }))
      : undefined;

    console.info(JSON.stringify({
      event: "interaction_save_start",
      userId,
      action,
      itemCount: itemIds.length,
      hasPerItemFeedback: !!normalizedPerItemFeedback?.length,
    }));

    // Save immediately — do not block on Gemini
    const interaction = await OutfitInteraction.create({
      user: userId,
      items: itemIds,
      action,
      context: { occasion: occasion || "casual" },
      ...(normalizedPerItemFeedback?.length ? { perItemFeedback: normalizedPerItemFeedback } : {}),
    });

    console.info(JSON.stringify({
      event: "interaction_save_success",
      interactionId: interaction._id.toString(),
      action,
    }));

    // Return immediately — do not wait for Gemini inferWhy
    // inferWhy runs non-blocking and updates the interaction if it succeeds.
    // On Vercel serverless the runtime may not keep the process alive after the
    // response is sent, so inferWhy is best-effort rather than guaranteed.
    if (process.env.GEMINI_API_KEY) {
      void (async () => {
        try {
          const outfitItems = await WardrobeItem.find({ _id: { $in: itemIds }, user: userId })
            .select("name category subCategory colors pattern layerRole")
            .lean()
            .exec();

          const itemsForInference = (outfitItems as Record<string, unknown>[]).map((doc) => ({
            name: doc.name as string,
            category: doc.category as string,
            subCategory: doc.subCategory as string | undefined,
            colors: doc.colors as string[],
            pattern: doc.pattern as string | undefined,
            layerRole: doc.layerRole as string | undefined,
          }));

          const dislikedIdsSet = new Set(Array.isArray(bodyDislikedIds) ? bodyDislikedIds.map(String) : []);
          const dislikedItemNames = (outfitItems as Record<string, unknown>[])
            .filter((d) => dislikedIdsSet.has(String((d as { _id: unknown })._id)))
            .map((d) => (d.name as string) || "Item");

          console.info(JSON.stringify({ event: "gemini_infer_why_queued", interactionId: interaction._id.toString() }));

          const inferredWhy = await inferWhyForInteraction({
            action: action === "accepted" ? "accepted" : "rejected",
            occasion: occasion || "casual",
            items: itemsForInference,
            dislikedItemNames: dislikedItemNames.length > 0 ? dislikedItemNames : undefined,
          });

          if (inferredWhy) {
            await OutfitInteraction.findByIdAndUpdate(interaction._id, { inferredWhy }).exec();
            console.info(JSON.stringify({ event: "gemini_infer_why_saved", interactionId: interaction._id.toString() }));
          }
        } catch (e) {
          console.error(JSON.stringify({ event: "gemini_infer_why_pipeline_error", message: (e as Error)?.message }));
        }
      })();
    }

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
