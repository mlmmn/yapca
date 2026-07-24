# Season-Aware Intervals Implementation Plan

## Overview

Deliver roadmap slice **S-05** (FR-008 and FR-015): every plant carries separate growing- and dormancy-season watering intervals, and YAPCA automatically selects the correct interval from the user's calendar date. Growing season is fixed application-wide from **March 1 through October 31, inclusive**; dormancy covers November 1 through February's final day.

The feature extends the existing deterministic loop rather than replacing it. A due date is materialized when a schedule is created: adding an already-watered plant or marking a plant Watered uses the season active on that browser-local action date. Crossing a season boundary never silently rewrites an outstanding due date.

## Current State Analysis

- `public.plants` stores one constrained `interval_days` and one materialized `next_due_on`; its owner-scoped RLS policies and `(user_id, next_due_on)` index already support the required access and Today-query model (`supabase/migrations/20260719120000_create_plants.sql:4`).
- The add flow accepts one interval. When the user says the plant was watered today, the action computes `clientDate + interval_days` before inserting (`src/actions/index.ts:32`, `src/components/add-plant-form.tsx:18`).
- Watered is authoritative in the row-locking `mark_watered` RPC. It validates ownership, reads the interval and current due date under lock, updates the plant, records the journal event, and returns the exact result atomically (`supabase/migrations/20260723120000_add_postpone_and_undo.sql:16`).
- Postpone always schedules from the action date plus two days, while Undo restores a stored prior due date. Neither operation needs to select a seasonal interval (`supabase/migrations/20260723120000_add_postpone_and_undo.sql:66`, `supabase/migrations/20260723120000_add_postpone_and_undo.sql:115`).
- Today, All plants, and plant detail select and render the single interval through `PlantListItem` or a page-local detail type (`src/components/authed-shell.astro:17`, `src/pages/plants/index.astro:18`, `src/pages/plants/[id].astro:11`, `src/types.ts:45`).
- Today already establishes the correct calendar authority: it hydrates with the browser-local date and reschedules its date state at local midnight (`src/components/today-list/today-list.tsx:241`). Static Astro pages cannot know that date reliably at SSR time.
- No automated test runner exists. Established gates are local Supabase reset/type generation, Astro check, lint, and the Cloudflare production build (`package.json:6`).

## Desired End State

1. A user creates a plant with independent growing- and dormancy-season intervals, each an integer from 1 to 365 days.
2. The add-flow preview and initial due date use the interval active on the browser-local creation date.
3. Marking Watered uses the season active on `p_acted_on`, then atomically schedules `acted_on + selected interval` and records the unchanged journal contract.
4. March 1 and October 31 select the growing interval; November 1 through February's final day select the dormancy interval, including leap years and year wrapping.
5. Existing plants migrate without behavior changes: the former interval is copied into both new fields, and existing `next_due_on` values and watering events remain unchanged.
6. Today and All plants show the active season and active interval compactly. Plant detail shows both intervals and identifies the browser-locally active one.
7. Crossing a season boundary changes active-season presentation and the interval used by the next schedule-creating action, but does not alter an already stored due date.

Verified when an unequal-interval fixture is watered on both sides of each boundary and the RPC returns the exact expected due date; Postpone and Undo still preserve their established behavior; migrated plants retain their prior schedules; and all three UI surfaces communicate the active schedule using the browser-local date.

### Key Discoveries:

- The PRD makes the Watered action date—not the previous due date or server clock—the scheduling anchor (`context/foundation/prd.md:107`, `context/foundation/prd.md:137`).
- The materialized `next_due_on` and stored journal before/after dates make select-at-action behavior compatible with deterministic Undo; read-time schedule rewriting would break that invariant (`context/changes/postpone-and-undo/plan.md:22`).
- `PRODUCT.md` defines season as ambient rather than a user setting, supporting fixed application-wide boundaries and contextual disclosure instead of settings UI (`PRODUCT.md:41`).
- Reusable season logic belongs in `src/lib/`, and the local seed must change with the schema (`context/foundation/lessons.md:5`, `context/foundation/lessons.md:12`).
- The current bare add-form component predates the repository's component-folder rule. Because this change modifies it materially, it must move into its own folder with a barrel.

## What We're NOT Doing

- No user-configurable or per-plant season boundaries, hemisphere setting, climate model, species recommendations, or weather-driven cadence.
- No automatic rewrite of an existing `next_due_on` at a season boundary and no cron, background job, or read-triggered mutation.
- No plant-editing workflow or recalculation after interval edits; that remains S-06, which will inherit both seasonal fields.
- No changes to Postpone duration, Undo semantics, journal columns, historical events, or future-task visibility.
- No season snapshot on watering events; exact before/after dates remain the persisted evidence.
- No new Vitest, Playwright, pgTAP, or other test framework. Database behavior is checked with a repeatable local SQL verification script plus existing project gates.
- No broad component or formatting cleanup beyond files necessarily touched by this feature.
- No global ESLint or Prettier configuration changes.

## Implementation Approach

Evolve `plants` through a compatibility migration: add the two seasonal interval columns, copy the existing value into both, apply independent 1–365 constraints, then remove the singular column without touching current due dates. Replace `mark_watered` in the same migration so its existing authenticated, ownership-checked, row-locking transaction selects the interval from `p_acted_on`. Preserve its parameters, result shape, SQLSTATE behavior, journal insert, and explicit grant posture.

Model the fixed season rule once for application code in a shared `src/lib/season.ts` module and mirror the same inclusive month boundaries inside the database mutation. The client date remains the schedule-creation authority. Static Astro views use a reusable season-summary component whose bundled client enhancement applies the local date and updates after local midnight; Today reuses the same helper inside its existing hydrated lifecycle.

Keep interval validation independent: either seasonal value may be 1–365, with no rule requiring dormancy to be longer. Existing plants receive equal values during migration; new-form defaults also begin equal so the product never invents plant-care advice.

## Critical Implementation Details

### Timing & lifecycle

Season selection happens exactly when a due date is created: add-after-watered and Watered use their validated browser-local date. A local-midnight season transition updates active labels, but an already materialized `next_due_on` remains unchanged until the next Watered action.

### State sequencing

`mark_watered` must retain its current ownership check and `FOR UPDATE` lock before selecting the seasonal interval, updating `plants`, and inserting `watering_events` in one transaction. Postpone and Undo continue to operate only on stored due dates and must not call seasonal logic.

### User experience spec

Today and All plants use a compact `Growing · Every N days` or `Dormancy · Every N days` label. Plant detail lists both schedules and marks the active one with text/semantics, not color alone; boundary copy names the fixed March–October and November–February ranges where it helps users understand the rule.

## Phase 1: Seasonal Scheduling Foundation

### Overview

Establish the data contract and authoritative scheduling behavior while preserving every existing plant's current schedule, event history, RLS boundary, and mutation semantics.

### Changes Required:

#### 1. Compatible seasonal-interval migration

**File**: `supabase/migrations/<timestamp>_add_season_aware_intervals.sql`

**Intent**: Replace the singular plant interval with independently constrained growing and dormancy intervals without inventing existing-user preferences or changing already scheduled work.

**Contract**: Add `growing_interval_days int` and `dormancy_interval_days int`; backfill each from `interval_days`; make both non-null with independent 1–365 check constraints; then drop `interval_days`. Leave `next_due_on`, indexes, ownership columns, and the four existing granular `plants` RLS policies intact. The migration must be valid for populated databases and must not recalculate plants or historical events.

#### 2. Season-aware Watered RPC

**File**: `supabase/migrations/<timestamp>_add_season_aware_intervals.sql`

**Intent**: Make the database mutation boundary choose the interval active on the action date while retaining the concurrency, access-control, journaling, and Undo guarantees already shipped.

**Contract**: Replace `public.mark_watered(p_plant_id uuid, p_acted_on date)` without changing its arguments or returned event row. Its locked plant read selects both interval fields and `next_due_on`; March 1 through October 31 uses `growing_interval_days`, otherwise `dormancy_interval_days`; `new_due_on` remains `p_acted_on + selected interval`. Preserve `SECURITY DEFINER`, empty `search_path`, explicit `auth.uid()` and ownership checks, `P0002` not-found behavior, `FOR UPDATE`, atomic plant update/event insert, revokes from `public`/`anon`, and execute grant only to `authenticated`.

#### 3. Shared application season contract

**File**: `src/lib/season.ts`

**Intent**: Give all TypeScript consumers one calendar-exact rule for season labels and interval selection instead of duplicating component-local comparisons.

**Contract**: Export a shared `"growing" | "dormancy"` type plus verb-led helpers that accept a validated `YYYY-MM-DD` calendar date, classify March 1–October 31 inclusively, select the corresponding interval, and return human labels. Invalid dates fail explicitly rather than silently falling into dormancy. Reuse `src/lib/date.ts` validation/epoch-day primitives where applicable; do not construct timezone-sensitive instants for season classification.

**Module placement**: `src/lib/` already holds `date.ts` (calendar primitives) and `interval.ts`, whose `nextDue(fromDate, intervalDays)` at `src/lib/interval.ts:7` is the existing due-date arithmetic and which re-exports `isValidDateString`. Season classification is a new concern and belongs in `season.ts`; interval *arithmetic* stays in `interval.ts`. Consumers import `nextDue` from `@/lib/interval` — do not reimplement it, per `context/foundation/lessons.md:5`.

#### 4. Seed, generated types, and domain types

**Files**:

- `supabase/seed.sql`
- `src/lib/database.types.ts`
- `src/types.ts`

**Intent**: Align local fixtures and compile-time contracts with the migrated schema.

**Contract**: Seed each sample plant with both interval fields, including at least one unequal pair useful for local verification. Regenerate `database.types.ts` from the local database rather than editing it by hand. Replace singular interval fields in `AddPlantInput`, `PlantListItem`, and other touched plant projections; keep Watered/Postpone/Undo output contracts unchanged.

#### 5. Compile-level consumer sweep

**Files**:

- `src/actions/index.ts`
- `src/components/add-plant-form.tsx`
- `src/components/authed-shell.astro`
- `src/pages/plants/index.astro`
- `src/pages/plants/[id].astro`
- `src/components/today-list/today-list.tsx`

**Intent**: Keep the repository type-checking, linting, and building at the end of this phase. Dropping `interval_days` and regenerating `database.types.ts` breaks every remaining reader of the singular field, so the phase that removes the column must also carry its consumers.

**Contract**: Mechanically migrate each singular reference to the seasonal pair — typed `.select(…)` column lists, projection mappings, the `addPlant` input schema and insert, and the form's submitted field. Where a surface currently renders one interval label, render the interval selected by `src/lib/season.ts` from the browser-local date on the surfaces that already have one (`today-list.tsx`), and from the stored pair on the static surfaces pending Phase 3. This is a compile-and-parity sweep only: no new copy, layout, season labels, or form fields — those are Phases 2 and 3. Behavior for existing plants is unchanged because migration gives both fields equal values.

#### 6. Repeatable database boundary verification

**File**: `supabase/tests/season-aware-intervals.sql`

**Intent**: Verify the correctness-critical database behavior without introducing a test framework.

**Contract**: Provide a transaction-scoped local SQL script that creates isolated fixtures and fails on incorrect results. Cover February's final day (including leap year), March 1, October 31, November 1, and year wrapping with unequal intervals. Assert exact Watered due dates and journal before/after values, unchanged Postpone `+2`, exact Undo restoration, and ownership rejection for a second account. Roll back its fixtures so repeated runs are safe. Verify populated-table backfill separately by rehearsing the migration as described below; a post-migration fixture cannot prove that transition.

**Session impersonation**: The three RPCs are `SECURITY DEFINER` and raise `28000` when `auth.uid()` is null, so a plain `postgres` psql session fails every assertion before reaching a boundary. Each RPC call must therefore run under an impersonated session: `set local role authenticated` plus `set local request.jwt.claims` carrying the fixture user's `sub`, reset to `postgres` for fixture setup and teardown. The cross-account case must assert the specific `P0002` not-found SQLSTATE under the *second* user's claims — an unauthenticated `28000` would pass for the wrong reason and prove nothing about ownership.

### Success Criteria:

#### Automated Verification:

- Local database reset applies all migrations and the aligned seed cleanly: `pnpx supabase db reset`
- Database boundary and ownership verification passes: `psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -f supabase/tests/season-aware-intervals.sql`
- Generated Supabase types match the migrated local schema: `pnpx supabase gen types typescript --local > src/lib/database.types.ts`, then `git diff --exit-code src/lib/database.types.ts` after committing the regenerated file
- Astro type checking passes: `pnpm exec astro check`
- Linting passes: `pnpm lint`
- Cloudflare production build passes: `pnpm build`

#### Manual Verification:

- On a populated pre-migration local database, recorded fixture due dates survive `supabase migration up`, and both new intervals equal the former value
- A Watered event still contains the exact prior and resulting due dates, while Postpone and Undo retain their established contracts

**Implementation Note**: After completing this phase and all automated verification passes, pause for human confirmation that the local migration, backfill, RPC, and security behavior are correct before proceeding.

---

## Phase 2: Season-Aware Plant Creation

### Overview

Collect both intervals in the add flow and use the current browser-local season consistently in the preview and initial due-date calculation.

### Changes Required:

#### 1. Add-form component-folder alignment

**Files**:

- `src/components/add-plant-form/add-plant-form.tsx`
- `src/components/add-plant-form/index.ts`
- `src/pages/plants/new.astro`
- removed legacy module `src/components/add-plant-form.tsx`

**Intent**: Bring the necessarily modified add form under the repository's one-folder-per-component contract without changing its page-level integration.

**Contract**: Move the single React component into its kebab-case folder and expose it through the barrel. Keep component-only schema/constants together in the folder as appropriate, preserve one component export per module, and align touched code with hook/function/void-hook/return ordering, top-of-block declarations, verb-led callable names, and non-verb value names.

#### 2. Two-interval form and active preview

**File**: `src/components/add-plant-form/add-plant-form.tsx`

**Intent**: Let the user enter explicit growing and dormancy cadences while making the automatic boundary rule understandable at creation time.

**Contract**: Replace `intervalDays` with independent `growingIntervalDays` and `dormancyIntervalDays` number fields, each required as an integer from 1 to 365 and defaulting to 7. Label them “Growing season” and “Dormancy season,” with concise March–October and November–February descriptions. The existing first-appearance subscription uses the browser-local date and shared season selector so “After N days” reflects the active interval and names the active season. Preserve photo handling, errors, keyboard behavior, responsive layout, and the exact “today” versus “already watered” meaning.

#### 3. Server validation and initial scheduling

**File**: `src/actions/index.ts`

**Intent**: Validate both values at the trusted boundary and store a due date computed from the same season contract shown in the form.

**Contract**: `addPlant` accepts `growing_interval_days` and `dormancy_interval_days`, independently coerced and constrained to integer 1–365. When `alreadyWatered` is true, select the active interval from validated `clientDate` through `src/lib/season.ts`, then reuse `nextDue`; otherwise preserve the current behavior of making the plant due on `clientDate`. Insert both fields under the existing owner-scoped RLS path and preserve photo cleanup/error handling.

### Success Criteria:

#### Automated Verification:

- Astro type checking passes: `pnpm exec astro check`
- Linting passes: `pnpm lint`
- Cloudflare production build passes: `pnpm build`

#### Manual Verification:

- The add form clearly accepts and validates two independent 1–365 day intervals with understandable fixed-season descriptions
- “After N days” uses and names the browser-locally active interval; “Today” remains due today
- Saving a plant persists both values, and an already-watered plant receives the exact active interval's due date
- Photo upload, validation failures, keyboard operation, mobile layout, dark mode, and reduced motion do not regress

**Implementation Note**: After completing this phase and all automated verification passes, pause for human confirmation that creation and its active-season preview work correctly before proceeding.

---

## Phase 3: Active-Season Schedule Presentation

### Overview

Make the automatic rule transparent on Today, All plants, and plant detail without adding clutter or trusting a Worker-side calendar date.

### Changes Required:

#### 1. Seasonal plant projections

**Files**:

- `src/components/authed-shell.astro`
- `src/pages/plants/index.astro`
- `src/pages/plants/[id].astro`
- `src/types.ts`

**Intent**: Carry both seasonal intervals to every existing schedule display while preserving owner-scoped queries, ordering, photo signing, and due-date behavior.

**Contract**: Replace singular interval selections/mappings with both seasonal fields. `PlantListItem` and the detail projection expose the two interval values; no query computes or rewrites `next_due_on`. Keep Today ordered by stored due date/name, All plants ordered by name, and detail journal loading unchanged.

#### 2. Reusable local-season summary

**Files**:

- `src/components/season-interval-summary/season-interval-summary.astro`
- `src/components/season-interval-summary/index.ts`

**Intent**: Give static Astro surfaces browser-local season presentation without turning each plant row into a React island or deriving the season from the Worker clock.

**Contract**: Add one reusable Astro component with active-only and full-schedule modes. Its bundled client enhancement uses `src/lib/season.ts`, updates every rendered summary from the browser-local date, and schedules a refresh for the next local midnight. Active-only mode renders `Growing · Every N days` or `Dormancy · Every N days`; full mode renders both intervals and marks the active one with explicit text or accessible semantics rather than color alone. Provide meaningful no-JavaScript schedule information without asserting a potentially wrong active season.

**Server fallback and shift budget**: The server cannot render an active-only label, so it renders the truthful pair (`Growing 7 d · Dormancy 30 d`) into a fixed-height slot carrying both intervals as data attributes; the enhancement replaces that slot's text with the active summary, never its box. This satisfies the no-JavaScript requirement without asserting a season, keeps reflow to zero on every row, and reuses one markup shape for both the active-only and full-schedule modes. Verify the denser no-JavaScript pair at 320px as part of criterion 3.8.

**One calendar authority per surface**: The component also owns the adjacent due label. `src/pages/plants/index.astro:54` and `src/pages/plants/[id].astro:74` currently derive `today` from `todayLocalDateString()` at SSR — that is the Worker clock (UTC on Cloudflare), not the user's date — and pass it to `formatDueLabel`. Rendering a browser-local season beside a Worker-local due label would put two disagreeing calendars on one line: at UTC+13 on the morning of March 1 the row would read `Growing · Every 7 days · Due 28 Feb`. The enhancement therefore recomputes `formatDueLabel` from the same browser-local date it uses for the season, on the same midnight schedule. The server-rendered due label remains the exact `Due <date>` form, which is never wrong without JavaScript — only never `Due today`.

This is deliberately an interim measure. Roadmap slice **S-08 (`user-timezone-dates`)** makes the user's timezone the server-side calendar authority via `context.locals.today`, which fixes the class of bug rather than these two call sites; when it lands, the due-label handling here is removed and the enhancement goes back to owning only the season.

#### 3. Today active schedule metadata

**File**: `src/components/today-list/today-list.tsx`

**Intent**: Show which automatic cadence applies at the daily decision point while preserving urgency, optimistic actions, focus, and list performance.

**Contract**: Use the component's existing browser-local `today` state and the shared season helpers to replace the singular interval label with the active season and interval. Both due-today and overdue rows use the same schedule metadata; overdue icon/label/color semantics remain unchanged. The existing local-midnight timer naturally refreshes the label without changing stored due dates or refetching the list.

#### 4. All-plants and detail disclosure

**Files**:

- `src/pages/plants/index.astro`
- `src/pages/plants/[id].astro`

**Intent**: Keep collection scanning compact while making each plant's full seasonal configuration inspectable.

**Contract**: All plants uses the active-only summary beside the exact due label. Plant detail uses full-schedule mode, shows both named intervals, and identifies the active one; its exact due date and journal remain unchanged. Do not use decorative seasonal imagery or color-only state, and do not introduce vague schedule wording.

**What the interval number means**: Because the season is selected when a due date is created, an outstanding `next_due_on` can predate the current season — a plant watered October 25 on a 7-day growing interval is due November 1, when dormancy is already active. The label must not imply the stored due date came from the interval it names. Word it as the cadence that applies from the next watering (`Dormancy · then every 30 days`), keep the exact due date unqualified beside it, and state the rule once in plain words in plant detail's full-schedule mode rather than repeating it per row. Check the wording at 320px alongside the due label.

### Success Criteria:

#### Automated Verification:

- Astro type checking passes: `pnpm exec astro check`
- Linting passes: `pnpm lint`
- Cloudflare production build passes: `pnpm build`

#### Manual Verification:

- Today and All plants show the correct browser-local active season and interval without changing due-list membership
- Plant detail shows both intervals and identifies the active one without relying on color alone
- Local-midnight rollover refreshes active labels, including October 31→November 1 and February's final day→March 1, without rewriting `next_due_on`
- Due dates, overdue urgency, Watered, Postpone, Undo, journal rendering, and All-plants ordering do not regress
- Schedule summaries remain legible at 320px and 200% zoom, with keyboard navigation, screen reader output, dark mode, and JavaScript-disabled fallback checked
- A plant whose stored due date was created in the previous season reads unambiguously: the named interval is understood as the next watering's cadence, not as the source of the displayed due date

**Implementation Note**: After completing this phase and all automated verification passes, pause for final human confirmation that the full seasonal scheduling flow and presentation matrix succeeded.

---

## Testing Strategy

### Database Verification:

- Reset the local database to prove the migration and seed work from a clean baseline.
- Run the transaction-scoped SQL verification script against the local Postgres instance.
- Cover both inclusive boundaries, leap day, year wrapping, unequal intervals, journal values, Postpone, Undo, and cross-account ownership.
- Regenerate Supabase types and compare them with the committed file.

### Static Project Gates:

- Run `pnpm exec astro check`, `pnpm lint`, and `pnpm build` after each phase.
- Do not add a JavaScript or browser test framework in this change.

### Manual Testing Steps:

1. Reset local Supabase and sign in with the seeded account.
2. Confirm migrated plants retain their exact due dates and have equal growing/dormancy values.
3. Add a plant with unequal intervals and both first-appearance choices; inspect the persisted values and due date.
4. Confirm the form preview, Today, and All plants agree on the current browser-local season and interval.
5. Open plant detail and confirm both schedules appear, with the same active season identified.
6. Mark the unequal-interval plant Watered; compare the toast, plant row, journal event, and stored `next_due_on`.
7. Postpone and Undo the same plant; confirm their date behavior is unchanged and no interval field changes.
8. Exercise or simulate the local calendar around February's final day/March 1 and October 31/November 1; confirm labels change while existing due dates do not.
9. Repeat the presentation checks at 320px, 200% zoom, keyboard-only, screen reader, dark mode, reduced motion, and with JavaScript disabled.
10. Use a second account to confirm another user's seasonal fields and mutation results remain inaccessible.

## Performance Considerations

- The database retains one indexed, materialized `next_due_on`; Today does not compute schedules for filtering or trigger season-boundary writes.
- `mark_watered` remains one RPC and one locked row-level transaction.
- All plants and detail use one deduplicated bundled enhancement rather than one hydrated React island per row.
- Season selection is constant-time calendar comparison. Collections remain in the expected dozens-of-plants range, so no cache or virtualization is required.
- Avoid a Worker-derived active label in the initial HTML. The progressive enhancement must minimize layout shift while retaining truthful no-JavaScript fallback content.

## Migration Notes

- Backfill both new interval columns from `interval_days` before applying non-null constraints or removing the old column.
- Before the clean reset, rehearse `supabase migration up` against a disposable local database that is current through `20260723120000_add_postpone_and_undo.sql`: record a fixture's `interval_days` and `next_due_on`, apply the new migration, then compare both seasonal values and the unchanged due date. The later clean reset verifies full-history reproducibility but cannot by itself prove a populated-table backfill because the seed runs after all migrations.
- Do not update `next_due_on` or `watering_events`; their exact persisted values remain authoritative.
- Existing RLS policies continue to cover the new columns because ownership stays row-based and no new table is introduced.
- Replacing `mark_watered` must repeat explicit revoke/grant statements and retain its hardened empty `search_path`.
- Rollback after users have saved distinct seasonal intervals is lossy because the singular schema cannot preserve both. Before production deployment, take the normal database backup; after seasonal data exists, prefer a forward fix. If rollback is unavoidable, choose and document which interval collapses into `interval_days` before running it.
- S-06 edit/recalculation must operate on both new fields and separately define how an edit affects the currently materialized due date.
- `context/foundation/prd.md:164` still records the season-boundary question as open ("owner: user; blocks correct interval selection once implemented"). This change settles it — fixed application-wide, growing March 1 through October 31 inclusive. Record that resolution in the PRD once Phase 1 lands.

## References

- Product requirements: `context/foundation/prd.md:83`
- Roadmap slice and dependency note: `context/foundation/roadmap.md:132`
- Product season principle: `PRODUCT.md:41`
- Visual and accessibility system: `DESIGN.md:101`
- Shared-helper and seed lessons: `context/foundation/lessons.md:5`
- Current plant schema/RLS: `supabase/migrations/20260719120000_create_plants.sql:4`
- Current atomic mutation functions: `supabase/migrations/20260723120000_add_postpone_and_undo.sql:16`
- Existing browser-local lifecycle: `src/components/today-list/today-list.tsx:241`
- Prior mutation/Undo plan: `context/changes/postpone-and-undo/plan.md:20`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `.agents/skills/10x-plan/references/progress-format.md`.

### Phase 1: Seasonal Scheduling Foundation

#### Automated

- [x] 1.1 Local database reset applies all migrations and the aligned seed cleanly — aa3ae30
- [x] 1.2 Database boundary and ownership verification passes — aa3ae30
- [x] 1.3 Generated Supabase types match the migrated local schema — aa3ae30
- [x] 1.4 Astro type checking passes — aa3ae30
- [x] 1.5 Linting passes — aa3ae30
- [x] 1.6 Cloudflare production build passes — aa3ae30

#### Manual

- [ ] 1.7 Migrated fixtures retain their prior due date and receive equal seasonal intervals
- [ ] 1.8 Watered, Postpone, and Undo retain exact journal and schedule contracts

### Phase 2: Season-Aware Plant Creation

#### Automated

- [x] 2.1 Astro type checking passes — 728b94d
- [x] 2.2 Linting passes — 728b94d
- [x] 2.3 Cloudflare production build passes — 728b94d

#### Manual

- [x] 2.4 Add form accepts and validates two independent seasonal intervals — 728b94d
- [x] 2.5 First-appearance preview selects and names the browser-local active season — 728b94d
- [x] 2.6 Saving persists both intervals and the exact initial due date — 728b94d
- [x] 2.7 Photo, error, keyboard, responsive, theme, and motion behavior does not regress — 728b94d

### Phase 3: Active-Season Schedule Presentation

#### Automated

- [x] 3.1 Astro type checking passes
- [x] 3.2 Linting passes
- [x] 3.3 Cloudflare production build passes

#### Manual

- [x] 3.4 Today and All plants show the correct browser-local active schedule without changing membership
- [x] 3.5 Plant detail shows both intervals and identifies the active one accessibly
- [x] 3.6 Local-midnight boundary rollover updates labels without rewriting due dates
- [x] 3.7 Due dates, urgency, mutations, journal, and ordering do not regress
- [x] 3.8 Schedule summaries pass responsive, zoom, keyboard, screen-reader, theme, and no-JavaScript checks
- [x] 3.9 A due date created in the previous season reads unambiguously against the active-season label
