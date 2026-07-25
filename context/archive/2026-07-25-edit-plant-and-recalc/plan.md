# Edit Plant and Schedule Recalculation Implementation Plan

## Overview

Add an edit flow to the existing plant record: a signed-in user can change a plant's name, growing-season
interval, dormancy-season interval, and photo without losing their watering journal. The load-bearing
behavior is schedule transparency — a name or photo edit leaves `next_due_on` alone, while a change to the
interval **active on the user's local save date** shifts the stored due date by the interval delta, and the
exact resulting date is shown before the user commits.

This is roadmap slice **S-06** (`context/foundation/roadmap.md`, `edit-plant-and-recalc`, PRD FR-006).
Prerequisites S-01 and S-02 are complete, and S-08 (user-timezone date authority) has landed, which is what
makes an honest server-rendered date preview possible for the first time.

The complete UX/UI specification lives in `context/changes/edit-plant-and-recalc/design.md` and is
authoritative for layout, copy, states, and visual direction. This plan owns the solution architecture.

## Current State Analysis

The plant record exists and is readable, but nothing in the app can change it after creation. `addPlant`
(`src/actions/index.ts:38-100`) is the only write path to the `plants` row; every other mutation
(`markWatered`, `postponePlant`, `undoWateringEvent`) touches only `next_due_on` and the journal.

**What the schedule machinery already gives us:**

- `Astro.locals.today` is the user's calendar day, resolved once per request in `src/middleware.ts:12-19`
  from the `tz` cookie or `request.cf.timezone`. Actions read it through `getActionDate()`
  (`src/actions/index.ts:31-35`), which falls back to UTC only when both sources are absent. The preview
  and the mutation therefore share one date authority with no new plumbing.
- Date arithmetic is timezone-independent by construction: `toEpochDay`/`fromEpochDay`
  (`src/lib/date.ts:7-20`) work in UTC epoch days, so a shift cannot drift across a DST boundary. A
  negative shift works identically to a positive one.
- `getSeason()` (`src/lib/season.ts:14`) and `selectSeasonInterval()` (`src/lib/season.ts:23`) already
  encode the March 1 – October 31 growing window that `design.md` §5 requires.
- `formatShortDate()` (`src/lib/date.ts:40`) is the shared date formatter; raw `YYYY-MM-DD` never reaches
  the UI.

**What makes concurrency tractable:**

`plants` carries `updated_at timestamptz not null default now()` with a `before update` trigger that bumps
it on every write (`supabase/migrations/20260719120000_create_plants.sql:12,17-30`). That is a
trigger-maintained optimistic-concurrency token, already present — the stale-edit requirement in
`design.md` §5 rule 6 needs no schema change.

**What the form layer already gives us:**

`src/components/add-plant-form/add-plant-form.tsx` is a close structural template: TanStack Form with
`revalidateLogic()`, a zod schema producing exactly the error copy the brief specifies (`Enter a plant
name`, `Choose a number from 1 to 365`), the `Field`/`FieldContent`/`FieldError`/`NumberField` vocabulary,
object-URL photo previews with revocation on unmount (`:128-134`), and a `form.Subscribe` block (`:226-278`)
that already derives a season-aware consequence from live interval values. The edit preview is a richer
version of that same pattern.

**Three duplications this slice would otherwise compound:**

| Value | Copies today |
| ----- | ------------ |
| 4 MB limit + JPEG/PNG/WebP list + `Choose a JPEG, PNG, or WebP image up to 4 MB.` | `src/actions/index.ts:8-19` and `src/components/add-plant-form/add-plant-form.tsx:15-17` |
| `SIGNED_URL_TTL_SECONDS = 60 * 60` (the constant; the `createSignedUrls` call shape stays per-site) | `src/components/authed-shell.astro:8,33`, `src/pages/plants/index.astro:9,33`, `src/pages/plants/[id].astro:10,46` |
| The season rule | `src/lib/season.ts:14` and `mark_watered` (`supabase/migrations/20260724120000_add_season_aware_intervals.sql:57-65`), with paired "change both together" comments |

`context/foundation/lessons.md` names exactly this class of drift ("Extract generic helpers to src/lib") —
the edit flow needs all three values, so it must consume shared ones rather than add a third and fourth
copy. The season rule stays at two sites: this plan adds **no** new SQL.

### Key Discoveries

- **`updated_at` is a ready-made CAS token** — `supabase/migrations/20260719120000_create_plants.sql:17-30`.
  No migration, no `version` column, no new trigger.
- **A single conditional `UPDATE` is atomic in Postgres**, so
  `.update(payload).eq("id", id).eq("updated_at", expected)` gives compare-and-swap semantics without a
  row-locking RPC. Zero affected rows is the conflict signal.
- **RLS makes ownership checks implicit and privacy-safe** — `plants_select_own` / `plants_update_own`
  (`supabase/migrations/20260719120000_create_plants.sql:39-52`). Another user's plant is invisible, so a
  cross-account edit attempt and a deleted plant produce the same not-found outcome. No `user_id` filter is
  needed in the action, and none should be added as a substitute for RLS.
- **Action errors carry `code` to the client, but no island reads it today.** Astro deserializes an
  `ActionError` on the client with its `code` intact, so `CONFLICT` can be distinguished from a generic
  failure. `undoWateringEvent` already throws `CONFLICT` server-side (`src/actions/index.ts:184-186`), yet
  every current call site discards the error: `today-list.tsx:150,190` are bare `catch { }` blocks showing a
  generic failure, and `grep -rn "error\.code" src/components src/pages` returns nothing. Phase 3 is
  therefore the **first** consumer of `code` in this repo — it must specify the shape rather than copy one.
- **`output: "server"`** (`astro.config.mjs:10`) — every page is SSR by default; `prerender = false` is
  only required on API routes, and this slice adds none (Astro actions are used, matching every existing
  mutation).
- **`src/pages/plants/[id].astro` and `src/pages/plants/[id]/edit.astro` coexist** — different path depths,
  no routing conflict.
- **`actionBodySizeLimit` is 5 MB** (`astro.config.mjs:16`), comfortably above the 4 MB photo ceiling.
- **`/plants` is already gated** — `PROTECTED_ROUTES` uses `startsWith("/plants")`
  (`src/middleware.ts:6,33-37`), so the edit route inherits auth redirection with no change.
- **No test infrastructure exists** — no Vitest, no Playwright, no `test` script in `package.json`.
  Automated verification is `pnpm lint`, `pnpm astro check`, `pnpm build`, consistent with every prior
  slice.
- **No schema change means the seed stays aligned** with the database shape, satisfying
  `context/foundation/lessons.md` without touching `supabase/seed.sql`.
- **`addPlant`'s name validation does not trim** (`src/actions/index.ts:41`), so a whitespace-only name is
  accepted today. The edit path will trim; see Open Risks.

## Desired End State

A user viewing one of their plants sees a quiet `Edit plant` action in the identity header. It leads to
`/plants/<id>/edit`, which is linkable, refreshable, and back-button-safe. The form arrives prefilled with
the stored name, both intervals, and the current photo.

As the user changes an interval, a preview beneath the interval fields states, in sentence case and with
exact dates, which season is active and what the next due date will become — including when the shift lands
in the past. Saving redirects to the plant detail page, which renders the server's authoritative record:
new name, new photo state, both intervals, and the recalculated due date, with the watering journal
completely unchanged.

Verified by: taking a plant due in 3 weeks with a 30-day growing interval, changing it to 24 days, and
confirming the preview and the saved detail page both report a due date exactly 6 days earlier with no new
journal entry; and by marking that plant watered in a second tab before saving, then confirming the save is
refused with a reload prompt instead of silently overwriting the newer date.

## What We're NOT Doing

- **No delete or archive control.** S-07 owns deletion. No destructive-red styling enters this slice.
- **No watering mutation from the edit page** — no Watered, Postpone, or Undo.
- **No journal writing, editing, or backfill.** A schedule edit creates no `watering_events` row and
  rewrites none. The journal records what happened, not what is now planned.
- **No migration and no new SQL function.** The season rule stays at its two documented sites; a third
  copy in an `update_plant` RPC is explicitly rejected.
- **No new `version` column.** `updated_at` is the concurrency token.
- **No clamping of the recalculated date.** `oldNextDue + delta` is the contract even when the result is in
  the past; clamping would make the rule non-invertible.
- **No confirmation modal** for interval changes, and no unsaved-changes prompt on navigation away.
- **No test tooling.** Consistent with every prior slice.
- **No refactor of `add-plant-form`'s photo markup** into a shared component; only the constants (including
  the `accept` string) and the validation predicate are shared.
- **No change to the two batch signed-URL *call shapes*** (`authed-shell.astro`, `plants/index.astro`).
  Their `createSignedUrls` blocks stay exactly as they are; they import the shared TTL constant and nothing
  else. This slice extracts the single-photo resolver only for the detail page, which needs it.
- **No new design tokens, no decorative botanical artwork, no second visual language.** `design.md` §3 is
  binding.
- **No re-litigating** the season boundary (March 1 – October 31), the 4 MB photo ceiling, or the field
  order in `design.md` §6.3.

## Implementation Approach

The server is the sole authority for the recalculated date; the client preview is advisory and is discarded
on success in favour of the server's record. Both sides call **one shared pure function** so they cannot
disagree.

The update boundary is a single conditional `UPDATE` in a new `updatePlant` action rather than a
`SECURITY DEFINER` RPC. This keeps the season rule in `src/lib/season.ts` (no third copy), needs no
migration, and is still atomic — one `UPDATE` statement guarded on `updated_at` is compare-and-swap. It
diverges from the RPC pattern used by the three schedule mutations for a stated reason: those functions
must insert a journal row in the same transaction, and this one must not write the journal at all, while it
must coordinate with Storage — something an RPC cannot do.

The stale-edit guard compares the `updated_at` the **form was rendered with**, and is applied **only when
the save writes `next_due_on`**. That catches precisely the dishonest case — a delta landing on top of a due
date the user never previewed — while a name-or-photo-only save can never be blocked by a concurrent
watering in another tab.

Photo storage is ordered so no object is ever lost: upload the replacement first, write the row second,
delete the superseded object only after the row write is durable, and clean up the freshly uploaded object
if the row write fails.

## Critical Implementation Details

**State sequencing (photo storage and the CAS write).** The order is upload-new → write-row → delete-old,
and it is not the obvious order. Deleting the old object when the user presses `Remove photo`, or before the
row write commits, loses the photo permanently if the write then fails or conflicts. Equally, if the row
write fails after a successful upload, the new object is already orphaned and must be removed — `addPlant`
already models this best-effort cleanup with a logged failure (`src/actions/index.ts:86-95`), and that
`console.error` is the one sanctioned eslint suppression. Old-object deletion must never fail the request:
the user's data is correct once the row is written, and an orphaned object is a storage-hygiene problem, not
a user-facing error.

**The `updated_at` token must round-trip verbatim.** It is a `timestamptz` serialized with microsecond
precision (for example `2026-07-25T09:12:33.123456+00:00`). Passing it through a JavaScript `Date` — or any
reformatting — truncates to milliseconds, and the `.eq("updated_at", …)` guard then matches zero rows on
every save, turning a correctness guard into a permanent conflict. Carry the string exactly as the server
sent it, from the page's SSR read through the island's props and the `FormData` field, back to the action.

**Live-region restraint.** The visible preview updates on every valid interval change, but a live region
that mirrors it would announce on every keystroke while the user types a two-digit number. Render the
visible preview text in an element that is **not** a live region, and mirror the settled consequence into a
separate visually-hidden `aria-live="polite"` node updated on field blur and on submit attempt only
(`design.md` §8).

---

## Phase 1: Server Foundation and the `updatePlant` Action

### Overview

Extract the values the edit flow must share rather than duplicate, add the one pure function that both the
preview and the mutation call, and implement the authoritative server write with its concurrency guard and
photo lifecycle. Nothing is user-visible at the end of this phase except that the existing add-plant flow
still works unchanged.

### Changes Required:

#### 1. Shared photo module

**File**: `src/lib/photo.ts` (new)

**Intent**: Give the 4 MB ceiling, the JPEG/PNG/WebP MIME→extension map, the user-facing guidance string,
the storage-path convention, and the single-photo signed-URL read one home, so the edit action, the edit
form, the add form, and the detail page all consume the same values. Per
`context/foundation/lessons.md`, these are generic and state-free and belong in `src/lib`.

**Contract**: Exports the byte ceiling, the MIME→extension record, the guidance copy (`Choose a JPEG, PNG,
or WebP image up to 4 MB.`), the `accept` attribute string, a predicate that validates a `File` against both
type and size, a helper that builds the `{user_id}/{uuid}.{ext}` object path the bucket's RLS policies
require (`supabase/migrations/20260719120001_create_plant_photos_bucket.sql:13-27`), the one-hour signed-URL
TTL, and a single-path signed-URL resolver returning `string | null`.

Both the allowed-type set and the `accept` string must be *derived* from the MIME map, not listed a second
time — that is what keeps them from drifting, and it is what makes the `image/webp` grep below meaningful
(the two `<input accept>` attributes consume the derived constant instead of spelling the list out).

**This module must stay isomorphic.** `add-plant-form.tsx` is a `client:load` island
(`src/pages/plants/new.astro:17`) and the new edit island is too, so both pull `photo.ts` into the client
bundle. `@/lib/supabase` imports `astro:env/server` (`src/lib/supabase.ts:3`), which does not exist in a
client bundle — importing it here breaks the island build. Therefore the signed-URL resolver **takes an
already-created client as its first parameter** and `photo.ts` uses `import type { SupabaseClient }` only
(a type-only import is erased at build time). It must never call `createClient` itself; every call site
already holds a client (`src/pages/plants/[id].astro:24`). Keep this constraint as a comment at the top of
the module so a later edit does not silently reintroduce the break.

#### 2. Schedule recalculation

**File**: `src/lib/schedule.ts` (new)

**Intent**: Encode `design.md` §5 once, as a pure function over calendar strings, so the client preview and
the server write cannot produce different dates. It resolves the active season from the user's local day,
takes the delta between the stored and submitted interval for that season, and shifts the stored due date by
it using epoch-day arithmetic.

**Contract**: This signature is depended on by both Phase 1's action and Phase 2's island, so it is fixed
here:

```ts
export type ScheduleChange = {
  season: Season;          // which season the user's local save date falls in
  oldNextDue: string;      // the stored date, unchanged
  newNextDue: string;      // oldNextDue shifted by deltaDays
  deltaDays: number;       // newActiveInterval - oldActiveInterval; 0 means no schedule write
};

export function resolveScheduleChange(input: {
  activeDay: string;
  oldNextDue: string;
  oldGrowingIntervalDays: number;
  oldDormancyIntervalDays: number;
  newGrowingIntervalDays: number;
  newDormancyIntervalDays: number;
}): ScheduleChange;
```

`deltaDays === 0` is the canonical "the due date does not move" signal — it covers a name/photo-only edit
and an inactive-season-only edit identically, and it is what both the omitted `next_due_on` write and the
omitted CAS guard key off. Shifting uses `toEpochDay`/`fromEpochDay` so a negative delta behaves exactly
like a positive one; do not route this through `nextDue()`, whose "from date plus interval" naming does not
describe a signed shift.

#### 3. Action input/output types

**File**: `src/types.ts`

**Intent**: Add the `updatePlant` input and output types alongside the existing per-action pairs, keeping
shared DTOs in one place per `AGENTS.md`.

**Contract**: An input type covering the plant id, name, both intervals, an optional replacement `File`, a
remove-photo intent flag, and the expected `updated_at` string; output is `Plant`, matching `AddPlantOutput`.

#### 4. The `updatePlant` action

**File**: `src/actions/index.ts`

**Intent**: Implement the authoritative write: validate, read the current row under RLS, compute the new due
date server-side, apply the photo lifecycle, and commit through one conditional `UPDATE` that refuses to
land on a record the user did not see.

**Contract**: A form-accepting action whose zod input mirrors the type above. `name` must be trimmed before
the non-empty check so a whitespace-only name is rejected with `Enter a plant name`; both intervals are
coerced integers in 1–365; the remove-photo flag uses the existing `z.preprocess((v) => v === "true", …)`
idiom from `alreadyWatered` (`src/actions/index.ts:44`).

Handler sequence:

1. `requireSession` and `getActionDate` exactly as the existing actions do.
2. Read the current row by id — RLS scopes it to the owner. Missing row → `NOT_FOUND`.
3. Call `resolveScheduleChange` with the **freshly read** intervals and due date and the resolved action
   date.
4. Resolve the photo intent: a submitted `File` wins over the remove flag; upload it before any row write.
   Remove flag alone means `photo_path: null`. Neither means the column is omitted from the payload
   entirely, so an unrelated concurrent change cannot be clobbered.
5. Build the payload. `next_due_on` is included **only** when `deltaDays !== 0`.
6. Commit. The CAS shape matters and is depended on by the island's conflict handling:

```ts
// `.eq("updated_at", …)` is applied ONLY when the payload writes next_due_on.
// maybeSingle() — not single() — because zero matched rows is an expected
// outcome (a conflict), not a PostgREST error.
const { data, error } = await query.select().maybeSingle();
```

   `data === null` with the guard applied → `CONFLICT` (`This plant changed elsewhere.`). `data === null`
   without the guard → `NOT_FOUND`. Any `error` → generic failure.
7. On any failure after a successful upload, remove the newly uploaded object (best-effort, logged).
8. On success, if a previous `photo_path` existed and the photo was replaced or removed, delete the old
   object (best-effort, logged) — never before this point.
9. Return the updated row.

#### 5. Repoint existing consumers at the shared module

**File**: `src/actions/index.ts`, `src/components/add-plant-form/add-plant-form.tsx`,
`src/pages/plants/[id].astro`, `src/components/authed-shell.astro`, `src/pages/plants/index.astro`

**Intent**: Delete every duplicated photo constant and every local signed-URL TTL constant so the shared
module is the only definition, without changing any existing behavior or markup.

**Contract**: `addPlant`'s photo zod schema and path construction, and the add form's client-side type/size
check, guidance string, and `accept` attribute, all import from `src/lib/photo.ts`. The detail page's
`loadPlantDetail` uses the shared single-photo signed-URL resolver in place of its local constant and inline
`createSignedUrls` block.

`authed-shell.astro` and `plants/index.astro` each get **one changed line**: their local
`SIGNED_URL_TTL_SECONDS` declaration is replaced by an import of the shared constant. Their
`createSignedUrls` batch calls are not touched, not reshaped, and not moved — the point is to leave exactly
one definition of the TTL in the repo, not to unify the call shape.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `pnpm astro check`
- Linting passes: `pnpm lint`
- Production build succeeds: `pnpm build`
- No photo constant is defined outside the shared module: `grep -rn "4 \* 1024 \* 1024\|image/webp" src/` returns only `src/lib/photo.ts`
- `src/lib/photo.ts` is the only definition of the signed-URL TTL: `grep -rn "SIGNED_URL_TTL_SECONDS =" src/` returns exactly one line
- `src/lib/photo.ts` stays client-safe: `grep -n "astro:env/server\|from \"@/lib/supabase\"" src/lib/photo.ts` returns nothing

#### Manual Verification:

- Adding a plant with a photo still works end to end (regression check on the repointed constants)
- Plant detail, the Today shell, and the plants list all still render their photos after the TTL repoint

**Implementation Note**: Phase 1 is server-only — no route, form, or entry point exists yet to exercise
`updatePlant`, so every end-to-end check of the action itself (interval delta, name-only save,
inactive-season save, conflict, photo lifecycle) lives in Phase 2's manual set, where the form that drives it
exists. After completing this phase and all automated verification passes, pause for manual confirmation
before proceeding.

---

## Phase 2: Edit Route, Form Island, and Detail Entry Point

### Overview

Build the user-visible flow: the entry point on plant detail, the server-rendered edit page, and the React
form island with prefilled fields, the live schedule-consequence preview, and the photo lifecycle. This
phase covers the happy path and field validation; recoverable failure states are Phase 3.

### Changes Required:

#### 1. Detail entry point

**File**: `src/pages/plants/[id].astro`, `src/components/header.astro`

**Intent**: Put `Edit plant` in the identity header where the record it changes is displayed, as a
secondary action that can never be mistaken for a watering action.

**Contract**: A plain anchor to `/plants/<id>/edit` styled with `buttonVariants({ variant: "outline" })` (or
`ghost`), placed in the identity block alongside the name and `SeasonIntervalSummary`, wrapping below the
schedule facts on narrow screens and never moving into an overflow menu (`design.md` §6.1). It must sit
before the journal in DOM order. `header.astro`'s `current` prop union gains `"edit-plant"` so the edit page
can identify itself without marking an unrelated nav item current.

#### 2. Edit page shell

**File**: `src/pages/plants/[id]/edit.astro` (new)

**Intent**: Server-render the edit surface: load the owned plant and its signed photo URL before the island
renders, return a privacy-safe 404 when the plant is absent, and hand the island everything it needs
including the concurrency token.

**Contract**: Mirrors `plants/[id].astro`'s loader and not-found handling — sets `Astro.response.status =
404` and renders the `Plant not found` panel with `Back to all plants` for a missing id or a row RLS hides.
Page order follows `design.md` §6.2: back link (`Back to <plant name>`, falling back to `Back to plant`),
the `Edit plant` heading, a compact identity line, then the island. The reading column matches the existing
form measure (`max-w-sm`, as `plants/new.astro:12`), not the detail page's `max-w-3xl`. The plant read must
include `updated_at`, and it is passed to the island untouched as a string.

#### 3. Edit form island

**File**: `src/components/edit-plant-form/edit-plant-form.tsx`,
`src/components/edit-plant-form/types.ts`, `src/components/edit-plant-form/utils.ts`,
`src/components/edit-plant-form/index.ts` (all new)

**Intent**: The interactive form: prefilled fields in the brief's order, live schedule preview, photo
replace/remove/undo held in local state until save, and one `FormData` submission to `updatePlant`.

**Contract**: Follows `add-plant-form`'s structure — `useForm` with `revalidateLogic()`, an `onDynamic` zod
schema producing the brief's exact error copy, `Field`/`FieldContent`/`FieldDescription`/`FieldError` with
`NumberField` for the intervals, and a `form.Subscribe` over both interval values driving the preview.
Statement order inside the component body follows `AGENTS.md`: non-void hooks, nested functions, void hooks,
`return`.

Props (`types.ts`): the plant's id, name, both intervals, `next_due_on`, `updated_at`, the signed photo URL
or `null`, and `today: string | null`.

Photo state is a single three-way intent — keep, replace, or remove — so `Remove photo` followed by
selecting a file cancels the removal, and `Undo photo removal` returns to keep. Object URLs are revoked on
replacement and unmount, as `add-plant-form.tsx:128-134` does.

Submission builds one `FormData` carrying the plant id, name, both intervals, the replacement `File` when
the intent is replace, the remove flag when it is remove, and the untouched `updated_at`. On success it
assigns `location` to `/plants/<id>`, matching `add-plant-form.tsx:85`; the server's record — never the
client preview — is what the user then sees.

`Save changes` is enabled **only when the form is valid and not submitting** (`design.md` §215). This is
stricter than the inherited precedent: `add-plant-form.tsx:316` disables on `isSubmitting` alone, so the
`canSubmit` half must be added deliberately — subscribe to both flags in the action row's `form.Subscribe`
rather than copying the add form's single-flag guard.

`utils.ts` holds the preview copy builder, which is component-local (only this form renders it) and consumes
`resolveScheduleChange`, `formatShortDate`, and `getSeasonLabel`. It must produce:

- moved, future date: `Growing season is active. Next due will move from 14 Jul to 17 Jul.`
- moved to today: the same sentence plus that the plant is due today
- moved into the past: the same sentence plus how many days overdue that makes it
- `deltaDays === 0` **because only the inactive season's interval changed**: name that change explicitly, per
  `design.md` §232 — e.g. `Dormancy interval saved. Growing season is active, so the next due date stays
  14 Jul.` The two `deltaDays === 0` cases are distinguished by comparing the inactive interval's old and
  new values; the shared-string shortcut is rejected because it leaves the user unsure the edit registered.
- `deltaDays === 0` **with no interval change at all** (name/photo-only edit):
  `The next due date stays 14 Jul until the active schedule changes.`
- either interval invalid: `Enter valid intervals to preview the next due date.` — never a fabricated date
- `today === null`: the current exact due date plus a statement that the applicable season is resolved on
  save. This is the only case where the preview cannot name a new date; it must still name an exact
  existing one and must not use vague words like `Soon` or `Updated schedule`.

The preview is a derived read-only consequence grouped with the interval fields — not a disabled input
(`design.md` §6.3).

### Success Criteria:

#### Automated Verification:

- Type checking passes: `pnpm astro check`
- Linting passes: `pnpm lint`
- Production build succeeds: `pnpm build`
- `/plants/<owned-id>/edit` returns 200 and `/plants/<unknown-uuid>/edit` returns 404

#### Manual Verification:

- `Edit plant` is visible in the detail header, keyboard reachable, and clearly secondary to the identity
- Fields arrive prefilled from the stored record; the photo or the initial fallback matches the detail page
- Changing the active interval updates the preview with the active-season name and exact old and new dates
- Changing only the inactive interval keeps the field value visible, names the inactive-season change, and
  states the date does not move
- An interval change that lands the due date in the past states the overdue consequence in words
- Clearing an interval replaces the preview with the instruction, never a fabricated date
- Photo replace, remove, undo removal, and replace-after-remove all behave per `design.md` §7
- `Cancel` and browser Back leave the record and its photo untouched
- A successful save lands on plant detail showing the new name, photo state, both intervals, and the
  recalculated due date, with the journal unchanged and no new entry
- `Save changes` is disabled while any field is invalid and stays disabled while a save is in flight
- An active-interval change shifts `next_due_on` by exactly the delta, in the correct direction
- A name-only save leaves `next_due_on` and every `watering_events` row untouched
- An inactive-season-only change persists the new interval and does not move the due date
- Marking the plant watered in a second tab, then saving an interval change, returns a conflict rather than overwriting the newer date
- A name-only save still succeeds after that same concurrent watering
- Replacing a photo leaves exactly one object in Storage; a failed row write leaves no orphan

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual
confirmation before proceeding.

---

## Phase 3: Failure States and Accessibility Hardening

### Overview

Make every non-happy path recoverable and verify the flow against the brief's accessibility and responsive
bar. This phase adds no new capability; it makes the existing one trustworthy.

### Changes Required:

#### 1. Recoverable error states

**File**: `src/components/edit-plant-form/edit-plant-form.tsx`,
`src/components/edit-plant-form/utils.ts`

**Intent**: Turn each typed action outcome into a state the user can act on without losing work.

**Contract**: The submit handler distinguishes outcomes by `error.code`. **No existing island reads `code`**
(see Key Discoveries), so the shape is specified here rather than copied:

```ts
const { data, error } = await actions.updatePlant(formData); // may also reject
if (error) {
  // `error` is a client-side ActionError carrying the server's code verbatim.
  if (error.code === "CONFLICT") { /* conflict state */ }
  else if (error.code === "NOT_FOUND") { /* navigate to /plants/<id> */ }
  else { /* generic message */ }
  return;
}
```

The whole call stays inside `try`/`catch` — a network-level failure *rejects* instead of resolving to
`{ error }`, exactly as documented at `add-plant-form.tsx:77-83` — and the `catch` branch shows the same
generic message as the unrecognized-code branch. Do not use `today-list.tsx`'s bare `catch { }`
(`:150,190`) as the model: it discards the error and cannot tell a conflict from a network drop.

- `CONFLICT` → inline `This plant changed elsewhere. Reload it before saving again.` with a `Reload plant`
  control and a `Back to plant` link. No silent merge, no success report. Entered values stay on screen
  until the user chooses to reload, so a second save is never ambiguous.
- `NOT_FOUND` → navigate to `/plants/<id>`, which renders the same privacy-safe not-found state as the
  detail route rather than revealing whether the record ever existed.
- Anything else, including a rejection → `We couldn't save these changes. Check your connection and try
  again.` with every entered value preserved and the form still submittable. No full-page reload.
- While submitting, the primary action reads `Saving changes…` and a second save is impossible; fields and
  the preview stay visible and unanimated.

#### 2. Semantics, focus, and announcement

**File**: `src/components/edit-plant-form/edit-plant-form.tsx`,
`src/pages/plants/[id]/edit.astro`

**Intent**: Meet `design.md` §10 — errors associated with their fields, a predictable tab order, and a
preview that informs screen-reader users without chattering.

**Contract**: Field errors are conveyed through `aria-invalid` plus `FieldError`'s existing association, and
visible adjacent text — never color alone, which also covers the active-season cue and the photo-removal
state. On a failed submit, focus moves to the first invalid control. Tab order is back link → name → growing
→ dormancy → preview context → photo controls → save → cancel. The visible preview is not a live region;
a separate visually-hidden `aria-live="polite"` node carries the settled consequence, updated on blur and
submit only. Initial focus follows `add-plant-form.tsx:122-126` — desktop only, never stealing focus on
small screens.

#### 3. Responsive and theme behavior

**File**: `src/components/edit-plant-form/edit-plant-form.tsx`,
`src/pages/plants/[id]/edit.astro`, `src/pages/plants/[id].astro`

**Intent**: Keep the flow usable at the brief's extremes without introducing new tokens.

**Contract**: The action row places `Save changes` first and `Cancel` second on desktop and wraps or stacks
full-width on narrow screens, with both controls at least 44px on the primary mobile path. Preview copy
wraps freely — no fixed heights, which is also why S-08's pinned-height workaround must not be reintroduced.
Long plant names wrap in both the identity line and the back link rather than truncating. Dark mode uses
existing tokens with no glowing inputs or green-filled panels; any preview crossfade is optional, under
200ms, and absent under `prefers-reduced-motion`.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `pnpm astro check`
- Linting passes: `pnpm lint`
- Production build succeeds: `pnpm build`
- No new eslint suppression was added: `grep -rn "eslint-disable" src/` shows only the pre-existing `no-console` cleanup suppressions

#### Manual Verification:

- Conflict state offers reload and a safe exit, reports no success, and merges nothing
- Simulated offline save preserves every entered value and leaves the form submittable
- Invalid name, invalid interval, and invalid photo each show their exact message at the field with `aria-invalid` set
- A rejected photo leaves the currently saved photo and all unrelated fields untouched
- Failed submit moves focus to the first invalid control
- Screen reader does not announce the preview on every keystroke, but does announce the settled consequence
- 320px and 200% zoom: no horizontal scrolling, action row and all controls reachable
- Keyboard-only pass follows the documented tab order with visible focus on white, muted, and dark surfaces
- Dark mode contrast holds and reduced motion removes any preview transition
- A long plant name wraps in the identity line and back link without truncation
- An already-overdue plant whose interval changes behaves per the delta rule: the detail page shows the exact shifted date, and the Today list carries the overdue cue in text as well as color

**Implementation Note**: This is the final phase. After manual confirmation, close out the plan and update
`change.md`.

---

## Testing Strategy

There is no automated test infrastructure in this repository (no Vitest, no Playwright), consistent with
every prior slice. Verification is `pnpm lint`, `pnpm astro check`, `pnpm build`, plus the manual matrix
below.

### Manual Testing Steps

Recalculation, against a seeded plant with a known `next_due_on`:

1. Growing interval 30 → 24 in July: due date moves exactly 6 days earlier; preview and detail page agree.
2. Growing interval 7 → 10 in July: due date moves exactly 3 days later.
3. Dormancy interval changed in July: due date does not move; the new value persists and is visible.
4. Growing interval 30 → 1 on a plant due in 3 weeks: the date lands in the past and the preview says how
   many days overdue that makes it. The saved detail page shows that exact past date via
   `SeasonIntervalSummary` — it has **no** overdue styling and none is to be added here (`formatDueLabel`,
   `src/lib/date.ts:44`, renders a plain `Due 4 Jul` at any date; the overdue treatment lives only in
   `today-list.tsx:345-394`). Confirm the overdue cue on the **Today list**, where the plant now appears.
5. Name-only and photo-only saves: `next_due_on` unchanged, no new `watering_events` row.
6. Lower an interval then restore it: the due date returns to its original value (the rule is invertible —
   this is what clamping would have broken).

Concurrency:

7. Open the edit page, mark the plant watered in a second tab, then save an interval change → conflict.
8. Repeat, but save a name-only change → succeeds, because the guard is scoped to schedule writes.

Photos:

9. Replace a photo → exactly one object remains for that plant.
10. Remove a photo, then Cancel → the stored photo is intact.
11. Remove a photo, then select a new file → removal is cancelled, the new file is used.
12. Select a 5 MB file and a `.gif` → both rejected client-side with the guidance copy, saved photo intact.

Boundaries and access:

13. Another account's plant id and a random uuid → identical 404 on both `/plants/<id>` and its edit route.
14. Signed-out request to the edit route → redirected to sign-in by existing middleware.
15. Cold profile under `astro dev` with no `tz` cookie → the `today === null` preview branch shows an exact
    existing date and no fabricated new one.

## Performance Considerations

The edit page adds one plant read and at most one signed-URL call per request — the same cost profile as the
detail page, minus the journal query. The action adds one read before its write. The `Intl.DateTimeFormat`
caching in `src/lib/date.ts:5` and `src/lib/timezone.ts:11` already covers the formatting on both sides. No
new hotspot; no budget to defend.

## Migration Notes

None. This slice adds no migration, alters no table, and adds no SQL function, so `supabase/seed.sql` stays
aligned with the database shape and existing rows need no backfill. `next_due_on` values written before this
change remain valid inputs to the delta rule.

## Open Risks & Assumptions

- **`addPlant` still accepts a whitespace-only name** (`src/actions/index.ts:41`). The edit path trims, so
  the two write paths validate names slightly differently. Left out of scope deliberately; a one-line
  alignment is a candidate for S-09's polish pass.
- **The season rule remains duplicated** between `src/lib/season.ts` and `mark_watered`. This plan adds no
  third site, but the existing pair still needs the paired "change both together" comments honored.
- **Storage orphans are possible but not user-visible** — an object can survive if the post-write delete
  fails. Logged, never surfaced, never retried in this slice.

## References

- Design brief: `context/changes/edit-plant-and-recalc/design.md` (authoritative for UX, copy, and states)
- Change identity: `context/changes/edit-plant-and-recalc/change.md`
- Roadmap slice S-06: `context/foundation/roadmap.md`
- PRD FR-006: `context/foundation/prd.md:90`
- Lessons register: `context/foundation/lessons.md`
- Closest form precedent: `src/components/add-plant-form/add-plant-form.tsx`
- Closest action precedent: `src/actions/index.ts:38-100` (`addPlant`, including photo cleanup)
- Concurrency token: `supabase/migrations/20260719120000_create_plants.sql:12,17-30`
- Date authority precedent: `context/changes/user-timezone-dates/plan.md`

## Addenda

Recorded after implementation review (2026-07-25), see `reviews/impl-review.md`.

### A1 — `addPlant`'s photo rejection copy was unified (Phase 1 §5)

Phase 1 §5 described repointing `addPlant`'s photo zod schema at the shared module "without changing any existing behavior". The shared `photoSchema` collapses the two former refinements into one, so `addPlant` now rejects both an oversized file and an unsupported type with the single string `Choose a JPEG, PNG, or WebP image up to 4 MB.` — replacing `Photo must be 4 MB or smaller` and `Photo must be a JPEG, PNG, or WebP image`.

Kept, not reverted: the new string is the one `design.md:402` mandates and the one both client forms already display, so the consolidation removed a pre-existing client/server message mismatch in the add-plant flow. Recorded here because it is a user-visible change to an existing flow that the phase's success criteria did not cover.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Server Foundation and the `updatePlant` Action

#### Automated

- [x] 1.1 Type checking passes: `pnpm astro check` — 9c66f15
- [x] 1.2 Linting passes: `pnpm lint` — 9c66f15
- [x] 1.3 Production build succeeds: `pnpm build` — 9c66f15
- [x] 1.4 No photo constant defined outside the shared module — 9c66f15
- [x] 1.5 `src/lib/photo.ts` is the only definition of the signed-URL TTL — 9c66f15
- [x] 1.6 `src/lib/photo.ts` stays client-safe (no server-only imports) — 9c66f15

#### Manual

- [x] 1.7 Adding a plant with a photo still works end to end — 9c66f15
- [x] 1.8 Detail, Today shell, and plants list still render photos after the TTL repoint — 9c66f15

### Phase 2: Edit Route, Form Island, and Detail Entry Point

#### Automated

- [x] 2.1 Type checking passes: `pnpm astro check` — 88b556a
- [x] 2.2 Linting passes: `pnpm lint` — 88b556a
- [x] 2.3 Production build succeeds: `pnpm build` — 88b556a
- [x] 2.4 Owned edit route returns 200; unknown id returns 404 — 88b556a

#### Manual

- [x] 2.5 `Edit plant` visible, keyboard reachable, clearly secondary — 88b556a
- [x] 2.6 Fields and photo prefill from the stored record — 88b556a
- [x] 2.7 Active-interval change updates the preview with season and exact dates — 88b556a
- [x] 2.8 Inactive-interval change names the inactive change and states the date does not move — 88b556a
- [x] 2.9 Past-landing shift states the overdue consequence in words — 88b556a
- [x] 2.10 Cleared interval shows the instruction, never a fabricated date — 88b556a
- [x] 2.11 Photo replace, remove, undo, and replace-after-remove behave per brief — 88b556a
- [x] 2.12 Cancel and browser Back leave the record and photo untouched — 88b556a
- [x] 2.13 Successful save shows server values on detail with the journal unchanged — 88b556a
- [x] 2.14 `Save changes` is disabled while invalid and while a save is in flight — 88b556a
- [x] 2.15 Active-interval change shifts `next_due_on` by exactly the delta — 88b556a
- [x] 2.16 Name-only save leaves `next_due_on` and the journal untouched — 88b556a
- [x] 2.17 Inactive-season-only change persists but does not move the due date — 88b556a
- [x] 2.18 Concurrent watering then interval save returns a conflict — 88b556a
- [x] 2.19 Name-only save still succeeds after that concurrent watering — 88b556a
- [x] 2.20 Photo replace leaves one object; failed row write leaves no orphan — 88b556a

### Phase 3: Failure States and Accessibility Hardening

#### Automated

- [x] 3.1 Type checking passes: `pnpm astro check` — ca42510
- [x] 3.2 Linting passes: `pnpm lint` — ca42510
- [x] 3.3 Production build succeeds: `pnpm build` — ca42510
- [x] 3.4 No new eslint suppression was added — ca42510

#### Manual

- [x] 3.5 Conflict state offers reload and safe exit, merges nothing — ca42510
- [x] 3.6 Offline save preserves every value and stays submittable — ca42510
- [x] 3.7 Invalid name, interval, and photo show exact messages with `aria-invalid` — ca42510
- [x] 3.8 Rejected photo leaves the saved photo and unrelated fields untouched — ca42510
- [x] 3.9 Failed submit moves focus to the first invalid control — ca42510
- [x] 3.10 Preview does not announce per keystroke but announces the settled consequence — ca42510
- [x] 3.11 320px and 200% zoom: no horizontal scrolling, all controls reachable — ca42510
- [x] 3.12 Keyboard-only pass follows the documented tab order with visible focus — ca42510
- [x] 3.13 Dark mode contrast holds; reduced motion removes any transition — ca42510
- [x] 3.14 Long plant name wraps without truncation — ca42510
- [x] 3.15 Already-overdue plant: exact shifted date on detail, overdue cue on the Today list — ca42510
