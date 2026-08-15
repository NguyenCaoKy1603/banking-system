module.exports = {
  preset: "jest-expo",
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
  },
  testPathIgnorePatterns: ["<rootDir>/example/"],
  collectCoverageFrom: [
    "src/features/**/domain/**/*.{ts,tsx}",
    "src/features/**/navigation/**/*.{ts,tsx}",
    "src/features/**/presentation/**/*.{ts,tsx}",
    "src/features/**/storage/**/*.{ts,tsx}",
    "src/features/**/validation/**/*.{ts,tsx}",
    "!src/**/__tests__/**",
  ],
  coverageThreshold: {
    global: {
      statements: 80,
      branches: 75,
      functions: 80,
      lines: 80,
    },
  },
};
