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

  for (const fixtureUser of fixtureUsers) {
    residualObjectPaths.push(...(await clearStorageObjectsForUser(fixtureUser.email, fixtureUser.id)));
  }

  deleteFixtureUsers(emailPattern);

  return residualObjectPaths;
}

export default async function globalSetup(project: TestProject) {
  const stalePattern = `${integrationFixtureConfig.TEST_EMAIL_PREFIX}%`;
  const runNamespace = `run-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const currentRunPattern = `${integrationFixtureConfig.TEST_EMAIL_PREFIX}${runNamespace}+%`;

  await cleanFixtureUsers(stalePattern);

  // globalSetup runs in a different global scope than the workers, so the namespace has to be
  // handed over explicitly. `provide`/`inject` is the documented channel; an earlier version
  // mutated `process.env` and relied on workers inheriting it at spawn time, which is a
  // property of the current pool rather than a contract. The namespace is what keeps one run's
  // teardown from deleting a concurrently running suite's users.
  project.provide("integrationRunNamespace", runNamespace);

  return async () => {
    // Clean up first and report second: whatever this run's users still own at teardown is
    // per-test hygiene the suite failed to maintain, and it should be surfaced — but not at the
    // cost of leaving the objects and their owners behind for the next run to trip over.
    const residualObjectPaths = await cleanFixtureUsers(currentRunPattern);

    if (residualObjectPaths.length > 0) {
      // Vitest logs a throw from teardown as "error during close" but still exits 0, and
      // `context/foundation/lessons.md:19-24` is explicit that the status code is the signal.
      // Set it here so this can never print a failure while passing a CI gate.
      process.exitCode = 1;

      throw new Error(`Integration suite left storage objects behind (now removed): ${residualObjectPaths.join(", ")}`);
    }
  };
}
