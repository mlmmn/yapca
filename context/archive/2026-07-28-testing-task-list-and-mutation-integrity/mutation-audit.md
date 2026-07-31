# Phase 6 Mutation Audit

## Runner configuration (deviation from plan)

The plan specified only `"testFiles"` in `stryker.config.json`. Constraining Stryker to unit
tests needed more than that: its Vitest runner exposes only `configFile`/`dir` with no project
selector and invokes vitest without `--project`, so a multi-project `vitest.config.ts` starts the
integration project too — which requires Docker.

Phase 6 first shipped a separate `vitest-mutation.config.ts` duplicating the unit project block.
Impl review (F5) flagged the duplication as an unguarded silent-drift risk: mutants could end up
scored against a suite that is not the one gating the repo. Resolved on 2026-07-31 by dropping
Vitest projects entirely in favour of one config per suite:

- `vitest.config.ts` — unit suite; read by `pnpm test`, `lefthook.yml`, and Stryker alike, so
  parity is structural rather than conventional.
- `vitest.integration.config.ts` — integration suite; `pnpm test:integration --config …`.
- `vitest-mutation.config.ts` — deleted.

`sequence.groupOrder` was removed with the projects; it existed solely to keep the multi-project
config resolvable for tools that pass no `--project`.

## Results

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
