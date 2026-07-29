---
date: 2026-07-28T22:42:21+02:00
researcher: mlmmn
git_commit: 4e3ce5df662d83dfe95632bb6f5782b5fcffa75e
branch: main
repository: yapca
topic: "Task-list and mutation integrity — Risks #2, #3, #4 and the seeded-database integration harness"
tags: [research, codebase, today-list, actions, watering-events, edit-plant, vitest, stryker, supabase]
status: complete
last_updated: 2026-07-28
last_updated_by: mlmmn
---

# Research: Task-list and mutation integrity (test-plan §3 Phase 2)

**Date**: 2026-07-28T22:42:21+02:00
**Researcher**: mlmmn
**Git Commit**: `4e3ce5df662d83dfe95632bb6f5782b5fcffa75e`
**Branch**: `main`
**Repository**: `yapca`

## Research Question

Ground test-plan §3 Phase 2 ("Task-list and mutation integrity") in the live
codebase: where do Risks #2, #3 and #4 actually live, what would a seeded-database
integration harness need in this repo, and which modules deserve a narrowed Stryker
mutation audit once the suite exists?

Scope confirmed with the user: **both** data-mutation correctness and the Stryker
audit angle; **full harness design**, not just risk-surface mapping.

## Summary

Three findings change the shape of this phase before any test is written.

1. **Risk #2's due/overdue predicate is not in the database, and not on the
   server.** `authed-shell.astro:16-20` selects every plant the user owns with no
   date filter, no `LIMIT`, and no `ORDER BY` beyond presentation. The
   `next_due_on <= today` decision is a lexicographic string comparison inside the
   hydrated React island (`today-list.tsx:257`). The test plan's prescribed layer
   for Risk #2 — "integration (seeded database → derived list)" — therefore cannot
   reach the code that owns the failure, and §7 of the plan forbids rendering the
   UI layer. This is a real plan-vs-code conflict; per test-plan §1 principle #3,
   research is ground truth and the plan must adapt. Options are laid out in
   [Blocker B3](#b3--risk-2s-predicate-is-client-side).

2. **The test plan misstates Risk #3's recalculation rule.** `test-plan.md:80`
   asks for "the next-due date matches the documented recalculation **from the last
   actual watering**." The shipped rule (`src/lib/schedule.ts:19-37`) shifts the
   *stored previous due date* by the interval delta and never consults the watering
   journal. `mark_watered` is the path that computes from the watering date. A test
   written against the plan's wording would fail a correct implementation.

3. **Mutation correctness is genuinely good server-side; the inconsistency lives
   at the client boundary and in cross-path interactions.** All three of water /
   postpone / undo are single atomic `security definer` RPCs. The
   `water → undo → postpone → undo` sequence the test plan names returns cleanly to
   the original state. The real defect surface is elsewhere: `updatePlant` moves
   `next_due_on` with **no journal row**, invalidating any pending undo (V3);
   colliding `new_due_on` values defeat undo's value-based currency guard (V1); and
   the client drops watered rows from state instead of rescheduling them (V5).

Secondary but load-bearing: the harness has **nine concrete blockers**, of which
two (`astro:env/server` and `astro:actions` module resolution) must be solved before
a single integration test can even import the code under test, and one (CI has no
Docker/Supabase step, and the new tests would be swept up by the existing
`include` glob) will break `pnpm test` and the pre-commit hook the moment such a
test lands.

---

## Detailed Findings

### A. Risk #2 — the daily-list derivation path

#### A.1 The path, end to end

| Step | Location | What happens |
| --- | --- | --- |
| 1 | `src/pages/index.astro:8-9` | `/` branches on `Astro.locals.user`; the daily list **is** the authenticated home page. There is no `/today` route. |
| 2 | `src/middleware.ts:12-18` | Resolves `context.locals.today` from the `tz` cookie, falling back to `request.cf.timezone`, else `null`. |
| 3 | `src/layouts/layout.astro:19-29` | Inline head script writes the `tz` cookie — **after** the SSR that consumed it, so first paint of a fresh session is always cookie-less. |
| 4 | `src/components/authed-shell.astro:16-20` | The only fetch backing the list. **No due predicate.** |
| 5 | `src/components/authed-shell.astro:41-48, 64-66` | Maps rows to `PlantListItem` and passes *all* of them to `<TodayList client:load>`. |
| 6 | `src/components/today-list/today-list.tsx:257-259` | The actual due decision, client-side. |

The query, verbatim (`src/components/authed-shell.astro:16-20`):

```ts
const { data, error } = await supabase
  .from("plants")
  .select("id, name, growing_interval_days, dormancy_interval_days, next_due_on, photo_path")
  .order("next_due_on", { ascending: true })
  .order("name", { ascending: true });
```

No `.lte()`, no `.filter()`, no `.limit()`, no date argument. RLS
(`auth.uid() = user_id`) is the only row restriction. `src/pages/plants/index.astro:17-20`
is a separate "All plants" page and applies no due filter at all.

The predicate (`src/components/today-list/today-list.tsx:257-259`):

```ts
const dueList = today === null ? [] : optimisticPlants.filter((plant) => plant.next_due_on <= today);
const activeDueList = dueList.filter((plant) => !plant.leaving);
const nextUpcoming = today === null ? null : (basePlants.find((plant) => plant.next_due_on > today) ?? null);
```

Both operands are `YYYY-MM-DD` strings, so lexicographic `<=` is ordinally correct.
The comparison is **inclusive with no lower bound** — overdue by any amount is
included. `today` is `useBrowserToday(initialToday)` (`today-list.tsx:38` →
`src/components/hooks/use-browser-today.ts:4-12` → `src/lib/timezone.ts:153-199`),
seeded from SSR and overwritten by the browser's own `Intl` zone on mount,
`pageshow`, `visibilitychange`, and at each local midnight.

Per-row status comes from `classifyDueStatus` (`src/lib/date.ts:92-112`):
`daysDifference = toEpochDay(today) - toEpochDay(dueDate)`; `0` → `due-today`,
`>= 3` → `overdue-strong`, else `overdue`. It **throws `RangeError`** on a negative
difference or an invalid date.

#### A.2 Silent-drop mechanisms present today

1. **`today === null` renders an empty list.** `today-list.tsx:257` short-circuits
   to `[]` and `:291-301` shows a "Finding your local date…" placeholder. Reached
   whenever the `tz` cookie *and* `request.cf.timezone` are both absent — local
   `astro dev`, `wrangler dev` without cf data, cookie-blocked browsers, and every
   first-ever visit. Mitigated by distinct copy (a deliberate outcome of
   `context/archive/2026-07-26-today-acquisition-defects/`, D-3), but it is still
   a state where a due plant is not shown.
2. **PostgREST `max_rows = 1000`** (`supabase/config.toml:18`) silently caps the
   query. `error` stays `null`, so the app cannot see the truncation. Because rows
   are ordered by `next_due_on` ascending, upcoming rows are dropped first and
   overdue rows last — but this is luck, not design. Corroborates archived finding
   F8 ("`loadPlants` is unbounded, no `.limit()`/pagination",
   `context/archive/2026-07-19-core-watering-loop/reviews/impl-review.md:110`).
3. **`activeDueList` vs `dueList` divergence during the removal animation.**
   `:337` gates the empty state on `activeDueList.length === 0` while `:351` maps
   `dueList`. For up to `ANIMATION_MS = 190`, a still-present due row can coexist
   with the "Nothing needs water today." branch being selected — and that branch
   does not render rows.
4. **`basePlants` is never refetched** (`:40`). A tab left open past local midnight
   correctly re-buckets the already-fetched set, but any server-side due-date
   change from another device is invisible until reload.
5. **The due predicate exists in three independent places**, none of them the
   database: `:257` (`<= today`), `:259` (`> today`), `:224`
   (`data.restored_due_on > currentToday`). This is exactly the drift shape
   recorded in `context/foundation/lessons.md:5-10` and cited as evidence for
   Risk #1.
6. **`classifyDueStatus` throws rather than dropping** (`src/lib/date.ts:94, 100`).
   Currently unreachable — the filter and the classifier use the same `today` in
   the same render, verified in
   `context/archive/2026-07-24-user-timezone-dates/reviews/impl-review.md:166` —
   but a divergence would crash the island rather than lose one row.

#### A.3 What the seed does and does not cover

`supabase/seed.sql:75-86` — one user (`test@yapca.local` / `password`, id
`a7c29f41-…-d9e215c70401`) and exactly three plants:

| Name | growing/dormancy | `next_due_on` | Case |
| --- | --- | --- | --- |
| Monstera | 7 / 30 | `current_date` | due today ✅ |
| Snake plant | 21 / 21 | `current_date + 5` | not yet due ✅ |
| Peace lily | 4 / 14 | `current_date - 1` | overdue by 1 ✅ |

**Missing: overdue-by-many.** No row at `current_date - 3` or beyond, so
`classifyDueStatus`'s `overdue-strong` branch (`src/lib/date.ts:107`) is
unexercised by the seed. Also no second user (Phase 3's concern, but worth noting
now since Phase 3 is sequenced to reuse this harness). Note the dates are relative
to `current_date`, so the seeded set is **not deterministic across days** — a suite
depending on it must pin its own `clientDate`.

---

### B. Risk #3 — edit plant and interval recalculation

#### B.1 The `plants` row, complete

Union of `supabase/migrations/20260719120000_create_plants.sql:4-13` and
`20260724120000_add_season_aware_intervals.sql:4-17`. **Only 5 migrations exist.**

| Column | Type / constraint |
| --- | --- |
| `id` | `uuid pk default gen_random_uuid()` |
| `user_id` | `uuid not null → auth.users(id) on delete cascade` |
| `name` | `text not null` (no length or format check) |
| `growing_interval_days` | `int not null`, `check between 1 and 365` |
| `dormancy_interval_days` | `int not null`, `check between 1 and 365` |
| `next_due_on` | `date not null`, **no default, no check** |
| `photo_path` | `text` nullable |
| `created_at` | `timestamptz not null default now()` |
| `updated_at` | `timestamptz not null default now()` |

`interval_days` was **dropped** (`20260724120000:17`). No generated columns. One
trigger, `plants_set_updated_at` BEFORE UPDATE FOR EACH ROW
(`20260719120000:27-30`) — it fires on *every* update including the RPCs, which is
what makes the `updated_at` optimistic-concurrency token work and also what makes
it fragile (see V2/V3 below).

`src/types.ts:3` defines `Plant` as the raw row, and `updatePlant` returns the full
row via `.select().maybeSingle()` (`src/actions/index.ts:172`) — so there is **no
DTO-level field drop**. Narrowed read shapes exist for display only
(`PlantListItem` at `types.ts:56-63`, `PlantEdit` at `edit.astro:9-17`).

#### B.2 The write path

`src/actions/index.ts:159-172`, verbatim:

```ts
const payload = {
  name: input.name,
  growing_interval_days: input.growing_interval_days,
  dormancy_interval_days: input.dormancy_interval_days,
  ...(nextPhotoPath !== undefined ? { photo_path: nextPhotoPath } : {}),
  ...(scheduleChange.deltaDays !== 0 ? { next_due_on: scheduleChange.newNextDue } : {}),
};
let query = supabase.from("plants").update(payload).eq("id", input.plantId);

if (scheduleChange.deltaDays !== 0) {
  query = query.eq("updated_at", input.updated_at);
}
```

This is a **correctly-built partial patch** — `photo_path` and `next_due_on` are
absent as keys (not `null`) when unchanged. Ownership rests on RLS alone; there is
no `.eq("user_id", user.id)` on the read (`:117`) or the write (`:166`).

The form hand-builds its `FormData` in `onSubmit`
(`src/components/edit-plant-form/edit-plant-form.tsx:73-85`) rather than submitting
the DOM form, so the inputs' `name` attributes are inert. It sends `plantId`,
`name` (trimmed), both intervals as strings, `removePhoto`, `updated_at` verbatim,
`clientDate`, and `photo` only on replace. **No empty-string→null transformation
exists anywhere in this path** — the only coercions are `String(number)` client-side
and `z.coerce.number().int().min(1).max(365)` server-side (`:102-103`). No column
can be nulled by a blank input.

#### B.3 The recalculation rule — precise

**Next-due is recalculated from the stored previous due date, shifted by the
interval delta. It is NOT recalculated from the last actual watering.**

`src/lib/schedule.ts:19-37`:

```
season            = getSeason(activeDay)                                     // season.ts:14-21, month 3..10 = growing
oldActiveInterval = selectSeasonInterval(activeDay, oldGrowing, oldDormancy)  // season.ts:23-31
newActiveInterval = selectSeasonInterval(activeDay, newGrowing, newDormancy)
deltaDays         = newActiveInterval - oldActiveInterval                     // schedule.ts:30
newNextDue        = fromEpochDay(toEpochDay(oldNextDue) + deltaDays)          // schedule.ts:35
```

`activeDay` is the **browser-supplied date**, validated to ±1 day of UTC today
(`src/lib/date.ts:43-51`, invoked at `src/actions/index.ts:111`). Arithmetic is UTC
epoch-day, DST-proof. **No clamping** — the result may land in the past, deliberately
(pinned by `src/lib/schedule.test.ts:33-41`). Invoked on edit at
`src/actions/index.ts:128-135` with old values read fresh from the database at
`:112-118`. The same function drives the client preview
(`src/components/edit-plant-form/utils.ts:60-67`).

> **Test-plan correction required.** `context/foundation/test-plan.md:80` says the
> proof for Risk #3 is that "the next-due date matches the documented recalculation
> from the last actual watering." That is `mark_watered`'s rule
> (`20260724120000:67`, `next_due_on = acted_on + interval`), not the edit path's.
> The archived design is explicit:
> `context/archive/2026-07-25-edit-plant-and-recalc/plan.md:125` and
> `design.md:123-128`. Asserting the plan's wording literally would produce a false
> failure. Related trap: `plan.md:125-126` — "`oldNextDue + delta` is the contract
> even when the result is in the past; clamping would make the rule non-invertible."
> A test asserting `newNextDue >= today` encodes the wrong rule.

#### B.4 Photo handling — three intents

`PhotoIntent = "keep" | "replace" | "remove"`
(`src/components/edit-plant-form/types.ts:12`); server derives `nextPhotoPath` at
`src/actions/index.ts:136-142`.

| Intent | `photo` sent | `removePhoto` | `nextPhotoPath` | Key in payload | Storage effect |
| --- | --- | --- | --- | --- | --- |
| keep | no | `"false"` | `undefined` | **absent** → preserved | none |
| replace | yes | `"false"` | new `{userId}/{uuid}.{ext}` (`photo.ts:21-29`) | set | new object uploaded (`:148-150`); old deleted after successful update (`:186-193`) |
| remove | no | `"true"` | `null` | set to `null` | old object deleted |

Rollback on any post-upload throw removes the new object (`:197-204`). Cleanup
failures are logged, never thrown.

#### B.5 Field → edit-path behaviour

| Field | Written | Preserved | Null risk |
| --- | --- | --- | --- |
| `id` | never | yes (filter key) | none |
| `user_id` | never | yes | none from this code; see V6 |
| `name` | always (`:160`) | n/a | none — `min(1)` both sides |
| `growing_interval_days` | always (`:161`) | n/a | none |
| `dormancy_interval_days` | always (`:162`) | n/a | none |
| `next_due_on` | **only when `deltaDays !== 0`** (`:164`) | yes when delta 0 | none |
| `photo_path` | only on replace/remove (`:163`) | yes on "keep" | intentional `null` on remove only |
| `created_at` | never | yes | none |
| `updated_at` | trigger-only | rewritten every UPDATE | none |

---

### C. Risk #4 — water / postpone / undo and the journal

#### C.1 Mutation entry points

All mutations are Astro Actions in `src/actions/index.ts`. `src/pages/api/**`
contains only auth routes. There is no direct client write to `plants` or
`watering_events` anywhere in `src/` — `watering_events` is only ever read, at
`src/pages/plants/[id].astro:47`.

| Action | file:line | Input | Write | Atomicity |
| --- | --- | --- | --- | --- |
| `markWatered` | `:215-243` | `{ plantId, clientDate? }` | `rpc("mark_watered")` | **atomic** (one plpgsql fn) |
| `postponePlant` | `:245-276` | `{ plantId, clientDate? }` | `rpc("postpone_plant")` | **atomic** |
| `undoWateringEvent` | `:278-308` | `{ eventId }` — no plantId, no clientDate | `rpc("undo_watering_event")` | **atomic** |
| `updatePlant` | `:97-213` | see §B | storage upload → row update → old-photo delete | **not atomic** — three sequential calls |

All three schedule actions call `requireSession` (`:13-21`); the two forward ones
call `getActionDate` (`:23-31`), rejecting a client date more than 1 day from UTC
today with `PRECONDITION_FAILED`. Error mapping: `P0002` → `NOT_FOUND`; `P0003` →
`CONFLICT` (undo only, `:299-301`).

#### C.2 The journal table and RLS

`watering_events` (`20260720120000_create_watering_events.sql:5-14`, column
`watered_on` renamed to `acted_on` at `20260723120000:4`):

```
id, plant_id → plants(id) cascade, user_id → auth.users(id) cascade,
event_type text not null default 'watered' check in ('watered','postponed'),
acted_on date not null, prev_due_on date not null, new_due_on date not null,
created_at timestamptz not null default now()
```

Index `(plant_id, created_at desc)`. **No triggers, no `updated_at`, no
tombstone column.**

After `20260723120000:12-14`, `insert` and `delete` are **revoked** from
`authenticated` and the corresponding policies dropped. Only
`watering_events_select_own` survives. Every write goes through the RPCs, which are
`security definer` + `set search_path = ''` — they **bypass RLS**, and ownership
rests entirely on hand-written `user_id = v_user_id` predicates plus `28000`
null-uid guards.

#### C.3 Postpone semantics

`20260723120000_add_postpone_and_undo.sql:101` — the load-bearing line:

```sql
v_new_due_on := p_acted_on + 2;
```

- Shifts to **`acted_on + 2`**, *not* `prev_due_on + 2`. For an overdue plant this
  is not "+2 days" — it jumps from a past date to today+2. This was deliberate
  (`context/archive/2026-07-23-postpone-and-undo/plan.md:34`: "Postponing from the
  old scheduled date could leave an overdue task in Today").
- **Does not touch either interval column.** The next `mark_watered` reschedules
  from `acted_on + interval` and forgets the postpone entirely.
- **Always writes a journal row** with `event_type='postponed'` (`:107-109`).
- Repeated postpones **do not compound within a day** (both yield `T+2`) but **do
  across days**. A same-day double postpone writes a row with
  `prev_due_on = new_due_on` — a no-op journal entry.

> **PRD divergence to flag.** `context/foundation/prd.md:56` (US-01 AC) says
> "'Postpone 2 days' moves the task exactly 2 days forward"; `prd.md:141` says it
> "shifts a single task forward by two days." The shipped rule is `action date + 2`.
> For an overdue plant the two readings give different answers. The UI copy
> ("Postpone 2 days", `src/components/today-list/utils.ts:16`; "Postponed 2 days",
> `src/pages/plants/[id].astro:141`) follows the PRD wording, not the behaviour.
> A Phase 2 test must assert the *implemented* contract and the plan should record
> the divergence explicitly rather than silently pick a side.

#### C.4 Undo semantics

**Identification is by explicit event id only — never "the latest."**
`src/actions/index.ts:280` takes `eventId`; the client passes the toast id, which
*is* the event id (`today-list.tsx:104` → `:211`).

The only recency guard (`20260723120000:137-158`):

```sql
select e.plant_id, e.prev_due_on, e.new_due_on into v_plant_id, v_prev_due_on, v_new_due_on
from public.watering_events as e where e.id = p_event_id and e.user_id = v_user_id for update;
if not found then raise exception 'Event not found' using errcode = 'P0002'; end if;

perform 1 from public.plants as p where p.id = v_plant_id and p.user_id = v_user_id for update;
if not found then raise exception 'Plant not found' using errcode = 'P0002'; end if;

if (select p.next_due_on from public.plants as p where p.id = v_plant_id) <> v_new_due_on then
  raise exception 'Event is no longer current' using errcode = 'P0003';
end if;

update public.plants set next_due_on = v_prev_due_on where id = v_plant_id and user_id = v_user_id;
delete from public.watering_events where id = p_event_id and user_id = v_user_id;
```

- Restores `plants.next_due_on = event.prev_due_on`. Nothing else.
- **Hard-deletes** the journal row (`:164`) — intentional, per
  `context/archive/2026-07-23-postpone-and-undo/plan.md:229`.
- **No time window.** The 10-second affordance is client-only and was explicitly
  specified as "not a server-clock authorization rule"
  (`.../plan.md:59, 102`). **Do not write a server-side expiry test.**
- **Double undo of the same event is not idempotent-success and does not walk
  backwards twice.** The second call finds no row → `P0002` → `NOT_FOUND "Event not
  found."` (`src/actions/index.ts:295-297`). Two *concurrent* undos are serialized
  by `for update`; the loser also gets `P0002`. Safe, but the caller cannot
  distinguish "already undone" from "never existed."

#### C.5 The `water → undo → postpone → undo` trace

Plant P, `next_due_on = D0`, growing interval `I`, action date `T`:

| Step | `plants.next_due_on` | `watering_events` |
| --- | --- | --- |
| start | `D0` | ∅ |
| water(T) | `T + I` | `E1{watered, acted_on=T, prev=D0, new=T+I}` |
| undo(E1) | `D0` | ∅ |
| postpone(T) | `T + 2` | `E2{postponed, acted_on=T, prev=D0, new=T+2}` |
| undo(E2) | `D0` | ∅ |

**Server-side this sequence is consistent** and returns to the original state.
Note `E2.prev` is `D0`, the *restored* date. Unclear/unspecified edges: when
`I == 2` the guard cannot distinguish a water from a postpone (V1); nothing
enforces that a plant is actually due before watering or postponing (V11).

---

### D. Inconsistency and data-loss vectors present today

These are the concrete regression-test candidates. Numbering follows the
sub-agent analyses; `V*` are mutation/consistency vectors.

| # | Vector | Location | Risk |
| --- | --- | --- | --- |
| V1 | **Out-of-order undo when `new_due_on` values collide.** Two same-day postpones give `E1{prev=D0,new=T+2}` and `E2{prev=T+2,new=T+2}`. Undoing E1 first passes the value-based guard, sets due to `D0`, deletes E1 — leaving E2 permanently un-undoable (`P0003`) and claiming a transition that no longer holds. Same collision when `interval == 2`. | `20260723120000:156` | #4 |
| V2 | **Same-day double postpone writes a no-op journal row** (`prev = new`), rendered as "Due 30 Jul → 30 Jul" (`src/pages/plants/[id].astro:143`); its undo changes nothing while the UI reports a restore. | `20260723120000:101-109` | #4 |
| V3 | **`updatePlant` moves `next_due_on` with no journal row.** Any pending undo then fails `P0003`; the journal's last `new_due_on` no longer matches the plant. Conversely the RPCs fire `plants_set_updated_at`, invalidating `updatePlant`'s optimistic lock and turning a legitimate concurrent edit into a spurious `CONFLICT`. | `src/actions/index.ts:164`; `20260719120000:27-30` | #3 + #4 |
| V4 | **Successful mutation with no client update if the row unmounts within 190 ms.** `scheduleRemoval` defers the toast behind `setTimeout(ANIMATION_MS)`; the cleanup effect clears it on unmount. The write is committed but the event id exists only in a discarded closure — **the user can never undo.** | `today-list.tsx:88-101, 265-273` | #4 |
| V5 | **Watered/postponed plants vanish from client state instead of rescheduling.** `removePlant` drops the row from `basePlants`, so `nextUpcoming` stops accounting for it. | `today-list.tsx:83-86, 259` | #2 + #4 |
| V6 | **Undo restores a stale snapshot** — only `next_due_on` is refreshed; name, intervals and photo are the press-time copy. | `today-list.tsx:105, 220-229` | #4 |
| V7 | **Undo failure leaves the client permanently out of sync** — a Retry toast, but the plant stays absent from `basePlants` and every retry re-fails identically. | `today-list.tsx:238-249` | #4 |
| V8 | **Second undo returns `NOT_FOUND`, not a no-op.** A caller retrying after a network timeout on a committed undo cannot tell whether it applied. | `src/actions/index.ts:295-297` | #4 |
| V9 | **The season rule is duplicated in SQL and TypeScript**, held together only by comments. `mark_watered` uses the SQL branch; `addPlant`/`updatePlant`/the Today label use `src/lib/season.ts`. Drift produces a due date that disagrees with the displayed interval. | `20260724120000:60-65` vs `src/lib/season.ts:14-31` | #4 + #6 |
| V10 | **`acted_on` is browser-supplied** (±1 day tolerance). Two devices in different zones produce journal rows differing by a day for the same wall-clock action. | `src/lib/date.ts:43-51` | #1 + #4 |
| V11 | **No due-state precondition** on either RPC — a direct action call can postpone a future-dated plant *backwards* while the journal labels it "Postponed." | `20260723120000:101` | #4 |
| V12 | **Lock-order asymmetry** — forward paths lock `plants` first, undo locks `watering_events` then `plants`. No cycle today (forward paths only insert events), but a latent deadlock shape. | `20260723120000:141, 150` | #4 |
| E1 | **Optimistic-concurrency guard is conditional.** `.eq("updated_at", …)` is attached only when `deltaDays !== 0`, so a name-only or photo-only edit has no stale-write protection. Deliberate (`archive/2026-07-25-edit-plant-and-recalc/plan.md:153`) but a genuine lost-update window. | `src/actions/index.ts:168-170` | #3 |
| E2 | **Delta is computed from a fresh re-read; the guard compares a page-load token.** Conservative (yields `CONFLICT`, no corruption), but the two sources of truth differ, and there is no row lock between the read (`:112-118`) and the update (`:166`). | `src/actions/index.ts:112-170` | #3 |
| E3 | **A failed signed-URL fetch makes an existing photo invisible *and* unremovable.** `resolvePhotoUrl` returns `null` on error; `photoRemovable = photoUrl !== null \|\| photoIntent === "replace"` hides the Remove button even though `photo_path` is still set. The form never receives `photo_path`, so it cannot distinguish "no photo" from "URL unavailable." | `src/lib/photo.ts:31-38`; `edit-plant-form.tsx:114` | #3 |
| E4 | **Orphaned storage objects** — old-photo deletion and post-failure cleanup are best-effort and only `console.error`'d. No reconciliation job. Known accepted debt (`archive/2026-07-25-edit-plant-and-recalc/plan.md:634-642`). | `src/actions/index.ts:187, 198` | #3 |
| E5 | **Server accepts `photo` + `removePhoto=true` simultaneously** and silently resolves to "replace." Unreachable from the UI, reachable by direct POST. | `src/actions/index.ts:138-142` | #3 |
| E6 | **`plants_update_own` has `using` but no `with check`** — the policy authorizes *which rows* may be updated, not *what they may become*. `user_id` reassignment is not blocked at the database layer. Not exercised by current code. | `20260719120000:49-52` | #3 + #5 |
| E7 | **`next_due_on` has no CHECK constraint** and the recalculation deliberately does not clamp. Any invariant test must use the delta formula, not a plausibility range. | `20260719120000:9`; `schedule.test.ts:33-41` | #3 |

---

### E. Harness feasibility — the seeded-database integration substrate

#### E.1 Current runner configuration

`vitest.config.ts` in full (17 lines) — note the comment is a settled decision
record, not an aspiration:

```ts
// Astro's `getViteConfig()` is the documented path here, but it resolves the real
// astro.config.mjs, which loads the Cloudflare adapter and forces a workers runner —
// the suite then dies at startup with `ReferenceError: exports is not defined` before
// any test loads. …
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    environment: "node",
    env: { TZ: process.env.TZ ?? "UTC" },
  },
});
```

No `exclude`, no `projects`, **no `setupFiles`**, **no `globals`** (tests import
`describe`/`expect`/`test` explicitly), no `testTimeout` override (default 5000 ms —
too low for database round-trips), no `resolve.alias`.

Scripts (`package.json:16-18`): `test`, `test:watch`, `test:mutants`. No
integration or supabase scripts. `lefthook.yml:9-11` runs
`pnpm run vitest related {staged_files} --run` pre-commit. `.github/workflows/ci.yml:31-40`
runs lint → check → `pnpm test` → `TZ=America/New_York pnpm test` → build, with
**no Docker or Supabase service**.

ESLint test override (`eslint.config.js:164-176`) disables exactly three rules and
adds `vitest/consistent-test-it` with `fn: "test"` — so **`it()` is a lint error**.

#### E.2 Established idiom (Phase 1)

Explicit vitest imports; **relative** import of the module under test, with exactly
one deliberate `@/` exception (`src/lib/season.test.ts` — the alias canary, which
`context/foundation/test-plan.md:190-195` forbids normalising); `describe` named
after the *function*, not the module (`context/foundation/lessons.md:26-31`);
`test.each` tables with a comment justifying why the expected value is independent
of the implementation. Example, `src/lib/schedule.test.ts:1-31`:

```ts
describe("resolveScheduleChange", () => {
  // Interval values are literal rather than derived from the expected delta, so
  // the delta assertion is grounded independently of the subtraction under test.
  test.each([[10, 3, "2024-03-23"], [4, -3, "2024-03-17"], [7, 0, "2024-03-20"]] as const)(...)
```

`src/lib/season.test.ts:7-11` contains a direct instruction to this phase:

> The authoritative TypeScript season-boundary table. Every date asserted by
> `supabase/tests/season-aware-intervals.sql` appears here verbatim; test-plan
> Phase 2 must reconcile the SQL script against this table — by lifting it into a
> shared harness or deriving the SQL cases from it — rather than adding a third copy.

#### E.3 Local Supabase stack

| Key | `supabase/config.toml` | Value |
| --- | --- | --- |
| `api.port` | :10 | `54321` |
| `db.port` | :27 | `54322` |
| `db.major_version` | :36 | `17` |
| `db.seed.enabled` / `sql_paths` | :62, :65 | `true` / `["./seed.sql"]` |
| `auth.rate_limit.sign_in_sign_ups` | :189 | **30 per 5 min per IP** |
| **`auth.email.enable_confirmations`** | **:209** | **`true` — confirmation is ON locally** |
| `storage.file_size_limit` | :112 | `50MiB` |

`supabase/seed.sql:9-71` inserts a fixed `auth.users` row with
`email_confirmed_at = now()` plus a matching `auth.identities` row — **this is the
in-repo proven pattern for minting a confirmed user without a service-role key.**
All inserts are `on conflict … do update`, so the seed is idempotent.

`supabase/tests/season-aware-intervals.sql` is a working `begin;`…`rollback;`
script that creates its own two users and impersonates via
`set local role authenticated` + `set local request.jwt.claims` (`:28-29, :92`).
**Nothing invokes it** — verified across `package.json`, `lefthook.yml` and
`ci.yml`. Its run instruction exists only as a comment on line 2. It is currently
the *only* executable proof of `postpone = +2`, undo restoration, and cross-account
`P0002` behaviour.

#### E.4 Blockers

**B1 — `astro:env/server` has no runtime module.** `.astro/env.d.ts` is a
type-only declaration; the identifier is supplied by Astro's Vite plugin at
build/dev time. Any test that transitively imports `src/lib/supabase.ts` — which
includes `src/actions/index.ts`, `src/middleware.ts`, and every `.astro` page —
fails at resolution. Options, cheapest first:
  1. `resolve.alias: { "astro:env/server": <abs path to shim> }` where the shim
     re-exports `process.env`. Keeps production code untouched. Needs an explicit
     dotenv step — Vite's `loadEnv` only picks up `VITE_`-prefixed vars, and these
     are unprefixed.
  2. Extract a `createClientFrom(url, key, …)` factory so the `astro:env/server`
     read is confined to a thin Astro-side wrapper. Small production refactor; the
     only option that also lets Stryker mutate `supabase.ts`.
  3. `getViteConfig()` — **a settled dead end**, reproduced directly, not inferred
     (`vitest.config.ts:1-6`;
     `context/archive/2026-07-26-testing-runner-and-calendar-math/plan.md` Critical
     Implementation Details: "Do not 'restore' `getViteConfig()` in a later phase").

**B2 — `astro:actions` is the harder one.** Its server resolution is
`export * from 'astro/actions/runtime/entrypoints/server.js'`, and *that entrypoint
itself imports* `virtual:astro:actions/options`. So aliasing to the published
entrypoint does not work. Only an alias to a local shim re-exporting from
`node_modules/astro/dist/actions/runtime/server.js` (`defineAction`,
`getActionContext`) and `.../client.js` (`ActionError`, `isActionError`,
`isInputError`) by **absolute filesystem path** works — neither file imports a
`virtual:` id. These are not in astro's `exports` map, so this is coupled to
Astro's internal layout and is genuine upgrade-fragility the plan must name.

**B3 — Risk #2's predicate is client-side.** See §A.1. An integration test at the
Action/DB layer cannot exercise it, and test-plan §7 excludes rendering the island.
Three ways out:
  - **(a)** Integration-test only the *query* (the seeded set is returned intact,
    unfiltered, correctly ordered) and unit-test the predicate — but the predicate
    is an inline arrow in a `.tsx` component, so this requires extracting it.
  - **(b) Extract the derivation into `src/components/today-list/utils.ts` or
    `src/lib/` first**, then unit-test it directly and integration-test the query.
    This is the option `context/foundation/lessons.md:5-10` already argues for
    (the predicate exists in three places today, §A.2 item 5), and it converts a
    plan conflict into a lessons-compliant refactor.
  - **(c)** Buy a browser layer — explicitly out of scope, and `test-plan.md:252-259`
    already schedules that re-evaluation for roadmap slice S-09.
  Recommendation: **(b)**, with (a)'s query assertion alongside it.

**B4 — Action invocation mechanics.** The raw handlers are not exported;
`defineAction` returns a function whose context arrives as **`this`**
(`node_modules/astro/dist/actions/runtime/server.js:20-40`). So
`server.markWatered.orThrow.call(ctx, formData)` works with no HTTP server. The
non-`orThrow` form additionally requires
`Reflect.get(ctx, Symbol.for("astro.actionAPIContext")) === true` (`server.js:205-208`);
`orThrow` does not, making it the lowest-ceremony path (it throws `ActionError`
rather than returning `{data, error}`). `accept: "form"` means input must be real
`FormData`. The context needs `{ request, cookies, locals: { user } }`, with a
`cookies.set()` stub because `@supabase/ssr` writes refreshed session cookies
(`src/lib/supabase.ts:19-23`).

**B5 — Auth fixtures.** Email confirmation is ON locally
(`config.toml:209`) and **no service-role key exists anywhere** in
`.env.example`, `astro.config.mjs`, `wrangler.jsonc`, or any source file. Three
strategies, least new machinery first:
  1. **Direct psql insert following the seed's own pattern**
     (`postgres://postgres:postgres@127.0.0.1:54322/postgres`), then
     `signInWithPassword` through the anon-key client for a real `authenticated`
     JWT. Only path that exercises RLS as production does; proven twice in-repo
     (`seed.sql:9-71`, `supabase/tests/season-aware-intervals.sql:13-17`).
  2. Service-role admin API (`auth.admin.createUser({ email_confirm: true })`) —
     requires sourcing the key from `supabase status`; must be used *only* to mint
     users, never to read/write plants.
  3. Flip `enable_confirmations = false` — rejected by `README.md:36` on production
     parity grounds.
  Watch `sign_in_sign_ups = 30` per 5 min per IP.

**B6 — No reset or isolation machinery exists.** `pnpx supabase db reset` is
documented in `README.md:44-51` only; no script, hook, or CI job runs it. Options:
  - **Per-test user namespacing (recommended)** — each test mints its own
    `auth.users` row and plants keyed on a fresh uuid; RLS then guarantees
    isolation, so parallel files are safe with no reset. Cost: `auth.users` grows;
    bound it with a `truncate auth.users cascade` in `globalSetup` (plants and
    watering_events cascade).
  - Transaction rollback — proven for pure-SQL tests but **cannot wrap an Action
    call**, which goes over PostgREST on a separate connection.
  - Truncate between tests — fast but serializes the suite and does not clean
    `auth.users`.

**B7 — CI cannot run these tests today**, and worse, new `src/**/*.test.ts` files
are swept up by the existing `include` glob — so integration tests **break
`pnpm test` and the lefthook pre-commit hook the moment they land**. Phase 2 needs
an include/exclude split (Vitest `projects`, or `*.integration.test.ts` excluded
from the default project) **before writing a single test**.

**B8 — `supabase/tests/season-aware-intervals.sql` is dead weight.** Nothing
invokes it, yet it is the only executable proof of the Risk #4 SQL contracts. Give
it a runner script, and reconcile its boundary dates against `SEASON_BOUNDARIES`
per §E.2 rather than adding a third copy.

**B9 — Vitest's default 5 s `testTimeout` is too low** for database round-trips,
and there is no `setupFiles` hook to load `.env`.

#### E.5 Stryker — current config and narrowed targets

`stryker.config.json` in full: `mutate: ["src/**/*.{ts,tsx}", "!src/**/*.spec.*", "!src/**/*.test.*"]`,
`testRunner: "vitest"`, `coverageAnalysis: "perTest"`, `concurrency: 4`,
`thresholds: { high: 80, low: 60, break: null }`, `incremental: true`, no `ignorers`.
`.astro` files are **not** mutated; neither is SQL. `reports/stryker-incremental.json`
exists (1 MB) and `reports/` is **not** gitignored.

Narrowed `--mutate` targets, per risk:

| Risk | Target | Range | Owns |
| --- | --- | --- | --- |
| #2 | `src/components/today-list/today-list.tsx` | `253-259` | `dueList` / `activeDueList` / `nextUpcoming` — the boundary comparison |
| #2 | `src/components/today-list/today-list.tsx` | `220-229` | undo re-insert predicate + re-sort (overlaps #4) |
| #2 | `src/lib/date.ts` | `80-112` | `compareDueRecords`, `classifyDueStatus` (`>= 3` threshold, `< 0` guard) |
| #2 | `src/components/today-list/utils.ts` | `27-37` | `formatOverdueDate` year-boundary branch |
| #3 | `src/actions/index.ts` | `109-212` | `updatePlant`: conditional payload spread (`159-165`), CAS gating (`166-170`), CONFLICT-vs-NOT_FOUND (`178-184`) |
| #3 | `src/lib/schedule.ts` | `11-38` | `resolveScheduleChange` — already unit-covered; include to prove the new integration assertions aren't tautological |
| #3 | `src/components/edit-plant-form/utils.ts` | `45-100` | `isValidInterval`, `buildSchedulePreview` |
| #4 | `src/actions/index.ts` | `215-243` / `245-276` / `278-308` | `markWatered` / `postponePlant` / `undoWateringEvent` (incl. `P0003` → CONFLICT) |
| #4 | `src/actions/index.ts` | `13-31` | `requireSession` / `getActionDate` |

Scriptable form:

```
pnpm exec stryker run \
  --mutate "src/actions/index.ts:215-308" \
  --mutate "src/components/today-list/today-list.tsx:220-259" \
  --incremental false
```

> **Stryker caveat the plan must absorb.** The `+2` postpone constant, the season
> branch, and the undo currency check all live in **PL/pgSQL**
> (`20260723120000:101, :156`; `20260724120000:57-65`), which Stryker cannot
> mutate. The mutation audit for Risk #4 covers only the thin TypeScript
> error-mapping layer. The business logic's sole mutation-equivalent check is the
> SQL script from B8 — which nothing currently runs.

---

## Code References

- `src/components/authed-shell.astro:16-20` — the unfiltered list query (no due predicate)
- `src/components/today-list/today-list.tsx:257-259` — the real due/overdue predicate, client-side
- `src/components/today-list/today-list.tsx:220-229` — undo re-insert condition
- `src/components/today-list/today-list.tsx:83-101, 265-273` — optimistic removal + the 190 ms timer (V4, V5)
- `src/lib/date.ts:43-51` — `getActionDate` ±1-day client-date validation
- `src/lib/date.ts:92-112` — `classifyDueStatus`, incl. the throwing guards
- `src/lib/schedule.ts:19-37` — the interval-delta recalculation (Risk #3's actual rule)
- `src/actions/index.ts:13-31` — `requireSession` / `getActionDate`
- `src/actions/index.ts:97-213` — `updatePlant`, the only non-atomic mutation
- `src/actions/index.ts:159-172` — the conditional-spread payload and CAS guard
- `src/actions/index.ts:215-308` — `markWatered` / `postponePlant` / `undoWateringEvent`
- `supabase/migrations/20260719120000_create_plants.sql:27-30, 49-52` — `updated_at` trigger; the `with check`-less policy
- `supabase/migrations/20260720120000_create_watering_events.sql:5-16` — journal schema
- `supabase/migrations/20260723120000_add_postpone_and_undo.sql:101` — `v_new_due_on := p_acted_on + 2`
- `supabase/migrations/20260723120000_add_postpone_and_undo.sql:137-168` — `undo_watering_event` body
- `supabase/migrations/20260724120000_add_season_aware_intervals.sql:19-79` — the *final* `mark_watered`
- `supabase/seed.sql:9-71` — the confirmed-user insert pattern to reuse for fixtures
- `supabase/tests/season-aware-intervals.sql:13-17, 28-29, 92` — impersonation pattern; currently un-invoked
- `vitest.config.ts:1-17` — runner config and the settled `getViteConfig()` rejection
- `stryker.config.json` — advisory-only mutation config
- `supabase/config.toml:18, 189, 209` — `max_rows`, sign-in rate limit, confirmations ON
- `.github/workflows/ci.yml:31-40` — CI has no Docker/Supabase step

## Architecture Insights

1. **The due decision was never centralised.** Three independent comparisons live
   in one component and none of them is the database. This is precisely the
   duplication shape recorded in `context/foundation/lessons.md:5-10`, and it was
   knowingly accepted: `context/archive/2026-07-24-user-timezone-dates/reviews/impl-review.md:81-98`
   (F4) records that `authed-shell.astro` "never took over due-filtering" and
   parked it as addendum A1.
2. **Atomicity is well-handled where it was designed for, and absent where it
   wasn't.** The three schedule mutations are single `security definer` RPCs with
   row locks. `updatePlant` — added later, in a different slice — is three
   sequential calls and writes no journal row. The seam between those two design
   eras is where V3 lives.
3. **The season rule is implemented twice in two languages** (`src/lib/season.ts`
   and `mark_watered`), cross-referenced only by comments. This was explicitly
   logged as accepted debt
   (`context/archive/2026-07-25-edit-plant-and-recalc/plan.md:634-642`) and is the
   single highest-value target for the SQL/TS parity assertion Phase 1 deferred to
   this phase.
4. **Ownership rests on two different mechanisms.** Table access uses RLS; RPC
   access bypasses RLS (`security definer`) and relies on hand-written
   `user_id = v_user_id` predicates. A harness that mints users via a service-role
   client would silently test neither. This is why the direct-psql fixture pattern
   (B5 option 1) matters beyond convenience.
5. **`security definer` + `set search_path = ''`** is applied consistently across
   all three functions — a good pattern worth preserving in any new SQL.

## Historical Context (from prior changes)

Constraints that a Phase 2 test must honour, or it will assert the wrong thing:

- **Postpone is `action date + 2`, not `old due + 2`** —
  `context/archive/2026-07-23-postpone-and-undo/plan.md:23, 34`. Deliberate:
  postponing from the old date could leave an overdue task in Today.
- **The 10-second undo window is a client affordance only** —
  `.../plan.md:59, 102`: "Do not enforce the ten-second window on the server."
- **Undo deletes the event; there is no Undone record** — `.../plan.md:28, 229`.
- **The stale-undo guard is value-based, not identity-based** —
  `.../reviews/plan-review.md:27` explicitly names the adversarial case: two events
  colliding on the same `new_due_on`. That is V1, and it is now reachable via a
  same-day double postpone.
- **The journal renders `prev_due_on`, not `new_due_on`** —
  `context/archive/2026-07-20-plant-detail-and-journal/reviews/impl-review.md:23-40`
  (F1, resolved in the plan rather than the code). A "journal agrees with schedule"
  test must read `prev_due_on` as the rendered value and `new_due_on` as the
  undo/next-due value.
- **No clamping on recalculation; a past date is correct** —
  `context/archive/2026-07-25-edit-plant-and-recalc/plan.md:125-126`.
- **The `updated_at` CAS token must round-trip verbatim as a string** — passing it
  through a `Date` truncates to milliseconds and turns the guard into a permanent
  conflict. Called "the plan's single most fragile requirement" at
  `.../reviews/impl-review.md:36`.
- **`today === null` is a degraded state, not an empty day** —
  `context/archive/2026-07-26-today-acquisition-defects/plan.md:76`.
- **`getViteConfig()` is a settled dead end** —
  `context/archive/2026-07-26-testing-runner-and-calendar-math/plan.md`, Critical
  Implementation Details.
- **Phase 1 explicitly handed three things to this phase** — `.../plan.md:98`:
  "Not testing any SQL. The TS↔SQL parity assertion, `postpone = +2`, and the undo
  staleness guard all need the seeded-database harness that test-plan Phase 2 buys."

Proven past defects worth regression tests:

- **Undo could classify a restored plant using *yesterday*** across a midnight
  boundary — `context/archive/2026-07-26-today-acquisition-defects/reviews/impl-review.md:24-32`.
  A Risk #2 × Risk #4 intersection defect; fixed with a stable ref.
- **`z.coerce.boolean()` read `alreadyWatered=false` as `true`**, scheduling a
  due plant a full interval out — `context/archive/2026-07-19-core-watering-loop/reviews/impl-review.md:33-41`.
- **Server recorded a UTC date while the client showed a browser-zone date**,
  repeating on every mutation for a cookie-blocked user —
  `context/archive/2026-07-24-user-timezone-dates/reviews/impl-review.md:62-79`.
- **`isValidPhoto` used `in`**, so prototype-chain keys passed MIME validation —
  `context/archive/2026-07-25-edit-plant-and-recalc/reviews/impl-review.md:66-74`.

Three "silently green" anti-patterns this repo has already caught, worth encoding
as review criteria for Phase 2's own tests:

1. **A guarded branch that is unreachable** — the SSR seed never crossed the
   boundary, so the protective branch could not fire
   (`.../today-acquisition-defects/reviews/impl-review-phase-1.md:41-67`).
2. **A pass-through seam that asserts nothing** — a test named "reschedules from
   the newly observed day" only called a pure function twice and would pass against
   the wrong implementation (`.../impl-review-phase-1.md:69-106`).
3. **A field never asserted, so any value survives** — the `oldNextDue` case in
   Phase 1's final review.

## Related Research

- `context/archive/2026-07-26-testing-runner-and-calendar-math/` — Phase 1: runner
  bootstrap, conventions, and the explicit hand-off list to this phase.
- `context/archive/2026-07-23-postpone-and-undo/` — Risk #4's design of record.
- `context/archive/2026-07-25-edit-plant-and-recalc/` — Risk #3's design of record.
- `context/archive/2026-07-24-user-timezone-dates/` and
  `context/archive/2026-07-26-today-acquisition-defects/` — how `today` is acquired
  and why the list filter stayed client-side.

## Open Questions

1. **Does the plan extract the due predicate, or narrow Risk #2's claim?** B3
   option (b) is a small production refactor that makes the risk testable and
   satisfies `lessons.md`; option (a) leaves the predicate inline and tests only the
   query. This is the largest scope decision in the phase and it belongs to the
   plan author, not to research.
2. **Does the harness call Actions in-process (B4) or drive real HTTP?** In-process
   is far cheaper but skips Astro's middleware, `locals` population, and cookie
   round-trip. Risk #7's plan (Phase 4) will need real HTTP regardless, so the
   choice affects whether Phase 4 can reuse this harness.
3. **`test-plan.md:80` needs correcting** to the interval-delta rule. Should that
   be a `/10x-test-plan --refresh`, or an in-place amendment recorded in this
   phase's plan?
4. **The PRD/behaviour divergence on postpone** (`prd.md:56, 141` say "moves the
   task exactly 2 days forward"; the code does `action date + 2`). Is the UI copy
   the thing to fix, the PRD, or neither — with the test simply pinning the
   implemented contract?
5. **Should `supabase/tests/season-aware-intervals.sql` become a runnable gate in
   this phase, or wait for Phase 5?** It is the only mutation-equivalent check for
   the PL/pgSQL that Stryker cannot reach.
6. **Is the CI Docker/Supabase step in scope for Phase 2?** Test-plan §5 says
   integration is "required after §3 Phase 2", but CI has no Supabase service and
   Phase 5 owns gate wiring. Without it, Phase 2 delivers tests that only run
   locally.
