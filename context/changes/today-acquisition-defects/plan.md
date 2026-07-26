# Today Acquisition Defects Implementation Plan

## Overview

Keep Astro SSR and remove split ownership of the user's calendar day. SSR may provide a useful first-render seed from the timezone cookie or Cloudflare geolocation, but the browser becomes authoritative after hydration and supplies a fresh, plausibility-checked date to every dated mutation.

This resolves the frozen form date (D-1), UTC mutation fallback (D-2), unsafe unknown-date Today list (D-3), and ineffective reload guard (D-4) without the roughly 30-item static/SPA migration documented in the research.

## Current State Analysis

`today` is currently resolved independently at request time, during the Today island lifecycle, and at mutation time. Middleware seeds `Astro.locals.today`, the Today list refreshes only when the server supplied a timezone, and every dated Action silently falls back to UTC when the server could not resolve a date.

The resulting contracts disagree:

- Add and Edit previews retain their SSR `today` prop for the island's lifetime.
- Today widens to every owned plant when `today === null`, leaving Watered and Postpone active.
- Add, Update, Watered, and Postpone derive their action date on the server, so their persisted result can disagree with browser-visible state.
- `/plants` and plant detail render relative date and active-season metadata only from the server seed.
- The root layout detects a date mismatch but guards its corrective reload by timezone, preventing the intended post-midnight correction.
- The current Node-only Vitest suite proves pure date arithmetic, not middleware, hydration, Actions, or workerd behavior.

## Desired End State

The browser is the single authority for date-sensitive UI and writes. All hydrated relative-date surfaces use one lifecycle that refreshes immediately, at local midnight, on `pageshow`, and when the document becomes visible. Every dated mutation carries a newly acquired browser-local date; the server validates that it is a real date within one calendar day of UTC before using it.

When a browser day is not yet available, Today shows a non-actionable explanatory state. If browser date acquisition fails during a mutation, the UI blocks the request and explains that the local date could not be determined. SSR remains responsible for auth gating, initial data, and a provisional first-render date.

Verification combines pure unit tests with a required manual workerd matrix. The project test plan records that this runtime behavior is manual coverage debt until a browser runner is introduced.

### Key Discoveries:

- All four dated Actions share the UTC fallback through `getActionDate` (`src/actions/index.ts:22-25,40,104,215,244`).
- Add, Edit, and Today already build `FormData` at dispatch time, which is the correct place to attach a fresh browser date (`src/components/add-plant-form/add-plant-form.tsx:49-67`, `src/components/edit-plant-form/edit-plant-form.tsx:59-76`, `src/components/today-list/today-list.tsx:120-139`).
- Today is the only current island with a rollover lifecycle, and it becomes inert when `timeZone === null` (`src/components/today-list/today-list.tsx:225-266`).
- `SeasonIntervalSummary` reaches into `Astro.locals` and cannot refresh after response time (`src/components/season-interval-summary/season-interval-summary.astro:12-33`).
- The layout's date-mismatch guard is keyed on timezone rather than the mismatched date (`src/layouts/layout.astro:42-47`).
- `isValidDateString` already rejects impossible calendar dates, and epoch-day helpers support a pure ±1-day plausibility check (`src/lib/date.ts:1-31`).
- Vitest intentionally runs in Node without Astro or workerd, so a green suite cannot prove the affected runtime paths (`vitest.config.ts:1-16`).

## What We're NOT Doing

- Migrating Astro from SSR to static output or porting pages to a SPA.
- Removing middleware auth gating, server data loading, server 404s, or no-JS auth forms.
- Adding Playwright, another browser runner, `@cloudflare/vitest-pool-workers`, or browser tests to CI.
- Changing the `DATE` database model, season boundaries, SQL RPC signatures, migrations, RLS, or generated database types.
- Adding a timezone settings surface or trusting Cloudflare geolocation as mutation authority.
- Reopening S-03's overdue-cue scope on `/plants` or plant detail.
- Adding deployment automation, branch protection, preview deploys, or performing a production deployment.
- Guaranteeing that an Add/Edit preview rendered immediately before local midnight matches a submission dispatched immediately after midnight. The chosen contract sends the fresh date without requiring a second confirmation.

## Implementation Approach

Retain server-derived `today` as a hydration-stable seed, then centralize browser acquisition and rollover in reusable helpers. A React hook consumes that lifecycle for Today, Add, and Edit; the Astro season summary uses the same browser subscription through one deduplicated module script rather than creating a React island per plant row.

Restore a required `clientDate` field to Add, Update, Watered, and Postpone. The field is acquired afresh for every initial dispatch and retry, validated as a real date within ±1 UTC calendar day, and then passed unchanged into existing TypeScript schedule calculations and SQL RPC parameters. Remove the UTC fallback entirely.

## Critical Implementation Details

### Timing & lifecycle

The browser lifecycle must refresh once immediately after hydration and reschedule from each newly observed day, not from the original SSR seed. `pageshow` and visible-document recovery remain necessary because timers can be suspended while a tab or device sleeps.

### State sequencing

Add and Edit calculate their visible preview from the live hook value but independently acquire a fresh date at submit. Per the selected product contract, a newly crossed midnight does not abort submission for another confirmation; the fresh submitted day is authoritative even in the narrow interval before the preview rerenders.

### User experience spec

An unresolved Today date is a loading/degraded state, not an empty day and not an all-plants list. It exposes no Watered or Postpone actions and uses plain explanatory copy without implying that no plants are due.

### Performance constraints

`/plants` can render dozens of summaries. Relative metadata enhancement must use one page-level browser lifecycle and update all summary instances; do not mount one React island or one independent timer per plant row.

## Phase 1: Canonical Browser-Date Contracts

### Overview

Create the pure acquisition, lifecycle, and plausibility contracts that every consumer will share. Keep the existing DST-safe timezone arithmetic and make the validation boundary independently testable.

### Changes Required:

#### 1. Date plausibility

**File**: `src/lib/date.ts`

**Intent**: Add a shared predicate for accepting a browser-supplied action date without making the server the source of that date.

**Contract**: A candidate must pass the existing semantic `YYYY-MM-DD` validation and be no more than one epoch day before or after a supplied UTC reference date. The callable follows the repository's verb-first naming rule and contains no clock or runtime I/O. Export a stable `CLIENT_DATE_ERROR_MESSAGE` alongside the predicate so Action handlers and hydrated clients share one rejection marker without importing the server-only Action module.

#### 2. Date plausibility tests

**File**: `src/lib/date.test.ts`

**Intent**: Pin the trust boundary at both accepted edges and immediately outside them.

**Contract**: Table-driven cases cover the UTC date itself, UTC−1, UTC+1, ±2 rejection, impossible dates, malformed strings, month/year rollover, and leap-day boundaries. Top-level `describe` names the function under test.

#### 3. Browser date acquisition and subscription

**File**: `src/lib/timezone.ts`

**Intent**: Provide one browser-facing date source and one shared rollover subscription on top of the existing timezone formatter and DST-safe midnight calculation.

**Contract**: Browser acquisition resolves the current IANA zone through `Intl`, returns a semantically valid local date or a failure result, and supports a fresh read at mutation dispatch. The subscription emits immediately, at each local midnight, on `pageshow`, and when a hidden document becomes visible; cleanup removes listeners and timers. Browser globals are accessed only when the browser-facing callables run so Node tests can still import the module.

**Testable seams**: The subscription's decision logic must live in pure exported functions that take an explicit `now`, not inside the timer callback — otherwise the Node runner cannot reach the riskiest code in this change. Name at least two: a rollover-delay calculator over `(timeZone, now)` (wrapping the existing `getMillisecondsUntilNextMidnight`, including the reschedule-from-newly-observed-day step) and a pure reducer answering "given the previously emitted day and a fresh acquisition, what day should now be emitted" — which is also the null-gating decision Today depends on. The subscription itself reduces to wiring: register listeners, call the pure functions, emit. No jsdom, no fake DOM, and no new dependency are required or introduced.

#### 4. Timezone contract tests

**File**: `src/lib/timezone.test.ts`

**Intent**: Preserve existing opposite-side-of-UTC and DST behavior while covering any new injectable pure seams.

**Contract**: Tests use fixed instants and explicit zones rather than ambient time. The timezone-cookie drift assertion remains because the layout still writes the `tz` cookie; update its commentary only if the duplicate-formatting contract is removed.

Add sibling top-level `describe` blocks for each pure seam named in §3, covering: rescheduling from a newly observed day rather than the original seed, the DST spring-forward and fall-back midnight edges, and the reducer's behaviour when acquisition fails after a day was already emitted (the previously known day must not silently revert to `null`). These cases convert the change's highest-risk logic from manual-only to automated coverage inside the existing Node runner.

#### 5. React date lifecycle hook

**File**: `src/components/hooks/use-browser-today.ts`

**Intent**: Give React consumers a hydration-stable seed followed by browser-owned updates without duplicating timer and lifecycle logic.

**Contract**: `useBrowserToday(initialToday: string | null)` returns the current browser-owned date or `null`. The initial render preserves the SSR seed; the effect subscribes to the shared browser lifecycle and cleans up on unmount. Follow the repository's hook ordering and filename conventions.

### Success Criteria:

#### Automated Verification:

- Date and timezone unit tests pass: `pnpm test -- src/lib/date.test.ts src/lib/timezone.test.ts`
- Full unit suite passes in UTC: `pnpm test`
- Full unit suite passes in a non-UTC process zone: `TZ=America/New_York pnpm test`
- Type checking passes: `pnpm check`
- Linting passes: `pnpm lint`

**Implementation Note**: After completing this phase and all automated verification passes, proceed only after confirming the shared contracts are stable; this phase has no user-visible manual check. The corresponding checkboxes live in `## Progress`.

---

## Phase 2: Browser Authority Across UI and Mutations

### Overview

Move every interactive and relative-date consumer onto the shared browser lifecycle, restore the client-date mutation contract with bounded validation, remove the UTC fallback, and delete the ineffective corrective reload.

### Changes Required:

#### 1. Dated Action input and validation

**File**: `src/actions/index.ts`

**Intent**: Make the browser-supplied date explicit on every dated write while rejecting malformed or implausible input before storage or database work begins.

**Contract**: Add `clientDate` to `addPlant`, `updatePlant`, `markWatered`, and `postponePlant`. It is business-required but transport-optional in each Zod schema so a missing field reaches the same initial handler guard as malformed or implausible input instead of being converted into Astro's pre-handler `ActionInputError`. Before storage or database work, validate presence, semantic date correctness, and the ±1-day UTC bound; every failure throws `BAD_REQUEST` with the shared `CLIENT_DATE_ERROR_MESSAGE`. Use the accepted date for `selectSeasonInterval`, `nextDue`, `resolveScheduleChange`, and `p_acted_on`. Remove `getActionDate` and its UTC fallback. `undoWateringEvent` remains undated.

The `getTodayInTimeZone` import stays: because Phase 1 §1's predicate is pure and takes the UTC reference as an argument, the handler supplies it via `getTodayInTimeZone("UTC")`. What disappears is the fallback semantics — UTC is now only the yardstick the submitted date is measured against, never a substitute for it. Do not hand-roll a second UTC-date expression alongside the existing helper.

Rejection must be distinguishable at the call sites, not folded into the existing generic failure path: clients match both `BAD_REQUEST` and `CLIENT_DATE_ERROR_MESSAGE`, leaving unrelated bad requests on their existing paths. This is a non-transient condition — a wrong device clock does not heal on retry — so every consumer must be able to tell it apart from a network or server failure.

#### 2. Add form lifecycle and dispatch

**Files**: `src/components/add-plant-form/add-plant-form.tsx`, `src/components/add-plant-form/types.ts`

**Intent**: Keep seasonal preview text current across midnight and attach the actual browser day at submission.

**Contract**: Retain the SSR `today` prop as the hook seed, render preview labels from the hook value, and acquire `clientDate` again inside `onSubmit`. A failed acquisition prevents the Action call and shows the shared local-date error. A fresh date that differs from the rendered hook value is submitted immediately without a review-again step.

Replace the single hardcoded connection-flavoured failure string with a branch on the rejection marker from §1: a rejected `clientDate` shows clock-specific copy (the device date could not be reconciled; check the device clock) without a dedicated Retry action in the error notice, while every other failure keeps the existing connection copy. The normal Save control remains available for a fresh attempt after the device clock is corrected.

#### 3. Edit form lifecycle and dispatch

**Files**: `src/components/edit-plant-form/edit-plant-form.tsx`, `src/components/edit-plant-form/types.ts`, `src/components/edit-plant-form/utils.ts`

**Intent**: Keep recalculation previews current and ensure Update uses the fresh browser day that the server will persist.

**Contract**: Seed the shared hook from the SSR prop, pass its live value into every schedule preview, and acquire `clientDate` again inside `onSubmit`. Date acquisition failure produces a distinct retryable error state and no request. Preserve photo handling, validation focus, optimistic concurrency, announcement behavior, and the selected immediate-submit midnight contract.

Widen `SaveErrorState` and `getSaveErrorState` with a fourth branch for §1's rejection marker, ahead of the `generic` fallback, and add its message to `SAVE_ERROR_MESSAGES`: clock-specific copy that names the device clock rather than the connection and presents no dedicated Retry action. Without this branch the rejection silently inherits "Check your connection and try again", which is wrong and unactionable. The normal Save control remains available for a fresh attempt after the device clock is corrected.

Also rewrite `buildSchedulePreview`'s null-date branch. Its current copy — "The applicable season will be resolved when you save." — states the server-authoritative contract this change removes; under the new contract a null local date blocks the save instead. Replace it with copy saying the local date is still being determined and saving is unavailable until it resolves.

#### 4. Today membership and mutations

**Files**: `src/components/today-list/today-list.tsx`, `src/components/today-list/types.ts`, `src/components/authed-shell.astro`, `src/middleware.ts`, `src/env.d.ts`

**Intent**: Make Today self-sufficient after hydration, prevent the null-date all-plants failure, and date each Watered/Postpone attempt freshly.

**Contract**: Replace the component-local timezone lifecycle with the shared hook and remove the `timeZone` prop. When the current day is `null`, render a non-actionable “Finding your local date…” state rather than filtering or rendering plant rows. Each initial Watered/Postpone dispatch and each retry acquires and sends a fresh `clientDate`; acquisition failure leaves the row in place and presents a retryable local-date message. Preserve sorting, overdue non-color cues, focus recovery, reduced-motion behavior, undo, and optimistic concurrency.

Removing the `timeZone` prop leaves `Astro.locals.timeZone` with no consumer anywhere, so retire it in the same step: drop the field from `App.Locals` in `src/env.d.ts` and stop assigning it in `src/middleware.ts`, keeping the middleware-local `timeZone` binding that still computes `locals.today`. Leaving a written-but-unread local behind would strand the very split ownership this change removes.

`showActionFailure` must branch on §1's rejection marker: a rejected `clientDate` leaves the row in place and shows clock-specific copy **without** a dedicated Retry action in the toast, because an unchanged device clock makes an immediate retry fail identically. The row's normal Watered and Postpone controls remain available for a fresh attempt after the device clock is corrected. All other failures keep the current retryable toast.

#### 5. Relative metadata browser enhancement

**Files**: `src/components/season-interval-summary/season-interval-summary.astro`, `src/components/season-interval-summary/utils.ts`, `src/pages/plants/index.astro`, `src/pages/plants/[id].astro`

**Intent**: Keep `/plants` and plant detail aligned with the same browser-owned day without creating an island or timer per plant.

**Contract**: Make the SSR seed an explicit component prop rather than a hidden `Astro.locals` read. Render hydration-safe exact-date/full-interval fallback data and expose only the values needed for enhancement through data attributes. One processed module script subscribes to the shared browser lifecycle and updates every mounted summary's due label, active season, and selected interval. If browser date acquisition fails, retain exact dates and both intervals without guessed relative wording.

#### 6. Root timezone handshake cleanup

**Files**: `src/layouts/layout.astro`, `src/lib/timezone.ts`, `src/lib/timezone.test.ts`

**Intent**: Retain the timezone cookie that improves future SSR seeds while removing the broken reload mechanism and duplicated date formatting.

**Contract**: The head script resolves the browser timezone and writes the existing `tz` cookie before interaction. Remove `data-today`, browser date formatting, `sessionStorage`, and `location.reload`; update paired comments and the cookie-name drift test to describe only the remaining duplication.

### Success Criteria:

#### Automated Verification:

- Full unit suite passes in UTC: `pnpm test`
- Full unit suite passes in a non-UTC process zone: `TZ=America/New_York pnpm test`
- Type checking passes: `pnpm check`
- Linting passes: `pnpm lint`
- Cloudflare production build succeeds: `pnpm build`

#### Manual Verification:

- With no server date seed, Today shows the explanatory non-actionable state and never exposes future plants as due
- In UTC− and UTC+ browser zones where the local day differs from UTC, Today, Add, Edit, `/plants`, and plant detail agree after hydration
- Add, Update, Watered, and Postpone persist the fresh browser-local date and select the matching seasonal interval
- Browser date acquisition failure blocks every dated mutation with a retryable explanation and sends no Action request
- Add and Edit previews refresh after midnight, while an immediate cross-midnight submit follows the accepted fresh-date-without-reconfirmation contract
- Midnight, `pageshow`, and visibility recovery update all relative surfaces without a document reload
- Overdue labels, non-color urgency cues, focus recovery, undo, and reduced-motion behavior remain intact
- A device clock set more than one calendar day from UTC is rejected by every dated mutation with clock-specific copy and no dedicated Retry action in the error notice, never the generic connection message; normal action controls remain available after correction

**Implementation Note**: After completing this phase and all automated verification passes, pause for human confirmation that the manual UI and mutation checks succeeded before proceeding. The corresponding checkboxes live in `## Progress`.

---

## Phase 3: Workerd Verification and Documentation Reconciliation

### Overview

Run the complete production-shaped verification matrix and make the project's testing and deployment records accurately describe what is and is not protected.

### Changes Required:

#### 1. Risk #1 coverage record

**File**: `context/foundation/test-plan.md`

**Intent**: Stop claiming that pure unit tests prove agreement across middleware, hydration, Actions, and workerd.

**Contract**: Preserve the completed runner/calendar-math work and the four pending rollout phases, but qualify Risk #1 and Phase 1 coverage: unit tests protect pure calendar rules; this change's manual workerd matrix protects current-date runtime wiring; fixed-clock TypeScript and SQL checks protect historical season boundaries. Record that a historical browser-to-Action-to-database boundary run remains deferred integration coverage, and that browser lifecycle remains accepted CI coverage debt until the existing freshness trigger introduces a browser layer. Update the review date without inventing automated coverage.

#### 2. Deployment record

**File**: `context/deployment/deployment-plan.md`

**Intent**: Remove the contradiction between the original skeleton-deploy description and the verified current production app.

**Contract**: Clearly distinguish the historical first-deploy baseline from the 2026-07-26 verified state: current UI, protected routes, migrations, and middleware date resolution are deployed. Preserve manual deployment and code-only rollback as the current operational contract; do not add an automated deploy plan.

#### 3. Package-manager documentation

**File**: `README.md`

**Intent**: Make the Worker-secret command comply with the repository's pnpm-only rule.

**Contract**: Replace the remaining `npx wrangler secret put` wording with the repository-standard `pnpx wrangler secret put`; do not otherwise broaden deployment instructions.

### Success Criteria:

#### Automated Verification:

- Exact CI validation sequence passes locally: `pnpm exec astro sync && pnpm lint && pnpm check && pnpm test && TZ=America/New_York pnpm test && pnpm build`
- Plan and deployment documentation format cleanly: `pnpm exec prettier --check context/foundation/test-plan.md context/deployment/deployment-plan.md README.md`
- Database season-boundary verification passes: `psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -f supabase/tests/season-aware-intervals.sql`

#### Manual Verification:

- Local workerd verification covers cookie-less first paint, hydrated correction, and no corrective document reload
- In current-date UTC− and UTC+ browser scenarios where the local day differs from UTC, every relative surface and dated mutation agrees on the browser-local day
- Persisted plants and journal rows confirm all four dated mutations use the browser-local action date
- Test-plan wording clearly separates automated pure-math coverage from manual runtime coverage debt
- Deployment documentation describes the current app while keeping production deployment outside this change

**Implementation Note**: After completing this phase and all automated verification passes, pause for human confirmation of the full workerd matrix. Production deployment, if desired, is a separate explicitly authorized release step.

---

## Testing Strategy

### Unit Tests:

- Validate accepted and rejected action-date offsets with fixed reference dates.
- Cover malformed and impossible dates, month/year rollovers, and leap-day edges.
- Preserve opposite-side-of-UTC and DST-safe midnight calculations.
- Cover the rollover-delay calculator and the observed-day reducer as pure functions with fixed instants, so the lifecycle logic is not manual-only coverage.
- Reuse the authoritative season-boundary table rather than creating another boundary source.
- Keep tests independent of ambient clocks and process timezone.

### Integration Tests:

- No new automated integration or browser harness is introduced in this change.
- Existing SQL season-aware tests remain unchanged because RPC signatures and database logic do not change; run the existing suite in Phase 3 as deterministic database-side evidence for Feb 28/Mar 1 and Oct 31/Nov 1.
- The future test-plan Phase 2 remains responsible for the seeded Supabase mutation harness.

### Manual Testing Steps:

1. Start local Supabase and the production-shaped app using the README setup and `pnpm preview`.
2. Clear the `tz` cookie, then confirm a null SSR seed cannot expose actionable plant rows.
3. Emulate zones west and east of UTC at an instant where UTC and local dates differ; compare every relative-date surface.
4. Exercise Add, Edit, Watered, and Postpone, then inspect `plants.next_due_on` and `watering_events.acted_on`.
5. Run the fixed-clock TypeScript and SQL season-boundary suites for Feb 28/Mar 1 and Oct 31/Nov 1; do not change the host clock to manufacture a historical workerd run.
6. Leave Today, Add, Edit, `/plants`, and detail open across midnight or a controlled clock transition; verify refresh behavior and no reload.
7. Simulate browser date acquisition failure; confirm no dated Action request is sent and recovery remains possible.
8. Recheck keyboard focus, overdue non-color cues, reduced motion, undo, and error recovery.

## Performance Considerations

Browser date acquisition and formatter construction must remain cached through the existing timezone helper. Use one shared lifecycle subscription per page and one deduplicated summary enhancer; dozens of plants must not create dozens of midnight timers, global listeners, or React roots.

The change adds only local formatting after hydration and does not add data requests, database queries, or server round trips. SSR data-before-paint and auth redirect behavior remain unchanged.

## Migration Notes

No database or data migration is required. Existing `DATE` columns, RPC parameters, RLS policies, grants, and generated types remain valid because only the Action input contract changes.

The code change is backward-incompatible between client and server bundles: clients without `clientDate` will fail the new required Action contract. Deploy the built application atomically as one Worker version; rollback reverts the client and server together and does not involve the database.

Atomic deployment does not close the skew, because the surface that skews is the **already-open browser tab**, not the server. A tab loaded before the release keeps running the previous client bundle, and its next Water, Postpone, Add, or Save posts no `clientDate` at all. The new server rejects that request safely through the shared Phase 2 §1 guard, but the already-running client can only show its existing generic failure UI; newly deployed client code cannot retrofit reload-specific copy or retry behavior into that bundle. Reloading the tab upgrades the client and clears the condition permanently. This is a transient release-window condition, not an ongoing operational one — no version negotiation or dual-schema compatibility window is introduced.

## References

- Related research: `context/changes/today-acquisition-defects/research.md`
- Change definition: `context/changes/today-acquisition-defects/change.md`
- Product date contract: `context/foundation/prd.md:164`
- Test strategy and accepted UI exclusion: `context/foundation/test-plan.md:42-49,74-85,205-240`
- Prior server-authoritative implementation: `context/archive/2026-07-24-user-timezone-dates/plan.md`
- Original client-date precedent: `context/archive/2026-07-19-core-watering-loop/plan.md:145-146,268`
- Frozen-submit regression precedent: `context/archive/2026-07-23-season-aware-intervals/reviews/impl-review.md:34-42`
- Current date acquisition: `src/middleware.ts:12-19`, `src/layouts/layout.astro:19-50`, `src/actions/index.ts:22-25`
- Current browser rollover: `src/components/today-list/today-list.tsx:217-266`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Canonical Browser-Date Contracts

#### Automated

- [x] 1.1 Date and timezone unit tests pass — 05e67a8
- [x] 1.2 Full unit suite passes in UTC — 05e67a8
- [x] 1.3 Full unit suite passes in a non-UTC process zone — 05e67a8
- [x] 1.4 Type checking passes — 05e67a8
- [x] 1.5 Linting passes — 05e67a8

### Phase 2: Browser Authority Across UI and Mutations

#### Automated

- [x] 2.1 Full unit suite passes in UTC — 19f21e2
- [x] 2.2 Full unit suite passes in a non-UTC process zone — 19f21e2
- [x] 2.3 Type checking passes — 19f21e2
- [x] 2.4 Linting passes — 19f21e2
- [x] 2.5 Cloudflare production build succeeds — 19f21e2

#### Manual

- [x] 2.6 With no server date seed, Today shows the explanatory non-actionable state and never exposes future plants as due — 19f21e2
- [x] 2.7 In UTC− and UTC+ browser zones where the local day differs from UTC, Today, Add, Edit, `/plants`, and plant detail agree after hydration — 19f21e2
- [x] 2.8 Add, Update, Watered, and Postpone persist the fresh browser-local date and select the matching seasonal interval — 19f21e2
- [x] 2.9 Browser date acquisition failure blocks every dated mutation with a retryable explanation and sends no Action request — 19f21e2
- [x] 2.10 Add and Edit previews refresh after midnight, while an immediate cross-midnight submit follows the accepted fresh-date-without-reconfirmation contract — 19f21e2
- [x] 2.11 Midnight, `pageshow`, and visibility recovery update all relative surfaces without a document reload — 19f21e2
- [x] 2.12 Overdue labels, non-color urgency cues, focus recovery, undo, and reduced-motion behavior remain intact — 19f21e2
- [x] 2.13 A device clock set more than one calendar day from UTC is rejected by every dated mutation with clock-specific copy and no dedicated Retry action in the error notice, never the generic connection message; normal action controls remain available after correction — 19f21e2

### Phase 3: Workerd Verification and Documentation Reconciliation

#### Automated

- [x] 3.1 Exact CI validation sequence passes locally — 439d5bc
- [x] 3.2 Plan and deployment documentation format cleanly — 439d5bc
- [x] 3.3 Database season-boundary verification passes — 439d5bc

#### Manual

- [x] 3.4 Local workerd verification covers cookie-less first paint, hydrated correction, and no corrective document reload — 439d5bc
- [x] 3.5 In current-date UTC− and UTC+ browser scenarios where the local day differs from UTC, every relative surface and dated mutation agrees on the browser-local day — 439d5bc
- [x] 3.6 Persisted plants and journal rows confirm all four dated mutations use the browser-local action date — 439d5bc
- [x] 3.7 Test-plan wording clearly separates automated pure-math coverage from manual runtime coverage debt — 439d5bc
- [x] 3.8 Deployment documentation describes the current app while keeping production deployment outside this change — 439d5bc
