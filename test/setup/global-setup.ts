import { randomUUID } from "node:crypto";
import type { TestProject } from "vitest/node";
import {
  clearStorageObjectsForUser,
  deleteFixtureUsers,
  integrationFixtureConfig,
  listFixtureUsers,
} from "../fixtures/user";
import "./load-env";

async function cleanFixtureUsers(emailPattern: string) {
  const fixtureUsers = listFixtureUsers(emailPattern);
  const residualObjectPaths: string[] = [];
  const clearFailures: string[] = [];

  // Collect per-user failures rather than letting the first one escape. Clearing a user's Storage
  // folder requires signing in as them, so one un-signable prefixed row — a rotated password, or a
  // leftover from an older fixture revision — would otherwise throw before `deleteFixtureUsers`
  // below and leave itself in place, wedging every subsequent run on the same row with no recovery
  // short of manual psql. Delete unconditionally, report after.
  for (const fixtureUser of fixtureUsers) {
    try {
      residualObjectPaths.push(...(await clearStorageObjectsForUser(fixtureUser.email, fixtureUser.id)));
    } catch (error) {
      clearFailures.push(`${fixtureUser.email} (${error instanceof Error ? error.message : String(error)})`);
    }
  }

  deleteFixtureUsers(emailPattern);

  return { clearFailures, residualObjectPaths };
}

export default async function globalSetup(project: TestProject) {
  const stalePattern = `${integrationFixtureConfig.TEST_EMAIL_PREFIX}%`;
  const runNamespace = `run-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const currentRunPattern = `${integrationFixtureConfig.TEST_EMAIL_PREFIX}${runNamespace}+%`;
  const staleSweep = await cleanFixtureUsers(stalePattern);

  if (staleSweep.clearFailures.length > 0) {
    // Warn rather than fail: these are a previous run's leftovers, their rows are gone by now, and
    // the only residue is orphaned Storage objects. Failing here would punish this run for the
    // previous one's crash — while still leaving the objects behind.
    // eslint-disable-next-line no-console
    console.warn(`Stale fixture-user storage could not be cleared: ${staleSweep.clearFailures.join("; ")}`);
  }

  // globalSetup runs in a different global scope than the workers, so the namespace has to be
  // handed over explicitly. `provide`/`inject` is the documented channel; an earlier version
  // mutated `process.env` and relied on workers inheriting it at spawn time, which is a
  // property of the current pool rather than a contract. The namespace is what keeps one run's
  // *teardown* from deleting a concurrently running suite's users — note the stale sweep above is
  // deliberately namespace-blind, so two suites started against one stack still collide at startup.
  project.provide("integrationRunNamespace", runNamespace);

  return async () => {
    // Vitest logs a throw from teardown as "error during close" but still exits 0, and
    // `context/foundation/lessons.md:19-24` is explicit that the status code is the signal. Every
    // exit from this block sets it — a failed cleanup is as invisible to CI as a residual object,
    // and leaves the run's users behind for the next run to trip over.
    try {
      // Clean up first and report second: whatever this run's users still own at teardown is
      // per-test hygiene the suite failed to maintain, and it should be surfaced — but not at the
      // cost of leaving the objects and their owners behind for the next run to trip over.
      const { clearFailures, residualObjectPaths } = await cleanFixtureUsers(currentRunPattern);
      const problems: string[] = [];

      if (residualObjectPaths.length > 0) {
        problems.push(`left storage objects behind (now removed): ${residualObjectPaths.join(", ")}`);
      }

      if (clearFailures.length > 0) {
        problems.push(`could not clear storage for: ${clearFailures.join("; ")}`);
      }

      if (problems.length > 0) {
        throw new Error(`Integration suite teardown — ${problems.join(" | ")}`);
      }
    } catch (error) {
      process.exitCode = 1;

      throw error;
    }
  };
}
