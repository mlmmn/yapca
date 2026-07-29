<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Task-list and Mutation Integrity — Phase 2 (Fixture Layer)

- **Plan**: `context/changes/testing-task-list-and-mutation-integrity/plan.md`
- **Scope**: Phase 2 of 6
- **Date**: 2026-07-30
- **Verdict**: NEEDS ATTENTION
- **Findings**: 1 critical, 4 warnings, 3 observations (F8 discovered during triage)

## Verdicts

Verdicts as reviewed, before triage. After triage every dimension except Scope Discipline
(F4, accepted by the author) is PASS.

| Dimension | Verdict | After triage |
|-----------|---------|--------------|
| Plan Adherence | WARNING | PASS (F1, F2, F5 fixed) |
| Scope Discipline | WARNING | WARNING (F4 accepted as-is) |
| Safety & Quality | WARNING | PASS (F1, F7, F8 fixed) |
| Architecture | PASS | PASS |
| Pattern Consistency | WARNING | PASS (F6 fixed) |
| Success Criteria | WARNING | PASS (F3 fixed) |

## Verification performed

Automated criteria, all run by this review:

| Criterion | Result |
|---|---|
| 2.1 `pnpm test:integration` with stack running | PASS — 2 files, 3 tests, 0.8 s (required `SUPABASE_DB_URL` in the environment; absent from local `.env`, documented at `README.md:38-41`) |
| 2.2 `pnpm test` | PASS — 5 files, 73 tests, 292 ms |
| 2.3 unauthenticated case yields `UNAUTHORIZED` | PASS as written; see F3 — the assertion does not reach the database |
| 2.4 `pnpm lint` / `pnpm check` | PASS — ESLint clean, `astro check` 0 errors 0 warnings |

Manual criteria checked opportunistically while reviewing (evidence recorded here; the
Progress checkboxes remain the implementer's to flip):

- 2.5 back-to-back runs — both green.
- 2.6 deliberate break — a temporary probe asserting `next_due_on === "1999-01-01"`
  failed with `expected '2026-08-05' to be '1999-01-01'`. The harness genuinely writes.
- 2.7 `auth.users` accumulation — `yapca-integration+%` count was 0 before and 0 after
  a full run.
- 2.8 Storage residue — after F7's fix, verified by probe: a test that deliberately leaks a
  storage object makes the run exit 1 and names the path; a clean run exits 0.

## Post-triage state

All six fixed findings re-verified together: `pnpm test` 81 passed (was 73 — F6 added 8
`addDays` cases), `pnpm test:integration` 4 passed (was 3 — F3 added the sessionless case),
two consecutive integration runs green, `pnpm lint` and `pnpm check` exit 0, and
`yapca-integration+%` users back to 0 afterwards. Login cost per run is now constant rather
than per-test.

Two items for Phase 6's §6.2 write-up, both consequences of F8: the pool is **file**-scoped,
not worker-scoped, so the plan's "at most four sign-ins per suite run" should be restated in
terms of test files; and `assertNoStorageObjects(client, userId)` is the helper Phase 4's
per-photo-case hygiene assertion should use, since it costs no sign-in.

## Findings

### F1 — Storage cleanup signs in on every call, breaking the plan's sign-in budget

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence / Safety & Quality
- **Location**: `test/fixtures/user.ts:282`, `test/fixtures/user.ts:306`, `test/fixtures/user.ts:379`
- **Detail**: `removeAllStorageObjectsForUser` and `assertNoStorageObjectsRemain` each
  construct a fresh client and call `signInWithPassword`. `resetUserSlot` calls the
  former on *every* test, so each test costs one extra sign-in beyond the pooled
  session it was supposed to reuse. Measured against `auth.audit_log_entries`: a single
  fixture-using test produced **4 logins** (slot sign-in, per-test reset, teardown
  remove, teardown assert). The plan's Performance Considerations section bounds a
  complete run at "at most four sign-ins per suite run" and eight across two
  back-to-back runs, against `supabase/config.toml:189` `sign_in_sign_ups = 30` per
  5 minutes per IP. Phase 4 additionally requires a Storage-empty assertion after each
  photo-intent case — a second per-test sign-in. Projecting Phases 3–5 at ~25 fixture
  tests puts a single run at 50–60 sign-ins, i.e. rate-limited auth failures presenting
  as flaky integration tests, on the machine of whoever runs the suite twice.
  Related: `getIntegrationUserFixture(slotNumber)` (`:391`) does not bound `slotNumber`
  against `USER_SLOT_COUNT`, so a future `getIntegrationUserFixture(2)` silently
  expands the pool past the computed bound instead of failing loudly.
- **Fix**: Change both helpers to take an already-authenticated
  `IntegrationSupabaseClient` (the slot's `client`) instead of `(email, userId)`, and
  keep a single sign-in path only for the stale-user cleanup in `global-setup.ts`,
  where no slot exists. Add a range check in `getIntegrationUserFixture` so an
  out-of-pool slot throws.
  - Strength: Restores the plan's arithmetic exactly, and the slot client is already a
    genuine `authenticated` session, so the Storage calls stay RLS-subject — the
    property the plan chose the anon-key sign-in for in the first place.
  - Tradeoff: Two call sites in `global-setup.ts` need the sign-in variant retained,
    so the module keeps both shapes.
  - Confidence: HIGH — measured directly from the audit log; the rate limit and the
    plan's stated bound are both explicit.
  - Blind spot: Not verified whether Storage `remove` under a user JWT is subject to a
    separate bucket policy that the cleanup client's fresh session happens to satisfy
    differently; `plant-photos` policies were not re-read during this review.
- **Decision**: FIXED — `removeAllStorageObjects` / `assertNoStorageObjects` now take an
  authenticated client; the `…ForUser` sign-in wrappers remain for `global-setup.ts`
  only. Slot range check added to `ensureUserSlot`. Re-measured: a run costs 3 logins
  (was 4), and the per-test cost is now zero — the remainder is bounded by pool size
  rather than by test count.

### F2 — Per-test reset is keyed by test name, not driven by `beforeEach`

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence / Safety & Quality
- **Location**: `test/fixtures/user.ts:395`
- **Detail**: The plan's contract reads "Before each test, delete domain rows owned by
  the selected slot". The implementation instead memoises on
  `expect.getState().currentTestName` and resets only when the name differs from
  `slot.lastPreparedTestName`. `currentTestName` is `describe > test` and carries no
  file path, so two files landing on the same worker with an identical
  describe/test-name pair skip the reset and inherit each other's rows — silently, as
  extra rows rather than an error. The same hole opens on a retried test: the retry
  sees the same name and runs against the failed attempt's leftovers. With Phases 3–5
  adding three more integration files under `maxWorkers: 2`, name collision stops being
  hypothetical.
- **Fix A ⭐ Recommended**: Reset unconditionally per test — export a
  `resetIntegrationSlot`-style helper the test files call from `beforeEach`, or key the
  memo on a monotonic per-test token rather than the name.
  - Strength: Matches the plan's stated contract, and removes the correctness
    dependence on test names being globally unique.
  - Tradeoff: Adds one round trip per test even when the previous test left nothing —
    negligible next to the sign-in cost F1 removes.
  - Confidence: HIGH — the collision mechanism is directly readable from
    `currentTestName`'s contents.
  - Blind spot: Whether Vitest 4 exposes a stable per-test id for the token form was
    not checked; the `beforeEach` form needs no such API.
- **Fix B**: Include the test file path in the key (`expect.getState().testPath`).
  - Strength: One-line change, keeps the lazy-reset optimisation.
  - Tradeoff: Still wrong for retries, and still fails if one file ever has two
    same-named tests.
  - Confidence: MEDIUM — narrows the window without closing it.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A — `test/setup/reset-integration-slots.ts` registers
  `beforeEach(markIntegrationSlotsDirty)` (added to the integration project's
  `setupFiles`); the reset itself stays lazy in `getIntegrationUserFixture`, which now
  throws if the hook never ran rather than silently sharing state. `createUniqueName`
  uses a monotonic per-worker counter, so uniqueness no longer depends on test names
  being distinct. Verified with a temporary two-file probe using an identical
  `describe > test` name pair: both files now observe 0 pre-existing plants.

### F8 — Two fixture-using test files on one worker crash on a duplicate email

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality / Architecture
- **Location**: `test/fixtures/user.ts:184` (`createConfirmedUser`)
- **Detail**: Found while verifying F2's fix, not in the original pass. The user pool is
  described as "a worker-local module singleton", but Vitest isolates the module graph
  per *test file*, so the slot memo is file-local: every fixture-using file on a worker
  re-runs `createConfirmedUser` with the same `+w<id>+s<n>` email and a fresh
  `crypto.randomUUID()`. `on conflict (id) do nothing` cannot absorb that — the conflict
  is on `auth.users`' unique email index — so the insert raises and the test fails with a
  raw psql dump. Reproduced by adding one more fixture-using file:
  `Command failed: psql … insert into auth.users` on both files.
  Phase 2 hides this because its second integration file (the Phase 1 shim guard) never
  touches the fixture. Phase 3 adds `load-today-plants.integration.test.ts`, Phases 4–5
  add two more — four fixture files across `maxWorkers: 2` guarantees the collision.
- **Fix**: Derive the user id from the email (`createFixtureUserId`, sha1-based
  UUID shape) so the insert is genuinely idempotent and a second file on the worker
  adopts the first file's row.
  - Strength: Keeps the existing `on conflict (id) do nothing` correct instead of
    reaching for a partial-index `on conflict (email) where is_sso_user = false`, which
    would couple the fixture to Supabase's internal index definition.
  - Tradeoff: Sign-ins are per file rather than per worker (file count × slots, ~10 for
    the finished suite) — still well inside the 30-per-5-minute limit, but the plan's
    "at most four sign-ins per suite run" arithmetic should be restated in terms of
    files, not workers, when Phase 6 writes §6.2.
  - Confidence: HIGH — reproduced before the fix and green after, in both
    `--no-file-parallelism` and normal parallel mode.
  - Blind spot: If a future test ever needs two *distinct* users on one worker slot, the
    deterministic id makes that a deliberate change rather than an accident — which is
    the intent, but it does mean slot count is now the only axis for adding identities.
- **Decision**: FIXED

### F3 — The unauthenticated test proves the app guard, not that the harness is unprivileged

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: `src/actions/harness.integration.test.ts:56`
- **Detail**: The plan states this test's intent as "confirming the harness is
  genuinely subject to auth rather than running privileged". As written it passes
  `locals.user: null`, which `requireSession` (`src/actions/index.ts:16`) rejects
  before any client call — so the database is never contacted and the assertion could
  not distinguish a privileged harness from an unprivileged one. This is the plan's own
  Testing Strategy anti-pattern #2 ("a pass-through seam that asserts nothing").
  The substrate itself is fine: a probe run during this review, with `locals.user`
  present but the session cookie stripped from the request, returned
  `42501 permission denied for function mark_watered`. That is the observation the
  criterion wants, and no shipped test makes it.
- **Fix**: Add a third case with a valid `locals.user` and no `Cookie` header on the
  request, asserting the action rejects and the plant's `next_due_on` is unchanged.
  Verified during review to fail on the RPC's permission check rather than the app
  guard.
- **Decision**: FIXED — added `createSessionlessActionContext` to
  `test/fixtures/action-context.ts` and a third harness test, "cannot mutate through the
  database without a session cookie", asserting `INTERNAL_SERVER_ERROR` (the action's
  mapping of postgres `42501`) plus an unchanged `next_due_on` and an empty journal.
  Integration suite is now 4 tests, green.

### F4 — Unrelated `sandbox_mode = "danger-full-access"` in the phase's diff

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: `.codex/config.toml:1`
- **Detail**: The staged diff adds `sandbox_mode = "danger-full-access"` to the Codex
  agent config. It is not in the plan's Changes Required for any phase, is unrelated to
  the fixture layer, and disables an agent sandbox for the whole repository. Landing it
  inside a testing commit hides an environment-trust change in a diff nobody will read
  for that.
- **Fix**: Unstage it from this phase's commit and land it separately (or drop it).
- **Decision**: ACCEPTED — the author chose to keep it staged in this commit.

### F5 — Run namespace crosses to workers via `process.env`, not Vitest `provide()`

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `test/setup/global-setup.ts:30`, `test/fixtures/user.ts:42`
- **Detail**: The contract says the globalSetup "generates a serializable run namespace
  and **provides it to workers**" — Vitest's `provide()`/`inject()` pair. The
  implementation mutates `process.env.YAPCA_INTEGRATION_RUN_NAMESPACE` and reads it back
  in the worker. This works today because workers are spawned after globalSetup and
  inherit the parent environment, and the failure is loud (`getRunNamespace` throws with
  an actionable message) rather than silent. It is nonetheless coupled to pool and
  isolation behaviour the config can change, and the namespace is the only thing keeping
  one run's teardown from deleting a concurrent run's users.
- **Fix**: Return the namespace from globalSetup via `provide("runNamespace", …)` and
  read it with `inject()`, keeping the throw as the missing-value path.
- **Decision**: FIXED — `globalSetup(project: TestProject)` now calls
  `project.provide("integrationRunNamespace", …)` and `getRunNamespace()` uses `inject()`.
  The `ProvidedContext` augmentation lives in `test/setup/provided-context.d.ts`, not
  beside the `provide()` call: `user.ts` does not import the setup module, so an in-file
  augmentation is outside its program and `inject()` types as `never`.

### F6 — `addDays` duplicated between fixture and test file

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `test/fixtures/plants.ts:22`, `src/actions/harness.integration.test.ts:8`
- **Detail**: Two byte-identical `addDays` implementations, one in the fixture and one
  in the first test that consumes it. `src/lib/date.ts` has no equivalent, so the next
  three integration files will each want a third and fourth copy. This is precisely the
  drift shape `context/foundation/lessons.md:5-10` records ("Extract generic helpers to
  src/lib, don't duplicate them in components" — `todayLocalDateString()` is the cited
  precedent), and Phase 3 is about to remove another instance of the same shape from
  `today-list.tsx`.
- **Fix**: Export one `addDays` — `src/lib/date.ts` if production code will want it,
  otherwise a single `test/fixtures/` module — and import it in both places.
- **Decision**: FIXED — `addDays` now lives in `src/lib/date.ts`, composed from the
  existing `toEpochDay`/`fromEpochDay` pair rather than re-implementing `Date.setUTCDate`,
  so day arithmetic has one implementation. Both copies deleted; 8 table-driven unit cases
  added in `src/lib/date.test.ts` (month, year and leap-day boundaries, negative offsets)
  with literal expected dates rather than epoch-day arithmetic. Unit suite 73 → 81.

### F7 — Teardown asserts the deletion it just performed

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `test/setup/global-setup.ts:35-41`
- **Detail**: The teardown loops `removeAllStorageObjectsForUser` over the run's users
  and then loops `assertNoStorageObjectsRemain` over the same users. The second loop can
  only fail if `remove` silently no-ops, which the first loop's own error handling
  already covers — so it is close to tautological, and it is the sole evidence behind
  manual criterion 2.8 ("No Storage objects owned by namespaced test users remain").
  The plan does specify this sequence, so this is a note on the plan as much as the
  code. Note it also costs one sign-in per user (see F1).
- **Fix**: Move the assertion *before* the removal (assert what the suite left behind,
  then clean up), which turns 2.8 into a real signal about test hygiene rather than a
  restatement of the delete.
- **Decision**: FIXED — `clearStorageObjectsForUser` now lists, removes, and *returns* the
  paths it removed in one sign-in; teardown cleans unconditionally and then fails on any
  residue, so a leak cannot be hidden by the cleanup that follows it.
  Verifying the new check surfaced a second problem: Vitest logs a `globalSetup` teardown
  throw as "error during close" but **still exits 0**, so the check would have printed a
  failure while passing a CI gate — exactly what
  `context/foundation/lessons.md:19-24` warns about. The teardown now sets
  `process.exitCode = 1` alongside the throw. Probed with a test that deliberately leaks a
  storage object: exit 1 with the object's path named, exit 0 when clean.
