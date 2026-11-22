import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  globalSetup: "./e2e/global-setup.ts",
  use: { baseURL: "http://127.0.0.1:3456" },
  webServer: {
    command: "pnpm start --port 3456",
    url: "http://127.0.0.1:3456/en",
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      ORBEXA_JOB_DIR: "/tmp/orbexa-e2e/jobs",
      ORBEXA_DEMO_DIR: "/tmp/orbexa-e2e/demo",
      ORBEXA_ADMIN_EMAILS: "admin-desktop@example.test,admin-mobile@example.test",
    },
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
    { name: "mobile", use: { ...devices["Pixel 5"], viewport: { width: 390, height: 844 } } },
  ],
});
