// Integration suite. Kept in its own config rather than as a second project in
// vitest.config.ts: Stryker's Vitest runner exposes only `configFile`/`dir` with no project
// selector and invokes vitest without `--project`, so any project living beside the unit one
// would be started during the mutation audit — and these tests require the local Supabase
// stack (Docker). Run it with `pnpm test:integration`.
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
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
});
