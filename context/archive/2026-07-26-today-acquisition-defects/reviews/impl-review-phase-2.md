<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Today Acquisition Defects

- **Plan**: `context/changes/today-acquisition-defects/plan.md`
- **Scope**: Phase 2 of 3 — Browser Authority Across UI and Mutations (commit `19f21e2`)
- **Date**: 2026-07-26
- **Verdict**: NEEDS ATTENTION → all 9 findings triaged and FIXED (see Triage outcome)
- **Findings**: 0 critical, 4 warnings, 5 observations

## Triage outcome

All nine findings were fixed. Post-fix verification re-run and green:
`pnpm test` 0 · `TZ=America/New_York pnpm test` 0 · `pnpm check` 0 errors/0 warnings ·
`pnpm lint` 0 · `pnpm build` 0.

The fixes are uncommitted working-tree changes on top of `19f21e2`, touching:
`src/lib/date.ts`, `src/actions/index.ts`, `src/components/today-list/today-list.tsx`,
`src/components/add-plant-form/add-plant-form.tsx`,
`src/components/edit-plant-form/{edit-plant-form.tsx,utils.ts}`,
`src/components/season-interval-summary/season-interval-summary.astro`,
`supabase/seed.sql`, and this plan's Progress row 2.13.

Two follow-ups deliberately left undone:

- The optional `getActionDate` → `requireClientDate` rename (F8) was not applied — the helper
  validates rather than derives, so the verb-first name still mildly misdescribes it.
- No unit test yet pins `isClientDateRejection`. With the marker now a stable code rather than
  display copy, criterion 2.13 is finally cheap to cover in the existing Node runner; worth
  adding when Phase 3 revisits the test-plan coverage record.

Manual criteria 2.6–2.13 were verified against the pre-fix build. The F1, F3, and F8 fixes
change user-visible copy and the `/plants` first paint, so **2.6, 2.7, 2.9 and 2.13 should be
re-checked** before Phase 3's workerd matrix.

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | WARNING |
| Scope Discipline    | WARNING |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | PASS    |

### Success criteria evidence

All five Phase 2 automated criteria re-run and verified during this review:

| Criterion                            | Command                       | Exit |
| ------------------------------------ | ----------------------------- | ---- |
| 2.1 Full unit suite in UTC           | `pnpm test`                   | 0 (5 files, 73 tests) |
| 2.2 Full unit suite non-UTC zone     | `TZ=America/New_York pnpm test` | 0 |
| 2.3 Type checking                    | `pnpm check`                  | 0 (0 errors, 0 warnings, 10 pre-existing hints) |
| 2.4 Linting                          | `pnpm lint`                   | 0 |
| 2.5 Cloudflare production build      | `pnpm build`                  | 0 |

Manual criteria 2.6–2.13 are all marked `[x]`. Diff evidence supports each: the
non-actionable null state (`today-list.tsx:289-299`), the `dueList = today === null ? []`
guard (`:259`), the fresh per-dispatch/per-retry acquisition (`:135,165`), and the
non-retryable clock toast (`:117-132`) are all observably present. See F1 for the one
manual claim (2.7, `/plants` and detail agreement after hydration) whose implementation
is only half-wired, and F9 for a progress-record gap on 2.13.

### Trust-boundary verification (explicit check)

PASS. In all four dated actions — `addPlant` (`src/actions/index.ts:46`), `updatePlant`
(`:111`), `markWatered` (`:223`), `postponePlant` (`:253`) — `getActionDate(input.clientDate)`
is the first statement after `requireSession()`, ahead of every `supabase.storage.upload`,
`.insert`, `.update`, and `.rpc`. No orphaned-storage path exists. `undoWateringEvent`
correctly remains undated. `Astro.locals.timeZone` retirement is complete and consistent
across `src/env.d.ts`, `src/middleware.ts`, `src/components/authed-shell.astro`, and
`src/components/today-list/types.ts` — a repo-wide grep finds zero remaining readers.

## Findings

### F1 — SSR seed prop in season summary is threaded but never used

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: `src/components/season-interval-summary/season-interval-summary.astro:13,22,44`
- **Detail**: Phase 2 §5 requires "Make the SSR seed an explicit component prop rather than
  a hidden `Astro.locals` read." The prop exists and both pages pass it
  (`src/pages/plants/index.astro:130`, `src/pages/plants/[id].astro:110`), but it is dead:

  ```astro
  const fallback = getSummaryValues(mode, dueDate, growingIntervalDays, dormancyIntervalDays, null);  // :13 — hardcoded null
  data-initial-today={initialToday ?? ""}                                                              // :22 — never read
  subscribeToBrowserToday((today) => { ... });                                                         // :44 — no 2nd arg; defaults to null
  ```

  The pre-change component (`git show 19f21e2^`) rendered relative labels server-side when
  `Astro.locals.today` was known. Now every load of `/plants` renders
  `Due 3 Aug · Growing: Every 7 days · Dormancy: Every 30 days` for every row and swaps to
  `Due today · Growing season · then Every 7 days` once the bundle runs — a full-page text
  flash across dozens of rows for users who already have a `tz` cookie, and permanently
  wrong wording for anyone whose script is blocked or slow. `TodayList` seeds correctly by
  contrast (`today-list.tsx:36`, `useBrowserToday(initialToday)`).

  Note this is a plain Astro module script, not React hydration, so there is no
  hydration-mismatch reason to suppress the seed.

- **Fix A ⭐ Recommended**: Wire the seed through both paths — pass `initialToday` into the
  SSR `getSummaryValues` call, and pass `summary.dataset.initialToday || null` as the second
  argument to `subscribeToBrowserToday`.
  - Strength: Delivers the §5 contract as written, restores server-rendered relative labels,
    and eliminates the flash. The subscription already accepts an `initialToday` parameter
    (`src/lib/timezone.ts:155`), so no new API is needed.
  - Tradeoff: A stale `tz` cookie can briefly show a wrong relative label before the browser
    corrects it — the same seed-then-correct contract Today already accepts.
  - Confidence: HIGH — the plumbing exists on both sides; this is a two-line wiring change.
  - Blind spot: Not verified whether any snapshot/visual test pins the current fallback text.
- **Fix B**: Delete the `initialToday` prop and the `data-initial-today` attribute from all
  three files, accepting browser-only authority for these surfaces.
  - Strength: Removes dead wiring; makes "browser is the sole authority" literal here.
  - Tradeoff: Contradicts §5's explicit "make the SSR seed an explicit component prop", keeps
    the flash and the no-JS regression, and would need a plan addendum.
  - Confidence: MEDIUM — defensible as a product choice, but it is not what the plan says.
  - Blind spot: Impact on perceived load quality for large plant collections is unmeasured.
- **Decision**: FIXED via Fix A — initialToday now feeds both the SSR getSummaryValues call and the subscription seed (read from the first summary's dataset, since all instances share one page-level seed).

### F2 — Client-date rejection predicate triplicated and keyed on free-text prose

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Pattern Consistency
- **Location**: `src/components/today-list/today-list.tsx:181`, `src/components/add-plant-form/add-plant-form.tsx:83`, `src/components/edit-plant-form/utils.ts:32`
- **Detail**: The "is this a client-date rejection?" check is implemented three times in three
  shapes:

  ```ts
  // today-list.tsx:181
  const clientDateRejected =
    typeof error === "object" && error !== null && "code" in error && "message" in error &&
    error.code === "BAD_REQUEST" && error.message === CLIENT_DATE_ERROR_MESSAGE;
  // add-plant-form.tsx:83
  error.code === "BAD_REQUEST" && error.message === CLIENT_DATE_ERROR_MESSAGE ? error.message : message
  // edit-plant-form/utils.ts:32
  if (code === "BAD_REQUEST" && message === CLIENT_DATE_ERROR_MESSAGE) { return "client-date"; }
  ```

  This is the exact duplication class already recorded in `context/foundation/lessons.md`
  ("Extract generic helpers to src/lib, don't duplicate them in components", which cites
  `todayLocalDateString()` duplicated across `today-list.tsx` and `add-plant-form.tsx`).

  Worse than the duplication: all three discriminate on an **English prose string**. Astro
  Actions also returns `BAD_REQUEST` for Zod input failures, so the discriminator is
  "code plus exact copy". Any future copy edit to `CLIENT_DATE_ERROR_MESSAGE` silently
  downgrades every clock-skew rejection to the generic connection message on all three
  surfaces at once — defeating plan criterion 2.13 with no test to catch it.

- **Fix**: Export one `isClientDateRejection(error: unknown): boolean` from `src/lib/date.ts`
  alongside `CLIENT_DATE_ERROR_MESSAGE` and `isPlausibleClientDate`, and call it from all
  three sites. If the prose coupling is to be removed too, have `getActionDate` throw a
  stable machine-readable marker the helper matches on instead of the display copy.
  - Strength: Satisfies the recorded project lesson, collapses three shapes into one, and
    makes the 2.13 contract testable in the existing Node runner.
  - Tradeoff: Touching three call sites; the marker-vs-prose decision is a second, optional step.
  - Confidence: HIGH — `src/lib/date.ts` already owns the constant and the predicate.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix + drop prose coupling — added `CLIENT_DATE_ERROR_CODE = "PRECONDITION_FAILED"` and `isClientDateRejection(error)` to `src/lib/date.ts`; `getActionDate` now throws that code instead of `BAD_REQUEST`. today-list and add-plant-form call the shared predicate; `getSaveErrorState` compares the shared code constant and its now-unused `message` param was dropped. Detection no longer depends on display copy.

### F3 — Same acquisition failure shows three different messages and inconsistent Retry affordance

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `src/components/today-list/today-list.tsx:142`, `src/components/add-plant-form/add-plant-form.tsx:58`, `src/components/edit-plant-form/utils.ts:17`
- **Detail**: `getBrowserToday() === null` — one identical local cause — produces three
  different user-facing strings, one of them an inline literal:

  ```ts
  toast.error("We couldn't determine your local date. Try again.", { action: { label: "Retry", ... } });  // today-list
  toast.error(CLIENT_DATE_ERROR_MESSAGE);                                                                  // add-plant-form
  "client-date": "Your device date could not be reconciled. Check your device clock and try again."       // edit-plant-form
  ```

  `today-list` offers Retry for this condition, `add-plant-form` offers none. `add-plant-form`
  also reuses the *server rejection* constant for a *local acquisition* failure, telling the
  user to check a device clock that may be fine.

- **Fix**: Add two named constants to `src/lib/date.ts` — one for acquisition failure
  (retryable) and one for server rejection / clock skew (not retryable, per 2.13) — and consume
  them from all three surfaces. Drop the inline literal in `today-list.tsx:142`.
- **Decision**: FIXED — added `CLIENT_DATE_UNAVAILABLE_MESSAGE` to `src/lib/date.ts` for the retryable acquisition failure, distinct from `CLIENT_DATE_ERROR_MESSAGE` for the non-retryable rejection. today-list's inline literal and add-plant-form's misapplied rejection copy both now use it; the edit form half landed with F8.

### F4 — Gratuitous `instance_id` change in local seed

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: `supabase/seed.sql:27`
- **Detail**: `auth.users.instance_id` was changed from the canonical nil UUID to a random v4
  value: `'00000000-0000-0000-0000-000000000000'` → `'f3146e82-3bd4-4f0c-9a71-64c8d5e20100'`.

  The rationale recorded in `change.md` — that the old literals fail Astro/Zod's versioned
  `z.uuid()` — is correct for `v_user_id` and the three `plants.id` values, which do cross the
  Action boundary (`updatePlant`, `markWatered`, `postponePlant` all validate with `z.uuid()`).
  It does **not** apply to `instance_id`, which never crosses an Action boundary. GoTrue
  conventionally scopes single-instance lookups to the nil `instance_id`, so this can break
  local sign-in for `test@yapca.local` with no offsetting benefit.

  The rest of the seed change is benign and within guardrails: local fixture data only,
  idempotent `on conflict do update`, no migration, no RLS, no schema, no generated types.
  It is unplanned scope but justified — Phase 2's manual verification (2.6–2.13) was not
  executable without it, and it correctly kept Action validation strict rather than weakening it.

- **Fix**: Revert `supabase/seed.sql:27` to `'00000000-0000-0000-0000-000000000000'`; keep the
  `v_user_id` and `plants.id` v4 replacements.
- **Decision**: FIXED — `supabase/seed.sql:27` reverted to the nil `instance_id` with a comment recording why `z.uuid()` does not apply there. The `v_user_id` and three `plants.id` v4 replacements are kept.

### F5 — Summary subscription disposer discarded (latent view-transition leak)

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/components/season-interval-summary/season-interval-summary.astro:42,44`
- **Detail**: The deduplication requirement is met correctly — Astro hoists the non-inline
  module script into a single per-document bundle, so one `subscribeToBrowserToday` call drives
  all summaries with no per-row timer, listener, or island. `/plants` with dozens of rows creates
  exactly one subscription, satisfying the plan's performance constraint.

  However the returned unsubscribe function is dropped and `summaries` is a module-eval snapshot.
  This is safe **only** because the repo has no `ClientRouter`/`ViewTransitions` (verified: zero
  matches in `src/`). Once view transitions are adopted, `astro:after-swap` re-runs hoisted
  scripts: each stale subscription keeps its `window` `pageshow` and `document`
  `visibilitychange` listeners plus a `setTimeout` chain alive, holding a detached DOM subtree,
  and every navigation adds another.

- **Fix**: Capture the disposer and call it on `astro:before-swap`, or at minimum add a comment
  recording the no-view-transitions precondition so the constraint is discoverable.
- **Decision**: FIXED via astro:before-swap cleanup — the disposer is captured and registered as a `{ once: true }` `astro:before-swap` listener, with a comment explaining the hoisted-script re-run it guards against.

### F6 — Boolean names prefixed with `is` in rewritten lines

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `src/components/today-list/today-list.tsx:353-354`
- **Detail**: AGENTS.md Naming: "a boolean value is never prefixed with `is`/`has`/`should` —
  those prefixes are reserved for functions." These two lines were rewritten by this commit and
  reintroduce the violation:

  ```ts
  const isOverdue = dueStatus !== "due-today";
  const isStrongOverdue = dueStatus === "overdue-strong";
  ```

  The same commit added `clientDateRejected` (`:181`) and `submitReady`
  (`edit-plant-form.tsx:449`), which follow the rule — so the change is internally inconsistent.

- **Fix**: Rename to `overdue` / `stronglyOverdue` while these lines are already being touched.
  (`isLeaving` at `:350` is untouched by this commit; leave it for a separate sweep.)
- **Decision**: FIXED + swept — `isOverdue` → `overdue`, `isStrongOverdue` → `stronglyOverdue`, and (beyond the finding, at the user's direction) `isLeaving` → `leaving`. Prettier reflowed one line the shorter names allowed to collapse.

### F7 — Declarations hoisted above guard clauses

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `src/components/today-list/today-list.tsx:135`, `src/components/add-plant-form/add-plant-form.tsx:55`
- **Detail**: AGENTS.md: "where it conflicts with early returns, the guard clause still comes
  first." Both sites do work that is then discarded:

  ```ts
  // today-list.tsx:134-139 — full Intl.DateTimeFormat construction on every re-click of a pending row
  const clientDate = getBrowserToday();
  if (pendingIds.has(plant.id)) { return; }

  // add-plant-form.tsx:54-61 — FormData allocated, then abandoned
  const clientDate = getBrowserToday();
  const formData = new FormData();
  if (clientDate === null) { toast.error(...); return; }
  ```

  `edit-plant-form.tsx:63-73` gets this right (guard, then `const formData`).

- **Fix**: Move the `pendingIds` guard above `getBrowserToday()` in `today-list`, and move
  `const formData = new FormData()` below the null-guard in `add-plant-form`.
- **Decision**: FIXED — the `pendingIds` guard now precedes `getBrowserToday()` in today-list (no Intl construction on a re-click of a pending row), and `const formData = new FormData()` moved below the null-guard in add-plant-form, matching edit-plant-form.

### F8 — Edit form conflates local acquisition failure with server rejection

- **Severity**: 📋 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: `src/components/edit-plant-form/edit-plant-form.tsx:67-71`, `src/components/edit-plant-form/utils.ts:15-19`
- **Detail**: Phase 2 §3 asks for two things: acquisition failure produces "a distinct retryable
  error state", *and* a fourth `SaveErrorState` branch for the server rejection marker. Both
  collapse into a single `"client-date"` state, so a local `Intl` failure tells the user to check
  a device clock that may be correct, and the non-retryable clock treatment is applied to a
  condition the plan called retryable. `today-list` keeps the two distinct
  (`:141-152` retryable vs `:117-132` non-retryable), so the two surfaces disagree with each other.

  Related, smaller: §1 says "Remove `getActionDate` and its UTC fallback." The UTC fallback is
  genuinely gone, but the helper survives under the same name with a validating signature
  (`src/actions/index.ts:23-31`). Behaviourally correct; the verb-first name now misdescribes
  what it does (`requireClientDate` would read truer).

- **Fix**: Split `"client-date"` into `"client-date-unavailable"` (retryable, matching
  `today-list`'s copy) and `"client-date-rejected"` (non-retryable clock copy), and add both to
  `SAVE_ERROR_MESSAGES`. Pairs naturally with F3's shared constants. Optionally rename
  `getActionDate` to `requireClientDate` in the same pass.
  - Strength: Restores the §3 contract as written and makes Edit consistent with Today.
  - Tradeoff: One extra state in a union that three call sites branch on.
  - Confidence: MEDIUM — the plan's intent is clear, but the merged state is defensible if the
    author judged the two causes indistinguishable to users.
  - Blind spot: Not verified whether a user can realistically hit local acquisition failure
    while the Save control is enabled, given the `submitReady` gate at `:449`.
- **Decision**: FIXED — `SaveErrorState` split into `client-date-unavailable` (retryable, reusing `CLIENT_DATE_UNAVAILABLE_MESSAGE`) and `client-date-rejected` (non-retryable, `CLIENT_DATE_ERROR_MESSAGE`); both added to `SAVE_ERROR_MESSAGES`. Edit now matches today-list. The optional `getActionDate` → `requireClientDate` rename was NOT applied.

### F9 — Progress row 2.13 missing its commit sha

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `context/changes/today-acquisition-defects/plan.md:375`
- **Detail**: The plan's own Progress convention is "Append ` — <commit sha>` when a step lands."
  Rows 2.1–2.12 carry ` — 19f21e2` (added in the currently uncommitted working-tree edit); 2.13
  is marked `[x]` but is the only row without a sha. It is also the criterion most at risk from
  F2 (prose-keyed rejection matching), so its provenance is worth recording.
- **Fix**: Append ` — 19f21e2` to row 2.13 before starting Phase 3.
- **Decision**: FIXED — ` — 19f21e2` appended to Progress row 2.13.

## Verified clean — no findings

- `src/lib/timezone.ts:153-199` — `subscribeToBrowserToday` cleanup is correct: `refreshToday`
  clears the outstanding timer before rescheduling (no accumulation across `pageshow` /
  `visibilitychange` storms), the disposer clears the timer *and* removes both listeners, and
  `getNextBrowserToday` monotonically retains the last good day, so a transient acquisition
  failure never regresses a resolved date to `null`. `useBrowserToday` returns the disposer from
  `useEffect`, so there is no post-unmount `setState`.
- `src/lib/timezone.test.ts` — six sibling top-level `describe`s, each named after the exported
  function under test, no module-level wrapper. Complies with the recorded lessons rule.
- `src/layouts/layout.astro:16-30` — removing the `sessionStorage`-guarded `location.reload()`
  eliminates a reload-loop class outright; the surviving cookie write remains the first statement
  in the `try`, so a throw cannot lose it. `data-today` and `sessionStorage` have zero remaining
  matches in `src/`.
- Security — the summary module script uses `textContent` only; no `innerHTML`, no unescaped
  interpolation, plant names never written by it. No hardcoded secrets. `supabase/seed.sql` is
  local-fixture-only with no `drop`/`truncate` and a header disclaiming non-local use.
- `clientDate: z.string().optional()` is deliberate, not a weakened schema: Astro converts Zod
  failures into a pre-handler `ActionInputError`, which would bypass the shared handler marker.
  Transport-optional routes missing / malformed / implausible input through one guard, exactly as
  §1 specifies.
- `isPlausibleClientDate`'s ±1-day bound is mathematically correct (real zones span UTC−12…UTC+14,
  so a local calendar date differs from the UTC date by at most one).
- Component-structure rules — all four touched folders have an `index.ts` barrel; the new
  `season-interval-summary/utils.ts` is one shared utils module; all filenames kebab-case; no
  `@ts-ignore`; the only `eslint-disable` comments are pre-existing `no-console`; no manual class
  concatenation introduced.
- Scope guardrails hold: no SSR→static/SPA migration, no auth-gating removal, no browser runner or
  CI test additions, no DATE model / RPC signature / migration / RLS / generated-type changes, no
  timezone settings surface, no deployment automation.
