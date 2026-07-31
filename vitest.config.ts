// Astro's `getViteConfig()` is the documented path here, but it resolves the real
// astro.config.mjs, which loads the Cloudflare adapter and forces a workers runner —
// the suite then dies at startup with `ReferenceError: exports is not defined` before
// any test loads. These src/lib modules have no bindings and no I/O, so plain
// `defineConfig` on Node is sufficient. `vite-tsconfig-paths` then derives the `@/*`
// alias from tsconfig.json's `paths`, keeping it a single source of truth.
//
// This is the unit suite, and it is deliberately the default config: `pnpm test` and
// Stryker (`stryker.config.json` → `vitest.configFile`) read this same file, so the
// mutation audit can never be scored against a suite that differs from the one gating
// the repo. Integration tests need the local Supabase stack and live in
// `vitest.integration.config.ts` — a separate config rather than a second project,
// because Stryker's Vitest runner invokes vitest without `--project` and would start
// the integration suite too.
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    name: "unit",
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["src/**/*.integration.test.{ts,tsx}"],
    environment: "node",
    env: { TZ: process.env.TZ ?? "UTC" },
  },
});
