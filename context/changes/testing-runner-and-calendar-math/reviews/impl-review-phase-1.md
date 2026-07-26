<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Test-runner bootstrap and calendar math

- **Plan**: `context/changes/testing-runner-and-calendar-math/plan.md`
- **Scope**: Phase 1 of 4 (Runner bootstrap and test-file lint contract)
- **Date**: 2026-07-26
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING (F1) |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | WARNING (F2) |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Success criteria — independently re-verified

All six Phase 1 Progress rows were re-run during this review rather than taken on trust:

| ID | Criterion | Result |
|----|-----------|--------|
| 1.1 | `pnpm install` resolves vitest, no peer warning | PASS — lockfile up to date, no peer warnings |
| 1.2 | `pnpm test` exits 0 with ≥1 passing test | PASS — 1 file, 1 test, exit 0 |
| 1.3 | `pnpm lint` at zero warnings incl. `vitest.config.ts` | PASS — "No issues found" |
| 1.4 | `pnpm build` still succeeds | PASS — server built in 13.50s, exit 0 |
| 1.5 | Deliberate break exits non-zero; revert | PASS — reproduced: broken exit 1, reverted exit 0, tree clean |
| 1.6 | `pnpm test:watch` starts and re-runs on save | ACCEPTED — script present (`vitest`); interactive, not re-run here |

Additionally verified (not a plan criterion, but load-bearing for Phase 2/3): the
`test.env.TZ` safety net genuinely controls the runtime zone. On a `Europe/Warsaw`
host, a default `pnpm test` resolves `Intl.DateTimeFormat().resolvedOptions().timeZone`
to `UTC`, and `TZ=America/New_York pnpm test` resolves to `America/New_York` with a
July offset of 240. Both the default and the shell override work as the plan intends.

## Findings

### F1 — `vitest.config.ts` takes the plan's fallback path with no record of why

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `vitest.config.ts`
- **Detail**: The plan's contract (Phase 1 §2) is
  `getViteConfig({ test: {...} })` from `astro/config`, with `defineConfig` +
  a hand-written `resolve.alias` named only as a fallback "if `getViteConfig()`
  misbehaves". The implementation ships the fallback. Nothing in the file, the commit
  message, or the plan records that the primary path was tried or why it was abandoned.

  The fallback is **correct**. This review reproduced the primary path and it fails
  hard: `getViteConfig()` resolves the real `astro.config.mjs`, which loads the
  Cloudflare adapter and forces a workers runner, producing
  `ReferenceError: exports is not defined` at
  `workers/runner-worker/index.js:107:3` before any test executes. The plan
  anticipated exactly this ("do not spend the phase fighting it"), so this is an
  authorized deviation, not a mistake.

  The gap is purely evidentiary. A future contributor — or test-plan Phase 2, which
  revisits this config — reads the plan, sees `getViteConfig` specified, sees
  `defineConfig` on disk, and re-litigates a question that already has a verified
  answer.
- **Fix**: Add a Why-comment at the top of `vitest.config.ts` recording that
  `getViteConfig()` was tried and fails with `ReferenceError: exports is not defined`
  because it loads the Cloudflare adapter, and note the same in the plan's Critical
  Implementation Details as a resolved decision.
  - Strength: Costs two lines and closes the question permanently; matches the in-repo
    Why-comment style at `eslint.config.js:1` and `eslint.config.js:153-161`.
  - Tradeoff: None material.
  - Confidence: HIGH — the failure was reproduced directly in this review.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix (Why-comment added to vitest.config.ts; plan's Critical Implementation Details updated to RESOLVED)

### F2 — `@/*` alias was duplicated and unexercised by any test

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architecture
- **Location**: `vitest.config.ts`
- **Detail**: The plan's stated reason for preferring `getViteConfig` was that the
  `@/*` alias would work "without duplication". Taking the fallback (correctly, per F1)
  meant the alias had two sources of truth: `tsconfig.json` `paths` and a hand-written
  `resolve.alias` in `vitest.config.ts`.

  This was inert at review time and no assertion caught it: `src/lib/interval.test.ts:2`
  imports via the relative `./interval`, and no `*.test.ts` used `@/`. So the alias block
  was untested config — a `tsconfig.json` change would have drifted silently until some
  Phase 2 test happened to use `@/`, surfacing as a confusing module-resolution error
  rather than a config mismatch.
- **Fix**: In Phase 2, have at least one new test import through `@/lib/...` instead of
  a relative path, so the alias is actually exercised by the suite.
- **Decision**: FIXED — resolved at the source rather than tested around, at the user's
  direction. The hand-written `resolve.alias` was **removed entirely** and replaced with
  the `vite-tsconfig-paths` plugin (`vitest.config.ts:8,11`), which derives `@/*` from
  `tsconfig.json` `compilerOptions.paths` at resolve time. `tsconfig.json` is now the
  single source of truth and the duplication no longer exists, so the drift this finding
  described is structurally impossible rather than merely detectable.

  Verified in both directions: an `@/lib/interval` import resolves and passes with the
  plugin, and fails with `Cannot find package '@/lib/interval'` when the plugin is
  removed — so the plugin is demonstrably doing the work. Full gate re-run green after
  the change: `pnpm lint` (no issues), `pnpm test`, `TZ=America/New_York pnpm test`, and
  `pnpm build` all exit 0.

  Package note: **`vite-tsconfig-paths@6.1.1`** (published 2026-03-29, ~31M weekly
  downloads), *not* `vitest-tsconfig-paths` — that name exists on npm but is a fork last
  published 2022-05-26 with ~38k weekly downloads, and should not be used.

  Phase 2 Progress row 2.8 was added and retained: with the plugin in place the aliased
  import no longer guards against alias *drift*, but it still keeps the plugin wiring
  itself covered.

## What was checked and found clean

- **`package.json`**: `vitest@^4.1.10` as devDependency, `"test": "vitest run"`,
  `"test:watch": "vitest"`, `lint-staged` untouched — matches the contract exactly.
  (`vite-tsconfig-paths@^6.1.1` added during triage as part of F2's fix.)
- **`eslint.config.js`**: the new `testConfig` block disables **exactly** the three
  authorized rules (`@typescript-eslint/no-non-null-assertion`,
  `@typescript-eslint/unbound-method`, `react/no-multi-comp`) and nothing else,
  scoped to `**/*.test.ts{,x}`, carrying a rationale comment, and placed after both
  `reactConfig` and `shadcnUiConfig` in the final `tseslint.config(...)` call — the
  order the plan flagged as load-bearing. Honors the pre-authorized ESLint carve-out
  and the "no relaxation beyond the three granted rules" guardrail.
- **`src/lib/interval.test.ts`**: explicit `vitest` imports (no `globals: true`),
  kebab-case, co-located flat beside its module, and a real month-boundary assertion
  rather than a throwaway.
- **Guardrails respected**: no `@cloudflare/vitest-pool-workers`, no SQL tests, no
  Playwright/pgTAP, no coverage thresholds, no Astro component rendering, no change to
  the season rule or epoch-day arithmetic.
- **No triple-slash suppression was needed** — the config avoids the issue entirely by
  not importing `vitest/config` types via a reference directive.
