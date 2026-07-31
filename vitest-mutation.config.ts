import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

// Stryker's Vitest runner starts every project in vitest.config.ts. Keep its
// audit on the unit project: integration tests require the local Supabase stack
// and are intentionally outside this mutation signal.
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    env: { TZ: process.env.TZ ?? "UTC" },
    exclude: ["src/**/*.integration.test.{ts,tsx}"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
