# Test-runner bootstrap and calendar math — Plan Brief

> Full plan: `context/changes/testing-runner-and-calendar-math/plan.md`
> Research: `context/changes/testing-runner-and-calendar-math/research.md`
> Parent: `context/foundation/test-plan.md` §3 Phase 1

## What & Why

This project has no test runner. Test-plan Phase 1 buys one and points it at the two
risks the team can least reason about by hand: every surface agreeing on "today"
(Risk #1) and season boundaries selecting the documented interval (Risk #6). It also
repairs a CI workflow that has never executed a single job — without which the "unit
tests required" row in the test plan is false on disk.

## Starting Point

Zero test infrastructure: no runner, no test files, no script. The calendar layer is
already structurally sound — `src/lib/` does all date math in UTC epoch days, and the
TypeScript season rule agrees with the SQL rule on every boundary date including
leap-year Feb 29. Research found the risk is not the arithmetic but the *acquisition*
of "today", and surfaced three live plumbing defects along the way. Separately, CI is
broken three independent ways (`master` trigger on a `main` branch, `cache: npm` and
`npm ci` against a pnpm-only repo) and has never run.

## Desired End State

`pnpm test` runs a green suite across all five pure `src/lib/` modules and exits
non-zero when an assertion breaks. The same command runs on every pull request to
`main`, in a workflow that has been observed both passing *and* failing. Season
boundary dates live in one exported fixture that is authoritative for TypeScript;
test-plan Phase 2 must reconcile the existing SQL boundary cases against it rather
than adding a third copy. The three defects have their own change folder.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Runner | Vitest 4.1.10 via `getViteConfig()` | Astro's official path; buys the `@/*` alias and config resolution without duplication. | Research |
| Environment | `node`, not workerd pool | No target module reaches `astro:env`; no bindings, no I/O, no Cloudflare semantics. | Research |
| Test scope | All five `src/lib/` modules | Includes `timezone.ts`, which the archive flagged as the one unguarded, non-trivial module. | Plan |
| Three defects (D-1–D-3) | Record, don't fix | None is provable by a pure unit test; fixing them would ship plumbing changes with no coverage. | Plan |
| CI repair | In this change, as its own phase | A runner nobody runs is not a gate; deferring leaves §5's table false for four phases. | Research |
| TS↔SQL parity | Shared boundary fixture | Pins the contract in one place Phase 2 inherits, without creating a third copy of the season rule. | Plan |
| Lint | Conform + 3 granted rule overrides | `triple-slash-reference` (the one verified conflict) is solved by a type-only import, with a pre-authorized one-line eslint-disable as fallback. | Plan |
| Phase order | CI third, after the tests | Repairing CI first wires a step with nothing to run. | Plan |

## Scope

**In scope:** Vitest dependency, config, and scripts; a test-file ESLint override for
exactly three authorized rules; unit tests for `date`, `interval`, `season`,
`schedule`, `timezone`; a shared season boundary fixture; full CI workflow repair plus
`pnpm test`; test-plan §6.1 cookbook; a follow-up change folder for D-1–D-3.

**Out of scope:** Fixing D-1–D-3; any SQL or database test; integration, contract, or
browser layers; `@cloudflare/vitest-pool-workers`; Astro component rendering; coverage
thresholds; migration-safety gating and branch protection (test-plan Phase 5); any
change to the season rule or the duplicated inline head script.

## Architecture / Approach

Vitest resolves the real `astro.config.mjs` through `getViteConfig()`, runs on Node,
defaults `TZ` to UTC while honoring an explicit shell override, and discovers
`src/**/*.test.ts` co-located beside the modules they test. Every function under test
takes its time input as an argument (`getTodayInTimeZone(zone, now)`,
`getSeason(dateString)`), so tests pass `now` and date strings explicitly rather than
relying on ambient state — fake timers are available but deliberately unused. The
season boundary fixture is a plain exported constant and the authoritative table for
TypeScript; test-plan Phase 2 must either import it into a TypeScript database harness
or derive the existing SQL cases from it.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Runner bootstrap + lint contract | Vitest, config, scripts, ESLint test override, one real test | `getViteConfig()` loads the Cloudflare adapter; fallback to plain `defineConfig` is documented |
| 2. Calendar, season, timezone tests | Full assertion surface + shared boundary fixture | Over-specifying `getMillisecondsUntilNextMidnight` into a tautology that freezes the binary search |
| 3. CI repair | Working workflow with `pnpm test` wired in | Three faults mask each other — a partial fix produces red builds on every PR |
| 4. Docs + defect hand-off | Test-plan §6.1, status updates, follow-up change folder | D-3's intended behaviour is genuinely unsettled and must be flagged, not guessed |

**Prerequisites:** No Docker, no repo-admin access, no secrets; the CI repair is
self-contained in one file. Phase 3 does need a remote push to verify: either explicit
user authorization to create a branch and open a PR, or an accepted direct push to
`main` (the repaired workflow triggers on both). See Phase 3's Prerequisite block.
**Estimated effort:** ~2 sessions across 4 phases; Phase 2 is the bulk of the work.

## Open Risks & Assumptions

- `getViteConfig()` resolving `astro.config.mjs` pulls in the Cloudflare adapter; the
  plan names a fallback rather than assuming it is frictionless.
- The lint analysis found exactly one conflicting rule (`triple-slash-reference`), and
  it has both a clean fix and a pre-authorized suppression. A rule I did not anticipate
  may still surface once real test code exists — `pnpm lint` at zero warnings is an
  automated success criterion in every phase so it surfaces loudly.
- Verification depends on a remote push actually running CI — on a PR or directly on
  `main`. If the workflow still shows zero checks after the repair, that is the same
  silent state as today and the phase is not done. Detection on both trigger paths is
  in scope; making a red check *block a deploy* is not — there is no deploy job in
  Actions, so that needs test-plan Phase 5's branch protection.
- The shared fixture's parity value is a promise until test-plan Phase 2 consumes it.
- Workerd's ICU completeness and `Date.now()` behaviour remain unverified; neither is
  load-bearing here, but both must be checked before any future workerd-pool decision.

## Success Criteria (Summary)

- A developer can run `pnpm test`, get a green suite in seconds, and see it go red when
  they break something — verified by deliberately breaking it, not by assuming.
- Every pull request to `main` runs lint, tests, and build, in a workflow that has been
  observed failing as well as passing.
- The next contributor can write a unit test from test-plan §6.1 alone, and the season
  boundary dates they assert against are the same ones the database will be held to.
