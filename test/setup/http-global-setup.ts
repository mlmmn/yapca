import { createRequire } from "node:module";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as wait } from "node:timers/promises";
import type { TestProject } from "vitest/node";
import integrationGlobalSetup from "./global-setup";

const require = createRequire(import.meta.url);
const astroCliPath = path.join(path.dirname(require.resolve("astro/package.json")), "bin", "astro.mjs");
const candidatePort = 4321;
const readinessTimeoutMs = 45_000;
const probeTimeoutMs = 2_000;
const shutdownTimeoutMs = 5_000;
const shutdownSignals: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];

function getBaseUrl(output: string) {
  const match = /https?:\/\/127\.0\.0\.1:\d+\/?/.exec(output);

  return match?.[0];
}

function killProcessGroup(processId: number, signal: NodeJS.Signals) {
  try {
    process.kill(-processId, signal);
  } catch (error) {
    // ESRCH means the group is already gone, which is the outcome we wanted. Any other
    // failure must not escape teardown and strand the delegated integration cleanup.
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
      throw error;
    }
  }
}

// `detached: true` is what lets teardown reap the whole workerd group, but it also takes the child
// out of the terminal's foreground process group — so Ctrl+C reaches vitest and never the server,
// and vitest does not guarantee globalSetup teardown runs on a signal. Without this guard an
// interrupted run strands `astro dev` and workerd on the port indefinitely.
function registerOrphanGuard(processId: number) {
  const killGroup = () => {
    killProcessGroup(processId, "SIGKILL");
  };

  for (const signal of shutdownSignals) {
    process.once(signal, killGroup);
  }

  process.once("exit", killGroup);

  return () => {
    for (const signal of shutdownSignals) {
      process.off(signal, killGroup);
    }

    process.off("exit", killGroup);
  };
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

  // A signal-killed child leaves exitCode null and sets signalCode, so both must be checked
  // before signalling the group.
  if (!processId || child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  killProcessGroup(processId, "SIGTERM");

  const terminated = await Promise.race([exit.then(() => true), wait(shutdownTimeoutMs).then(() => false)]);

  if (!terminated) {
    killProcessGroup(processId, "SIGKILL");
    await exit;
  }
}

async function waitForServer(child: ChildProcess, getOutput: () => string, getSpawnError: () => Error | undefined) {
  const deadline = Date.now() + readinessTimeoutMs;

  while (Date.now() < deadline) {
    const output = getOutput();
    const baseUrl = getBaseUrl(output);
    const spawnError = getSpawnError();

    if (spawnError) {
      throw new Error(`Failed to spawn Astro dev: ${spawnError.message}`);
    }

    if (baseUrl) {
      try {
        // The loop deadline is only checked between iterations, so this fetch needs its own
        // bound — workerd can accept the connection and never answer, hanging setup forever.
        await fetch(baseUrl, { signal: AbortSignal.timeout(probeTimeoutMs) });

        return baseUrl;
      } catch {
        // workerd may announce its address just before the first request is ready.
      }
    }

    if (child.exitCode !== null || child.signalCode !== null) {
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
  let spawnError: Error | undefined;
  let unregisterOrphanGuard: (() => void) | undefined;

  try {
    server = spawn(process.execPath, [astroCliPath, "dev", "--host", "127.0.0.1", "--port", String(candidatePort)], {
      cwd: process.cwd(),
      detached: true,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    // Without this listener Node escalates a spawn failure to an uncaught exception, replacing
    // the readable diagnostics below with a raw stack.
    server.once("error", (error: Error) => {
      spawnError = error;
    });

    if (server.pid) {
      unregisterOrphanGuard = registerOrphanGuard(server.pid);
    }

    const appendOutput = (chunk: Buffer) => {
      output += chunk.toString();
    };

    server.stdout?.on("data", appendOutput);
    server.stderr?.on("data", appendOutput);

    const baseUrl = await waitForServer(
      server,
      () => output,
      () => spawnError,
    );

    // `output` only exists to find the announced URL and to report a failed start. Past readiness
    // it would grow unbounded — astro dev logs a line per request, and this suite uploads ~20 MiB.
    server.stdout?.off("data", appendOutput);
    server.stderr?.off("data", appendOutput);
    output = "";

    project.provide("httpBaseUrl", baseUrl);
  } catch (error) {
    // Mirrors the returned teardown below: stopping the server must never be able to strand the
    // delegated integration cleanup, or a failed setup leaks fixture users and Storage objects.
    try {
      if (server) {
        await stopServer(server);
      }
    } catch {
      // A shutdown failure here must not mask the setup error rethrown below.
    } finally {
      unregisterOrphanGuard?.();
      await integrationTeardown();
    }

    throw error;
  }

  return async () => {
    try {
      await stopServer(server);
    } catch (error) {
      // Mirrors global-setup.ts: vitest logs a teardown throw but still exits 0, so a stranded
      // server would otherwise report success. See lessons.md, "Always verify command status codes".
      process.exitCode = 1;

      throw error;
    } finally {
      unregisterOrphanGuard?.();
      await integrationTeardown();
    }
  };
}
