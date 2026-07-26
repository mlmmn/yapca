---
change_id: today-acquisition-defects
title: Today acquisition defects
status: archived
created: 2026-07-26
updated: 2026-07-26
archived_at: 2026-07-26T00:00:00Z
---

## Notes

- D-1: `AddPlantForm` and `EditPlantForm` receive `today` at SSR and never refresh it,
  unlike `TodayList`'s rollover effect (`src/components/add-plant-form/add-plant-form.tsx:31`,
  `src/components/edit-plant-form/edit-plant-form.tsx:37`,
  `src/components/today-list/today-list.tsx:225-266`). A form left open across local
  midnight can preview one season and save another; see
  `context/changes/testing-runner-and-calendar-math/research.md:538-547`.
- D-2: `getActionDate` falls back to UTC when timezone sources are unavailable
  (`src/actions/index.ts:25`), so a user behind UTC can receive the wrong seasonal
  interval near a boundary; see
  `context/changes/testing-runner-and-calendar-math/research.md:548-554`.
- D-3: when `today === null`, Today lists every plant
  (`src/components/today-list/today-list.tsx:221`). The one-shot recovery relies on
  `sessionStorage` (`src/layouts/layout.astro:43-50`), so blocked storage can leave the
  browser in that degraded state indefinitely; see
  `context/changes/testing-runner-and-calendar-math/research.md:555-564`.

The intended D-3 behaviour is unsettled. Decide its product contract before planning;
asserting its current behaviour would encode the tautology warned about in the test plan.

- Phase 2 seed-data correction: the original local fixture IDs were PostgreSQL-castable
  UUID literals but did not satisfy Astro/Zod's versioned `z.uuid()` validation. The
  seed now uses valid v4 UUIDs for the fixture user and plants; keep Action input
  validation strict rather than weakening it for placeholder seed IDs. Existing local
  databases need `pnpx supabase db reset` to receive the replacement fixture rows.
