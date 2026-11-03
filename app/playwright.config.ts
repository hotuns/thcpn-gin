import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: ["**/core-flows.spec.ts", "**/dashboard.spec.ts"],
  timeout: 30_000,
  expect: { timeout: 8_000 },
  fullyParallel: true,
  workers: 2,
  retries: 0,
  outputDir: "./e2e/artifacts/results",
  reporter: [
    ["list"],
    ["html", { outputFolder: "./e2e/artifacts/report", open: "never" }],
    ["json", { outputFile: "./e2e/artifacts/results.json" }],
  ],
  use: {
    browserName: "chromium",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : undefined,
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    baseURL: process.env.PLATFORM_URL ?? "http://127.0.0.1:5175",
  },
  // Start platform/admin separately; fixtures intercept every business API request.
  projects: [
    { name: "mobile", use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    { name: "desktop", use: { viewport: { width: 1440, height: 1000 } } },
  ],
});
