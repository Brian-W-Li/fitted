import { readFileSync } from "fs";
import { resolve } from "path";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { buildCertificate } = require("../scripts/exportTrack2Core.cjs") as typeof import("../scripts/exportTrack2Core.cjs");

describe("Track-2 Python/JS shared certificate fixture", () => {
  it("the real JS certificate remains byte-equivalent to the committed fixture yield", () => {
    const root = resolve(__dirname, "../../ml-system/experiments/track2_transfer/fixtures/synthetic_bundle");
    const rows = readFileSync(resolve(root, "training_examples.jsonl"), "utf8")
      .trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
    const manifest = JSON.parse(readFileSync(resolve(root, "manifest.json"), "utf8"));
    const actual = buildCertificate(rows, new Map([["operator_fixture", "operator"]]));
    expect(actual.scoreableClusters).toEqual(manifest.yield.scoreableClusters);
    expect(actual.concentration).toEqual(manifest.yield.concentration);
    expect(actual.perUser).toEqual(manifest.yield.perUser);
    expect(actual.excluded.users).toEqual(manifest.yield.excluded.users);
    expect(actual.primaryRead).toEqual(manifest.yield.primaryRead);
    expect(actual.transferRead).toEqual(manifest.yield.transferRead);
  });
});
