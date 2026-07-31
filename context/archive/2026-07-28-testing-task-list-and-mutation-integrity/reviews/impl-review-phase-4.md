<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Task-list and Mutation Integrity — Phase 4

- **Plan**: `context/changes/testing-task-list-and-mutation-integrity/plan.md`
- **Scope**: Phase 4 of 6 — Risk #3, Edit-Path Integrity (commit `d40f5c0`)
- **Date**: 2026-07-31
- **Verdict**: NEEDS ATTENTION → all findings triaged and fixed (F1–F6)
- **Findings**: 0 critical, 5 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | FAIL → resolved (F2, F3, F4 fixed) |
| Scope Discipline | PASS |
| Safety & Quality | WARNING → resolved (F1 fixed) |
| Architecture | PASS |
| Pattern Consistency | WARNING → resolved (F5 fixed) |
| Success Criteria | WARNING → resolved (F6 fixed) |

## Post-triage verification

Run with the local Supabase stack up (12 containers), exit codes read directly rather than through a pipeline:

`pnpm test` exit 0 (90/90) · `pnpm test:integration` exit 0 (14/14) · `pnpm lint` exit 0 · `pnpm check` exit 0

## Success criteria verification

| ID | Criterion | Result |
|----|-----------|--------|
| 4.1 | `pnpm test:integration` passes | PASS — 4 files, 13 tests at review, 14 after triage, exit 0 |
| 4.2 | `pnpm test` passes with stack stopped | PASS — 6 files, 90 tests, exit 0 (run with stack up; the `unit` project makes no DB call, so the result is equivalent) |
| 4.3 | `pnpm lint` and `pnpm check` pass | PASS after F6 — at review both exited 0 only with the stack down; `pnpm lint` exited 1 with it up. Now exit 0 in both states |
| 4.4 | Past-dated recalculation case passes, proving no clamping | PASS — the recalculation test asserts a literal per-season shift landing before `clientDate` |
| 4.5 | Test plan Risk #3 row corrected, §8 records it | PASS — diff evidence in `test-plan.md:77` and `:239` |
| 4.6 | Editing a plant with a photo through the real UI preserves the photo | Browser check — no diff evidence possible; accepted as attested |

## Findings

### F1 — Storage-leak assertion is vacuous and disables the suite's real leak detector

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/actions/update-plant.integration.test.ts:196-197`
- **Detail**: The photo test ends with `removeAllStorageObjects(...)` immediately followed by `assertNoStorageObjects(...)`. Both call `listStoragePaths` on the same prefix, so the assertion can only fail if the Storage remove API silently no-ops — it proves nothing about `updatePlant`. `test/fixtures/user.ts:353-356` names this exact anti-pattern in its own comment, and the plan's Testing Strategy lists "a pass-through seam that asserts nothing" as anti-pattern #2 the phase exists to prevent.

  The line-196 wipe is worse than redundant. `test/setup/global-setup.ts:37-52` fails the run (`process.exitCode = 1`) when any fixture user still owns Storage objects at teardown — that is the repo's only regression detector for the superseded-photo cleanup at `src/actions/index.ts:186-193`, which is deliberately best-effort and only `console.error`s on failure. Wiping the bucket suppresses it. Per-test `resetUserSlot` (`test/fixtures/user.ts:427-435`) already clears Storage before the next test, so line 196 buys nothing.

  Verified: after the replace and remove steps the handler should leave the bucket genuinely empty (replace removes the original, remove removes the replacement), so deleting line 196 is safe and makes line 197 load-bearing.

  Related gap in the same test: the replace step (`:181-183`) asserts the new object is retrievable but never that `originalPhotoPath` is gone. A regression that stops removing superseded photos passes today and is invisible to teardown.
- **Fix**: Delete line 196; keep `assertNoStorageObjects` as the real assertion. Add `await expect(userFixture.client.storage.from("plant-photos").download(originalPhotoPath)).resolves.toMatchObject({ error: expect.anything() })` (or a list-based check) after the replace step so the superseded-photo cleanup is positively asserted.
  - Strength: Restores both the local assertion and the global teardown detector; one deletion plus one added assertion.
  - Tradeoff: None — verified the bucket is genuinely empty at that point.
  - Confidence: HIGH — traced through `src/actions/index.ts:186-193` and `global-setup.ts:37-52`.
  - Blind spot: None significant.
- **Decision**: FIXED

### F2 — `next_due_on` omitted from the "preserves the complete record" assertion

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `src/actions/update-plant.integration.test.ts:106-114`
- **Detail**: The plan's Phase 4 §2 contract says "re-read the full `plants` row and assert every column" and names `next_due_on` unchanged when the active-season delta is zero" explicitly. The `toMatchObject` shape covers `created_at`, both intervals, `id`, `name`, `photo_path`, `user_id` — every column except `next_due_on`, the one column the edit path actually recomputes. Row 1 of the table (`{growing: 7, dormancy: 30}` against a 7/30 fixture) is the delta-zero case the plan called out, and its `next_due_on` invariant is unasserted. Rows 2-4 take the `deltaDays !== 0` branch and rewrite `next_due_on` with no assertion at all. A regression moving the due date on a name-only edit passes this test.
- **Fix**: Add `next_due_on` to the matched shape, computed per row from `plant.next_due_on` plus the literal active-interval delta (0, +3, +3, +5 in growing season).
- **Decision**: FIXED

### F3 — No dormancy-season recalculation case; the active-interval dispatch is unobservable

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: `src/actions/update-plant.integration.test.ts:119-143`
- **Detail**: The plan's Phase 4 §3 contract states: "Include a dormancy-season case, since the delta is computed from the *active* interval for the action date." No such case exists. The single recalculation test sets `growingIntervalDays` and `dormancyIntervalDays` to the same value on both sides (7/7 → 1/1), so `selectSeasonInterval`'s branch is unobservable — the assertion holds regardless of which interval is selected. In the `test.each` table, rows 2 and 3 differ only in `dormancy_interval_days`, which is inert today (Jul 31 = growing season), so they exercise the identical `10 - 7 = 3` delta.

  Mitigating: `src/lib/schedule.test.ts:43-59` does cover the dormancy dispatch at unit level (`activeDay: "2024-11-01"`, asserting `deltaDays` 5 from the dormancy pair while the growing pair moves 100→1). What is unproven is the seam — `getActionDate(clientDate)` feeding a real DB row through `resolveScheduleChange` — in dormancy season. Note that `getActionDate` (`src/lib/date.ts:43-51`) rejects a client date more than one day from UTC today, so a dormancy-season integration case cannot be written by pinning a November `clientDate`; only the growing/dormancy distinction via interval values on today's date is reachable, which is exactly why row 2 vs row 3 is inert.
- **Fix A ⭐ Recommended**: Add a growing-season case that changes **only** `dormancy_interval_days` and asserts `next_due_on` is unchanged (delta 0), proving the inactive interval is ignored at the seam.
  - Strength: Reachable today without fighting `getActionDate`'s ±1-day guard; discriminates the dispatch with a single assertion; complements the unit test rather than duplicating it.
  - Tradeoff: Still does not run the dormancy branch itself at integration level — that stays unit-only until a November run.
  - Confidence: HIGH — `resolveScheduleChange` reads both pairs, so a dispatch inversion would move `next_due_on` and fail this case.
  - Blind spot: The test's expected delta becomes season-dependent, so it will need the inverse shape after Oct 31; consider deriving the expectation from `getSeason(clientDate)`.
- **Fix B**: Accept unit coverage as sufficient and record the deviation in the plan as an addendum.
  - Strength: `schedule.test.ts:43-59` genuinely proves the dispatch; no duplicate coverage.
  - Tradeoff: The plan's explicit contract goes unmet with no test pinning the seam; a future change to how `updatePlant` passes intervals into `resolveScheduleChange` has nothing pointing at it.
  - Confidence: MEDIUM — depends whether the seam or the pure function is judged the risk surface.
  - Blind spot: Have not checked whether Phase 6's Stryker run over `src/lib/schedule.ts:19-37` would surface a survivor here.
- **Decision**: FIXED — neither option as written. F2's fix already supplied seam-level dispatch discrimination (table row 2 asserts growing +3 / dormancy 0), so the remaining work was to differentiate the dedicated recalculation test: it now uses asymmetric pairs (7→1 growing, 30→20 dormancy) with literal per-season deltas, and carries a comment recording that the dormancy branch itself is only executable at integration level between November and February because of `getActionDate`'s ±1-day guard.

### F4 — The production "replace" payload is never exercised; only the E5 collision is, unlabelled

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `src/actions/update-plant.integration.test.ts:170-179`
- **Detail**: The plan's Phase 4 §4 contract asks for three intents (`keep` / `replace` / `remove`) **and, separately**, E5 — "a request carrying both `photo` and `removePhoto=true` resolves to replace — unreachable from the UI, reachable by direct call, and currently silent." The test collapses the two: its replace step sends `photo` together with `removePhoto: true`, which is the E5 shape, not the real one. `src/components/edit-plant-form/edit-plant-form.tsx:79,83` emits `removePhoto=false` when the intent is replace. The ordinary replace payload is therefore untested.

  Compounding it, nothing in the file names E5. A future reader sees `removePhoto: true` next to a photo in a step called "replace" and reads it as a copy-paste bug — "fixing" it to `false` would silently delete the E5 coverage the plan asked for.
- **Fix**: Send the replace step with `removePhoto: false` (the default), and add a separate case asserting `photo` + `removePhoto=true` still resolves to replace, with a comment naming E5 and stating it is unreachable from the UI.
- **Decision**: FIXED

### F5 — No explanatory comments, diverging from both sibling integration files and three plan requirements

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `src/actions/update-plant.integration.test.ts` (whole file)
- **Detail**: The file carries zero comments. Both siblings annotate non-obvious choices — `src/actions/harness.integration.test.ts:53-56` and `src/lib/services/load-today-plants.integration.test.ts:19-20,48-49` — and so does the unit precedent this phase was told to follow (`src/lib/schedule.test.ts:14-15,27-28`). The plan asked for documentation at three specific points that are now silent: the E5 case (F4), the E1 accepted debt behind the stale-token-succeeds branch ("pinned so a future change to it is deliberate", `:224-233`), and the `updated_at` verbatim-string requirement the plan calls "the plan's single most fragile requirement". A reader cannot tell from the code that row 1 of the `test.each` table is the only delta-zero row, or why the stale-token test performs a warm-up update first.
- **Fix**: Add short "why" comments at the E5 case, the stale-token-succeeds branch (naming E1 and `src/actions/index.ts:168-170`), and the delta-zero table row.
- **Decision**: FIXED

### F6 — `pnpm lint` fails whenever the Supabase stack is running

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: `eslint.config.js:202`
- **Detail**: `pnpm lint` exits **1** with the stack up:

  ```
  supabase/.temp/start-secrets/supabase_edge_runtime_10x-astro-starter/main/index.ts
    0:0  error  Parsing error: … was not found by the project service.
  ✖ 1 problem (1 error, 0 warnings)
  ```

  `pnpx supabase start` writes `supabase/.temp/`. That path is git-ignored (`supabase/.gitignore:3`), but ESLint flat config does not inherit `.gitignore`, and `eslint.config.js:202` ignores only `.claude/**` and `src/lib/database.types.ts`. The file is outside `tsconfig.json`, so the type-aware parser errors on it.

  Not introduced by Phase 4 — reproduced at the untouched baseline via `git stash`. But it is newly *load-bearing*: this change made "Supabase stack running" the normal state for integration development, and criteria 4.3 and 6.3 both read "`pnpm lint` passes". Whoever checked 4.3 almost certainly ran it with the stack down, or read a pipeline's exit status rather than ESLint's — the exact trap `context/foundation/lessons.md:19-24` records. (This review's first pass made that mistake too: `pnpm lint | tail` reports `tail`'s status, not ESLint's.)

  The pre-commit hook is unaffected — Lefthook lints staged files only, and `.temp` is never staged.
- **Fix**: Add `"supabase/.temp/**"` to the `ignores` array at `eslint.config.js:202`. **Not applied** — AGENTS.md forbids modifying ESLint config without explicit permission ("Report config issues instead of fixing them unilaterally"), so this is reported for your decision.
  - Strength: One-line change; matches how `.claude/**` is already handled; makes 4.3/6.3 satisfiable in the state the suite is designed to run in.
  - Tradeoff: None — the path is a runtime artifact that is already git-ignored.
  - Confidence: HIGH — the parse error names the file and the path is generated, not authored.
  - Blind spot: Have not checked whether `supabase/.branches` or other generated Supabase paths hit the same rule under different local workflows; a broader `"supabase/.temp/**", "supabase/.branches/**"` may be warranted.
- **Decision**: FIXED — user granted explicit permission for the ESLint config change. `"supabase/.temp/**"` added to `eslint.config.js:207`, with a comment recording that `includeIgnoreFile` reads the root `.gitignore` only and therefore never sees the nested `supabase/.gitignore`. Verified: `pnpm lint` exit 0 with all 12 stack containers running. Scoped to `.temp` as requested; `supabase/.branches/**` left alone since nothing currently generates TypeScript there.

## Not flagged

- `test/fixtures/plants.ts` — `photoPath?: string | null` defaulting to `null` is minimal and non-breaking for existing callers. In scope, correctly placed.
- `context/foundation/test-plan.md` — the Risk #3 rewording matches `resolveScheduleChange`'s shipped behaviour; §8's freshness stamp records the amendment with a reason, per the file's own convention. Exactly what the plan asked for, and the document was not regenerated.
- Hardcoded `${userId}/original.png` at `:148` — no collision across tests or workers; `beforeEach` marks slots dirty and `resetUserSlot` clears Storage before first fixture use, and the prefix is per-user per-worker.
- Test 4 (stale token, `:200-234`) — logic verified sound and non-vacuous: the warm-up has delta 0 so it bypasses the guard while the `plants_set_updated_at` trigger bumps the token, and the follow-up's `+1` on both intervals is non-zero in either season.
- Declaration ordering interleaved with `await` — the sequencing is genuinely dependent, which is AGENTS.md's sanctioned exception.
