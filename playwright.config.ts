import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://localhost:5173",
    viewport: { width: 1280, height: 900 },
    trace: "retain-on-failure",
  },
  // Chromium first (milestone M6). Firefox and WebKit are enabled in M7.
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], permissions: ["clipboard-read", "clipboard-write"] },
    },
  ],
  webServer: {
    command: "pnpm --filter vite-react-example dev",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
  },
});
