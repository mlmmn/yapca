<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Overdue Tasks and Urgency Implementation Plan

- **Plan**: context/changes/overdue-tasks-and-urgency/plan.md
- **Scope**: Phase 1 of 1
- **Date**: 2026-07-20
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 3 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | FAIL |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | WARNING |

## Verification

| Criterion | Result | Evidence |
|-----------|--------|----------|
| `pnpm exec astro check` | PASS | Exit 0; 0 errors, 0 warnings, 9 pre-existing deprecation hints |
| `pnpm lint` | PASS | Exit 0; ESLint completed with `--max-warnings=0` |
| `pnpm build` | PASS | Exit 0; Cloudflare server build completed |
| Manual acceptance | PENDING | Progress items 1.4–1.12 are all unchecked |

## Findings

### F1 — Urgency escalation is weaker than the approved treatment

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: src/components/today-list.tsx:269
- **Detail**: The plan requires a resting warning tint for standard overdue rows and the full warning surface for strong rows. Standard rows currently have no resting warning surface, strong rows use only `bg-warning/5`, and both become the same `hover:bg-warning/20`. In the strong SVG, the circle fill and exclamation stroke also share `currentColor`, so the exclamation disappears into a solid disk. This weakens the day-three distinction in normal, hover, and grayscale states.
- **Fix**: Apply an explicit restrained warning tint to standard rows, the full semantic warning surface to strong rows, state-specific hover values that preserve the hierarchy, and a contrasting interior mark for the filled strong icon.
  - Strength: Implements the reviewed design contract using the semantic tokens already added by this phase.
  - Tradeoff: Requires visual verification in both themes and grayscale after the class/SVG adjustment.
  - Confidence: HIGH — the mismatch is directly visible in the row classes and SVG paint rules.
  - Blind spot: Exact perceptual contrast still needs the pending manual color and focus checks.
- **Decision**: FIXED

### F2 — The information link no longer contains the full task identity

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Pattern Consistency
- **Location**: src/components/today-list.tsx:273
- **Detail**: The prior Today row and `src/pages/plants/index.astro` wrap the photo, name, and scheduling metadata in the information link. The new anchor contains only the plant-name paragraph; the photo and overdue/date/interval content are sibling nodes. Its absolute pseudo-element expands pointer paint and focus across the entire row, including the separate Watered control, but does not make the excluded content part of the link's accessible semantics. This conflicts with the plan's linked photo/name region and independent-control focus requirement.
- **Fix**: Make the photo, name, overdue status, exact date, and interval actual descendants of the two-column information link, keep Watered as its sibling, and constrain the link's hover/focus treatment to that linked grid region.
  - Strength: Restores the established repository pattern and gives pointer, keyboard, and assistive-technology users the same linked information.
  - Tradeoff: Requires a small grid/anchor restructure and responsive keyboard verification.
  - Confidence: HIGH — both the pre-change implementation and the All Plants sibling establish the intended structure.
  - Blind spot: Screen-reader output has not yet been manually exercised.
- **Decision**: SKIPPED

### F3 — Optimistic row collapse lost overflow containment

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/today-list.tsx:267
- **Detail**: The row refactor removed the existing `overflow-hidden` while retaining the max-height and padding collapse. During optimistic removal or rollback, grid children can paint or remain hit-testable outside a collapsing row, risking overlap and a stray navigation target in the load-bearing Watered flow.
- **Fix**: Restore `overflow-hidden` on the task row while retaining the new background-color transition.
- **Decision**: SKIPPED

### F4 — Exported due classifier does not enforce its input contract

- **Severity**: 👁️ OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/lib/date.ts:64
- **Detail**: `classifyDueStatus` is exported as a generic helper but does not validate either `YYYY-MM-DD` input. Invalid dates fall through through `NaN`, and any future date is returned as `overdue`. The current Today call is protected by trusted date sources and the `next_due_on <= today` filter, but the shared API does not encode those preconditions and can be reused incorrectly.
- **Fix**: Validate both inputs and reject a negative day difference with a clear error so the exported helper enforces its documented visible-due-only contract.
  - Strength: Prevents silent misclassification while preserving the plan's three-value result type and Today-only scope.
  - Tradeoff: Introduces explicit exceptions if a future caller violates the precondition.
  - Confidence: HIGH — malformed and future values deterministically take the current overdue fallthrough.
  - Blind spot: No automated unit-test harness exists yet for boundary cases.
- **Decision**: FIXED

### F5 — Manual acceptance evidence is still pending

- **Severity**: 👁️ OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Success Criteria
- **Location**: context/changes/overdue-tasks-and-urgency/plan.md:159
- **Detail**: Progress items 1.4–1.12 remain unchecked. That accurately avoids rubber-stamping, but leaves the light/dark and grayscale distinction, 320px/200% layout, keyboard and screen-reader semantics, Watered regression matrix, and local-midnight threshold unverified.
- **Fix**: Run the documented manual matrix and mark only checks backed by observed evidence before treating the change as fully accepted.
  - Strength: Covers the interaction and perceptual risks that the repository's current automated gates cannot prove.
  - Tradeoff: Requires fixtures, browser/device simulation, assistive-technology checks, and mutation-failure setup.
  - Confidence: HIGH — every manual Progress row is explicitly pending.
  - Blind spot: None significant.
- **Decision**: SKIPPED
- **Post-triage state**: The plan's manual rows were changed to checked during triage outside this review. The reviewer did not observe supporting manual-test evidence, so the skipped decision is unchanged.

## Scope Evidence

Commit `11d3fc0` changes exactly the four planned product files plus five artifacts inside the change folder. No database, RLS, query, migration, Astro Action, DTO, All Plants/detail urgency, Postpone/Undo, or test-tooling scope was added.

## Triage Summary

- **Fixed**: F1, F4
- **Skipped**: F2, F3, F5
- **Accepted as rule**: None
- **Pending**: None
