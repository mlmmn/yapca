<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Task-list and Mutation Integrity Implementation Plan

- **Plan**: `context/changes/testing-task-list-and-mutation-integrity/plan.md`
- **Mode**: Deep
- **Date**: 2026-07-28
- **Verdict**: SOUND
- **Original Verdict**: RETHINK
- **Findings**: 3 critical, 4 warnings, 0 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | PASS |
| Plan Completeness | PASS |

## Grounding

Grounding: 10/10 paths ✓, 7/7 symbols ✓, brief↔plan ✓

## Findings

### F1 — Progress titles violate the parser contract

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Progress — Phases 2–6
- **Detail**: Nine Progress titles did not exactly match their corresponding Success Criteria: Phase 2 had 2 mismatches, Phase 3 had 2, Phase 4 had 1, Phase 5 had 3, and Phase 6 had 1. `/10x-implement` treats this section as a mechanical contract.
- **Fix**: Copy the nine complete Success Criteria titles verbatim into their existing numbered Progress rows.
- **Decision**: FIXED — copied the nine complete Success Criteria titles into their existing numbered Progress rows

### F2 — Per-test authentication cannot sustain repeated verification

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Fixture strategy; Phase 2
- **Detail**: The plan signs in once for every test user, requires two immediate integration-suite runs, and caps local sign-ins at 30 per five minutes. The outlined cases naturally approach 19 sign-ins per run, so the second run can exhaust the limit. Stryker has been corrected to run unit tests only and is no longer part of this finding.
- **Fix A ⭐ Recommended**: Establish a small authenticated session pool once per Vitest run or worker and isolate test data with unique row IDs.
  - Strength: Keeps real JWTs and RLS while bounding Auth traffic.
  - Tradeoff: Requires explicit cookie-jar and within-user cleanup rules.
  - Confidence: HIGH — Vitest global setup and worker-scoped fixtures support it.
  - Blind spot: Confirm worker-scoped cleanup and cookie isolation under parallel test files.
- **Fix B**: Raise the local-only sign-in limit for the integration harness.
  - Strength: Preserves one-user-per-test isolation with less fixture work.
  - Tradeoff: Changes local Auth configuration and masks rate-sensitive behavior.
  - Confidence: HIGH — the current limit is explicit in `supabase/config.toml`.
  - Blind spot: Repeated suite runs may exceed the chosen ceiling again as coverage grows.
- **Decision**: FIXED via Fix A — bounded the integration harness to two worker-scoped session slots per worker, capped integration at two workers, and specified cookie and data isolation

### F3 — Namespaced TRUNCATE is not valid PostgreSQL

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 — Global cleanup
- **Detail**: `TRUNCATE` cannot filter test-namespaced users. `TRUNCATE ... CASCADE` would also remove the fixed development user the plan promises to preserve.
- **Fix**: Specify `DELETE FROM auth.users WHERE email LIKE <reserved-prefix>`; existing foreign keys cascade plants and watering events.
- **Decision**: FIXED — replaced namespaced TRUNCATE with prefix-scoped DELETE for setup and run-scoped DELETE for teardown

### F4 — Risk #2 test bypasses the production loader

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: End-State Alignment
- **Location**: Phase 3 — Integration test for the list query
- **Detail**: `loadPlants()` is private inside `authed-shell.astro`. The proposed test repeats its intended PostgREST select instead of invoking production code. Tests therefore remain green if the actual loader later gains a bad filter or mapping.
- **Fix ⭐ Recommended**: Extract the server loader into a shared server module used by both the Astro component and integration test, then pass its result through `selectDueRecords`.
  - Strength: Tests the real production seam without browser E2E.
  - Tradeoff: Adds a small production refactor to this testing phase.
  - Confidence: HIGH — the loader already has a clean data boundary.
  - Blind spot: Astro rendering and island hydration remain manually verified.
- **Decision**: FIXED — extracted loadTodayPlants into a shared server service used by authed-shell.astro and its integration test

### F5 — Phase 6 commands are not executable as specified

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Completeness
- **Location**: Phase 6 — SQL gate and mutation audit
- **Detail**: Stryker's `--incremental` is a valueless flag, so `--incremental false` is parsed incorrectly. Separately, Vitest's environment setup does not populate shell variables for a `psql` package script. “Every date in the SQL script” also includes expected due dates and fixture dates that are not season-dispatch inputs.
- **Fix**: Give exact commands: run each mutation range separately with `--force` or a non-incremental config; make `test:sql` load a deterministic DB URL and use `-v ON_ERROR_STOP=1`; compare only SQL `acted_on` inputs with `SEASON_BOUNDARIES`.
  - Strength: Turns Phase 6 into reproducible commands.
  - Tradeoff: Adds explicit environment and command plumbing.
  - Confidence: HIGH — verified against the installed CLIs and SQL cases.
  - Blind spot: None significant.
- **Decision**: FIXED — made test:sql self-contained with ON_ERROR_STOP, kept incremental mutation runs with --force for the final audit, and limited season parity to acted_on inputs

### F6 — Photo fixtures leak Storage objects

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phases 2 and 4 — Cleanup and photo-intent tests
- **Detail**: Deleting Auth users cascades plants and events, but not objects in `plant-photos`. “Keep” and final replacement objects therefore accumulate across repeated runs.
- **Fix**: Add test-user-prefix Storage cleanup and verify no namespaced objects remain after the suite.
- **Decision**: FIXED — added authenticated Storage cleanup before user deletion, per-test photo cleanup, and a post-suite no-leaks assertion

### F7 — Runner and shim wiring remains underspecified

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 — Runner split and shims
- **Detail**: The current `test` and Lefthook commands are unscoped; both will run every project unless `--project unit` is explicit. The plan also describes runtime paths “resolved at config time” without defining shim-private server/client aliases. Its claim that Lefthook uses undefined `pnpm run` scripts became stale in commit `b03e4c4`.
- **Fix**: Name projects `unit` and `integration`; state the exact package and hook commands; define shim-private aliases to the absolute Astro server/client runtime files; remove the stale hook diagnosis.
- **Decision**: FIXED — named both Vitest projects, specified exact package and Lefthook commands, defined private absolute runtime aliases, and removed the stale hook diagnosis

## Triage Summary

- **Date**: 2026-07-29
- **Fixed**: F1, F2 via Fix A, F3, F4, F5, F6, F7
- **Skipped**: None
- **Accepted**: None
- **Dismissed**: None
- **Verdict after fixes**: SOUND
