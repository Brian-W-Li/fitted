/**
 * M4 C1 — wipe-gate safety logic (lib/wipeGuard).
 *
 * Guards an irreversible action: the wipe must be REFUSED against the shared team
 * Atlas cluster. Extracted from scripts/wipe-db.ts so it is unit-testable without
 * running the script.
 */
import { parseMongoUri, isWipeAllowed } from "@/lib/wipeGuard";

const NO_OVERRIDE = {};

describe("parseMongoUri", () => {
  it("extracts host + db from a standard URI", () => {
    expect(parseMongoUri("mongodb://localhost:27017/fitted")).toEqual({
      host: "localhost:27017",
      dbName: "fitted",
    });
  });

  it("extracts host + db from a srv URI (password stays out of host)", () => {
    expect(parseMongoUri("mongodb+srv://u:secret@cluster.abc.mongodb.net/app?retryWrites=true")).toEqual({
      host: "cluster.abc.mongodb.net",
      dbName: "app",
    });
  });

  it("reports (default) when no db path is present", () => {
    expect(parseMongoUri("mongodb://localhost:27017").dbName).toBe("(default)");
  });
});

describe("isWipeAllowed", () => {
  it("allows an allowlisted label at a host boundary", () => {
    expect(isWipeAllowed("localhost:27017", NO_OVERRIDE)).toBe(true);
    expect(isWipeAllowed("127.0.0.1:27017", NO_OVERRIDE)).toBe(true);
    expect(isWipeAllowed("fitted-dev.abc.mongodb.net", NO_OVERRIDE)).toBe(true);
  });

  it("REFUSES a non-allowlisted host even when the db name matches (no dbName bypass)", () => {
    // The whole point of the gate: a `fitted-dev`-named db on the shared team Atlas
    // host must NOT authorize a wipe. The host is the only trustworthy signal.
    expect(isWipeAllowed("cluster.abc.mongodb.net", NO_OVERRIDE)).toBe(false);
  });

  it("REFUSES a prod host that merely contains the label without a boundary", () => {
    expect(isWipeAllowed("fitted-dev-shadow.prod.mongodb.net", NO_OVERRIDE)).toBe(false);
    expect(isWipeAllowed("myfitted-development.net", NO_OVERRIDE)).toBe(false);
    expect(isWipeAllowed("prod.mongodb.net", NO_OVERRIDE)).toBe(false);
  });

  it("a password containing 'localhost' cannot false-allow (host only)", () => {
    const { host } = parseMongoUri("mongodb+srv://user:localhostpw@prod.mongodb.net/app");
    expect(isWipeAllowed(host, NO_OVERRIDE)).toBe(false);
  });

  it("FITTED_ALLOW_WIPE=1 overrides the allowlist", () => {
    expect(isWipeAllowed("prod.mongodb.net", { FITTED_ALLOW_WIPE: "1" })).toBe(true);
  });
});
