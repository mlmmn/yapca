// HTTP integration suite. It talks to a running Astro server, so unlike the in-process suite it
// needs neither the astro:actions nor astro:env/server shims. Run it with `pnpm test:http`.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

const rootDirectory = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    name: "http",
    include: ["src/**/*.http.test.{ts,tsx}"],
    environment: "node",
    env: { TZ: process.env.TZ ?? "UTC" },
    globalSetup: [path.resolve(rootDirectory, "test/setup/http-global-setup.ts")],
    setupFiles: [
      path.resolve(rootDirectory, "test/setup/load-env.ts"),
      path.resolve(rootDirectory, "test/setup/reset-integration-slots.ts"),
    ],
    testTimeout: 30_000,
    maxWorkers: 2,
  },
});
