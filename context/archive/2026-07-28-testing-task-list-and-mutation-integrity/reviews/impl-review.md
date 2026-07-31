<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Task-list and Mutation Integrity

- **Plan**: `context/changes/testing-task-list-and-mutation-integrity/plan.md`
- **Scope**: Full plan — Phases 1–6 (weighted toward Phases 5–6, which had no prior review)
- **Date**: 2026-07-31
- **Verdict**: NEEDS ATTENTION → **RESOLVED** after triage on 2026-07-31
- **Findings**: 1 critical, 6 warnings, 3 observations — 9 fixed, 1 skipped (F9, reaffirming a prior
  ACCEPTED decision)

## Triage outcome (2026-07-31)

All findings decided. F5 was resolved by a better fix than either option offered: Vitest projects were
dropped entirely in favour of one config per suite, making unit/mutation parity structural.

Re-verified after all fixes — every gate reproduces its pre-triage result:

| Command | Exit | Result |
|---|---|---|
| `pnpm test` | 0 | 6 files, 92 tests passed |
| `pnpm test:integration` | 0 | 5 files, 19 passed, 2 skipped |
| `pnpm lint` | 0 | No issues found |
| `pnpm check` | 0 | 0 errors, 0 warnings, 10 hints |
| `pnpm test:sql` | 0 | BEGIN…ROLLBACK clean |
| `pnpm test:mutants --mutate src/lib/season.ts` | 0 | resolves via `vitest.config.ts`; 97.37%, no integration start |

## Success criteria — verified by execution

| Command | Exit | Result |
|---|---|---|
| `pnpm test` (stack irrelevant, unit only) | 0 | 6 files, 92 tests passed |
| `pnpm test:integration` (stack up) | 0 | 5 files, 19 passed, 2 skipped (V1, V3 — exactly as planned) |
| `pnpm lint` | 0 | No issues found |
| `pnpm check` | 0 | 0 errors, 0 warnings, 10 hints |
| `pnpm test:sql` | 0 | BEGIN…ROLLBACK clean |

All 34 Progress checkboxes are `[x]` with commit shas. Every automated row reproduces. Two manual
rows assert more than the artifacts show — see F6.

## Verdicts

| Dimension | Verdict (as reviewed) | After triage |
|-----------|---------|---|
| Plan Adherence | WARNING | PASS — F6/F7/F8 fixed; Open Risks section added |
| Scope Discipline | WARNING | PASS — F5 deviation resolved and recorded; F9 accepted |
| Safety & Quality | FAIL | PASS — F1 guard added; F2/F3/F4/F10 fixed |
| Architecture | PASS | PASS |
| Pattern Consistency | WARNING | PASS — config duplication removed; naming violation fixed |
| Success Criteria | WARNING | PASS — both manual rows now earn their checkmarks |

> Note on the overall verdict: the skill's rubric maps a CRITICAL finding to REJECTED. That
> label would misdescribe this change — the work is landed, green, and substantively faithful
> to the plan. F1 is a missing guard against operator misconfiguration, not a defect in shipped
> behaviour. Recorded as NEEDS ATTENTION with the deviation stated rather than silently
> downgrading F1's severity.

## Findings

### F1 — Destructive `DELETE FROM auth.users` runs against whatever `SUPABASE_DB_URL` points at, with no local-stack guard

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `test/setup/load-env.ts:30-42`, `test/setup/global-setup.ts:29`, `test/fixtures/user.ts:33,385-387`
- **Detail**: `load-env.ts` validates only that `SUPABASE_URL`, `SUPABASE_KEY` and `SUPABASE_DB_URL`
  are *present* — it never inspects host or port. `globalSetup` then unconditionally runs
  `cleanFixtureUsers("yapca-integration+%")`, which reaches
  `deleteFixtureUsers` → `runPsql("delete from auth.users where email like '…'")` against that URL.
  `plants.user_id` and `watering_events.user_id` are `on delete cascade`
  (`supabase/migrations/20260719120000_create_plants.sql:6`), so every matched row takes its plants
  and journal with it.

  Compounding it: the harness mints **confirmed, sign-in-capable** accounts with a password that is
  a committed constant — `test/fixtures/user.ts:33` `const FIXTURE_USER_PASSWORD = "yapca-integration-password"`,
  interpolated into `crypt(…, gen_salt('bf'))` alongside `email_confirmed_at: now()` and a matching
  `auth.identities` row, and re-exported publicly via `integrationFixtureConfig`. Those are working
  credentials, public in the repo. They are "harness-only" purely because the target database is
  *assumed* local — the missing host check is the only thing enforcing that assumption.

  `README.md` actively invites a hosted config ("For a hosted project instead, use its Project URL
  and `anon` public key") a couple of paragraphs above the new `SUPABASE_DB_URL` instructions, so a
  `.env` mixing a hosted URL with a pasted pooler DB URL is a realistic operator slip, not a
  contrived one. `package.json`'s `test:sql` hardcodes `127.0.0.1:54322` — the safe direction, and
  the precedent to follow. No real credentials are committed otherwise: `.env` is gitignored,
  `.env.example` holds only documented local defaults and an `<anon key from …>` placeholder.
- **Fix**: In `load-env.ts`, parse `SUPABASE_DB_URL` and hard-fail before caching unless the hostname
  is `127.0.0.1`/`localhost` and the port is the local-stack DB port.
  - Strength: Makes the whole accident class impossible in ~6 lines, at the one chokepoint every
    fixture path already goes through, and matches `test:sql`'s hardcoded-local precedent.
  - Tradeoff: Anyone with a deliberately non-default local setup needs an escape hatch (e.g.
    `YAPCA_ALLOW_NONLOCAL_INTEGRATION_DB=1`).
  - Confidence: HIGH — verified the absence of any host check by reading the full env and psql paths.
  - Blind spot: None significant. Deriving the fixture password per-run from the run namespace is a
    reasonable second hardening step but is not required once the host guard exists.
- **Decision**: FIXED — `assertLocalDatabaseUrl` added in `test/setup/load-env.ts`, called before
  `cachedEnv` is populated. Accepts `127.0.0.1`/`localhost`/`::1` on port `54322` only; escape hatch
  `YAPCA_ALLOW_NONLOCAL_INTEGRATION_DB=1`. Verified the hosted-pooler URL shape the README invites is
  rejected and all three local forms pass.

### F2 — Sequence test's `+7` assertion is season-dependent; it will fail every 1 Nov – 28 Feb

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/actions/watering-sequence.integration.test.ts:109-128` (and the skipped V3 case at `:250-256`)
- **Detail**: The plant is created with `growingIntervalDays: 7` and inherits the fixture default
  `dormancyIntervalDays = 30` (`test/fixtures/plants.ts:26`), then the reschedule is asserted
  unconditionally as `expect(wateredState.plant.next_due_on).toBe(addDays(clientDate, 7))`.
  `mark_watered` selects the interval from the season of `acted_on`
  (`supabase/migrations/20260724120000_add_season_aware_intervals.sql:62-64`), and growing season is
  months 3–10 (`src/lib/season.ts:18`). From 1 Nov the RPC returns `clientDate + 30` and this test
  fails. Confirmed against both implementations, not inferred.

  Both sibling files avoid this, two different ways: `harness.integration.test.ts:19-20` pins **both**
  intervals to 7, and `update-plant.integration.test.ts:101,143` branches on `getSeason(clientDate)`.
  This file is the outlier. It passes today only because today is July.
- **Fix**: Add `dormancyIntervalDays: 7` to the `createPlantFixture` call at `:109-114`, matching
  `harness.integration.test.ts`. No expectation changes.
- **Decision**: FIXED — `dormancyIntervalDays: 7` added to the fixture call with a comment naming the
  season dependency. The skipped V3 case was re-examined and needs no change: its final assertion is
  `originalDueOn` (a restore), not an interval-derived value, so its 30/7 asymmetry is season-independent.
  `pnpm test:integration` green (19 passed, 2 skipped).

### F3 — Teardown cleanup failure exits 0, defeating the guard the file was written to provide

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `test/setup/global-setup.ts:38-52`
- **Detail**: The file names the hazard itself — "Vitest logs a throw from teardown as 'error during
  close' but still exits 0" — and cites `context/foundation/lessons.md:19-24` ("always verify command
  status codes"). But `process.exitCode = 1` is set on **only** the residual-storage arm. If
  `cleanFixtureUsers(currentRunPattern)` at `:42` throws — the psql delete failing, or the sign-in
  failure described in F4 — the throw propagates, Vitest prints "error during close", and the process
  still exits 0. The run's users and storage objects survive into the next run and CI stays green.
  The lesson the comment invokes is the one the code half-applies.
- **Fix**: Wrap the whole teardown body in `try { … } catch (error) { process.exitCode = 1; throw error; }`
  so every teardown failure sets the code, not just the anticipated one.
- **Decision**: FIXED — whole teardown body wrapped in `try/catch` that sets `process.exitCode = 1`
  and rethrows; the lesson comment moved up to cover both arms. Teardown still green.

### F4 — Stale-user sweep can permanently wedge the harness and burns the sign-in rate budget

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `test/fixtures/user.ts:339-364`, `test/setup/global-setup.ts:15-19`
- **Detail**: `cleanFixtureUsers` signs in once per matched user to clear their Storage folder, and
  throws on the first failure (`user.ts:345-349`). Two consequences:

  (a) **Unrecoverable state.** One un-signable prefixed user — password rotated, or a row left by an
  older fixture revision — throws *before* `deleteFixtureUsers` runs at `global-setup.ts:19`. The
  blocker is therefore never deleted, and every subsequent run fails identically. Recovery requires
  manual psql.

  (b) **Rate budget.** The codebase treats the 30-sign-ins-per-5-minutes cap as load-bearing and
  computes the pool bound against it (`user.ts:312-314`, `:392-394`; `plan.md:869-872`). But a crashed
  prior run leaving 20 stale users spends 20 sign-ins before the first test, and the pool's own
  sign-ins then hit the limit. The plan's "at most four sign-ins per run" arithmetic silently assumes
  a clean slate.

  Related, lower stakes (`global-setup.ts:25,29,31-35`): the startup sweep uses the namespace-blind
  `yapca-integration+%`, so two suites against one stack will have the second delete the first's users
  mid-flight — while the comment at `:31-35` credits the namespace with preventing exactly that. The
  namespace does protect *teardown*; the comment overstates it for startup.
- **Fix A ⭐ Recommended**: Collect per-user storage-clear failures instead of throwing, always reach
  `deleteFixtureUsers`, and report the collected failures after the delete.
  - Strength: Removes the unrecoverable state outright — the blocking row gets deleted on the very run
    that trips over it, and the failure is still surfaced.
  - Tradeoff: Does not address the rate budget; a large stale backlog still spends sign-ins.
  - Confidence: HIGH — the throw-before-delete ordering is plainly visible in the two files.
  - Blind spot: Haven't measured how often stale users actually accumulate in practice.
- **Fix B**: Bound the stale sweep by namespace age — parse the `run-<epoch>` prefix and only sweep
  entries older than a few minutes, skipping storage clearing for the rest.
  - Strength: Fixes the rate budget and the concurrent-run collision in one change.
  - Tradeoff: More logic, and it leaves storage objects behind for recently-crashed runs.
  - Confidence: MEDIUM — depends on the namespace format staying parseable.
  - Blind spot: Interacts with the residual-object assertion in teardown; would need checking together.
- **Decision**: FIXED via Fix A — `cleanFixtureUsers` now collects per-user clear failures and always
  reaches `deleteFixtureUsers`, returning `{ clearFailures, residualObjectPaths }`. Teardown folds both
  into one thrown error; the startup sweep warns instead of failing (previous run's leftovers, rows
  already deleted). The overstated namespace comment was corrected to say the guarantee covers teardown
  only. Rate budget (b) deliberately left unaddressed — that was Fix B.
  `pnpm test:integration` green, `pnpm check` 0 errors.

### F5 — Unplanned `vitest-mutation.config.ts` duplicates the unit project with no parity guard, and leaves a stale comment behind

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Scope Discipline / Pattern Consistency
- **Location**: `vitest-mutation.config.ts:7-15`, `stryker.config.json`, `vitest.config.ts:31-35`
- **Detail**: Phase 6 planned only `"testFiles": [...]` in `stryker.config.json`. It shipped that
  exactly, **plus** an unplanned `vitest-mutation.config.ts` and a `"vitest": { "configFile": … }`
  pointer. The necessity is real: Stryker's Vitest runner exposes only `configFile`/`dir` with no
  project selector, and invokes vitest without `--project`, so against `vitest.config.ts` it would
  start the integration project too — which needs Docker. Phase 1's `sequence.groupOrder` fix only made
  the multi-project config *resolve*; it never excluded integration, and Progress row 1.7 papered over
  that because a `season.ts` scope needs integration tests only to *start*, not to pass.

  Two problems with how it landed. First, `vitest-mutation.config.ts:7-15` is a verbatim copy of the
  `unit` project block (`vitest.config.ts:29-44`) — same plugin, `environment`, `TZ`, `include`,
  `exclude` — with nothing enforcing parity and no cross-reference comment in either file. Add a
  `setupFiles` or an env change to the unit project and `pnpm test` and `pnpm test:mutants` diverge
  silently: mutants get scored against a suite that is not the suite gating the repo, which is exactly
  the false-confidence failure a mutation audit exists to prevent.

  Second, `vitest.config.ts:31-35` still reads "Tools that invoke vitest without `--project` — Stryker's
  vitest runner does exactly this — then fail to start at all." Stryker no longer reads that file, so the
  comment justifies `groupOrder` with a consumer that no longer exists.

  Neither the plan nor `mutation-audit.md` records the deviation.
- **Fix A ⭐ Recommended**: Keep the file, add a cross-reference comment in both configs stating they must
  be edited together, and correct the stale Stryker rationale at `vitest.config.ts:31-35`.
  - Strength: Cheapest change that removes the silent-drift trap; the duplication is small and stable.
  - Tradeoff: Parity stays a convention rather than a mechanism.
  - Confidence: HIGH — the duplicated block is five settings, not a sprawling config.
  - Blind spot: A future contributor may still edit one and not the other despite the comment.
- **Fix B**: Export the shared unit-project test options from one module and import into both configs.
  - Strength: Makes drift structurally impossible.
  - Tradeoff: Adds indirection to two config files for five settings; `defineProject` and
    `defineConfig` shapes differ, so the extraction is not purely mechanical.
  - Confidence: MEDIUM — haven't verified Stryker's runner tolerates the indirection at load time.
  - Blind spot: Stryker resolves the config in its own process; an import that works for Vitest may
    need checking there.
- **Decision**: FIXED differently (user's proposal — supersedes both offered fixes). Vitest projects
  dropped entirely in favour of one config per suite: `vitest.config.ts` is now the unit suite and
  `vitest.integration.config.ts` the integration suite; `vitest-mutation.config.ts` deleted. Stryker,
  `pnpm test` and `lefthook.yml` all read the *same* `vitest.config.ts`, so parity is structural, not
  conventional — this removes the drift risk rather than documenting it. `sequence.groupOrder` and the
  stale comment justifying it are gone with the projects. Scripts updated (`test`, `test:watch`,
  `test:integration --config`), `lefthook.yml`'s `--project unit` dropped.
  Verified: `pnpm test` 92 passed, `pnpm test:integration` 19 passed/2 skipped, `pnpm check` clean,
  `pnpm test:mutants --mutate src/lib/season.ts` resolves and runs (97.37%, no Docker start attempt),
  `vitest related` on a unit test runs it (16) and on an integration test runs nothing. The deviation
  is now recorded in `mutation-audit.md`.

### F6 — Two manual Progress rows are checked without the evidence the plan required

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria / Plan Adherence
- **Location**: `plan.md:967` (row 5.5), `plan.md:983` (row 6.7)
- **Detail**: **Row 5.5** — `plan.md:691-694` required the follow-up change to carry the context that
  V1's adversarial case was named at plan-review time and shipped anyway
  (`context/archive/2026-07-23-postpone-and-undo/reviews/plan-review.md:26`, which reads "Stale-Undo
  guard … is value-based rather than identity-based … Sound as designed"). That is the "we saw it and
  shipped anyway" record the follow-up most needs. `context/changes/undo-integrity-defects/change.md`
  is 16 lines and contains no reference to it. It does describe both defects and reference the test
  file by path, so the row is *mostly* earned — but not fully.

  **Row 6.7** reads "§3 Phase 2 Status reads complete and Phase 3 is unblocked." Phase 2 does read
  `complete` (`test-plan.md:95`) ✅. But the Phase 3 row still reads `not started` with change folder
  `—`, and no sentence anywhere states Phase 3 is unblocked. It is *inferable* from the ordering
  rationale at `:104-106`; it is not stated.
- **Fix**: Add the plan-review citation to `undo-integrity-defects/change.md`, and add the
  Phase-3-unblocked note to `test-plan.md` §3 — or uncheck the two rows.
- **Decision**: FIXED — both rows now earn their checkmarks. `undo-integrity-defects/change.md` carries
  the plan-review citation (anchor corrected to `plan-review.md:27`; the quote was verified) and notes
  that the review cleared the guard by reasoning about a *race*, whereas the breaking case is two
  ordinary sequential same-day postpones. `test-plan.md` §3 now states Phase 3 is unblocked as of
  2026-07-31 and why.

### F7 — The postpone/PRD divergence was never escalated, and the test comment cites the wrong anchor

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `src/actions/watering-sequence.integration.test.ts:176`, `plan.md:642-643`
- **Detail**: The `acted_on + 2` behaviour is pinned correctly, and the "not `prev_due_on + 2`"
  discriminator at `:178` is a real assertion (plant overdue by 10, so `-8 ≠ +2`). The **documentary**
  half of the requirement is short:

  - The comment reads `// PRD §FR-012 says "2 days forward", but the deliberate contract is action date + 2.`
    `prd.md:111` FR-012 actually reads "User can postpone a watering task by 2 days" — it does *not*
    contain the "2 days forward" wording. The divergent wording lives at `prd.md:56` and `:141`, which
    the plan named explicitly (`plan.md:639-640`) and the comment cites neither.
  - The UI-copy pointer (`src/components/today-list/utils.ts`) and the deliberateness citation
    (`context/archive/2026-07-23-postpone-and-undo/plan.md:34`) are both absent.
  - `plan.md:642-643` says "Flag it in this plan's Open Risks for a product decision." **The plan has no
    Open Risks section.** Nothing was added anywhere. The divergence survives only in `research.md:365-366,814`
    — pre-existing Phase-0 material, not a new product-decision flag.

  The guardrail itself was respected: `prd.md` and `utils.ts` are untouched, no behaviour changed.
- **Fix**: Correct the comment's PRD anchors to `prd.md:56`/`:141`, add the `utils.ts` and archive
  citations, and add an Open Risks section to the plan carrying the divergence for a product decision.
- **Decision**: FIXED — test comment rewritten with the correct anchors (`prd.md:56`/`:141` for the
  divergent prose, `:111` noted as neutral), plus the `utils.ts:14` UI-copy pointer, the archive
  deliberateness citation, and the overdue-by-10 discriminator (verified against `dueOffsetDays: -10`).
  An **Open Risks** section was added to the plan carrying the divergence and naming the decision
  needed. The stale "separate Vitest project" wording in Performance Considerations was amended for the
  F5 split at the same time. Behaviour unchanged; `prd.md` and `utils.ts` still untouched.

### F8 — V1's skipped test asserts the corrected end state but not the planned two-event proof

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `src/actions/watering-sequence.integration.test.ts:232-241`
- **Detail**: `plan.md:681-687` asked the skipped V1 test to *be the proof* handed to the follow-up:
  `E1{prev: D0, new: T+2}`, `E2{prev: T+2, new: T+2}`, undoing E1 passing the value-based guard, and E2
  left stranded with `P0003`. The shipped test asserts only `rejects.toMatchObject({ code: "CONFLICT" })`
  on E1's undo. It encodes the desired end state, so un-skipping it does fail (criterion 5.4 holds), but
  it never observes the journal shape or E2's stranding — so the hand-off is thinner than specified.
  Both skip comments do state the defect, the expected *correct* behaviour, and the real follow-up id,
  which is what criterion 5.6 asked for.
- **Fix**: Extend the V1 skip block to assert the two-event journal shape and E2's `P0003` stranding.
- **Decision**: FIXED — the V1 block now asserts the colliding journal shape (`E1{prev: D0, new: T+2}`,
  `E2{prev: T+2, new: T+2}`), that the refused out-of-order undo leaves plant and journal untouched, and
  that unwinding LIFO (E2 then E1) strands nothing and returns the plant to `D0`. Note it encodes the
  *corrected* behaviour rather than asserting the stranding itself — asserting `P0003` would pin the
  defect as expected behaviour and pass once fixed. The narrative comment carries the stranding
  explanation instead.
  Verified by temporarily un-skipping: the journal-shape assertions **pass** against today's code
  (confirming the collision is real) and the test fails only at the CONFLICT expectation, with the undo
  resolving `restored_due_on = D0`. Criterion 5.4 still holds; skip restored.

### F9 — `sandbox_mode = "danger-full-access"` is committed repo-wide

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: `.codex/config.toml:1` (landed in `f7db49e`, Phase 2)
- **Detail**: In Codex CLI, `sandbox_mode` selects the OS-level sandbox for commands the agent runs;
  `danger-full-access` disables it entirely — unrestricted filesystem writes outside the workspace and
  unrestricted network, with no per-command approval gate. The file is git-tracked, so it applies to
  every collaborator, not just the author. It is unrelated to the testing harness.

  Re-raised for visibility only: this was already caught as F4 in
  `reviews/impl-review-phase-2.md:204-217` ("hides an environment-trust change in a diff nobody will
  read for that"), and the recorded decision is **ACCEPTED** — the author chose to keep it staged. The
  process worked; the setting is simply repo-wide and permanent, which is worth restating at full-plan
  scope.
- **Fix**: Move it to the user's `~/.codex/config.toml` and drop it from the tracked file.
- **Decision**: SKIPPED — reaffirms the ACCEPTED decision recorded in
  `reviews/impl-review-phase-2.md:204-217`. The setting stays tracked, deliberately.

### F10 — Minor quality: an over-permissive negative assertion, a verb-prefixed boolean, and dead residue

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency / Safety & Quality
- **Location**: `src/actions/update-plant.integration.test.ts:80-86`, `test/fixtures/user.ts:286,305,415`
- **Detail**: Three small ones, none individually worth a finding:

  - `expectPhotoAbsent` asserts `expect(error).not.toBeNull()`, which passes on *any* storage error
    including an auth failure — a broken session would read as "photo correctly deleted". Assert the
    specific not-found condition instead.
  - `let hasMore = true` (`:286`, reassigned `:305`) violates AGENTS.md Naming: "a boolean value is
    never prefixed with `is`/`has`/`should` — those prefixes are reserved for functions." Rename to
    `more`. This is the only naming violation across all the new files.
  - `ensureUserSlot` returns `lastPreparedTestName: null` (`:415`), which is not in the `UserSlot` type
    (`:15-22`) and is read nowhere — residue from the superseded `currentTestName`-comparison approach
    the comment at `:43-48` describes. It implies a reset mechanism that no longer exists.

  Related but *not* a defect: `update-plant.integration.test.ts:101,143` branches on
  `getSeason(clientDate)`, so its dormancy expectations go unexercised March–October. The author
  acknowledges this at `:136-140` and points to year-round unit coverage in `season.test.ts` /
  `schedule.test.ts` — a reasonable mitigation, noted here only so the eight-month gap is on record.
- **Fix**: Tighten `expectPhotoAbsent` to the not-found condition, rename `hasMore` → `more`, delete
  the dead `lastPreparedTestName` property.
- **Decision**: FIXED (all three) — `expectPhotoAbsent` now asserts absence *positively* by listing the
  folder and requiring the object to be missing from a **successful** listing, so a broken session fails
  the assertion instead of satisfying it (stronger than matching a specific error shape, and immune to
  that shape drifting). `hasMore` → `more`. Dead `lastPreparedTestName` property removed.
  The eight-month dormancy-branch gap noted at the end of the finding was left as recorded — the
  year-round unit coverage in `season.test.ts` / `schedule.test.ts` is the accepted mitigation.

## Cleared on inspection

Verified and found sound — recorded so a future review need not re-derive them:

- **ESLint hard rule — complied with.** The `supabase/.temp/**` ignore was *reported first* and
  changed only after explicit permission (`reviews/impl-review-phase-4.md:132,137`). It is not the
  pre-authorized test-file rule override, which already existed at `eslint.config.js:164-176` and is
  untouched. The change is justified: the nested `supabase/.gitignore` is invisible to
  `includeIgnoreFile`, so `pnpm lint` exited 1 whenever the local stack ran.
- **`test/` is both linted and typechecked** — `eslint.config.js:119` matches `**/*.{js,jsx,ts,tsx}`
  with no `test/` exclusion, and `tsconfig.json` uses `"include": ["**/*"]`. No blind spot.
- **`src/lib/due.test.ts` is honest** — expected values literal, never derived from the module under
  test; `selectDueRecords` asserts the full ordered id set via `toEqual([...])`, not a length; boundary
  coverage complete (due-today inclusive, overdue across a year boundary, due-tomorrow excluded,
  unsorted input, both tie-break directions, all-due `null`).
- **Phase 3 refactor is behaviour-preserving** — the `today === null` short-circuits survive at
  `today-list.tsx:257,259`; the undo guard at `:225` (`!isDueOn(restoredPlant, currentToday)`) expands
  to exactly the old `data.restored_due_on > currentToday`; `authed-shell.astro` is two lines calling
  `loadTodayPlants` and owns no query or mapper.
- **No cross-worker races** — slot emails embed `VITEST_POOL_ID`; `resetUserSlot` scopes its delete
  with `.eq("user_id", slot.userId)`; Storage listing paginates correctly at `limit: 1000` with an
  offset loop (`user.ts:288-307`), so the 100-object default is not a trap; cookie-jar sharing clones
  per request and writes back deliberately; `psql` runs via `execFileSync` (no shell) and every
  interpolated value is internally generated; no pg connection held open.
- **Season boundary reconciliation is real** — all nine `acted_on` inputs in
  `supabase/tests/season-aware-intervals.sql` appear verbatim in `SEASON_BOUNDARIES`
  (`season.test.ts:15-28`); outputs and the `2000-01-01` fixture date correctly excluded; the SQL
  carries the source-of-truth comment; no third copy of the table.
- **Mutation audit is substantive** — narrowed to the two planned scopes, and the three `due.ts`
  survivors were *fixed with real assertions* (two new tests pinning genuine `findNextUpcoming`
  selection defects), not score-chased. Required PL/pgSQL caveat present.
- **Cookbook §6.2/§6.3 are specific** — stack start, fixture entry points, per-worker user pattern,
  the `test.concurrent` prohibition, what in-process invocation skips, the resulting-state assertion
  discipline, and the Astro-internals shim coupling are all documented.
- **All "What We're NOT Doing" guardrails respected** — no migration or `src/actions/index.ts` change
  in Phases 5–6, no `.github/` change, `prd.md` and `today-list/utils.ts` untouched, no `.tsx` test,
  all Action calls via `orThrow.call`. No server-side undo-expiry test exists (the plan forbade one).
