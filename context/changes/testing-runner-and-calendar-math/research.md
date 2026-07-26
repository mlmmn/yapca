---
date: 2026-07-26T11:17:44+02:00
researcher: mlmmn
git_commit: eb1d28df1aeb6c58a48c5adb1194396d73fab58a
branch: main
repository: yapca
topic: "Test-runner bootstrap and calendar math (test-plan Phase 1 — Risks #1, #6)"
tags: [research, codebase, testing, vitest, timezone, season, calendar-math, cloudflare-workers, ci]
status: complete
last_updated: 2026-07-26
last_updated_by: mlmmn
last_updated_note: "Added §7 — CI repair as a Phase 1 precondition, with verified fault analysis and a proposed workflow"
---

# Research: Test-runner bootstrap and calendar math

**Date**: 2026-07-26T11:17:44+02:00
**Researcher**: mlmmn
**Git Commit**: `eb1d28df1aeb6c58a48c5adb1194396d73fab58a`
**Branch**: `main`
**Repository**: yapca

> References are local `file:line`, not GitHub permalinks: `git branch -r --contains HEAD`
> returns empty, so commit `eb1d28d` is not on any remote branch and permalinks would 404.

## Research Question

Ground Phase 1 of `context/foundation/test-plan.md` — "Runner bootstrap + calendar
math" — covering Risk #1 (every surface must agree on "today") and Risk #6 (season
boundaries must select the documented interval). Per §1 principle #3 of the test
plan, the risk map names *scenarios*; this document is the ground truth for *where
the failures actually live*.

Scope decided with the user before research:

- **SQL-side math**: map it precisely, but hand testing of it to Phase 2. Phase 1
  stays pure-unit.
- **Runner**: verify concretely against installed packages and current docs.
- **Defects**: flag real correctness problems found along the way as open items.

## Summary

**The calendar arithmetic is not where the risk lives.** `src/lib/date.ts`,
`interval.ts`, `season.ts`, and `schedule.ts` are pure, dependency-free, and do all
date math in **UTC epoch days** (`Date.UTC(...) / MS_PER_DAY`), never on local-time
`Date` objects. A full boundary matrix — Feb 27/28/29, Mar 1, Oct 30/31, Nov 1, Dec
31, Jan 1 — shows the TypeScript rule and the SQL rule **agree on every date,
including leap-year Feb 29**. The season rule is duplicated on purpose across TS and
SQL, but it is duplicated *correctly* today.

**The risk lives in the acquisition of "today", not in what is done with it.**
Every consumer receives a `today` string; the failure modes are all about which
string arrives, and when. Three genuine defects were found (§Open Questions, D-1 to
D-3), the sharpest being that **`AddPlantForm` and `EditPlantForm` capture `today`
once at SSR and never refresh it**, while the server action recomputes it at submit
time — so a form left open across local midnight previews one season and saves
another. `TodayList` alone has the midnight-rollover machinery.

**A separate, verified, unrelated finding: CI has never run on this repository.**
`.github/workflows/ci.yml:4-7` triggers on `master`; the branch is `main`. Whatever
Phase 1 adds to CI will not execute until that is fixed.

**The runner answer is small and boring, which is the right shape for Phase 1.**
`vitest@^4.1.10` alone, `getViteConfig()` from `astro/config` (verified present in
the installed Astro 6 package), `environment: "node"`, `test.env.TZ = "UTC"`. All
four target modules were traced and **none reaches `astro:env`** — no Astro runtime
bootstrap, no workerd pool, no mocking is required.

## Detailed Findings

### 1. The pure calendar layer (`src/lib/`)

Five modules, all import-clean, together forming the entire Phase 1 surface:

| Module | Exports | Imports | `astro:env`? |
| --- | --- | --- | --- |
| `src/lib/date.ts` | `toEpochDay`, `fromEpochDay`, `isValidDateString`, `parseLocalDateString`, `formatShortDate`, `formatDueLabel`, `formatIntervalLabel`, `compareDueRecords`, `classifyDueStatus` | none | No |
| `src/lib/season.ts` | `getSeason`, `selectSeasonInterval`, `getSeasonLabel`, `getShortSeasonLabel` | `./date` | No |
| `src/lib/interval.ts` | `nextDue` | `./date` | No |
| `src/lib/schedule.ts` | `resolveScheduleChange` | `./date`, `./season` | No |
| `src/lib/timezone.ts` | `TIME_ZONE_COOKIE`, `isSupportedTimeZone`, `getTodayInTimeZone`, `getMillisecondsUntilNextMidnight` | none | No |

`src/lib/supabase.ts:3` is the only file in `src/lib/` importing `astro:env/server`,
and nothing above reaches it. This is the single most important fact for the runner
decision — it means these tests need no Astro runtime at all.

**Why the arithmetic is structurally safe.** `toEpochDay` (`src/lib/date.ts:7-11`)
splits the `YYYY-MM-DD` string and goes through `Date.UTC`, so no local offset ever
enters; `nextDue` (`src/lib/interval.ts:8`) is `fromEpochDay(toEpochDay(from) + n)`.
The doc comment at `interval.ts:3-6` states the intent explicitly. A DST transition
cannot shift a result that never carried hours.

**The one local-time exception.** `parseLocalDateString`
(`src/lib/date.ts:34-38`) builds `new Date(year, month - 1, day)` — the *local*
constructor. It exists only to feed `SHORT_DATE_FORMATTER`
(`src/lib/date.ts:5,40-42`), so `formatShortDate` and `formatDueLabel` inherit a
dependency on the host process offset. For a date-only string this is currently
date-stable, but it is the one function in the module whose output depends on ambient
`TZ` — which is precisely why the runner recommendation pins `TZ=UTC`.

**Untested and non-trivial**: `getMillisecondsUntilNextMidnight`
(`src/lib/timezone.ts:67-93`) finds the next zone-local midnight by expanding a 36 h
window and then binary-searching it with 28 halvings, comparing
`Intl.DateTimeFormat` output at each step. It takes an injectable `now`, so it is
fully testable without touching the clock, and it has zero regression protection
today.

### 2. Where "today" comes from — the Risk #1 map

| Surface | Runtime | How "today" is obtained | Reference |
| --- | --- | --- | --- |
| Middleware (authority) | Worker | `tz` cookie → `request.cf.timezone` → `null`; then `getTodayInTimeZone(timeZone)` | `src/middleware.ts:12-19` |
| `<html data-today>` | Worker (SSR) | `Astro.locals.today ?? ""` | `src/layouts/layout.astro:13` |
| Inline head script | Browser | Computes `browserToday` independently, writes `tz` cookie, reloads once on mismatch | `src/layouts/layout.astro:19-51` |
| `getActionDate` (all mutations) | Worker | `context.locals.today ?? getTodayInTimeZone("UTC")` | `src/actions/index.ts:22-26` |
| `TodayList` | Worker → Browser, **with** rollover | prop from `locals.today`, then re-derived on timer / `pageshow` / `visibilitychange` | `today-list.tsx:225-266`; prop at `src/pages/plants/index.astro:64,66` |
| `AddPlantForm` | Worker → Browser, **no** rollover | prop only, captured at page render | `src/pages/plants/new.astro:17`; `add-plant-form.tsx:31` |
| `EditPlantForm` | Worker → Browser, **no** rollover | prop only, captured at page render | `src/pages/plants/[id]/edit.astro:87`; `edit-plant-form.tsx:37` |
| `season-interval-summary` | Worker | `activeDay` prop from `Astro.locals.today` | `season-interval-summary.astro:18,27,29` |
| `plants/[id].astro` (journal) | Worker | No `today` at all — formats stored `acted_on` only | `src/pages/plants/[id].astro:130-142` |
| SQL functions | Postgres | **`p_acted_on date` parameter, passed in from TS** — never `now()`/`CURRENT_DATE` | see §3 |

Two properties of this design are worth stating plainly, because they are load-bearing
and easy to break:

1. **There is exactly one server-side authority**, resolved once per request in
   middleware. `locals.timeZone` and `locals.today` are always `null` together
   (`src/middleware.ts:18-19` derives one from the other), so no code path can see a
   known zone with an unknown day or vice versa.
2. **Mutations never accept a client-supplied date.** `getActionDate` reads
   `locals.today`. The archive records this as a deliberate reversal: `clientDate`
   was removed from the action contract so "a client can't post a day that disagrees
   with what it was shown" (`context/archive/2026-07-24-user-timezone-dates/plan-brief.md:28`),
   with a grep gate `grep -r 'clientDate' src` returning nothing (`.../plan.md:49`).

The unknown-timezone path is not a rare branch: `cf` is `undefined` under
`astro dev`, so `today === null` is **the default local development experience on a
cold profile** (`context/archive/2026-07-24-user-timezone-dates/plan.md:31`).

### 3. Season and interval math — the Risk #6 map

The rule is: growing = Mar 1 – Oct 31 inclusive; dormancy = Nov 1 – end of Feb. It is
written twice, with paired "change both together" comments.

| Aspect | TypeScript (`src/lib/season.ts:14-21`) | SQL (`mark_watered`, `supabase/migrations/20260724120000_add_season_aware_intervals.sql:57-65`) |
| --- | --- | --- |
| Input | `dateString: string`, pre-validated by `isValidDateString` | `p_acted_on date` (typed, passed in by the caller) |
| Extraction | `Number(dateString.slice(5, 7))` — pure string slice | `extract(year from p_acted_on)` to build the bounds |
| Test | `month >= 3 && month <= 10` | `p_acted_on between make_date(y,3,1) and make_date(y,10,31)` (inclusive both ends) |
| Timezone exposure | None — never constructs a `Date` | None — `date` carries no time-of-day |
| Enforcement of parity | Comment only (`season.ts:11-13`) | Comment only (migration `:57-59`) |

**Boundary matrix — both implementations agree on every row:**

| Date | TS `getSeason` | SQL branch | Agree |
| --- | --- | --- | --- |
| Feb 27 | dormancy | dormancy | ✓ |
| Feb 28 | dormancy | dormancy | ✓ |
| Feb 29 (leap) | dormancy | dormancy | ✓ |
| Mar 1 | growing | growing | ✓ |
| Oct 30 | growing | growing | ✓ |
| Oct 31 | growing | growing | ✓ |
| Nov 1 | dormancy | dormancy | ✓ |
| Dec 31 | dormancy | dormancy | ✓ |
| Jan 1 | dormancy | dormancy | ✓ |

Because the season never straddles Dec 31 / Jan 1, deriving the bounds from the
date's own year introduces no wrap-around edge case. **There is no algorithmic
divergence between TS and SQL today** — the only class of Risk #6 failure available
is *input skew*: the two evaluations being handed different dates (see D-1, D-2).

**When season is evaluated.** At schedule-*creation*, never at read time for stored
dates. `context/archive/2026-07-23-season-aware-intervals/plan.md:62-63`: "Season
selection happens exactly when a due date is created… an already materialized
`next_due_on` remains unchanged until the next Watered action." Crossing a boundary
must never rewrite an existing due date (PRD Open Question 2 resolution,
`context/foundation/prd.md:164`; FR-015 at `prd.md:117`).

Callers, classified:

| Caller | Reference | Timing |
| --- | --- | --- |
| `addPlant` → `selectSeasonInterval` | `src/actions/index.ts:41-46` | creation |
| `updatePlant` → `resolveScheduleChange` | `src/actions/index.ts:121-128` | edit-time recalculation |
| `markWatered` → SQL `mark_watered` | `src/actions/index.ts:213-234` | creation, inside the database |
| `postponePlant` → SQL `postpone_plant` | `src/actions/index.ts:242-267` | **season-blind, always `+2`** |
| `TodayList` label | `today-list.tsx:352-354` | display |
| `season-interval-summary` | `season-interval-summary.astro:18-29` | display |
| `EditPlantForm` preview | `edit-plant-form/utils.ts:48-60` | display (client) |
| `AddPlantForm` preview | `add-plant-form.tsx:237-238` | display (client) |

### 4. Database-side date handling (mapped, not tested here)

Verified across all five migrations: **no scheduling logic anywhere reads the
database clock.** Every scheduling function takes the calendar date as a parameter.

- `mark_watered(p_plant_id, p_acted_on)` — `20260724120000_add_season_aware_intervals.sql:19-79`.
  Picks the season interval by the range test above, then
  `v_new_due_on := p_acted_on + v_interval_days` (`:67`). `date + int` in Postgres is
  exact calendar-day addition with no timezone involvement — the direct analogue of
  `nextDue`'s epoch-day addition.
- `postpone_plant(p_plant_id, p_acted_on)` — `20260723120000_add_postpone_and_undo.sql:66-113`.
  `v_new_due_on := p_acted_on + 2` (`:101`). Reads neither interval column. Season-blind
  **by design** — the archive records "Postpone as fresh browser-local action date plus
  two calendar days" precisely so an overdue task always leaves Today
  (`context/archive/2026-07-23-postpone-and-undo/plan.md:34`).
- `undo_watering_event(p_event_id)` — `20260723120000_add_postpone_and_undo.sql:115-168`.
  No date computation at all: restores `prev_due_on` recorded on the event row, guarded
  by an optimistic check that `plants.next_due_on` still equals the event's `new_due_on`,
  then deletes the event.
- `created_at` / `updated_at` are `timestamptz default now()` — audit-only, never read
  for scheduling (`20260719120000_create_plants.sql:11-12,22`).

Column types: `plants.next_due_on` is **`date`**, not `timestamptz`
(`20260719120000_create_plants.sql:9`). `growing_interval_days` /
`dormancy_interval_days` are `int` with `check (… between 1 and 365)`, backfilled from
the dropped `interval_days` column. `watering_events` stores `acted_on`,
`prev_due_on`, `new_due_on`, all `date`. Integer days + `date` columns on both sides
means no rounding or fractional-day failure mode exists.

**Handoff to Phase 2**: none of the above is reachable from a pure unit test. The
TS↔SQL parity assertion, `postpone = +2`, and the undo staleness guard all need the
seeded-database harness that test-plan §3 Phase 2 buys.

### 5. Test-runner bootstrap — verified recommendation

**Add one dependency**: `vitest@^4.1.10` (peer range `vite: ^6 || ^7 || ^8`, which
covers the repo's `"overrides": { "vite": "^7.3.2" }`, resolved to `vite@7.3.6` — **no
conflict**).

```ts
// vitest.config.ts
/// <reference types="vitest/config" />
import { getViteConfig } from "astro/config";

export default getViteConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    env: { TZ: "UTC" },
  },
});
```

```json
"test": "vitest run",
"test:watch": "vitest"
```

Evidence for each decision:

- **`getViteConfig()` still exists in Astro 6.** Verified against the installed
  package, not just docs: `node_modules/astro/dist/config/index.d.ts:13` declares
  `getViteConfig(userViteConfig, inlineAstroConfig?)`, re-exported at
  `node_modules/astro/dist/config/entrypoint.d.ts:9`. Astro's own testing guide
  (Context7 `/withastro/docs`, `guides/testing.mdx`) still presents it as the path.
  It buys the `@/*` alias and Astro's config resolution without duplicating them.
- **`environment: "node"`, not `happy-dom`, not a workerd pool.** No DOM is touched.
  The test plan's workerd concern (§2 Risk #1: "'it works in the dev server' does not
  imply 'it works on workerd'") is real but does not apply to Phase 1: these modules
  have no bindings, no I/O, and exercise no Cloudflare-specific semantics.
  `@cloudflare/vitest-pool-workers@0.18.8` exists and is peer-compatible if a later
  phase needs it, but it requires wrangler/pool config and a per-test isolate for
  zero benefit here. **Caveat, explicitly unverified**: the sub-agent could not
  confirm via the Cloudflare docs MCP either (a) that workerd ships full ICU, or
  (b) the Workers `Date.now()` freezing behaviour. Neither claim is load-bearing for
  the `node` recommendation, but both should be re-checked against
  `developers.cloudflare.com/workers/runtime-apis/web-standards/` before any future
  workerd-pool decision.
- **`test.env.TZ = "UTC"` as a safety net, explicit arguments as the practice.**
  Preferred over `TZ=UTC vitest run` in the script (shell-portability) and over
  per-test `vi.stubEnv` (must be repeated, easy to forget). But note that
  `getTodayInTimeZone(zone, now = new Date())` and
  `getMillisecondsUntilNextMidnight(zone, now = new Date())` both take an **injectable
  `now`**, and `getSeason`/`nextDue`/`resolveScheduleChange` take explicit date
  strings. Tests should always pass `now` rather than rely on the default —
  `getTodayInTimeZone("Pacific/Kiritimati", new Date("2026-02-28T12:00:00Z"))` is
  deterministic with no ambient state whatsoever. The ambient `TZ` pin is only
  actually required for `parseLocalDateString` / `formatShortDate` / `formatDueLabel`.
  `vi.useFakeTimers()` + `vi.setSystemTime()` is available but should be the
  exception, not the pattern.
- **No tsconfig change.** `tsconfig.json` has `include: [".astro/types.d.ts", "**/*"]`,
  already matching `src/lib/*.test.ts`, with `@/*` → `./src/*` under `paths`.
- **File placement**: co-located, `src/lib/date.test.ts` etc. The AGENTS.md
  "one folder per component" rule governs components, not `src/lib/` helpers, which are
  already flat siblings. Kebab-case is satisfied.

### 6. Existing quality-gate wiring

- No test infrastructure exists. Repo-wide search for `*.test.*`, `*.spec.*`,
  `__tests__`, `vitest.config.*`, `jest.config.*` returns zero matches outside
  `node_modules`; no runner in `package.json`.
- `.husky/pre-commit` runs `npx lint-staged`; lint-staged applies
  `eslint --fix --max-warnings=0` to `*.{ts,tsx,astro}`, which **will sweep in new test
  files automatically**.
- `eslint.config.js` uses `tseslint.config()` with `strictTypeChecked` +
  `stylisticTypeChecked` and `projectService: true`, and there is no carve-out for test
  files. Combined with `--max-warnings=0`, this means the first committed test file
  fails the pre-commit hook unless Vitest helpers are handled — **prefer explicit
  `import { describe, it, expect } from "vitest"` over `globals: true`**, which avoids
  needing an ESLint globals entry and a `types: ["vitest/globals"]` tsconfig change.
- **CI has never run on this repository, and is broken in three independent ways.**
  A `test` step added to `.github/workflows/ci.yml` today would be inert, and merely
  un-inerting it produces a red build on every PR. Full account and recommended
  remedy in §7 below — this is a precondition for Phase 1's own gate claim, not a
  Phase 5 concern.

### 7. CI repair — a precondition for Phase 1's gate, not a Phase 5 item

**Provenance.** `git log -- .github/workflows/ci.yml` returns a single commit,
`5c8ed01 chore: bootstrap Astro`. `git log --all` finds no branch ever named `master`;
`gh repo view` reports the default branch as `main`. This is un-adapted starter
scaffold — not a regression. It has never been correct in this repository.

**Three independent faults.** Fault 1 currently masks faults 2 and 3, so fixing only
the branch trigger converts a dormant workflow into one that fails on every PR at the
`setup-node` step, before reaching `lint` or `build`.

| # | Fault | Reference | Consequence |
| --- | --- | --- | --- |
| 1 | Triggers on `master` | `.github/workflows/ci.yml:4-7` | Workflow never fires |
| 2 | `cache: npm` in `actions/setup-node@v4` | `ci.yml:14-17` | `setup-node` looks for `package-lock.json` / `npm-shrinkwrap.json` / `yarn.lock`; only `pnpm-lock.yaml` exists → hard fail, "Dependencies lock file is not found" |
| 3 | `npm ci` / `npm run` | `ci.yml:18,20-21` | `npm ci` requires `package-lock.json`, which does not exist → hard fail. Also violates the AGENTS.md hard rule "Package manager is `pnpm` — never `npm`" |

**Checked and *not* a problem, so the plan does not need to chase it.** `gh secret list`
returns empty, so `SUPABASE_URL` / `SUPABASE_KEY` are unset in GitHub — but both are
declared `optional: true` (`astro.config.mjs:21-22`), so the `build` step will not fail
on their absence. **The repair is self-contained in one file and needs no repo-admin
access.**

**Why this belongs to Phase 1 rather than test-plan §3 Phase 5.** The sequencing in the
test plan runs backwards here: §5 marks unit tests "required after §3 Phase 1", but
*required* means enforced, and enforcement means CI, which Phase 5 nominally owns.
Deferring wholly to Phase 5 ships a runner nobody runs and leaves §5's own table false
on disk for four phases — the exact silent-floor-drop Phase 5 exists to prevent.
Recommend the plan carry this as a **named phase with its own success criterion**
(so `/10x-plan-review` can challenge it) rather than as unnamed setup work.

Scope boundary: Phase 1 repairs the workflow and adds `pnpm test` to it. Migration-safety
gating, branch-protection / required-checks configuration, and the Docker + Supabase
integration job remain Phase 5's.

**Proposed workflow** (replaces the current job body):

```yaml
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4        # MUST precede setup-node
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm exec astro sync
      - run: pnpm lint
      - run: pnpm test                     # new in Phase 1
      - run: pnpm build
```

Two ordering gotchas to preserve: `pnpm/action-setup` must come **before**
`setup-node`, or `cache: pnpm` cannot resolve the pnpm store path; and
`pnpm/action-setup@v4` reads `packageManager: "pnpm@11.13.1"` from `package.json`, so
do not pin a pnpm version in the workflow as well — two sources drift.

**Verification, which matters more than usual here.** The failure being repaired *is*
"a gate that looks fine and never ran", so the plan's success criteria should require
both:

1. **It fires.** The workflow triggers on `pull_request` to `main`, so the Phase 1 PR is
   its own proof. A PR showing no checks at all is the same silent state as today.
2. **It can go red.** Deliberately break one assertion, push, confirm the job fails,
   revert. This is the direct application of the existing register entry
   "Always verify command status codes" (`context/foundation/lessons.md:19-24`) — a
   pipeline that never executed a step is indistinguishable at a glance from a passing
   one.

## Code References

- `src/lib/date.ts:7-20` — `toEpochDay` / `fromEpochDay`, the UTC epoch-day core
- `src/lib/date.ts:34-42` — `parseLocalDateString` / `formatShortDate`, the only
  ambient-`TZ`-dependent path in the pure layer
- `src/lib/date.ts:69-89` — `classifyDueStatus`, throws `RangeError` on a future due
  date and on invalid input; inclusive 3-day escalation
- `src/lib/timezone.ts:1-4` — the "duplicated verbatim in `layout.astro`" warning
- `src/lib/timezone.ts:57-65` — `getTodayInTimeZone(timeZone, now = new Date())`
- `src/lib/timezone.ts:67-93` — `getMillisecondsUntilNextMidnight`, 36 h window + 28
  binary-search halvings over `Intl` output
- `src/lib/season.ts:11-21` — the TS season rule and its parity comment
- `src/lib/schedule.ts:19-37` — `resolveScheduleChange`, delta-shift of an existing due date
- `src/lib/interval.ts:3-9` — `nextDue` and its DST-safety doc comment
- `src/middleware.ts:12-19` — the single per-request timezone/today authority
- `src/actions/index.ts:22-26` — `getActionDate`, the UTC fallback for mutations
- `src/actions/index.ts:41-46` — `addPlant`'s creation-time season selection
- `src/actions/index.ts:121-128` — `updatePlant`'s edit-time recalculation
- `src/layouts/layout.astro:13,19-51` — `data-today` and the cookie-writing,
  reload-once inline script
- `src/components/today-list/today-list.tsx:221` — `today === null` widens the list to
  every plant
- `src/components/today-list/today-list.tsx:225-266` — the midnight-rollover effect,
  with its deliberate no-browser-fallback comment
- `src/components/today-list/utils.ts:6-11,27-37` — `formatOverdueDate`, a second
  local-time `Date` construction and duplicate `Intl` formatters inside the island
- `supabase/migrations/20260724120000_add_season_aware_intervals.sql:57-67` — the SQL
  season rule and `p_acted_on + v_interval_days`
- `supabase/migrations/20260723120000_add_postpone_and_undo.sql:101` — `p_acted_on + 2`
- `supabase/migrations/20260723120000_add_postpone_and_undo.sql:115-168` —
  `undo_watering_event` and its staleness guard
- `.github/workflows/ci.yml:4-7` — the `master` trigger on a `main` branch

## Architecture Insights

1. **Strings at the boundary, epoch days in the middle.** The app moves `YYYY-MM-DD`
   strings everywhere and converts to numbers only inside arithmetic helpers. It never
   passes a `Date` across a module boundary. This is why DST and leap years are
   non-events for the arithmetic, and it is the property a test suite should pin.
2. **One authority, resolved once, consumed everywhere.** Timezone resolution lives in
   middleware alone; `locals.timeZone` and `locals.today` are always both-null or
   both-set. Every "who computes today?" question has one answer per request.
3. **Refusal to guess is a designed behaviour, not a gap.** When the zone is unknown,
   the app renders exact dates and omits relative phrasing rather than assuming a day
   (`context/archive/2026-07-24-user-timezone-dates/plan.md:46`). The client rollover
   effect deliberately declines a browser-zone fallback, with the reasoning inline at
   `today-list.tsx:225-231`. A test asserting "shows *something* when zone is unknown"
   would be asserting the wrong thing; the contract is *exact dates, no relative day*.
4. **Duplication is documented rather than eliminated, in two places.** The season rule
   (TS + SQL) and the day-formatting logic (`timezone.ts` + the inline head script that
   cannot import). Both carry "change both together" comments. This is a deliberate,
   recorded trade-off — the database stays the mutation authority, and the head script
   must run before any module loads. Comments are the current enforcement mechanism;
   Phase 1's real contribution to Risk #6 is converting one of them into an executable
   assertion.
5. **Purity was preserved *in anticipation* of this phase.** The overdue slice
   explicitly recorded: "Keep classification pure and isolated in `src/lib/date.ts` so
   boundary cases can move into unit tests when project-wide test tooling is
   established" (`context/archive/2026-07-20-overdue-tasks-and-urgency/plan.md:114-115`).
   Phase 1 is collecting on a debt the codebase was structured to pay.

## Historical Context (from prior changes)

**Settled — do not re-litigate:**

- Timezone chain is `cookie 'tz'` → `request.cf.timezone` → `null`; cookie wins because
  geo-IP lies under VPN/travel — `context/archive/2026-07-24-user-timezone-dates/plan-brief.md:22,40-44`
- Epoch-day arithmetic chosen for DST-independence; "only the *acquisition* of 'what day
  is it for this user' is broken" — `.../plan.md:25`
- Season evaluated at schedule-creation; a boundary crossing never rewrites a stored
  `next_due_on` — `context/archive/2026-07-23-season-aware-intervals/change.md:12-13`,
  `plan.md:42,62-63`
- Watered reschedules from the *actual watering date* + active interval, not from the
  old due date — PRD FR-011, `context/foundation/prd.md:107-110`
- Edit recalculation is `oldNextDue + (newActiveInterval − oldActiveInterval)`, via
  epoch-day shift and **explicitly not** via `nextDue()`, whose naming does not describe
  a signed shift — `context/archive/2026-07-25-edit-plant-and-recalc/plan.md:257-259`
- No clamping when a recalculated date lands in the past — clamping would make the rule
  non-invertible — `.../plan.md:125-126`
- Undo restores stored `prev_due_on` atomically; the ten-second window is a client
  affordance, never server-enforced — `context/archive/2026-07-23-postpone-and-undo/plan.md:59,83,102`

**Rejected — a plan should not propose these again:**

- `clientDate` in the mutation contract → removed; server derives the date —
  `context/archive/2026-07-24-user-timezone-dates/plan-brief.md:28`
- Browser-zone fallback for the rollover timer when the server zone is unknown →
  dropped mid-implementation, because "a cookie-blocked user in a far-east zone could
  store `p_acted_on` a day early on every mutation" — `.../plan.md:350-354` (Addendum A2).
  **This directly refutes an apparent client/server-skew failure mode**: the effect
  early-returns on `timeZone === null`, and `today` is null exactly when `timeZone` is.
- Viewer-locale date formatting → fixed `en-GB`, so two in-page formatters cannot
  disagree — `.../plan.md:356-360` (Addendum A3)
- User-configurable / per-plant / hemisphere season boundaries —
  `context/archive/2026-07-23-season-aware-intervals/plan.md:41`
- Boundary-triggered rewrites, cron jobs, or read-side mutation of `next_due_on` — `.../plan.md:42`
- A third copy of the season rule in an `update_plant` RPC — explicitly rejected,
  `context/archive/2026-07-25-edit-plant-and-recalc/plan.md:122-123`
- A test runner, in every prior slice — "No new Vitest, Playwright, pgTAP, or other test
  framework" (`.../season-aware-intervals/plan.md:46`, and equivalents in three others).
  **This change reverses that standing decision**, which is its whole point.

**Named edge cases already identified (free test-case inventory):**

- UTC±13 / UTC+14 and DST transitions named as "the likeliest defects and the hardest to
  reproduce by hand" — the manual matrix used `Pacific/Kiritimati` (UTC+14),
  `Pacific/Midway` (UTC-11), and a `Europe/Warsaw` DST boundary —
  `context/archive/2026-07-24-user-timezone-dates/plan-brief.md:61`, `plan.md:301-308`
- Leap year, Feb's final day, Mar 1, Oct 31, Nov 1, and year wrapping with unequal
  intervals — `context/archive/2026-07-23-season-aware-intervals/plan.md:139`
- Forged cookie (`Not/AZone`) must fall through, never throw or 500 —
  `.../user-timezone-dates/plan.md:308`
- Cookie-rejecting browsers must settle after one reload, not loop — `.../plan.md:150,309`
- A stored due date can predate the active season (watered Oct 25 on a 7-day growing
  interval → due Nov 1, dormancy already active); the label must not imply otherwise —
  `.../season-aware-intervals/plan.md:276`
- Sleeping laptop / bfcache restore crossing midnight without the timer firing —
  `.../user-timezone-dates/plan.md:249`
- Same-year vs cross-year overdue formatting —
  `context/archive/2026-07-20-overdue-tasks-and-urgency/plan.md:17`
- The concrete bug that motivated S-08: "at UTC+13 on the morning of March 1 the row
  would read `Growing · Every 7 days · Due 28 Feb`" —
  `.../season-aware-intervals/plan.md:253`

**Documented as untested / fragile:**

- "nothing guards `src/lib/timezone.ts` against future regression… flagging it as the one
  place I'd revisit" — `context/archive/2026-07-24-user-timezone-dates/plan-brief.md:61`
- "The head script's correcting reload is the one genuinely dangerous piece in this plan."
  — `.../plan.md:78`
- The season rule "stays duplicated between `src/lib/season.ts` and `mark_watered`; this
  plan adds no third site but does not remove the pair" —
  `context/archive/2026-07-25-edit-plant-and-recalc/plan-brief.md:88`

## Related Research

- `context/foundation/test-plan.md` §2 Risks #1 and #6, §3 Phase 1, §4 Stack, §6.1 —
  the parent artifact this change implements
- `context/foundation/lessons.md` — "Extract generic helpers to `src/lib`", the register
  entry citing the duplicated `todayLocalDateString()` that seeded Risk #1
- `context/archive/2026-07-24-user-timezone-dates/plan.md` — the timezone architecture
- `context/archive/2026-07-23-season-aware-intervals/plan.md` — the season architecture
- No prior `research.md` exists in any archived change folder; these folders contain
  `change.md`, `design.md` (where applicable), `plan-brief.md`, and `plan.md` only.

## Open Questions

Three genuine defects were found. None is a calendar-arithmetic bug — all three are
"which date arrived, and when" problems, which is exactly the Risk #1 thesis. Whether
Phase 1 fixes them or only records them is a planning decision; note that all three
are *plumbing*, so none is provable by a pure unit test alone.

- **D-1 — Add/Edit forms never refresh `today`; their preview can disagree with what is
  saved.** `AddPlantForm` (`add-plant-form.tsx:31`) and `EditPlantForm`
  (`edit-plant-form.tsx:37`) receive `today` once at SSR and have no rollover effect —
  unlike `TodayList` (`today-list.tsx:225-266`). The client preview
  (`add-plant-form.tsx:237-238`, `edit-plant-form/utils.ts:48-60`) calls the *same*
  helpers the server calls, but with the page-render date; the action recomputes via
  `getActionDate` at submit (`src/actions/index.ts:22-26`). A form left open across local
  midnight — and especially across a season boundary at 23:58 on Oct 31 — previews the
  growing interval and silently saves the dormancy one. Same rule, different input.
  This is the sharpest instance of Risk #1 and #6 combined.
- **D-2 — `getActionDate`'s UTC fallback can pick the wrong season for users behind
  UTC.** `src/actions/index.ts:25`. When both timezone sources are unavailable,
  mutations record against UTC's calendar date. A user at UTC-11 watering at 23:30 local
  on Feb 28 is already Mar 1 in UTC — `mark_watered` applies the *growing* interval a day
  early. The fallback is deliberate and documented in the comment at `:23-24` (a mutation
  must have *some* date), but the season-boundary consequence does not appear to have
  been reasoned about. Note this triggers on exactly the four dates Risk #6 names.
- **D-3 — `today === null` widens the Today list to every plant, and one browser
  configuration never recovers.** `today-list.tsx:221`:
  `today === null ? optimisticPlants : optimisticPlants.filter(…)`. Under the
  unknown-zone path the list shows *all* plants with no due badges. Normally the inline
  script's one-shot reload fixes this — but that reload is guarded by `sessionStorage`
  and the guard is wrapped in a silent `catch` (`layout.astro:48-50`). With
  `sessionStorage` unavailable (some private-browsing configurations), the reload never
  fires and the session stays in degraded mode indefinitely, with every mutation falling
  back to UTC. The archive treats "settles on exact dates" as the intended outcome
  (`.../user-timezone-dates/plan.md:309`), so showing every plant may be a deviation from
  the intended degraded state rather than the intended state itself. **Worth confirming
  the intent before writing a test that freezes current behaviour** — asserting the
  implementation here would be exactly the tautology test-plan §2 warns against for
  Risk #2.

**Resolved during research — no longer an open question, see §7 for the full account
and a proposed workflow.** The CI breakage is not one fault but three (`master`
trigger, `cache: npm` with no npm lockfile, `npm ci` with no `package-lock.json`), and
fixing only the trigger turns a dormant workflow into a red one. Secrets were checked
and are a non-issue (both env fields are `optional: true`). The recommendation is that
**the plan carry this as a named phase inside Phase 1**, because Phase 1 cannot deliver
the gate that test-plan §5 says it delivers without it. Phase 5 keeps migration safety,
branch protection, and the integration job.

One item to verify before it becomes load-bearing:

- Workerd's ICU completeness and the Workers `Date.now()` freezing behaviour could not be
  confirmed against live Cloudflare documentation in this session. Neither affects the
  Phase 1 `node`-environment recommendation, but both must be re-checked before any
  future decision to adopt `@cloudflare/vitest-pool-workers`.
