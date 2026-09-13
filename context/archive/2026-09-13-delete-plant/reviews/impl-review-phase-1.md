<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Delete Plant Implementation Plan

- **Plan**: context/changes/delete-plant/plan.md
- **Scope**: Phase 1 of 2
- **Date**: 2026-09-13
- **Verdict**: APPROVED (was NEEDS ATTENTION; both findings fixed during triage)
- **Findings**: 0 critical, 2 warnings, 0 observations — 2 fixed

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS (FAIL at review time; F1 fixed during triage) |
| Scope Discipline | PASS |
| Safety & Quality | PASS (WARNING at review time; F2 fixed via Fix A) |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Verification

| Criterion | Result | Evidence |
|-----------|--------|----------|
| `pnpm check` | PASS | Exit 0; 103 files checked, 0 errors. Existing deprecation hints remain outside this phase. |
| `pnpm lint` | PASS | Exit 0 with `--max-warnings=0`. |
| `pnpm test` | PASS | Exit 0; 7 files and 102 tests passed. |
| `pnpm test:integration` | PASS | Exit 0; 8 files and 39 tests passed, including `server.deletePlant`. |
| `pnpm test:sql` | PASS | Exit 0; all transaction-scoped SQL test files completed and rolled back. |
| Deliberate break check | PASS (recorded) | Progress 1.6 is checked at `b9955e6`; that commit records manual verification of photo-cleanup and NOT_FOUND failure checks. The review did not repeat the temporary source mutations. |

## Findings

### F1 — Cross-account preservation coverage is incomplete

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/actions/delete-plant.integration.test.ts:69; supabase/tests/delete-plant-cascade.sql:19
- **Detail**: The Phase 1 contract requires a foreign delete attempt to leave the owner's photo available, but the integration case creates no photo and makes no post-attempt photo assertion. The SQL contract also requires the second account's plant and events to remain untouched, but the second plant has no events and the final assertion checks only its row. The action and remaining test behavior match the plan.
- **Fix**: Add an uploaded owner photo plus a post-attempt `expectPhotoAvailable` assertion to the integration case; create events for the second SQL account and assert their count after deleting the owner's plant.
- **Decision**: FIXED — added both cross-account preservation controls; `pnpm test:integration` and `pnpm test:sql` pass.

### F2 — Shared photo path can be deleted while still referenced

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Safety & Quality
- **Location**: src/actions/index.ts:372
- **Detail**: After deleting a plant, the action unconditionally removes its returned `photo_path`. Authenticated clients may insert or update `plants.photo_path`, and the column has no uniqueness invariant. Two plants in one account can therefore reference one Storage object; deleting either plant removes the object and silently breaks the surviving plant. Normal app uploads use UUID paths, so this is an edge/invariant case rather than the common path.
- **Fix A ⭐ Recommended**: Add a migration enforcing uniqueness for non-null `plants.photo_path` values, with a preflight or cleanup strategy for any existing duplicates.
  - Strength: Makes the one-object-per-plant assumption an authoritative database invariant and removes the destructive state entirely.
  - Tradeoff: Expands the change beyond its no-migration plan boundary and requires deciding how to handle any existing duplicate paths.
  - Confidence: HIGH — direct authenticated writes include `photo_path`, and no current constraint prevents duplicates.
  - Blind spot: Existing production duplicate cardinality has not been measured.
- **Fix B**: After row deletion, check for another owner-visible plant referencing the path and remove the object only when no reference remains.
  - Strength: Preserves existing shared references without a schema migration and keeps the change localized to cleanup behavior.
  - Tradeoff: A separate reference check is race-prone unless moved into an atomic database workflow, and it complicates eventual orphan cleanup.
  - Confidence: MED — it handles existing duplicates but cannot fully enforce the invariant under concurrency by itself.
  - Blind spot: Concurrent plant/photo updates were not exercised.
- **Decision**: FIXED via Fix A — added `20260913193815_enforce_unique_plant_photo_paths.sql`, which aborts without rewriting data if legacy duplicates exist and then creates a partial unique index for non-null photo paths. The migration applied locally; a rolled-back duplicate-insert probe confirmed the invariant.

## Post-triage verification

| Command | Result | Evidence |
|---------|--------|----------|
| `pnpx supabase migration up` | PASS | Applied `20260913193815_enforce_unique_plant_photo_paths.sql` to the local database. |
| Rolled-back duplicate-path probe | PASS | The second plant insert raised `unique_violation`; transaction rolled back. |
| `pnpm check` | PASS | Exit 0; 103 files checked, 0 errors. |
| `pnpm lint` | PASS | Exit 0 with `--max-warnings=0`. |
| `pnpm test` | PASS | Exit 0; 7 files and 102 tests passed. |
| `pnpm test:integration` | PASS | Exit 0; 8 files and 39 tests passed. |
| `pnpm test:sql` | PASS | Exit 0; all SQL test transactions completed and rolled back. |

## Triage Summary

- **Fixed**: F1, F2 (Fix A)
- **Skipped**: None
- **Accepted as rule**: None
- **Pending**: None
