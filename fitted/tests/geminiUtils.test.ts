import { isValidPreferenceSummary } from "@/lib/gemini";

// ---------------------------------------------------------------------------
// isValidPreferenceSummary
// ---------------------------------------------------------------------------

describe("isValidPreferenceSummary", () => {
  // ---- valid inputs ----

  it("accepts a well-formed bullet-point profile", () => {
    const text = `- Prefers slim-fit trousers in neutral tones\n- Tends to avoid heavy winter coats for mild occasions\n- Likes layering with cardigans`;
    expect(isValidPreferenceSummary(text)).toBe(true);
  });

  it("accepts a profile with leading/trailing whitespace", () => {
    const text = `\n\n- Prefers casual smart looks\n- Avoids bold patterns\n\n`;
    expect(isValidPreferenceSummary(text)).toBe(true);
  });

  it("accepts a minimal single-bullet profile above the length threshold", () => {
    const text = "- Prefers casual looks";
    expect(isValidPreferenceSummary(text)).toBe(true);
  });

  // ---- invalid: too short or empty ----

  it("rejects an empty string", () => {
    expect(isValidPreferenceSummary("")).toBe(false);
  });

  it("rejects a whitespace-only string", () => {
    expect(isValidPreferenceSummary("   \n\t  ")).toBe(false);
  });

  it("rejects text shorter than 20 characters", () => {
    expect(isValidPreferenceSummary("- Short")).toBe(false);
  });

  it("rejects text of exactly 19 characters (just under threshold)", () => {
    // 19 chars: "- Prefers blue top\n" minus the newline = 18 chars; make exact
    const text = "- Short text here.x"; // 19 chars
    expect(text.trim().length).toBe(19);
    expect(isValidPreferenceSummary(text)).toBe(false);
  });

  // ---- invalid: refusal/apology patterns ----

  it("rejects text starting with \"I'm sorry\"", () => {
    const text = "I'm sorry, I can't generate a profile without enough data.";
    expect(isValidPreferenceSummary(text)).toBe(false);
  });

  it("rejects text starting with \"I cannot\" (case-insensitive)", () => {
    const text = "I cannot produce a summary at this time.";
    expect(isValidPreferenceSummary(text)).toBe(false);
  });

  it("rejects text starting with \"I can't\"", () => {
    const text = "I can't help with this request right now.";
    expect(isValidPreferenceSummary(text)).toBe(false);
  });

  it("rejects text starting with \"As an AI\"", () => {
    const text = "As an AI language model, I do not have enough information.";
    expect(isValidPreferenceSummary(text)).toBe(false);
  });

  it("rejects text starting with \"I don't\"", () => {
    const text = "I don't have sufficient feedback to build a profile.";
    expect(isValidPreferenceSummary(text)).toBe(false);
  });

  it("rejects text starting with \"Unfortunately\"", () => {
    const text = "Unfortunately, there is not enough data to generate a summary.";
    expect(isValidPreferenceSummary(text)).toBe(false);
  });

  it("rejects refusal pattern with surrounding whitespace (trimmed before check)", () => {
    const text = "\n\nI'm sorry, not enough data.\n";
    expect(isValidPreferenceSummary(text)).toBe(false);
  });

  // ---- invalid: no bullet points ----

  it("rejects prose text with no bullet points", () => {
    const text = "The user prefers casual styles and tends to avoid heavy outerwear in warm weather.";
    expect(isValidPreferenceSummary(text)).toBe(false);
  });

  it("rejects text that is long enough but has no '- ' bullet pattern", () => {
    const text = "* Prefers neutral colors\n* Avoids bold patterns\n* Likes layering";
    // Uses asterisks, not "- " — should fail the bullet check
    expect(isValidPreferenceSummary(text)).toBe(false);
  });

  // ---- edge cases ----

  it("does not reject text that contains a refusal phrase mid-sentence (not at start)", () => {
    // The regex is anchored to the start of the trimmed text
    const text = "- Prefers casual looks — although I'm sorry if this is incomplete\n- Likes layering";
    expect(isValidPreferenceSummary(text)).toBe(true);
  });

  it("accepts profile with mixed content as long as it has a bullet", () => {
    const text = "Style profile summary:\n- Prefers slim fit\n- Avoids formal wear";
    expect(isValidPreferenceSummary(text)).toBe(true);
  });
});
