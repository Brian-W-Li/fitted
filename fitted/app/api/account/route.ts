import { NextRequest, NextResponse } from "next/server";
import { initDatabase } from "@/lib/db";

function parseAge(value: unknown): number | null {
  if (value === "" || value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const i = Math.floor(n);
  if (i < 0 || i > 130) return null;
  return i;
}

const ALLOWED_GENDERS = new Set([
  "male",
  "female",
  "nonbinary",
  "other",
  "prefer_not_to_say",
]);

export async function POST(request: NextRequest) {
  try {
    const { firebaseUid } = await request.json();
    if (!firebaseUid) {
      return NextResponse.json({ error: "firebaseUid is required" }, { status: 400 });
    }

    const { User } = await initDatabase();
    const user = await User.findOne({
      authProvider: "firebase",
      authId: firebaseUid,
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    return NextResponse.json({
      user: {
        id: user._id.toString(),
        email: user.email,
        displayName: user.displayName ?? null,
        photoURL: user.photoURL ?? null,
        age: user.metadata?.get("age") ?? null,
        gender: user.metadata?.get("gender") ?? null,
        createdAt: user.createdAt ?? null,
        updatedAt: user.updatedAt ?? null,
      },
    });
  } catch (error) {
    console.error("Error fetching account:", error);
    return NextResponse.json({ error: "Failed to fetch account" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { firebaseUid, age, gender } = await request.json();
    if (!firebaseUid) {
      return NextResponse.json({ error: "firebaseUid is required" }, { status: 400 });
    }

    const ageParsed = parseAge(age);

    let genderParsed: string | null = null;
    if (gender === "" || gender === null || gender === undefined) {
      genderParsed = null;
    } else if (typeof gender === "string" && ALLOWED_GENDERS.has(gender)) {
      genderParsed = gender;
    } else {
      return NextResponse.json({ error: "Invalid gender value" }, { status: 400 });
    }

    const { User } = await initDatabase();
    const user = await User.findOne({
      authProvider: "firebase",
      authId: firebaseUid,
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    if (ageParsed === null) user.metadata?.delete("age");
    else user.metadata?.set("age", ageParsed);

    if (genderParsed === null) user.metadata?.delete("gender");
    else user.metadata?.set("gender", genderParsed);

    await user.save();

    return NextResponse.json({
      user: {
        id: user._id.toString(),
        email: user.email,
        displayName: user.displayName ?? null,
        photoURL: user.photoURL ?? null,
        age: user.metadata?.get("age") ?? null,
        gender: user.metadata?.get("gender") ?? null,
        createdAt: user.createdAt ?? null,
        updatedAt: user.updatedAt ?? null,
      },
    });
  } catch (error) {
    console.error("Error updating account:", error);
    return NextResponse.json({ error: "Failed to update account" }, { status: 500 });
  }
}
