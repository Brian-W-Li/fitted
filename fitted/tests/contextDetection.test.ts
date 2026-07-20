/**
 * Tests for bucketFromSummary — the LIVE M5 weather/occasion → R5 bucket classifier
 * (lib/mlRecommend.ts), the condensed successor to the retired legacy detectTemperatureHint.
 *
 * Repointed at C8 from an inline copy to the real exported function, so the keyword contract and
 * its substring-collision guards are tested against production code, not a drifting duplicate.
 * Buckets: cold | hot | outdoor | indoor | mild (default).
 *
 * Key regression covered:
 *   "outdoor beach day with friends" must NOT classify as "indoor" — the legacy "ac" substring
 *   matched inside "be-AC-h"; the kept function drops "ac" and runs the outdoor check first.
 *
 * NOTE: bucketFromSummary has no explicit "mild" keyword list (unmatched input → mild default) and
 * drops the legacy-only "bbq"/"barbecue" outdoor words (multi-word/"outside" phrasings still bucket
 * outdoor) — the assertions below reflect the live function.
 */
import {
  bucketFromSummary as detectTemperatureHint,
  bucketFromTemp,
  resolveWeatherProd,
} from "@/lib/mlRecommend";
import { getWeatherContext } from "@/lib/weather";

// resolveWeatherProd's geo branch calls the STATICALLY-imported getWeatherContext (not injectable via
// MlRecommendDeps), so mock the module to drive that wiring deterministically without a network fetch.
// Spread the real module so only getWeatherContext is replaced (other exports stay live).
jest.mock("@/lib/weather", () => ({
  ...jest.requireActual("@/lib/weather"),
  getWeatherContext: jest.fn(),
}));
const mockedGetWeatherContext = getWeatherContext as jest.MockedFunction<typeof getWeatherContext>;

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

describe("bucketFromTemp — geo weather buckets by the NUMBER, not the summary text", () => {
  const ctx = (tempC: number, feelsLikeC?: number, weatherSummary = `Clear sky, ${Math.round(tempC)}°C`) => ({
    weatherSummary,
    tempC,
    feelsLikeC,
  });

  it("cold ≤ 10°C, hot ≥ 24°C, mild in between (thresholds aligned to WEATHER_WARMTH_BAND)", () => {
    expect(bucketFromTemp(ctx(9))).toBe("cold");
    expect(bucketFromTemp(ctx(10))).toBe("cold"); // boundary: ≤ 10 is cold
    expect(bucketFromTemp(ctx(11))).toBe("mild");
    expect(bucketFromTemp(ctx(23))).toBe("mild");
    expect(bucketFromTemp(ctx(24))).toBe("hot"); // boundary: ≥ 24 is hot
    expect(bucketFromTemp(ctx(35))).toBe("hot");
  });

  it("the pre-fix bug: a hot/cold day whose summary lacks a keyword no longer collapses to 'mild'", () => {
    // "Clear sky, 34°C" has no hot-family keyword → bucketFromSummary would return "mild".
    expect(detectTemperatureHint("Clear sky, 34°C")).toBe("mild"); // the old (wrong) path
    expect(bucketFromTemp(ctx(34))).toBe("hot"); // the new (correct) path
  });

  it("prefers feels-like over the dry-bulb temp when present", () => {
    expect(bucketFromTemp(ctx(20, 26))).toBe("hot"); // 20°C but feels 26°C → hot
    expect(bucketFromTemp(ctx(15, 8))).toBe("cold"); // 15°C but feels 8°C → cold
    expect(bucketFromTemp(ctx(18, undefined))).toBe("mild"); // no feels-like → use tempC
  });

  it("snow in the summary overrides to cold regardless of °C", () => {
    expect(bucketFromTemp(ctx(12, 12, "Snow showers, 12°C"))).toBe("cold");
    expect(bucketFromTemp(ctx(30, 30, "Heavy snow, 30°C"))).toBe("cold"); // contrived, but pins the override
  });
});

describe("resolveWeatherProd — geo branch wires bucketFromTemp, NOT bucketFromSummary (H66 regression)", () => {
  afterEach(() => mockedGetWeatherContext.mockReset());

  it("geo present + a keyword-less HOT summary → 'hot' (mutation guard for mlRecommend.ts geo wiring)", async () => {
    // The exact H66 bug this closes: reverting the geo wiring to bucketFromSummary(ctx.weatherSummary)
    // collapses this to "mild" (no hot-family keyword in "Clear sky, 34°C"), silently mis-labeling every
    // geo render's ranker penalty + M6 corpus `weather` field. This pins that the NUMBER wins.
    mockedGetWeatherContext.mockResolvedValue({
      weatherSummary: "Clear sky, 34°C",
      isForecast: false,
      tempC: 34,
      feelsLikeC: 34,
    });
    const res = await resolveWeatherProd({ occasion: "brunch", lat: 34.4, lon: -119.8 });
    expect(res.weather).toBe("hot");
    expect(res.weatherRaw).toBe("Clear sky, 34°C"); // raw summary passes through verbatim
    expect(mockedGetWeatherContext).toHaveBeenCalledTimes(1);
  });

  it("geo present + a keyword-less COLD summary (feels-like drives it) → 'cold'", async () => {
    // 3°C dry-bulb, feels-like 1°C — both ≤ 10; bucketFromSummary("Clear sky, 3°C") would say "mild".
    mockedGetWeatherContext.mockResolvedValue({
      weatherSummary: "Clear sky, 3°C",
      isForecast: false,
      tempC: 3,
      feelsLikeC: 1,
    });
    const res = await resolveWeatherProd({ occasion: "morning walk", lat: 40, lon: -74 });
    expect(res.weather).toBe("cold");
  });

  it("geo context null (fetch failed/out-of-range) → falls back to the occasion-text heuristic", async () => {
    mockedGetWeatherContext.mockResolvedValue(null);
    const res = await resolveWeatherProd({ occasion: "freezing winter hike", lat: 40, lon: -74 });
    expect(res.weather).toBe("cold"); // bucketFromSummary(occasion): "freezing"/"winter" → cold
    expect(res.weatherRaw).toBeNull(); // no raw summary when geo yielded nothing
    expect(mockedGetWeatherContext).toHaveBeenCalledTimes(1); // geo WAS attempted (lat/lon present)
  });
});
