# Undo Integrity Defects — Plan Brief

> Full plan: `context/changes/undo-integrity-defects/plan.md`

## What & Why

Undo decides whether an event is still the current one by comparing a **date value**
(`plants.next_due_on <> event.new_due_on`). Values collide and values drift, and each failure is a
shipped defect: **V1** — two events landing on the same `new_due_on` let an out-of-order undo through,
stranding the later event as permanently un-undoable; **V3** — a schedule-changing edit moves
`next_due_on` with no journal row, so a pending undo fails `P0003` and the journal disagrees with the
plant. This replaces the value comparison with an identity guard and makes edits keep the journal in
step.

V1 is not a newly discovered defect. The value-based guard was named at plan-review time and shipped
knowingly (`context/archive/2026-07-23-postpone-and-undo/reviews/plan-review.md:27`), cleared by
reasoning about a *race*. The case that actually breaks it is not a race — it is two ordinary
sequential same-day postpones.

## Starting Point

`undo_watering_event` guards at `20260723120000_add_postpone_and_undo.sql:156` and restores
`prev_due_on` verbatim. `updatePlant` (`src/actions/index.ts:159-172`) writes the plant in one
statement with a conditional `updated_at` lock and no journal write. Undo exists only as a 10-second
Sonner toast (`today-list.tsx:104-119`) whose failure handler offers Retry for every error class; the
detail journal is read-only. Both defects sit in `src/actions/watering-sequence.integration.test.ts`
as `test.skip` blocks (`:253`, `:292`) that already encode the corrected behaviour.

## Desired End State

Undo is last-in-first-out: a plant explicitly points to its current event and each event points to
its predecessor. Only that current event is undoable, and a successful undo advances the pointer so
unwinding newest-first leaves nothing stranded. For an aligned stack, a schedule-changing edit moves
the plant and every reachable event window together in one transaction, so
`plants.next_due_on` equals the current event's `new_due_on`. Undoing after such an edit lands on a
delta-adjusted date through the full reachable stack — the action is undone, the interval edit keeps
its effect. Legacy-divergent stacks remain untouched and non-undoable. The toast stops offering an
immediately futile Retry while a newer event remains current, without claiming the older event can
never become undoable later.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Undo currency guard | Explicit identity stack | `plants.current_watering_event_id` and each event's `previous_event_id` model causality directly instead of inferring it from due dates or timestamps | Plan review F1 |
| Lock order | Plant, then event | Matches forward RPCs and prevents edit-versus-undo circular waits once edits amend an event row | Plan review F1/F2 |
| Journal consistency | Edit amends every event in the reachable undo stack | Preserves the edit delta through every newest-first pop with no new event type or journal UI work | Plan review F3 |
| Undo target after an edit | Delta-adjusted restore | Preserves both intents — the action is undone and the interval edit keeps its immediate effect | Plan |
| Delta implementation | Shift the event's **whole** window | Amending `prev_due_on` too makes delta-adjustment fall out of the unchanged `set next_due_on = v_prev_due_on` — no new column, no arithmetic in undo | Plan |
| Atomicity | New `security definer` RPC | Matches the boundary `20260723120000` already chose for schedule changes, and closes the read→update gap E2 flags | Plan |
| RPC scope | The whole plant update | One write, one lock, one transaction — no window where intervals landed but the schedule didn't | Plan |
| Refusal contract | `P0003` → `CONFLICT` for non-current identity; `P0004` → `PRECONDITION_FAILED` for a divergent current window | Keeps LIFO refusal distinct from legacy schedule inconsistency and enables truthful client copy | Plan review F4 |
| Client handling | Blocked message, no immediate Retry | Retry is futile while a newer event remains current, but another client can later pop it | Plan review F3 |
| V3's converse half | Out of scope | Spurious `CONFLICT` from `plants_set_updated_at` is conservative — a conflict, never corruption | Plan |
| Client test depth | `src/lib` predicates, not a render test | No jsdom/Testing Library exists and the unit config is deliberately shared with Stryker — see Open Risks | Plan |

## Scope

**In scope:** the `undo_watering_event` guard rewrite; a new `update_plant_schedule` RPC owning the
plant edit plus a recursive reachable-stack window shift; `updatePlant` rewired onto it; regenerated
`database.types.ts`; both skipped tests un-skipped (V3's assertion rewritten); a new
`supabase/tests/undo-integrity.sql` gate; a blocked-conflict branch in the undo toast.

**Out of scope:** V3's converse half (spurious `CONFLICT` from `plants_set_updated_at`); a
`rescheduled` event type or journal UI changes; jsdom/Testing Library
infrastructure; V2 and V4–V12; the postpone `action date + 2` PRD divergence; V11's missing due-state
precondition.

## Architecture / Approach

Two forward-only migrations. Phase 1 adds and backfills the explicit stack links, rewrites the two
forward RPCs to push events, and rewrites undo to lock plant→event and pop by identity. Phase 2 adds
`update_plant_schedule(p_plant_id, p_name, …, p_delta_days,
p_updated_at) returns setof public.plants` — ownership check, conditional optimistic lock, plant
update, and reachable-stack window shift in one locked transaction. The delta stays computed in
TypeScript by `resolveScheduleChange` so the season rule is not duplicated a third time (V9 already
tracks the two existing copies); photo upload and cleanup stay in TypeScript around the RPC call.
Phase 3 is client-only.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Identity-based undo guard | Explicit stack links, push/pop RPCs, truthful conflict copy, V1 un-skipped, new SQL gate | Historical links require a deterministic fallback backfill because old concurrency cannot be reconstructed |
| 2. Atomic plant-edit RPC | `update_plant_schedule` + full-stack amendment, `updatePlant` rewired, V3 un-skipped | The recursive traversal, photo tri-state, and conditional optimistic lock must survive the move to SQL intact |
| 3. Blocked conflict handling | `src/lib` predicate + unit tests, no-immediate-retry toast branch, narrowed Stryker run | Low — isolated client branch |

**Prerequisites:** Docker running with `pnpx supabase start`; a clean tree on `main` (no branch —
AGENTS.md forbids creating one unasked).
**Estimated effort:** ~2–3 sessions across 3 phases; Phase 2 is the bulk of it.

## Open Risks & Assumptions

- **The client-test narrowing is a deliberate downgrade.** You selected a client test for the CONFLICT
  branch; no component-test infrastructure exists (`vitest.config.ts` is `environment: "node"`, no
  Testing Library in devDependencies) and that config's comment records it as deliberately shared with
  Stryker. The plan covers the classification logic as a pure `src/lib` predicate instead. The wiring
  inside `handleUndo` is therefore covered only by manual verification.
- **Stryker's yield here is structurally limited.** `stryker.config.json` excludes
  `*.integration.test.*`, so the RPC-facing code from Phases 1–2 is unreachable by the mutation
  runner; only the new predicates are a meaningful mutation surface.
- **Historical stack order is a deterministic fallback.** Existing rows are linked by
  `(created_at, id)` during migration because their true concurrency order cannot be reconstructed;
  all new events use identity links assigned while holding the plant lock.
- **Pre-existing plant↔journal divergence is not reconciled.** Plants already edited under the old
  code keep an ambiguous stack because no backfill can recover which date was intended. A later edit
  updates the plant but leaves that stack untouched; undo rejects it with `P0004` rather than
  manufacturing an incorrect restore date.
- **Schedule-edit cost grows with reachable stack depth.** The expected journal is small, but Phase 2
  must exercise a multi-event traversal and full unwind at both integration and SQL layers.
- **Assumption:** un-skipping V3 with a delta-adjusted expectation is a *change* to the assertion a
  prior change wrote (`:318` currently expects a verbatim restore). That test was written as a
  proposed spec, not a shipped contract, so revising it is in bounds — same posture `change.md` takes
  toward V1.

## Success Criteria (Summary)

- Undoing an older action is refused with a message naming the rule, and unwinding newest-first
  always returns a plant to its starting date with nothing stranded.
- Changing a plant's interval moves its due date and every aligned reachable event together, and a
  pending undo still works through a full unwind. Legacy-divergent stacks remain unchanged and are
  rejected safely.
- Both previously skipped defect tests run green alongside a new SQL gate, with no `.skip` left in
  `watering-sequence.integration.test.ts`.
