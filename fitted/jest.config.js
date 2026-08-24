/** @type {import('jest').Config} */
const moduleNameMapper = { "^@/(.*)$": "<rootDir>/$1" };

module.exports = {
  collectCoverageFrom: ["lib/**/*.ts", "!lib/**/*.d.ts"],
  projects: [
    {
      // The pre-existing suite: server/lib logic + behavioral real-Mongo route tests (node env).
      displayName: "node",
      preset: "ts-jest",
      testEnvironment: "node",
      roots: ["<rootDir>"],
      testMatch: ["**/tests/**/*.test.ts"],
      moduleNameMapper,
    },
    {
      // Client-component behavioral tests (jsdom + React Testing Library). Kept minimal on purpose
      // (wardrobe-ingestion-honesty-pass D5): the two behaviors that can corrupt friend data, not a
      // component-testing culture. The tsconfig override compiles TSX with the automatic JSX runtime
      // (Next's own tsconfig uses jsx:"preserve", which jest cannot execute).
      displayName: "jsdom",
      preset: "ts-jest",
      testEnvironment: "jsdom",
      roots: ["<rootDir>"],
      testMatch: ["**/tests/**/*.test.tsx"],
      moduleNameMapper,
      setupFilesAfterEnv: ["<rootDir>/tests/jsdom.setup.ts"],
      transform: {
        "^.+\\.tsx?$": ["ts-jest", { tsconfig: { jsx: "react-jsx" } }],
      },
    },
    {
      // Repo-hygiene ratchets (docs/plans/maintainability.md §5). Deliberately OUTSIDE
      // `npm test`: package.json's "test" selects node+jsdom explicitly, so this project —
      // and any future one — is opt-in, and a doc-hygiene red can never be confused with
      // the conformance gate (.github/workflows/conformance.yml runs `npm test`).
      // Run via `npm run hygiene`; the Stop hook runs it too and blocks only on
      // regression-vs-baseline. File pattern is *.hygiene.ts, NOT *.test.ts, so the node
      // project's testMatch can never pick these up even without --selectProjects.
      displayName: "hygiene",
      preset: "ts-jest",
      testEnvironment: "node",
      roots: ["<rootDir>"],
      testMatch: ["**/tests/hygiene/**/*.hygiene.ts"],
      moduleNameMapper,
      // No testTimeout here: it is not a valid project-level option in jest 29 (it would
      // print a Validation Warning on EVERY run, npm test included, and be ignored).
      // Check 15's child suite runs bound themselves via spawnSync timeouts instead, and
      // the per-test override lives in the hygiene file's jest.setTimeout call.
    },
  ],
};
