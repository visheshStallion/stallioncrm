import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.PORT ?? 3100);

/**
 * Projects:
 *  - e2e:    behaviour + brand-isolation flows (tests/e2e)
 *  - visual: screenshot regression of the page templates, light + dark (tests/visual). Baselines are
 *            platform-specific (…-win32.png / …-linux.png); missing baselines are written, not failed.
 *            Refresh with `pnpm e2e:visual --update-snapshots`.
 *  - compare: `pnpm ui:compare` – renders our screens next to the reference screenshots in private/reference
 *            (git-ignored) and writes private/reference/report.html. Not part of the test suites.
 */
export default defineConfig({
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  // 15 s: the suite runs against `next dev`, where the first hit of a route compiles it.
  expect: { timeout: 15_000, toHaveScreenshot: { maxDiffPixelRatio: 0.02, animations: "disabled", caret: "hide" } },
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "e2e", testDir: "tests/e2e", use: { ...devices["Desktop Chrome"] } },
    { name: "visual", testDir: "tests/visual", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "compare", testDir: "tests/compare", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 } },
  ],
  webServer: {
    command: "node --import tsx scripts/e2e-server.ts",
    url: `http://localhost:${PORT}/login`,
    timeout: 240_000,
    reuseExistingServer: !process.env.CI,
    env: { PORT: String(PORT) },
  },
});
