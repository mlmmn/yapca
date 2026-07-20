# Plant Detail View + Watering Journal Implementation Plan

## Overview

Deliver **S-02** (FR-005, FR-014): a signed-in user can open any of their plants and see its details plus a per-plant **watering journal** — the recorded history of watering actions. This introduces the first persisted history in the app: a new `watering_events` table that `markWatered` writes to atomically, a read-only plant detail page, and navigation to reach any plant (not just those due today).

## Current State Analysis

- **No history exists.** `markWatered` (`src/actions/index.ts:83`) selects the plant's `interval_days`, computes `nextDue`, and overwrites `plants.next_due_on`. Nothing is recorded — there is no journal, no audit row, no `watering_events` table. The journal is entirely net-new.
- **Only one action type exists.** "Postpone 2 days" (FR-012) arrives in S-04; today the only watering action is "Watered". The journal schema must record Watered events now and extend to Postpone later without a migration rewrite.
- **Undo (S-04) depends on this slice.** The roadmap states undo reverses journaled actions. So each event must capture enough to reverse deterministically — the plant's due date before and after the action.
- **No detail route or entry point.** `/plants` is already gated in `src/middleware.ts:5` (`PROTECTED_ROUTES = ["/plants"]`), so any `/plants/**` route is auto-protected. But the home (`src/pages/index.astro` → `AuthedShell`) renders only *due/overdue* plants via `today-list.tsx`, and rows are **not links**. A plant that isn't due today is currently unreachable.
- **Established patterns to follow:**
  - Migrations in `supabase/migrations/`, `YYYYMMDDHHmmss_short_description.sql`; `grant` the ops to `authenticated`, then `enable row level security`, then one policy per operation keyed on `auth.uid() = user_id` (see `20260719120000_create_plants.sql`).
  - SSR pages load data server-side with `createClient(Astro.request.headers, Astro.cookies)` and generate signed photo URLs (`createSignedUrls`, 60-min TTL) — see `src/pages/index.astro` `loadPlants()`.
  - Astro components for static/layout; React islands only where interactive. The detail page is read-only → **no island needed**.
  - Shared date/interval helpers live in `src/lib/date.ts` / `src/lib/interval.ts`; do not duplicate them in components (`lessons.md`).
  - Actions validate input with zod and use the `requireSession` helper (`src/actions/index.ts:21`).
  - `database.types.ts` is a generated file mirroring the DB schema; it must be regenerated after any migration.

### Key Discoveries:

- `markWatered` returns `{ plantId, next_due_on }` (`src/actions/index.ts:115`); `today-list.tsx` ignores the payload on success (it filters the row out locally). The return shape can stay identical, so the optimistic today-list flow needs **no changes**.
- The plant's actual watering date is the client-supplied `clientDate` (already validated by `clientDateSchema`), not `now()` — the app is deliberately calendar-date based to stay DST-safe (`src/lib/interval.ts`).
- `plants` has `on delete cascade` from `auth.users`; the new events table should likewise `on delete cascade` from `plants` so deleting a plant (S-07) cleans up its journal.
- Route precedence: a static `src/pages/plants/new.astro` already exists; adding `src/pages/plants/[id].astro` is fine because Astro matches static routes before dynamic ones, so `/plants/new` keeps working.

## Desired End State

A signed-in user can:
1. From the home "Today" list, click a plant row and land on `/plants/<id>` showing that plant's name, photo (or initial fallback), interval, current due status, and a reverse-chronological watering journal.
2. Reach an **All plants** page (`/plants`) from the app header listing every plant they own (due or not), each linking to its detail page.
3. Marking a plant "Watered" (from the today list) now records a journal event; opening that plant afterward shows the new entry with its reschedule ("watered on X → next due Y").

Verified when: mark-watered inserts exactly one `watering_events` row inside the same transaction as the due-date update; the detail page renders that plant's own journal only (RLS-isolated); a plant with no waterings shows a clear empty state; a plant id that doesn't exist or isn't owned returns 404.

## What We're NOT Doing

- **No edit** (name/interval/photo) — that is S-06 (`edit-plant-and-recalc`), reached later from this page.
- **No delete** — that is S-07 (`delete-plant`).
- **No undo** — that is S-04; this slice only stores the data undo will later reverse.
- **No Postpone** — FR-012 arrives in S-04; the event schema anticipates it but no postpone event is produced now.
- **No "Mark Watered" action on the detail page** — watering stays on the today list to avoid duplicating the optimistic flow.
- **No "Added/Planted" journal event and no backfill** — journals record Watered events only, going forward; pre-existing plants show an empty journal until first watered.
- **No overdue urgency styling** — that is S-03.

## Implementation Approach

Three vertical phases. Phase 1 stands up the data model and makes watering write history atomically (a Postgres RPC guarantees the plant update and the journal insert never diverge). Phase 2 adds the read-only SSR detail page. Phase 3 wires navigation so any plant is reachable. Phases 2 and 3 are pure UI/read paths over the Phase 1 data; Phase 1 is the only one touching correctness-critical write logic.

## Critical Implementation Details

- **Atomicity & RLS on the RPC.** The `mark_watered` function must run as `SECURITY INVOKER` (the default) so the caller's RLS still applies — it must not become a privilege-escalation path. Both the `update plants` and `insert into watering_events` inside it are then constrained to the caller's own rows. The function replaces the current select-then-update in the action; the action passes `plant_id` and the client `watered_on` date and reads back the new due date.
- **Event captures before/after.** Each event stores `watered_on` (the actual watering calendar date), `prev_due_on` (the plant's `next_due_on` *before* this action), and `new_due_on` (after). The RPC reads the plant's current `next_due_on` into `prev_due_on` before updating — this is why it must be a single transaction, not two client calls.
- **Not-found = 404, not 500.** RLS makes another user's plant simply return zero rows (same as a nonexistent id). The detail page must treat "no row" as `Astro.response.status = 404`, never an error page.

---

## Phase 1: Journal data model + journaled markWatered

### Overview

Create the `watering_events` table with per-operation RLS, a `mark_watered` Postgres function that atomically reschedules the plant and records the event, rewire the `markWatered` action to call it, and regenerate DB types.

### Changes Required:

#### 1. Migration: `watering_events` table + RLS

**File**: `supabase/migrations/<timestamp>_create_watering_events.sql`

**Intent**: Persist one row per watering action, owned by the user, scoped to a plant, capturing enough to display the journal and (later) reverse the action.

**Contract**: New table `public.watering_events` with columns: `id uuid pk default gen_random_uuid()`, `plant_id uuid not null references public.plants(id) on delete cascade`, `user_id uuid not null references auth.users(id) on delete cascade`, `event_type text not null default 'watered' check (event_type in ('watered'))`, `watered_on date not null`, `prev_due_on date not null`, `new_due_on date not null`, `created_at timestamptz not null default now()`. Index on `(plant_id, created_at desc)` for journal ordering. Follow the `plants` migration exactly: `grant select, insert, delete on public.watering_events to authenticated` (no update — events are immutable; delete is for undo/cascade), `enable row level security`, then four-or-fewer per-op policies (`select`/`insert`/`delete`) each keyed on `auth.uid() = user_id`. The `event_type` check constraint lists only `'watered'` now; S-04 will extend it.

#### 2. Migration: `mark_watered` RPC

**File**: same migration file (or a sibling `<timestamp>_mark_watered_fn.sql`)

**Intent**: Reschedule a plant and record the journal event in one transaction so the due date and its history can never diverge.

**Contract**: `create function public.mark_watered(p_plant_id uuid, p_watered_on date) returns date` as `SECURITY INVOKER`, `language plpgsql`, `set search_path = ''` (schema-qualify all object refs — `public.plants`, `public.watering_events` — since the empty search_path resolves nothing implicitly; matches Supabase's function-hardening lint). Body: select the plant's current `interval_days` and `next_due_on` (into `prev_due_on`) constrained to `auth.uid() = user_id`; **if not found, `raise exception 'Plant not found' using errcode = 'no_data_found';`** (SQLSTATE `02000` — a distinguishable code the action matches on, not message text); compute `new_due_on = p_watered_on + interval_days` (integer-day date arithmetic — Postgres `date + int` is calendar-day accurate); `update plants set next_due_on = new_due_on`; `insert into watering_events (plant_id, user_id, event_type, watered_on, prev_due_on, new_due_on) values (p_plant_id, auth.uid(), 'watered', p_watered_on, prev_due_on, new_due_on)` (`user_id = auth.uid()` satisfies the insert RLS `with check`); `return new_due_on`. `grant execute on function public.mark_watered(uuid, date) to authenticated`.

> Snippet — the interval add must be plain date arithmetic to match `src/lib/interval.ts`'s epoch-day semantics (no timezone drift):
> ```sql
> v_new_due := p_watered_on + v_interval_days;  -- date + int → date, calendar-day exact
> ```

#### 3. Rewire the `markWatered` action

**File**: `src/actions/index.ts`

**Intent**: Replace the select-then-update with a single RPC call so the action journals atomically; keep the return shape identical so `today-list.tsx` is untouched.

**Contract**: In `markWatered.handler`, drop the manual `select interval_days` + `nextDue` + `update`; call `supabase.rpc("mark_watered", { p_plant_id: input.plantId, p_watered_on: input.clientDate })`. Map the RPC error by its SQLSTATE `code`, not its message: `error.code === "02000"` (the `no_data_found` the RPC raises) → `ActionError NOT_FOUND`; any other error → `INTERNAL_SERVER_ERROR`. Return `{ plantId: input.plantId, next_due_on: <rpc result> }` — same `MarkWateredOutput` shape.

#### 4. Regenerate DB types + add journal types

**File**: `src/lib/database.types.ts`, `src/types.ts`

**Intent**: Keep the generated types in sync with the new table/function and expose a UI-facing journal type.

**Contract**: Regenerate `database.types.ts` against the migrated local DB (Supabase types-gen). Add to `src/types.ts`: `WateringEvent = Database["public"]["Tables"]["watering_events"]["Row"]` and a view-model `JournalEntry` (the fields the detail page renders: `id`, `event_type`, `watered_on`, `prev_due_on`, `new_due_on`).

### Success Criteria:

#### Automated Verification:

- [ ] Migration applies cleanly against a fresh local DB: `pnpx supabase db reset` (or `supabase migration up`)
- [ ] Type checking passes: `pnpm exec astro check` (or the project's typecheck script)
- [ ] Linting passes: `pnpm lint`
- [ ] Build succeeds: `pnpm build`
- [ ] `database.types.ts` contains `watering_events` and the `mark_watered` function signature

#### Manual Verification:

- [ ] Marking a plant "Watered" on the home list inserts exactly one `watering_events` row with correct `prev_due_on`/`new_due_on`/`watered_on` (verify in Supabase Studio)
- [ ] The plant's `next_due_on` equals `watered_on + interval_days` (determinism preserved — same result as before)
- [ ] A second user cannot select another user's `watering_events` rows (RLS isolation)
- [ ] If the RPC insert path were to fail, the plant's due date is not changed (atomicity — spot-check by reasoning/forced error)

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 2: Plant detail page (SSR, read-only)

### Overview

Add `/plants/[id].astro` rendering a single plant's details and its watering journal, with a not-found path and a signed photo URL.

### Changes Required:

#### 1. Detail page route

**File**: `src/pages/plants/[id].astro`

**Intent**: Server-render one owned plant with its journal; 404 when the id doesn't resolve to an owned row.

**Contract**: Read `Astro.params.id`. Using a server `createClient`, query the plant by id (RLS scopes to owner) selecting `id, name, interval_days, next_due_on, photo_path`; query its `watering_events` ordered `created_at desc` selecting the `JournalEntry` fields. If the plant query returns no row (or client is null), set `Astro.response.status = 404` and render a minimal "Plant not found" state with a link back to `/plants`. If `photo_path` is set, generate a signed URL (reuse the 60-min TTL pattern from `index.astro`). Render inside `Layout` with the same header/shell chrome as `new.astro` (wordmark + sign-out, a back link to `/plants`). Compose small Astro partials for the detail header and the journal list; a static journal needs no React island.

#### 2. Journal list rendering + date formatting

**File**: `src/pages/plants/[id].astro` (or a `src/components/watering-journal.astro` partial) and `src/lib/date.ts`

**Intent**: Render each journal entry with a human date and the reschedule it produced; show a clear empty state when there are none.

**Contract**: Each entry shows: the event label ("Watered"), the `watered_on` date, and a "next due <new_due_on>" secondary line — formatted via `src/lib/date.ts` helpers (`formatShortDate`; add a `formatLongDate`/`formatJournalDate` helper there if a fuller format is wanted, per the no-duplication lesson). Empty state: a quiet "No waterings yet — mark this plant watered from Today to start its journal." Detail header shows name, photo-or-initial fallback (reuse the `plant.name.trim().charAt(0)` pattern from `today-list.tsx`), and the interval + next-due status via existing `formatIntervalLabel`/`formatDueLabel`.

### Success Criteria:

#### Automated Verification:

- [ ] Type checking passes: `pnpm exec astro check`
- [ ] Linting passes: `pnpm lint`
- [ ] Build succeeds: `pnpm build`

#### Manual Verification:

- [ ] Visiting `/plants/<own-plant-id>` renders name, photo/initial, interval, due status, and the journal newest-first
- [ ] A plant with no waterings shows the empty state
- [ ] Visiting a random/nonexistent id returns 404 with a "not found" page and a link back
- [ ] Visiting another user's plant id returns 404 (not their data)
- [ ] Signed photo URL renders the image; missing photo shows the initial fallback
- [ ] Unauthenticated access to `/plants/<id>` redirects to sign-in (middleware gating still applies)

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 3: Navigation to plant detail

### Overview

Make today-list rows open the detail page, and add an "All plants" collection page so plants not due today are reachable.

### Changes Required:

#### 1. Link today-list rows to detail

**File**: `src/components/today-list.tsx`

**Intent**: Let the user open a plant's detail from its row without breaking the "Watered" button.

**Contract**: Wrap the row's photo+name+meta region in a link to `/plants/${plant.id}` (an `<a>`; the "Watered" `Button` stays a sibling, not nested inside the link, so its press isn't hijacked). Preserve the existing grid layout, the collapse/leave animation, and keyboard focus behavior. Do not make the whole `<li>` a link (the button must remain independently operable).

#### 2. All plants collection page

**File**: `src/pages/plants/index.astro`

**Intent**: A server-rendered list of every plant the user owns (due or not), each row linking to its detail page — the durable home for browsing the collection (and later edit/delete entry point).

**Contract**: Mirror `index.astro`'s `loadPlants()` (server `createClient`, select the list fields, order by `name`, signed photo URLs) but render every plant, not just due ones, as a static list of links to `/plants/<id>`. Reuse the shell chrome (wordmark, sign-out, back-to-Today link) from `new.astro`. Empty state links to `/plants/new`. This is static → no React island.

#### 3. Header entry point to "All plants"

**File**: `src/components/authed-shell.astro` (and `new.astro` header if consistency is wanted)

**Intent**: Give the app header a way to reach the All plants page.

**Contract**: Add an "All plants" nav link (to `/plants`) in the authed shell header next to the wordmark/sign-out. Use `buttonVariants`/existing link styling; do not hand-concatenate classes (`cn()` convention).

### Success Criteria:

#### Automated Verification:

- [ ] Type checking passes: `pnpm exec astro check`
- [ ] Linting passes: `pnpm lint`
- [ ] Build succeeds: `pnpm build`

#### Manual Verification:

- [ ] Clicking a today-list row navigates to that plant's detail; clicking "Watered" still waters (does not navigate)
- [ ] "Watered" button keyboard focus/activation is unaffected by the row link
- [ ] The "All plants" header link opens `/plants` listing every owned plant, including ones not due today
- [ ] Each All-plants row links to the correct detail page
- [ ] All plants empty state links to Add plant
- [ ] No regression in the today-list optimistic mark-watered flow (row still collapses/removes)

**Implementation Note**: Final phase — confirm the end-to-end loop (add → water → open detail → see journal entry) works.

---

## Testing Strategy

### Unit Tests:

- If an interval/date unit test suite exists, assert `mark_watered`'s date math matches `nextDue(watered_on, interval_days)` for representative intervals (1, 3, 365) and across a month boundary. (Primary determinism coverage lives at the DB/RPC level; the existing `src/lib/interval.ts` behavior is unchanged.)

### Integration Tests:

- End-to-end: add a plant → mark watered → assert one `watering_events` row with correct `prev_due_on`/`new_due_on` → open `/plants/<id>` → journal shows the entry.
- RLS: two users; user A cannot read user B's events or plant detail (404).

### Manual Testing Steps:

1. Add a plant "every 3 days", mark it watered today → confirm it leaves Today and reappears in 3 days.
2. Open the plant from the All plants page → journal shows one "Watered" entry with today's date and the +3-day next-due.
3. Open a plant never watered → empty journal state.
4. Hit `/plants/<garbage-id>` → 404 page with back link.
5. Sign in as a second account → confirm you cannot open the first account's plant.

## Performance Considerations

Negligible at MVP scale (target: small data volume). The detail page runs two indexed queries (plant by pk, events by `(plant_id, created_at)`); the RPC is a single transaction replacing a prior select+update round trip (marginally fewer round trips). Signed-URL generation reuses the existing batched pattern.

## Migration Notes

- Pure additive migration — new table + function; `plants` is untouched, so no data migration and no backfill. Existing plants simply start with an empty journal.
- Rollback: drop `watering_events` and `mark_watered`; revert the action to the prior select-then-update. No data loss for `plants`.
- After applying, regenerate `database.types.ts`.

## References

- Roadmap slice S-02: `context/foundation/roadmap.md` (lines 94–104)
- PRD FR-005, FR-014: `context/foundation/prd.md`
- Prior slice (patterns to mirror): `supabase/migrations/20260719120000_create_plants.sql`, `src/pages/index.astro`, `src/actions/index.ts:83`, `src/pages/plants/new.astro`
- No-duplication rule: `context/foundation/lessons.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Journal data model + journaled markWatered

#### Automated

- [x] 1.1 Migration applies cleanly against a fresh local DB — 5d3e80d
- [x] 1.2 Type checking passes (astro check) — 5d3e80d
- [x] 1.3 Linting passes (pnpm lint) — 5d3e80d
- [x] 1.4 Build succeeds (pnpm build) — 5d3e80d
- [x] 1.5 database.types.ts contains watering_events and mark_watered signature — 5d3e80d

#### Manual

- [x] 1.6 Mark Watered inserts exactly one correct watering_events row — 5d3e80d
- [x] 1.7 Plant next_due_on equals watered_on + interval_days (determinism) — 5d3e80d
- [x] 1.8 Second user cannot select another user's watering_events (RLS) — 5d3e80d
- [x] 1.9 Failed journal insert leaves the plant's due date unchanged (atomicity) — 5d3e80d

### Phase 2: Plant detail page (SSR, read-only)

#### Automated

- [x] 2.1 Type checking passes (astro check)
- [x] 2.2 Linting passes (pnpm lint)
- [x] 2.3 Build succeeds (pnpm build)

#### Manual

- [x] 2.4 Own plant detail renders details + journal newest-first
- [x] 2.5 Plant with no waterings shows empty state
- [x] 2.6 Nonexistent id returns 404 with back link
- [x] 2.7 Another user's plant id returns 404
- [x] 2.8 Signed photo renders; missing photo shows initial fallback
- [x] 2.9 Unauthenticated access redirects to sign-in

### Phase 3: Navigation to plant detail

#### Automated

- [ ] 3.1 Type checking passes (astro check)
- [ ] 3.2 Linting passes (pnpm lint)
- [ ] 3.3 Build succeeds (pnpm build)

#### Manual

- [ ] 3.4 Today-list row click navigates to detail; Watered still waters
- [ ] 3.5 Watered button focus/activation unaffected by row link
- [ ] 3.6 All plants header link lists every owned plant (incl. not-due)
- [ ] 3.7 Each All-plants row links to the correct detail page
- [ ] 3.8 All plants empty state links to Add plant
- [ ] 3.9 No regression in today-list optimistic mark-watered flow
