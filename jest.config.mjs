/**
 * The pixel tests: the built package on Dawn, in Node. See src/__tests__.
 * The browser test is Playwright's (tests/*.spec.ts).
 */
export default {
  testEnvironment: "node",
  testMatch: ["<rootDir>/src/__tests__/**/*.test.ts"],
  // dist/lib and webgpu are ES modules: jest runs with --experimental-vm-modules.
  extensionsToTreatAsEsm: [".ts"],
  transform: { "\\.ts$": "<rootDir>/src/__tests__/setup/transform.mjs" },
  testTimeout: 30_000,
};
