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

export interface ExportManifest {
  bundleVersion: string;
  userFilter: string | null;
  counts: {
    snapshots: number;
    wardrobeItems: number;
    interactionsRaw: number;
    interactionsLatest: number;
    trainingExamples: number;
    trainingExamplesLabeled: number;
    imagesReferenced: number;
    imagesResolved: number;
    imagesUnresolved: number;
  };
  schemaNotes: {
    trainingTruth: string;
    label: string;
    redactedExcluded: boolean;
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
    perUser: Record<string, {
      accepted: number; rejected: number; imageUsableAccepted: number;
      primaryAcceptedScoreable: number; primaryRejectedScoreable: number;
      transferAcceptedScoreable: number; clothingTypeDepth: number;
    }>;
  };
  imageManifest: Record<string, { status: "resolved" | "unresolved"; file?: string; contentType?: string; sizeBytes?: number }>;
}

export function exportTrack2(opts: { db: DbLike; outDir: string; userFilter: unknown | null }): Promise<ExportManifest>;
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
export function buildCertificate(trainingExamples: TrainingExampleLike[]): ExportManifest["yield"];
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
