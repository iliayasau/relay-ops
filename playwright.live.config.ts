import { defineConfig } from "@playwright/test";
// Exercises only the disposable, isolated public demo. No local server is started.
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 120000,
  expect: { timeout: 15000 },
  outputDir: "live-results/traces",
  use: {
    baseURL: "https://relay-ops.onrender.com",
    browserName: "chromium",
    navigationTimeout: 90000,
    trace: "retain-on-failure",
  },
  projects: [{ name: "live" }],
});
