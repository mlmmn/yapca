# Follow-ups from implementation review

Deferred items raised during `/10x-impl-review`. Each entry names the review that raised it.

## ✅ Resolved — Make `loadTodayPlants` error branches observable

- **Source**: `reviews/impl-review-phase-3.md` — F8 (📝 OBSERVATION, Safety & Quality)
- **Location**: `src/lib/services/load-today-plants.ts` — the query `error` branch and the
  `createSignedUrls` call
- **Problem**: `createSignedUrls`'s `error` is destructured away entirely, so a Storage outage
  silently degrades every row to the initial-letter placeholder with no signal. The query `error`
  branch returns `{ plants: null }` without logging. `src/actions/index.ts` (`:86`, `:191`)
  deliberately logs comparable non-fatal failures using the sanctioned `no-console` disable.
- **Why deferred**: This is pre-existing behaviour that Phase 3's plan explicitly required be
  preserved verbatim during the `authed-shell.astro` → service-module extraction. Adding logging
  inside that phase would have broken the verbatim-preservation contract the extraction was
  verified against.
- **Resolution**: Fixed as a standalone change once Phase 3 closed and its verbatim-preservation
  contract was spent. Both branches now log via the `eslint-disable-next-line no-console`
  rationale pattern from `src/actions/index.ts`. Deliberately kept out of the
  `undo-integrity-defects` change: that one revisits an accepted correctness trade-off on the
  write path and must stay independently revertible.
