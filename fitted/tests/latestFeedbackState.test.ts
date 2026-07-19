/**
 * Cross-runtime pin (§23-H61): the TS History helper (`lib/latestFeedbackState.ts`) and the M6 export's
 * CJS picker (`scripts/exportTrack2Core.cjs`) MUST pick the same latest row per {snapshotId,candidateId}
 * over the SHARED fixture. The Python reducer is pinned to the same fixture in
 * `ml-system/tests/test_reducers.py::test_latest_state_matches_shared_cross_runtime_fixture`. Three
 * homes, one rule (max createdAt, tie-broken by _id hex desc) — if any drifts, the corpus label would
 * disagree with what the friend saw in History and what the engine acts on. See CLAUDE.md ("a
 * cross-runtime fact needs a test, not a copy").
 */
import { pickLatestPerCandidate as pickTs } from "@/lib/latestFeedbackState";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { pickLatestPerCandidate: pickCjs } = require("../scripts/exportTrack2Core.cjs") as typeof import("../scripts/exportTrack2Core.cjs");
import fixture from "./fixtures/latestFeedbackState.fixture.json";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

interface Winner {
  winnerId: string;
  action: string;
}

function keyOf(snapshotId: string, candidateId: string): string {
  return `${snapshotId}::${candidateId}`;
}

const expectedByKey = new Map<string, Winner>(
  (fixture.expected as Array<{ snapshotId: string; candidateId: string; winnerId: string; action: string }>).map(
    (e) => [keyOf(e.snapshotId, e.candidateId), { winnerId: e.winnerId, action: e.action }],
  ),
);

describe("latest-state cross-runtime pin (§23-H61)", () => {
  it("the TS helper picks the fixture's expected winners (unbound row dropped)", () => {
    const winners = pickTs(fixture.rows as Any[]);
    expect(winners).toHaveLength(expectedByKey.size); // the unbound (empty candidateId) row is dropped
    for (const row of winners) {
      const key = keyOf(String(row.snapshotId), String(row.candidateId));
      const want = expectedByKey.get(key);
      expect(want).toBeDefined();
      expect({ winnerId: String(row._id), action: row.action }).toEqual(want);
    }
  });

  it("the export's CJS picker agrees with the TS helper, winner-for-winner", () => {
    const cjsMap = pickCjs(fixture.rows) as Map<string, Any>;
    expect(cjsMap.size).toBe(expectedByKey.size);
    for (const [key, want] of expectedByKey) {
      const row = cjsMap.get(key);
      expect(row).toBeDefined();
      expect({ winnerId: String(row._id), action: row.action }).toEqual(want);
    }
  });
});

describe("participating-action gate + whitespace parity (audit hardening, reducer parity)", () => {
  // A future planned/packed write must NOT let a newest such row win the collapse (the reducer skips
  // it) — else the export would label it `planned` (outside accepted|rejected|null) and the History
  // card would vanish from both tabs. Gate here matches the reducer; pinned in TS + CJS.
  const withPlanned = [
    { _id: "aa0000000000000000000002", snapshotId: "s1", candidateId: "cP", action: "planned", createdAt: "2026-07-01T10:00:20.000Z" },
    { _id: "aa0000000000000000000001", snapshotId: "s1", candidateId: "cP", action: "accepted", createdAt: "2026-07-01T10:00:10.000Z", items: ["x"] },
  ];

  it("a newest non-{accepted,rejected} action does NOT win — the older accepted stands (TS + CJS)", () => {
    const ts = pickTs(withPlanned as Any[]);
    expect(ts).toHaveLength(1);
    expect(ts[0].action).toBe("accepted");

    const cjs = pickCjs(withPlanned) as Map<string, Any>;
    expect(cjs.size).toBe(1);
    expect([...cjs.values()][0].action).toBe("accepted");
  });

  it("a whitespace-only candidateId is unbound (dropped) in both impls (reducer .strip() parity)", () => {
    const ws = [{ _id: "bb0000000000000000000001", snapshotId: "s1", candidateId: "   ", action: "accepted", createdAt: "2026-07-01T10:00:10.000Z" }];
    expect(pickTs(ws as Any[])).toHaveLength(0);
    expect((pickCjs(ws) as Map<string, Any>).size).toBe(0);
  });
});
