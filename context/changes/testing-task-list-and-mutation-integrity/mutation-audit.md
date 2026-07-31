# Phase 6 Mutation Audit

Run on 2026-07-31 with the unit-only Stryker configuration:

- `pnpm test:mutants --mutate "src/lib/schedule.ts:19-37" --force`
  - Result: 4/4 mutants killed; no survivors to accept or fix.
- `pnpm test:mutants --mutate "src/lib/due.ts" --force`
  - Initial result: three survivors, all reviewed as user-visible selection defects.
  - `findNextUpcoming` could replace an already-earlier upcoming plant with a later
    one, and could replace the first of two equally due/equally named plants. Tests
    now pin both contracts.
  - Final result: 21/21 mutants killed; no survivors accepted.

The audit covers unit modules only. Action orchestration and integration tests are
outside this mutation run. The `+2` postpone constant, season selection, and undo
currency check are PL/pgSQL and invisible to Stryker; `pnpm test:sql` is their
mutation-equivalent gate.
