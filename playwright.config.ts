import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  use: { baseURL: "http://127.0.0.1:3100", trace: "retain-on-failure" },
  webServer: [
    {
      command: "node --import tsx server/index.ts --production",
      url: "http://127.0.0.1:3100",
      env: { PORT: "3100", DATABASE_PATH: `data/e2e-${process.pid}.sqlite` },
      reuseExistingServer: false,
    },
    {
      command: "node --import tsx server/index.ts --production",
      url: "http://127.0.0.1:3200/healthz",
      env: {
        PORT: "3200",
        HOST: "0.0.0.0",
        DEMO_MODE: "public",
        PUBLIC_ORIGIN: "http://127.0.0.1:3200",
      },
      reuseExistingServer: false,
    },
  ],
  projects: [
    {
      name: "chromium",
      testIgnore: "**/public-demo.spec.ts",
      use: { browserName: "chromium" },
    },
    {
      name: "public-demo",
      use: { browserName: "chromium", baseURL: "http://127.0.0.1:3200" },
    },
  ],
});
