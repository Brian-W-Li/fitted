import { NextRequest, NextResponse } from "next/server";
import { initDatabase } from "@/lib/db";
import { adminAuth } from "@/lib/firebaseAdmin";

export async function DELETE(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Missing or invalid Authorization header" }, { status: 401 });
    }

    const idToken = authHeader.slice("Bearer ".length).trim();
    const decoded = await adminAuth.verifyIdToken(idToken);

    const { User, WardrobeItem } = await initDatabase();
    const user = await User.findOne({ authProvider: "firebase", authId: decoded.uid }).exec();
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 401 });
    }

    const result = await WardrobeItem.deleteMany({ user: user._id }).exec();

    return NextResponse.json({ ok: true, deletedCount: result.deletedCount ?? 0 });
  } catch (error) {
    console.error("Error clearing wardrobe:", error);
    return NextResponse.json({ error: "Failed to clear wardrobe" }, { status: 500 });
  }
}
