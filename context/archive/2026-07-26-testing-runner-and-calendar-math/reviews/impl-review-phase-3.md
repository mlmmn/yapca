<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Test-runner bootstrap and calendar math

- **Plan**: `context/changes/testing-runner-and-calendar-math/plan.md`
- **Scope**: Phase 3 of 4 (CI repair)
- **Date**: 2026-07-26
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 1 warning, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

No finding blocks Phase 4. The single warning is a hardening gap, not a defect.

## Verification evidence

Local run of CI's own command sequence, in CI's order — every command exit 0:

| Command | Exit |
|---|---|
| `pnpm install --frozen-lockfile` | 0 |
| `pnpm exec astro sync` | 0 |
| `pnpm lint` | 0 |
| `pnpm test` | 0 |
| `TZ=America/New_York pnpm test` | 0 |
| `pnpm build` | 0 |

- **3.1** ✅ verified above.
- **3.2** ✅ `gh run list --workflow=ci.yml` reports 5 runs; `gh workflow view ci.yml --yaml | grep -c master` → `0`.
- **3.3** ✅ PR #2 produced runs `30205285563`, `30205365523`, `30205685877`, `30205872678`; push to `main` produced `30206004546` (success, sha `3a32f9e`).
- **3.4** ✅ `Run actions/setup-node@v4` reports `success` in every run — no "Dependencies lock file is not found".
- **3.5** ✅ Run `30205365523` (`0679a30 test: deliberately break CI assertion`): steps `checkout`/`action-setup`/`setup-node`/`install`/`astro sync`/`lint` all `success`, **`Run pnpm test` → `failure`**, `TZ=America/New_York pnpm test` and `pnpm build` → `skipped`. Revert `b9b33f2` → run `30205685877` green.
- **3.6** ✅ `pnpm lint` and `pnpm build` report `success` in runs `30205285563`, `30205685877`, `30205872678`, `30206004546`.

**Evidence integrity note**: PR #2 is `CLOSED`, not merged — the green branch commits (`addabe5`, `4554fa0`) never entered `main`, which land as `24d3c26`, `7dfebe6`. Verified `git rev-parse 4554fa0^{tree}` equals `git rev-parse 7dfebe6^{tree}` (IDENTICAL), so the green PR run validated exactly the tree on `main`. `main`'s own push run `30206004546` is additionally green. The deliberate-break and revert commits exist only on the feature branch; `main`'s history carries no knowingly-red commit.

## Findings

### F1 — Workflow declares no `permissions:` block

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `.github/workflows/ci.yml:9-12`
- **Detail**: The `ci` job runs with the repository's default `GITHUB_TOKEN` scope rather than an explicit least-privilege grant. The job only needs to read the checkout — it never writes commits, comments, releases, or packages. If the repo's default workflow permission is (or is ever flipped to) read/write, every step here — including third-party actions `pnpm/action-setup@v4` and `actions/setup-node@v4`, and every transitively installed dev dependency executing under `pnpm install` — runs with a token that can push to `main`. This is the standard GitHub Actions hardening default and neither the plan nor the starter scaffold supplied it.
- **Fix**: Add a top-level `permissions: contents: read` above `jobs:` in `.github/workflows/ci.yml`.
  - Strength: Least privilege for a job that is read-only by construction; one line, no behavioral change to any existing step.
  - Tradeoff: None for this job — a future step that needs to write (e.g. posting a coverage comment) must then grant its scope explicitly, which is the desired behavior.
  - Confidence: HIGH — verified no step in the workflow writes to the repo or the API.
  - Blind spot: None significant.
- **Decision**: FIXED — added top-level `permissions: contents: read` to `.github/workflows/ci.yml`.

### F2 — Node version pinned in the workflow while `.nvmrc` exists

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `.github/workflows/ci.yml:17`
- **Detail**: `node-version: 22` is hardcoded, while `.nvmrc` pins `22.14.0`. Two sources of truth for the same fact — precisely the hazard the plan itself names one paragraph earlier for pnpm: *"Do not pin a pnpm version in the workflow: `pnpm/action-setup@v4` reads `packageManager: "pnpm@11.13.1"` from `package.json`, and two sources of truth drift."* The plan's own contract specified `node-version: 22`, so the implementation is faithful — the inconsistency is in the plan, which applied the single-source principle to pnpm but not to Node. Currently benign (`22` resolves to the latest 22.x, satisfying `.nvmrc`), but a future `.nvmrc` bump to 24 would leave CI silently on 22.
- **Fix**: Replace `node-version: 22` with `node-version-file: .nvmrc` in `.github/workflows/ci.yml`.
- **Decision**: FIXED — `.github/workflows/ci.yml` now reads `node-version-file: .nvmrc`.

### F3 — Branch-creation authorization for Phase 3 is not recorded on disk

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: `context/changes/testing-runner-and-calendar-math/plan.md:505-516`
- **Detail**: Phase 3's Prerequisite requires the implementer to confirm the branch-vs-direct-push path before starting, and states the PR path *"requires the user to **explicitly authorize creating a branch**"* because AGENTS.md's "Never create a git branch unless explicitly asked to" is a hard rule and *"this plan is not that authorization."* Branch `testing-runner-and-calendar-math-ci-repair` was created and PR #2 opened, but the plan carries no note recording that authorization. This breaks the in-repo precedent this very plan set twice: the Phase 1 **EXTENDED** note (`plan.md:253-261`, "This note is the record of that authorization") and the Phase 2 **INLINED** note both record maintainer decisions in the plan text. A later reader auditing the AGENTS.md hard rule finds a branch with no paper trail. Secondary: the local branch still exists after PR #2 closed.
- **Fix**: Add an `AUTHORIZED (Phase 3)` note under the Prerequisite recording that the maintainer chose the PR path on 2026-07-26, mirroring the Phase 1 EXTENDED note's wording; then delete the merged-in-substance local branch with `git branch -D testing-runner-and-calendar-math-ci-repair`.
- **Decision**: FIXED — `AUTHORIZED (Phase 3)` note added under the Prerequisite in `plan.md`; local branch deleted, and the remote branch deleted on GitHub with the maintainer's confirmation.

### F4 — No `concurrency` group and no `timeout-minutes`

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `.github/workflows/ci.yml:9-11`
- **Detail**: Neither was in the plan's contract, so this is not drift. Without a `concurrency` group, rapid successive pushes each start a full job — already visible in this change's own history, where three consecutive PR pushes produced three overlapping runs and the superseded ones burned minutes to no purpose. Without `timeout-minutes`, a hung step (most plausibly `pnpm install` against a stalled registry) consumes the account default of 360 minutes before GitHub cancels it.
- **Fix**: Add `concurrency: { group: "${{ github.workflow }}-${{ github.ref }}", cancel-in-progress: true }` at the top level and `timeout-minutes: 15` on the `ci` job.
- **Decision**: FIXED — both added to `.github/workflows/ci.yml`.

## Post-triage verification

All four findings fixed. Re-verified after the edits:

- `.github/workflows/ci.yml` parses cleanly (`pnpm dlx js-yaml`, exit 0) and every edited key resolves as intended: `permissions.contents: read`, `concurrency.cancel-in-progress: true`, `jobs.ci.timeout-minutes: 15`, `node-version-file: .nvmrc`. `actionlint` is not installed in this environment, so no schema-level lint was run — the workflow's real validation is its next run on `main`.
- `pnpm lint`, `pnpm test`, `TZ=America/New_York pnpm test`, `pnpm build` each exit 0.
- The workflow changes are CI-configuration only; no application source was touched during triage.

**Not yet verified in CI**: these four fixes are committed locally but have not run on GitHub Actions. `node-version-file: .nvmrc` in particular changes how `setup-node` resolves the runtime and is only truly confirmed by a green run.
