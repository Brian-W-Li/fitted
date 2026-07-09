import { createHash } from "crypto";
import { buildSnapshotDoc } from "@/lib/mlSnapshotMerge";
import { PayloadContractError } from "@/lib/mlSnapshotValidation";
import {
  RAW_ATTRIBUTES_CAP_BYTES,
  RAW_EMITTED_CAP_BYTES,
  RAW_TEXT_CAP_BYTES,
} from "@/models/GenerationSnapshot";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

function sha256Utf8(value: unknown): string {
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  return createHash("sha256").update(Buffer.from(serialized, "utf8")).digest("hex");
}

describe("buildSnapshotDoc raw-field caps", () => {
  it("truncates rawText/rawEmitted/rawAttributes and records original bytes + hashes", () => {
    const rawText = "x".repeat(RAW_TEXT_CAP_BYTES + 1);
    const rawEmitted = { raw: "y".repeat(RAW_EMITTED_CAP_BYTES + 1) };
    const rawAttributes = { raw: "z".repeat(RAW_ATTRIBUTES_CAP_BYTES + 1) };

    const doc = buildSnapshotDoc({
      payload: {
        itemSnapshots: [{ itemId: "i1", engineVisible: { name: "Item" } }],
        generationAttempts: [{ attemptId: "a0", rawText }],
        candidates: [{ candidateId: "c0", rawEmitted }],
      },
      snapshotId: "s1",
      user: "u1",
      interactionCountAtRequest: 7,
      wardrobeById: new Map([
        ["i1", { metadata: rawAttributes }],
      ]),
    }) as Any;

    const attempt = doc.generationAttempts[0];
    expect(attempt.rawTextBytes).toBe(RAW_TEXT_CAP_BYTES + 1);
    expect(attempt.rawTextHash).toBe(sha256Utf8(rawText));
    expect(attempt.rawTextTruncated).toBe(true);
    expect(Buffer.byteLength(attempt.rawText, "utf8")).toBe(RAW_TEXT_CAP_BYTES);

    const candidate = doc.candidates[0];
    expect(candidate.rawEmittedBytes).toBe(Buffer.byteLength(JSON.stringify(rawEmitted), "utf8"));
    expect(candidate.rawEmittedHash).toBe(sha256Utf8(rawEmitted));
    expect(candidate.rawEmittedTruncated).toBe(true);
    expect(Buffer.byteLength(candidate.rawEmitted, "utf8")).toBe(RAW_EMITTED_CAP_BYTES);

    const evidence = doc.itemSnapshots[0].evidence;
    expect(evidence.rawAttributesBytes).toBe(Buffer.byteLength(JSON.stringify(rawAttributes), "utf8"));
    expect(evidence.rawAttributesHash).toBe(sha256Utf8(rawAttributes));
    expect(evidence.rawAttributesTruncated).toBe(true);
    expect(Buffer.byteLength(evidence.rawAttributes, "utf8")).toBe(RAW_ATTRIBUTES_CAP_BYTES);
  });

  it("rejects schema-known fields the M5 service is not allowed to author", () => {
    expect(() =>
      buildSnapshotDoc({
        payload: {
          sessionId: "u1",
          requestId: "0192f1a0-1c1a-4c3e-9b2a-1a2b3c4d5e6f",
          baseOutfitItemIds: ["future-field"],
          itemSnapshots: [],
          generationAttempts: [],
          candidates: [],
        },
        snapshotId: "s1",
        user: "u1",
        interactionCountAtRequest: 0,
        wardrobeById: new Map(),
      }),
    ).toThrow(PayloadContractError);
  });
});
