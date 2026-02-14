/** @type {import('jest').Config} */
<<<<<<< HEAD
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>"],
  testMatch: ["**/tests/**/*.test.ts"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/$1",
  },
  collectCoverageFrom: ["lib/**/*.ts", "!lib/**/*.d.ts"],
};
=======
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
>>>>>>> main
