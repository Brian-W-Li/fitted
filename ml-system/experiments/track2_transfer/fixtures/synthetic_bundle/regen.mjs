#!/usr/bin/env node
/* Recompute the fixture certificate through the real JS exporter implementation. */
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { buildCertificate, CERTIFICATE } = require(resolve(here, "../../../../../fitted/scripts/exportTrack2Core.cjs"));
const rows = readFileSync(resolve(here, "training_examples.jsonl"), "utf8")
  .trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
const excluded = new Map([["operator_fixture", "operator"]]);
const yieldBlock = buildCertificate(rows, excluded);
const imageManifest = {};
for (const row of rows) {
  for (const item of row.items) {
    const id = item.imageRef.slice("mongo:".length);
    imageManifest[id] = { status: "resolved", file: item.imageFile, contentType: "image/png" };
  }
}
const manifest = {
  bundleVersion: "track2-export.v1",
  userFilter: null,
  exclusions: {
    operatorAuthIds: ["fixture-operator-auth-id"],
    operatorResolution: [{ authId: "fixture-operator-auth-id", resolved: true }],
    operatorResolved: true,
    excludedUserCount: 1,
  },
  counts: {
    snapshots: rows.length, wardrobeItems: Object.keys(imageManifest).length,
    interactionsRaw: rows.length, interactionsLatest: rows.length,
    trainingExamples: rows.length, trainingExamplesLabeled: rows.length,
    shownCandidateIdsUnmatched: 0, labelsWithoutTrainingExample: 0,
    imagesReferenced: Object.keys(imageManifest).length,
    imagesResolved: Object.keys(imageManifest).length, imagesUnresolved: 0,
    itemSlotsWithoutImageRef: 0, labeledExamplesNotImageUsable: 0,
  },
  schemaNotes: { fixture: true },
  yield: yieldBlock,
  imageManifest,
  fixtureCertificateConstants: CERTIFICATE,
};
const encoded = JSON.stringify(manifest, null, 2) + "\n";
writeFileSync(resolve(here, "manifest.json"), encoded);
mkdirSync(resolve(here, "generated"), { recursive: true });
writeFileSync(resolve(here, "generated/manifest.json"), encoded);
console.log(`wrote manifest with ${yieldBlock.scoreableClusters.acceptedScoreable}/${yieldBlock.scoreableClusters.rejectedScoreable}`);
