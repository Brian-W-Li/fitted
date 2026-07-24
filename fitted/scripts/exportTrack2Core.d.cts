/**
 * Types for the CommonJS export-core (exportTrack2Core.cjs). Declares the Track-2 → M6 export-bundle
 * contract so `tests/exportTrack2.test.ts` gets real types on the returned manifest.
 */
/**
 * The exporter only duck-types `db.collection(name).find(...).toArray()` / `.findOne(...)`, so it is
 * typed structurally — decoupled from any specific driver/bson version (mongoose bundles its own).
 */
export interface DbLike {
  collection(name: string): {
    find(filter?: Record<string, unknown>): { toArray(): Promise<Record<string, unknown>[]> };
    findOne(filter: Record<string, unknown>): Promise<Record<string, unknown> | null>;
  };
}

export interface PerUserYield {
  accepted: number; rejected: number; imageUsableAccepted: number;
  primaryAcceptedScoreable: number; primaryRejectedScoreable: number;
  transferAcceptedScoreable: number; clothingTypeDepth: number;
}

export interface ExportManifest {
  bundleVersion: string;
  userFilter: string | null;
  exclusions: { operatorAuthId: string | null; operatorResolved: boolean; excludedUserCount: number };
  counts: {
    snapshots: number;
    wardrobeItems: number;
    interactionsRaw: number;
    interactionsLatest: number;
    trainingExamples: number;
    trainingExamplesLabeled: number;
    shownCandidateIdsUnmatched: number;
    labelsWithoutTrainingExample: number;
    imagesReferenced: number;
    imagesResolved: number;
    imagesUnresolved: number;
  };
  schemaNotes: {
    trainingTruth: string;
    label: string;
    redactedExcluded: boolean;
    redactedScope: string;
    imageRefFormat: string;
  };
  yield: {
    friends: number;
    cohortImageUsableAcceptedOutfits: number;
    prereg: string;
    floors: {
      primaryDecisionMinPerArm: number;
      transferInterpMin: number;
      transferDecisionMin: number;
      perFriendConcentrationCap: number;
      minCategoryDepthForNegative: number;
    };
    scoreableClusters: { acceptedScoreable: number; rejectedScoreable: number; transferAcceptedScoreable: number };
    concentration: { acceptedMaxShare: number; rejectedMaxShare: number; cap: number; capOk: boolean };
    primaryRead: { verdict: string; boundary: number; needPerArm: number; note: string };
    transferRead: { state: string; note: string };
    perUser: Record<string, PerUserYield>;
    excluded: { note: string; users: Record<string, PerUserYield & { reason: string }> };
  };
  imageManifest: Record<string, { status: "resolved" | "unresolved"; file?: string; contentType?: string; sizeBytes?: number }>;
}

export function exportTrack2(opts: {
  db: DbLike;
  outDir: string;
  userFilter: unknown | null;
  operatorAuthId?: string | null;
}): Promise<ExportManifest>;
export const BUNDLE_VERSION: string;
export const CERTIFICATE: {
  primaryDecisionMinPerArm: number;
  transferInterpMin: number;
  transferDecisionMin: number;
  perFriendConcentrationCap: number;
  minCategoryDepthForNegative: number;
};
/** A training-example row as `exportTrack2` builds them — the shape `buildCertificate` reads. */
export interface TrainingExampleLike {
  user?: string;
  label?: "accepted" | "rejected" | null;
  items: Array<{ itemId: string; clothingType?: string | null; imageStatus?: string }>;
  [key: string]: unknown;
}
export function buildCertificate(
  trainingExamples: TrainingExampleLike[],
  excludedUsers?: Map<string, string>,
): ExportManifest["yield"];
export function resolveExcludedUsers(
  db: DbLike,
  operatorAuthId: string | null,
): Promise<{ excluded: Map<string, string>; operatorResolved: boolean }>;
export function parseImageId(ref: unknown): string | null;

/** §23-H61 latest-state collapse per {snapshotId, candidateId}; mirror of lib/latestFeedbackState.ts. */
export interface LatestStateRowLike {
  snapshotId?: { toString(): string } | string | null;
  candidateId?: string | null;
  createdAt?: Date | string | number | null;
  _id?: { toString(): string } | string | null;
  [key: string]: unknown;
}
export function pickLatestPerCandidate<T extends LatestStateRowLike>(rows: Iterable<T>): Map<string, T>;
