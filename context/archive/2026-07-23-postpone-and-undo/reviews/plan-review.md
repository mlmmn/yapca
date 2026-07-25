<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Postpone and Undo

- **Plan**: context/changes/postpone-and-undo/plan.md
- **Mode**: Deep
- **Date**: 2026-07-23
- **Verdict**: REVISE → SOUND (both warnings fixed in plan)
- **Findings**: 0 critical, 2 warnings, 0 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | WARNING (F1 — fixed) |
| Architectural Fitness | PASS |
| Blind Spots | PASS |
| Plan Completeness | WARNING (F2 — fixed) |

## Grounding

9/9 paths ✓ (all Current-State paths exist as described; target folders `today-list/`, `sonner/` correctly absent). Symbols ✓: `watered_on` (migration:10), `mark_watered` returns scalar `date` (migration:44), `event_type in ('watered')` check (migration:9), no row lock on the RPC read, `next-themes` consumed only by `sonner.tsx`, sole importer of the bare TodayList is `authed-shell.astro:4`. Progress↔Phase ✓ (3 phases, all N.M bullets matched, no stray checkboxes). brief↔plan ✓.

## Notes

- Git history has `feat(postpone-and-undo)` commits through phase 3, but the working tree currently matches the pre-implementation Current State and the Progress block is all unchecked — an earlier attempt appears reverted. Confirm intentional before implementing.
- Stale-Undo guard (`plants.next_due_on = event.new_due_on`) is value-based rather than identity-based; the only race that could collide two events on the same `new_due_on` is closed by the plan's mandatory row lock. Sound as designed.

## Findings

### F1 — Calendar-day helper duplicates existing nextDue()

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Lean Execution
- **Location**: Phase 2, Change #2 (src/lib/date.ts, src/lib/interval.ts)
- **Detail**: Phase 2.2 said to add calendar-day helpers to both date.ts and interval.ts, but interval.ts:7 already exposes `nextDue(fromDate, intervalDays)` (calendar-exact, epoch-day based) and the +2 Postpone shift runs server-side in SQL, so the client needs no new day-adder. The only genuinely new shared helper is a due-record sort comparator. No addDays/addCalendarDays exists today, so the risk was a new parallel helper beside `nextDue` — the exact duplication drift lessons.md flags.
- **Fix**: Reuse `nextDue`/`toEpochDay`/`fromEpochDay`; scope the only new src/lib/ addition to the due-record sort comparator (next_due_on, then name) in date.ts; drop interval.ts from touched files.
  - Strength: Honors the accepted lesson; single source of truth for calendar arithmetic.
  - Tradeoff: None significant.
  - Confidence: HIGH — nextDue + epoch-day primitives already cover the math; Postpone +2 is server-side.
  - Blind spot: None significant.
- **Decision**: FIXED (Fix in plan — Phase 2 Change #2 retitled "Shared list-order helper", interval.ts removed from touched files, contract reworked to reuse nextDue with the sort comparator as the only new helper).

### F2 — "Exclude leaving rows from the ledger" conflicts with the collapse animation

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2, Change #3 + Implementation Approach (line 53)
- **Detail**: The plan correctly fixes the count-includes-collapsing-rows defect but phrased it as "exclude leaving rows from both the ledger and count immediately." Taken literally, removing a row from the ledger unmounts it and kills the ~190ms max-height collapse animation the design requires (and the symmetric Undo open/crossfade). Both behaviors are required; the plan did not say how they coexist.
- **Fix**: Clarify the row stays mounted for its exit transition while excluded from the count immediately — derive the count from non-leaving rows, keep leaving rows rendered only until the collapse/restore transition completes (instant under reduced motion).
- **Decision**: FIXED (Fix in plan — both the Implementation Approach paragraph and Phase 2 Change #3 contract now state count excludes leaving rows immediately while the row stays mounted through its collapse/Undo transition).
