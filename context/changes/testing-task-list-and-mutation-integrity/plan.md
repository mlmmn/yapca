# Task-list and Mutation Integrity Implementation Plan

## Overview

Build the seeded-database integration harness this repo does not yet have, then use
it to discharge test-plan §3 Phase 2 — Risks #2 (a due or overdue task is silently
omitted), #3 (an edit drops a field or miscalculates next-due), and #4 (postpone or
undo leaves schedule and journal inconsistent).

Two things make this more than "write some tests". First, Risk #2's due predicate is
not in the database and not on the server — it is an inline arrow inside a hydrated
React island, which test-plan §7 excludes from testing. It has to be extracted before
it can be proven. Second, the harness itself is blocked on two Vite virtual modules
(`astro:env/server`, `astro:actions`) that have no runtime resolution outside Astro's
build, and the current Vitest `include` glob will sweep any new database-dependent
test into `pnpm test` and the pre-commit hook the moment one lands.

## Current State Analysis

**What exists.** Phase 1 (`context/archive/2026-07-26-testing-runner-and-calendar-math/`)
bootstrapped Vitest 4.1.10 on Node with `vite-tsconfig-paths`, and shipped pure-function
unit tests under `src/lib/`. Conventions are settled: explicit `vitest` imports (no
globals), `describe` named after the function under test, relative imports with one
deliberate `@/` alias canary in `src/lib/season.test.ts`, and `test()` enforced over
`it()` by `eslint.config.js:174`.

**What is missing.** Everything database-facing. There is no `setupFiles`, no
`resolve.alias`, no `testTimeout` override (default 5000 ms is below database
round-trip latency), no fixture layer, no reset machinery, and no integration script.
`.github/workflows/ci.yml:31-40` has no Docker or Supabase service.

**The constraint that shapes the sequencing.** `vitest.config.ts:13` reads
`include: ["src/**/*.test.{ts,tsx}"]` with no `exclude`. `lefthook.yml:11` runs
`pnpm vitest related {staged_files} --run` pre-commit. A single integration test
file placed under `src/` therefore breaks `pnpm test`, CI, and every developer's
pre-commit hook on any machine without Docker running. The runner split is not
cleanup work to do afterwards — it is a precondition.

**Where the risks actually live.** Research
(`context/changes/testing-task-list-and-mutation-integrity/research.md`) established:

- Risk #2's predicate is `today-list.tsx:257-259`, client-side, duplicated three ways
  (`<= today` at :257, `> today` at :259, `restored_due_on > currentToday` at :224).
  `authed-shell.astro:16-20` fetches with no date filter at all.
- Risk #3's recalculation is `resolveScheduleChange` (`src/lib/schedule.ts:19-37`):
  the *stored previous due date* shifted by the interval delta. It never reads the
  watering journal.
- Risk #4's server side is sound — three atomic `security definer` RPCs, and the
  `water → undo → postpone → undo` trace returns cleanly to origin. The defects live
  at the seams: `updatePlant` moves `next_due_on` with no journal row, and undo's
  currency guard compares values rather than identity.

### Key Discoveries:

- **`entrypoints/server.js:5` imports `virtual:astro:actions/options`** — verified
  directly against astro 6.4.8. `runtime/server.js` and `runtime/client.js` contain no
  `virtual:` imports, so absolute-path aliases into those two files are the only route.
- **`src/lib/supabase.ts:3` is the sole `astro:env/server` consumer.** A shim alias
  keeps all production code untouched. The factory signature is
  `createClient(requestHeaders: Headers, cookies: AstroCookies)` and returns `null`
  when either env var is falsy — the fixture layer must supply both.
- **`supabase/seed.sql:9-71` is the in-repo proven pattern** for minting a confirmed
  `auth.users` row plus matching `auth.identities` without a service-role key. No
  service-role key exists anywhere in this repo.
- **`compareDueRecords` already lives in `src/lib/date.ts:80`** and is imported by
  `today-list.tsx:228`. The extracted due predicate belongs beside it, not in the
  component folder — `context/foundation/lessons.md:5-10` is explicit about this.
- **`defineAction` delivers context as `this`** (`node_modules/astro/dist/actions/runtime/server.js:20-40`).
  `.orThrow.call(ctx, formData)` works with no HTTP server and skips the
  `Symbol.for("astro.actionAPIContext")` check the non-`orThrow` form requires.
- **`supabase/config.toml:209` has `enable_confirmations = true`** and
  `:189` rate-limits sign-in to 30 per 5 minutes per IP.
- **`supabase/seed.sql:75-86` has no overdue-by-many row** — `classifyDueStatus`'s
  `overdue-strong` branch (`src/lib/date.ts:107`) is unexercised, and the seeded dates
  are relative to `current_date` so they are not deterministic across days.

## Desired End State

An opt-in integration suite runs against a local Supabase stack and proves, by
asserting resulting state rather than response codes, that: every due and overdue
plant reaches the daily list and no not-yet-due plant does; an edit preserves every
untouched column while recalculating next-due by the interval-delta rule; and
water / postpone / undo sequences leave `plants` and `watering_events` mutually
consistent.

`pnpm test` and the pre-commit hook remain green on a machine with no Docker.
`pnpm test:integration` requires the stack and is documented as such. Test filenames
are the suite-selection contract: `*.test.ts(x)` is unit and
`*.integration.test.ts(x)` is integration. Two genuine
defects (V1, V3) are captured as reviewed, skipped assertions pointing at a follow-up
change. The test plan's Risk #3 wording is corrected, and `§6.2`/`§6.3` of the
cookbook are written from what actually shipped.

**Verification**: `pnpm test` green with Docker stopped; `pnpm test:integration` green
with the stack up; `pnpm lint` and `pnpm check` clean; a narrowed, unit-only Stryker
run over the Risk #2/#3 pure modules reports no survived mutant that represents a
user-visible bug. Risk #4's database logic is covered by the SQL gate instead.

## What We're NOT Doing

- **Not fixing V1 or V3.** They are real defects with real design questions (an
  identity-based undo guard needs a migration; journal-writing in `updatePlant` needs
  a semantics decision). They get reviewed skipped tests and a follow-up change, not a
  fix inside a testing phase.
- **Not testing the React island.** V4, V5, V6 and V7 are client-state defects.
  `§7` excludes the UI layer and no runner in this rollout can reach them. They stay
  documented in research.
- **Not wiring CI.** Phase 5 of the rollout owns gate wiring. This phase makes the
  suite runnable and keeps CI green; it does not add a Supabase service to `ci.yml`.
- **Not driving real HTTP.** In-process Action invocation only. Phase 4 (Risk #7)
  needs a real multipart boundary and will build that separately.
- **Not restoring `getViteConfig()`.** Settled dead end — `vitest.config.ts:1-6` and
  `context/archive/2026-07-26-testing-runner-and-calendar-math/plan.md`.
- **Not changing postpone's behaviour or the PRD.** The `acted_on + 2` rule gets
  pinned as the contract; the PRD divergence is recorded for a product decision
  outside this phase.
- **Not adding a due filter to the server query.** `authed-shell.astro` stays as-is —
  the client needs upcoming rows for `nextUpcoming`, and `today` is browser-derived.
- **Not testing Supabase Auth itself** (`§7`), and not adding a service-role key.

## Implementation Approach

Six phases, ordered so that nothing can break the existing green suite. Phases 1–2
build infrastructure and prove it with a smoke test before any risk assertion exists.
Phases 3–5 take one risk each. Phase 6 closes the PL/pgSQL gap Stryker cannot reach
and writes down what shipped.

The harness calls Actions in-process through `.orThrow.call(ctx, formData)` with a
hand-built context, but signs in through a real anon-key client so the JWT is
genuine and RLS applies exactly as in production. This matters more than convenience:
table access runs under RLS while the RPCs are `security definer` and bypass it,
relying on hand-written `user_id = v_user_id` predicates. A harness that minted users
with a service-role key would exercise neither mechanism.

Authentication is pooled per Vitest worker. Each worker lazily mints at most two
namespaced `auth.users` rows via direct psql following the seed's pattern, signs each
slot in once, and reuses its real JWT and cookie jar for that worker's tests. The
integration project caps `maxWorkers` at 2, bounding a complete run to at most four
sign-ins and two immediate runs to at most eight — below the local 30-per-5-minute
limit.

Isolation remains explicit at the data layer. Workers have distinct users, and each
test receives unique plant/event IDs under its worker user. A `beforeEach` clears
domain rows created under the selected worker slot before the next test uses it;
integration tests do not use `test.concurrent`. Tests that need a second account use
the worker's second lazy slot rather than minting an unbounded new identity.

## Critical Implementation Details

**Module shim fragility.** The `astro:actions` shim must alias to
`node_modules/astro/dist/actions/runtime/server.js` and `.../client.js` by absolute
filesystem path. Aliasing to the package's public `astro:actions` entrypoint does not
work — that file imports `virtual:astro:actions/options` at line 5. Neither target is
listed in astro's `exports` map, so this is coupled to Astro's internal layout and
will need revisiting on major Astro upgrades. Name this in a comment at the shim, in
the same register as the existing `getViteConfig()` note in `vitest.config.ts`.

**The `updated_at` CAS token must round-trip verbatim as a string.** Passing it
through a `Date` truncates to milliseconds and turns the optimistic-concurrency guard
into a permanent conflict. Called "the plan's single most fragile requirement" at
`context/archive/2026-07-25-edit-plant-and-recalc/reviews/impl-review.md:36`. Any
fixture that reads a plant and feeds `updated_at` back into `updatePlant` must not
deserialize it.

**Seed dates are relative to `current_date`.** `supabase/seed.sql:75-86` uses
`current_date`, `current_date + 5`, `current_date - 1`. Integration tests must create
their own plants at dates pinned relative to an explicitly chosen `clientDate` rather
than depending on the seeded three, or they will drift.

**`getActionDate` rejects a client date more than 1 day from UTC today**
(`src/lib/date.ts:43-51`, called at `src/actions/index.ts:111`). Fixtures cannot pin
an arbitrary historical `clientDate` for the forward mutation paths. Tests needing a
specific calendar position must set plant due dates relative to today, not move today.

## Phase 1: Runner Split and Module Shims

### Overview

Make it possible for a database-dependent test to exist in this repo without breaking
anything. No risk tests yet.

### Changes Required:

#### 1. Vitest project split

**File**: `vitest.config.ts`

**Intent**: Separate the existing Node unit suite from a new integration suite so that
`pnpm test` never requires Docker. Preserve the existing unit behaviour exactly —
including the UTC default and the `vite-tsconfig-paths` plugin the `@/` alias canary
depends on.

**Contract**: Vitest `projects` named `unit` and `integration`. The unit project keeps
`include: ["src/**/*.test.{ts,tsx}"]` and gains
`exclude: ["src/**/*.integration.test.{ts,tsx}"]`. The integration project matches
`src/**/*.integration.test.{ts,tsx}`, sets `testTimeout` above database round-trip
latency, caps `maxWorkers` at 2, adds `setupFiles` for env loading, and carries the
`resolve.alias` entries below. Both keep `environment: "node"` and the `TZ` default.

The filename suffix is the classification contract: `*.test.ts(x)` means unit and
`*.integration.test.ts(x)` means integration. Do not add tags as a second
classification system.

#### 2. Virtual-module shims

**File**: `test/shims/astro-env-server.ts`, `test/shims/astro-actions.ts`

**Intent**: Give the two Vite virtual modules a runtime resolution so that importing
`src/actions/index.ts` succeeds outside Astro's build, without touching production
code.

**Contract**: `astro-env-server.ts` exports `SUPABASE_URL` and `SUPABASE_KEY` read
from `process.env`. In `vitest.config.ts`, resolve the installed Astro package root
from `astro/package.json`, then derive absolute paths to
`dist/actions/runtime/server.js` and `dist/actions/runtime/client.js`. Register those
paths under shim-private exact aliases
`"virtual:yapca-test/astro-actions-server"` and
`"virtual:yapca-test/astro-actions-client"`.

`astro-actions.ts` re-exports `defineAction` and `getActionContext` from the private
server alias, and `ActionError`, `isActionError`, `isInputError` from the private
client alias. The integration project maps the public virtual specifiers
`"astro:env/server"` and `"astro:actions"` to the two local shim files. Neither shim
imports Astro's public `astro:actions` entrypoint or an unaliased package-internal
subpath.

#### 3. Environment loading

**File**: `test/setup/load-env.ts`, `.env.example`

**Intent**: Populate `SUPABASE_URL`, `SUPABASE_KEY` and the direct postgres URL for
the integration project. Vite's `loadEnv` only picks up `VITE_`-prefixed variables and
these are unprefixed, so this is an explicit step.

**Contract**: A `setupFiles` module that loads the local-stack values and fails loudly
with an actionable message (naming `pnpx supabase start`) if they are absent, rather
than letting `createClient` return `null` and surface as a confusing downstream error.
`.env.example` documents the postgres connection string.

#### 4. Scripts and hook safety

**File**: `package.json`, `lefthook.yml`

**Intent**: Add an opt-in integration script and verify the pre-commit hook does not
pull integration tests in via `vitest related`.

**Contract**: Set the exact package scripts:

- `"test": "vitest run --project unit"`
- `"test:watch": "vitest --project unit"`
- `"test:integration": "vitest run --project integration"`

Set Lefthook's test command to
`pnpm vitest related {staged_files} --run --project unit`, preserving its related-file
optimization while excluding the integration project. The current lint and typecheck
commands are valid and remain unchanged.

### Success Criteria:

#### Automated Verification:

- `pnpm test` passes with the Supabase stack stopped
- `pnpm lint` passes with `--max-warnings=0`
- `pnpm check` passes
- An integration test importing `src/actions/index.ts` resolves both virtual modules
  without error. Retained as a permanent shim regression guard rather than thrown away —
  it is the only automated check on the alias wiring, and Phase 2's
  `harness.integration.test.ts` does not replace that role.
- `pnpm test:mutants --mutate "src/lib/season.ts" --force` exits 0 — a tool that invokes
  vitest **without** `--project` must still be able to resolve the multi-project config.
  Every other criterion here passes `--project`, so without this one the split's riskiest
  surface has nothing pointing at it.

#### Manual Verification:

- Committing an unrelated `.ts` file with Docker stopped completes the pre-commit hook
- The shim comment explaining the Astro-internal coupling is present and accurate

---

## Phase 2: Fixture Layer

### Overview

Mint users, create plants, build Action contexts, clean up. Proven by one smoke test
that does a real round trip under RLS.

### Changes Required:

#### 1. User fixture

**File**: `test/fixtures/user.ts`

**Intent**: Maintain a bounded, worker-scoped pool of confirmed `auth.users` plus
their `auth.identities` rows. Sign each lazy pool slot in through the anon-key
Supabase client once to obtain a genuine `authenticated` JWT — so RLS and the RPCs'
`user_id` predicates both apply as they do in production without exhausting Auth
rate limits.

**Contract**: A worker-local module singleton exposes two lazy session slots. Each
slot returns the user id, an authenticated Supabase client, and a mutable cookie jar
needed to build requests. User creation follows `supabase/seed.sql:9-71`'s insert
pattern including `email_confirmed_at`; email addresses include a run namespace,
worker id, and slot number, and all fixture users share one harness-only password for
authenticated stale-run cleanup. A slot signs in at most once per worker and is
reused across tests. Default tests use slot 0; cross-account tests may request slot 1.

Before each test, delete domain rows owned by the selected slot and allocate unique
plant/event IDs for that test. Do not run integration tests with `test.concurrent`;
sharing a slot concurrently would invalidate cleanup and cookie-jar isolation. With
`maxWorkers: 2`, the pool performs at most four sign-ins per suite run.

#### 2. Plant and event factories

**File**: `test/fixtures/plants.ts`

**Intent**: Create plants at due dates expressed relative to a caller-chosen reference
day, so tests express intent ("overdue by 30") rather than literal dates, and do not
inherit the seed's `current_date` drift.

**Contract**: A factory taking `{ userId, name?, growingIntervalDays?,
dormancyIntervalDays?, dueOffsetDays }` and returning the created row. A companion
reader returns the full `plants` row and the plant's `watering_events` ordered by
`created_at`, for resulting-state assertions.

#### 3. Action context builder

**File**: `test/fixtures/action-context.ts`

**Intent**: Build the minimal `ActionAPIContext` that `requireSession`
(`src/actions/index.ts:13-21`) and `@supabase/ssr` need, so actions can be invoked
in-process.

**Contract**: Produces `{ request, cookies, locals: { user } }` where `request`
carries the session cookie header and `cookies` implements `set()` — `@supabase/ssr`
writes refreshed session cookies via `setAll` (`src/lib/supabase.ts:19-23`) and will
throw without it. Actions are invoked as
`server.<action>.orThrow.call(ctx, formData)`; input is real `FormData` because every
action declares `accept: "form"`. Each request receives a snapshot of its worker
slot's cookies; cookies written by `setAll` are merged back into that slot's jar so a
refresh remains available to later tests without sharing a mutable request object.

#### 4. Global cleanup

**File**: `test/setup/global-setup.ts`

**Intent**: Bound `auth.users` growth across runs without serializing the suite.

**Contract**: A Vitest `globalSetup` that generates a serializable run namespace and
provides it to workers for pooled-user email construction. Reserve
`yapca-integration+` as the test-email prefix. Before deleting stale namespaced users,
authenticate each one with the harness password and remove every object under its
`plant-photos/<user-id>/` folder through the Storage API. Then execute
`DELETE FROM auth.users WHERE email LIKE 'yapca-integration+%'`; existing foreign
keys cascade plants and watering events. Do not use `TRUNCATE`, which cannot filter
by namespace and would remove the `seed.sql` user the app's development workflow
depends on.

The fixture cleanup lists and removes every Storage object under each initialized
slot's user-id folder before clearing that slot's domain rows. Teardown performs the
same Storage cleanup for the current run, asserts that no objects remain for the
captured namespaced user IDs, and only then deletes
`yapca-integration+<run-namespace>+%` users. Use the authenticated Storage API rather
than deleting `storage.objects` metadata directly.

#### 5. Smoke test

**File**: `src/actions/harness.integration.test.ts`

**Intent**: Prove the whole substrate end to end before any risk test depends on it,
and prove it fails when it should — a harness that silently no-ops is worse than none.

**Contract**: One test mints a user, creates a plant, invokes `markWatered` in-process,
and asserts the resulting `plants.next_due_on` and the inserted `watering_events` row.
A second asserts that a client with no session receives `UNAUTHORIZED`, confirming the
harness is genuinely subject to auth rather than running privileged.

### Success Criteria:

#### Automated Verification:

- `pnpm test:integration` passes with the stack running
- `pnpm test` still passes with the stack stopped
- The unauthenticated case yields `UNAUTHORIZED`, not a successful write
- `pnpm lint` and `pnpm check` pass

#### Manual Verification:

- Running the integration suite twice in a row passes both times (idempotent fixtures)
- Deliberately breaking an assertion makes the test fail, confirming it executes
- `auth.users` does not accumulate unbounded across repeated runs
- No Storage objects owned by namespaced test users remain after the suite

---

## Phase 3: Risk #2 — Extract and Prove the Due Derivation

### Overview

Move the due/overdue decision out of the React island into a pure module, unit-test it
at the boundaries, and integration-test that the query feeding it returns the seeded
set intact. This is the phase that touches production code.

### Changes Required:

#### 1. Extract the due derivation

**File**: `src/lib/due.ts` (new)

**Intent**: Centralise the three independent due comparisons currently at
`today-list.tsx:257`, `:259` and `:224` into one tested module. Placement in
`src/lib/` beside the existing `compareDueRecords` follows
`context/foundation/lessons.md:5-10` — the predicate is generic and state-free, and
this duplication is the exact drift shape that register records.

**Contract**: Functions generic over `<T extends { next_due_on: string }>`, so both
`PlantListItem` and the optimistic row type satisfy them without the module knowing
about either. Predicate names carry a verb prefix per AGENTS.md.

- `isDueOn(record, today)` — the inclusive `next_due_on <= today` comparison, with no
  lower bound (overdue by any amount is due).
- `selectDueRecords(records, today)` — the `:257` filter.
- `findNextUpcoming(records, today)` — the `:259` lookup, returning `null` when none.

Both operands stay `YYYY-MM-DD` strings; lexicographic comparison is ordinally correct
and must not be "improved" into `Date` arithmetic.

#### 2. Rewire the island

**File**: `src/components/today-list/today-list.tsx`

**Intent**: Replace all three inline comparisons with calls into `src/lib/due.ts`.
Behaviour-preserving refactor only — the `today === null` short-circuit at `:257` and
`:259` stays, because a null today is a degraded state, not an empty day
(`context/archive/2026-07-26-today-acquisition-defects/plan.md:76`).

**Contract**: `:257` uses `selectDueRecords`, `:259` uses `findNextUpcoming`, and
`:224`'s `data.restored_due_on > currentToday` becomes the negation of `isDueOn`. The
`activeDueList` derivation and `ANIMATION_MS` behaviour are unchanged.

#### 3. Unit tests for the derivation

**File**: `src/lib/due.test.ts`

**Intent**: Prove the boundary directly — the assertion test-plan §2 Risk #2 asks for
("given plants due today, overdue by 1, and overdue by 30, all three appear; given a
plant not yet due, it does not").

**Contract**: Sibling top-level `describe` per exported function, named after the
function, per `context/foundation/lessons.md:26-31`. Table-driven cases covering due
today, overdue by 1, overdue by 30, due tomorrow, and a year boundary. Expected values
stated literally rather than derived from the comparison under test — the tautology
this suite exists to avoid. Include a case asserting the *set* returned, not just its
length, so a filter returning the wrong rows fails.

#### 4. Extract and integration-test the production loader

**File**: `src/lib/services/load-today-plants.ts`,
`src/components/authed-shell.astro`,
`src/lib/services/load-today-plants.integration.test.ts`

**Intent**: Prove the production server loader does not silently drop rows — the half
of Risk #2 that lives below the island. The test must invoke the same callable used
by `authed-shell.astro`, not repeat its intended PostgREST query.

**Contract**: Move `loadPlants()` from the Astro frontmatter into
`loadTodayPlants(requestHeaders, cookies)` in the server service module. Preserve its
current return contract, select, ordering, signed-photo URL mapping, and `null` error
path. `authed-shell.astro` calls this exported function with `Astro.request.headers`
and `Astro.cookies`; it no longer owns a private query or mapper.

The integration test seeds the pooled user with plants at offsets `-30`, `-1`, `0`,
`+5`, calls `loadTodayPlants()` with that session's request headers and cookies, and
asserts all four rows return ordered by `next_due_on` then `name`. Pass the returned
rows through `selectDueRecords` and assert the exact `-30`, `-1`, `0` set, so the
test covers the production loader-to-derivation seam without browser E2E.

Document in a comment that PostgREST's `max_rows = 1000`
(`supabase/config.toml:18`) truncates silently with `error === null`, so this
assertion is about the unfiltered contract, not about volume. Astro rendering and
React-island hydration remain covered by the phase's manual verification.

### Success Criteria:

#### Automated Verification:

- `pnpm test` passes — new unit tests green, existing suite unaffected
- `pnpm test:integration` passes
- `pnpm lint` and `pnpm check` pass
- No `next_due_on` comparison remains inline in `today-list.tsx`

#### Manual Verification:

- The daily list renders identically before and after the refactor: a plant due today,
  one overdue, one upcoming, and the undo re-insert path all behave unchanged
- The `today === null` placeholder ("Finding your local date…") still appears when the
  `tz` cookie is absent
- Removal animation timing is visually unchanged

---

## Phase 4: Risk #3 — Edit-Path Integrity

### Overview

Prove that editing a plant preserves every field it did not touch, and that next-due
is recalculated by the interval-delta rule. Correct the test plan's misstatement of
that rule.

### Changes Required:

#### 1. Correct the test plan

**File**: `context/foundation/test-plan.md`

**Intent**: `:80` states Risk #3's proof as recalculation "from the last actual
watering." The edit path shifts the stored previous due date by the interval delta and
never consults the journal (`src/lib/schedule.ts:19-37`); "from the last actual
watering" is `mark_watered`'s rule. A test written to the current wording would fail
correct code. §1 principle #3 makes research the ground truth when plan and code
disagree, so this is the documented resolution.

**Contract**: Amend the Risk #3 row in the §2 Risk Response Guidance table to state the
interval-delta rule, and stamp §8's freshness ledger so the edit is visible. Do not
regenerate the document.

#### 2. Full-record preservation tests

**File**: `src/actions/update-plant.integration.test.ts`

**Intent**: Catch the data-loss defect that lives in the fields you did *not* touch.
Assert the whole row after the write, not the field that changed.

**Contract**: For each edit shape — name only, one interval only, both intervals, name
plus both intervals — re-read the full `plants` row and assert every column. `id`,
`user_id` and `created_at` unchanged; `next_due_on` unchanged when the active-season
delta is zero; `photo_path` unchanged. `updated_at` is expected to move (the
`plants_set_updated_at` trigger fires on every update). No blank input can null a
column: `z.coerce.number().int().min(1).max(365)` and `min(1)` on name reject empties
server-side, and there is no empty-string→null transform anywhere in the path.

#### 3. Recalculation contract tests

**File**: same as above

**Intent**: Pin the interval-delta rule including the case a plausible "fix" would
break.

**Contract**: Assert `newNextDue === oldNextDue + (newActiveInterval − oldActiveInterval)`
using literal interval values, so the assertion is grounded independently of the
subtraction under test — the idiom established at `src/lib/schedule.test.ts:1-31`.
Include a case where the result lands **in the past**: no clamping is deliberate
(`context/archive/2026-07-25-edit-plant-and-recalc/plan.md:125-126` — clamping would
make the rule non-invertible), so a test asserting `newNextDue >= today` encodes the
wrong contract. Include a dormancy-season case, since the delta is computed from the
*active* interval for the action date.

#### 4. Photo intent tests

**File**: same as above

**Intent**: Prove the three intents differ in the way research documented — "keep"
must leave `photo_path` untouched rather than nulling it.

**Contract**: `keep` → `photo_path` byte-identical, no storage change. `replace` →
`photo_path` differs and the new object is retrievable. `remove` → `photo_path` is
`null`. Assert the storage object's retrievability, not the response code. Also cover
E5: a request carrying both `photo` and `removePhoto=true` resolves to "replace" —
unreachable from the UI, reachable by direct call, and currently silent. Register
every uploaded path with fixture cleanup; after each photo-intent case, assert the
pooled user's Storage folder is empty so keep and final replacement objects cannot
leak into later tests.

#### 5. Concurrency guard test

**File**: same as above

**Intent**: Pin the optimistic-concurrency behaviour, including that it is conditional.

**Contract**: A stale `updated_at` with a non-zero interval delta yields `CONFLICT`.
A name-only edit with a stale `updated_at` succeeds, because `.eq("updated_at", …)` is
attached only when `deltaDays !== 0` (`src/actions/index.ts:168-170`) — documented
accepted debt (E1), pinned so a future change to it is deliberate. The token must be
passed through as the verbatim string; deserializing it truncates to milliseconds and
makes the guard permanently conflict.

### Success Criteria:

#### Automated Verification:

- `pnpm test:integration` passes
- `pnpm test` still passes with the stack stopped
- `pnpm lint` and `pnpm check` pass
- The past-dated recalculation case passes, proving no clamping was introduced

#### Manual Verification:

- `context/foundation/test-plan.md` Risk #3 row now matches shipped behaviour, and §8
  records the amendment
- Editing a plant with a photo through the real UI still preserves the photo

---

## Phase 5: Risk #4 — Mutation Sequences and Consistency Vectors

### Overview

Prove the water / postpone / undo sequence leaves schedule and journal consistent, then
probe the five server-reachable inconsistency vectors. Genuine defects land as reviewed
skipped tests plus a follow-up change.

### Changes Required:

#### 1. Sequence tests

**File**: `src/actions/watering-sequence.integration.test.ts`

**Intent**: The defect lives in the sequence, not in the individual mutations —
test-plan §2 Risk #4 names this explicitly. Assert resulting state after each step.

**Contract**: Drive `water → undo → postpone → undo` and assert `plants.next_due_on`
and the full `watering_events` set after every step, matching the trace in research
§C.5. Key facts to pin: `mark_watered` sets `acted_on + activeInterval`; `postpone`
sets `acted_on + 2`, **not** `prev_due_on + 2`; undo restores `prev_due_on` and
hard-deletes the event row; after the second undo the journal is empty and the due date
is the original. Note in a comment that the journal *renders* `prev_due_on` while
`new_due_on` drives undo — a "journal agrees with schedule" assertion must read the
right one (`context/archive/2026-07-20-plant-detail-and-journal/reviews/impl-review.md:23-40`).

#### 2. Postpone contract and PRD divergence

**File**: same as above

**Intent**: Pin `acted_on + 2` and record — without arbitrating — that the PRD and UI
copy say something different.

**Contract**: An overdue plant postponed lands at `acted_on + 2`, which for an overdue
plant is *not* "2 days forward" from its due date. Assert postpone leaves both interval
columns untouched. A comment records the divergence: `prd.md:56` and `:141` say "moves
the task exactly 2 days forward"; the UI copy at
`src/components/today-list/utils.ts:16` follows the PRD wording. The behaviour was
deliberate (`context/archive/2026-07-23-postpone-and-undo/plan.md:34`). Flag it in this
plan's Open Risks for a product decision; do not change code or copy here.

#### 3. Undo semantics tests

**File**: same as above

**Intent**: Pin what undo does and — equally — what it deliberately does not do.

**Contract**: Undo identifies by explicit event id, never "the latest". A second undo
of the same event returns `NOT_FOUND` (`P0002`), not idempotent success and not a
double walk backwards (V8) — a caller retrying after a network timeout cannot
distinguish "already undone" from "never existed"; assert the observed contract.
**Do not write a server-side expiry test**: the ten-second window is a client
affordance and was explicitly specified as not a server rule
(`context/archive/2026-07-23-postpone-and-undo/plan.md:59, 102`).

#### 4. Consistency vectors V2 and V11

**File**: same as above

**Intent**: Two vectors that are surprising but arguably correct-as-designed — pin the
behaviour so a future change to it is deliberate.

**Contract**: **V2** — two postpones on the same day both yield `T+2`, and the second
writes a journal row with `prev_due_on === new_due_on`, a no-op entry the detail page
renders as "Due 30 Jul → 30 Jul". **V11** — neither RPC checks that a plant is
actually due, so a future-dated plant can be postponed *backwards* while the journal
labels it "Postponed". Both are assertions of current behaviour with a comment naming
why they are worth pinning.

#### 5. Defect vectors V1 and V3

**File**: same as above

**Intent**: Write the proofs for the two genuine defects, keep them out of the green
suite, and hand the follow-up change a reviewed assertion rather than a prose
description.

**Contract**: **V1** — two same-day postpones produce `E1{prev: D0, new: T+2}` and
`E2{prev: T+2, new: T+2}`; undoing E1 first passes undo's value-based currency guard
(`20260723120000:156`), sets the due date to `D0`, and deletes E1 — leaving E2
permanently un-undoable with `P0003` while claiming a transition that no longer holds.
The same collision occurs whenever `interval === 2`. **V3** — `updatePlant` moves
`next_due_on` with no journal row (`src/actions/index.ts:164`), so a pending undo then
fails `P0003` and the journal's last `new_due_on` no longer matches the plant.

Both are `test.skip` with a comment stating the defect, the expected correct behaviour,
and the follow-up change id. Open that change folder via `/10x-new` as part of this
phase so the id is real, not aspirational. The adversarial case behind V1 was named at
plan-review time and shipped anyway
(`context/archive/2026-07-23-postpone-and-undo/reviews/plan-review.md:27`) — the
follow-up should carry that context.

### Success Criteria:

#### Automated Verification:

- `pnpm test:integration` passes, with V1 and V3 reported as skipped rather than failing
- `pnpm test` still passes with the stack stopped
- `pnpm lint` and `pnpm check` pass
- Un-skipping V1 or V3 makes the suite fail, confirming the assertions are real

#### Manual Verification:

- A follow-up change folder exists with both defects described and the skipped tests
  referenced by path
- Each skipped test's comment states the expected correct behaviour, not just "broken"

---

## Phase 6: SQL Gate, Mutation Audit, and Cookbook

### Overview

Close the PL/pgSQL gap Stryker cannot reach, audit the new suite for tautological
assertions, and write down what shipped.

### Changes Required:

#### 1. Make the SQL suite runnable

**File**: `package.json`, `supabase/tests/season-aware-intervals.sql`

**Intent**: This script is the only executable proof of `postpone = +2`, undo
restoration, and cross-account `P0002` at the database layer — and nothing invokes it.
Its run instruction exists only as a comment on line 2. Stryker cannot mutate PL/pgSQL,
so this is the mutation-equivalent check for the business logic Phase 5's TypeScript
tests only reach through a thin error-mapping layer.

**Contract**: A `test:sql` script runs the `begin;`…`rollback;` file against the
deterministic local Supabase database:
`psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -f supabase/tests/season-aware-intervals.sql`.
The command owns its local connection string rather than relying on Vitest setup to
populate shell variables. `ON_ERROR_STOP=1` guarantees a non-zero exit on the first
failed assertion — per `context/foundation/lessons.md:19-24`, the status code is the
signal, not the output. Document it alongside `test:integration` as requiring
`pnpx supabase start`.

#### 2. Reconcile the season boundary table

**File**: `supabase/tests/season-aware-intervals.sql`, `src/lib/season.test.ts`

**Intent**: `src/lib/season.test.ts:7-11` contains a direct instruction to this phase:
reconcile the SQL script's dates against the authoritative TypeScript table "rather
than adding a third copy." The season rule is implemented twice in two languages
(V9), cross-referenced only by comments — the highest-value parity target Phase 1
deferred here.

**Contract**: Compare only dates supplied as the `acted_on` input to
`mark_watered` or `postpone_plant` against `SEASON_BOUNDARIES`. Expected due dates,
the `2000-01-01` fixture date, and restoration assertions are outputs or fixture state,
not season-dispatch inputs, and are excluded from the parity check. The SQL script
carries a comment pointing at `SEASON_BOUNDARIES` as the source of truth. Do not
duplicate the table into a third location; if the acted-on sets differ, the difference
is the finding.

#### 3. Narrowed unit-only mutation audit

**File**: `stryker.config.json` plus a run and a written finding

**Intent**: Detect the anti-pattern test-plan §2 names most often in unit tests — an
assertion whose expected value was lifted from the implementation under test. A
tautological assertion produces a survived mutant by construction. Stryker does not
run integration tests or require the Supabase stack.

**Contract**: Set Stryker's `testFiles` to
`["src/**/*.test.{ts,tsx}", "!src/**/*.integration.test.{ts,tsx}"]`, mirroring the
Vitest project convention without enumerating individual test paths. Narrow runs to
the unit-covered Risk #2/#3 modules identified by research:
`src/lib/schedule.ts:19-37` and the new `src/lib/due.ts`. Never run the unnarrowed
mutation glob, which reports near-zero noise. Keep `incremental: true` in
`stryker.config.json` for normal reruns. Execute the final audit as two independent
commands so each report has one explicit mutation scope:

- `pnpm test:mutants --mutate "src/lib/schedule.ts:19-37" --force`
- `pnpm test:mutants --mutate "src/lib/due.ts" --force`

`--force` runs every selected mutant and rebuilds the incremental report; do not use
the invalid valueless-flag form `--incremental false`. Review survivors one by one;
add an assertion only where the mutant represents a user-visible or business-relevant
bug. Do not chase 100%. Record which survivors were accepted and why — that record is
the deliverable.

**Caveat to state in the finding**: Action orchestration and integration tests are
outside the mutation run. The `+2` postpone constant, the season branch, and the undo
currency check live in PL/pgSQL and are invisible to Stryker. Their
mutation-equivalent check is the SQL script above.

#### 4. Cookbook

**File**: `context/foundation/test-plan.md`

**Intent**: Fill in §6.2 and §6.3 from what actually shipped, and mark Phase 2
complete in §3.

**Contract**: §6.2 documents the harness — how to start the stack, the fixture
entry points, the per-test user pattern, why in-process invocation was chosen and what
it skips. §6.3 documents asserting a mutation's *resulting state* rather than its
response code, and the multi-step sequence form. Update the §3 rollout table's Phase 2
Status. Note in §6.2 that the `astro:actions` shim is coupled to Astro internals.

### Success Criteria:

#### Automated Verification:

- `pnpm test:sql` passes and exits non-zero when an assertion is broken
- `pnpm test` and `pnpm test:integration` pass
- `pnpm lint` and `pnpm check` pass
- Every SQL `acted_on` input appears in `SEASON_BOUNDARIES`

#### Manual Verification:

- The Stryker survivor review is written down with an accept/fix decision per survivor
- §6.2 and §6.3 are specific enough that a contributor can add an integration test
  without re-reading this plan
- §3 Phase 2 Status reads complete and Phase 3 is unblocked

---

## Testing Strategy

This phase's deliverable *is* tests, so the strategy question is how we know the tests
themselves are honest. Three anti-patterns this repo has already caught, used as review
criteria for every test written here:

1. **A guarded branch that is unreachable** — the seed never crossed the boundary, so
   the protective branch could not fire
   (`context/archive/2026-07-26-today-acquisition-defects/reviews/impl-review-phase-1.md:41-67`).
   Every test must be shown to fail when deliberately broken.
2. **A pass-through seam that asserts nothing** — a test named for a behaviour that
   only called a pure function twice, and would pass against the wrong implementation
   (`.../impl-review-phase-1.md:69-106`).
3. **A field never asserted, so any value survives** — the reason Risk #3's tests
   assert the full row rather than the edited field.

### Unit Tests:

- `src/lib/due.ts` boundaries: due today, overdue by 1, overdue by 30, due tomorrow,
  year boundary — asserting the returned set, not its length.

### Integration Tests:

- The production `loadTodayPlants` server loader returns the full unfiltered,
  correctly ordered set and feeds the due derivation (Risk #2).
- Edit → full re-read across every edit shape and all three photo intents (Risk #3).
- `water → undo → postpone → undo` with state and journal asserted at each step, plus
  V2, V8 and V11 pinned and V1, V3 skipped (Risk #4).

### Manual Testing Steps:

1. Stop Docker, run `pnpm test` — green. Commit an unrelated file — hook passes.
2. Start the stack, run `pnpm test:integration` twice — green both times.
3. Break one assertion in each new test file — each fails.
4. Exercise the daily list in the browser after the Phase 3 refactor: a due plant, an
   overdue plant, an upcoming plant, mark-watered with undo, and the cookie-less
   "Finding your local date…" state.

## Performance Considerations

Database round trips make this suite materially slower than Phase 1's units. Two
mitigations are structural rather than tuning: two integration workers retain file
parallelism while a worker-scoped session pool bounds Auth calls, and keeping
integration in a separate Vitest project means the fast unit suite still gates the
pre-commit hook. Vitest's default 5000 ms `testTimeout` is too low for round trips and
is raised in the integration project only.

`supabase/config.toml:189` permits 30 sign-ins per 5 minutes per IP. Two workers with
two lazy slots each perform at most four sign-ins per run and eight across the required
back-to-back runs. If a future test needs more accounts, add an explicit pool slot and
recalculate that bound rather than minting users per test or changing Auth config.

## Migration Notes

No schema migration in this phase. `globalSetup` uses prefix-scoped `DELETE`, never
`TRUNCATE`, so it does not remove `supabase/seed.sql`'s fixed user
(`a7c29f41-…-d9e215c70401`) that the dev workflow and `README.md` depend on.

## References

- Research: `context/changes/testing-task-list-and-mutation-integrity/research.md`
- Test plan: `context/foundation/test-plan.md` §2 (Risks #2/#3/#4), §3 Phase 2, §6, §7
- Lessons: `context/foundation/lessons.md` — helper extraction, seed alignment,
  status codes, `describe` naming
- Phase 1 precedent: `context/archive/2026-07-26-testing-runner-and-calendar-math/`
- Risk #3 design of record: `context/archive/2026-07-25-edit-plant-and-recalc/`
- Risk #4 design of record: `context/archive/2026-07-23-postpone-and-undo/`
- `src/lib/schedule.test.ts:1-31` — the table-driven idiom to follow
- `supabase/seed.sql:9-71` — the confirmed-user insert pattern to reuse

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Runner Split and Module Shims

#### Automated

- [x] 1.1 `pnpm test` passes with the Supabase stack stopped — b708f3c
- [x] 1.2 `pnpm lint` passes with `--max-warnings=0` — b708f3c
- [x] 1.3 `pnpm check` passes — b708f3c
- [x] 1.4 A throwaway integration test importing `src/actions/index.ts` resolves both virtual modules without error (retained as a permanent shim regression guard) — b708f3c
- [x] 1.7 `pnpm test:mutants --mutate "src/lib/season.ts" --force` exits 0 (multi-project config resolves without `--project`) — b708f3c

#### Manual

- [x] 1.5 Committing an unrelated `.ts` file with Docker stopped completes the pre-commit hook — b708f3c
- [x] 1.6 The shim comment explaining the Astro-internal coupling is present and accurate — b708f3c

### Phase 2: Fixture Layer

#### Automated

- [x] 2.1 `pnpm test:integration` passes with the stack running — f7db49e
- [x] 2.2 `pnpm test` still passes with the stack stopped — f7db49e
- [x] 2.3 The unauthenticated case yields `UNAUTHORIZED`, not a successful write — f7db49e
- [x] 2.4 `pnpm lint` and `pnpm check` pass — f7db49e

#### Manual

- [x] 2.5 Running the integration suite twice in a row passes both times (idempotent fixtures) — f7db49e
- [x] 2.6 Deliberately breaking an assertion makes the test fail, confirming it executes — f7db49e
- [x] 2.7 `auth.users` does not accumulate unbounded across repeated runs — f7db49e
- [x] 2.8 No Storage objects owned by namespaced test users remain after the suite — f7db49e

### Phase 3: Risk #2 — Extract and Prove the Due Derivation

#### Automated

- [x] 3.1 `pnpm test` passes — new unit tests green, existing suite unaffected — a386f55
- [x] 3.2 `pnpm test:integration` passes — a386f55
- [x] 3.3 `pnpm lint` and `pnpm check` pass — a386f55
- [x] 3.4 No `next_due_on` comparison remains inline in `today-list.tsx` — a386f55

#### Manual

- [x] 3.5 The daily list renders identically before and after the refactor: a plant due today, one overdue, one upcoming, and the undo re-insert path all behave unchanged — a386f55
- [x] 3.6 The `today === null` placeholder ("Finding your local date…") still appears when the `tz` cookie is absent — a386f55
- [x] 3.7 Removal animation timing is visually unchanged — a386f55

### Phase 4: Risk #3 — Edit-Path Integrity

#### Automated

- [x] 4.1 `pnpm test:integration` passes — d40f5c0
- [x] 4.2 `pnpm test` still passes with the stack stopped — d40f5c0
- [x] 4.3 `pnpm lint` and `pnpm check` pass — d40f5c0
- [x] 4.4 The past-dated recalculation case passes, proving no clamping was introduced — d40f5c0

#### Manual

- [x] 4.5 `context/foundation/test-plan.md` Risk #3 row now matches shipped behaviour, and §8 records the amendment — d40f5c0
- [x] 4.6 Editing a plant with a photo through the real UI still preserves the photo — d40f5c0

### Phase 5: Risk #4 — Mutation Sequences and Consistency Vectors

#### Automated

- [ ] 5.1 `pnpm test:integration` passes, with V1 and V3 reported as skipped rather than failing
- [ ] 5.2 `pnpm test` still passes with the stack stopped
- [ ] 5.3 `pnpm lint` and `pnpm check` pass
- [ ] 5.4 Un-skipping V1 or V3 makes the suite fail, confirming the assertions are real

#### Manual

- [ ] 5.5 A follow-up change folder exists with both defects described and the skipped tests referenced by path
- [ ] 5.6 Each skipped test's comment states the expected correct behaviour, not just "broken"

### Phase 6: SQL Gate, Mutation Audit, and Cookbook

#### Automated

- [ ] 6.1 `pnpm test:sql` passes and exits non-zero when an assertion is broken
- [ ] 6.2 `pnpm test` and `pnpm test:integration` pass
- [ ] 6.3 `pnpm lint` and `pnpm check` pass
- [ ] 6.4 Every SQL `acted_on` input appears in `SEASON_BOUNDARIES`

#### Manual

- [ ] 6.5 The Stryker survivor review is written down with an accept/fix decision per survivor
- [ ] 6.6 §6.2 and §6.3 are specific enough that a contributor can add an integration test without re-reading this plan
- [ ] 6.7 §3 Phase 2 Status reads complete and Phase 3 is unblocked
