/** JS recompute of fitted_core.seed.candidate_cache_key (`_frame` = utf8-byte-length prefix;
 *  None → "-:" sentinel). Consumed by the gated corpusReadback verifier; pinned in CI by the
 *  known-answer vectors in crossRuntimeContract.test.ts (vectors computed by the real seed.py) —
 *  a framing change on either runtime reddens the pin instead of silently rotting the verifier.
 */
import { createHash } from "crypto";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

export function recomputeCandidateCacheKey(doc: Any): string {
  const frame = (v: string | number | null | undefined): string => {
    if (v == null) return "-:";
    const s = String(v);
    return `${Buffer.byteLength(s, "utf8")}:${s}`;
  };
  const canonical = [
    frame(doc.sessionId),
    frame(doc.wardrobeVersion),
    frame(doc.occasion),
    frame(doc.weather),
    frame(doc.intent),
    frame(doc.forcedItemId ?? null),
    frame(doc.seedDate ?? null),
  ].join("");
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}
