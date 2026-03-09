/**
 * Tests for detectTemperatureHint — the keyword-based event context classifier.
 *
 * Because detectTemperatureHint is an internal function (not exported) in both
 * route files, this test inlines an exact copy of the production predicate.
 * If the keyword lists in the route change, update this copy to match.
 *
 * Key regression covered:
 *   "outdoor beach day with friends" was previously classified as "indoor"
 *   because "ac" (shorthand for air conditioning) matched the substring "ac"
 *   inside "be-AC-h". The fix removes "ac" from the indoor list and adds an
 *   outdoor check that runs before the indoor check.
 */

// ---------------------------------------------------------------------------
// Inline reproduction of detectTemperatureHint (from recommend/route.ts and
// recommend/regenerate/route.ts — both files share identical logic)
// ---------------------------------------------------------------------------

type TemperatureHint = "hot" | "mild" | "cold" | "indoor" | "outdoor";

function detectTemperatureHint(eventDescription: string): TemperatureHint {
  const text = eventDescription.toLowerCase();
  // Use word-boundary matching to prevent substring collisions (e.g. "hot" inside
  // "hotel"/"photo", "warm" inside "swarm", "park" inside "spark", etc.).
  // Single words use word-boundary regex to avoid substring collisions (e.g. "hot"
  // matching inside "hotel"). Multi-word phrases (e.g. "air condition") use plain
  // includes — they are long enough that false positives are practically impossible,
  // and they may appear inflected ("air conditioned") which breaks \b at the end.
  const hasWord = (w: string) =>
    w.includes(" ") ? text.includes(w) : new RegExp(`\\b${w}\\b`).test(text);

  if (["cold", "winter", "freezing", "chilly", "snow", "frigid"].some(hasWord)) {
    return "cold";
  }
  if (["hot", "summer", "warm", "humid", "heat", "scorching"].some(hasWord)) {
    return "hot";
  }
  // Check outdoor before indoor — "ac" was removed because it matches substrings
  // like "beach" (be-AC-h), causing false indoor classifications.
  if (["outdoor", "outside", "beach", "park", "picnic", "hiking", "hike", "camping", "barbecue", "bbq", "garden", "trail"].some(hasWord)) {
    return "outdoor";
  }
  if (["indoor", "inside", "air condition", "office"].some(hasWord)) {
    return "indoor";
  }
  if (["spring", "fall", "autumn", "mild", "cool", "moderate"].some(hasWord)) {
    return "mild";
  }

  return "mild";
}

// ---------------------------------------------------------------------------

describe("detectTemperatureHint — outdoor detection", () => {
  // ---- regression: the "beach" → "indoor" bug ----

  it("REGRESSION: 'outdoor beach day with friends' must NOT classify as indoor", () => {
    expect(detectTemperatureHint("outdoor beach day with friends")).not.toBe("indoor");
  });

  it("classifies 'outdoor beach day with friends' as outdoor", () => {
    expect(detectTemperatureHint("outdoor beach day with friends")).toBe("outdoor");
  });

  it("classifies 'beach day' as outdoor", () => {
    expect(detectTemperatureHint("beach day")).toBe("outdoor");
  });

  it("classifies 'park picnic' as outdoor", () => {
    expect(detectTemperatureHint("park picnic")).toBe("outdoor");
  });

  it("classifies 'hiking trip' as outdoor", () => {
    expect(detectTemperatureHint("hiking trip")).toBe("outdoor");
  });

  it("classifies 'hike in the mountains' as outdoor", () => {
    expect(detectTemperatureHint("hike in the mountains")).toBe("outdoor");
  });

  it("classifies 'camping weekend' as outdoor", () => {
    expect(detectTemperatureHint("camping weekend")).toBe("outdoor");
  });

  it("classifies 'outside barbecue' as outdoor", () => {
    expect(detectTemperatureHint("outside barbecue")).toBe("outdoor");
  });

  it("classifies 'bbq in the backyard' as outdoor", () => {
    expect(detectTemperatureHint("bbq in the backyard")).toBe("outdoor");
  });

  it("classifies 'garden party' as outdoor", () => {
    expect(detectTemperatureHint("garden party")).toBe("outdoor");
  });

  it("classifies 'trail run' as outdoor", () => {
    expect(detectTemperatureHint("trail run")).toBe("outdoor");
  });

  it("classifies 'outdoor concert' as outdoor", () => {
    expect(detectTemperatureHint("outdoor concert")).toBe("outdoor");
  });
});

describe("detectTemperatureHint — indoor detection (no false positives from 'ac' substring)", () => {
  it("classifies 'indoor event' as indoor", () => {
    expect(detectTemperatureHint("indoor event")).toBe("indoor");
  });

  it("classifies 'inside the office' as indoor", () => {
    expect(detectTemperatureHint("inside the office")).toBe("indoor");
  });

  it("classifies 'air conditioned venue' as indoor", () => {
    expect(detectTemperatureHint("air conditioned venue")).toBe("indoor");
  });

  it("classifies 'office meeting' as indoor", () => {
    expect(detectTemperatureHint("office meeting")).toBe("indoor");
  });

  // ---- the removed "ac" keyword must not cause false positives ----

  it("'back' does not classify as indoor (removed 'ac' substring bug)", () => {
    expect(detectTemperatureHint("going back to school")).not.toBe("indoor");
  });

  it("'practice' does not classify as indoor (removed 'ac' substring bug)", () => {
    expect(detectTemperatureHint("soccer practice")).not.toBe("indoor");
  });

  it("'place' does not classify as indoor (removed 'ac' substring bug)", () => {
    expect(detectTemperatureHint("a special place")).not.toBe("indoor");
  });
});

describe("detectTemperatureHint — temperature detection", () => {
  it("classifies 'winter formal' as cold", () => {
    expect(detectTemperatureHint("winter formal")).toBe("cold");
  });

  it("classifies 'freezing cold night out' as cold", () => {
    expect(detectTemperatureHint("freezing cold night out")).toBe("cold");
  });

  it("classifies 'summer festival' as hot", () => {
    expect(detectTemperatureHint("summer festival")).toBe("hot");
  });

  it("classifies 'humid outdoor run' as hot (hot keyword wins before outdoor)", () => {
    // "humid" triggers hot before "outdoor" is checked
    expect(detectTemperatureHint("humid outdoor run")).toBe("hot");
  });

  it("classifies 'spring brunch' as mild", () => {
    expect(detectTemperatureHint("spring brunch")).toBe("mild");
  });

  it("classifies 'fall wedding' as mild", () => {
    expect(detectTemperatureHint("fall wedding")).toBe("mild");
  });

  it("defaults to mild for unrecognized input", () => {
    expect(detectTemperatureHint("date night at a restaurant")).toBe("mild");
  });

  it("is case-insensitive (uppercase input)", () => {
    expect(detectTemperatureHint("BEACH DAY")).toBe("outdoor");
    expect(detectTemperatureHint("WINTER HIKE")).toBe("cold");
    expect(detectTemperatureHint("SUMMER BBQ")).toBe("hot");
  });
});

// ---------------------------------------------------------------------------
// Substring collision false positives
// These inputs contain a keyword as a substring of a longer, unrelated word.
// Each test documents a potential bug — if the assertion fails, the current
// implementation has a live substring-collision defect identical in character
// to the "ac"/"beach" bug that was previously fixed.
// ---------------------------------------------------------------------------

describe("detectTemperatureHint — substring collision false positives (hot via hotel/photo/shot)", () => {
  // "hot" is hidden inside "hotel"
  it("'hotel lobby networking event' must NOT classify as hot (hotel contains hot)", () => {
    expect(detectTemperatureHint("hotel lobby networking event")).not.toBe("hot");
  });

  it("classifies 'hotel lobby networking event' as mild", () => {
    expect(detectTemperatureHint("hotel lobby networking event")).toBe("mild");
  });

  it("'hotel rooftop dinner' must NOT classify as hot", () => {
    expect(detectTemperatureHint("hotel rooftop dinner")).not.toBe("hot");
  });

  it("classifies 'hotel rooftop dinner' as mild", () => {
    expect(detectTemperatureHint("hotel rooftop dinner")).toBe("mild");
  });

  // "hot" is hidden inside "photo" / "photography" / "photoshoot"
  it("'photo exhibition at gallery' must NOT classify as hot (photo contains hot)", () => {
    expect(detectTemperatureHint("photo exhibition at gallery")).not.toBe("hot");
  });

  it("classifies 'photo exhibition at gallery' as mild", () => {
    expect(detectTemperatureHint("photo exhibition at gallery")).toBe("mild");
  });

  it("'photography workshop' must NOT classify as hot", () => {
    expect(detectTemperatureHint("photography workshop")).not.toBe("hot");
  });

  it("classifies 'photography workshop' as mild", () => {
    expect(detectTemperatureHint("photography workshop")).toBe("mild");
  });

  it("'group photoshoot at studio' must NOT classify as hot", () => {
    expect(detectTemperatureHint("group photoshoot at studio")).not.toBe("hot");
  });

  it("classifies 'group photoshoot at studio' as mild", () => {
    expect(detectTemperatureHint("group photoshoot at studio")).toBe("mild");
  });

  // "hot" is hidden inside "shot"
  it("'shot put competition' must NOT classify as hot (shot contains hot)", () => {
    expect(detectTemperatureHint("shot put competition")).not.toBe("hot");
  });

  it("classifies 'shot put competition' as mild", () => {
    expect(detectTemperatureHint("shot put competition")).toBe("mild");
  });
});

describe("detectTemperatureHint — substring collision false positives (hot via swarm/wheat/sheath)", () => {
  // "warm" is hidden inside "swarm"
  it("'bee swarm observation' must NOT classify as hot (swarm contains warm)", () => {
    expect(detectTemperatureHint("bee swarm observation")).not.toBe("hot");
  });

  it("classifies 'bee swarm observation' as mild", () => {
    expect(detectTemperatureHint("bee swarm observation")).toBe("mild");
  });

  // "heat" is hidden inside "wheat"
  it("'wheat harvest festival' must NOT classify as hot (wheat contains heat)", () => {
    expect(detectTemperatureHint("wheat harvest festival")).not.toBe("hot");
  });

  it("classifies 'wheat harvest festival' as mild", () => {
    expect(detectTemperatureHint("wheat harvest festival")).toBe("mild");
  });

  // "heat" is hidden inside "sheath"
  it("'sheath dress fashion show' must NOT classify as hot (sheath contains heat)", () => {
    expect(detectTemperatureHint("sheath dress fashion show")).not.toBe("hot");
  });

  it("classifies 'sheath dress fashion show' as mild", () => {
    expect(detectTemperatureHint("sheath dress fashion show")).toBe("mild");
  });
});

describe("detectTemperatureHint — substring collision false positives (outdoor via spark)", () => {
  // "park" is hidden inside "spark" (s + park)
  it("'team spark kickoff event' must NOT classify as outdoor (spark contains park)", () => {
    expect(detectTemperatureHint("team spark kickoff event")).not.toBe("outdoor");
  });

  it("classifies 'team spark kickoff event' as mild", () => {
    expect(detectTemperatureHint("team spark kickoff event")).toBe("mild");
  });

  it("'sparkling wine tasting' must NOT classify as outdoor (sparkling contains park)", () => {
    expect(detectTemperatureHint("sparkling wine tasting")).not.toBe("outdoor");
  });

  it("classifies 'sparkling wine tasting' as mild", () => {
    expect(detectTemperatureHint("sparkling wine tasting")).toBe("mild");
  });

  it("'spark notes review session' must NOT classify as outdoor", () => {
    expect(detectTemperatureHint("spark notes review session")).not.toBe("outdoor");
  });

  it("classifies 'spark notes review session' as mild", () => {
    expect(detectTemperatureHint("spark notes review session")).toBe("mild");
  });
});

describe("detectTemperatureHint — substring collision false positives (indoor via officer)", () => {
  // "office" is hidden inside "officer"
  it("'police officer appreciation dinner' must NOT classify as indoor (officer contains office)", () => {
    expect(detectTemperatureHint("police officer appreciation dinner")).not.toBe("indoor");
  });

  it("classifies 'police officer appreciation dinner' as mild", () => {
    expect(detectTemperatureHint("police officer appreciation dinner")).toBe("mild");
  });

  it("'fire officer training' must NOT classify as indoor", () => {
    expect(detectTemperatureHint("fire officer training")).not.toBe("indoor");
  });

  it("classifies 'fire officer training' as mild", () => {
    expect(detectTemperatureHint("fire officer training")).toBe("mild");
  });
});

// ---------------------------------------------------------------------------
// Ambiguous events — no keyword matches; expect the "mild" default
// ---------------------------------------------------------------------------

describe("detectTemperatureHint — ambiguous events default to mild", () => {
  it("classifies 'birthday party' as mild", () => {
    expect(detectTemperatureHint("birthday party")).toBe("mild");
  });

  it("classifies 'team building activity' as mild", () => {
    expect(detectTemperatureHint("team building activity")).toBe("mild");
  });

  it("classifies 'graduation ceremony' as mild", () => {
    expect(detectTemperatureHint("graduation ceremony")).toBe("mild");
  });

  it("classifies 'book club meeting' as mild", () => {
    expect(detectTemperatureHint("book club meeting")).toBe("mild");
  });

  it("classifies 'yoga class' as mild", () => {
    expect(detectTemperatureHint("yoga class")).toBe("mild");
  });

  it("classifies 'networking happy hour' as mild", () => {
    expect(detectTemperatureHint("networking happy hour")).toBe("mild");
  });
});

// ---------------------------------------------------------------------------
// Mixed signals — multiple category keywords present; priority order governs
// cold > hot > outdoor > indoor > mild > default(mild)
// ---------------------------------------------------------------------------

describe("detectTemperatureHint — mixed signals respect priority order", () => {
  it("cold beats outdoor: 'cold beach volleyball' → cold", () => {
    expect(detectTemperatureHint("cold beach volleyball")).toBe("cold");
  });

  it("cold beats outdoor: 'winter picnic in the park' → cold", () => {
    expect(detectTemperatureHint("winter picnic in the park")).toBe("cold");
  });

  it("cold beats outdoor: 'freezing beach bonfire' → cold", () => {
    expect(detectTemperatureHint("freezing beach bonfire")).toBe("cold");
  });

  it("cold beats indoor: 'chilly office afternoon' → cold", () => {
    expect(detectTemperatureHint("chilly office afternoon")).toBe("cold");
  });

  it("hot beats indoor: 'hot indoor spin class' → hot", () => {
    expect(detectTemperatureHint("hot indoor spin class")).toBe("hot");
  });

  it("hot beats indoor: 'warm office happy hour' → hot", () => {
    expect(detectTemperatureHint("warm office happy hour")).toBe("hot");
  });

  it("hot beats indoor: 'summer indoor pool party' → hot", () => {
    expect(detectTemperatureHint("summer indoor pool party")).toBe("hot");
  });

  it("outdoor beats mild: 'spring hike in the mountains' → outdoor", () => {
    expect(detectTemperatureHint("spring hike in the mountains")).toBe("outdoor");
  });

  it("outdoor beats mild: 'fall outdoor concert' → outdoor", () => {
    expect(detectTemperatureHint("fall outdoor concert")).toBe("outdoor");
  });

  it("outdoor beats mild: 'autumn picnic' → outdoor", () => {
    expect(detectTemperatureHint("autumn picnic")).toBe("outdoor");
  });
});

// ---------------------------------------------------------------------------
// Formatting edge cases
// ---------------------------------------------------------------------------

describe("detectTemperatureHint — formatting edge cases", () => {
  it("handles mixed-case input: 'BeAcH dAy In ThE sUn' → outdoor", () => {
    expect(detectTemperatureHint("BeAcH dAy In ThE sUn")).toBe("outdoor");
  });

  it("handles leading/trailing whitespace: '  beach day  ' → outdoor", () => {
    expect(detectTemperatureHint("  beach day  ")).toBe("outdoor");
  });

  it("handles punctuation: 'beach!!! party!!!' → outdoor", () => {
    expect(detectTemperatureHint("beach!!! party!!!")).toBe("outdoor");
  });

  it("hyphenated 'out-door' does NOT match the 'outdoor' keyword → mild", () => {
    expect(detectTemperatureHint("out-door concert")).toBe("mild");
  });

  it("empty string returns mild (default)", () => {
    expect(detectTemperatureHint("")).toBe("mild");
  });

  it("numeric-only string returns mild (default)", () => {
    expect(detectTemperatureHint("12345")).toBe("mild");
  });
});

// ---------------------------------------------------------------------------
// Minimal context inputs
// ---------------------------------------------------------------------------

describe("detectTemperatureHint — minimal context inputs", () => {
  it("single word 'beach' → outdoor", () => {
    expect(detectTemperatureHint("beach")).toBe("outdoor");
  });

  it("single word 'office' → indoor", () => {
    expect(detectTemperatureHint("office")).toBe("indoor");
  });

  it("single word 'winter' → cold", () => {
    expect(detectTemperatureHint("winter")).toBe("cold");
  });

  it("single letter 'a' → mild (default)", () => {
    expect(detectTemperatureHint("a")).toBe("mild");
  });
});
