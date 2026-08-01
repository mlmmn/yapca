<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Per-Account Isolation

- **Plan**: context/changes/testing-per-account-isolation/plan.md
- **Scope**: Phases 1–3 of 3 (full plan)
- **Date**: 2026-08-01
- **Verdict**: NEEDS ATTENTION (triaged — 7 of 8 fixed, 1 deferred to Phase 5)
- **Findings**: 0 critical, 3 warnings, 5 observations
- **Triage**: F1–F5, F7, F8 FIXED; F6 SKIPPED (owned by rollout Phase 5)
- **Post-triage verification**: `pnpm check`, `pnpm lint`, `pnpm test` (102),
  `pnpm test:sql`, `pnpm test:integration` (35/35) all exit 0.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Verification performed

All five automated gates re-run with exit codes checked explicitly:
`pnpm test:sql` (3 files) = 0, `pnpm test:integration` (7 files / 35 tests) = 0,
`pnpm test` (102 tests) = 0, `pnpm check` = 0, `pnpm lint` = 0.

Both deliberate-break checks re-executed rather than taken on trust:

- Re-widening the `plants` INSERT grant → SQL suite exits 3 with the named
  exception "authenticated must not hold INSERT on plant pointer or audit
  columns". Local DB restored via the migration; per-column grants verified back
  to exactly the seven intended columns.
- Dropping `plants_select_own` → SQL suite exits 3, all 3 integration
  read-isolation tests fail. Policy restored; both suites re-confirmed green.

The migration's granted column set was verified to be an exact superset of what
`addPlant` writes (`src/actions/index.ts:69-76`) and to match `createPlantFixture`
(`test/fixtures/plants.ts:38-46`). `created_at`/`updated_at` are defaulted;
withholding INSERT on them is safe. `seed.sql:71` inserts as `postgres` and is
unaffected.

Note on the plan text: Phase 3 item 4 specified `status: complete` for
`change.md`, but no change in this repo has ever used that value —
`implemented` → `archived` is the actual convention. The implementation used
`implemented`, which is correct; the plan's wording was off. Not a finding.

## Findings

### F1 — `watering_events` privilege assertion is blind to column-level grants

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/tests/per-account-isolation.sql:63-70
- **Detail**: The deny-by-default assertion uses `has_table_privilege(…,
  'INSERT'|'UPDATE'|'DELETE')`, which returns false when only *column-level*
  grants exist. Demonstrated empirically: after `grant insert (plant_id) on
  public.watering_events to authenticated`, `has_table_privilege` reports
  `false` while `has_any_column_privilege` reports `true` — so a future
  column-level grant on `watering_events` would slip past this guard silently.
  This is pointed because the change itself introduces column-level INSERT
  grants on `plants` one table over, making that the shape a future migration is
  now most likely to use. The plants block at :82-103 already uses the
  column-aware form.
- **Fix**: Replace `has_table_privilege` with
  `has_any_column_privilege('authenticated', 'public.watering_events', <priv>)`
  in the three assertions at :63-70.
  - Strength: Matches the column-aware form already used at :82-103 in the same
    file; closes the exact blind spot demonstrated above.
  - Tradeoff: None — strictly stronger assertion, same shape.
  - Confidence: HIGH — behaviour difference confirmed by direct execution.
  - Blind spot: None significant.
- **Decision**: FIXED — swapped to `has_any_column_privilege` for INSERT/UPDATE,
  retaining `has_table_privilege` for DELETE (Postgres has no column-level
  DELETE; the naive swap failed with `unrecognized privilege type: "DELETE"`).
  Verified: a `grant insert (plant_id) on watering_events` now trips the
  assertion, and the suite is green once revoked.

### F2 — SQL runner reports success after executing zero test files

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: scripts/run-sql-tests.sh:7-13
- **Detail**: The glob is relative to `cwd`, and an unmatched glob leaves the
  literal string, which the `[ ! -f ]` guard skips via `continue`. The loop then
  ends and the script exits 0 having run nothing. Reproduced against an empty
  `supabase/tests/` directory: `EXIT=0`. Exit-code propagation for a *failing*
  file is correct (`set -eu` + bare `psql`, verified exits 3), so the runner
  solved the "forgotten file" half of its stated intent but still cannot
  distinguish "all passed" from "nothing ran" — the same false-green class the
  lessons register names.
- **Fix**: Add `cd "$(dirname "$0")/.." || exit 1` and a matched-file counter
  that exits non-zero when it is zero.
  - Strength: Makes the suite fail loudly in the one state where it currently
    lies, and removes the cwd dependency.
  - Tradeoff: Four extra lines of shell.
  - Confidence: HIGH — zero-file behaviour reproduced directly.
  - Blind spot: None significant.
- **Decision**: FIXED — added `cd "$(dirname "$0")/.."` and an `executed_count`
  guard that exits 1 with a message when no files ran. Verified: suite green,
  empty tests dir exits 1, and the runner now works from an unrelated cwd.

### F3 — Test helpers duplicated across the new test files

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Pattern Consistency
- **Location**: src/actions/per-account-isolation.integration.test.ts:11-56
- **Detail**: Three separate duplications, against the lessons-register rule
  "Extract generic helpers to src/lib, don't duplicate them in components":
  (a) `expectPhotoAbsentForOwner` (:43-56) is a near-verbatim copy of
  `expectPhotoAbsent` in `update-plant.integration.test.ts:60-68`, and only the
  older copy carries the comment explaining why listing beats a failing
  download; (b) `markPlantWatered` and the form-data builder (:11-32) are
  duplicated in `src/lib/services/per-account-isolation.integration.test.ts:14-50`
  under a different name (`createPlantActionFormData` vs
  `createPlantMutationFormData`), with a third variant in
  `update-plant.integration.test.ts:22-47`; (c) `tryReadWateringEvents`
  (`test/fixtures/plants.ts:91-106`) duplicates the watering-events half of
  `readPlantState` (:68-77). Phase 3 extracted three photo helpers into a shared
  fixture precisely to end this pattern, then re-created it alongside.
- **Fix A ⭐ Recommended**: Move the photo-absence helper and the form-data
  builders / `markPlantWatered` into `test/fixtures/`, and have `readPlantState`
  call `tryReadWateringEvents`.
  - Strength: Finishes the consolidation Phase 3 started; the shared fixture
    module already exists as the natural home.
  - Tradeoff: Touches three test files that are currently green; needs a re-run
    of the integration suite.
  - Confidence: HIGH — the helpers are behaviourally identical.
  - Blind spot: The two form-data builders may differ in a field that matters;
    not diffed field-by-field.
- **Fix B**: Consolidate only the photo-absence helper, leave the form-data
  builders local.
  - Strength: Smallest change; per-file form-data builders are a common and
    defensible test idiom.
  - Tradeoff: Leaves two of the three duplications in place.
  - Confidence: MEDIUM — depends how much the builders diverge over time.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A — new `test/fixtures/plant-actions.ts` holds
  `createPlantActionFormData`, `createEventActionFormData`,
  `createUpdatePlantFormData` and `markPlantWatered`; `expectPhotoAvailable` and
  `expectPhotoAbsent` (with the load-bearing listing comment, plus a new note
  that it must be called as the owner) moved into `test/fixtures/photos.ts`;
  `readPlantState` now calls `tryReadWateringEvents`. The services test keeps a
  three-line adapter over `createUpdatePlantFormData` because its row-shaped
  signature is a genuine local convenience, not duplicated logic. Verified:
  integration 35/35 (unchanged count), unit 102, sql, check, lint all green.

### F4 — Describe blocks named after fixtures, not the unit under test

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/services/per-account-isolation.integration.test.ts:52,70,93
- **Detail**: Top-level describes are named `tryReadPlant` and
  `tryReadWateringEvents` — the *test fixtures* — while the unit actually pinned
  is the `plants_select_own` / `watering_events_select_own` RLS policy. Reporter
  output implies the fixture helpers are the system under test. Separately,
  `describe("server.updatePlant")` at :93 collides with the identically named
  top-level describe in `update-plant.integration.test.ts:70`, so failures in
  the two files are indistinguishable by name. The sibling-describe, no-module-
  wrapper structure the lessons register requires is otherwise followed
  correctly.
- **Fix**: Rename the describes after the policy/behaviour pinned, and
  disambiguate the `server.updatePlant` block.
- **Decision**: FIXED — renamed to `plants_select_own`,
  `watering_events_select_own`, and `server.updatePlant cross-account pre-read`.
  File passes 3/3.

### F5 — Two victim-state snapshots only prove empty-to-empty

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/actions/per-account-isolation.integration.test.ts:69,92
- **Detail**: The plan required a full before/after snapshot asserting "the
  complete ordered `watering_events` array" is unchanged. In the `markWatered`
  and `postponePlant` cases the victim plant is created by `createPlantFixture`
  only, so the array is empty in both snapshots and the assertion proves `[]` →
  `[]`. It still catches an injected event — which is the F1 damage shape that
  motivated the requirement — so this is not vacuous, only weaker than the plan
  claims. The `undoWateringEvent` case (:114) does seed a real event first.
- **Fix**: Seed one watering event as the owner before the attacker call in the
  `markWatered` and `postponePlant` cases, so the ordered-array clause is
  actually exercised.
- **Decision**: FIXED — both cases now seed an owner event via
  `markPlantWatered` before the snapshot, with a comment saying why. All three
  cases additionally assert `beforeState.wateringEvents.length > 0` as a
  precondition, so the snapshot cannot silently regress to empty-to-empty.
  File passes 8/8.

### F6 — Neither `test:sql` nor `test:integration` runs in CI

- **Severity**: 📝 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Scope Discipline
- **Location**: .github/workflows/ci.yml:31-37
- **Detail**: CI runs `lint`, `check`, `test`, `TZ=… test`, `build` — but
  neither of the two suites this change created. The entire per-account
  isolation regression signal, including the INSERT-grant guard that is this
  change's security payload, currently fires only on a developer's laptop; a
  future migration re-widening the grant is merge-able with a green pipeline.
  **This is explicitly out of scope by the plan's own terms** ("Wiring the CI
  gate" is listed under What We're NOT Doing, owned by rollout Phase 5), so it
  is not drift — it is recorded here as the residual risk that scoping decision
  leaves open, and as the thing that determines when this change starts paying
  off.
- **Fix**: Leave to rollout Phase 5 as planned, or pull the `test:sql` job
  forward now if the INSERT-grant guard is wanted enforced before then.
- **Decision**: SKIPPED — deliberately left to rollout Phase 5, which owns gate
  wiring for every layer at once. Until then, the isolation suites are
  laptop-only by design; this is the change's known residual risk.

### F7 — Stale cross-reference after the SQL runner extraction

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: test/setup/load-env.ts:19-22
- **Detail**: The safety comment states "`package.json`'s `test:sql` hardcodes
  127.0.0.1:54322 for the same reason", but this change moved that string to
  `scripts/run-sql-tests.sh:12`. The local-only invariant is load-bearing and
  its documentation now points at the wrong file.
- **Fix**: Update the comment to reference `scripts/run-sql-tests.sh`.
- **Decision**: FIXED — comment now points at `scripts/run-sql-tests.sh`.

### F8 — Two denial helpers lose diagnostic value or under-constrain

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: test/fixtures/denial.ts:21-31
- **Detail**: `expectNoRowVisible` collapses to `expect(absent).toBe(true)`, so
  a genuine cross-account leak reports "expected false to be true" without
  printing the leaked row — the one moment the row's contents matter most.
  `expectStorageDenied` uses `.not.toBeNull()`, which also passes for
  `undefined`. Both are correct as written; both are one edit from being more
  informative. Separately, the storage `remove` no-op assertion at
  `per-account-isolation.integration.test.ts:226` pins client-library behaviour
  rather than a security property, and its own comment says so.
- **Fix**: Assert on the value directly in `expectNoRowVisible` (e.g.
  `expect(value ?? []).toEqual([])`) and tighten `expectStorageDenied` to
  require an error object.
- **Decision**: FIXED — `expectNoRowVisible` normalises to an array and asserts
  `toEqual([])`; `expectStorageDenied` uses `toBeTruthy` so `undefined` no
  longer passes. Verified against a real leak: with a temporary
  `using (true)` SELECT policy on `plants`, the helper fails with
  `expected [ { …(10) } ] to deeply equal []` — printing the leaked row instead
  of "expected false to be true". Policy dropped; all suites green. The storage
  `remove` no-op assertion was left in place.
