# Testing Quality Gates Wiring — Plan Brief

> Full plan: `context/changes/testing-quality-gates-wiring/plan.md`

## What & Why

Rollout Phase 5 of the test plan: make the test floor load-bearing. Three test suites
already exist and pass, but run only on developers' machines — the test plan has marked
two of them "required" since Phases 2 and 3 and neither has ever gated a merge. On top
of that, Risk #8 (a migration destroys or orphans existing rows) has no coverage in any
form, because it is the one risk with no code under test.

## Starting Point

CI is a single no-Docker job: lint → `astro check` → unit suite ×2 timezones → build.
`pnpm test:integration`, `pnpm test:sql` and `pnpm test:http` are unenforced.
`lefthook.yml:21-23` already recorded that the integration suite belongs in CI as a
blocking gate. The harness needs no changes — `test/setup/load-env.ts:55-62` already
falls back to environment variables when `.env` is absent.

## Desired End State

A pull request cannot merge unless lint, typecheck, both unit runs and the build pass;
the integration, SQL and HTTP suites pass against a real Supabase stack in CI; and — when
it touches `supabase/migrations/**` — its migrations are shown to leave pre-existing rows
intact and queryable. Proven by breaking one gate on a throwaway PR and watching GitHub
refuse the merge.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| CI topology | Split `static` + `database` (+ `migrations`) jobs | Lint/type failures report in ~2 min instead of queueing behind a Supabase boot; a red X names which floor dropped | Plan |
| Suites to enforce | integration, sql, http — all blocking | §5 marks the first two overdue; http's "local-only" status is exactly the silent floor-drop this phase closes, and it is near-free once the stack is up | Plan |
| Stryker | stays advisory, out of CI | §4/§5 designate it never-blocking; its unnarrowed glob would report noise | Test plan |
| Migration gate design | Baseline replay against the merge base | Rows must exist *before* the migration under test — the only arrangement where a destructive migration can fail. Full-chain-from-empty is the §2 anti-pattern in gate form | Plan |
| Replay mechanism | `supabase db reset --version <ts> --no-seed` | Verified present in CLI 2.109.1; removes the need for git-checkout reconstruction of the base schema | Plan |
| Migration history | Add-only relative to the base ref | Modified, deleted, copied or renamed base migrations cannot be reconstructed by replaying the current working tree; corrections ship as new migrations | Plan |
| Fixture source | Dedicated `supabase/migration-gate/baseline-fixture.sql` | `seed.sql` must track the *newest* schema (`lessons.md:12-17`); the gate needs rows valid at the *previous* one. One file cannot be both | Plan |
| Fixture location | Outside `supabase/tests/` | `scripts/run-sql-tests.sh:12` globs that directory — files there would be pulled into every `pnpm test:sql` run | Plan |
| Gate trigger | Always-run job, short-circuits when no migration changed | A path-filtered job that reports "skipped" cannot be a required check; short-circuiting keeps the name stable at near-zero cost | Plan |
| Enforcement | Manual branch-protection step + deliberate-break verification | A workflow that runs but isn't required blocks nothing — the only proof is watching a merge get refused | Plan |
| Flake handling | No retries, no `continue-on-error` | A retried gate is a weakened gate; a flaky suite is a defect to fix | Plan |

## Scope

**In scope:** CI restructure into three jobs; integration/sql/http as blocking gates; a
new baseline-replay migration-safety gate (fixture, assertions, runner, `pnpm
test:migrations`); branch-protection configuration; test-plan §5/§6/§8 and README updates.

**Out of scope:** Stryker in CI; any browser/e2e layer (§7, gated on roadmap S-09); new
product tests, including the accepted Risk #7 client-island gap; deploy gating; moving
DB suites into lefthook; a static destructive-SQL linter.

## Architecture / Approach

```
PR ──┬── static      no Docker · lint, check, unit ×2 TZ, build
     ├── database    supabase start → .env from `status -o env`
     │               → test:integration → test:sql → test:http   (sequential)
     └── migrations  detect changed supabase/migrations/**
                     └─ if none: skip, report green
                     └─ if some: reset --version <base> --no-seed
                                 → insert baseline fixture rows
                                 → migration up
                                 → assert every row survived
```

The three suites in `database` share one stack and must stay sequential —
`global-setup.ts:35-38` sweeps fixture users namespace-blind at startup. The migration
gate is destructive (`db reset`), so it gets its own job and its own stack.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Split CI and enlist suites | `static` + `database` jobs; integration/sql/http blocking | `astro dev` in `test:http` needs a real `.env`, not just exported vars; CI wall-clock could exceed budget |
| 2. Migration-safety gate | Fixture, assertions, runner, `pnpm test:migrations`, `migrations` job | `--version` inclusivity is asserted via a self-check rather than assumed; out-of-order migrations must be rejected explicitly |
| 3. Make gates enforcing | Required checks configured and verified by deliberate break | Branch protection is repo settings, not code — nothing in the repo prevents it being unticked later |

**Prerequisites:** Docker + local Supabase stack for local verification; GitHub admin
rights on `mlmmn/yapca` for Phase 3. Before Phase 3, make the repository public and
confirm that the rulesets or branch-protection API is accessible; required checks are
unavailable for this private repository on its current GitHub plan.
**Estimated effort:** ~3 sessions, one per phase, with a manual confirmation gate between each.

## Open Risks & Assumptions

- `supabase db reset --version` is assumed inclusive of the named migration. The gate does
  not rely on that: it queries `supabase_migrations.schema_migrations`, verifies the
  applied set against the expected baseline and fails loudly if the assumption is wrong.
- The baseline fixture must stay valid against `main`'s schema. It is self-policing (every
  migration PR exercises it), but a shape change will surface as a fixture failure on the
  *next* migration PR rather than the one that caused it.
- For an intentional schema transformation, `assert-survival.sql` may change in the
  migration PR to target the post-migration schema only when it maps and asserts every
  original fixture value; the base-schema fixture is not weakened pre-emptively.
- A failing migration can leave the local stack at the baseline or partially migrated
  schema. The runner preserves the original failure and prints recovery instructions;
  after fixing or removing the migration, a full local reset must restore schema and seed.
- Branch protection can be silently disabled by any admin; the README records the required
  check names so it can be restored, but nothing enforces the enforcement.
- The `database` job's wall-clock is unknown until it runs. If it proves painful, the
  answer is a longer timeout, not fewer suites.

## Success Criteria (Summary)

- A PR with a failing integration, SQL, HTTP or unit test cannot be merged.
- A PR whose migration drops a table fails the `migrations` job; a docs-only PR passes it in seconds.
- `context/foundation/test-plan.md` §5 shows every planned gate enforced, and §3 Phase 5 reads `complete`.
