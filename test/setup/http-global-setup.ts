import { createRequire } from "node:module";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as wait } from "node:timers/promises";
import type { TestProject } from "vitest/node";
import integrationGlobalSetup from "./global-setup";

const require = createRequire(import.meta.url);
const astroCliPath = path.join(path.dirname(require.resolve("astro/package.json")), "bin", "astro.mjs");
const candidatePort = 4321;
const readinessTimeoutMs = 20_000;
const shutdownTimeoutMs = 5_000;

function getBaseUrl(output: string) {
  const match = /https?:\/\/127\.0\.0\.1:\d+\/?/.exec(output);

  return match?.[0];
}

function getProcessExit(child: ChildProcess) {
  return new Promise<void>((resolve) => {
    child.once("exit", () => {
      resolve();
    });
  });
}

async function stopServer(child: ChildProcess) {
  const exit = getProcessExit(child);
  const processId = child.pid;

  if (!processId || child.exitCode !== null) {
    return;
  }

  process.kill(-processId, "SIGTERM");

  const terminated = await Promise.race([exit.then(() => true), wait(shutdownTimeoutMs).then(() => false)]);

  if (!terminated) {
    process.kill(-processId, "SIGKILL");
    await exit;
  }
}

async function waitForServer(child: ChildProcess, getOutput: () => string) {
  const deadline = Date.now() + readinessTimeoutMs;

  while (Date.now() < deadline) {
    const output = getOutput();
    const baseUrl = getBaseUrl(output);

    if (baseUrl) {
      try {
        await fetch(baseUrl);

        return baseUrl;
      } catch {
        // workerd may announce its address just before the first request is ready.
      }
    }

    if (child.exitCode !== null) {
      throw new Error(`Astro dev exited before becoming ready. Output:\n${output}`);
    }

    await wait(100);
  }

  throw new Error(`Timed out waiting for Astro dev. Output:\n${getOutput()}`);
}

export default async function httpGlobalSetup(project: TestProject) {
  const integrationTeardown = await integrationGlobalSetup(project);
  let server: ChildProcess | undefined;
  let output = "";

  try {
    server = spawn(process.execPath, [astroCliPath, "dev", "--host", "127.0.0.1", "--port", String(candidatePort)], {
      cwd: process.cwd(),
      detached: true,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    server.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    server.stderr?.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });

    const baseUrl = await waitForServer(server, () => output);

    project.provide("httpBaseUrl", baseUrl);
  } catch (error) {
    if (server) {
      await stopServer(server);
    }

    await integrationTeardown();
    throw error;
  }

  return async () => {
    try {
      await stopServer(server);
    } finally {
      await integrationTeardown();
    }
  };
}
