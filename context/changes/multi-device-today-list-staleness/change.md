---
change_id: multi-device-today-list-staleness
title: Today list goes unboundedly stale across devices
status: blocked
created: 2026-08-01
updated: 2026-08-01
archived_at: null
---

## Notes

**Deliberately postponed until after MVP.** `status: blocked` here records a scheduling
decision, not a technical blocker — nothing prevents this work starting; it is being held
back on purpose. Flip to `new` when MVP ships and this becomes eligible for planning.

Today list is an unbounded-stale one-shot SSR snapshot under real multi-device use.

PROBLEM: The Today list is loaded once server-side and frozen into React state, with no
revalidation of any kind. A second device (phone + desktop, household) can therefore display
a plant as due indefinitely after it was already watered elsewhere, and offer an action that
is already done. Taking that action succeeds and records a duplicate watering event.

EVIDENCE (all verified 2026-08-01):

- One-shot SSR snapshot frozen into client state: `src/components/authed-shell.astro:7,18-20`
  → `src/components/today-list/today-list.tsx:41` (`useState(plants)`); loader at
  `src/lib/services/load-today-plants.ts:20-24` is a single request-time select.
- No revalidation anywhere in `src/`: no polling/`setInterval`, no Supabase realtime
  channel/subscribe, no SWR or react-query (`package.json` has only `@supabase/ssr` and
  `@supabase/supabase-js`), no service worker.
- The only `visibilitychange`/`pageshow` listeners (`src/lib/timezone.ts:181-198`, via
  `src/components/hooks/use-browser-today.ts`) recompute the local calendar date at midnight
  rollover; they never re-fetch plant data.
- Staleness is UNBOUNDED: a tab's `basePlants` snapshot is valid from page load until the
  user navigates/reloads or acts in that same tab. Nothing external invalidates it.
- Same pattern on the edit form: `src/pages/plants/[id]/edit.astro:26-30,85` →
  `src/components/edit-plant-form/edit-plant-form.tsx:80` submits an arbitrarily stale
  `updated_at` token. That path at least has a server-side optimistic lock
  (`src/actions/index.ts:169`); the Today list has no equivalent guard.

REQUIREMENTS GAP (not a deferral): multi-device-per-account concurrency appears nowhere in
`context/foundation/prd.md`, `shape-notes.md`, `roadmap.md`, or `context/archive/**`. The
nearest text, `prd.md:159` "No shared or household collections", is a non-goal about
cross-ACCOUNT sharing, a different question. The product owner has since confirmed
phone+desktop household use is genuinely real.

ARCHITECTURAL CONSTRAINT: `has_realtime: false` was an explicit hard filter during stack
selection (`context/foundation/tech-stack.md:17`), and infrastructure was chosen on the basis
that the app needs no persistent server-side connections
(`context/foundation/infrastructure.md:21`). So Supabase Realtime is available on the platform
but deliberately unused. A cheaper middle path (revalidate on focus/`visibilitychange`, or a
staleness TTL) should be weighed against realtime before treating this as an
architecture-scale decision.

STATUS: deliberately postponed until after MVP. Absent from the PRD, and closing it requires
an architectural decision that MVP scope does not justify. Record the deferral explicitly so
it is a decision rather than an oversight.

PRIOR DECISION worth revisiting: `context/archive/2026-07-23-postpone-and-undo/plan.md:44`
justified skipping cross-tab sync with "another tab reflects changes after its normal
reload/navigation". That assumption is worth re-testing against whatever the codebase looks
like when this change is picked up.
