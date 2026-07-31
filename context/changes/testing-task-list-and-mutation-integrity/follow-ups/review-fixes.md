# Follow-ups from implementation review

Deferred items raised during `/10x-impl-review`. Each entry names the review that raised it.

## Make `loadTodayPlants` error branches observable

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
- **Proposed fix**: Log both branches following the eslint-disable rationale pattern already used
  in `src/actions/index.ts`, so a Storage or query failure is diagnosable in production.
