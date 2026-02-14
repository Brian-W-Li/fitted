/** @type {import('jest').Config} */
const config = {
  testEnvironment: "node",
  roots: ["<rootDir>"],
  testMatch: ["**/tests/**/*.test.ts", "**/tests/**/*.test.tsx"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/$1",
  },
  transform: {
    "^.+\\.(ts|tsx)$": ["ts-jest", { useESM: false }],
  },
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json"],
  collectCoverageFrom: ["lib/**/*.ts", "app/api/**/*.ts"],
  coveragePathIgnorePatterns: ["/node_modules/", "\\.d\\.ts$"],
};

module.exports = config;
