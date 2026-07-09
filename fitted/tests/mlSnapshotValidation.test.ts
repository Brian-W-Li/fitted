/**
 * M5 payload validation helper (C5 seam #5b) — the anti-corpus-lie boundary.
 *
 * The "valid" baseline is the committed Python-produced fixture (m4b_e2e_snapshot.json): the helper
 * ACCEPTS it AND a real Mongo write of it succeeds — tying helper-accept to persist-success so the
 * helper can't drift into rejecting real payloads. Then each invalid class is a MUTATION of that
 * same real payload, so the rejections are grounded in the actual wire shape, not a hand-built
 * strawman.
 *
 * Reference: docs/plans/m5-cutover.md §G validation helper + §G.1 (G11/G12/G13).
 */
import fs from "fs";
import path from "path";
import { Types } from "mongoose";
import GenerationSnapshot from "@/models/GenerationSnapshot";
import { validateSnapshotPayload, PayloadContractError } from "@/lib/mlSnapshotValidation";
import { startMemoryMongo, type MongoHarness } from "./helpers/mongoHarness";

const FIXTURE = path.join(__dirname, "../../ml-system/tests/fixtures/m4b_e2e_snapshot.json");
const load = () => JSON.parse(fs.readFileSync(FIXTURE, "utf8")) as Record<string, unknown>;
// deep clone so each mutation is isolated
const clone = () => JSON.parse(JSON.stringify(load())) as Any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

let harness: MongoHarness;
beforeAll(async () => {
  harness = await startMemoryMongo([GenerationSnapshot]);
}, 120_000);
afterAll(async () => await harness.stop());
afterEach(async () => await harness.clear());

const expectReject = (mutate: (p: Any) => void) => {
  const p = clone();
  mutate(p);
  expect(() => validateSnapshotPayload(p)).toThrow(PayloadContractError);
};

// ---------------------------------------------------------------------------
describe("accepts the real Python fixture — and it persists", () => {
  it("validateSnapshotPayload passes the committed fixture", () => {
    expect(() => validateSnapshotPayload(load())).not.toThrow();
  });

  it("the same validated payload writes to real Mongo (accept ⇔ persistable)", async () => {
    const doc = { ...load(), user: new Types.ObjectId(), interactionCountAtRequest: 0 };
    validateSnapshotPayload(doc); // gate first, as the route does
    const created = await GenerationSnapshot.create(doc);
    expect(await GenerationSnapshot.findById(created._id).lean()).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe("scoreTrace algebra + coverage (G12)", () => {
  it("rejects compatibility out of [0,1] on a scored candidate", () => {
    expectReject((p) => (p.candidates[0].scoreTrace.compatibility = 1.4));
  });
  it("rejects visibility out of [0,1] on a scored candidate", () => {
    expectReject((p) => (p.candidates[0].scoreTrace.visibility = 1.4));
  });
  it("rejects a non-finite rankerScore", () => {
    // Infinity fails the isFiniteNum(rankerScore) guard before the term-sum check is reached.
    expectReject((p) => (p.candidates[0].scoreTrace.rankerScore = Infinity));
  });
  it("rejects a broken term-sum (rankerScore != sum)", () => {
    expectReject((p) => (p.candidates[0].scoreTrace.rankerScore = 999));
  });
  it("rejects a missing score term", () => {
    expectReject((p) => delete p.candidates[0].scoreTrace.scoreBreakdown.combo);
  });
  it("does NOT require a scoreTrace on a breakdown-less drop (c5 generated-stage)", () => {
    // c5 already has no breakdown in the fixture; assert the baseline stays valid (coverage key).
    expect(() => validateSnapshotPayload(load())).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
describe("corpus-integrity finite guards (Mongoose stores ±Infinity silently)", () => {
  it("rejects a non-finite engineVisible.warmth (would poison the ranker's ML feature)", () => {
    expectReject((p) => (p.itemSnapshots[0].engineVisible.warmth = Infinity));
  });
  it("rejects an out-of-range engineVisible.warmth (> 10)", () => {
    expectReject((p) => (p.itemSnapshots[0].engineVisible.warmth = 11));
  });
  it("rejects a non-finite rankerScore on a breakdown-LESS trace (the early-return gap)", () => {
    // c4 = validated, normally no trace/breakdown; a bare rankerScore must still be finite.
    expectReject((p) => (p.candidates[4].scoreTrace = { rankerScore: Infinity }));
  });
  it("rejects a non-finite signalScore (the reserved M6-scorer label slot)", () => {
    expectReject((p) => (p.candidates[4].scoreTrace = { signalScore: Infinity }));
  });
});

// ---------------------------------------------------------------------------
describe("identity + coverage", () => {
  it("rejects a duplicate candidateId", () => {
    expectReject((p) => (p.candidates[1].candidateId = p.candidates[0].candidateId));
  });
  it("rejects a duplicate itemSnapshots itemId", () => {
    expectReject((p) => (p.itemSnapshots[1].itemId = p.itemSnapshots[0].itemId));
  });
  it("rejects a candidate item id absent from itemSnapshots (shown OR unshown)", () => {
    expectReject((p) => (p.candidates[3].items[0].itemId = "ghostitem")); // c3 is unshown/ranked
  });
  it("rejects a slotMap value absent from itemSnapshots", () => {
    expectReject((p) => (p.candidates[0].slotMap.top = "ghosttop"));
  });
  it("rejects items[]↔slotMap divergence (same item set, wrong slot assignment)", () => {
    // c0 items say b1 fills bottom; point slotMap.bottom at a different real wardrobe item.
    expectReject((p) => (p.candidates[0].slotMap.bottom = "b2"));
  });
  it("rejects a scoreTrace with garbage compatibility even when it carries no breakdown", () => {
    expectReject((p) => {
      p.candidates[4].scoreTrace = { compatibility: 1.7 }; // c4 = validated, normally no trace
    });
  });
  it("rejects a generated non-accepted bare candidate with neither items+slotMap nor rawEmitted", () => {
    expectReject((p) => {
      const rejected = p.candidates.find((c: Any) => c.candidateId === "c5");
      delete rejected.rawEmitted;
      rejected.items = [];
      rejected.slotMap = null;
    });
  });
});

// ---------------------------------------------------------------------------
describe("shown-set exactness (not subset)", () => {
  it("rejects a shownCandidateIds that drops one shown candidate (subset)", () => {
    expectReject((p) => p.shownCandidateIds.pop());
  });
  it("rejects a non-contiguous shownPosition", () => {
    expectReject((p) => {
      const shown = p.candidates.find((c: Any) => c.shownPosition === 0);
      shown.shownPosition = 5;
    });
  });
  it("rejects an nSurfaced that disagrees with the shown count", () => {
    expectReject((p) => (p.nSurfaced = 2));
  });
  it("rejects a shownFullSignatures out of shownPosition order", () => {
    expectReject((p) => {
      const s = p.shownFullSignatures;
      [s[0], s[1]] = [s[1], s[0]];
    });
  });
});

// ---------------------------------------------------------------------------
describe("styleMove + template (G11)", () => {
  it("rejects changedItemIds referencing a non-candidate item", () => {
    expectReject((p) => p.candidates[0].styleMove.changedItemIds.push("b3")); // b3 not in c0's items
  });
  it("rejects a blank moveType", () => {
    expectReject((p) => (p.candidates[0].styleMove.moveType = "  "));
  });
  it("rejects a blank oneSentence", () => {
    expectReject((p) => (p.candidates[0].styleMove.oneSentence = "  "));
  });
  it("rejects non-unique changedItemIds", () => {
    expectReject((p) => {
      const c = p.candidates[0];
      c.styleMove.changedItemIds = [c.items[0].itemId, c.items[0].itemId];
    });
  });
  it("rejects a template inconsistent with the slotMap (top+bottom slots but one_piece)", () => {
    // Mutate the TEMPLATE, not the slotMap: setting slotMap={dress:...} trips the EARLIER items↔
    // slotMap consistency check and never reaches validateTemplate (the trap the old test fell into,
    // so the template branch had no real coverage). c0 is a real top+bottom candidate, so declaring
    // it one_piece is inconsistent. Assert the message so this proves it fails on the template
    // branch, not incidentally on some earlier check.
    const p = clone();
    p.candidates[0].template = "one_piece";
    expect(() => validateSnapshotPayload(p)).toThrow(/template/);
  });
});

// ---------------------------------------------------------------------------
describe("engineFailure sanitize (G13)", () => {
  const withEf = (ef: Any) => (p: Any) => ((p.diagnostics ??= {}).engineFailure = ef);
  it("rejects an out-of-set stage", () => {
    expectReject(withEf({ stage: "teleport", code: "parse_fail", message: "ok" }));
  });
  it("rejects an out-of-set code", () => {
    expectReject(withEf({ stage: "parse", code: "kaboom", message: "ok" }));
  });
  it("rejects a stack-trace message", () => {
    expectReject(withEf({ stage: "parse", code: "parse_fail", message: 'Traceback (most recent call last):\n  File "x"' }));
  });
  it("rejects an over-long message", () => {
    expectReject(withEf({ stage: "parse", code: "parse_fail", message: "x".repeat(301) }));
  });
  it("rejects a key-shaped detail.itemId (not 24-hex)", () => {
    expectReject(withEf({ stage: "parse", code: "parse_fail", message: "ok", detail: { itemId: "not-hex" } }));
  });
  it("accepts a well-formed engineFailure", () => {
    const p = clone();
    p.diagnostics.engineFailure = {
      stage: "parse", code: "parse_fail", message: "GPT output failed JSON repair",
      messageTruncated: false, detail: { itemId: new Types.ObjectId().toHexString(), count: 3 },
    };
    expect(() => validateSnapshotPayload(p)).not.toThrow();
  });
});
