// Astro's `getViteConfig()` is the documented path here, but it resolves the real
// astro.config.mjs, which loads the Cloudflare adapter and forces a workers runner —
// the suite then dies at startup with `ReferenceError: exports is not defined` before
// any test loads. These src/lib modules have no bindings and no I/O, so plain
// `defineConfig` on Node is sufficient. `vite-tsconfig-paths` then derives the `@/*`
// alias from tsconfig.json's `paths`, keeping it a single source of truth.
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { defineConfig, defineProject } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

const require = createRequire(import.meta.url);
// Anchored to this file rather than cwd: a bare `path.resolve("test/shims/…")` resolves
// against process.cwd(), so invoking the suite from a subdirectory (IDE test runners do)
// silently produces a nonexistent alias target and Vite falls through to real module
// resolution — surfacing as "Cannot find package 'astro:actions'".
const rootDirectory = path.dirname(fileURLToPath(import.meta.url));
const astroPackagePath = require.resolve("astro/package.json");
const astroActionsRuntimeDirectory = path.join(path.dirname(astroPackagePath), "dist", "actions", "runtime");
const astroActionsServerPath = path.join(astroActionsRuntimeDirectory, "server.js");
const astroActionsClientPath = path.join(astroActionsRuntimeDirectory, "client.js");

export default defineConfig({
  test: {
    projects: [
      defineProject({
        plugins: [tsconfigPaths()],
        test: {
          name: "unit",
          // Vitest 4 rejects two projects that differ in `maxWorkers` but share a
          // `sequence.groupOrder`. Tools that invoke vitest without `--project` —
          // Stryker's vitest runner does exactly this — then fail to start at all.
          // Explicit group order keeps them resolvable and runs the fast suite first.
          sequence: { groupOrder: 0 },
          include: ["src/**/*.test.{ts,tsx}"],
          exclude: ["src/**/*.integration.test.{ts,tsx}"],
          environment: "node",
          env: { TZ: process.env.TZ ?? "UTC" },
        },
      }),
      defineProject({
        plugins: [tsconfigPaths()],
        resolve: {
          alias: {
            "astro:env/server": path.resolve(rootDirectory, "test/shims/astro-env-server.ts"),
            "astro:actions": path.resolve(rootDirectory, "test/shims/astro-actions.ts"),
            "virtual:yapca-test/astro-actions-server": astroActionsServerPath,
            "virtual:yapca-test/astro-actions-client": astroActionsClientPath,
          },
        },
        test: {
          name: "integration",
          sequence: { groupOrder: 1 },
          include: ["src/**/*.integration.test.{ts,tsx}"],
          environment: "node",
          env: { TZ: process.env.TZ ?? "UTC" },
          globalSetup: [path.resolve(rootDirectory, "test/setup/global-setup.ts")],
          setupFiles: [
            path.resolve(rootDirectory, "test/setup/load-env.ts"),
            path.resolve(rootDirectory, "test/setup/reset-integration-slots.ts"),
          ],
          testTimeout: 15000,
          maxWorkers: 2,
        },
      }),
    ],
  },
});
