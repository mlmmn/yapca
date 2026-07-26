<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Test-runner bootstrap and calendar math

- **Plan**: `context/changes/testing-runner-and-calendar-math/plan.md`
- **Scope**: Full plan — Phases 1–4 of 4
- **Date**: 2026-07-26
- **Verdict**: NEEDS ATTENTION at review time — **all 8 findings triaged and fixed**
- **Findings**: 0 critical, 4 warnings, 4 observations (8 FIXED, 0 skipped, 0 accepted)

## Post-triage state

All eight findings were fixed on 2026-07-26. The full CI sequence re-runs green in CI's
own order: `pnpm install --frozen-lockfile`, `pnpm exec astro sync`, `pnpm lint`,
`pnpm check` (new), `pnpm test` (56 tests), `TZ=America/New_York pnpm test`, `pnpm build`
— every one exit 0.

Each fix was verified by observing the gate it adds actually fail, per the plan's own
"every gate must be observed failing, not only passing" principle:

| Finding | Break introduced | Result |
|---|---|---|
| F1 | type error in a test file | `pnpm check` exit 1 → revert exit 0 |
| F2 | cookie renamed to `tzone=` in `layout.astro` only | suite red → revert green |
| F4 | `schedule.ts:34` returns `input.activeDay` | suite red → revert green |
| F5 | — (refactor; 56 tests still pass, no assertion lost) | green |
| F7 | failing `discovery-probe.test.tsx` added | suite red → previously ignored entirely |

**One fix is not yet observed in CI**: F3's action pin and F1's `pnpm check` step both
change `.github/workflows/ci.yml`, and only a push can confirm the job still goes green
with them. Everything else was verified locally.

Prior phase reviews (`impl-review-phase-1/2/3.md`) are all fully triaged with no PENDING
or SKIPPED decisions, so this is a fresh full-plan sweep. Phase 4 had never been reviewed.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

### Success criteria re-verification (all re-run for this review)

Every automated criterion across all four phases was re-executed and exits 0:
`pnpm install --frozen-lockfile`, `pnpm exec astro sync`, `pnpm lint`, `pnpm test`
(5 files / 54 tests), `TZ=America/New_York pnpm test` (54 tests), `pnpm build`.
`grep "TBD — see §3 Phase 1"` returns nothing; `gh workflow view ci.yml --yaml` contains
zero occurrences of `master`.

Manual criteria carry hard evidence rather than a rubber stamp:

- 3.3 / 3.5 / 3.6 — GitHub run history shows `0679a30` ("test: deliberately break CI
  assertion") **failed** and `b9b33f2` (its revert) **succeeded**, both on the PR, with
  three subsequent green runs on `main` (latest `727c590`).
- 2.5 — `timezone.test.ts` grepped clean of any reference to the 36-hour window or the
  28 halvings.
- 1.x / config — the `TZ` safety net was probed directly in both directions: with `TZ`
  unset in the shell the worker resolves `UTC`; with `TZ=Asia/Tokyo` it resolves
  `Asia/Tokyo`. The `env` option genuinely takes effect.

## Findings

### F1 — Nothing in CI type-checks the repository, including the five new test files

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `.github/workflows/ci.yml:26-32`
- **Detail**: The CI job runs `lint`, `test`, `build` — none of which reports TypeScript
  compile errors. `eslint.config.js:16` uses `projectService: true` with
  `strictTypeChecked`, which makes type *information* available to lint rules but does
  not surface `tsc` diagnostics; `astro build` does not run `astro check` either.
  Verified empirically, not inferred: appending
  `const typeErrorProbe: number = "not a number";` to `src/lib/schedule.test.ts` gives
  `pnpm lint` → exit **0**, `pnpm test` → exit **0**, `pnpm build` → exit **0**.
  Only `pnpm exec astro check` catches it (exit **1**, "1 error"). `@astrojs/check` is
  already a devDependency (`package.json:19`) but is wired into no package script and no
  CI step. `tsconfig.json` has `include: ["**/*"]`, so the test files are inside the
  program and simply never compiled. This is the same failure class the change set out
  to repair — a gate that looks present and never fires.
- **Fix A ⭐ Recommended**: Add a `check` script (`"check": "astro check"`) and a
  `pnpm check` step to `ci.yml` between `pnpm lint` and `pnpm test`.
  - Strength: Uses a dependency already installed; closes the gap for the whole repo,
    not just test files; matches the phase's own "observe the gate fail" discipline.
  - Tradeoff: `astro check` currently reports 10 hints alongside 0 errors on a clean
    tree — the step passes today, but adds ~20s to the job.
  - Confidence: HIGH — exit codes measured directly in both the clean and broken states.
  - Blind spot: Have not checked whether `astro check` is stable in the CI container the
    way it is locally.
- **Fix B**: Record the gap as a known limitation and hand it to test-plan Phase 5
  alongside branch protection.
  - Strength: Keeps this change's scope exactly as planned; Phase 5 already owns
    gate-hardening.
  - Tradeoff: Leaves the suite type-unchecked for however long Phase 5 takes, during
    which a broken test file's types can land silently.
  - Confidence: MEDIUM — depends on Phase 5 actually being scheduled.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A — added `"check": "astro check"` to `package.json:11`
  and a `pnpm check` step to `.github/workflows/ci.yml:30`, between `pnpm lint` and
  `pnpm test`. Verified in all three states per the plan's gate discipline: clean tree
  exits **0**, the injected type error exits **1**, and the revert returns to **0**.

### F2 — The one drift the code explicitly warns about is the one left unguarded

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `src/lib/timezone.ts:1-5`, `src/layouts/layout.astro:28`
- **Detail**: `TIME_ZONE_COOKIE` is the only export across the five modules with no test
  at all. Its own header comment states the stakes precisely: the cookie name and the
  `en-US` 2-digit day formatting "are duplicated verbatim by the inline head script in
  `src/layouts/layout.astro`, which cannot import from here. Drift makes that script's
  `data-today` comparison fail forever, costing every visitor an extra document request
  per session. Change both together." `layout.astro:28` hardcodes `` `tz=${…}` `` and
  `layout.astro:31-35` hardcodes `"en-US"` / `2-digit`. The plan's "What We're NOT Doing"
  protects that duplication as a deliberate trade-off — but a *guard test* does not
  change it, and this change's entire purpose is freezing agreements that are correct
  today. Asserting `TIME_ZONE_COOKIE === "tz"` would be the tautology test-plan §2 warns
  against; the assertion that earns its keep reads `layout.astro` and asserts it contains
  `` `${TIME_ZONE_COOKIE}=` ``.
- **Fix**: Add a test in `src/lib/timezone.test.ts` that reads `src/layouts/layout.astro`
  and asserts it contains `` `${TIME_ZONE_COOKIE}=` ``, failing loudly if either side is
  renamed alone.
  - Strength: Converts a comment-enforced invariant into an executed one; the failure
    mode it guards is silent and permanent for every visitor.
  - Tradeoff: Introduces the suite's first filesystem read, so `environment: "node"` and
    a path relative to the repo root become load-bearing.
  - Confidence: HIGH — both sides of the duplication read and confirmed.
  - Blind spot: The `en-US` / `2-digit` half of the duplication is harder to assert this
    way and would remain uncovered.
- **Decision**: FIXED — added a `TIME_ZONE_COOKIE` describe to `src/lib/timezone.test.ts`
  that reads `src/layouts/layout.astro` and asserts it contains `` `${TIME_ZONE_COOKIE}=` ``.
  The path is resolved via `fileURLToPath(new URL("../layouts/layout.astro",
  import.meta.url))` rather than `process.cwd()`, so the test does not depend on the
  invocation directory. Verified by simulating the real drift: renaming only the inline
  script's cookie to `tzone=` turns the suite red (exit **1**); the revert returns it to
  55 passing. `pnpm lint`, `pnpm check` and both `TZ` legs stay at 0. The `en-US` /
  `2-digit` half of the duplication remains uncovered, as noted in the blind spot.

### F3 — `pnpm/action-setup` is a third-party action on a mutable tag in a job that reads secrets

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `.github/workflows/ci.yml:21-23`
- **Detail**: `pnpm/action-setup@v4` is a moving tag on a non-GitHub-owned repository,
  and the same job later exposes `SUPABASE_URL` / `SUPABASE_KEY` to the `build` step. A
  tag repoint would execute attacker-controlled code with access to them.
  `actions/checkout@v4` and `actions/setup-node@v4` are GitHub-owned and lower risk.
  Separately, `actions/checkout@v4` runs without `persist-credentials: false`, leaving
  `GITHUB_TOKEN` in `.git/config` for later steps including `pnpm install` lifecycle
  scripts — low impact under `permissions: contents: read`, but free to close.
  Context: the trigger is correctly `pull_request` (not `pull_request_target`), so fork
  PRs receive empty secrets, and both env vars are `optional: true`
  (`astro.config.mjs:21-22`) so fork builds still pass. No `${{ github.event.* }}` is
  interpolated into any `run:` block — there is no script-injection surface.
- **Fix**: Pin `pnpm/action-setup` to a full commit SHA with a trailing `# v4.x` comment,
  and add `persist-credentials: false` to the checkout step.
- **Decision**: FIXED — pinned to
  `pnpm/action-setup@b906affcce14559ad1aafd4ab0e942779e9f58b1 # v4.3.0`, carrying a
  Why-comment, and added `persist-credentials: false` to the checkout step. The SHA was
  resolved from the live `v4` tag (annotated → commit `b906aff`, which is `v4.3.0`), so
  the pin is byte-identical to what the observed-green runs already executed — this
  changes nothing behaviourally, it only removes the mutability. **Not yet observed in
  CI**: unlike the local gates, this needs a push to confirm. Note for later: `v4` is
  well behind upstream (`v6.0.9` is current), and `v4.4.0` already points at the same
  commit as `v5.0.0` — a deliberate major bump is a separate decision, not part of this
  fix.

### F4 — `resolveScheduleChange`'s `oldNextDue` pass-through is asserted nowhere

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/lib/schedule.test.ts:13-61`, `src/lib/schedule.ts:34`
- **Detail**: `ScheduleChange` declares `oldNextDue: string` (`schedule.ts:13`) and
  `schedule.ts:34` returns `input.oldNextDue`. The test file contains zero references to
  `result.oldNextDue`, so that line could return `input.activeDay`, `""`, or
  `newNextDue` and all 54 tests stay green. The field exists to let callers render a
  before/after comparison, so a wrong value is user-visible.
- **Fix**: Add `expect(result.oldNextDue).toBe("2024-03-20")` to the existing
  `test.each` block in `src/lib/schedule.test.ts:16-28`.
- **Decision**: FIXED — assertion added to the `test.each` block, written as a literal
  rather than `baseInput.oldNextDue` so a pass-through returning some other field of the
  same input object could not satisfy it. Verified by mutation: changing `schedule.ts:34`
  to `oldNextDue: input.activeDay` turns the suite red (exit **1**); the revert returns
  it to green.

### F5 — One `describe` covers two functions, deviating from the recorded lessons rule

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `src/lib/date.test.ts:15`
- **Detail**: `describe("toEpochDay and fromEpochDay")` groups two functions in one block.
  `context/foundation/lessons.md` ("Name test describe blocks after the function under
  test, not the module") requires one sibling top-level `describe` per function. The
  deviation is deliberate and reasoned — the comment at `date.test.ts:14` notes these are
  an inverse pair where every assertion exercises both directions — which is defensible,
  but it is currently an undocumented exception to a written rule and will be re-flagged
  by the next reviewer. No module-level wrapper `describe` exists in any of the five
  files, so the core rule is satisfied.
- **Fix**: Either split into two sibling `describe`s, or add the inverse-pair carve-out
  to `lessons.md` so the exception is recorded once rather than re-litigated.
- **Decision**: FIXED by splitting — `describe("toEpochDay")` and
  `describe("fromEpochDay")` are now sibling top-level blocks, with no carve-out added to
  `lessons.md` (the rule stands unqualified). No assertion was lost: the absolute anchors
  were divided by direction, and the round-trip moved under `fromEpochDay`, which is the
  function it asserts on. The header comment still records why each direction carries an
  absolute anchor. 56 tests pass; `lint` and `check` at 0.

### F6 — Plan text still specifies `node-version: 22`; the workflow reads `.nvmrc`

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `.github/workflows/ci.yml:25`, `plan.md:544-545`
- **Detail**: The Phase 3 contract says `actions/setup-node@v4 with node-version: 22`;
  the shipped workflow uses `node-version-file: .nvmrc`, which contains `22.14.0`. The
  effective major matches and the change is arguably tighter (one source of truth shared
  with local dev). It was made deliberately by the Phase 3 review's F2 and recorded in
  `reviews/impl-review-phase-3.md:61-69` — but unlike the branch-authorization and
  `getViteConfig` decisions, it was never folded back into `plan.md`, so the plan text
  now contradicts the code. Same for the additive hardening in commit `7d03c96`
  (`permissions`, `concurrency`, `timeout-minutes`).
- **Fix**: Add a one-line `REVISED (Phase 3 review)` note to the Phase 3 contract in
  `plan.md`, matching the RESOLVED / EXTENDED / AUTHORIZED notes used elsewhere.
- **Decision**: FIXED — a `REVISED (Phase 3 review and full-plan impl-review)` note was
  added to the Phase 3 contract in `plan.md`, covering all four deviations rather than
  just the Node one: the `.nvmrc` sourcing, `7d03c96`'s `permissions` / `concurrency` /
  `timeout-minutes`, this review's `pnpm check` step (F1), and the action pin plus
  `persist-credentials: false` (F3). It also states explicitly that the pnpm **version**
  remains unpinned, so the hazard recorded in Critical Implementation Details still
  stands.

### F7 — Vitest discovers only `.test.ts`, while the ESLint override also covers `.test.tsx`

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architecture
- **Location**: `vitest.config.ts:13`, `eslint.config.js:164`
- **Detail**: `include: ["src/**/*.test.ts"]` does not match `.tsx`, but the test-file
  ESLint block matches `["**/*.test.ts", "**/*.test.tsx"]`. A future `.test.tsx` would be
  linted under test rules and silently never executed — passing CI by not running. No
  `.test.tsx` exists today (verified, zero files), and component testing is explicitly out
  of scope, so this is latent rather than live.
- **Fix**: Either narrow the ESLint block to `.test.ts`, or widen the Vitest `include` to
  `src/**/*.test.{ts,tsx}` — whichever matches the intent for test-plan Phase 2.
- **Decision**: FIXED by widening — `vitest.config.ts` now uses
  `include: ["src/**/*.test.{ts,tsx}"]`. Note `environment` remains `"node"`, so a test
  that needs a DOM has to change that too.
  Verified by dropping a deliberately failing `src/lib/discovery-probe.test.tsx`
  into the tree: the suite goes red (exit **1**), where under the old glob it would have
  been silently ignored. Removed after the check; 56 tests pass, `lint` / `check` /
  `TZ=America/New_York` all at 0.

### F8 — The `@/` alias canary is protected only by a comment

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `src/lib/season.test.ts:2-5`
- **Detail**: `season.test.ts` is the only file importing through `@/lib/...`; the other
  four use relative `./`. This is deliberate — it is the sole exercise of the
  `vite-tsconfig-paths` wiring, and criterion 2.8 depends on it — and the comment at
  lines 2-4 says so. But a future "normalize the imports" cleanup would delete the
  coverage while leaving the suite green, which is precisely the silent-capability-loss
  the canary exists to prevent.
- **Fix**: Note the canary in `context/foundation/test-plan.md` §6.1 alongside the other
  conventions, so it is discoverable outside the file that would be edited away.
- **Decision**: FIXED — §6.1 now carries a paragraph naming `src/lib/season.test.ts`'s
  `@/lib/season` import as a deliberate exception to the relative-import norm, with an
  explicit "do not normalise it" instruction and a fallback (move the aliased import
  elsewhere rather than drop it) if that file ever changes.

## Notes on what was checked and found clean

- **Scope discipline**: no Playwright, pgTAP, or `@cloudflare/vitest-pool-workers`; no
  coverage thresholds or reporters; no SQL tested; no Astro Container API; no source file
  under `src/lib/` modified — the only `src/` changes in the diff are the five new
  `.test.ts` files. ESLint relaxes exactly the three granted rules and adds one
  (net-stricter). `.gitignore` gained two lines (`.pnpm-store`), which does not shadow the
  lockfile, the test files, or `vitest.config.ts`.
- **Test quality**: no tautological assertions found. Every expectation compares against a
  hand-written literal rather than a value recomputed by the module under test. Two spots
  specifically anticipate mutation survival — `date.test.ts:24-29` anchors epoch day zero
  absolutely because the round-trips alone only pin symmetry (a shared sign error would
  cancel), and `date.test.ts:87-91` adds the comparator tie case because a swapped
  `localeCompare` plus a sign flip otherwise survives. `schedule.test.ts:14-15` grounds
  interval literals independently of the subtraction under test.
- **Ambient state**: no test calls `new Date()` without an argument, uses fake timers, or
  touches the network. Every time-dependent call injects `now` explicitly.
- **Naming and structure**: no violations of the AGENTS.md rules — kebab-case filenames,
  verb-initial function names, no verb-prefixed value names, `const`/`let` at the top of
  their blocks, no `@ts-ignore`. No helper duplication across the five test files.
- **Residual uncovered paths**, all defensive and acceptable: the window-extension `while`
  loop (`timezone.ts:78-80`) is unreachable for any real zone (longest day is 26h against
  a 36h seed), and `formatDay`'s throw (`timezone.ts:46-48`) is unreachable.
  `formatShortDate` is exercised with a single date (`date.test.ts:55-59`), so a padding
  regression on a 2-digit day would not be caught.
