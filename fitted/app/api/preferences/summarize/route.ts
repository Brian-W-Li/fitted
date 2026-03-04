import { NextRequest, NextResponse } from "next/server";
import { initDatabase } from "@/lib/db";
import { adminAuth } from "@/lib/firebaseAdmin";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

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
// Types
// ============================================================================

interface FeedbackItem {
  id: string;
  name: string;
  category: string;
  subCategory?: string;
  colors?: string[];
  layerRole?: string;
}

interface FeedbackRecord {
  feedbackType: "like" | "dislike";
  eventDescription?: string;
  temperatureHint?: string;
  items: FeedbackItem[];
  dislikedItems?: string[];
  overallNotes?: string;
  itemNotes?: Record<string, string>;
}

// ============================================================================
// POST - Generate/update preference summary
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

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: "OpenAI API key is required for preference summarization." },
        { status: 503 }
      );
    }

    const { UserOutfitFeedback, WardrobeItem, PreferenceSummary } = await initDatabase();

    // Fetch recent feedback (last 50 records or last 90 days)
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const feedbacks = await UserOutfitFeedback.find({
      user: userId,
      createdAt: { $gte: ninetyDaysAgo },
    })
      .sort({ createdAt: -1 })
      .limit(50)
      .populate({
        path: "itemIds",
        model: WardrobeItem,
        select: "name category subCategory colors layerRole",
      })
      .lean()
      .exec();

    if (feedbacks.length < 3) {
      return NextResponse.json({
        success: false,
        message: "Not enough feedback to generate preferences. Need at least 3 interactions.",
        feedbackCount: feedbacks.length,
      });
    }

    // Transform feedback into a format suitable for summarization
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const feedbackRecords: FeedbackRecord[] = feedbacks.map((fb: any) => {
      const items = (fb.itemIds || []).map((item: FeedbackItem) => ({
        name: item.name,
        category: item.category,
        subCategory: item.subCategory,
        colors: item.colors,
        layerRole: item.layerRole,
      }));

      const dislikedItems = (fb.perItemFeedback || [])
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .filter((pif: any) => pif.disliked)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((pif: any) => {
          const item = items.find((i: FeedbackItem) => i.id === pif.itemId?.toString());
          return item?.name || pif.itemId?.toString();
        });

      const itemNotes: Record<string, string> = {};
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (fb.perItemFeedback || []).forEach((pif: any) => {
        if (pif.notes) {
          const item = items.find((i: FeedbackItem) => i.id === pif.itemId?.toString());
          if (item) {
            itemNotes[item.name] = pif.notes;
          }
        }
      });

      return {
        feedbackType: fb.feedbackType,
        eventDescription: fb.eventDescription,
        temperatureHint: fb.environment?.temperatureHint,
        items,
        dislikedItems: dislikedItems.length > 0 ? dislikedItems : undefined,
        overallNotes: fb.overallNotes,
        itemNotes: Object.keys(itemNotes).length > 0 ? itemNotes : undefined,
      };
    });

    // Generate summary with GPT
    const systemMessage = `You are summarizing a user's clothing preferences based on feedback they gave to an outfit recommendation app. 
    
Your job is to identify clear patterns in what they like and dislike. Be specific about:
- Colors they prefer/avoid
- Styles and fits they like/dislike
- Layering preferences
- Formality preferences for different occasions
- Temperature/weather preferences

Avoid overfitting to single examples. Only mention patterns that appear multiple times.`;

    const userMessage = `Here are the user's recent outfit feedback records:

${JSON.stringify(feedbackRecords, null, 2)}

Based on these ${feedbacks.length} feedback records, summarize the user's preferences in 3-5 bullet points. Each bullet should capture a meaningful pattern about their style preferences.

Format your response as a simple list with each bullet on its own line starting with "- ".`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemMessage },
        { role: "user", content: userMessage }
      ],
      temperature: 0.3,
      max_tokens: 500,
    });

    const summaryText = completion.choices[0]?.message?.content?.trim() || "";

    if (!summaryText) {
      return NextResponse.json({
        success: false,
        message: "Failed to generate preference summary.",
      });
    }

    // Upsert the preference summary
    const updated = await PreferenceSummary.findOneAndUpdate(
      { user: userId },
      {
        text: summaryText,
        feedbackCount: feedbacks.length,
        lastFeedbackAt: feedbacks[0]?.createdAt,
      },
      { upsert: true, new: true }
    );

    return NextResponse.json({
      success: true,
      summary: {
        text: summaryText,
        feedbackCount: feedbacks.length,
        updatedAt: updated.updatedAt,
      },
    });
  } catch (error) {
    console.error("Error generating preference summary:", error);
    const message = error instanceof Error ? error.message : "Failed to generate preferences";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ============================================================================
// GET - Get current preference summary
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
    const { PreferenceSummary, UserOutfitFeedback } = await initDatabase();

    const summary = await PreferenceSummary.findOne({ user: userId }).lean().exec();
    
    // Also get the count of new feedback since last update
    let newFeedbackCount = 0;
    if (summary) {
      newFeedbackCount = await UserOutfitFeedback.countDocuments({
        user: userId,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        createdAt: { $gt: (summary as any).updatedAt },
      });
    } else {
      newFeedbackCount = await UserOutfitFeedback.countDocuments({ user: userId });
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
