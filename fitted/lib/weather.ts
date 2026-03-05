// WMO weather interpretation codes → human-readable description
const WMO: Record<number, string> = {
  0: "Clear sky",
  1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast",
  45: "Foggy", 48: "Icy fog",
  51: "Light drizzle", 53: "Drizzle", 55: "Heavy drizzle",
  61: "Light rain", 63: "Rain", 65: "Heavy rain",
  71: "Light snow", 73: "Snow", 75: "Heavy snow", 77: "Snow grains",
  80: "Rain showers", 81: "Rain showers", 82: "Heavy rain showers",
  85: "Snow showers", 86: "Heavy snow showers",
  95: "Thunderstorm", 96: "Thunderstorm with hail", 99: "Thunderstorm with heavy hail",
};

function describeCode(code: number): string {
  return WMO[code] ?? "Cloudy";
}

/** Summary for current conditions (single data point). */
function buildCurrentSummary(
  temp: number,
  feelsLike: number | undefined,
  weatherCode: number,
  precipPct: number,
  windMph: number,
): string {
  const parts = [`${describeCode(weatherCode)}, ${Math.round(temp)}°C`];
  if (feelsLike !== undefined && Math.abs(feelsLike - temp) >= 3) {
    parts.push(`feels ${Math.round(feelsLike)}°C`);
  }
  if (precipPct >= 20) parts.push(`${precipPct}% chance of rain`);
  if (windMph > 15) parts.push(`${Math.round(windMph)}mph wind`);
  return parts.join(", ");
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
  const len = hourly.temperature_2m.length;
  // UTC-safe: ±2 hour window clamped to array bounds
  const lo = Math.max(0, centerIdx - 2);
  const hi = Math.min(len - 1, centerIdx + 2);

  const temps = hourly.temperature_2m.slice(lo, hi + 1);
  const tempMin = Math.round(Math.min(...temps));
  const tempMax = Math.round(Math.max(...temps));
  const tempStr = tempMax - tempMin >= 2 ? `${tempMin}–${tempMax}°C` : `${tempMin}°C`;

  const weatherCode = hourly.weather_code?.[centerIdx] ?? 0;
  const parts = [`${describeCode(weatherCode)}, ${tempStr}`];

  // Feels-like: only show if it diverges meaningfully from the temp range
  const feelsArr = (hourly.apparent_temperature ?? []).slice(lo, hi + 1) as number[];
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
  const precipArr = (hourly.precipitation_probability ?? []).slice(lo, hi + 1) as number[];
  if (precipArr.length > 0) {
    const maxPrecip = Math.max(...precipArr);
    if (maxPrecip >= 20) parts.push(`${maxPrecip}% chance of rain`);
  }

  // Wind at the target slot (not max — we want the expected value, not extreme)
  const wind = hourly.wind_speed_10m?.[centerIdx] ?? 0;
  if (wind > 15) parts.push(`${Math.round(wind)}mph wind`);

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
): Promise<{ weatherSummary: string; isForecast: boolean } | null> {
  const { lat, lon, eventTimeISO } = input;
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
      if (temp === undefined) return null;

      return {
        weatherSummary: buildCurrentSummary(
          temp,
          data.current?.apparent_temperature,
          data.current?.weather_code ?? 0,
          data.current?.precipitation_probability ?? 0,
          data.current?.wind_speed_10m ?? 0,
        ),
        isForecast: false,
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
        const diff = Math.abs(slotMs - eventMs);
        if (diff < closestDiff) {
          closestDiff = diff;
          closestIdx = i;
        }
      }

      const temps = data.hourly?.temperature_2m;
      if (!temps || temps[closestIdx] === undefined) return null;

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
        isForecast: true,
      };
    }
  } catch {
    return null; // timeout / network / parse error — all fail-open
  }
}
