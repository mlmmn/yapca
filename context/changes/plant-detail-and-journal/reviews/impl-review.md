<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Plant Detail View + Watering Journal

- **Plan**: context/changes/plant-detail-and-journal/plan.md
- **Scope**: All phases (1–3 of 3)
- **Date**: 2026-07-20
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 2 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | WARNING |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Findings

### F1 — Journal shows prev_due_on ("Scheduled for") instead of new_due_on ("next due")

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: src/pages/plants/[id].astro:129
- **Detail**: Each journal row renders `Scheduled for {formatShortDate(entry.prev_due_on)}`. The plan's Desired End State #3 and the Phase 2 contract both specify the reschedule *result* — "watered on X → next due Y", a `next due <new_due_on>` line. `new_due_on` is selected in the query (line 52) and carried in the `JournalEntry` type but is never rendered, so the intended "when is it next due after this watering" information is absent, and `prev_due_on` (the pre-watering due date) is shown instead. Functionally a display choice, but it diverges from plan intent and leaves `new_due_on` dead-fetched.
- **Fix A ⭐ Recommended**: Render `new_due_on` as the secondary line ("Next due {formatShortDate(entry.new_due_on)}") per the plan.
  - Strength: Matches the plan's stated end state and the journal's purpose (tells you the schedule each watering produced); uses the already-fetched field.
  - Tradeoff: Drops the "was scheduled for" signal (whether the watering was early/late).
  - Confidence: HIGH — one-line swap, field already selected and typed.
  - Blind spot: Whether the team deliberately preferred showing tardiness over next-due.
- **Fix B**: Show both — "Watered {watered_on} · was due {prev_due_on} → next due {new_due_on}".
  - Strength: Preserves late/early context and the schedule result; uses every fetched field.
  - Tradeoff: Denser row; more layout work than the plan scoped.
  - Confidence: MED — needs a small layout adjustment to the 3-col grid.
  - Blind spot: Visual density on mobile.
- **Decision**: RESOLVED-IN-PLAN — code kept as-is ("Scheduled for {prev_due_on}"); plan Desired End State #3 and Phase 2 contract updated to match the implemented behavior. `new_due_on` intentionally retained for undo/S-04.

### F2 — All-plants "Try again" button hand-rolls classes instead of the Button pattern

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/plants/index.astro:67
- **Detail**: The error-state "Try again" button uses inline literal classes (`bg-green-600 px-4 py-2 font-medium text-white hover:bg-green-700`) with `onclick="window.location.reload()"`. Every other button in the same file uses `LinkButton`, and the equivalent fetch-error "Try again" in `today-list.tsx:157` uses the `<Button>` component. This hand-rolls raw color values instead of design tokens/`buttonVariants` and violates the AGENTS.md `cn()`/shadcn convention.
- **Fix**: Apply `buttonVariants({ variant: "default" })` via `class:list` to a plain `<button onclick="window.location.reload()">`, matching the token-based styling used elsewhere.
- **Decision**: FIXED — replaced inline classes with `buttonVariants({ variant: "default" })` via `class:list`; added `buttonVariants` to the button import.

### F3 — Shared header.astro extracted (not in plan)

- **Severity**: 🟢 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: src/components/header.astro:1
- **Detail**: Phase 3 planned to add an "All plants" nav link inside `authed-shell.astro` (and optionally `new.astro`). Instead a new shared `header.astro` was created and adopted by `authed-shell.astro`, `new.astro`, `plants/index.astro`, and `plants/[id].astro`, with a `current` prop driving `aria-current`. This is EXTRA vs. the plan but a benign DRY improvement that achieves the consistency the plan flagged as optional. No action needed beyond noting the scope addition.
- **Fix**: None — accept as a beneficial refactor. Optionally note in the plan as an addendum.
- **Decision**: NOTED-IN-PLAN — Phase 3 §3 addendum records the `header.astro` extraction; no code change.
