# Postpone and Undo Implementation Plan

## Overview

Deliver roadmap slice S-04 (FR-012 and FR-013): extend Today so a signed-in plant owner can postpone a due task until exactly two browser-local calendar days after the action, and undo an individual Watered or Postpone event for ten seconds. The implementation must keep the schedule and watering journal atomic, reject a stale reversal rather than overwrite newer state, and preserve the existing fast, independently concurrent Today-list interaction model.

## Current State Analysis

The application already has the load-bearing substrate for this change:

- `watering_events` stores the previous and resulting due dates, while `mark_watered` updates the plant and inserts the event in one database transaction (`supabase/migrations/20260720120000_create_watering_events.sql:5`, `supabase/migrations/20260720120000_create_watering_events.sql:43`).
- The Today island owns optimistic removal, per-plant pending state, rollback, Retry, focus restoration, and concurrent mutations across different plants (`src/components/today-list.tsx:53`, `src/components/today-list.tsx:95`).
- The server action validates a fresh client-local date and calls the journaled RPC, but returns no immutable event identifier and the client ignores its success payload (`src/actions/index.ts:89`, `src/components/today-list.tsx:116`).
- The global Sonner region already supports failure notices, but its current wrapper has no ten-second duration, expanded-stack, event-keyed pending action, or verified per-notice interaction-pause contract (`src/layouts/layout.astro:20`, `src/components/ui/sonner.tsx:7`).
- The plant detail page queries the stored event type and before/after dates but renders every event as Watered (`src/pages/plants/[id].astro:51`, `src/pages/plants/[id].astro:125`).
- There is no automated test runner or test script. The established executable gates are Astro check, lint, build, and local Supabase migration/type verification (`package.json:6`).

The existing implementation also exposes gaps this slice must close. `event_type` accepts only `watered`; `watered_on` is not a neutral date name; the mutation RPC does not lock the plant row; authenticated users currently have direct insert/delete grants on journal events; the optimistic due count includes collapsing rows until success; and the touched Today and Toaster component modules predate the repository's current folder, naming, and component-body conventions.

## Desired End State

1. Watered and Postpone each optimistically remove exactly one due row and update the due count immediately while leaving unrelated rows actionable.
2. Watered schedules from the action date plus the plant interval; Postpone schedules from the browser-local action date plus exactly two calendar days without changing `interval_days`.
3. The server atomically updates the plant and records an immutable-ID event containing its action type, action date, previous due date, and new due date.
4. Each successful mutation produces its own ten-second actionable notice with the exact authoritative result and an event-specific Undo action.
5. Undo atomically restores the stored previous due date and removes exactly that active-history event. It rejects an event that no longer governs the plant's current due date.
6. A successful Undo restores the row only when its previous due date is due or overdue against a freshly computed browser-local date, in `next_due_on`, then name order.
7. The journal renders Watered and Postponed events accurately; a reversed event no longer appears.
8. Failure, Retry, focus, responsive layout, keyboard and screen-reader operation, local-midnight behavior, dark mode, and reduced motion match the approved design.

### Key Discoveries:

- Stored `prev_due_on` and `new_due_on` make deterministic reversal possible without recomputing from a potentially changed interval (`supabase/migrations/20260720120000_create_watering_events.sql:9`).
- Postponing from the old scheduled date could leave an overdue task in Today. The approved behavior therefore defines Postpone as fresh browser-local action date plus two calendar days.
- A stale-event guard is required because a later mutation from another tab could otherwise be overwritten by Undo. The current RPC reads without a row lock (`supabase/migrations/20260720120000_create_watering_events.sql:58`).
- Sonner supports stable toast IDs and custom actions, but the installed defaults do not satisfy the ten-second independently reachable notice contract without explicit configuration.
- The accepted lesson requires reusable, state-free date and sorting helpers to live under `src/lib/`, not inside the expanded component (`context/foundation/lessons.md:3`).

## What We're NOT Doing

- No arbitrary postpone duration, Skip action, future-task view, or change to the plant's base interval.
- No confirmation dialog, action controls on the plant-detail page, persistent activity tray, or indefinite historical Undo.
- No immutable administrative audit trail or visible Undone journal entry; an undone event is removed from the active journal.
- No real-time cross-tab synchronization. The database prevents stale reversal from corrupting state, while another tab reflects changes after its normal reload/navigation.
- No new unit, integration, or browser-test framework. Verification uses the existing project gates, local Supabase checks, and the manual acceptance matrix.
- No repository-wide convention cleanup. Full convention alignment applies to every component module touched by this change.
- No changes to global ESLint or Prettier configuration and no CI workflow repair; the existing workflow's `npm` usage is reported debt outside this slice.

## Implementation Approach

Use the database as the authority for each event lifecycle and the mounted Today island as the durable owner of transient interaction state. A new migration evolves the event vocabulary and replaces the mutation boundary with explicitly authorized, row-locking `SECURITY DEFINER` functions. Watered and Postpone return an immutable event/result contract; Undo accepts only that event ID, checks that its `new_due_on` still equals the plant's current due date, restores `prev_due_on`, and deletes the event in the same transaction.

On the client, generalize the existing per-plant coordinator rather than introduce a global queue. Each dispatch retains its plant, action kind, initiating control, and event-keyed notice. The optimistic projection excludes leaving rows from the due count immediately, while the leaving row stays mounted through its exit transition (and base state remains the rollback source). Sonner remains the single transient-feedback system, extended with custom notice actions and explicit timer/stack behavior.

## Critical Implementation Details

### Timing & lifecycle

The ten-second Undo window is a client affordance, not a server-clock authorization rule: a notice may invoke Undo while active, and dismissal or expiry removes that opportunity without mutating the committed event. The client must compute a fresh local date for every initial action, Retry, and Undo membership decision; midnight must not restart an existing notice timer.

### State sequencing

Watered/Postpone success must commit the authoritative event result before the notice is created, while failure leaves base state untouched so the optimistic projection can roll back. Undo must not optimistically reinsert a row: the database first confirms the reversal, then the client conditionally restores the cached plant presentation with the server-returned due date and re-sorts it.

### User experience spec

After keyboard activation removes a row, move focus contextually to the equivalent action on the next row, another available row action, or the Today heading when the ledger clears; pointer activation must not cause programmatic focus movement. A success notice never steals focus.

## Phase 1: Transactional Event Lifecycle

### Overview

Evolve the event schema and server contracts so Watered, Postpone, and Undo are atomic, ownership-safe, event-addressable, and resistant to stale reversal.

### Changes Required:

#### 1. Event schema and mutation RPCs

**File**: `supabase/migrations/20260723120000_add_postpone_and_undo.sql`

**Intent**: Generalize the Watered-only event model and make the database the only write boundary for schedule-changing journal events.

**Contract**: Rename `watering_events.watered_on` to `acted_on`; replace the event-type check so it accepts exactly `watered` and `postponed`; retain UUID identity and stored before/after due dates. Replace Watered and add Postpone/Undo RPCs as hardened `SECURITY DEFINER` functions with an empty `search_path`, schema-qualified objects, explicit non-null `auth.uid()` and ownership predicates, row locking, and transactional schedule/event writes. Watered computes action date plus `interval_days`; Postpone computes action date plus two calendar days; both return the new event ID and authoritative result. Undo accepts an event ID, locks its owned event and plant, verifies `plants.next_due_on = event.new_due_on`, restores `prev_due_on`, deletes that event, and returns the restored plant/date contract. Use distinguishable SQLSTATE codes for not-found and stale-event outcomes. Revoke default/public execute and direct authenticated insert/delete access to `watering_events`, then grant only the minimum table read and RPC execute privileges. Preserve enabled RLS and granular own-row SELECT policy; retain or replace lower-level policies only where they still correspond to an allowed operation.

#### 2. Generated and shared mutation contracts

**Files**:

- `src/lib/database.types.ts`
- `src/types.ts`

**Intent**: Keep application contracts synchronized with the migrated schema and expose discriminated action/event results to the Today coordinator and journal.

**Contract**: Regenerate database types from the migrated local schema. Replace Watered-specific event-date fields with `acted_on`; add the Postpone and Undo input/output DTOs; type event kinds as the closed `watered | postponed` domain; include immutable event ID, plant ID, previous due date, resulting/restored due date, and action kind wherever the client needs to correlate notices and reversal.

#### 3. Astro Action mutation boundary

**File**: `src/actions/index.ts`

**Intent**: Expose typed Watered, Postpone, and Undo operations while keeping session enforcement, date validation, and database error translation in one server module.

**Contract**: Update `markWatered` to return the complete RPC result; add form-accepted `postponePlant` with `plantId` and fresh `clientDate`; add `undoWateringEvent` accepting the immutable event ID. Map not-found, stale-event, and internal failures to stable `ActionError` categories without matching message text. Do not enforce the ten-second window on the server. Preserve the existing `addPlant` behavior.

### Success Criteria:

#### Automated Verification:

- Local Supabase reset applies every migration cleanly: `pnpx supabase db reset`
- Generated database types contain `acted_on`, both event types, and all three RPC signatures
- Astro type checking passes: `pnpm exec astro check`
- Linting passes: `pnpm lint`
- Production build passes on the Cloudflare adapter: `pnpm build`

#### Manual Verification:

- Watered atomically updates the plant and creates one correct `watered` event with an immutable ID
- Postpone atomically sets `next_due_on` to action date plus two days, creates one correct `postponed` event, and leaves `interval_days` unchanged
- Undo restores the stored previous due date and removes only its target event in one transaction
- Undo of a stale event is rejected without changing the plant or journal
- A second account cannot read or mutate another account's plants or events, and direct authenticated event insertion/deletion is denied

**Implementation Note**: After completing this phase and all automated verification passes, pause for human confirmation that the local Supabase and security checks succeeded before proceeding.

---

## Phase 2: Today Actions and Independent Undo Notices

### Overview

Generalize the Today-list coordinator for two sibling actions, event-specific notices, confirmed Undo restoration, and the full responsive/accessibility behavior in the design brief.

### Changes Required:

#### 1. TodayList convention alignment

**Files**:

- `src/components/today-list/today-list.tsx`
- `src/components/today-list/index.ts`
- `src/components/today-list/types.ts`
- `src/components/today-list/utils.ts`
- `src/components/authed-shell.astro`

**Intent**: Move the necessarily touched TodayList into the required component folder and make its expanded mutation coordinator comply fully with current repository conventions.

**Contract**: Replace the bare `src/components/today-list.tsx` module with a folder and barrel; update imports. Keep exactly one exported component in the component module. Align callable and value naming, top-of-block declarations, early returns, hooks/function/void-hook/return order, and logical whitespace. Keep component-local state types and helpers in the folder, but move reusable state-free date or sorting helpers to `src/lib/`. Preserve the SSR/browser-local hydration contract and existing plant loading.

#### 2. Shared list-order helper

**Files**:

- `src/lib/date.ts`

**Intent**: Provide the one deterministic due-record ordering helper the Undo reconciliation needs, reusing the existing calendar-day arithmetic rather than adding a parallel day-adder.

**Contract**: Do not add a new calendar-day-addition helper. The fixed two-day Postpone shift is computed server-side in SQL (Phase 1); any client-side day arithmetic reuses the existing calendar-exact `nextDue`/`toEpochDay`/`fromEpochDay` in `src/lib/interval.ts`/`src/lib/date.ts`. The only new shared helper is a due-record sort comparator (by `next_due_on`, then name) in `src/lib/date.ts`, built on the existing epoch-day primitives. This avoids the duplicated date-helper drift called out in `context/foundation/lessons.md`.

#### 3. Unified optimistic action coordinator

**File**: `src/components/today-list/today-list.tsx`

**Intent**: Let Watered and Postpone share duplicate prevention, optimistic removal, rollback, Retry, focus restoration, and independent concurrency without conflating different plants or initiating controls.

**Contract**: Render labeled sibling Watered and Postpone 2 days controls outside the linked plant-information region. Key pending state by plant so either action disables both controls for that plant while other rows remain operable. Record action kind and initiating control for error Retry/focus. Exclude leaving rows from the due count immediately, but keep the leaving row mounted through its collapse transition so the exit animation (and the symmetric Undo open/crossfade) still runs — derive the count from non-leaving rows rather than unmounting on action; under reduced motion the row leaves instantly. Keep base state unchanged until success. On failure restore the correct semantic overdue state and stable order, focus the initiating control when practical, and show the specified action-specific Retry notice. Resolve the existing collapsing-row overflow/hit-testing and linked-information-region defects while touching this layout. At 320px and 200% zoom, keep both labels and usable touch targets without horizontal scrolling.

#### 4. Event-keyed actionable notice system

**Files**:

- `src/components/ui/sonner/sonner.tsx`
- `src/components/ui/sonner/index.ts`
- `src/components/today-list/today-list.tsx`
- `src/styles/global.css`
- `src/layouts/layout.astro`

**Intent**: Extend the established transient notice system so every confirmed event remains independently understandable and undoable for ten seconds.

**Contract**: Move the touched Toaster into its required component folder/barrel and remove the Astro-inapplicable Next.js client directive/theme dependency while preserving system-theme rendering. Configure sufficient visible/expanded stack behavior for all active ten-second actions. Key success notices by immutable event ID; render the exact design copy and authoritative date; provide a custom Undo control that supports pending, failure, and Retry states without affecting other notices. Pause each notice's own dismissal while hovered, focused, or actively engaged; verify touch behavior. Manual dismissal, swipe, or expiry accepts the committed result and performs no mutation. Use a polite live region and do not move focus into the notice.

#### 5. Confirmed Undo reconciliation and focus

**File**: `src/components/today-list/today-list.tsx`

**Intent**: Restore only server-confirmed due rows and keep keyboard users oriented after both removal and restoration.

**Contract**: During Undo, disable only the selected notice action and keep the ledger unchanged. On success dismiss that event notice, recompute browser-local today, and reinsert the plant only when the restored due date is due or overdue; sort by due date then name and update the count with the row. On stale/internal failure retain the committed result and transform only that notice to the specified Undo Retry state. Track keyboard versus pointer activation: keyboard removal advances to the equivalent next-row action, another available action, or a focusable Today heading when the ledger clears; pointer activation leaves focus unmanaged. Restoration uses the matching short open/crossfade and becomes instant under reduced motion.

### Success Criteria:

#### Automated Verification:

- Astro type checking passes: `pnpm exec astro check`
- Linting passes with no new ignores: `pnpm lint`
- Production build passes on the Cloudflare adapter: `pnpm build`
- No touched React component remains as a bare sibling file or violates the one-component-per-module contract

#### Manual Verification:

- Watered and Postpone remove the row and update the due count immediately; both controls disable only for their plant
- Successful actions show exact, plant-specific, independently actionable ten-second notices without replacing earlier notices
- Failed Watered/Postpone restores the row, semantic due state, order, count, initiating-control focus, and matching Retry behavior
- Undo success conditionally restores and correctly sorts the row; Undo failure leaves the committed result and exposes Retry only in its notice
- Multiple different plants can mutate and undo concurrently without notice, pending-state, or ordering interference
- Notice timers pause independently during hover, focus, and active touch interaction and do not restart at local midnight
- The two-action row and notice stack work at 320px and 200% zoom with no horizontal scrolling or clipped labels/actions
- Keyboard, screen-reader, light/dark, focus contrast, and reduced-motion behavior match the design brief

**Implementation Note**: After completing this phase and all automated verification passes, pause for human confirmation of the Today-list, notice, responsive, and accessibility matrix before proceeding.

---

## Phase 3: Journal Representation and Acceptance Hardening

### Overview

Complete the active journal representation for both event kinds and verify the entire feature as one deterministic, recoverable workflow.

### Changes Required:

#### 1. Event-aware journal query and rendering

**Files**:

- `src/pages/plants/[id].astro`
- `src/types.ts`

**Intent**: Make the plant journal accurately describe Watered and Postpone events using the migrated neutral action date and stored schedule transition.

**Contract**: Query `acted_on`, `event_type`, `prev_due_on`, and `new_due_on`. Render Watered with the exact action date, Watered label, and previous scheduled date. Render Postpone with the exact action date, Postponed 2 days label, and `Due <previous> → <new>` transition. Keep reverse chronological order, quiet journal styling, wrapping at narrow widths, and the existing empty state. Do not render an Undone record; the reversed event is absent.

#### 2. End-to-end acceptance and regression pass

**Files**:

- `context/changes/postpone-and-undo/plan.md`
- Product files changed in Phases 1–3

**Intent**: Verify the production-ready design across transactional correctness, UI recovery, accessibility, timing, and existing Watered/overdue behavior using the repository's available tooling.

**Contract**: Exercise the full manual strategy below against the local Supabase stack and running app. Record Progress only for checks actually observed. Do not add test dependencies or modify lint/format/CI configuration.

### Success Criteria:

#### Automated Verification:

- Local Supabase reset and regenerated types remain clean after the complete change
- Astro type checking passes: `pnpm exec astro check`
- Linting passes: `pnpm lint`
- Production build passes on the Cloudflare adapter: `pnpm build`

#### Manual Verification:

- The journal immediately reflects committed Watered/Postpone events on navigation or reload and omits successfully undone events
- Exact action and due dates remain correct across DST, leap-day, year-boundary, overdue, and local-midnight scenarios
- Watered interval arithmetic and overdue urgency semantics do not regress
- The complete flow passes keyboard, screen-reader, 320px, 200% zoom, light/dark, reduced-motion, offline/failure, concurrent-action, and two-account RLS checks

**Implementation Note**: After completing this phase and all automated verification passes, pause for final human confirmation that the full manual acceptance matrix succeeded.

---

## Testing Strategy

### Existing Automated Gates:

- Apply all migrations from a clean local database with `pnpx supabase db reset`.
- Regenerate/check Supabase database types against the migrated schema.
- Run `pnpm exec astro check`, `pnpm lint`, and `pnpm build` after each phase.
- Do not introduce Vitest, Playwright, or another test framework in this change.

### Local Supabase Verification:

- Inspect Watered and Postpone event rows for correct owner, type, `acted_on`, previous due date, and resulting due date.
- Verify the plant update and event insert roll back together on forced RPC failure.
- Verify Undo restores and deletes together, and stale Undo changes neither record.
- Use two authenticated accounts to verify RLS isolation and RPC ownership rejection.
- Verify direct authenticated insert/delete against `watering_events` is denied.

### Manual Testing Steps:

1. Create due-today and overdue fixtures with short, long, and wrapping plant names.
2. Trigger Watered and Postpone separately; confirm immediate row/count removal and exact returned dates.
3. Trigger several actions rapidly across different plants; confirm independent notices, timers, Undo actions, and order.
4. Force Watered/Postpone failures; confirm stable rollback, semantic overdue restoration, initiating-control focus, and Retry with a fresh local date.
5. Undo due-today and overdue actions; confirm server-first restoration, correct membership/order/count, and journal removal.
6. Attempt Undo after a newer same-plant event from another session; confirm the stale reversal is rejected and authoritative state remains unchanged.
7. Let notices expire, dismiss them manually, and swipe where supported; confirm no reversal occurs.
8. Hover, focus, and touch-engage individual notices; confirm only the engaged notice pauses and midnight does not restart it.
9. Exercise the ledger-clearing and Undo-restoration path with keyboard only; confirm contextual focus advancement and no success-notice focus theft.
10. Repeat at 320px, 200% zoom, light/dark themes, reduced motion, and with a screen reader.
11. Use fixtures across DST, leap day, year rollover, and a simulated local-midnight boundary to verify exact calendar arithmetic and membership.
12. Open the plant journal after Watered, Postpone, and Undo to verify event-specific copy and active-history consistency.

## Performance Considerations

All mutations remain one RPC round trip and one row-level transaction. The Today coordinator updates only its local plant collection and notice keyed by event ID; it must not refetch the full list after every action. Expected collections are dozens of plants and active notices are short-lived, so local re-sorting and an expanded notice stack are bounded and require no caching or virtualization.

## Migration Notes

- The migration renames an existing column without changing its stored date values; existing Watered events therefore retain their meaning as action dates.
- Existing events remain valid `watered` events under the broadened constraint.
- Replacing RPCs must preserve grants explicitly because `SECURITY DEFINER` functions form the new mutation boundary.
- Rollback requires restoring the prior column name/check constraint/RPC definitions and grants. Events created as `postponed` after deployment cannot fit the old check constraint without an explicit data decision, so production rollback should prefer a forward fix once Postpone data exists.
- No plant data backfill is required.

## References

- Approved design: `context/changes/postpone-and-undo/design.md`
- Product requirements: `context/foundation/prd.md`
- Roadmap slice S-04: `context/foundation/roadmap.md`
- Product direction: `PRODUCT.md`
- Visual system: `DESIGN.md`
- Shared-helper lesson: `context/foundation/lessons.md`
- Existing Watered coordinator: `src/components/today-list.tsx:53`
- Existing journal RPC/schema: `supabase/migrations/20260720120000_create_watering_events.sql:5`
- Existing journal rendering: `src/pages/plants/[id].astro:51`
- Existing notice wrapper: `src/components/ui/sonner.tsx:7`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `.agents/skills/10x-plan/references/progress-format.md`.

### Phase 1: Transactional Event Lifecycle

#### Automated

- [x] 1.1 Local Supabase reset applies every migration cleanly — 5a4cab9
- [x] 1.2 Generated database types contain acted_on, both event types, and all three RPC signatures — 5a4cab9
- [x] 1.3 Astro type checking passes — 5a4cab9
- [x] 1.4 Linting passes — 5a4cab9
- [x] 1.5 Production build passes on the Cloudflare adapter — 5a4cab9

#### Manual

- [x] 1.6 Watered atomically updates the plant and creates one correct watered event with an immutable ID — 28df407
- [x] 1.7 Postpone atomically schedules action date plus two days and leaves interval_days unchanged — 28df407
- [x] 1.8 Undo atomically restores the stored due date and removes only its target event — 28df407
- [x] 1.9 Stale Undo is rejected without changing the plant or journal — 28df407
- [x] 1.10 Cross-account access and direct authenticated event mutations are denied — 28df407

### Phase 2: Today Actions and Independent Undo Notices

#### Automated

- [x] 2.1 Astro type checking passes — 269588f
- [x] 2.2 Linting passes with no new ignores — 269588f
- [x] 2.3 Production build passes on the Cloudflare adapter — 269588f
- [x] 2.4 Touched React components comply with folder and module conventions — 269588f

#### Manual

- [x] 2.5 Watered and Postpone immediately update the row and count with per-plant disabling — 28df407
- [x] 2.6 Successful actions create exact independent ten-second notices — 28df407
- [x] 2.7 Failed Watered and Postpone restore state, focus, and matching Retry — 28df407
- [x] 2.8 Undo success restores membership and order while Undo failure retains committed state — 28df407
- [x] 2.9 Concurrent plant actions and notices remain independent — 28df407
- [x] 2.10 Notice timers pause independently and do not restart at midnight — 28df407
- [x] 2.11 Two-action rows and notices work at 320px and 200% zoom — 28df407
- [x] 2.12 Keyboard, screen-reader, theme, focus, and reduced-motion behavior match the design — 28df407

### Phase 3: Journal Representation and Acceptance Hardening

#### Automated

- [x] 3.1 Local Supabase reset and regenerated types remain clean — 28df407
- [x] 3.2 Astro type checking passes — 28df407
- [x] 3.3 Linting passes — 28df407
- [x] 3.4 Production build passes on the Cloudflare adapter — 28df407

#### Manual

- [x] 3.5 Journal renders committed event types and omits undone events — 28df407
- [x] 3.6 Exact dates remain correct across calendar boundaries and overdue states — 28df407
- [x] 3.7 Watered interval arithmetic and overdue urgency semantics do not regress — 28df407
- [x] 3.8 Complete responsive, accessibility, failure, concurrency, and RLS matrix passes — 28df407
