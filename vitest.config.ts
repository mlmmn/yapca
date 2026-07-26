// Astro's `getViteConfig()` is the documented path here, but it resolves the real
// astro.config.mjs, which loads the Cloudflare adapter and forces a workers runner —
// the suite then dies at startup with `ReferenceError: exports is not defined` before
// any test loads. These src/lib modules have no bindings and no I/O, so plain
// `defineConfig` on Node is sufficient. `vite-tsconfig-paths` then derives the `@/*`
// alias from tsconfig.json's `paths`, keeping it a single source of truth.
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    environment: "node",
    env: { TZ: process.env.TZ ?? "UTC" },
  },
});
