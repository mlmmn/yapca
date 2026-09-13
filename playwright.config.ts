// E2E suite. Browser-level tests live in `e2e/` as `*.spec.ts`, so they never collide with the
// Vitest suites (which only collect `src/**/*.test.{ts,tsx}`). Scope is deliberately narrow:
// Chromium on a desktop viewport only. Run it with `pnpm test:e2e`; it needs the local
// Supabase stack (`pnpx supabase start`) and a populated `.env`, like `pnpm test:http`.
import { defineConfig, devices } from "@playwright/test";

const port = 4321;
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./e2e/specs",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["html", { open: "on-failure" }]],
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "setup", testDir: "./e2e", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], storageState: "e2e/.auth/user.json" },
      dependencies: ["setup"],
    },
  ],
  webServer: {
    command: `pnpm dev --host 127.0.0.1 --port ${port}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    // A cold workerd start on a CI runner is far slower than a warm local one.
    timeout: process.env.CI ? 120_000 : 60_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
