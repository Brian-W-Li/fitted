import { validateWearDate } from "@/lib/outfitExperience/date";
import { MAX_WEAR_CONTEXT_LENGTH, suggestedWearContext, userWearContext } from "@/lib/outfitExperience/context";
import { ExperienceValidationError } from "@/lib/outfitExperience/errors";

const NOW = new Date("2026-10-10T00:30:00.000Z");

describe("wear date contract", () => {
  it.each(["2026-02-29", "1900-02-29", "2026-04-31", "2026-00-10", "2026-13-01", "2026-01-00", "0000-01-01"])(
    "rejects impossible calendar date %s rather than normalizing it", (date) => {
      expect(() => validateWearDate(date, "UTC", NOW)).toThrow(ExperienceValidationError);
    },
  );

  it.each(["2000-02-29", "2024-02-29", "0001-01-01"])("accepts valid historical date %s", (date) => {
    expect(validateWearDate(date, "UTC", NOW).occurredOn).toBe(date);
  });

  it.each([null, 20261010, "2026-1-10", "2026-10-10\n", " 2026-10-10", "2026-10-10T00:00:00Z"])(
    "does not coerce non-calendar input %p", (date) => {
      expect(() => validateWearDate(date, "UTC", NOW)).toThrow(ExperienceValidationError);
    },
  );

  it("uses the wear timezone, not the server's UTC date, at midnight", () => {
    expect(validateWearDate("2026-10-09", "America/Los_Angeles", NOW)).toEqual({
      occurredOn: "2026-10-09", timezone: "America/Los_Angeles",
    });
    expect(() => validateWearDate("2026-10-10", "America/Los_Angeles", NOW)).toThrow("future");
    expect(validateWearDate("2026-10-10", "Asia/Tokyo", NOW).occurredOn).toBe("2026-10-10");
  });

  it("accepts a local date that is already tomorrow relative to UTC", () => {
    const now = new Date("2026-10-10T12:30:00Z");
    expect(validateWearDate("2026-10-11", "Pacific/Kiritimati", now).occurredOn).toBe("2026-10-11");
    expect(() => validateWearDate("2026-10-11", "UTC", now)).toThrow("future");
  });

  it.each(["2026-03-08T09:30:00Z", "2026-03-08T10:30:00Z"])(
    "handles the DST transition at %s without shifting the local date", (instant) => {
      expect(validateWearDate("2026-03-08", "America/Los_Angeles", new Date(instant)).occurredOn).toBe("2026-03-08");
    },
  );

  it.each([undefined, "", "Mars/Olympus", "+01:00", "-0800", " UTC", "UTC\n", "A".repeat(101)])(
    "rejects an invalid or missing named timezone %p", (zone) => {
      expect(() => validateWearDate("2026-01-01", zone, NOW)).toThrow(ExperienceValidationError);
    },
  );

  it("preserves a valid named alias without changing payload identity", () => {
    expect(validateWearDate("2026-01-01", "US/Pacific", NOW).timezone).toBe("US/Pacific");
  });

  it("distinguishes an invalid server clock from invalid user input", () => {
    expect(() => validateWearDate("2026-01-01", "UTC", new Date(NaN))).toThrow(RangeError);
  });
});

describe("actual-wear context contract", () => {
  it("keeps source context unconfirmed until the user explicitly confirms it", () => {
    expect(suggestedWearContext("Class")).toEqual({
      rawOccasion: "Class", exactScopeKey: null, source: "suggestion", confirmed: false, version: 1,
    });
    expect(suggestedWearContext("Class", true)).toMatchObject({
      exactScopeKey: "Class", source: "suggestion", confirmed: true,
    });
  });

  it("normalizes only the exact key, preserving display text and case", () => {
    const raw = "  Cafe\u0301  ";
    expect(userWearContext(raw)).toEqual({
      rawOccasion: raw, exactScopeKey: "Café", source: "user", confirmed: true, version: 1,
    });
    expect(userWearContext("café").exactScopeKey).not.toBe(userWearContext(raw).exactScopeKey);
  });

  it("does not merge internal spacing or synonyms", () => {
    expect(userWearContext("Office  day").exactScopeKey).toBe("Office  day");
    expect(userWearContext("Work").exactScopeKey).not.toBe(userWearContext("Office").exactScopeKey);
  });

  it.each(["", "   "])("treats blank %p as unknown, never confirmed or global", (raw) => {
    expect(userWearContext(raw)).toMatchObject({ exactScopeKey: null, confirmed: false });
    expect(suggestedWearContext(raw, true)).toMatchObject({ exactScopeKey: null, confirmed: false });
  });

  it("creates a new actual context without mutating suggestion provenance", () => {
    const source = Object.freeze(suggestedWearContext("Class"));
    const actual = userWearContext("Dinner");
    expect(actual).toMatchObject({ source: "user", exactScopeKey: "Dinner" });
    expect(source).toMatchObject({ source: "suggestion", rawOccasion: "Class", confirmed: false });
  });

  it("enforces the raw input limit before trimming, including surrogate pairs", () => {
    expect(userWearContext("x".repeat(MAX_WEAR_CONTEXT_LENGTH)).exactScopeKey).toHaveLength(MAX_WEAR_CONTEXT_LENGTH);
    expect(() => userWearContext(" ".repeat(MAX_WEAR_CONTEXT_LENGTH) + "x")).toThrow(ExperienceValidationError);
    expect(userWearContext("👕".repeat(100)).confirmed).toBe(true);
    expect(() => userWearContext("👕".repeat(101))).toThrow(ExperienceValidationError);
  });

  it("also bounds the key when canonical normalization expands the input", () => {
    // U+0344 decomposes to two combining marks even under NFC.
    expect(userWearContext("\u0344".repeat(100)).exactScopeKey).toHaveLength(200);
    expect(() => userWearContext("\u0344".repeat(101))).toThrow(ExperienceValidationError);
  });

  it.each([null, {}, "A\nB", "A\tB", "A\u0000B", "A\u0085B", "\ud800", "\udc00"])(
    "rejects invalid text %p without silently stripping it", (raw) => {
      expect(() => userWearContext(raw)).toThrow(ExperienceValidationError);
    },
  );

  it("rejects a truthy string masquerading as confirmation", () => {
    expect(() => suggestedWearContext("Class", "false" as unknown as boolean)).toThrow(ExperienceValidationError);
  });
});
