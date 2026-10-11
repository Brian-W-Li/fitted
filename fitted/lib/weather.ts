import type { WeatherSignals } from "@/lib/weatherContext";

// WMO weather interpretation codes → human-readable description
const WMO: Record<number, string> = {
  0: "Clear sky",
  1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast",
  45: "Foggy", 48: "Icy fog",
  51: "Light drizzle", 53: "Drizzle", 55: "Heavy drizzle",
  56: "Light freezing drizzle", 57: "Heavy freezing drizzle",
  66: "Light freezing rain", 67: "Heavy freezing rain",
  61: "Light rain", 63: "Rain", 65: "Heavy rain",
  71: "Light snow", 73: "Snow", 75: "Heavy snow", 77: "Snow grains",
  80: "Rain showers", 81: "Rain showers", 82: "Heavy rain showers",
  85: "Snow showers", 86: "Heavy snow showers",
  95: "Thunderstorm", 96: "Thunderstorm with hail", 99: "Thunderstorm with heavy hail",
};

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

// Freezing drizzle/rain are wet codes too; snow, fog and hail-only codes are not rain.
const WET_CODES = new Set([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99]);
function signals(code: unknown, precip: unknown, wind: unknown): WeatherSignals {
  return { rain: (finiteNumber(code) && WET_CODES.has(code)) || (finiteNumber(precip) && precip >= 20),
    wind: finiteNumber(wind) && wind > 15 };
}
function describeCode(code: number | undefined): string {
  return finiteNumber(code) && WMO[code] ? WMO[code] : "Conditions unavailable";
}

/** Summary for current conditions (single data point). */
function buildCurrentSummary(
  temp: number,
  feelsLike: number | undefined,
  weatherCode: number | undefined,
  precipPct: number,
  windMph: number,
): string {
  const parts = [`${describeCode(weatherCode)}, ${Math.round(temp)}°C`];
  if (finiteNumber(feelsLike) && Math.abs(feelsLike - temp) >= 3) {
    parts.push(`feels ${Math.round(feelsLike)}°C`);
  }
  if (finiteNumber(precipPct) && precipPct >= 20) parts.push(`${precipPct}% chance of rain`);
  if (finiteNumber(windMph) && windMph > 15) parts.push(`${Math.round(windMph)}mph wind`);
  return parts.join(", ");
}

function forecastWindow(length: number, centerIdx: number): [number, number] {
  return [Math.max(0, centerIdx - 2), Math.min(length, centerIdx + 3)];
}
function maxForecastPrecip(hourly: { temperature_2m: number[]; precipitation_probability?: number[] }, centerIdx: number): number {
  const [lo, end] = forecastWindow(hourly.temperature_2m.length, centerIdx);
  return Math.max(...(hourly.precipitation_probability ?? []).slice(lo, end).filter(finiteNumber));
}

/**
 * Summary for a forecast, using a ±2 hour window around the target slot.
 * Shows temp/feels-like as ranges when they vary ≥2°C across the window.
 * Uses max precip probability across the window (worst-case for planning).
 * Wind is taken from the target slot itself.
 */
function buildForecastWindowSummary(
  hourly: {
    temperature_2m: number[];
    apparent_temperature?: number[];
    precipitation_probability?: number[];
    wind_speed_10m?: number[];
    weather_code?: number[];
  },
  centerIdx: number,
): string {
  // Summary and signals share the same bounded ±2 hour window.
  const [lo, end] = forecastWindow(hourly.temperature_2m.length, centerIdx);

  const temps = hourly.temperature_2m.slice(lo, end).filter(finiteNumber);
  const tempMin = Math.round(Math.min(...temps));
  const tempMax = Math.round(Math.max(...temps));
  const tempStr = tempMax - tempMin >= 2 ? `${tempMin}–${tempMax}°C` : `${tempMin}°C`;

  const weatherCode = hourly.weather_code?.[centerIdx];
  const parts = [`${describeCode(weatherCode)}, ${tempStr}`];

  // Feels-like: only show if it diverges meaningfully from the temp range
  const feelsArr = (hourly.apparent_temperature ?? []).slice(lo, end).filter(finiteNumber);
  if (feelsArr.length > 0) {
    const feelsMin = Math.round(Math.min(...feelsArr));
    const feelsMax = Math.round(Math.max(...feelsArr));
    const tempMid = Math.round((tempMin + tempMax) / 2);
    if (Math.abs(feelsMin - tempMid) >= 3 || Math.abs(feelsMax - tempMid) >= 3) {
      const feelsStr = feelsMax - feelsMin >= 2 ? `${feelsMin}–${feelsMax}°C` : `${feelsMin}°C`;
      parts.push(`feels ${feelsStr}`);
    }
  }

  // Max precipitation probability across the window (worst-case for clothing)
  const maxPrecip = maxForecastPrecip(hourly, centerIdx);
  if (finiteNumber(maxPrecip) && maxPrecip >= 20) parts.push(`${maxPrecip}% chance of rain`);

  // Wind at the target slot (not max — we want the expected value, not extreme)
  const wind = hourly.wind_speed_10m?.[centerIdx] ?? 0;
  if (finiteNumber(wind) && wind > 15) parts.push(`${Math.round(wind)}mph wind`);

  return parts.join(", ");
}

export interface WeatherInput {
  lat: number;
  lon: number;
  /**
   * UTC ISO 8601 string for the event time (e.g. new Date().toISOString()).
   * If omitted, or within ~2 hours of now, uses current conditions.
   * If more than ~2 hours in the future, picks the hourly forecast slot
   * closest to the event time.
   */
  eventTimeISO?: string;
}

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

/**
 * Fetches weather context from Open-Meteo (no API key required).
 *
 * - event "now" (eventTimeISO absent or ≤2h away): current conditions
 * - event >2h in the future: hourly forecast slot closest to event time
 *
 * Open-Meteo returns hourly times in UTC (no timezone suffix).
 * We append "Z" when parsing so Date treats them as UTC — matching the
 * UTC ISO strings the browser sends via new Date().toISOString().
 *
 * Returns null on any failure — callers should fail-open and proceed
 * without weather context.  Timeout: 5 seconds.
 */
export async function getWeatherContext(
  input: WeatherInput,
): Promise<{ weatherSummary: string; isForecast: boolean; tempC: number; feelsLikeC?: number; weatherSignals: WeatherSignals } | null> {
  const { lat, lon, eventTimeISO } = input;
  if (!finiteNumber(lat) || !finiteNumber(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const now = Date.now();
  const eventMs = eventTimeISO ? new Date(eventTimeISO).getTime() : NaN;
  const useHourly = !isNaN(eventMs) && eventMs - now > TWO_HOURS_MS;

  try {
    if (!useHourly) {
      // ── Current conditions ──────────────────────────────────────────────
      const url =
        `https://api.open-meteo.com/v1/forecast` +
        `?latitude=${lat}&longitude=${lon}` +
        `&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,precipitation_probability` +
        `&wind_speed_unit=mph&forecast_days=1`;

      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) return null;

      const data = (await res.json()) as {
        current?: {
          temperature_2m?: number;
          apparent_temperature?: number;
          weather_code?: number;
          wind_speed_10m?: number;
          precipitation_probability?: number;
        };
      };

      const temp = data.current?.temperature_2m;
      if (!finiteNumber(temp)) return null;

      return {
        weatherSummary: buildCurrentSummary(
          temp,
          data.current?.apparent_temperature,
          data.current?.weather_code,
          data.current?.precipitation_probability ?? 0,
          data.current?.wind_speed_10m ?? 0,
        ),
        weatherSignals: signals(data.current?.weather_code, data.current?.precipitation_probability, data.current?.wind_speed_10m),
        isForecast: false,
        tempC: temp,
        feelsLikeC: finiteNumber(data.current?.apparent_temperature) ? data.current.apparent_temperature : undefined,
      };
    } else {
      // ── Hourly forecast ─────────────────────────────────────────────────
      // Fetch enough days to cover the event time (Open-Meteo max = 16)
      const daysDiff = Math.ceil((eventMs - now) / (24 * 60 * 60 * 1000));
      // Beyond 6 days the forecast is unreliable; fail-open rather than
      // silently returning the wrong slot at the end of the 7-day array.
      if (daysDiff > 6) return null;
      const forecastDays = Math.min(Math.max(daysDiff + 1, 2), 7);


      // timezone=UTC → Open-Meteo returns times in UTC without offset suffix,
      // e.g. "2024-03-05T18:00". We append "Z" on parse so JS treats them as
      // UTC ms — consistent with the UTC ISO string sent by the browser.
      // This avoids DST bugs that would occur with timezone=auto.
      const url =
        `https://api.open-meteo.com/v1/forecast` +
        `?latitude=${lat}&longitude=${lon}` +
        `&hourly=temperature_2m,apparent_temperature,precipitation_probability,wind_speed_10m,weather_code` +
        `&wind_speed_unit=mph&forecast_days=${forecastDays}&timezone=UTC`;

      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) return null;

      const data = (await res.json()) as {
        hourly?: {
          time?: string[];
          temperature_2m?: number[];
          apparent_temperature?: number[];
          precipitation_probability?: number[];
          wind_speed_10m?: number[];
          weather_code?: number[];
        };
      };

      const times = data.hourly?.time;
      if (!times || times.length === 0) return null;

      // Find the slot index whose UTC time is closest to the event time
      let closestIdx = 0;
      let closestDiff = Infinity;
      for (let i = 0; i < times.length; i++) {
        // Append "Z" → force UTC parse (Open-Meteo times are UTC without suffix)
        const slotMs = new Date(times[i] + "Z").getTime();
        if (!Number.isFinite(slotMs)) continue;
        const diff = Math.abs(slotMs - eventMs);
        if (diff < closestDiff) {
          closestDiff = diff;
          closestIdx = i;
        }
      }

      // Hourly forecasts must cover the requested time, rather than silently using
      // a stale end-of-array slot. Allow half an hour for nearest-slot rounding.
      if (closestDiff > 30 * 60 * 1000) return null;
      const temps = data.hourly?.temperature_2m;
      if (!Array.isArray(temps) || !finiteNumber(temps[closestIdx])) return null;

      return {
        weatherSummary: buildForecastWindowSummary(
          {
            temperature_2m: temps,
            apparent_temperature: data.hourly?.apparent_temperature,
            precipitation_probability: data.hourly?.precipitation_probability,
            wind_speed_10m: data.hourly?.wind_speed_10m,
            weather_code: data.hourly?.weather_code,
          },
          closestIdx,
        ),
        weatherSignals: signals(data.hourly?.weather_code?.[closestIdx],
          maxForecastPrecip({ temperature_2m: temps, precipitation_probability: data.hourly?.precipitation_probability }, closestIdx),
          data.hourly?.wind_speed_10m?.[closestIdx]),
        isForecast: true,
        tempC: temps[closestIdx],
        feelsLikeC: finiteNumber(data.hourly?.apparent_temperature?.[closestIdx]) ? data.hourly.apparent_temperature[closestIdx] : undefined,
      };
    }
  } catch {
    return null; // timeout / network / parse error — all fail-open
  }
}
