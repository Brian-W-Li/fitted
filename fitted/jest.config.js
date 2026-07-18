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
  ],
};
