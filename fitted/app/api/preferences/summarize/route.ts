import { NextRequest, NextResponse } from "next/server";
import { initDatabase } from "@/lib/db";
import { adminAuth } from "@/lib/firebaseAdmin";
import { runPersonalizationSummarize } from "@/lib/runPersonalizationSummary";

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

// POST - Generate/update personalization summary from interactions' inferredWhy + current summary (Gemini)
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

    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json(
        { error: "GEMINI_API_KEY is required for preference summarization." },
        { status: 503 }
      );
    }

    const result = await runPersonalizationSummarize(userId);

    if (!result.success) {
      return NextResponse.json(
        {
          success: false,
          message: result.message ?? "Failed to generate preference summary.",
          feedbackCount: result.feedbackCount,
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      summary: {
        text: result.summaryText,
        feedbackCount: result.feedbackCount,
        updatedAt: result.updatedAt,
      },
    });
  } catch (error) {
    console.error("Error generating preference summary:", error);
    const message = error instanceof Error ? error.message : "Failed to generate preferences";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// GET - Get current preference summary and check if update needed
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
    const { PreferenceSummary, OutfitInteraction } = await initDatabase();

    const summary = await PreferenceSummary.findOne({ user: userId }).lean().exec();
    
    // Count new interactions since last update
    let newFeedbackCount = 0;
    if (summary) {
      newFeedbackCount = await OutfitInteraction.countDocuments({
        user: userId,
        action: { $in: ["accepted", "rejected"] },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        createdAt: { $gt: (summary as any).updatedAt },
      });
    } else {
      newFeedbackCount = await OutfitInteraction.countDocuments({
        user: userId,
        action: { $in: ["accepted", "rejected"] },
      });
    }

    return NextResponse.json({
      summary: summary ? {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        text: (summary as any).text,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        feedbackCount: (summary as any).feedbackCount,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        updatedAt: (summary as any).updatedAt,
      } : null,
      newFeedbackCount,
      needsUpdate: newFeedbackCount >= 5,
    });
  } catch (error) {
    console.error("Error fetching preference summary:", error);
    const message = error instanceof Error ? error.message : "Failed to fetch preferences";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// PATCH - Manually update preference summary text
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
    const { text } = await request.json();

    if (typeof text !== "string") {
      return NextResponse.json(
        { error: "text is required and must be a string" },
        { status: 400 }
      );
    }

    const trimmed = text.trim().slice(0, 2000);
    if (!trimmed) {
      return NextResponse.json(
        { error: "text cannot be empty" },
        { status: 400 }
      );
    }

    const { PreferenceSummary } = await initDatabase();
    const updated = await PreferenceSummary.findOneAndUpdate(
      { user: userId },
      {
        text: trimmed,
      },
      { upsert: true, new: true }
    ).lean().exec();

    return NextResponse.json({
      summary: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        text: (updated as any).text,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        feedbackCount: (updated as any).feedbackCount ?? 0,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        updatedAt: (updated as any).updatedAt,
      },
    });
  } catch (error) {
    console.error("Error updating preference summary:", error);
    const message = error instanceof Error ? error.message : "Failed to update preferences";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
