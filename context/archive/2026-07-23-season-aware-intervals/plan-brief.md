# Season-Aware Intervals — Plan Brief

> Full plan: `context/changes/season-aware-intervals/plan.md`

## What & Why

YAPCA will store separate growing- and dormancy-season watering intervals for every plant and automatically use the correct one when creating the next schedule. This delivers FR-008/FR-015 while preserving the product's central promise: exact, predictable calendar arithmetic with no hidden schedule changes.

## Starting Point

Plants currently have one interval and a materialized due date. Add Plant and the atomic Watered RPC create schedules from that value; Postpone and Undo operate on exact persisted dates and can remain unchanged.

## Desired End State

Growing season is fixed from March 1 through October 31, inclusive; dormancy covers November through February. Creation and Watered select the active interval from the user's browser-local action date, while an existing due date stays fixed across a season boundary. Today and All plants show the active schedule, and plant detail makes both intervals inspectable.

## Key Decisions Made

| Decision | Choice | Why |
| --- | --- | --- |
| Configuration | Fixed application-wide seasons | Keeps season ambient and avoids a settings model |
| Boundaries | Growing Mar 1–Oct 31; dormancy Nov–Feb | Simple inclusive month boundaries with clean year wrapping |
| Schedule rollover | Apply the new season on the next schedule-creating action | Preserves deterministic materialized dates and Undo |
| Existing data | Copy the old interval into both fields | Preserves behavior without inventing plant-care preferences |
| Visibility | Active schedule on Today/All; both on detail | Balances daily scanning with inspectable rules |
| Journal | Keep existing before/after-date contract | Exact dates already support deterministic history and Undo |
| Calendar authority | Browser-local action date | Matches the user's physical care day and existing Today lifecycle |
| Verification | SQL/RPC checks plus existing project gates | Covers authoritative boundaries without adding a test framework |

## Scope

**In scope:**

- Two independently validated 1–365 day intervals per plant
- Compatible schema backfill and regenerated database types
- Season-aware add scheduling and atomic Watered RPC
- Shared TypeScript season helpers and equivalent SQL rule
- Local-date schedule presentation across Today, All plants, and detail
- Repeatable SQL boundary, ownership, Postpone, and Undo verification

**Out of scope:**

- Configurable boundaries, hemispheres, climate/species recommendations, or weather inputs
- Boundary-triggered due-date rewrites, background jobs, or read-side mutations
- Plant editing/recalculation, journal snapshots, and changes to Postpone or Undo
- New JavaScript/browser test framework

## Architecture / Approach

The migration replaces `interval_days` with `growing_interval_days` and `dormancy_interval_days`, copying the old value into both and preserving `next_due_on`. `mark_watered` retains its authenticated row lock and atomic event transaction but selects one interval from `p_acted_on`. A shared `src/lib/season.ts` rule drives the add flow and UI; a lightweight Astro component enhances server-rendered schedule metadata with the browser-local date and refreshes it at local midnight.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Seasonal Scheduling Foundation | Safe schema evolution, authoritative RPC selection, seed/types, SQL verification | Boundary mismatch between TypeScript and SQL |
| 2. Season-Aware Plant Creation | Two-field form and correct initial scheduling | Preview and server scheduling disagree |
| 3. Active-Season Schedule Presentation | Transparent active schedule across all existing views | SSR labels use the wrong calendar day |

**Prerequisites:** Existing core loop, journal, and Postpone/Undo migrations; local Supabase running for reset, verification, and type generation.

**Estimated effort:** About 3 focused implementation sessions across 3 phases, plus manual boundary/accessibility verification.

## Open Risks & Assumptions

- Fixed dates intentionally model a broad Northern Hemisphere cycle and will not fit every climate.
- TypeScript and SQL duplicate the same small boundary rule because the database remains the mutation authority; verification must keep them aligned.
- Static Astro pages require browser enhancement to name the active season truthfully on boundary days.
- Rolling back after users save unequal seasonal values is lossy; production should prefer a forward fix.
- S-06 must edit both interval fields and decide separately how edits affect a stored due date.

## Success Criteria (Summary)

- Existing plants retain their schedules, and new plants persist two explicit seasonal intervals.
- Watered on either side of both boundaries produces exactly `action date + active interval`; Postpone and Undo do not regress.
- Today, All plants, and detail communicate the browser-local active schedule clearly without rewriting an outstanding due date.
