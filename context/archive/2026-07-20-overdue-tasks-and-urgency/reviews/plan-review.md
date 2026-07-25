<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Overdue Tasks and Urgency Implementation Plan

- **Plan**: `context/changes/overdue-tasks-and-urgency/plan.md`
- **Mode**: Deep
- **Date**: 2026-07-20
- **Original verdict**: REVISE
- **Verdict after triage**: SOUND
- **Findings**: 0 critical, 3 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | PASS |

## Grounding

Grounding: 10/10 paths ✓ (3/3 original change targets), 8/8 symbols/contracts ✓, brief↔plan ✓

## Findings

### F1 — Plan duplicates existing UTC calendar-day machinery

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architectural Fitness
- **Location**: Implementation Approach; Phase 1.1
- **Detail**: The original plan proposed new UTC epoch-day parsing in `src/lib/date.ts`, but `src/lib/interval.ts:1-20` already owned date validation, `MS_PER_DAY`, and `toEpochDay()`. Reimplementing that arithmetic would violate the accepted no-duplication lesson and create two definitions of DST-safe calendar math.
- **Fix A ⭐ Recommended**: Centralize the reusable validated calendar-day primitive in `src/lib/date.ts`, then make both the new classifier and `nextDue()` consume it.
  - Strength: One source of truth in the repository's generic date module; follows the accepted lesson.
  - Tradeoff: Adds `src/lib/interval.ts` to the phase and touches load-bearing scheduling arithmetic.
  - Confidence: HIGH — the existing implementation already proves the UTC epoch-day approach.
  - Blind spot: The refactor lacks automated boundary tests today.
- **Fix B**: Put the overdue classifier in `src/lib/interval.ts` beside the existing private epoch-day helper.
  - Strength: Smallest change and no duplication or scheduling refactor.
  - Tradeoff: Overdue presentation classification lives in a module named for interval scheduling.
  - Confidence: HIGH — both operations consume the same calendar-day delta.
  - Blind spot: The module boundary becomes less precise.
- **Decision**: FIXED via Fix A

### F2 — Strong urgency treatment still requires design decisions during coding

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Completeness
- **Location**: Phase 1.2–1.3; Success Criteria
- **Detail**: The original contract said only that the strong state adds “warning-accent emphasis.” It did not define the dark accent value, which element receives the accent, how the strong state remains distinguishable in grayscale, or how urgency styling wins over the existing unconditional `hover:bg-muted` at `src/components/today-list.tsx:248-250`.
- **Fix**: Specify the light/dark token values and the standard/strong row, glyph, hover, and focus class responsibilities, including the non-color/luminance distinction.
  - Strength: Makes the visual contract implementable without guessing and prevents the current muted hover from erasing urgency.
  - Tradeoff: Locks the treatment before browser-based visual review.
  - Confidence: HIGH — the current token and hover paths are explicit.
  - Blind spot: Final contrast still needs measurement in both themes.
- **Decision**: FIXED

### F3 — DST-safe boundary correctness has no executable verification

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Testing Strategy; Phase 1 Success Criteria
- **Detail**: Astro check, lint, and build never execute the classifier. The manual fixtures cover 0/1/2/3 days relative to the current date, but do not prove the stated DST, leap-day, or year-boundary guarantee; “simulate local midnight” also has no reproducible procedure.
- **Fix**: Add a concrete verification matrix and procedure covering 0/1/2/3 days, a DST transition, leap day, year rollover, and local-midnight reclassification; make it executable if test tooling is permitted, otherwise document exact fixture/date pairs and clock-simulation steps.
- **Decision**: SKIPPED

### F4 — “Exact due date” becomes ambiguous across years

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Desired End State; Phase 1.3
- **Detail**: Overdue tasks persist indefinitely, but the existing `formatShortDate()` renders only day and month (`src/lib/date.ts:20-23`). For a task overdue across a year boundary, “Due 20 Jul” does not identify the exact calendar date promised by the plan.
- **Fix**: Specify that overdue dates include the year when it differs from the browser-local current year.
- **Decision**: FIXED

## Triage Summary

- **Fixed**: F1 (Fix A), F2, F4
- **Skipped**: F3
- **Accepted**: None
- **Dismissed**: None
- **Verdict change**: REVISE → SOUND, with one minor skipped verification warning
