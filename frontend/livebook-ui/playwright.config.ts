import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL: "http://localhost:3002",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node ../../scripts/e2e-dev.mjs",
    url: "http://localhost:3002",
    reuseExistingServer: false,
    timeout: 150_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
