<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Task-list and Mutation Integrity — Phase 1

- **Plan**: `context/changes/testing-task-list-and-mutation-integrity/plan.md`
- **Scope**: Phase 1 of 6 — Runner Split and Module Shims
- **Date**: 2026-07-29
- **Verdict**: REJECTED at review → **APPROVED after triage** (see Post-triage verification)
- **Findings**: 1 critical, 4 warnings, 2 observations (F7 found during triage)
- **Triage**: 6 fixed, 1 skipped

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | FAIL |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | FAIL |

## Verification log

| Criterion | Result | Evidence |
|---|---|---|
| 1.1 `pnpm test` with stack stopped | PASS | 5 files / 73 tests, exit 0 |
| 1.2 `pnpm lint --max-warnings=0` | PASS | "ESLint: No issues found" |
| 1.3 `pnpm check` | PASS | 71 files, 0 errors, 0 warnings. Confirmed non-vacuous — a deliberate type error injected into `test/shims/astro-env-server.ts` was caught, then reverted, so `test/` is genuinely in the checked program |
| 1.4 Throwaway integration test resolves both virtual modules | **FAIL as invoked** | `pnpm test:integration` → `Missing: SUPABASE_DB_URL`. With `SUPABASE_DB_URL` supplied out of band: 1 file / 1 test passes, so the shim mechanism itself is proven — see F2 |

The substantive Phase 1 deliverable works: `src/actions/index.ts` imports cleanly outside
Astro's build, with both `astro:env/server` and `astro:actions` resolved through the
absolute-path aliases into `dist/actions/runtime/`. The findings below are about what the
project split broke elsewhere and where contracts were only partially met.

## Findings

### F1 — Project split breaks `pnpm test:mutants` and every all-project vitest run

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `vitest.config.ts:48`
- **Detail**: The integration project sets `maxWorkers: 2` while the unit project leaves it
  default, and neither sets `sequence.groupOrder`. Vitest 4.1.10 rejects that combination:

  ```
  Error: Projects "integration" and "unit" have different 'maxWorkers'
  but same 'sequence.groupOrder'. Provide unique 'sequence.groupOrder' for them.
      at groupSpecs (vitest/dist/chunks/cli-api…:3808:8)
  ```

  Reproduced two independent ways: `npx vitest run` (exit 1, "Test Files no tests") and
  `pnpm test:mutants --mutate "src/lib/season.ts" --force`, which dies in
  `DryRunExecutor` with "Something went wrong in the initial test run" — Stryker's vitest
  runner invokes vitest programmatically with no `--project` filter, so it always spans
  both projects.

  This regresses `test:mutants`, a script committed and working at `5dbad4a`, and blocks
  Phase 6 §3's mutation audit outright. It also directly contradicts this plan's own
  sequencing rationale ("Six phases, ordered so that nothing can break the existing green
  suite"). It escaped detection because every criterion Phase 1 checks — `pnpm test`,
  `test:integration`, and the lefthook command — passes `--project`, so no verified path
  exercises the multi-project resolution that Stryker depends on.
- **Fix**: Give each project an explicit `sequence.groupOrder` in `vitest.config.ts` —
  `sequence: { groupOrder: 0 }` on the unit project, `sequence: { groupOrder: 1 }` on the
  integration project.
  - Strength: Verified end to end. With the two lines applied, `npx vitest run` exits 0
    with 6 files / 74 tests passing, and `pnpm test:mutants --mutate "src/lib/season.ts"
    --force` exits 0 with "Initial test run succeeded. Ran 22 tests". The ordering is also
    semantically right — the fast unit project runs first.
  - Tradeoff: None material; two lines, no behaviour change to either scoped script.
  - Confidence: HIGH — the fix was applied, both commands were run green, and the config
    was restored to its reviewed state.
  - Blind spot: None significant. Consider adding a bare `npx vitest run` (or
    `pnpm test:mutants` dry run) to Phase 1's automated criteria so this class of
    multi-project breakage cannot pass verification again.
- **Decision**: FIXED — `sequence.groupOrder` 0/1 added to `vitest.config.ts` with an
  explanatory comment. Also added plan criterion 1.7
  (`pnpm test:mutants --mutate "src/lib/season.ts" --force` exits 0), chosen over a bare
  `npx vitest run` because it exercises multi-project resolution without needing Docker.
  Verified after the fix: `pnpm test:mutants` exits 0 ("Initial test run succeeded. Ran 22
  tests"), `pnpm test` green at 73 tests, and the `groupOrder` error is absent from a bare
  `npx vitest run`.

### F2 — Progress 1.4 is checked `[x]` but does not reproduce

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Success Criteria
- **Location**: `test/setup/load-env.ts:1`, `README.md:27`
- **Detail**: `pnpm test:integration` fails on this checkout with
  `Integration tests require a local Supabase stack. … Missing: SUPABASE_DB_URL`.
  The local `.env` holds `SUPABASE_URL`, `SUPABASE_KEY`, `CLOUDFLARE_API_TOKEN`,
  `CLOUDFLARE_ACCOUNT_ID` — no `SUPABASE_DB_URL`.

  Two causes compound. First, `.env.example` gained `SUPABASE_DB_URL` but `README.md:27`
  still instructs only "Copy the printed `SUPABASE_URL` and anon `SUPABASE_KEY` into
  `.env`", so nothing tells an existing contributor to add the third variable — and
  `cp .env.example .env` is a one-time bootstrap step nobody re-runs.

  Second, `load-env.ts` gates *all* integration tests on `SUPABASE_DB_URL`, but Phase 1's
  only integration test imports a module and asserts `server` is defined. It touches no
  database. The direct-postgres URL is a Phase 2 fixture dependency (`test/fixtures/user.ts`
  mints users via psql); requiring it in Phase 1 makes Phase 1's own verification depend on
  a later phase's provisioning. Supplying the variable out of band makes the test pass, so
  the shim work is sound — only the gate and the docs are wrong.
- **Fix A ⭐ Recommended**: Update `README.md:27` to name all three variables, and keep the
  gate as-is.
  - Strength: Preserves one loud, early failure point with an actionable message — the
    behaviour the plan's contract actually asked for. Cheapest correct change.
  - Tradeoff: Contributors who only want to run the shim-resolution test still need a
    variable that test does not use.
  - Confidence: HIGH — the gate's message already names `pnpx supabase start`; only the
    README drifted from `.env.example`.
  - Blind spot: Does not address the Phase 1/Phase 2 dependency inversion, which will be
    invisible once Phase 2 lands and genuinely needs the variable.
- **Fix B**: Move the `SUPABASE_DB_URL` requirement out of the shared `setupFiles` gate into
  the Phase 2 psql fixture that consumes it, and update the README as well.
  - Strength: Each phase's verification depends only on what that phase needs; Phase 1's
    criterion becomes reproducible on a bare checkout.
  - Tradeoff: Splits the "fail loudly and early" check across two places, and the failure
    surfaces later — at fixture use rather than at setup.
  - Confidence: MEDIUM — the fixture module the check would move into does not exist yet,
    so this partly defers work into Phase 2.
  - Blind spot: Haven't confirmed whether Phase 2 wants psql access from `globalSetup` too,
    which would need its own check.
- **Decision**: FIXED via Fix A — `README.md` now lists all three variables and states that
  `SUPABASE_DB_URL` is integration-suite-only, that the app never reads it, and that an
  existing `.env` will not pick it up from `cp .env.example .env`. The setup gate is
  unchanged. The Phase 1/Phase 2 dependency inversion is accepted as-is; it becomes moot
  once Phase 2's psql fixtures genuinely need the variable.
- **Note**: Progress row 1.4 is left `[x]`. The criterion does hold once the documented
  variable is present — verified by supplying it out of band — so the shim resolution it
  attests to is real; only the local `.env` was stale.

### F3 — `load-env.ts` throws a raw ENOENT when `.env` is absent

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `test/setup/load-env.ts:3`
- **Detail**: The plan's contract for this file is that it "fails loudly with an actionable
  message (naming `pnpx supabase start`) if they are absent, rather than letting
  `createClient` return `null` and surface as a confusing downstream error."

  `process.loadEnvFile(".env")` is called unguarded on line 3, before the check on lines
  5–17. Node throws when the file is missing — verified directly:

  ```
  THROWS: ENOENT | ENOENT: no such file or directory, open '.env'
  ```

  A fresh clone ships `.env.example`, not `.env`, so the first contributor to run
  `pnpm test:integration` before bootstrapping gets a bare filesystem error instead of the
  message written six lines below. The relative path also makes the call cwd-dependent
  rather than repo-root-anchored.
- **Fix**: Wrap the `loadEnvFile` call in try/catch and let the existing missing-variable
  check produce the message (the variables will be absent either way), resolving the path
  from the module's own location rather than cwd.
- **Decision**: FIXED — `loadEnvFile` is now wrapped in try/catch with a comment explaining
  the fall-through, and the path is anchored via `fileURLToPath(import.meta.url)`. Both
  branches verified: with `.env` moved aside the suite reports the actionable message and no
  `ENOENT`; with `.env` restored it passes 1/1.

### F4 — Shim over-exports a symbol `astro:env/server` does not have

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `test/shims/astro-env-server.ts:3`
- **Detail**: The plan's contract is that this shim "exports `SUPABASE_URL` and
  `SUPABASE_KEY` read from `process.env`". The implementation adds a third export,
  `SUPABASE_DB_URL`. `astro.config.mjs:21-22` declares only the two, so the real virtual
  module has no such member.

  A shim exists to substitute faithfully. Because this one is a superset, a future test (or
  production module refactored under it) could `import { SUPABASE_DB_URL } from
  "astro:env/server"`, pass the integration suite, and fail in the real Astro build — the
  exact class of error the shim is supposed to make impossible. `src/lib/supabase.ts:3` is
  the sole consumer today and imports only the two, so nothing is broken right now.
- **Fix**: Drop `SUPABASE_DB_URL` from the shim and have the psql fixture read
  `process.env.SUPABASE_DB_URL` directly — it is harness configuration, not application env.
- **Decision**: FIXED — the shim now exports only the two members `astro.config.mjs`
  declares, with a comment stating the mirror-never-superset rule and directing
  harness-only configuration to the fixture that needs it. Phase 2's psql fixture must read
  `process.env.SUPABASE_DB_URL` directly.

### F5 — Unit project's `exclude` silently replaces Vitest's defaults

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `vitest.config.ts:26`
- **Detail**: `exclude: ["src/**/*.integration.test.{ts,tsx}"]` overwrites rather than
  extends Vitest's default exclude list (`**/node_modules/**`, `**/dist/**`, …). Harmless
  today because `include` is scoped to `src/**` and neither `node_modules` nor `dist` lives
  under `src/`. It becomes a real problem only if `include` is ever widened — a latent trap
  for whoever does that.
- **Fix**: No change required. If you want it belt-and-braces, spread
  `configDefaults.test.exclude` before the integration glob.
- **Decision**: SKIPPED — accepted as latent. Revisit if the unit project's `include` is ever
  widened beyond `src/**`.

### F6 — Two files beyond the plan's stated contract

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `test/shims/astro-actions-runtime.d.ts`, `src/actions/resolve-actions-shims.integration.test.ts`
- **Detail**: Both are EXTRA relative to the plan text, and both look justified:

  `astro-actions-runtime.d.ts` declares the two `virtual:yapca-test/*` specifiers so
  TypeScript can resolve what only Vite knows about. Its bodies re-export from
  `astro/dist/actions/runtime/{server,client}` — a package-internal subpath absent from
  Astro's `exports` map (confirmed: no `dist` or `./*` key). The plan said "Neither shim
  imports Astro's public `astro:actions` entrypoint or an unaliased package-internal
  subpath." This is a type-only reference in a `declare module` body rather than a runtime
  import, and it does resolve — `pnpm check` is 0 errors and was proven non-vacuous. So it
  honours the contract's intent while touching its letter; worth naming because it is a
  second, undocumented coupling point to Astro's internal layout on top of the one the
  shim comment already flags.

  `resolve-actions-shims.integration.test.ts` is criterion 1.4's "throwaway" test, retained
  rather than deleted. Keeping it is the better call — it is currently the only automated
  guard on the shim aliasing, and Phase 2's `harness.integration.test.ts` will not replace
  that role. Its `describe`/`test` naming follows repo convention.
- **Fix**: Extend the existing shim comment in `astro-actions.ts` to cover the `.d.ts`'s
  parallel dependency on `dist/actions/runtime/`, so a future Astro upgrade finds both
  coupling points from one note. Keep the retained test; consider promoting it in the plan
  from "throwaway" to a permanent shim regression guard.
- **Decision**: FIXED — both parts. The shim comment now enumerates both coupling points and
  notes that only the runtime aliases fail loudly at test time while the `.d.ts` surfaces as
  a `pnpm check` error. The plan's Phase 1 criterion no longer calls the test "throwaway" and
  states why it is retained.

### F7 — Shim aliases resolve against cwd, not the config file

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `vitest.config.ts:40-41`
- **Found**: During F3's verification, not in the initial scan.
- **Detail**: `path.resolve("test/shims/astro-env-server.ts")` resolves against
  `process.cwd()`, not the config file's directory. Verified by running the integration
  project with cwd at `/Users/…/yapca/src` and an explicit `--root` pointing at the repo
  root — it failed with `Cannot find package 'astro:actions' imported from
  src/actions/index.ts`. The aliases point at a nonexistent path and Vite falls through to
  real module resolution, so the failure names `astro:actions` rather than the alias that
  did not resolve.

  `pnpm test:integration` always runs from the package root, so the scripted paths were
  fine; IDE test runners and subdirectory invocations were not. Notably the
  `astroActionsServerPath` / `…ClientPath` constants above were already correctly anchored
  via `require.resolve`, so only these two entries diverged from the file's own pattern.
- **Fix**: Anchor both to the config file's directory via
  `path.dirname(fileURLToPath(import.meta.url))`, matching the `load-env.ts` fix.
- **Decision**: FIXED — anchored with an explanatory comment. Verified: the same
  subdirectory invocation that previously failed now passes 1/1 (cwd echoed as
  `/Users/…/yapca/src` to confirm the test was genuine), and the root-relative scripts stay
  green.

## Post-triage verification

All re-run after the fixes landed:

| Check | Result |
|---|---|
| `pnpm test` (unit) | PASS — 5 files / 73 tests |
| `pnpm lint` | PASS — "ESLint: No issues found" |
| `pnpm check` | PASS — 71 files, 0 errors, 0 warnings |
| `pnpm test:integration` | PASS — 1 file / 1 test |
| `pnpm test:mutants --mutate "src/lib/season.ts" --force` | PASS — exit 0, dry run succeeded (was a hard failure before F1) |
| `pnpm vitest related src/lib/date.ts --run --project unit` (lefthook) | PASS — 4 files / 59 tests |
| Integration suite with `.env` absent | Actionable message, no `ENOENT` |
| Integration suite from `src/` subdirectory | PASS (was "Cannot find package 'astro:actions'") |

### Revised verdicts

| Dimension | Before | After |
|-----------|--------|-------|
| Plan Adherence | WARNING | PASS |
| Scope Discipline | PASS | PASS |
| Safety & Quality | FAIL | PASS |
| Architecture | PASS | PASS |
| Pattern Consistency | WARNING | PASS |
| Success Criteria | FAIL | PASS |

**Revised overall: APPROVED.** F5 remains an accepted latent observation.

### Carried into Phase 2

- The psql fixture must read `SUPABASE_DB_URL` from `process.env` directly, not from the
  `astro:env/server` shim (F4).
- Phase 1 criterion 1.7 now guards multi-project config resolution; keep it green when
  `globalSetup` is added, since `globalSetup` also runs outside a `--project` filter.
