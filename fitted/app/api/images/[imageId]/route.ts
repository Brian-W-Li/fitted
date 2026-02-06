import { NextRequest, NextResponse } from "next/server";
import { initDatabase } from "@/lib/db";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ imageId: string }> }
) {
  const { imageId } = await params;

  const { WardrobeImage } = await initDatabase();
  const doc = await WardrobeImage.findById(imageId).exec();

  if (!doc) {
    return NextResponse.json({ error: "Image not found" }, { status: 404 });
  }

  const bytes = Buffer.from(doc.base64, "base64");

  return new NextResponse(bytes, {
    status: 200,
    headers: {
      "Content-Type": doc.contentType,
      "Cache-Control": "private, max-age=3600",
    },
  });
}