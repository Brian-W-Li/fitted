import { NextRequest, NextResponse } from "next/server";
import { initDatabase } from "@/lib/db";
import { verifyFirebaseUser } from "@/lib/apiAuth";
import { clearUserWardrobe, WardrobeClearIncomplete } from "@/lib/clearWardrobe";

export async function DELETE(request: NextRequest) {
  try {
    const owner = await verifyFirebaseUser(request);
    if ("error" in owner) return NextResponse.json({ error: owner.error }, { status: owner.status });

    const { WardrobeItem, WardrobeImage, GenerationSnapshot } = await initDatabase();
    const receipt = await clearUserWardrobe(
      { WardrobeItem, WardrobeImage, GenerationSnapshot },
      owner.userId,
    );

    return NextResponse.json({ ok: true, ...receipt });
  } catch (error) {
    console.error("Error clearing wardrobe:", error);
    if (error instanceof WardrobeClearIncomplete) {
      return NextResponse.json({
        ok: false, error: error.receipt.itemsCleared === true
          ? "Wardrobe deletion completed, but photo cleanup is incomplete. Reload and retry."
          : "Wardrobe deletion may be incomplete. Reload the closet, then retry.",
        ...error.receipt,
      }, { status: 503 });
    }
    return NextResponse.json({ error: "Failed to clear wardrobe" }, { status: 500 });
  }
}
