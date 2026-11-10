import fs from "fs";
import path from "path";
import { PayloadContractError, validateSnapshotPayload } from "@/lib/mlSnapshotValidation";

const load = () => JSON.parse(fs.readFileSync(path.join(__dirname, "../../ml-system/tests/fixtures/m4b_e2e_snapshot.json"), "utf8"));

test.each([-0.5, 0.25, 0.5])("accepts a signed preference contribution %s in exact score arithmetic", (preference) => {
  const payload = load();
  const trace = payload.candidates[0].scoreTrace;
  trace.scoreBreakdown.preference = preference;
  trace.rankerScore += preference;
  expect(() => validateSnapshotPayload(payload)).not.toThrow();
});

test.each([Infinity, NaN, "0.1", null, 0.500001, -0.500001])("rejects malformed or unbounded preference %s", (preference) => {
  const payload = load();
  payload.candidates[0].scoreTrace.scoreBreakdown.preference = preference;
  expect(() => validateSnapshotPayload(payload)).toThrow(PayloadContractError);
});

test("rejects preference omitted from total while continuing to accept the legacy seven-term fixture", () => {
  expect(() => validateSnapshotPayload(load())).not.toThrow();
  const payload = load();
  payload.candidates[0].scoreTrace.scoreBreakdown.preference = 0.25;
  expect(() => validateSnapshotPayload(payload)).toThrow(PayloadContractError);
});

test.each(["x".repeat(61), 42])("rejects unusable captured subtype %s", (subtype) => {
  const payload = load();
  payload.itemSnapshots[0].engineVisible.subtype = subtype;
  expect(() => validateSnapshotPayload(payload)).toThrow(PayloadContractError);
});
