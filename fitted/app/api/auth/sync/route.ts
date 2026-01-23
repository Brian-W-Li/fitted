import { NextRequest, NextResponse } from "next/server";
import { initDatabase } from "@/lib/db";

/**
 * POST /api/auth/sync
 * Sync Firebase user to MongoDB
 * 
 * Body: { firebaseUid: string, email: string, displayName?: string, photoURL?: string }
 * 
 * Creates new user if doesn't exist, or returns existing user
 */
export async function POST(request: NextRequest) {
  try {
    const { firebaseUid, email, displayName, photoURL } = await request.json();

    if (!firebaseUid || !email) {
      return NextResponse.json(
        { error: "firebaseUid and email are required" },
        { status: 400 }
      );
    }

    const { User } = await initDatabase();

    // Check if user already exists
    let user = await User.findOne({
      authProvider: "firebase",
      authId: firebaseUid,
    });

    if (!user) {
      // Create new user (handles both signup and new user signing in)
      user = await User.create({
        authProvider: "firebase",
        authId: firebaseUid,
        email,
        displayName: displayName || undefined,
        photoURL: photoURL || undefined,
      });
    }
    // If user exists, just return it (no update needed)

    return NextResponse.json({
      userId: user._id.toString(),
      user: {
        id: user._id.toString(),
        email: user.email,
        displayName: user.displayName,
      },
    });
  } catch (error) {
    console.error("Error syncing user:", error);
    return NextResponse.json(
      { error: "Failed to sync user" },
      { status: 500 }
    );
  }
}

