module.exports = {
  preset: "jest-expo",
  setupFilesAfterEnv: ["<rootDir>/jest.setup.cjs"],
  transformIgnorePatterns: [
    "/node_modules/(?!(.pnpm|react-native|@react-native|@react-native-community|expo|@expo|@expo-google-fonts|react-navigation|@react-navigation|@sentry/react-native|native-base|standard-navigation|decode-uri-component|query-string|split-on-first|filter-obj))",
    "/node_modules/react-native-reanimated/plugin/",
    "/node_modules/@react-native/babel-preset/",
  ],
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
