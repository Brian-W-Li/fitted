import { assertLocalAdminAuthEmulator, localAuthEmulatorUrl } from "@/lib/firebaseEmulatorConfig";

describe("local Firebase Auth emulator guard", () => {
  it("accepts only loopback with the demo project", () => {
    expect(localAuthEmulatorUrl("http://127.0.0.1:9099", "demo-fitted-baseline", "development"))
      .toBe("http://127.0.0.1:9099");
    for (const [url, project, nodeEnv] of [
      ["https://127.0.0.1:9099", "demo-fitted-baseline", "development"],
      ["http://localhost:9099", "demo-fitted-baseline", "development"],
      ["http://127.0.0.1:9099", "real-project", "development"],
      ["http://127.0.0.1:9099/other", "demo-fitted-baseline", "development"],
      ["http://name:password@127.0.0.1:9099", "demo-fitted-baseline", "development"],
      ["http://127.0.0.1:9099?token=x", "demo-fitted-baseline", "development"],
      ["http://127.0.0.1:9099", "demo-fitted-baseline", "production"],
    ]) {
      expect(() => localAuthEmulatorUrl(url, project, nodeEnv)).toThrow();
    }
  });

  it("rejects production and conflicting server credentials", () => {
    expect(() => assertLocalAdminAuthEmulator("127.0.0.1:9099", "demo-fitted-baseline", undefined, "development", undefined))
      .not.toThrow();
    expect(() => assertLocalAdminAuthEmulator("127.0.0.1:9099", "demo-fitted-baseline", undefined, "production", undefined))
      .toThrow();
    expect(() => assertLocalAdminAuthEmulator("127.0.0.1:9099", "real-project", undefined, "development", undefined))
      .toThrow();
    expect(() => assertLocalAdminAuthEmulator("127.0.0.1:9099", "demo-fitted-baseline", "{}", "development", undefined))
      .toThrow();
    expect(() => assertLocalAdminAuthEmulator("127.0.0.1:9099", "demo-fitted-baseline", undefined, "development", "/tmp/creds.json"))
      .toThrow();
  });
});


describe("isolated production-build baseline", () => {
  const baseline = { enabled: "1", publicEnabled: "1", publicProjectId: "demo-fitted-baseline",
    mongoUri: "mongodb://127.0.0.1:27027/fitted_baseline?replicaSet=testset",
    serviceUrl: "http://127.0.0.1:8097", serviceKey: "local-baseline-key" };
  const serverGuard = (config = baseline) => assertLocalAdminAuthEmulator(
    "127.0.0.1:9099", "demo-fitted-baseline", undefined, "production", undefined, config);
  it("allows the explicit synthetic build and loopback browser only", () => {
    expect(serverGuard).not.toThrow();
    expect(localAuthEmulatorUrl("http://127.0.0.1:9099", "demo-fitted-baseline", "production",
      { enabled: "1", origin: "http://127.0.0.1:3107" })).toBe("http://127.0.0.1:9099");
    // Server/build evaluation has no window; browser callers always supply the actual origin.
    expect(() => localAuthEmulatorUrl("http://127.0.0.1:9099", "demo-fitted-baseline", "production",
      { enabled: "1" })).not.toThrow();
  });
  it.each([
    ["enabled", ""], ["enabled", "true"], ["publicEnabled", ""], ["publicEnabled", "true"],
    ["publicProjectId", "live-project"], ["serviceUrl", "https://example.com"], ["serviceKey", "real-key"],
    ["mongoUri", "mongodb+srv://127.0.0.1/fitted_baseline"],
    ["mongoUri", "mongodb://127.0.0.1:27027/live_closet"],
    ["mongoUri", "mongodb://localhost:27027/fitted_baseline"],
    ["mongoUri", "mongodb://user:secret@127.0.0.1:27027/fitted_baseline"],
    ["mongoUri", "mongodb://127.0.0.1:27028/fitted_baseline"],
    ["mongoUri", "mongodb://127.0.0.1:27027,example.com:27027/fitted_baseline"],
    ["mongoUri", "mongodb://127.0.0.1:27027/fitted_baseline?authSource=admin"],
    ["mongoUri", "mongodb://127.0.0.1:27027/fitted_baseline?replicaSet=a&replicaSet=b"],
  ])("rejects unsafe server configuration %s=%s", (key, value) => {
    expect(() => serverGuard({ ...baseline, [key]: value })).toThrow();
  });
  it("still rejects real credentials and a conflicting server project/host with all flags set", () => {
    for (const [host, project, key, adc] of [
      ["127.0.0.1:9099", "demo-fitted-baseline", "credential", undefined],
      ["127.0.0.1:9099", "demo-fitted-baseline", undefined, "credentials.json"],
      ["127.0.0.1:9099", "live-project", undefined, undefined],
      ["localhost:9099", "demo-fitted-baseline", undefined, undefined],
    ]) expect(() => assertLocalAdminAuthEmulator(host!, project, key, "production", adc, baseline)).toThrow();
  });
  it.each([undefined, "http://localhost:3107", "http://127.0.0.1:3000", "https://example.com"])(
    "rejects missing flags or another browser origin %s", origin => {
      expect(() => localAuthEmulatorUrl("http://127.0.0.1:9099", "demo-fitted-baseline", "production",
        { enabled: origin === undefined ? undefined : "1", origin })).toThrow();
    });
  it("does not let an opt-in switch enable emulator auth for a live client project", () => {
    expect(() => localAuthEmulatorUrl("http://127.0.0.1:9099", "live-project", "production",
      { enabled: "1", origin: "http://127.0.0.1:3107" })).toThrow();
  });
});
