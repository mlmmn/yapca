---
change_id: testing-runner-and-calendar-math
title: Testing runner and calendar math
status: impl_reviewed
created: 2026-07-26
updated: 2026-07-26
archived_at: null
---

## Notes

- D-1: `AddPlantForm` and `EditPlantForm` capture the SSR `today` and do not refresh it,
  so a preview can disagree with the action after local midnight; see
  `research.md:538-547`.
- D-2: `getActionDate` falls back to UTC when no timezone is available, which can select
  the wrong season for users behind UTC; see `research.md:548-554`.
- D-3: `today === null` widens Today to every plant, and a `sessionStorage`-blocked
  browser may never recover from that degraded state; see `research.md:555-564`.
- The defects are handed to `context/changes/today-acquisition-defects/` for planning;
  D-3's intended behaviour remains deliberately unsettled.
