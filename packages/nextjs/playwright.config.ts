import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests (e2e/). Two ways to run them:
 *
 * - Against a server you already run: PLAYWRIGHT_BASE_URL=http://localhost:3000 yarn next:e2e
 * - In CI, with no PLAYWRIGHT_BASE_URL: Playwright serves the production build
 *   itself (run `yarn next:build` first) on PLAYWRIGHT_PORT (default 3100).
 */
const port = Number(process.env.PLAYWRIGHT_PORT ?? 3100);
const externalServer = process.env.PLAYWRIGHT_BASE_URL;
const ci = Boolean(process.env.CI);

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./e2e/.results",
  fullyParallel: true,
  forbidOnly: ci,
  retries: ci ? 1 : 0,
  workers: ci ? 2 : undefined,
  // A dev server compiles each page on first visit, which can take a while.
  timeout: externalServer ? 180_000 : 60_000,
  expect: { timeout: externalServer ? 60_000 : 15_000 },
  reporter: ci ? [["github"], ["html", { outputFolder: "./e2e/.report", open: "never" }]] : "list",
  use: {
    baseURL: externalServer ?? `http://localhost:${port}`,
    navigationTimeout: externalServer ? 180_000 : 30_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer:
    ci && !externalServer
      ? {
          command: "yarn serve",
          env: { PORT: String(port) },
          url: `http://localhost:${port}`,
          timeout: 120_000,
          reuseExistingServer: false,
        }
      : undefined,
});
