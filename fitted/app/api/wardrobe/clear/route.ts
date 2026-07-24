import { NextRequest, NextResponse } from "next/server";
import { initDatabase } from "@/lib/db";
import { adminAuth } from "@/lib/firebaseAdmin";
import { clearUserWardrobe } from "@/lib/clearWardrobe";

export async function DELETE(request: NextRequest) {
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
      // A bad/expired token is a client auth failure (401), not a server fault (500). Without this
      // its own catch, verifyIdToken's throw falls to the generic catch below and mislabels as 500.
      return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
    }

    const { User, WardrobeItem, WardrobeImage, GenerationSnapshot } = await initDatabase();
    const user = await User.findOne({ authProvider: "firebase", authId: decoded.uid }).exec();
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 401 });
    }

    const deletedCount = await clearUserWardrobe(
      { WardrobeItem, WardrobeImage, GenerationSnapshot },
      user._id,
    );

    return NextResponse.json({ ok: true, deletedCount });
  } catch (error) {
    console.error("Error clearing wardrobe:", error);
    return NextResponse.json({ error: "Failed to clear wardrobe" }, { status: 500 });
  }
}
