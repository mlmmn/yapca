# Test-runner bootstrap and calendar math — Implementation Plan

## Overview

Bootstrap this project's first test runner against the pure `src/lib/` calendar layer,
pin the behaviour that test-plan Risks #1 ("every surface agrees on today") and #6
("season boundaries select the documented interval") depend on, and repair a CI
workflow that has never executed a single job — so the gate the test plan claims
actually exists on disk.

This is test-plan §3 Phase 1. It reverses a standing decision recorded in four prior
slices ("No new Vitest, Playwright, pgTAP, or other test framework"), which is the
whole point of the change.

## Current State Analysis

**There is no test runner.** A repo-wide search for `*.test.*`, `*.spec.*`,
`__tests__`, `vitest.config.*`, and `jest.config.*` returns zero matches outside
`node_modules`, and `package.json` has no runner script. The named exception is
`supabase/tests/season-aware-intervals.sql`: a transaction-scoped SQL script invoked
by hand via `psql`; no package script or CI job runs it.

**The calendar arithmetic is already correct.** `src/lib/date.ts:7-11` does all date
math in UTC epoch days via `Date.UTC(...) / MS_PER_DAY`, never on local-time `Date`
objects, and `nextDue` (`src/lib/interval.ts:8`) is a single epoch-day addition. The
TypeScript season rule (`src/lib/season.ts:14-21`) and the SQL rule in `mark_watered`
(`supabase/migrations/20260724120000_add_season_aware_intervals.sql:57-65`) agree on
every boundary date including leap-year Feb 29. This phase *freezes* that agreement;
it does not fix it.

**Four of the five target modules are import-clean, and none reaches `astro:env`.**
`src/lib/supabase.ts:3` is the only file in `src/lib/` importing `astro:env/server`,
and nothing in `date.ts` / `season.ts` / `interval.ts` / `schedule.ts` / `timezone.ts`
reaches it. This is the single fact that makes `environment: "node"` sufficient and
rules out a workerd pool for this phase.

**One function is genuinely unguarded and non-trivial.**
`getMillisecondsUntilNextMidnight` (`src/lib/timezone.ts:67-93`) expands a 36-hour
window and then binary-searches it with 28 halvings, comparing `Intl.DateTimeFormat`
output at each step. It accepts an injectable `now`, so it is fully testable without
touching the clock. The archive already flagged it: "nothing guards
`src/lib/timezone.ts` against future regression… flagging it as the one place I'd
revisit."

**CI is broken three independent ways, and fault 1 masks the other two.**
`.github/workflows/ci.yml:5,7` triggers on `master` while the branch is `main`;
`ci.yml:17` sets `cache: npm` against a repo with only `pnpm-lock.yaml`; `ci.yml:18`
runs `npm ci` with no `package-lock.json`. `git log -- .github/workflows/ci.yml`
returns one commit (`5c8ed01 chore: bootstrap Astro`) — this is un-adapted starter
scaffold that has never been correct here. Fixing only the trigger converts a dormant
workflow into one that fails on every PR at `setup-node`.

**Lint applies to test files at full strength.** `eslint.config.js:16` extends
`strictTypeChecked` + `stylisticTypeChecked` with `projectService: true`, `pnpm lint`
runs `--max-warnings=0`, and lint-staged (`package.json:70-77`) sweeps
`*.{ts,tsx,astro}` on commit. There is no test carve-out today.

### Key Discoveries

- `getViteConfig(userViteConfig, inlineAstroConfig?)` is present in the installed
  Astro 6 package (`node_modules/astro/dist/config/index.d.ts:13`) — verified against
  the package, not only the docs.
- `vitest@4.1.10` declares `vite: ^6.0.0 || ^7.0.0 || ^8.0.0`, which covers this
  repo's `"overrides": { "vite": "^7.3.2" }`. No peer conflict.
- **`@typescript-eslint/triple-slash-reference` is `error`** under `strictTypeChecked`
  (verified in the installed plugin config) with the default `types: "prefer-import"`.
  The conventional `/// <reference types="vitest/config" />` header will fail lint.
- `tsconfig.json` already has `include: ["**/*"]` and `paths: { "@/*": ["./src/*"] }`,
  so test files need no tsconfig change.
- Both `SUPABASE_URL` and `SUPABASE_KEY` are declared `optional: true`
  (`astro.config.mjs:21-22`), so the CI `build` step will not fail on absent secrets.
  `gh secret list` is empty; the repair needs no repo-admin access.
- `getTodayInTimeZone(timeZone, now = new Date())` and
  `getMillisecondsUntilNextMidnight(timeZone, now = new Date())` both take an
  **injectable `now`**. Tests pass `now` explicitly; fake timers are the exception,
  not the pattern.
- `shadcnUiConfig` (`eslint.config.js:153-161`) is the in-repo precedent for a
  narrowly-scoped, commented rule carve-out. The test override follows its shape.

## Desired End State

`pnpm test` runs a green suite covering all five pure `src/lib/` modules and exits
non-zero when an assertion is broken. The same command runs in GitHub Actions on every
pull request to `main`, in a workflow that has been observed both passing and failing.
The season boundary dates live in one table that is authoritative for the TypeScript
season rule — the `SEASON_BOUNDARIES` constant in `src/lib/season.test.ts`. Test-plan
Phase 2 must reconcile `supabase/tests/season-aware-intervals.sql` against it — by
lifting the table into a TypeScript harness or deriving the SQL cases from it — rather
than adding a third copy. `context/foundation/test-plan.md` §6.1 tells the next contributor
how to add a unit test here, and the three plumbing defects research surfaced have
their own change folder rather than decaying inside an appendix.

## What We're NOT Doing

- **Not fixing D-1, D-2, or D-3.** All three are plumbing defects unprovable by a pure
  unit test. They are recorded and handed to a follow-up change (Phase 4).
- **Not testing any SQL.** The TS↔SQL parity assertion, `postpone = +2`, and the undo
  staleness guard all need the seeded-database harness that test-plan Phase 2 buys.
- **No integration, contract, browser, or e2e layer.** No Playwright, no pgTAP, no
  local Supabase stack in this change.
- **No `@cloudflare/vitest-pool-workers`.** These modules have no bindings, no I/O, and
  exercise no Cloudflare-specific semantics.
- **No Astro component rendering.** The Container API stays unused; test-plan §7
  excludes the UI layer while the design is unsettled.
- **No coverage thresholds or reporters.** A coverage gate on a suite this young would
  measure the suite, not the risk.
- **No migration-safety gating, branch protection, or required-checks configuration.**
  Those remain test-plan Phase 5's.
- **No change to the season rule, the epoch-day arithmetic, or the duplicated inline
  head script in `layout.astro`.** The duplication is a recorded, deliberate trade-off.
- **No ESLint relaxation beyond the three explicitly granted rules** (see Phase 1).

## Implementation Approach

Four phases, ordered so that each one's verification is meaningful when it runs.

The runner lands first with a single real test, because a runner that has never
executed proves nothing — the same failure mode as the CI workflow being repaired. The
full suite lands second. **CI is repaired third, not first**: repairing it before
`pnpm test` exists would wire up a step with nothing to run, and lint and build have
themselves never been exercised on this repository, so the first green run is genuinely
new information. Documentation and the defect hand-off land last, once there is
something true to document.

Two verification principles carry through, both drawn from
`context/foundation/lessons.md` ("Always verify command status codes"):

1. **Every gate must be observed failing, not only passing.** A pipeline that never
   executed a step is indistinguishable at a glance from a passing one. Phases 1 and 3
   each carry an explicit deliberate-break step.
2. **Tests assert contracts, not implementations.** Test-plan §2 names the
   tautology anti-pattern for Risk #2; it applies just as sharply to
   `getMillisecondsUntilNextMidnight`, whose 28-halving binary search must never appear
   in an assertion.

## Critical Implementation Details

**The triple-slash directive will fail lint; prefer a type-only import, with an
authorized suppression as the fallback.** Vitest's documented `vitest.config.ts` header
is `/// <reference types="vitest/config" />`, which
`@typescript-eslint/triple-slash-reference` rejects under `types: "prefer-import"`. The
type-only side-effect import below supplies the identical module augmentation — it is
what teaches Vite's `UserConfig` about the `test` key — and satisfies the rule without
suppressing anything:

```ts
import type {} from "vitest/config";
import { getViteConfig } from "astro/config";
```

If that does not resolve the `test` key (some type-augmentation setups only apply
through the reference directive), **an eslint-disable comment on this specific line is
pre-authorized** — this is the explicit permission AGENTS.md's "Ask for permission
before adding eslint ignore comment" rule requires. Keep it scoped to the one line and
one rule, and carry a Why-comment, matching the in-repo style at `eslint.config.js:1`:

```ts
// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- vitest's `test` key augmentation only applies via the reference directive
/// <reference types="vitest/config" />
```

Do not reach for the suppression first: prefer the import, fall back only if the `test`
key fails to typecheck.

**ESLint flat-config blocks are order-sensitive; later wins.** The test-file override
must be listed in the final `tseslint.config(...)` call *after* both `reactConfig` and
`shadcnUiConfig` (`eslint.config.js:189-195`), or `react/no-multi-comp` will still
apply. Note that `reactConfig` matches `**/*.{js,jsx,ts,tsx}` (`eslint.config.js:118`),
so plain `.ts` test files are already inside React's rule scope even with no JSX.

**In CI, `pnpm/action-setup` must precede `actions/setup-node`**, or `cache: pnpm`
cannot resolve the pnpm store path. Do **not** pin a pnpm version in the workflow:
`pnpm/action-setup@v4` reads `packageManager: "pnpm@11.13.1"` from `package.json`, and
two sources of truth drift.

**RESOLVED (Phase 1, confirmed by impl-review): `getViteConfig()` does not work here;
`defineConfig` + `vite-tsconfig-paths` is the shipped path.** `getViteConfig()` resolves
the real `astro.config.mjs`, which loads the Cloudflare adapter and forces a workers
runner. The suite then dies at startup with `ReferenceError: exports is not defined`
(`workers/runner-worker/index.js:107:3`) before any test file loads — reproduced
directly, not inferred. **Do not "restore" `getViteConfig()` in a later phase** — this
question is settled.

`vitest.config.ts` therefore uses `defineConfig` from `vitest/config` with the
`vite-tsconfig-paths` plugin, which **derives** the `@/*` alias from `tsconfig.json`'s
`compilerOptions.paths` at resolve time. This keeps `tsconfig.json` the single source of
truth and recovers the "no duplicated alias config" property that was the original reason
to prefer `getViteConfig()` — a hand-written `resolve.alias` would have been a second
place to edit and could drift silently. The plugin's `enforce: "pre"` ordering means it
resolves before other plugins; no `resolve.alias` block is needed or wanted.

Note the package is **`vite-tsconfig-paths`** (actively maintained, 6.1.1), not
`vitest-tsconfig-paths` — the latter is a fork last published in 2022 and must not be
used. Verified end-to-end in both directions: an `@/lib/...` import resolves with the
plugin, and fails with `Cannot find package '@/lib/interval'` when the plugin is removed.

## Phase 1: Runner bootstrap and test-file lint contract

### Overview

Add Vitest, its config, the npm scripts, and the test-file ESLint override. Prove the
wiring end-to-end with one real test that is observed both passing and failing.

### Changes Required

#### 1. Runner dependency and scripts

**File**: `package.json`

**Intent**: Add the runner and the two commands that will be used locally and in CI.

**Contract**: `vitest@^4.1.10` and `vite-tsconfig-paths@^6.1.1` as **devDependencies**.
Scripts `"test": "vitest run"` and `"test:watch": "vitest"`. No change to `lint-staged` —
it already sweeps `*.ts`, which is the intended behaviour for test files.

#### 2. Vitest configuration

**File**: `vitest.config.ts` (new, repo root)

**Intent**: Resolve the Astro-aware Vite config so the `@/*` alias works without
duplication, restrict discovery to `src/**/*.test.ts`, run on Node, and default `TZ` to
UTC as a safety net while honoring an explicit shell override.

**Contract** *(revised in Phase 1 — see the RESOLVED note in Critical Implementation
Details)*: default-exports `defineConfig({ plugins: [tsconfigPaths()], test: { include:
["src/**/*.test.ts"], environment: "node", env: { TZ: process.env.TZ ?? "UTC" } } })`,
importing `defineConfig` from `vitest/config` and `tsconfigPaths` from
`vite-tsconfig-paths`. The plugin derives `@/*` from `tsconfig.json`, so there is **no**
`resolve.alias` block. `getViteConfig()` was tried first and fails; no triple-slash
directive and no eslint-disable turned out to be necessary. No `globals: true`: tests
import `describe` / `test` / `expect` explicitly,
which avoids both an ESLint globals entry and a tsconfig `types` array (adding `types`
to a tsconfig that lacks one suppresses automatic `@types` inclusion and would risk
Astro's ambient types).

#### 3. Test-file ESLint override

**File**: `eslint.config.js`

**Intent**: Carve out the three rules explicitly authorized for test files, so ordinary
test idioms do not fight `--max-warnings=0`. Note these three are unlikely to fire in
this phase's pure-function tests — the value is forward-looking for test-plan Phase 2's
database harness — but establishing the contract once beats amending lint config
mid-rollout.

**Contract**: a new `tseslint.config({ files: ["**/*.test.ts", "**/*.test.tsx"], rules:
{ … } })` block disabling **exactly** `@typescript-eslint/no-non-null-assertion`,
`@typescript-eslint/unbound-method`, and `react/no-multi-comp`. Nothing else. Placed in
the final `tseslint.config(...)` call after `shadcnUiConfig`. Carries a comment
explaining the rationale, following the `shadcnUiConfig` precedent at
`eslint.config.js:153-161`.

**EXTENDED (Phase 2, at the maintainer's explicit request during impl-review triage):
the block also *enables* one rule.** `@vitest/eslint-plugin` was added as a devDependency
and registered on this block alone, carrying
`"vitest/consistent-test-it": ["error", { fn: "test", withinDescribe: "test" }]` — the
maintainer prefers `test` over `it`. This goes beyond the "three explicitly granted
rules" boundary in What We're NOT Doing, which forbade *relaxations*; this is an added
restriction, requested directly on 2026-07-26. **This note is the record of that
authorization** — AGENTS.md forbids unilateral ESLint config changes, and the maintainer
chose to keep the justification here rather than as a comment in `eslint.config.js`.

`withinDescribe` is **not** optional here. It defaults to `"it"`, and every test in this
repo lives inside a `describe`, so setting only `fn` would have enforced the opposite of
the intent. Verified in both directions: reintroducing `it` in `interval.test.ts` fails
`pnpm lint` at exit **1**, and the revert returns it to exit 0.

#### 4. Smoke test

**File**: `src/lib/interval.test.ts` (new)

**Intent**: Prove the wiring with a genuinely useful assertion rather than a throwaway
— `nextDue` across a month end. Phase 2 expands this file rather than replacing it.

**Contract**: explicit `import { describe, test, expect } from "vitest"`; imports
`nextDue` from `./interval`. Co-located flat beside the module it tests — the AGENTS.md
"one folder per component" rule governs components, not `src/lib/` helpers, which are
already flat siblings. Kebab-case is satisfied.

### Success Criteria

#### Automated Verification

- `pnpm install` completes and resolves `vitest` with no peer-dependency warning
- `pnpm test` exits 0 and reports at least one passing test
- `pnpm lint` passes with zero warnings, including `vitest.config.ts` and the new test file
- `pnpm build` still succeeds — the test config must not perturb the Astro build

#### Manual Verification

- Deliberately invert the smoke assertion, confirm `pnpm test` exits **non-zero**, revert
- `pnpm test:watch` starts and re-runs on file save

**Implementation Note**: After completing this phase and all automated verification
passes, pause here for manual confirmation before proceeding.

---

## Phase 2: Calendar, season, and timezone unit tests

### Overview

The full Phase 1 assertion surface across all five pure modules, plus the authoritative
TypeScript season-boundary fixture that test-plan Phase 2 must reconcile with the
existing SQL boundary cases.

### Changes Required

#### 1. Shared season boundary fixture

**File**: `src/lib/season.test.ts` — a module-level constant, not a separate file
*(see the INLINED note at the end of this item)*

**Intent**: Make the fixture the authoritative table for the TypeScript season rule.
Test-plan Phase 2 must reconcile `supabase/tests/season-aware-intervals.sql` against it
— either by importing it into a TypeScript harness or deriving the SQL cases from it —
rather than adding a third copy. This is the change's durable contribution to Risk #6;
the existing hand-run SQL script already checks database boundaries, but nothing keeps
its inline cases aligned with TypeScript.

**Contract**: exports a readonly array of `{ date, season, note }`.

**Years are chosen to match `supabase/tests/season-aware-intervals.sql`, not freely.**
Both rules are year-agnostic — TS reads only the month (`season.ts:17-18`), SQL rebuilds
the range per year (`make_date(extract(year from p_acted_on)::int, 3, 1)`) — so the year
carries no semantics but does decide whether criterion 2.6 can pass. Every date the SQL
script already asserts (`season-aware-intervals.sql:40-47`) must appear verbatim:

- `2024-02-29` (leap day), `2024-03-01`, `2024-10-31`, `2024-11-01`, `2024-12-15`,
  `2025-02-28`, `2025-03-01` — the seven SQL rows.
- Plus the TS-only edges that round out the boundary: `2024-02-27`, `2024-02-28`,
  `2024-10-30`, `2024-12-31`, `2025-01-01`.

Do **not** substitute a different leap year (an earlier draft said 2028); that would
guarantee criterion 2.6 reports a mismatch on the very row the fixture exists to pin.

**Be honest in the fixture's header comment about what the extra rows buy.** The TS rule
is month-granular, so `2024-02-27` / `2024-02-28` / `2024-02-29` are indistinguishable
inputs to `getSeason`, and `2024-12-31` / `2025-01-01` both sit mid-dormancy away from any
edge. The rule's only real decision edges are Feb→Mar and Oct→Nov. Keep the rows — they
mirror the SQL cases and would catch a future day-level boundary — but say in the comment
that they guard a *possible* day-granular rule rather than exercising distinct branches
today, so a later reader does not mistake row count for branch coverage.

Names follow the AGENTS.md rule that non-function names never start with a verb.

**INLINED (Phase 2, by impl-review triage): the table is a module-level constant in
`src/lib/season.test.ts`, not a file of its own.** Two earlier drafts placed it in a
separate module — first flat as `src/lib/season-boundaries.fixture.ts`, then in a
`src/lib/fixtures/` directory. Both were rejected: the table has exactly one consumer and
no expectation of a second, and `tsconfig.json`'s `include: ["**/*"]` typechecks any such
file as ordinary app code, so a standalone module carried a shipping risk that a
test-local constant does not have. Living inside a `*.test.ts` file also puts it under the
test-file ESLint override rather than the strict config, which is the correct scope for
test data.

Two consequences to carry forward:

- **Criterion 2.8 needs a different anchor.** The fixture's `@/`-aliased import was the
  suite's only exercise of the `vite-tsconfig-paths` wiring. `season.test.ts` therefore
  imports the module under test as `@/lib/season` rather than `./season`, with a comment
  saying why, so dropping the plugin still fails the suite loudly.
- **Test-plan Phase 2 must lift the table out when it needs it.** The reconciliation
  obligation is unchanged — that phase reconciles `season-aware-intervals.sql` against
  this table by moving it into a shared harness or deriving the SQL cases from it, never
  by adding a third copy. A comment above the constant records this.

#### 2. Date primitives and formatting

**File**: `src/lib/date.test.ts` (new)

**Intent**: Pin the epoch-day core and every exported formatter/classifier, including
the two `RangeError` paths that no caller currently exercises.

**Contract**: covers `toEpochDay` / `fromEpochDay` round-trips (leap day, year
boundary, epoch zero); `isValidDateString` accepting `2028-02-29` and rejecting
`2026-02-30`, `2026-13-01`, and malformed input; `formatShortDate` / `formatDueLabel`
(the `today === null` branch and the `dateString === today` branch);
`formatIntervalLabel` singular vs plural at 1 and 2; `compareDueRecords` ordering by
date then by name; and `classifyDueStatus` returning `due-today` at 0, `overdue` at 1
and 2, `overdue-strong` at exactly 3 and at 30, plus `RangeError` on a future due date
and on invalid input.

Also assert `parseLocalDateString` directly: it is the one function in this module that
constructs an ambient-local `Date` (`date.ts:34`), so it is the only place a
`formatShortDate` round-trip can drift by a day under a non-UTC zone. Assert that
`SHORT_DATE_FORMATTER`'s output for a given date string names that same calendar day —
including a date that sits on a DST transition in the CI leg's zone. This assertion is
inert under `TZ=UTC` by construction; it earns its keep in the `TZ=America/New_York` leg
Phase 3 adds.

#### 3. Interval arithmetic

**File**: `src/lib/interval.test.ts` (extends the Phase 1 smoke test)

**Intent**: Assert that epoch-day addition is immune to the cases that break
local-time arithmetic.

**Contract**: `nextDue` across a month end, across leap-day Feb 29, across a year wrap,
at interval 1 and 365, and across a DST **fall-back** date — the last being the
property `interval.ts:3-6` claims in its doc comment and nothing currently proves.

**The DST case only has teeth in a DST-having zone, and only on fall-back.** `nextDue` is
a single epoch-day addition (`interval.ts:8`), so the assertion passes unconditionally
today; the regression it guards against is someone rewriting it onto local-time `Date`
objects, and that rewrite would still pass under `TZ=UTC`. Phase 3's
`TZ=America/New_York` leg is what makes this case real.

**CORRECTED (Phase 2, confirmed by impl-review): the date must be a fall-back date, not
spring-forward.** An earlier draft said `2026-03-08` (spring-forward). Reproduced directly
against the naive local-time rewrite under `TZ=America/New_York`: `2026-03-08 +1` yields
`2026-03-09` and **passes**, because a 23-hour day makes millisecond addition overshoot
past the next local midnight onto the correct date. Only a 25-hour fall-back day pulls the
result back into the same calendar day: `2026-11-01 +1` yields `2026-11-01` and **fails**,
detecting the bug. Use `2026-11-01`; note in a comment that the case is a regression guard
whose failure mode requires both the non-UTC leg and a fall-back date.

#### 4. Season selection

**File**: `src/lib/season.test.ts` (new)

**Intent**: Drive the boundary fixture through the season rule table-style, and cover
the label helpers and the validation path.

**Import the module under test through the `@/` alias, not a relative path** —
`import { … } from "@/lib/season"`. Alias resolution under Vitest depends on the
`vite-tsconfig-paths` plugin (see Critical Implementation Details), and nothing else in
the suite exercises it. One aliased import keeps that wiring covered, so if the plugin is
ever dropped from `vitest.config.ts` the suite fails loudly with
`Cannot find package '@/lib/...'` rather than silently losing a capability. The remaining
test files may keep relative imports. *(An earlier draft anchored this on the fixture's
import; the fixture is now inline — see the INLINED note in item 1 — so the anchor moved
to the module import.)*

**Contract**: table-driven over the inline `SEASON_BOUNDARIES` constant, asserting `getSeason`;
`selectSeasonInterval` returning the growing interval inside Mar 1–Oct 31 and the
dormancy interval outside it, with **distinguishable** interval values so a swapped
return cannot pass; `getSeasonLabel` / `getShortSeasonLabel`; and `RangeError` on an
invalid date string.

#### 5. Schedule recalculation

**File**: `src/lib/schedule.test.ts` (new)

**Intent**: Pin the two settled decisions in `resolveScheduleChange` that are easy to
"fix" into a regression.

**Contract**: covers the delta shift `oldNextDue + (newActiveInterval −
oldActiveInterval)` with positive, negative, and zero deltas; that a recalculated date
landing **in the past is not clamped** (clamping would make the rule non-invertible —
a rejected option, `context/archive/2026-07-25-edit-plant-and-recalc/plan.md:125-126`);
that the returned `season` matches `activeDay`; and that the active season selects
which interval pair participates — an edit on a growing day must ignore the dormancy
values entirely.

#### 6. Timezone resolution

**File**: `src/lib/timezone.test.ts` (new)

**Intent**: Cover the module the archive named as the one place to revisit, driving
everything through the injectable `now` so no assertion depends on ambient state.

**Contract**: `isSupportedTimeZone` accepting a real zone and **returning `false`
rather than throwing** for the forged `Not/AZone`, the empty string, an over-100-char
value, and a regex-invalid value; `getTodayInTimeZone` with an explicit `now` at
`Pacific/Kiritimati` (UTC+14) and `Pacific/Midway` (UTC-11) on either side of local
midnight, including the Feb 28 → Mar 1 case where the two zones disagree about the
season; and `RangeError` on an unsupported zone.

For `getMillisecondsUntilNextMidnight`, assert the **contract, not the search**. At a
normal day, across a `Europe/Warsaw` spring-forward (a 23-hour day), and across a
fall-back (a 25-hour day), with `now` more than one second before midnight, assert that
`now + result` falls on the next zone-local day and `now + result - 1ms` still falls on
the current one. Separately, immediately before midnight, assert that the 1000 ms floor
is returned and the scheduled time falls on the next zone-local day. No assertion may
reference the 36-hour window or the 28 halvings.

### Success Criteria

#### Automated Verification

- `pnpm test` exits 0 with all five `src/lib/` modules covered
- `TZ=America/New_York pnpm test` also exits 0 — proves the suite is timezone-independent, not merely passing in the author's zone
- `pnpm lint` passes with zero warnings across all new files
- `pnpm build` still succeeds

#### Manual Verification

- Read `timezone.test.ts` and confirm no assertion encodes the binary-search internals
- Confirm every boundary date asserted by `season-aware-intervals.sql` has a corresponding fixture row, and note any date present in only one artifact
- Break one season boundary case in the fixture, confirm the suite goes red, revert

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 3: CI repair

### Overview

Repair all three faults in the workflow and add `pnpm test`. Verify both that it fires
and that it can go red — the failure being repaired *is* "a gate that looks fine and
never ran."

**Prerequisite — branch authorization.** Verification here needs the workflow observed
both green and red on GitHub, which means pushing to the remote. Two paths, and the
implementer must confirm which one before starting:

- **Pull request** (preferred): requires the user to **explicitly authorize creating a
  branch**. AGENTS.md's "Never create a git branch unless explicitly asked to" forbids it
  otherwise, and this plan is not that authorization.
- **Direct push to `main`** (fallback, no branch needed): the repaired workflow triggers
  on `push` to `main`, so direct pushes are checked too. The cost is that step 3.5's
  deliberate break lands a knowingly-red commit on `main` followed by a revert — two
  extra commits and a red run in `main`'s history. That is an acceptable price only if
  the user accepts it up front.

**What this phase does not buy: deployment gating.** There is no deploy job in
`.github/workflows/` — deployment is driven outside GitHub Actions, so a red CI run does
not block it. Making a failing check actually prevent a deploy needs branch protection /
required checks, which "What We're NOT Doing" assigns to test-plan Phase 5. This phase
delivers *detection* on both PRs and direct pushes to `main`; *prevention* is Phase 5's.

### Changes Required

#### 1. Workflow rewrite

**File**: `.github/workflows/ci.yml`

**Intent**: Fix the branch trigger, the package-manager cache, and the install/run
commands together — fixing only the trigger turns a dormant workflow into a red one —
and wire in the new test step.

**Contract**: triggers on `push` and `pull_request` to `main`. Job steps in order:
`actions/checkout@v4`; `pnpm/action-setup@v4`; `actions/setup-node@v4` with
`node-version: 22` and `cache: pnpm`; `pnpm install --frozen-lockfile`;
`pnpm exec astro sync`; `pnpm lint`; `pnpm test`; `TZ=America/New_York pnpm test`;
`pnpm build`.

**Both test legs are required, and the second is the load-bearing one.** The UTC leg
proves the suite is deterministic; the `America/New_York` leg is the only one that can
fail if `nextDue` is ever rewritten onto local-time `Date` objects, or if
`parseLocalDateString` / `formatShortDate` start disagreeing about the ambient day. Under
`TZ=UTC` alone those regressions pass silently, because UTC has no DST — running only the
UTC leg would make Phase 2's DST cases decorative. Set `TZ` as a shell prefix on the
step, not through Vitest's `env` option, so it is in place before the worker initializes
its default zone.

The ordering constraint
and the pnpm-version-pinning hazard are in Critical Implementation Details. Retain the
`SUPABASE_URL` / `SUPABASE_KEY` env block on the build step — both are `optional: true`
so absent secrets are harmless, and keeping it avoids a second change when they are set.

### Success Criteria

#### Automated Verification

- Locally, in CI's own order: `pnpm install --frozen-lockfile`, `pnpm exec astro sync`, `pnpm lint`, `pnpm test`, `TZ=America/New_York pnpm test`, `pnpm build` each exit 0
- `gh run list --workflow=ci.yml` reports **at least one run**, and `gh workflow view ci.yml --yaml` contains no occurrence of `master`. (Do **not** use `gh workflow list` — it already reports CI as `active` today, dormant `master` trigger and all, so that check passes before and after the repair and proves nothing.)

#### Manual Verification

- The first push (PR or direct to `main`, per the Prerequisite) **shows CI checks running** — zero checks is the same silent state as today
- The `setup-node` step resolves the pnpm cache without "Dependencies lock file is not found"
- Deliberately break one assertion, push, confirm the job goes **red at the `pnpm test` step**, revert, confirm green
- Confirm `lint` and `build` pass in CI — neither has ever run on this repository

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 4: Documentation and defect hand-off

### Overview

Make the test plan true on disk, and give the three recorded defects a home they can be
planned from.

### Changes Required

#### 1. Test plan updates

**File**: `context/foundation/test-plan.md`

**Intent**: Replace the §6.1 placeholder with a real cookbook entry, and correct the
three places the plan describes Phase 1 as unfinished.

**Contract**: §6.1 replaces "TBD — see §3 Phase 1" with the concrete pattern — file
placement and naming, explicit `vitest` imports over globals, passing `now`/date strings
explicitly rather than relying on ambient `TZ`, the table-driven boundary form, and a
pointer to the `SEASON_BOUNDARIES` table in `src/lib/season.test.ts`. §3 Phase 1 Status moves to its completed
value. §4's unit+integration row names `vitest 4.1.10` with a `checked:` date. §5's
`unit` gate row reflects that it is now genuinely enforced.

#### 2. Change identity

**File**: `context/changes/testing-runner-and-calendar-math/change.md`

**Intent**: Reflect completion and carry the defect summary forward.

**Contract**: `status` and `updated` refreshed; Notes section summarizes D-1, D-2, D-3
in one line each with their `research.md` references and a pointer to the follow-up
change folder.

#### 3. Defect follow-up change

**File**: `context/changes/today-acquisition-defects/change.md` (new folder)

**Intent**: Give D-1–D-3 a change-id so they enter the normal planning flow instead of
decaying inside a research appendix. All three are the same class — "which date
arrived, and when" — which is why they share one folder.

**Contract**: `change.md` mirroring `/10x-new` semantics (frontmatter with `change_id`,
`title`, `status: preparing`, `created`, `updated`, `archived_at: null`). Notes capture
each defect with its file references: **D-1** `AddPlantForm` / `EditPlantForm` capture
`today` at SSR and never refresh, unlike `TodayList`'s rollover effect
(`add-plant-form.tsx:31`, `edit-plant-form.tsx:37`, `today-list.tsx:225-266`);
**D-2** `getActionDate`'s UTC fallback can select the wrong season for users behind UTC
(`src/actions/index.ts:25`); **D-3** `today === null` widens the Today list to every
plant and one `sessionStorage`-blocked browser configuration never recovers
(`today-list.tsx:221`, `layout.astro:48-50`).

**Record explicitly that D-3's intended behaviour is unsettled** — research flags that
asserting current behaviour here would be exactly the tautology test-plan §2 warns
against, so intent must be decided before it is planned.

### Success Criteria

#### Automated Verification

- `grep -n "TBD — see §3 Phase 1" context/foundation/test-plan.md` returns nothing
- `context/changes/today-acquisition-defects/change.md` exists with valid frontmatter
- `pnpm lint` and `pnpm test` still pass; CI green on the final push

#### Manual Verification

- Read §6.1 as someone who was not part of this change and confirm it is sufficient to write a new unit test
- Confirm D-1–D-3 carry enough detail to plan from without re-reading `research.md`

---

## Testing Strategy

### Unit Tests

- All five pure `src/lib/` modules; see Phase 2 for the per-module contract
- Every case passes dates and `now` **explicitly**; the config defaults `TZ` to UTC
  while honoring an explicit shell override. This is a safety net for
  `parseLocalDateString` / `formatShortDate` / `formatDueLabel`, not the mechanism the
  tests rely on
- **The suite runs twice, and UTC is the weaker leg.** A UTC-only run cannot fail on the
  DST and ambient-local cases at all (UTC has no DST, and `parseLocalDateString` is
  UTC-identical there). Phase 3 therefore wires `TZ=America/New_York pnpm test` as a
  second CI step; treat that leg, not the UTC one, as the guard against local-time
  arithmetic creeping back into `src/lib/`
- `vi.useFakeTimers()` / `vi.setSystemTime()` are available but deliberately unused —
  every function under test accepts its time input as an argument

### Integration Tests

None in this change. The TS↔SQL parity assertion, `postpone = +2`, and the undo
staleness guard are handed to test-plan Phase 2. That phase must reconcile
`season-aware-intervals.sql` with the `SEASON_BOUNDARIES` table in `src/lib/season.test.ts` — either by importing
the fixture into a TypeScript harness or deriving the SQL cases from it — rather than
adding a third boundary table.

### Manual Testing Steps

1. Run `pnpm test` — expect green across all five modules
2. Invert one assertion; confirm a **non-zero exit code**, not just red output
3. Run `TZ=Pacific/Kiritimati pnpm test`; confirm still green
4. Open the pull request; confirm CI checks appear and pass
5. Push a deliberate break; confirm CI goes red at `pnpm test`; revert; confirm green

## Performance Considerations

None meaningful. The suite is pure functions with no I/O.
`getMillisecondsUntilNextMidnight` performs ~30 `Intl.DateTimeFormat` calls per
invocation against a cached formatter, so even a few dozen cases stay well inside a
normal test run. CI adds roughly one step's duration to a job that has never run at all.

## Migration Notes

Not applicable — no schema or data changes. The only migration-shaped concern is that
`pnpm install` will update `pnpm-lock.yaml`, which must be committed for
`--frozen-lockfile` to succeed in CI.

## References

- Parent artifact: `context/foundation/test-plan.md` §2 Risks #1 and #6, §3 Phase 1, §4, §5, §6.1
- Research: `context/changes/testing-runner-and-calendar-math/research.md`
- Lessons: `context/foundation/lessons.md` — "Always verify command status codes"
- Timezone architecture: `context/archive/2026-07-24-user-timezone-dates/plan.md`
- Season architecture: `context/archive/2026-07-23-season-aware-intervals/plan.md`
- Recalculation rule and the no-clamping decision: `context/archive/2026-07-25-edit-plant-and-recalc/plan.md:125-126,257-259`
- In-repo lint carve-out precedent: `eslint.config.js:153-161`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Runner bootstrap and test-file lint contract

#### Automated

- [x] 1.1 `pnpm install` resolves vitest with no peer warning — 31cde19
- [x] 1.2 `pnpm test` exits 0 with at least one passing test — 31cde19
- [x] 1.3 `pnpm lint` passes at zero warnings including vitest.config.ts — 31cde19
- [x] 1.4 `pnpm build` still succeeds — 31cde19

#### Manual

- [x] 1.5 Deliberate break makes `pnpm test` exit non-zero; revert — 31cde19
- [x] 1.6 `pnpm test:watch` starts and re-runs on save — 31cde19

### Phase 2: Calendar, season, and timezone unit tests

#### Automated

- [x] 2.1 `pnpm test` exits 0 across all five `src/lib/` modules — a6233c2
- [x] 2.2 `TZ=America/New_York pnpm test` exits 0 — a6233c2
- [x] 2.3 `pnpm lint` passes at zero warnings across all new files — a6233c2
- [x] 2.4 `pnpm build` still succeeds — a6233c2

#### Manual

- [x] 2.5 No assertion in `timezone.test.ts` encodes the binary-search internals — a6233c2
- [x] 2.6 Every SQL boundary date has a corresponding fixture row; differences are noted — a6233c2
- [x] 2.7 Breaking one fixture boundary case turns the suite red; revert — a6233c2
- [x] 2.8 At least one test imports through the `@/` alias, keeping the `vite-tsconfig-paths` wiring covered — a6233c2

### Phase 3: CI repair

#### Automated

- [x] 3.1 CI's command sequence, including both test legs, each exits 0 locally
- [x] 3.2 `gh run list --workflow=ci.yml` reports at least one run and no `master` trigger remains

#### Manual

- [x] 3.3 The first push (PR or direct to `main`) shows CI checks running
- [x] 3.4 `setup-node` resolves the pnpm cache without a lockfile error
- [x] 3.5 Deliberate break turns the job red at `pnpm test`; revert to green
- [x] 3.6 `lint` and `build` pass in CI for the first time

### Phase 4: Documentation and defect hand-off

#### Automated

- [ ] 4.1 No "TBD — see §3 Phase 1" remains in test-plan.md
- [ ] 4.2 `today-acquisition-defects/change.md` exists with valid frontmatter
- [ ] 4.3 `pnpm lint` and `pnpm test` pass; CI green on the final push

#### Manual

- [ ] 4.4 §6.1 is sufficient for a newcomer to write a unit test
- [ ] 4.5 D-1–D-3 carry enough detail to plan from without re-reading research.md
