/** Captured weather provenance, authored by Next rather than the render service.
 * Missing/invalid legacy provenance stays unknown; a bucket or summary cannot establish source. */
export const WEATHER_SOURCES = ["manual", "current", "forecast", "occasion", "default", "unknown"] as const;
export type WeatherSource = typeof WEATHER_SOURCES[number];

export function weatherSourceFromSnapshot(value: unknown): WeatherSource {
  return typeof value === "string" && WEATHER_SOURCES.includes(value as WeatherSource)
    ? value as WeatherSource : "unknown";
}

/** Positive planning signals, not certification of protection or negative observations. */
export interface WeatherSignals { rain: boolean; wind: boolean }
export function weatherSignalsFromSnapshot(value: unknown): WeatherSignals | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const v = value as Record<string, unknown>;
  return typeof v.rain === "boolean" && typeof v.wind === "boolean"
    ? { rain: v.rain, wind: v.wind } : undefined;
}
export function validWeatherSignals(value: unknown): value is WeatherSignals {
  return weatherSignalsFromSnapshot(value) !== undefined && Object.keys(value as object).length === 2;
}
export function sameWeatherSignals(a: unknown, b: unknown): boolean {
  const x = weatherSignalsFromSnapshot(a), y = weatherSignalsFromSnapshot(b);
  return x === undefined ? y === undefined : y !== undefined && x.rain === y.rain && x.wind === y.wind;
}

export interface LayerChoice { status: "off" | "offered" | "gap"; note: string | null }

export const LAYER_CHOICE_NOTES = {
  offered: "An optional removable layer is included. Rain and wind protection are unknown; check the garment and conditions before relying on it.",
  gap: "No eligible removable-layer option was found for these conditions. Rain and wind protection are unknown.",
} as const;
