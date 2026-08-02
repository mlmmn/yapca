# Testing Quality Gates Wiring Implementation Plan

## Overview

Rollout Phase 5 of `context/foundation/test-plan.md`. Two distinct jobs of work sit
behind one goal — "the floor cannot silently drop":

1. **Enlist what already exists.** Three test entrypoints (`test:integration`,
   `test:sql`, `test:http`) run only on a developer's machine. §5 of the test plan
   marks two of them as required since Phases 2 and 3, and neither has ever been
   enforced. CI runs the unit suite alone.
2. **Build the one gate with no code behind it.** Risk #8 (a migration destroys or
   orphans existing rows) is explicitly *not testable as code under test* — §2
   lines 53–57 say so. It needs a CI gate that applies a migration to a database
   that already holds rows, which does not exist in any form today.

A gate that runs but is not a required status check blocks nothing, so the phase
only closes when a deliberately broken gate is observed to block a merge.

## Current State Analysis

**CI** (`.github/workflows/ci.yml`) — a single job, no Docker, 15-minute timeout:
`pnpm install` → `astro sync` → `lint` → `check` → `test` → `TZ=America/New_York test`
→ `build`. `pnpm/action-setup` is commit-pinned (lines 24–26) because the job later
reads `SUPABASE_*` secrets; that convention must survive the restructure.

**Local gate** (`lefthook.yml`) — lint, `astro check`, full unit suite. Lines 21–23
already record the intent this plan cashes in: the integration suite "is deliberately
out of the pre-commit path — … CI is where it belongs as a blocking gate."

**Test entrypoints and what gates them today:**

| Command | Config | Needs | Gated by |
| --- | --- | --- | --- |
| `pnpm test` | `vitest.config.ts` | nothing | lefthook + CI |
| `pnpm test:integration` | `vitest.integration.config.ts` | Docker + local Supabase | nothing |
| `pnpm test:http` | `vitest.http.config.ts` | Supabase + `astro dev` on workerd | nothing |
| `pnpm test:sql` | `scripts/run-sql-tests.sh` | local Supabase | nothing |
| `pnpm test:mutants` | `stryker.config.json` | nothing | advisory by design — stays out |

**The harness is already CI-shaped.** `test/setup/load-env.ts:55-62` catches a missing
`.env` and falls through to a check that variables may be supplied "directly by the
environment (CI, or an inline override)". `assertLocalDatabaseUrl` (lines 23–48) pins
the DB to `127.0.0.1:54322`, which is exactly where a CI-side `supabase start` puts it.
No harness change is required.

**Migrations.** Nine files in `supabase/migrations/`, all additive so far. Existing
SQL checks live in `supabase/tests/*.sql` as transaction-scoped `begin;` + `do $$`
blocks, executed by a plain `psql` loop in `scripts/run-sql-tests.sh:12-19` — no pgTAP.
`supabase/seed.sql` is local-dev fixture data applied *after* the newest migration
(`config.toml` `[db.seed] enabled = true`), which is the opposite of what a
"do migrations preserve existing rows" gate needs.

**Verified CLI capabilities** (Supabase CLI 2.109.1, already a devDependency):

- `supabase db reset --version <ts> --no-seed --local` — resets *up to* a named
  migration and skips the seed. This is the baseline-replay primitive; no
  git-checkout reconstruction of the base schema is needed.
- `supabase migration up --local` — applies pending migrations.
- `supabase migration list --local` — lists applied vs local migrations.
- `supabase status -o env` — emits `API_URL`, `ANON_KEY`, `DB_URL`, a 1:1 match for
  the three variables `load-env.ts:4` requires.

## Desired End State

A pull request cannot merge unless: lint, `astro check`, both unit runs and the build
pass; the integration, SQL and HTTP suites pass against a real local Supabase stack in
CI; and — when it touches `supabase/migrations/**` — its migrations are shown to leave
pre-existing rows intact and queryable.

Verified by opening a throwaway PR that breaks exactly one gate and observing GitHub
refuse the merge, then reverting it.

### Key Discoveries:

- `test/setup/load-env.ts:55-62` already tolerates a missing `.env` and reads from the
  process environment — the integration harness needs no CI-specific branch.
- `scripts/run-sql-tests.sh:12` globs `supabase/tests/*.sql`. Migration-gate SQL placed
  there would be silently pulled into every ordinary `pnpm test:sql` run, including its
  destructive reset logic. The gate's SQL must live outside that directory.
- `scripts/run-sql-tests.sh:21-25` refuses to report success when it executed no files.
  That "empty run is not a pass" principle, and `context/foundation/lessons.md:19-24`
  ("Always verify command status codes"), govern every script this plan adds.
- `test/setup/http-global-setup.ts:128` spawns `astro dev`, which resolves
  `astro:env/server` through Vite's `.env` loading rather than bare `process.env`. CI
  must materialise a real `.env` file, not just export variables. `.env` is gitignored.
- `test/setup/global-setup.ts:35-38` sweeps stale fixture users namespace-blind at
  startup, so two suites must not run against one stack concurrently. Within a single
  CI job the suites run sequentially, which satisfies this.
- `vitest.integration.config.ts:1-5` explains why the suites are separate configs
  rather than Vitest projects (Stryker's runner has no project selector). CI must
  therefore invoke each `pnpm` script separately; there is no single "run everything"
  Vitest invocation to reach for.

## What We're NOT Doing

- **Not wiring Stryker into CI.** §4 and §5 of the test plan designate the mutation
  audit advisory-never-blocking (`break: null`), and its unnarrowed `mutate` glob spans
  all of `src/` while the suites cover a fraction — an enforced run would report noise.
- **Not adding a browser/e2e layer.** §7 excludes the UI while the design is unsettled;
  §8 gates that re-evaluation on roadmap slice S-09.
- **Not adding new product tests.** This phase gates existing coverage and adds one
  gate; it does not close the Risk #7 client-island gap that §2 records as accepted.
- **Not gating deploy.** `pnpx wrangler deploy` stays manual (README "Deploy").
- **Not moving integration suites into lefthook.** `lefthook.yml:21-23` decided against
  it; requiring Docker for every commit is a worse trade than requiring it for merge.
- **Not writing a static destructive-SQL linter.** Considered and rejected: it is
  textual and evadable, and §2 states the Risk #8 signal "exists only when it runs
  against real data."

## Implementation Approach

Three CI jobs, chosen so a red X names which floor dropped:

- `static` — today's job, unchanged in content. No Docker, fast feedback.
- `database` — boots the local Supabase stack once, materialises `.env` from
  `supabase status -o env`, then runs the three DB-backed suites sequentially.
- `migrations` — always runs so its check name always reports, but short-circuits
  before booting anything when no file under `supabase/migrations/**` changed.

The migration gate is a **baseline replay**: reset the database to the migration set
present on the base ref, insert representative rows against that older schema, apply
only the new migrations, then assert every row survived unchanged. Rows exist *before*
the migration under test — the only arrangement in which a destructive migration can
actually fail the check.

Its fixture is a dedicated SQL file rather than `supabase/seed.sql`. The seed tracks the
*newest* schema by design (`lessons.md:12-17`); the gate needs rows valid at the
*previous* schema. One file cannot be both. The dedicated fixture is self-policing: it
is exercised against the base ref's schema on every migration PR, so a shape change that
invalidates it surfaces on the next migration PR rather than rotting silently.

## Critical Implementation Details

**Ordering inside the database job.** `supabase start` applies the full migration chain
and the seed. The three suites then share that one stack and must run sequentially —
`global-setup.ts:35-38` sweeps fixture users namespace-blind at startup, so a
concurrent second suite would delete the first suite's users mid-run. The migration
gate is destructive (`db reset`) and therefore lives in a separate job with its own
stack, never appended to the database job.

**`--version` inclusivity is asserted, not assumed.** After
`supabase db reset --version <baseline>`, the gate compares the applied migration set
against the expected baseline set by querying `supabase_migrations.schema_migrations`
through `psql` and fails if they differ. This stable machine-readable source avoids
parsing the CLI's display output and makes the exact inclusive/exclusive semantics of
the flag irrelevant: a wrong assumption fails loudly at the self-check rather than
producing a gate that quietly tests nothing.

**Migration history is add-only.** The gate compares migration paths against the base
ref with `git diff --name-status`. Any modification, deletion, copy or rename of a
migration already present on the base ref fails before reset; deployed migration files
are immutable, and corrections must be new migrations. New versions are derived only
from files reported as added, so an existing migration can never disappear into the
"nothing to prove" path or be replayed as though its edited content were the base schema.

**Out-of-order migrations break baseline replay.** If a PR adds a migration whose
version sorts *below* the base ref's newest, `db reset --version <baseline>` would
already have applied it and `migration up` would have nothing to prove. The gate must
reject that arrangement explicitly — it is also a genuine hazard worth failing on.

## Phase 1: Split CI and enlist the existing suites

### Overview

Restructure `.github/workflows/ci.yml` from one job into `static` + `database`, and
make the integration, SQL and HTTP suites blocking.

### Changes Required:

#### 1. CI workflow — static job

**File**: `.github/workflows/ci.yml`

**Intent**: Preserve today's job verbatim as a job named `static`, so the fast
signal keeps reporting in roughly its current time and the `SUPABASE_*` build
secrets stay confined to a job that needs no Docker.

**Contract**: Job id `static`, `runs-on: ubuntu-latest`, existing `timeout-minutes: 15`.
Steps unchanged: checkout (with `persist-credentials: false`), the commit-pinned
`pnpm/action-setup`, `actions/setup-node` reading `.nvmrc` with `cache: pnpm`,
`pnpm install --frozen-lockfile`, `pnpm exec astro sync`, `pnpm lint`, `pnpm check`,
`pnpm test`, `TZ=America/New_York pnpm test`, `pnpm build` with the two secrets.
Workflow-level `on`, `permissions` and `concurrency` blocks are untouched.

#### 2. CI workflow — database job

**File**: `.github/workflows/ci.yml`

**Intent**: Add a parallel job that boots the local Supabase stack via the pinned
devDependency CLI and runs the three DB-backed suites as blocking steps.

**Contract**: Job id `database`, `runs-on: ubuntu-latest`, `timeout-minutes: 25` (the
stack boot plus three suites, one of which uploads ~20 MiB). Same checkout / pnpm /
node / install / `astro sync` prelude as `static`. Then `pnpm exec supabase start`
(the CLI is a devDependency at 2.109.1 — do **not** add `supabase/setup-cli`, which
floats a version and introduces a third-party action into a Docker-privileged job).

The env-materialisation step must write a real `.env` file, not only export variables,
because `astro dev` resolves `astro:env/server` through Vite's `.env` loading:

```sh
eval "$(pnpm exec supabase status -o env)"
{
  printf 'SUPABASE_URL=%s\n' "$API_URL"
  printf 'SUPABASE_KEY=%s\n' "$ANON_KEY"
  printf 'SUPABASE_DB_URL=%s\n' "$DB_URL"
} > .env
```

Then three separate steps — `pnpm test:integration`, `pnpm test:sql`,
`pnpm test:http` — in that order, never combined and never parallel. No `continue-on-error`
and no retry wrapper: a retried gate is a weakened gate, and a flaky suite is a defect to
fix, not to paper over.

#### 3. Test-plan status update

**File**: `context/foundation/test-plan.md`

**Intent**: Record that the integration, isolation and HTTP gates are now enforced, so
§5 stops describing a floor that does not exist.

**Contract**: §5 rows for `integration` and `per-account isolation` change from
"required after §3 Phase N" to enforced. A new §5 row covers the HTTP upload boundary
gate. The §4 "HTTP upload boundary" note and the §8 ledger line dated 2026-08-02
("`test:http` is local-only and is not CI-enforced") are corrected. Append a §8 ledger
entry dated 2026-08-02 for this phase.

### Success Criteria:

#### Automated Verification:

- `pnpm lint` passes
- `pnpm check` passes
- Workflow YAML parses: `pnpm exec prettier --check .github/workflows/ci.yml`
- With the local stack running, all four suites pass locally: `pnpm test`, `pnpm test:integration`, `pnpm test:sql`, `pnpm test:http`
- An opened or updated pull request targeting `main` shows both `static` and `database` jobs completing green in GitHub Actions

#### Manual Verification:

- The `database` job log shows `supabase start` succeeding and each of the three suites reporting a non-zero test count — not "no test files found"
- `database` job wall-clock is acceptable (target under ~12 minutes); if not, note the actual figure before proceeding
- `static` still reports in roughly its pre-change time, giving fast lint/type feedback
- No `SUPABASE_*` repository secret is referenced by the `database` job — it uses only the locally booted stack

**Implementation Note**: After completing this phase and all automated verification
passes, pause here for manual confirmation from the human before proceeding.

---

## Phase 2: Build the migration-safety gate

### Overview

Add the baseline-replay gate for Risk #8: a fixture, an assertion script, a runner, and
a CI job that always reports but only does work when migrations changed.

### Changes Required:

#### 1. Baseline fixture

**File**: `supabase/migration-gate/baseline-fixture.sql`

**Intent**: Insert representative rows — an auth user, plants across both season
intervals, and watering events — that a destructive migration would damage. Deliberately
outside `supabase/tests/`, which `scripts/run-sql-tests.sh:12` globs.

**Contract**: Fixed UUIDs in a distinct range from the `00000000-…-0000000002xx` block
already used by `supabase/tests/per-account-isolation.sql`, so the two fixtures cannot
collide. Not transaction-wrapped (unlike the `supabase/tests/*.sql` files) — the rows
must persist across the subsequent `migration up`. Written against the *base ref's*
schema; it never needs pre-emptive updating for a migration in the same PR, since the
base ref is by definition pre-migration.

#### 2. Survival assertions

**File**: `supabase/migration-gate/assert-survival.sql`

**Intent**: After the new migrations apply, assert every fixture row is still present,
still queryable, and still carries its original values.

**Contract**: Follows the existing `do $$ … raise exception` style of
`supabase/tests/*.sql`. Assert exact row counts *and* per-column values for each fixture
row — a count-only check passes a migration that nulls a column. A migration that renames
or drops a column makes the existing script error at parse or execution time, which is
the correct initial failure. For an intentional data-preserving schema transformation,
the migration PR may update `assert-survival.sql` to target the post-migration schema,
but it must map and assert every original fixture value in its new representation; it
must not remove a row or value assertion merely to make the gate pass. The baseline
fixture remains written against the base schema and is not changed pre-emptively.

#### 3. Gate runner

**File**: `scripts/run-migration-gate.sh`

**Intent**: Orchestrate the replay end-to-end and refuse to report success on any
arrangement it cannot actually prove.

**Contract**: `#!/usr/bin/env sh`, `set -eu`, `cd` to repo root — mirroring
`scripts/run-sql-tests.sh:1-8`. Base ref from `MIGRATION_GATE_BASE_REF`, defaulting to
`origin/main`. Sequence:

1. Read the baseline migration set with `git ls-tree -r --name-only "$BASE_REF" -- supabase/migrations` and derive `baseline_version` as its highest version prefix. Inspect `git diff --name-status "$BASE_REF" -- supabase/migrations`; fail on every modified, deleted, copied or renamed baseline migration, and derive `new_versions` only from paths reported as added.
2. If `new_versions` is empty, print an explicit SKIP and exit 0 — the CI job short-circuits before this point, and locally there is genuinely nothing to prove.
3. Fail if any entry in `new_versions` sorts at or below `baseline_version` (out-of-order migration — baseline replay cannot prove it, and it is a hazard in its own right).
4. `pnpm exec supabase db reset --version "$baseline_version" --no-seed --local`
5. **Self-check**: read the applied versions from `supabase_migrations.schema_migrations` through `psql` in stable sorted form and compare them with the expected baseline set; fail if they differ. This is what makes the `--version` flag's inclusivity semantics irrelevant rather than assumed.
6. `psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -f supabase/migration-gate/baseline-fixture.sql` — the connection string is hardcoded for the same destructive-safety reason `run-sql-tests.sh:17` hardcodes it.
7. `pnpm exec supabase migration up --local`
8. `psql … -f supabase/migration-gate/assert-survival.sql`
9. On EXIT, capture the gate's status. After a successful gate, restore the stack with a full `pnpm exec supabase db reset --local`; a failed reset makes the command fail. After a gate failure, preserve the original status, do not replay the known-failing migration chain, and print an explicit recovery instruction: fix or remove the failing migration, then run `pnpm exec supabase db reset --local`. The destructive scratch-migration check is not complete until that separate reset succeeds and seed data is verified.

#### 4. Script registration

**File**: `package.json`

**Intent**: Expose the gate as a first-class entrypoint alongside the other suites.

**Contract**: `"test:migrations": "./scripts/run-migration-gate.sh"` in `scripts`,
placed beside `test:sql`. File committed with the executable bit, as
`scripts/run-sql-tests.sh` is.

#### 5. CI workflow — migrations job

**File**: `.github/workflows/ci.yml`

**Intent**: A third job whose check name always reports, so it can be a required status
check, but which costs nothing on the majority of PRs that touch no migrations.

**Contract**: Job id `migrations`, `timeout-minutes: 20`. Checkout with
`fetch-depth: 0` (the baseline diff needs history). A first `detect` step compares
`supabase/migrations/**` against the base — `github.event.pull_request.base.sha` on
`pull_request`, the previous commit on `push` — and sets an output. Every subsequent
step, including `pnpm install` and `supabase start`, carries
`if: steps.detect.outputs.changed == 'true'`. The job passes with a visible skip
message when unchanged. `MIGRATION_GATE_BASE_REF` is passed to `pnpm test:migrations`
from the same resolved base sha.

#### 6. Documentation

**Files**: `context/foundation/test-plan.md`, `README.md`

**Intent**: Record the gate in the plan that called for it and in the developer-facing
scripts list.

**Contract**: Test plan — §5 `migration safety` row moves to enforced; a new §6
cookbook sub-section ("Adding a migration-safety check") documents the fixture's
base-ref-schema rule, the post-migration assertion-mapping rule and the out-of-order
prohibition; §8 gains a ledger entry.
README — `pnpm test:migrations` added to the Scripts list with its Docker requirement.

### Success Criteria:

#### Automated Verification:

- `pnpm lint` and `pnpm check` pass
- With the local stack running and no new migrations, `pnpm test:migrations` prints SKIP and exits 0
- With a scratch additive migration present, `pnpm test:migrations` exits 0 and its log shows the fixture rows asserted after `migration up`
- With a scratch **destructive** migration (e.g. `drop table public.watering_events`), `pnpm test:migrations` exits non-zero
- With a scratch migration whose version sorts below the base ref's newest, or a modified, deleted or renamed base migration, `pnpm test:migrations` exits non-zero with the applicable history-integrity message
- An opened or updated pull request targeting `main` and touching `supabase/migrations/**` shows the `migrations` job doing work and passing
- An opened or updated pull request targeting `main` and touching no migration shows the `migrations` job reporting green with the skip message

#### Manual Verification:

- After a passing local `pnpm test:migrations` run, the EXIT trap restores the developer's database to full schema with seed data
- After a failing destructive scratch-migration run, the original status is preserved; removing the scratch migration and running the printed reset command restores full schema with seed data
- The skip path is visibly a skip in the CI log, not an ambiguous silent pass
- `pnpm test:sql` still runs exactly the three files in `supabase/tests/` — the new gate SQL was not absorbed into its glob

**Implementation Note**: Pause here for manual confirmation before proceeding.

---

## Phase 3: Make the gates enforcing and prove it

### Overview

The workflow jobs mean nothing until GitHub requires them. Configure required status
checks, then verify by deliberately breaking a gate.

### Changes Required:

#### 1. Enforcement documentation

**File**: `README.md`

**Intent**: Record which check names must be marked required on `main`, so the setting
can be restored if it is ever unticked.

**Contract**: A short "CI gates" subsection naming the three required checks —
`static`, `database`, `migrations` — and stating that all three must be required on the
`main` branch ruleset. Note that `migrations` reports green-by-skip on PRs that touch no
migration, which is why it is safe to require unconditionally.

#### 2. Branch protection (manual, GitHub settings)

**File**: none — repository settings on `github.com/mlmmn/yapca`

**Intent**: Actually block merges. This is the step that converts three workflows into a
floor.

**Contract**: On the `main` branch ruleset, enable "Require status checks to pass" and
select `static`, `database`, `migrations`. Enable "Require branches to be up to date
before merging" so a gate cannot be bypassed by a stale branch. Before configuring
the ruleset, make the repository public and confirm that the rulesets or branch-protection
API is accessible; required checks are unavailable for this private repository on its
current GitHub plan.

#### 3. Test-plan closure

**File**: `context/foundation/test-plan.md`

**Intent**: Close Phase 5 and record what the enforced floor now is.

**Contract**: §3 Phase 5 Status → `complete`. §5 rows all read enforced except the
Stryker row (advisory) and the manual device smoke (recommended). §8 ledger entry dated
on completion, naming the three required checks and the fact that enforcement was
verified by a deliberate break.

### Success Criteria:

#### Automated Verification:

- `pnpm lint` and `pnpm check` pass
- `gh api repos/mlmmn/yapca/rulesets` (or the branch-protection endpoint) lists all three checks as required

#### Manual Verification:

- A throwaway PR that breaks exactly one gate (e.g. a deliberately failing assertion in an integration test) shows GitHub's merge button **disabled**, not merely a red X
- The same throwaway PR, with a destructive scratch migration instead, shows the `migrations` job failing and the merge blocked
- The throwaway PR is closed and its branch deleted afterwards; no scratch migration or broken assertion reaches `main`
- `context/foundation/test-plan.md` §3 Phase 5 reads `complete`

---

## Testing Strategy

This phase's deliverable *is* test infrastructure, so its own verification is
adversarial rather than additive: every gate is proven by making it fail on purpose.

### Deliberate-break matrix:

| Gate | Break to introduce | Expected |
| --- | --- | --- |
| `static` | a lint error | `static` red, merge blocked |
| `database` / integration | a failing assertion in an existing `*.integration.test.ts` | `database` red |
| `database` / sql | a failing `raise exception` in a `supabase/tests/*.sql` file | `database` red |
| `database` / http | a failing assertion in `add-plant.http.test.ts` | `database` red |
| `migrations` | a scratch migration dropping `public.watering_events` | `migrations` red |
| `migrations` skip path | a docs-only PR | `migrations` green, log shows skip |

Every break is reverted before the branch merges.

### Manual Testing Steps:

1. Start the local stack (`pnpx supabase start`) and confirm all four suites pass before touching CI.
2. Open or update the Phase 1 pull request targeting `main`; confirm `static` and `database` both run and pass.
3. Run each Phase 2 scratch-migration case locally before pushing.
4. After Phase 3's branch-protection change, walk the deliberate-break matrix on one throwaway PR.

## Performance Considerations

The `database` job adds a Supabase container boot (~1–3 min) plus three suites to every
PR. The split topology keeps lint and type failures reporting on the `static` job's
existing timeline instead of queueing behind that boot. The `migrations` job's
short-circuit means the majority of PRs pay only a checkout for it. If the `database`
job exceeds its 25-minute timeout in practice, raise the timeout and record the real
figure rather than trimming suites — dropping a suite here re-opens exactly the gap this
phase exists to close.

## Migration Notes

`scripts/run-migration-gate.sh` is destructive to the *local* database by design. It
hardcodes `127.0.0.1:54322` for the same reason `scripts/run-sql-tests.sh:17` and
`test/setup/load-env.ts:23-48` do, and it deliberately offers no override — unlike the
integration harness, this script drops and replays schema, so a non-local target has no
legitimate use.

## References

- Test plan: `context/foundation/test-plan.md` — §2 Risk #8, §3 Phase 5, §5 Quality Gates
- Lessons: `context/foundation/lessons.md:19-24` (verify status codes), `:12-17` (seed tracks the database shape)
- Empty-run-is-not-a-pass precedent: `scripts/run-sql-tests.sh:21-25`
- CI-tolerant env loading: `test/setup/load-env.ts:55-62`
- Suite-isolation constraint: `test/setup/global-setup.ts:35-38`
- Why the configs are separate rather than Vitest projects: `vitest.integration.config.ts:1-5`
- Prior phase: `context/archive/2026-08-02-testing-photo-upload-boundary/`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Split CI and enlist the existing suites

#### Automated

- [x] 1.1 `pnpm lint` passes
- [x] 1.2 `pnpm check` passes
- [x] 1.3 Workflow YAML parses under prettier
- [x] 1.4 All four suites pass locally against the running stack
- [x] 1.5 Pull request targeting `main` shows `static` and `database` green

#### Manual

- [x] 1.6 `database` log shows non-zero test counts for all three suites
- [x] 1.7 `database` wall-clock acceptable (or actual figure recorded)
- [x] 1.8 `static` still reports on its pre-change timeline
- [x] 1.9 `database` references no `SUPABASE_*` repository secret

### Phase 2: Build the migration-safety gate

#### Automated

- [x] 2.1 `pnpm lint` and `pnpm check` pass
- [x] 2.2 No new migrations → `pnpm test:migrations` prints SKIP, exits 0
- [x] 2.3 Scratch additive migration → exits 0 with fixture rows asserted
- [x] 2.4 Scratch destructive migration → exits non-zero
- [x] 2.5 Scratch out-of-order or changed historical migration → exits non-zero with the applicable history-integrity message
- [ ] 2.6 Pull request targeting `main` touching migrations → `migrations` job does work and passes
- [ ] 2.7 Pull request targeting `main` touching no migration → `migrations` job green with skip message

#### Manual

- [ ] 2.8 Successful EXIT trap restores the local database to full schema + seed
- [ ] 2.9 Failure path preserves the original status; explicit post-removal reset restores schema + seed
- [ ] 2.10 The skip path is visibly a skip in the CI log
- [ ] 2.11 `pnpm test:sql` still runs exactly the three `supabase/tests/` files

### Phase 3: Make the gates enforcing and prove it

#### Automated

- [ ] 3.1 `pnpm lint` and `pnpm check` pass
- [ ] 3.2 Ruleset API lists `static`, `database`, `migrations` as required

#### Manual

- [ ] 3.3 Throwaway PR breaking one gate shows the merge button disabled
- [ ] 3.4 Throwaway PR with a destructive scratch migration is blocked by `migrations`
- [ ] 3.5 Throwaway PR closed, branch deleted, nothing broken reached `main`
- [ ] 3.6 `context/foundation/test-plan.md` §3 Phase 5 reads `complete`
