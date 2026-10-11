import { getWeatherContext } from "@/lib/weather";

const now = new Date("2026-10-11T12:00:00Z");
let fetchMock: jest.Mock;
beforeEach(() => {
  jest.spyOn(Date, "now").mockReturnValue(now.getTime());
  fetchMock = jest.fn();
  jest.spyOn(global, "fetch").mockImplementation(fetchMock);
});
afterEach(() => jest.restoreAllMocks());
function respond(data: unknown) {
  fetchMock.mockResolvedValue({ ok: true, json: async () => data });
}
const here = { lat: 34.4, lon: -119.8 };
const tomorrow = { ...here, eventTimeISO: "2026-10-12T12:20:00Z" };

test.each([null, "25", undefined])("invalid current temperature %p falls back without invented degrees", async temp => {
  respond({ current: { temperature_2m: temp } });
  expect(await getWeatherContext(here)).toBeNull();
});
test("missing or invalid optional observations remain unknown, rather than clear sky or numerical claims", async () => {
  respond({ current: { temperature_2m: 16, apparent_temperature: null, precipitation_probability: "90", wind_speed_10m: "20" } });
  expect(await getWeatherContext(here)).toEqual({ weatherSignals: { rain: false, wind: false }, weatherSummary: "Conditions unavailable, 16°C", isForecast: false, tempC: 16, feelsLikeC: undefined });
});
test("valid current context preserves temperature, feels-like, rain and wind", async () => {
  respond({ current: { temperature_2m: 16, apparent_temperature: 11, weather_code: 63, precipitation_probability: 80, wind_speed_10m: 20 } });
  expect(await getWeatherContext(here)).toEqual({ weatherSignals: { rain: true, wind: true }, weatherSummary: "Rain, 16°C, feels 11°C, 80% chance of rain, 20mph wind", isForecast: false, tempC: 16, feelsLikeC: 11 });
});
test.each([["bad"], ["2026-10-11T12:00"]])("unusable or stale hourly slots %p cannot masquerade as tomorrow's forecast", async time => {
  respond({ hourly: { time, temperature_2m: [25] } });
  expect(await getWeatherContext(tomorrow)).toBeNull();
});
test("invalid selected hourly temperature fails open", async () => {
  respond({ hourly: { time: ["2026-10-12T12:00"], temperature_2m: [null] } });
  expect(await getWeatherContext(tomorrow)).toBeNull();
});
test("valid nearest hourly slot accepts rounding, ignoring invalid neighboring temperatures", async () => {
  respond({ hourly: { time: ["2026-10-12T11:00", "2026-10-12T12:00", "2026-10-12T13:00"], temperature_2m: [null, 15, 18], apparent_temperature: [null, 10, 11], weather_code: [0, 61, 0], precipitation_probability: [null, 70, 80], wind_speed_10m: [0, 19, 0] } });
  expect(await getWeatherContext(tomorrow)).toEqual({ weatherSignals: { rain: true, wind: true }, weatherSummary: "Light rain, 15–18°C, feels 10°C, 80% chance of rain, 19mph wind", isForecast: true, tempC: 15, feelsLikeC: 10 });
});
test("provider failure and invalid coordinates return no forecast", async () => {
  fetchMock.mockRejectedValue(new Error("offline"));
  expect(await getWeatherContext(here)).toBeNull();
  fetchMock.mockClear();
  expect(await getWeatherContext({ lat: 91, lon: 0 })).toBeNull();
  expect(fetchMock).not.toHaveBeenCalled();
});

test.each([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99])("wet provider code %p is a positive rain signal", async code => {
  respond({ current: { temperature_2m: 16, weather_code: code } });
  expect((await getWeatherContext(here))?.weatherSignals).toEqual({ rain: true, wind: false });
});
test.each([0, 1, 2, 3, 45, 48, 71, 73, 75, 77, 85, 86, 100, null, "63"])("code %p does not invent a positive rain signal", async code => {
  respond({ current: { temperature_2m: 16, weather_code: code } });
  expect((await getWeatherContext(here))?.weatherSignals).toEqual({ rain: false, wind: false });
});
test.each([[19, 15, false, false], [20, 15.1, true, true], [null, null, false, false], ["80", "30", false, false], [Infinity, NaN, false, false]])("uses finite thresholds: precip=%p wind=%p", async (precip, wind, rainSignal, windSignal) => {
  respond({ current: { temperature_2m: 16, precipitation_probability: precip, wind_speed_10m: wind } });
  expect((await getWeatherContext(here))?.weatherSignals).toEqual({ rain: rainSignal, wind: windSignal });
});
test("forecast rain uses only the ±2h probability window and target code; wind uses only target slot", async () => {
  const time = [9,10,11,12,13,14,15].map(hour => `2026-10-12T${hour}:00`);
  respond({ hourly: { time, temperature_2m: Array(7).fill(16), weather_code: [63,0,0,0,0,0,63],
    precipitation_probability: [90,0,0,19,0,0,90], wind_speed_10m: [30,30,30,15,30,30,30] } });
  expect((await getWeatherContext(tomorrow))?.weatherSignals).toEqual({ rain: false, wind: false });
  respond({ hourly: { time, temperature_2m: Array(7).fill(16), weather_code: Array(7).fill(0),
    precipitation_probability: [0,20,0,0,0,0,0], wind_speed_10m: [0,0,0,16,0,0,0] } });
  expect((await getWeatherContext(tomorrow))?.weatherSignals).toEqual({ rain: true, wind: true });
});

test("ragged probability array cannot trigger beyond temperature-covered forecast window", async () => {
  respond({ hourly: { time: ["2026-10-12T12:00"], temperature_2m: [16],
    precipitation_probability: [0,90], wind_speed_10m: [15], weather_code: [0] } });
  const context = await getWeatherContext(tomorrow);
  expect(context?.weatherSignals).toEqual({ rain: false, wind: false });
  expect(context?.weatherSummary).not.toContain("chance of rain");
});
