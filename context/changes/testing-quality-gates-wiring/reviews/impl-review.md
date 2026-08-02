<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Testing Quality Gates Wiring

- **Plan**: context/changes/testing-quality-gates-wiring/plan.md
- **Scope**: Phases 1–3 of 3 (full plan)
- **Date**: 2026-08-02
- **Verdict**: NEEDS ATTENTION (9 findings fixed; F1 withdrawn as a misdiagnosis)
- **Findings**: 5 warnings, 4 observations (1 critical withdrawn)

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Findings

### F1 — WITHDRAWN (misdiagnosis): fixture correctly omits post-baseline columns

- **Severity**: ❌ CRITICAL — **retracted**
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migration-gate/assert-survival.sql:60,75 ↔ supabase/migration-gate/baseline-fixture.sql
- **Detail**: Commit `9d8a525` deleted the fixture's trailing `update public.plants set current_watering_event_id = …` block (and the `previous_event_id` insert columns), but `assert-survival.sql:60` and `:75` still assert `current_watering_event_id is distinct from '…0921' / '…0922'`. Nothing else populates that column — it is a plain nullable column added in `20260801120000_explicit_undo_stack.sql` with no default, and the only trigger in the schema is `plants_set_updated_at`; the column is written exclusively by the `mark_watered` / `postpone_plant` / `undo_watering_event` RPCs, which the fixture bypasses with direct inserts. Verified empirically against the running local stack (inside a rolled-back transaction): `ERROR: Migration gate growing-plant values changed / CONTEXT: PL/pgSQL function inline_code_block line 59 at RAISE`.

  **This finding was wrong, and the "fix" broke CI (run 30769112661).** The reproduction ran the fixture against *current `main`'s* schema. That is not the baseline the gate replays. In CI the base ref is `github.event.pull_request.base.sha` = `3713425`, whose newest migration is `20260724120000` — before `previous_event_id` and `current_watering_event_id` exist. `20260801120000_explicit_undo_stack.sql` **adds both columns and backfills them**: `lag(id) over (partition by plant_id order by created_at, id)` for `previous_event_id`, and `distinct on (plant_id) … order by created_at desc` for `current_watering_event_id`. Against the true baseline the fixture *cannot* reference those columns, the migration creates and populates them, and `assert-survival.sql:60,75` verifies the backfill reproduced exactly the linkage the fixture's event ordering implies. That is the gate doing its job — proving a data-migration preserved causality — not a broken assertion.

  Commit `9d8a525` ("target the true migration baseline") was therefore correct, and its rationale holds precisely. The error was verifying against `origin/main` locally instead of the PR's actual base sha, where the backfill never runs because the columns already exist.

  Retained lesson: a finding about the migration gate is only reproducible against the base ref the gate actually uses. Verify with `MIGRATION_GATE_BASE_REF=<pr base sha>`, never against `main`.
- **Resolution**: Reverted to the `9d8a525` fixture. Re-verified with `MIGRATION_GATE_BASE_REF=3713425…` — exit 0, reset to `20260724120000`, four migrations replayed, assertions passed.
- **Decision**: WITHDRAWN — no defect; original code restored

### F2 — `migration up` is not verified to have applied anything

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: scripts/run-migration-gate.sh:89-90
- **Detail**: `supabase migration up --local` exits 0 when it applies nothing. If the new migration is skipped for any reason (config exclusion, a filename the CLI ignores, an already-recorded version), `assert-survival.sql` runs against rows no migration ever touched, and the script prints "Migration gate asserted fixture row survival after migration up" — a green gate that proved nothing. The script guards this "empty run is not a pass" hazard everywhere else (`:35-38`, `:61-64`, the `:79-86` baseline self-check) but not at the one point that matters most.
- **Fix**: After line 89, re-query `supabase_migrations.schema_migrations` and fail unless the applied set equals `baseline_versions` ∪ `new_versions` — mirroring the self-check already at `:77-86`.
  - Strength: Reuses a pattern already present and tested in the same script; closes the only remaining vacuous-pass path.
  - Tradeoff: One extra psql round-trip; a few lines.
  - Confidence: HIGH — the self-check idiom is already proven at `:77`.
  - Blind spot: Haven't confirmed the CLI records versions identically on `migration up` vs `db reset`.
- **Decision**: FIXED

### F3 — Untracked migrations are invisible: local run reports SKIP on untested SQL

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: scripts/run-migration-gate.sh:56
- **Detail**: `git diff --name-status` sees the index and worktree but never reports untracked files as `A`. Verified: `touch supabase/migrations/20260901000000_scratch_probe.sql; git diff --name-status main -- supabase/migrations` prints nothing. A developer who writes a migration and runs `pnpm test:migrations` before `git add` gets `SKIP: no new migrations relative to origin/main` and exit 0. That is the most likely real-world path to a green gate over completely untested SQL, and it directly contradicts the plan's "empty run is not a pass" principle. CI is unaffected (files are always committed there), so this bites exactly the local pre-push workflow the plan's Manual Testing Steps prescribe.
- **Fix**: Detect untracked files under `supabase/migrations` (e.g. `git ls-files --others --exclude-standard -- supabase/migrations`) and fail loudly with an instruction to `git add` them, rather than folding them into the diff silently.
  - Strength: Fails loudly instead of guessing; keeps the add-only history check operating on committed state only.
  - Tradeoff: One more way for the local run to refuse to run; mildly more friction mid-edit.
  - Confidence: HIGH — reproduced directly.
  - Blind spot: Some developers may deliberately iterate on an uncommitted migration and find the hard failure annoying.
- **Decision**: FIXED

### F4 — `eval "$(supabase status -o env)"` swallows failure and can write an empty `.env`

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: .github/workflows/ci.yml:59
- **Detail**: Command substitution inside `eval` discards the inner command's exit status, and `eval` returns 0 on empty input. GitHub's default shell is `bash -e` without `-u`. If `supabase status` fails or emits partial output, `$API_URL` / `$ANON_KEY` / `$DB_URL` expand to empty, `.env` is written with empty values, the step goes green, and the failure surfaces three steps later as an opaque Supabase client error. This is the exact class `context/foundation/lessons.md` ("Always verify command status codes") exists to prevent. Related, lower-stakes: `ci.yml:83` uses `github.event.before` as the push-event base, which is all-zeros on a branch-create or unreachable after a force-push to `main`, producing a confusing red `migrations` job.
- **Fix**: Assign `status_env="$(pnpm exec supabase status -o env)"` on its own line (so `set -e` sees the status), then `eval`, then assert all three variables are non-empty before writing `.env`.
- **Decision**: FIXED

### F5 — Non-numeric version prefix bypasses the out-of-order check

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: scripts/run-migration-gate.sh:67
- **Detail**: `[ "$new_version" -le "$baseline_version" ]` sits in an `if` condition, where `set -e` is suspended. A non-numeric operand makes `[` print `integer expression expected` and return 2, which `if` reads as false — so the check passes. Verified: `sh -c 'set -eu; v=20260803-foo.sql; [ "$v" -le 20260802120000 ]'` takes the else branch with rc=0. `sed 's/_.*//'` at `:47` leaves the whole filename when there is no underscore, so a migration named `20260803-add-thing.sql` bypasses the ordering-integrity check entirely — the very hazard the plan's "Critical Implementation Details" calls out as worth failing on.
- **Fix**: Validate each derived version against `^[0-9]\{14\}$` before comparing, and fail with a naming-convention message on any non-conforming filename.
- **Decision**: FIXED

### F6 — Status-swallowing command substitutions in the gate runner

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: scripts/run-migration-gate.sh:12, 55-57
- **Detail**: Two places discard a command's exit status where `set -eu` cannot see it. `:12` — `baseline_files="$(git ls-tree … | sort)"` takes `sort`'s status, so a bad ref or unfetched remote surfaces as the misleading "no baseline migrations found in $base_ref". `:55-57` — the `while read` loop is fed by a heredoc containing `$(git diff …)`; a `git diff` failure leaves `new_versions` empty and the script reports `SKIP … exit 0`, i.e. "git failed ⇒ gate passed". Both are partially mitigated by the empty-check at `:35`, but both contradict `lessons.md` "Always verify command status codes", which the plan cites as governing every script it adds.
- **Fix**: Capture each git command into its own variable on a bare assignment line (so `set -e` checks it) before piping or feeding the loop, and give the bad-ref case its own message.
- **Decision**: FIXED

### F7 — Unplanned HTTP readiness-timeout change, undocumented

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: test/setup/http-global-setup.ts:11
- **Detail**: `readinessTimeoutMs` went 20 s → 45 s (`6157638`) → 90 s (`d8c186f`), a 4.5× budget increase. The plan's Current State Analysis asserts "No harness change is required", and the change appears in no Progress row and no test-plan §8 ledger entry. The signal itself is not weakened — the wait stays hard-bounded, the loop still throws immediately on spawn error and on early child exit, and each probe carries its own 2 s `AbortSignal.timeout` — so only a genuinely slow cold workerd start consumes the extra budget, which is the stated intent. The cost is local: a server that accepts but never responds now takes 90 s to report instead of 20 s. The gap is the record, not the change.
- **Fix**: Add a §8 ledger line noting the cold-workerd CI startup finding, or scope the bump with `process.env.CI ? 90_000 : 20_000` so local feedback stays fast.
- **Decision**: FIXED

### F8 — Destructive script traps only EXIT, not INT/TERM

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: scripts/run-migration-gate.sh:73
- **Detail**: `trap restore_database 0` covers EXIT only. Ctrl-C during `db reset` or `migration up` leaves the developer's database truncated to the baseline with no recovery message printed — the plan's Migration Notes acknowledge the script is destructive to the local database by design, which makes the interrupt path worth covering. The trap itself is otherwise correct: it does `trap - 0` before re-exiting, so there is no recursion, and it preserves `$?`.
- **Fix**: `trap restore_database 0 INT TERM`.
- **Decision**: FIXED

### F9 — Success-path full `db reset` also runs in CI

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: scripts/run-migration-gate.sh:23-27
- **Detail**: After a passing gate the trap runs a full `supabase db reset --local` to restore the developer's schema and seed. In the `migrations` CI job the container is discarded immediately afterwards, so this spends a couple of minutes of the 20-minute timeout restoring a database nobody will use.
- **Fix**: Skip the restore when `${CI:-}` is set, keeping the failure-path message unconditional.
- **Decision**: FIXED

### F10 — Gate coverage is row data only; schema-permission changes are invisible

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migration-gate/assert-survival.sql
- **Detail**: The assertions cover row presence and per-column values in three tables. Because the script declares `%rowtype` against live tables, a dropped or renamed column or table does fail — correctly. Not covered: dropped RLS policies, revoked grants, dropped functions, and the `plant-photos` storage bucket / `storage.objects` rows that `plants.photo_path` references. `20260802120000_narrow_plants_insert_grant.sql` is precisely the class of migration this gate cannot see. That is a reasonable scope for Risk #8 ("destroys or orphans existing rows"), but it is undocumented, so a future reader may over-trust the gate.
- **Fix**: State the scope limit in test-plan §6.7 ("Adding a migration-safety check").
- **Decision**: FIXED

## Success criteria re-verification

| Check | Result |
|---|---|
| `pnpm lint` | PASS — "ESLint: No issues found" |
| `pnpm check` | PASS — 0 errors, 0 warnings, 10 hints (96 files) |
| `pnpm exec prettier --check .github/workflows/ci.yml` | PASS |
| `gh api repos/mlmmn/yapca/rulesets` lists three required checks | PASS — ruleset 20253578, contexts `static` / `database` / `migrations`, `strict_required_status_checks_policy: true`, `~DEFAULT_BRANCH` |
| Progress 2.3 — scratch additive migration exits 0 with fixture rows asserted | **FAIL against HEAD** — see F1; stamped `c904140`, broken by `9d8a525`, never re-run |
| Progress 2.6 — migration-touching PR passes the `migrations` job | **Not reproducible** — same cause as F1 |
| `pnpm test:sql` still globs exactly the three `supabase/tests/` files | PASS — gate SQL lives in `supabase/migration-gate/` |
