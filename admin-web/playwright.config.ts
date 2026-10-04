import { defineConfig, devices } from "@playwright/test";

const e2ePort = Number(process.env.ADMIN_WEB_E2E_PORT ?? 5174);
const e2eUrl = `http://127.0.0.1:${e2ePort}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "line",
  use: {
    baseURL: e2eUrl,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command: "node e2e/fixture-server.mjs",
    url: e2eUrl,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
