import { NextRequest, NextResponse } from "next/server";
import { initDatabase } from "@/lib/db";
import { adminAuth } from "@/lib/firebaseAdmin";

/**
 * POST /api/auth/sync — first-login upsert of the Firebase user into Mongo.
 *
 * §I gate: the identity (`authId`) is derived ONLY from the verified Firebase ID token, never from a
 * body `firebaseUid` — otherwise a caller could mint/return a row for someone else's uid. This route
 * cannot use the shared `verifyFirebaseUser` helper because it runs BEFORE the Mongo user exists (the
 * helper 404s on an absent user); it verifies the token directly and upserts. `displayName`/`photoURL`
 * are non-sensitive profile fields taken from the body; `authId`/`email` come from the token.
 */
export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Missing or invalid Authorization header" }, { status: 401 });
    }
    const idToken = authHeader.slice("Bearer ".length).trim();

    let decoded;
    try {
      decoded = await adminAuth.verifyIdToken(idToken);
    } catch {
      return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
    }

    const firebaseUid = decoded.uid;
    const body = (await request.json().catch(() => ({}))) as {
      email?: string;
      displayName?: string;
      photoURL?: string;
    };
    // Email from the verified token when present (Google sign-in always has it); fall back to the
    // body only as a descriptive field — identity is `authId`, which is always token-derived.
    const email = decoded.email ?? body.email;
    if (!email) {
      return NextResponse.json({ error: "email is required" }, { status: 400 });
    }

    const { User } = await initDatabase();
    let user = await User.findOne({ authProvider: "firebase", authId: firebaseUid });
    if (!user) {
      user = await User.create({
        authProvider: "firebase",
        authId: firebaseUid,
        email,
        displayName: body.displayName || undefined,
        photoURL: body.photoURL || undefined,
      });
    }

    return NextResponse.json({
      userId: user._id.toString(),
      user: { id: user._id.toString(), email: user.email, displayName: user.displayName },
    });
  } catch (error) {
    console.error("Error syncing user:", error);
    return NextResponse.json({ error: "Failed to sync user" }, { status: 500 });
  }
}
