import { ExperienceValidationError } from "./errors";

// This is an experience-input limit, independent of the generation service's occasion contract.
export const MAX_WEAR_CONTEXT_LENGTH = 200;

export interface WearContext {
  rawOccasion: string;
  exactScopeKey: string | null;
  source: "user" | "suggestion";
  confirmed: boolean;
  version: 1;
}

function normalizeContext(raw: unknown, source: WearContext["source"], confirmed: boolean): WearContext {
  if (typeof raw !== "string" || raw.length > MAX_WEAR_CONTEXT_LENGTH) {
    throw new ExperienceValidationError("context", `Context must be text of at most ${MAX_WEAR_CONTEXT_LENGTH} characters`);
  }
  for (const char of raw) {
    const point = char.codePointAt(0)!;
    if (point < 0x20 || (point >= 0x7f && point <= 0x9f) || (point >= 0xd800 && point <= 0xdfff)) {
      throw new ExperienceValidationError("context", "Context contains control characters or invalid Unicode");
    }
  }
  const key = raw.trim().normalize("NFC");
  if (key.length > MAX_WEAR_CONTEXT_LENGTH) {
    throw new ExperienceValidationError("context", `Normalized context exceeds ${MAX_WEAR_CONTEXT_LENGTH} characters`);
  }
  const hasConfirmedContext = confirmed && key.length > 0;
  return {
    rawOccasion: raw,
    exactScopeKey: hasConfirmedContext ? key : null,
    source,
    confirmed: hasConfirmedContext,
    version: 1,
  };
}

/** Use only when the user explicitly supplies/edits their actual-wear context. */
export function userWearContext(raw: unknown): WearContext {
  return normalizeContext(raw, "user", true);
}

/** `raw` comes from the server-resolved source snapshot, never an echoed client suggestion. */
export function suggestedWearContext(raw: unknown, confirmed: boolean = false): WearContext {
  if (typeof confirmed !== "boolean") {
    throw new ExperienceValidationError("context", "Context confirmation must be a boolean");
  }
  return normalizeContext(raw, "suggestion", confirmed);
}
