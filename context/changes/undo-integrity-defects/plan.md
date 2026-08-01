# Undo Integrity Defects Implementation Plan

## Overview

Undo currently decides "is this event still the current one?" by comparing a *date value*
(`plants.next_due_on <> event.new_due_on`). A value can collide and a value can drift, and each
failure mode is a shipped defect: V1 (two events landing on the same `new_due_on`) and V3 (a
schedule-changing edit moving `next_due_on` with no journal row).

This plan replaces the value comparison with an **explicit LIFO stack** — each plant points to its
current event and each event points to its predecessor — and routes schedule-changing edits through an
**atomic RPC** that shifts every event window in the plant's reachable undo stack by the same delta
it applies to the plant. The two changes together close both defects and restore the
plant↔journal invariant without inferring causality from timestamps.

## Current State Analysis

**The undo RPC** (`supabase/migrations/20260723120000_add_postpone_and_undo.sql:115-168`):

- Locks the event row, then the plant row (V12 notes this order is the inverse of the forward
  paths — a latent deadlock shape, not exercised today because forward paths only insert).
- Guards with `if (select p.next_due_on …) <> v_new_due_on then raise … errcode = 'P0003'`
  (`:156`).
- Restores with `set next_due_on = v_prev_due_on` (`:160-162`) and deletes the event.

**The edit path** (`src/actions/index.ts:109-212`):

- Re-reads the plant (`:112-118`), computes `resolveScheduleChange` in TypeScript
  (`src/lib/schedule.ts:11-38`), then issues one `supabase.from("plants").update(payload)`.
- `next_due_on` is included only when `deltaDays !== 0` (`:164`), and the `.eq("updated_at", …)`
  optimistic lock is attached only in that same case (`:168-170`) — a deliberate choice recorded in
  `context/archive/2026-07-25-edit-plant-and-recalc/plan.md:153` and pinned by
  `update-plant.integration.test.ts:269`.
- `photo_path` is a tri-state: absent (leave alone), a new path (replace), or `null` (remove) —
  expressed as `...(nextPhotoPath !== undefined ? { photo_path: nextPhotoPath } : {})` (`:163`).
- No journal row is written, so after a schedule edit the newest event's `new_due_on` no longer
  equals `plants.next_due_on`.

**The undo affordance** (`src/components/today-list/today-list.tsx:104-252`):

- Exists only as a 10-second Sonner toast keyed by `result.event_id` (`:105-118`). The plant-detail
  journal (`src/pages/plants/[id].astro:117-128`) is read-only.
- `handleUndo`'s catch-all (`:239-249`) shows one generic message with a **Retry** action for every
  failure class.
- Because a mutated plant is removed from `basePlants` (`:84-87`), two live undo toasts for one
  plant are not reachable in a single tab — V1 and V3 are reached via multi-tab/multi-device use or
  direct action calls.

**Verification substrate**:

- `pnpm test` — unit suite, `environment: "node"`, no jsdom and no Testing Library. The config
  comment records that Stryker deliberately shares this file.
- `pnpm test:integration` — seeded local Supabase, `vitest.integration.config.ts`.
- `pnpm test:sql` — a single `psql -v ON_ERROR_STOP=1` script
  (`supabase/tests/season-aware-intervals.sql`), transaction-scoped with a rollback.
- `pnpm test:mutants` — Stryker, `testFiles` excludes `*.integration.test.*`.

### Key Discoveries:

- The two skipped tests are the specification: `watering-sequence.integration.test.ts:253` (V1) and
  `:292` (V3). V1 asserts `code: "CONFLICT"` on the out-of-order undo (`:272`), which fixes the
  error contract.
- **The V3 test as currently written passes after Phase 1 alone** — with no value comparison left,
  undo restoring `prev_due_on` verbatim already yields `originalDueOn`. Only the *rewritten*
  delta-adjusted assertion needs Phase 2. This gives Phase 1 a genuine intermediate signal.
- `created_at default now()` records transaction start, not application order. It cannot define LIFO
  under contention even with an `id` tiebreak, so stack identity must be stored explicitly.
- `src/lib/database.types.ts` is generated (`pnpx supabase gen types typescript --local`), and its
  two header lines are stripped by the generator and must be re-added by hand.
- `isClientDateRejection` (`src/lib/date.ts:53-55`) is the existing precedent for a pure,
  unit-testable error-code predicate consumed by the client.
- `supabase/tests/season-aware-intervals.sql` establishes the SQL-gate pattern: `begin;` … `do $$`
  blocks raising on assertion failure … `rollback;`, self-contained (does not assume `seed.sql`).

## Desired End State

- Undoing an event is refused with `CONFLICT` unless its identity equals the plant's current event,
  regardless of what due dates events carry. A successful undo advances the pointer to the event's
  predecessor, so unwinding newest-first strands nothing.
- For an aligned stack, a schedule-changing edit moves the plant and every reachable undo window in
  one transaction, so the current event stays aligned and every subsequent pop retains the edit
  delta. Pre-migration divergent stacks are never guessed into alignment and remain non-undoable.
- Undo after such an edit restores a **delta-adjusted** date — the action is undone while the
  interval edit keeps its immediate effect.
- The undo toast distinguishes an action blocked by a newer event from a transient request failure
  and does not offer an immediately futile Retry on the former.
- Both previously skipped tests run un-skipped and green, alongside a new SQL gate.

## What We're NOT Doing

- **Not fixing V3's converse half** — the RPCs fire `plants_set_updated_at`, so a watering
  invalidates `updatePlant`'s optimistic lock and a legitimate concurrent edit gets a spurious
  `CONFLICT`. Conservative (yields a conflict, never corruption) and out of scope by decision.
- **Not adding a `rescheduled` event type** or changing the journal's rendering, the
  `watering_events_event_type_check` constraint, or the detail page.
- **Not adding jsdom / Testing Library.** The CONFLICT branch is covered by a pure `src/lib`
  predicate under the existing node-environment unit suite (see Open Risks in the brief).
- **Not touching V2, V4–V12, or E1–E7** from the defect register beyond what V1/V3 require.
- **Not changing the postpone `action date + 2` semantics** (the PRD divergence pinned at
  `watering-sequence.integration.test.ts:180-189`) or adding a due-state precondition (V11).

## Implementation Approach

Phase 1 is a self-contained SQL migration that adds explicit stack links, backfills existing rows,
updates the two forward RPCs to push events, and rewrites `undo_watering_event` to pop only the
plant's current event. It closes V1, removes timestamp ordering from the correctness boundary, makes
the currently-skipped V3 test pass in its original form, and is independently shippable.

Phase 2 introduces `update_plant_schedule`, a `security definer` function that owns the entire plant
update — the columns, the conditional `updated_at` lock, and the reachable-stack window shift — so
there is no window in which intervals landed but the schedule did not. `updatePlant` keeps photo
upload and cleanup in TypeScript around the call, and keeps computing the delta in TypeScript via
`resolveScheduleChange` so the season rule is not duplicated a third time (V9 already tracks the two
existing copies).

Phase 3 is client-only: classify the undo failure and stop offering an immediately futile Retry while
a newer event remains current. The same event may become undoable later if another client pops the
events above it.

## Critical Implementation Details

**LIFO is stored identity, not inferred chronology.** `created_at` is `timestamptz default now()`,
which records transaction start and can disagree with the order transactions acquire the plant lock.
`plants.current_watering_event_id` therefore names the only undoable event, while each
`watering_events.previous_event_id` names the event that becomes current after a pop. Forward RPCs
assign both links while holding the plant lock; random UUID order is never used as causality.

**Every plant/journal writer locks plant before event.** Forward actions already lock the plant before
inserting. Undo must first discover `plant_id` without a row lock, lock the plant, then lock and
revalidate the event. The edit RPC follows the same plant→event order, preventing an edit-versus-undo
deadlock.

**Identity currency and date consistency are separate checks.** The plant pointer answers whether an
event is current; equality between the locked plant's `next_due_on` and that event's `new_due_on`
answers whether its restore window is trustworthy. An identity mismatch remains `P0003` and maps to
action `CONFLICT`; a date mismatch raises `P0004` and maps to action `PRECONDITION_FAILED`. This does
not restore the old value-based guard: a colliding older event still fails identity even when its date
happens to match.

**The photo tri-state cannot cross an SQL boundary as one nullable parameter.** `null` means
"remove" and absent means "leave alone", so the RPC needs a separate boolean discriminator
(`p_set_photo_path`) alongside `p_photo_path`. Collapsing them silently turns every name-only edit
into a photo removal.

**The optimistic lock is conditional and must stay conditional.** `update-plant.integration.test.ts:269`
pins that a stale `updated_at` token is rejected *only* when the interval delta is non-zero. The RPC
must reproduce that branch, not enforce the lock unconditionally.

## Phase 1: Identity-Based Undo Guard

### Overview

Replace `undo_watering_event`'s value comparison with a LIFO identity check, and make the conflict
message name the actual rule. Closes V1.

### Changes Required:

#### 1. Explicit undo-stack migration and RPC rewrites

**File**: `supabase/migrations/20260801120000_explicit_undo_stack.sql`

**Intent**: Add explicit stack identity, make `mark_watered` / `postpone_plant` push onto it, and make
`undo_watering_event` pop only the event named by the plant. This replaces both value comparison and
timestamp-derived ordering.

**Contract**:

- Add nullable `watering_events.previous_event_id uuid` referencing `watering_events(id)` and
  nullable `plants.current_watering_event_id uuid` referencing `watering_events(id)`. Make both
  constraints `deferrable initially deferred`: undo updates the pointer before deleting an event,
  while plant deletion must still be able to cascade through the whole self-referencing stack.
- Backfill `previous_event_id` per plant using `lag(id)` over deterministic historical order
  `(created_at, id)`, then set each plant's current pointer to the last row in that same order. This
  order is a migration fallback for history only; new correctness never depends on it.
- `mark_watered` and `postpone_plant` already lock the plant. Capture its current pointer, insert the
  new event with `previous_event_id` set to it, then update the plant's due date and current pointer to
  the inserted event. Return shapes and grants stay unchanged.
- `undo_watering_event` first reads the owned event's `plant_id` without `for update`, locks the owned
  plant, then reselects the owned event `for update` and captures `prev_due_on`, `new_due_on`, and
  `previous_event_id`. If it disappeared, raise `P0002`; if `plants.current_watering_event_id` is not
  `p_event_id`, raise `P0003` with "Only the most recent action can be undone"; if the locked plant's
  `next_due_on` differs from the current event's `new_due_on`, raise `P0004` with "This action is no
  longer aligned with the plant schedule". Update the plant's due date and current pointer to the
  predecessor before deleting the event.
- Re-issue revoke/grant pairs for all three replaced functions. Regenerate `database.types.ts` and
  restore its two header comment lines; the diff must contain only the two new columns in this phase.

#### 2. Action-layer conflict copy

**File**: `src/actions/index.ts`

**Intent**: Update the user-facing message on the `P0003` → `CONFLICT` mapping so it states the LIFO
rule rather than the old value-staleness framing, and map the new legacy-divergence code distinctly.

**Contract**: The `error.code === "P0003"` branch at `:299-301` keeps `code: "CONFLICT"`; only
`message` changes. Add `P0004` → `PRECONDITION_FAILED` with "This action can no longer be undone after
an earlier schedule change." Both are non-immediate-retry outcomes, but distinct action codes let the
client show truthful copy without inspecting message text. The existing client-date use of
`PRECONDITION_FAILED` is action-specific and cannot reach the undo handler.

#### 3. Un-skip the V1 regression test

**File**: `src/actions/watering-sequence.integration.test.ts`

**Intent**: Turn the V1 block from `test.skip` into `test` and rewrite its comment block — it
currently describes the defect in the present tense and points at this change folder as pending
work. It should now read as a regression test for shipped behaviour, retaining the explanation of
*why* the colliding-`new_due_on` shape makes a value guard ambiguous.

**Contract**: The test body at `:253-287` already encodes the corrected behaviour and needs no
behavioral assertion changes. Add assertions that the second event points to the first and that the
plant pointer moves second → first → null during the unwind. Leave the V3 block skipped — Phase 2
rewrites it.

#### 4. SQL gate for undo ordering

**File**: `supabase/tests/undo-integrity.sql`

**Intent**: Add a transaction-scoped psql script asserting stack behavior at the SQL layer: forward
RPCs link current→predecessor correctly; an out-of-order undo raises `P0003`; a newest-first undo
succeeds and advances the pointer; unwinding a two-event stack returns the plant to its original date
with no events left and a null pointer; a current but date-divergent event raises `P0004` without state
change; and another user's event is not undoable.

**Contract**: Follow `season-aware-intervals.sql` exactly — `begin;` … `do $$ … $$;` blocks that
`raise exception` on a failed assertion … `rollback;`. Self-contained: create its own auth users and
plants, assume nothing from `supabase/seed.sql`. Assertions must set the session role so
`auth.uid()` resolves, as the existing script does.

#### 5. Wire the second SQL gate into the scripts

**File**: `package.json`

**Intent**: `test:sql` currently names one file. Extend it to run both scripts so the gate stays a
single command and neither file can be forgotten.

**Contract**: Keep `-v ON_ERROR_STOP=1` on each invocation and preserve non-zero exit propagation —
per `context/foundation/lessons.md`, the status code is this gate's only signal. Do not modify
`lint-staged`/lefthook wiring in this phase.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly against a reset local stack: `pnpx supabase db reset`
- Regenerated types contain both stack-link columns and retain the two header lines
- SQL gate passes: `pnpm test:sql`
- Integration suite passes with the V1 test un-skipped: `pnpm test:integration`
- Unit suite passes: `pnpm test`
- Type checking passes: `pnpm check`
- Linting passes: `pnpm lint`

#### Manual Verification:

- Water a plant from Today and press Undo in the toast — the plant returns to the list with its
  original due date.
- With the same plant open in two tabs, act in both, then press Undo on the older toast — a
  conflict message appears naming the most-recent-action rule.

**Implementation Note**: After completing this phase and all automated verification passes, pause
for manual confirmation before proceeding to Phase 2.

---

## Phase 2: Atomic Plant-Edit RPC With Event Amendment

### Overview

Move the plant edit's write behind a `security definer` RPC that updates the plant and shifts every
event window reachable from its current stack pointer in one locked transaction. Closes V3's
undo-integrity half and preserves the edit delta through a complete newest-first unwind.

### Changes Required:

#### 1. Plant-edit RPC migration

**File**: `supabase/migrations/20260801120001_atomic_plant_schedule_update.sql`

**Intent**: Add `update_plant_schedule`, which performs the ownership check, the conditional
optimistic-lock check, the plant column update, and the reachable-stack window shift as one
transaction. The delta is supplied by the caller rather than recomputed, so the season rule is not
duplicated a third time.

**Contract**: Signature:

```sql
public.update_plant_schedule(
  p_plant_id uuid,
  p_name text,
  p_growing_interval_days int,
  p_dormancy_interval_days int,
  p_set_photo_path boolean,
  p_photo_path text,
  p_delta_days int,
  p_updated_at timestamptz
) returns setof public.plants
```

`security definer`, `set search_path = ''`, `auth.uid()` null-check raising `28000` — matching the
three existing RPCs. Behaviour:

- `select … from public.plants where id = p_plant_id and user_id = v_user_id for update`; not found
  → `P0002`. Capture the locked row's pre-update `next_due_on` and `current_watering_event_id`.
- When `p_delta_days <> 0` and the locked row's `updated_at <> p_updated_at` → raise `P0003`. When
  `p_delta_days = 0`, skip this check entirely (pinned by `update-plant.integration.test.ts:269`).
- Update `name`, both interval columns, `photo_path` only when `p_set_photo_path`, and `next_due_on`
  to `next_due_on + p_delta_days` only when `p_delta_days <> 0`.
- When `p_delta_days <> 0` and the current pointer is non-null, lock that event after the plant and
  compare its `new_due_on` with the plant's captured pre-update `next_due_on`. Only when they match,
  recursively follow `previous_event_id` and shift **both** endpoints of every reachable event by the
  same delta. When they differ, still apply the requested plant edit but leave the entire stack
  untouched; the `P0004` undo guard keeps that untrustworthy legacy stack non-undoable:

  ```sql
  if v_current_event_new_due_on = v_previous_due_on then
    with recursive undo_stack as (
      select e.id, e.previous_event_id
      from public.watering_events as e
      where e.id = v_current_watering_event_id
        and e.plant_id = p_plant_id
        and e.user_id = v_user_id

      union all

      select predecessor.id, predecessor.previous_event_id
      from public.watering_events as predecessor
      join undo_stack as current on predecessor.id = current.previous_event_id
      where predecessor.plant_id = p_plant_id
        and predecessor.user_id = v_user_id
    )
    update public.watering_events as e
    set prev_due_on = e.prev_due_on + p_delta_days,
        new_due_on = e.new_due_on + p_delta_days
    from undo_stack
    where e.id = undo_stack.id;
  end if;
  ```

  A plant with no events is a no-op, not an error.

- `return query select * from public.plants where id = p_plant_id`.

Close with `revoke all on function … from public, anon, authenticated;` then
`grant execute … to authenticated;`, per the established pattern.

`v_current_watering_event_id` comes from the plant row locked at the start of the RPC. No ordering
query is allowed here: Phase 1's links define both the current event and its reachable predecessors.
Because every competing stack mutation locks the plant first, the traversal and multi-row update see
a stable stack and cannot deadlock with undo. The consistency comparison must use values captured
before updating the plant; comparing after `next_due_on + p_delta_days` would falsely classify every
aligned stack as divergent.

#### 2. Rewire `updatePlant` onto the RPC

**File**: `src/actions/index.ts`

**Intent**: Replace the `supabase.from("plants").update(...)` block inside `updatePlant`'s `try`
with a single `supabase.rpc("update_plant_schedule", …)` call, mapping the RPC's error codes onto
the existing `ActionError` contract. Photo upload before the call and photo cleanup after it —
including the `catch` block's compensating delete — stay exactly as they are.

**Contract**: The action's external behaviour is unchanged: same input schema, same returned plant
row, same `NOT_FOUND` / `CONFLICT` / `INTERNAL_SERVER_ERROR` outcomes. The read at `:112-118` stays
(it feeds `resolveScheduleChange` and the old-photo cleanup comparison). Map `P0002` → `NOT_FOUND`
"Plant not found." and `P0003` → `CONFLICT` "This plant changed elsewhere.", preserving today's
messages. `p_set_photo_path` is `nextPhotoPath !== undefined`; `p_photo_path` is
`nextPhotoPath ?? null`. Log the RPC error before mapping, matching the `console.error` shape the
other three RPC call sites use.

#### 3. Regenerate database types

**File**: `src/lib/database.types.ts`

**Intent**: Pick up the new function so `supabase.rpc("update_plant_schedule", …)` type-checks.

**Contract**: `pnpx supabase gen types typescript --local > src/lib/database.types.ts`, then re-add
the two header comment lines the generator strips (`:1-3`). Verify the diff contains only the new
`update_plant_schedule` entry under `Functions`.

#### 4. Rewrite and un-skip the V3 regression test

**File**: `src/actions/watering-sequence.integration.test.ts`

**Intent**: Turn the V3 block from `test.skip` into `test` and change its expectation from a verbatim
restore to a **delta-adjusted** one, then rewrite the comment to describe shipped behaviour rather
than a pending defect.

**Contract**: The fixture edits both intervals `+1`, so the delta is `+1` in either season and the
assertion at `:318` becomes `addDays(originalDueOn, 1)` rather than `originalDueOn`. Add an
assertion between the edit and the undo that the newest event's `prev_due_on`/`new_due_on` both
shifted by `+1` and that `new_due_on` equals the plant's `next_due_on` — that invariant, not the
restore alone, is what this change is really about. The journal must still be empty after the undo.

Add a second regression with a two-event stack: edit once, then undo newest→oldest. Assert both event
windows shifted by the delta, each restored date retains that delta, the final plant date is the
delta-adjusted starting date, the current pointer is null, and the journal is empty.

Add a legacy-compatibility regression that creates a current event, directly diverges the plant date
to model pre-migration state, then performs another schedule edit. Assert the plant edit succeeds,
the entire event stack remains byte-for-byte unchanged, and undo rejects with `CONFLICT` without
changing either plant or journal state.

#### 5. Cover the amendment against the existing edit tests

**File**: `src/actions/update-plant.integration.test.ts`

**Intent**: The four existing tests must keep passing unchanged — they are the contract for the RPC's
behaviour. Add one case for the amendment's own edge: a schedule-changing edit on a plant with **no**
journal events succeeds and writes nothing to `watering_events`.

**Contract**: Reuse `createPlantFixture` / `readPlantState`. Do not relax
`:269` ("rejects a stale token only when the interval delta changes") — if the RPC breaks it, the RPC
is wrong, not the test.

#### 6. Extend the SQL gate

**File**: `supabase/tests/undo-integrity.sql`

**Intent**: Add assertions for `update_plant_schedule` at the SQL layer: every event in a two-level
stack has both endpoints shifted and retains the delta through a full unwind; a zero delta leaves
both the plant's `next_due_on` and the journal untouched; a stale `p_updated_at` with a non-zero delta
raises `P0003` while the same token with a zero delta succeeds; a pre-existing mismatch leaves the
stack unchanged and makes undo raise `P0004`; another user's plant raises `P0002`.

**Contract**: Same transaction-scoped, self-contained structure as Phase 1.

### Success Criteria:

#### Automated Verification:

- Both migrations apply cleanly on a reset stack: `pnpx supabase db reset`
- Regenerated types contain `update_plant_schedule` and retain the two header lines
- SQL gate passes: `pnpm test:sql`
- Integration suite passes with both V1 and V3 un-skipped and no `.skip` remaining in
  `watering-sequence.integration.test.ts`: `pnpm test:integration`
- Unit suite passes: `pnpm test`
- Type checking passes: `pnpm check`
- Linting passes: `pnpm lint`

#### Manual Verification:

- Edit a plant's interval upward from the detail page — the header due date shifts, and every
  reachable journal window shifts with it rather than disagreeing.
- Water a plant in one tab, change its interval in another, then Undo the watering — the restored
  date reflects the interval edit.
- Rename a plant without changing intervals — the due date and journal are untouched, and a stale
  form token does not produce a conflict.

**Implementation Note**: Pause for manual confirmation before proceeding to Phase 3.

---

## Phase 3: Non-Retryable Undo Failure Handling

### Overview

Stop offering Retry when undo is blocked by either a newer event or an untrustworthy legacy window,
and cover both classifications with unit tests. Another client may later pop a newer event; that
branch is non-retryable now, not a claim that it can never become undoable.

### Changes Required:

#### 1. Undo-failure predicates

**File**: `src/lib/errors.ts`

**Intent**: Add pure predicates that distinguish a newer-event conflict (`CONFLICT`) from an
untrustworthy-window refusal (`PRECONDITION_FAILED`), so the client can show truthful non-retryable
copy and the branches are testable under the existing node-environment unit suite.

**Contract**: `isUndoBlockedConflict` checks `code === "CONFLICT"` and `isUndoScheduleMismatch`
checks `code === "PRECONDITION_FAILED"`. Both mirror `isClientDateRejection`
(`src/lib/date.ts:53-55`) — narrow `unknown`, return boolean, and import nothing from
`astro:actions`. New module rather than an addition to `date.ts`, since the concern is error
classification, not dates. The latter code is safe to interpret this way only inside the undo
handler; client-date rejection cannot originate from `undoWateringEvent`.

#### 2. Predicate unit tests

**File**: `src/lib/errors.test.ts`

**Intent**: For each predicate, cover its true case, the other predicate's code, a generic code, and
the non-object cases (`null`, `undefined`, a string, an object without `code`) — the shapes an action
error can actually arrive as.

**Contract**: Top-level `describe` named after the function under test, no module-level wrapper
(`context/foundation/lessons.md`, "Name test describe blocks after the function under test").

#### 3. Branch the undo failure handler

**File**: `src/components/today-list/today-list.tsx`

**Intent**: In `handleUndo`'s `catch`, use the predicates to show distinct no-Retry messages for a
newer-event conflict and an untrustworthy legacy window, then keep today's retryable toast otherwise.

**Contract**: The `catch` at `:239-249` becomes `catch (error)` and gains two guard clauses ahead of
the existing `toast.error(...)`. All branches keep `id: noticeId` so the loading toast is replaced
rather than stacked. Both non-retryable messages go in `./utils.ts` beside the existing
`getFailureMessage` / `getSuccessMessage` helpers, not inline — per the component-folder convention.
The blocked message says a newer action must be undone first; the mismatch message says the older
action can no longer be undone safely after a schedule change. `handleUndo` keeps its position in the
statement order (nested function declarations, before the void hooks).

#### 4. Narrowed mutation audit

**File**: _(no source change — verification step)_

**Intent**: Run Stryker narrowed to the new predicates and review survivors one by one.

**Contract**: `pnpm exec stryker run --mutate "src/lib/errors.ts"`. Per AGENTS.md, do not chase 100%
— add an assertion only where a survivor represents a user-visible bug. Note that Stryker's
`testFiles` excludes integration tests, so the RPC-facing code from Phases 1–2 is out of its reach
by configuration; the predicates are the meaningful mutation surface this change adds.

### Success Criteria:

#### Automated Verification:

- Unit suite passes including the new predicate tests: `pnpm test`
- Integration suite still passes: `pnpm test:integration`
- Type checking passes: `pnpm check`
- Linting passes: `pnpm lint`
- Narrowed mutation run completes and survivors are triaged:
  `pnpm exec stryker run --mutate "src/lib/errors.ts"`

#### Manual Verification:

- Force a conflict (act on one plant in two tabs, then Undo the older toast) — the toast explains
  that a newer action must be undone first and offers no immediate Retry.
- Force a retryable failure (act, go offline, press Undo) — the Retry action is still offered and
  works once back online.
- With `prefers-reduced-motion` enabled, all toast paths still behave correctly.

---

## Testing Strategy

### Unit Tests:

- `isUndoBlockedConflict` and `isUndoScheduleMismatch`: matching/other/generic codes plus
  `null`/`undefined`/string/object-without-`code`.

### Integration Tests:

- V1 (un-skipped): colliding-`new_due_on` journal shape; out-of-order undo rejected with `CONFLICT`
  and no state change; newest-first unwind returns to the original date with an empty journal.
- V3 (un-skipped, rewritten): after a schedule-changing edit, every reachable event window shifts by
  the delta; one- and two-level unwinds retain it and leave an empty journal/null pointer.
- Legacy divergence: a later schedule edit updates the plant without amending the untrustworthy
  stack, and undo is rejected with `PRECONDITION_FAILED` without changing state.
- New: schedule-changing edit on a plant with no journal events.
- Unchanged and still green: all four `update-plant.integration.test.ts` cases, especially the
  conditional stale-token rejection.

### SQL Tests (`supabase/tests/undo-integrity.sql`):

- LIFO refusal, newest-first success, two-level unwind, cross-user isolation.
- `update_plant_schedule`: full-stack window shift and unwind, divergent-stack preservation plus
  `P0004` undo refusal, zero-delta no-op, conditional stale-token rejection, cross-user `P0002`.

### Manual Testing Steps:

1. Water a plant, press Undo — plant returns with its original date.
2. In two tabs, act on the same plant twice, Undo the older toast — blocked conflict, no immediate Retry.
3. Edit a plant's interval upward — header and every reachable journal window move together.
4. Water, edit the interval in another tab, Undo — restored date reflects the edit.
5. Rename only — no due-date or journal movement, no spurious conflict.

## Performance Considerations

The LIFO guard becomes one primary-key identity comparison after locking the plant and event. A
schedule-changing edit traverses and updates the plant's reachable undo stack, so its cost is O(stack
depth), while stack pushes and pops write one additional UUID field on the plant/event rows. Expected
event counts and edit frequency are small, but the SQL gate must include a multi-event stack so the
recursive path is exercised.

## Migration Notes

Phase 1 adds two nullable UUID references and backfills the historical stack deterministically by
`(created_at, id)`. That historical order cannot reconstruct true concurrency, but after migration
all new pushes and pops use stored identity and never infer order from timestamps. Phase 2 adds only
the new function and has no further table backfill.

Plants whose `next_due_on` already diverged from their current event (via a pre-existing edit) are not
reconciled — no backfill can recover which date was intended. The edit RPC detects this state before
changing the plant and leaves the full event stack untouched. Undo checks both current identity and
date consistency, returning `P0004` without mutation for these legacy stacks. This deliberately
sacrifices their undoability instead of manufacturing a restore date from ambiguous history.

## References

- Defect register: `context/archive/2026-07-28-testing-task-list-and-mutation-integrity/research.md:435-437`
- Accepted trade-off being revisited: `context/archive/2026-07-23-postpone-and-undo/reviews/plan-review.md:27`
- Skipped specs: `src/actions/watering-sequence.integration.test.ts:253,292`
- RPC boundary pattern: `supabase/migrations/20260723120000_add_postpone_and_undo.sql:1-2`
- SQL gate pattern: `supabase/tests/season-aware-intervals.sql`
- Error-predicate precedent: `src/lib/date.ts:53-55`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Identity-Based Undo Guard

#### Automated

- [x] 1.1 Migration applies cleanly against a reset local stack: `pnpx supabase db reset` — fcbc0b1
- [x] 1.2 Regenerated types contain both stack-link columns and retain the two header lines — fcbc0b1
- [x] 1.3 SQL gate passes: `pnpm test:sql` — fcbc0b1
- [x] 1.4 Integration suite passes with the V1 test un-skipped: `pnpm test:integration` — fcbc0b1
- [x] 1.5 Unit suite passes: `pnpm test` — fcbc0b1
- [x] 1.6 Type checking passes: `pnpm check` — fcbc0b1
- [x] 1.7 Linting passes: `pnpm lint` — fcbc0b1

#### Manual

- [x] 1.8 Water a plant from Today and press Undo — plant returns with its original due date — fcbc0b1
- [x] 1.9 Two-tab conflict shows a message naming the most-recent-action rule

> 1.9 deferred to Phase 3. The `P0003` → `CONFLICT` mapping lands in this phase
> (`src/actions/index.ts:300`, "Only the most recent action can be undone."), but
> `handleUndo`'s catch-all at `src/components/today-list/today-list.tsx:239` discards the
> error and shows one generic retryable message. The distinct copy this step asks the
> verifier to observe is produced by step 3.6, so 1.9 is verifiable only alongside it.
> Rule coverage meanwhile is automated: `watering-sequence.integration.test.ts:275`
> (action-layer `CONFLICT`) and `supabase/tests/undo-integrity.sql` (`P0003`, no state change).

### Phase 2: Atomic Plant-Edit RPC With Event Amendment

#### Automated

- [x] 2.1 Both migrations apply cleanly on a reset stack: `pnpx supabase db reset` — 9770365
- [x] 2.2 Regenerated types contain `update_plant_schedule` and retain the two header lines — 9770365
- [x] 2.3 SQL gate passes: `pnpm test:sql` — 9770365
- [x] 2.4 Integration suite passes with both V1 and V3 un-skipped and no `.skip` remaining: `pnpm test:integration` — 9770365
- [x] 2.5 Unit suite passes: `pnpm test` — 9770365
- [x] 2.6 Type checking passes: `pnpm check` — 9770365
- [x] 2.7 Linting passes: `pnpm lint` — 9770365

#### Manual

- [x] 2.8 Interval edit moves the header due date and every reachable journal window together — 9770365
- [x] 2.9 Water, edit interval in another tab, Undo — restored date reflects the interval edit — 9770365
- [x] 2.10 Rename-only edit leaves due date and journal untouched with no spurious conflict — 9770365

### Phase 3: Non-Retryable Undo Failure Handling

#### Automated

- [x] 3.1 Unit suite passes including the new predicate tests: `pnpm test` — c3fb42e
- [x] 3.2 Integration suite still passes: `pnpm test:integration` — c3fb42e
- [x] 3.3 Type checking passes: `pnpm check` — c3fb42e
- [x] 3.4 Linting passes: `pnpm lint` — c3fb42e
- [x] 3.5 Narrowed mutation run completes and survivors are triaged: `pnpm exec stryker run --mutate "src/lib/errors.ts"` — c3fb42e

#### Manual

- [x] 3.6 Forced conflict shows the blocked-by-newer-event message with no immediate Retry action — c3fb42e
- [x] 3.7 Forced retryable failure still offers a working Retry — c3fb42e
- [x] 3.8 All toast paths behave correctly under `prefers-reduced-motion` — c3fb42e
