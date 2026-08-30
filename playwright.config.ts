import { defineConfig, devices } from "@playwright/test";

/**
 * E2E runs against a throwaway database so it never touches the user's games.
 * Chess.com is not called: the spec seeds the database directly and drives the
 * UI, which keeps the suite deterministic and polite to the public API.
 */
const PORT = 3178;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? "list" : [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  /*
   * A production build, not `next dev`. Dev-mode on-demand compilation made
   * page transitions slow enough to time out assertions intermittently.
   */
  webServer: {
    command: `next build && next start -p ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 300_000,
    env: { CHESS_COACH_DB: "./data/e2e.db" },
  },
});
