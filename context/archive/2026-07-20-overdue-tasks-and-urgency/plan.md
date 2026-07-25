# Overdue Tasks and Urgency Implementation Plan

## Overview

Make overdue watering tasks unmistakable on the Today list without changing the dependable scheduling loop. Existing carry-over, ordering, and Watered behavior remain intact; this slice adds browser-local overdue classification, accessible amber urgency cues, and one stronger treatment beginning on the third overdue day.

## Current State Analysis

The Today island already loads every owned plant, derives the browser-local calendar date after hydration, and keeps that date current across local midnight (`src/components/today-list.tsx:39-65`). It includes every plant whose `next_due_on` is less than or equal to today, so overdue tasks already persist alongside tasks due today (`src/components/today-list.tsx:138-143`). The server-provided order is due date then plant name, which means the oldest overdue task naturally stays first (`src/components/authed-shell.astro:16-20`).

The missing behavior is semantic and visual. Today and overdue rows share the same markup and neutral treatment, while `formatDueLabel` only distinguishes equality from a generic exact date (`src/components/today-list.tsx:235-285`, `src/lib/date.ts:26-28`). DST-safe UTC epoch-day conversion and `YYYY-MM-DD` validation already exist in `src/lib/interval.ts:1-20`; the overdue classifier must reuse that calendar primitive rather than duplicate it. Light and dark warning surface/foreground tokens already exist, but the stronger semantic warning accent specified by the design system is not exposed (`src/styles/global.css:22-24`, `src/styles/global.css:59-61`, `src/styles/global.css:100-102`).

The existing Watered coordinator is load-bearing: it prevents duplicate writes, permits unrelated concurrent writes, animates optimistic removal, restores failed rows and focus, and offers Retry (`src/components/today-list.tsx:76-136`). This plan treats that behavior as an invariant rather than redesigning it.

## Desired End State

On Today, every task due before the browser-local date remains in the same due-date-sorted ledger and shows a warning icon, a visible `Overdue` label, and its exact due date. Same-year due dates retain the compact localized day/month format; dates from another year include the localized year so an indefinitely carried task remains unambiguous. Tasks one or two days overdue use the standard amber treatment. Beginning at three days overdue, the row gains one stronger amber emphasis while retaining the same wording and hue family. Tasks due today retain their current neutral appearance and `Due today` label.

The urgency remains perceivable without color, readable in light and dark modes, compact at 320px and 200% zoom, and compatible with keyboard navigation and reduced motion. Marking either a standard or strongly overdue task Watered continues to use the existing optimistic, retryable action path.

### Key Discoveries:

- Carry-over and same-action clearing already satisfy the functional half of US-02; no database, query, migration, or Astro Action change is needed (`context/foundation/prd.md:59-67`, `src/components/today-list.tsx:76-143`).
- The roadmap confines this slice to Today urgency and assigns Postpone/Undo to S-04 (`context/foundation/roadmap.md:106-127`).
- The exact browser-local date is only trustworthy inside the hydrated Today island; applying urgency to SSR All Plants or detail pages would introduce timezone-boundary errors (`src/components/today-list.tsx:49-65`, `src/pages/plants/index.astro:52-54`).
- Generic date classification belongs in `src/lib/`, following the accepted no-duplication lesson (`context/foundation/lessons.md:5-10`).
- The repository has no automated test runner or test script; established executable gates are Astro check, lint, and build (`package.json:6-14`).

## What We're NOT Doing

- No separate Overdue and Today sections; the single due-date-sorted ledger remains.
- No numeric `N days overdue` copy; rows retain the exact due date beside the `Overdue` label.
- No additional severity tiers beyond the single three-day escalation threshold.
- No overdue treatment on All Plants or plant detail.
- No database, RLS, query, migration, Astro Action, or DTO changes.
- No Postpone, Undo, seasonal intervals, editing, deletion, reminders, or future-task view.
- No test-runner installation or unrelated Sonner, focus-token, skeleton-motion, or button-size cleanup.

## Implementation Approach

Centralize the existing validated UTC epoch-day conversion in the shared date module, make interval scheduling and a new overdue classifier consume that single primitive, expose the missing semantic warning accent through the global light/dark token system, and consume the classifier in the existing Today row renderer. Classification is derived from the same browser-local `today` state that controls list inclusion, so midnight rollover updates visibility and urgency together without a reload.

The Today row remains one structural variant with conditional semantic treatment. Due-today rows stay unchanged; overdue rows add compact, non-color-only content inside the information link while the Watered button remains an independent sibling. The strong state changes emphasis only, not wording, ordering, action behavior, or color meaning.

## Critical Implementation Details

### Timing & lifecycle

Overdue-day arithmetic must compare calendar dates as UTC epoch days derived from validated `YYYY-MM-DD` parts, not elapsed local milliseconds. This keeps the 1-day, 2-day, and 3-day boundaries exact across DST transitions and lets the existing local-midnight timer reclassify open rows correctly.

### User experience spec

The warning icon is decorative because the adjacent visible `Overdue` text carries the accessible meaning; hide the icon from assistive technology to avoid duplicate announcements. The exact due date remains visible, and the three-day state strengthens the amber marker/surface without introducing red, a new label, or another severity tier.

## Phase 1: Overdue Classification and Urgency Treatment

### Overview

Add the shared calendar classification, semantic warning accent, and responsive accessible row treatment, then verify the existing task-clearing flow has not regressed.

### Changes Required:

#### 1. Shared calendar-day primitive and overdue classification

**Files**: `src/lib/date.ts`, `src/lib/interval.ts`

**Intent**: Give interval scheduling and the Today island one reusable, validated, calendar-safe source of UTC epoch-day truth, then classify whether a visible task is due today, overdue by one or two days, or in the stronger three-plus-day state.

**Contract**: Move the existing `YYYY-MM-DD` validation and UTC epoch-day conversion from `src/lib/interval.ts` into reusable exports in `src/lib/date.ts`; update `nextDue` to consume those exports without changing its signature or behavior. Export an overdue classification helper whose inputs are validated `YYYY-MM-DD` due and today strings and whose result distinguishes `due-today`, `overdue`, and `overdue-strong`. The three-day threshold is inclusive. Do not leave a second epoch-day implementation in `src/lib/interval.ts`. Keep `formatDueLabel` compatible with All Plants and detail so this slice does not propagate urgency semantics into SSR surfaces.

#### 2. Semantic warning accent tokens

**File**: `src/styles/global.css`

**Intent**: Supply the stronger amber accent described by the design system without hard-coded component colors or misuse of chart/destructive tokens.

**Contract**: Add `--warning-accent: oklch(0.62 0.16 70)` to the light palette and `--warning-accent: oklch(0.7 0.15 70)` to the dark palette, then expose it as `--color-warning-accent` through Tailwind's inline theme mapping. Preserve the existing warning surface and foreground meanings; the new accent is for the stronger marker/emphasis, never destructive red. Verify the accent and existing focus green remain distinguishable against both warning surfaces in their respective palettes.

#### 3. Today row urgency semantics and presentation

**File**: `src/components/today-list.tsx`

**Intent**: Make overdue rows immediately scannable and non-color-dependent while keeping the current ledger, link/action separation, optimistic mutations, and stable ordering.

**Contract**: For each visible row, classify `next_due_on` against the island's browser-local `today`. Due-today rows retain their existing neutral treatment, metadata, and muted link hover. Overdue rows render a decorative warning icon, visible `Overdue` text, exact `Due <date>` metadata, warning foreground, and a restrained warning-surface tint; format the overdue date with localized day/month when its year matches `today`, and include the localized year otherwise. Keep this year-aware formatting specific to Today so All Plants and detail retain their existing `formatDueLabel` behavior. Replace the link's unconditional muted hover with a semantic brightness change that preserves the amber surface. Rows classified `overdue-strong` use the full warning surface and render the same glyph filled with the semantic warning accent from day three onward, while standard overdue rows use the outline glyph. The stronger surface luminance plus filled-versus-outline glyph must keep the two overdue states distinguishable in grayscale without a new label, hue, side stripe, or typography change. Retain the existing green focus outline and verify its contrast on both warning surfaces. Keep the single `<ul>`, current order, photo/name link, sibling Watered button, count semantics, transition classes, pending/Retry behavior, and reduced-motion path unchanged.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `pnpm exec astro check`
- Linting passes: `pnpm lint`
- Production build passes: `pnpm build`

#### Manual Verification:

- A task due today remains neutral and says `Due today`.
- Tasks one and two days overdue show icon + `Overdue` + exact due date with the standard amber treatment.
- A task exactly three days overdue, and any older task, uses the single stronger amber emphasis without different wording or additional tiers.
- Mixed rows remain in due-date/name order in one ledger, and the Today count includes today plus all overdue tasks.
- Standard and strong overdue rows remain readable and distinguishable without color in light mode, dark mode, and a color-blindness simulation.
- The row remains usable at 320px, common phone widths, and 200% zoom without horizontal page scrolling or hiding the exact date, plant identity, or Watered action.
- Keyboard focus remains visible; the information link and Watered button remain independently operable; the icon is not redundantly announced by a screen reader.
- Watered success, concurrent actions on different plants, duplicate prevention, offline rollback, Retry, focus restoration, and reduced-motion removal behave exactly as before for overdue rows.
- Crossing local midnight updates row inclusion and overdue intensity without a reload, including the two-to-three-day threshold.

**Implementation Note**: After all automated verification passes, pause for human confirmation of the light/dark, responsive, assistive-technology, midnight-boundary, and mutation-regression checks before closing the phase.

---

## Testing Strategy

### Unit Tests:

- Do not introduce a test runner in this slice. Keep classification pure and isolated in `src/lib/date.ts` so boundary cases can move into unit tests when project-wide test tooling is established.

### Integration Tests:

- No automated integration harness exists. Exercise mixed today/overdue fixtures against the running app and verify the existing Astro Action path remains unchanged.

### Manual Testing Steps:

1. Create or update fixtures due today, one day ago, two days ago, three days ago, substantially earlier in the current year, and in a prior calendar year.
2. Confirm the single ledger order, labels, exact dates, standard/strong boundary, and total count.
3. Test light/dark modes, color-blindness simulation, keyboard traversal, a screen reader, 320px width, and 200% zoom.
4. Mark standard and strong overdue plants Watered, including concurrent rows and forced offline failure/Retry.
5. Simulate local midnight with a row crossing from two to three days overdue and confirm reclassification without reload.

## Performance Considerations

Classification is constant work per already-rendered row and does not add network requests, storage reads, server filtering, or hydration boundaries. At the expected 10–30 due rows, it does not materially change the well-under-one-second list target. Keep classification in the existing render pass and avoid additional state or effects per row.

## Migration Notes

No data or API migration is required. Rollback consists of reverting the Today row treatment, overdue classifier, and new semantic token; stored schedules and watering history remain untouched.

## References

- Product requirements: `context/foundation/prd.md:59-67`, `context/foundation/prd.md:100-110`, `context/foundation/prd.md:128-133`
- Roadmap slice and boundary: `context/foundation/roadmap.md:106-127`
- Product/design principles: `PRODUCT.md:35-49`, `DESIGN.md:130-140`, `DESIGN.md:185-191`
- Existing Today behavior: `src/components/today-list.tsx:39-143`, `src/components/today-list.tsx:206-285`
- Existing warning tokens: `src/styles/global.css:22-24`, `src/styles/global.css:59-61`, `src/styles/global.css:100-102`
- Upstream implementation context: `context/changes/core-watering-loop/plan.md`, `context/changes/plant-detail-and-journal/plan.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Overdue Classification and Urgency Treatment

#### Automated

- [x] 1.1 Type checking passes — 11d3fc0
- [x] 1.2 Linting passes — 11d3fc0
- [x] 1.3 Production build passes — 11d3fc0

#### Manual

- [x] 1.4 Due-today task remains neutral with `Due today`
- [x] 1.5 One- and two-day overdue tasks show the standard non-color-only amber treatment
- [x] 1.6 Three-plus-day overdue tasks show one stronger amber treatment without added tiers
- [x] 1.7 Mixed rows retain one stable ledger and inclusive count
- [x] 1.8 Standard and strong states pass light/dark and color-blindness checks
- [x] 1.9 Layout preserves identity, exact date, and Watered action at 320px and 200% zoom
- [x] 1.10 Keyboard and screen-reader semantics remain correct
- [x] 1.11 Watered concurrency, rollback, Retry, focus, and reduced-motion behavior do not regress
- [x] 1.12 Local-midnight rollover and the two-to-three-day threshold update without reload
