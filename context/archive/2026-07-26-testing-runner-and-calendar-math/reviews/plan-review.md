<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Test-runner bootstrap and calendar math

- **Plan**: `context/changes/testing-runner-and-calendar-math/plan.md`
- **Mode**: Deep
- **Date**: 2026-07-26
- **Verdict**: REVISE → SOUND after fixes
- **Findings**: 1 critical, 3 warnings, 1 observation (all 5 fixed in plan)

## Verdicts

| Dimension | Verdict (at review) | After fixes |
|-----------|--------------------|-------------|
| End-State Alignment | WARNING | PASS |
| Lean Execution | PASS | PASS |
| Architectural Fitness | PASS | PASS |
| Blind Spots | FAIL | PASS |
| Plan Completeness | WARNING | PASS |

## Grounding

11/11 paths ✓, symbols ✓ — `getViteConfig` present at `node_modules/astro/dist/config/index.d.ts:13` with the exact two-arg signature claimed; `vitest@4.1.10` exists on the registry with peer `vite: ^6.0.0 || ^7.0.0 || ^8.0.0`; resolved `vite@7.3.6` satisfies it; all seven `eslint.config.js` line references correct; D-1/D-2/D-3 anchors correct (`src/actions/index.ts:25`, `add-plant-form.tsx:31`, `today-list.tsx:221`); archive no-clamping decision correct at `plan.md:125-126`. Brief↔plan ✓. Progress↔Phase ✓ (24 criteria bullets ↔ 24 Progress rows, format contract per `10x-plan/references/progress-format.md` clean).

Note: `package.json:67`'s top-level `"overrides": { "vite": "^7.3.2" }` is npm's field and does not appear in `pnpm-lock.yaml`'s `overrides:` block, so it is inert under pnpm. The plan's peer-compatibility *conclusion* still holds — Astro 6 resolves `vite@7.3.6` on its own — so this was not raised as a finding.

## Findings

### F1 — Phase 3 verification requires a PR the repo rules forbid creating

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 3 Manual Verification (3.3, 3.5), Phase 4 (4.3)
- **Detail**: Steps 3.3, 3.5 and 4.3 depend on a pull request existing. Current branch is `main`; AGENTS.md hard rule forbids creating a branch without an explicit ask, and the plan never requests it. The brief claimed Prerequisites: "None beyond the existing toolchain."
- **Fix**: Added a **Prerequisite — branch authorization** block to Phase 3 naming both paths (authorized PR branch, or accepted direct push to `main`), plus a **"What this phase does not buy: deployment gating"** note — there is no deploy job in `.github/workflows/`, so a red run does not block a deploy; prevention remains test-plan Phase 5's. Criterion 3.3 and Progress row 3.3 made path-agnostic. Brief's Prerequisites and Open Risks updated to match.
- **Decision**: FIXED — per user: fix accepted, with the added requirement that checks are expected to run on direct pushes to `main` as well (the repaired workflow's `push: main` trigger covers this).

### F2 — TZ=UTC default makes the DST regression guard inert in CI

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: End-State Alignment
- **Location**: Phase 1 §2 (vitest config), Phase 2 §2 and §3, Phase 3 contract
- **Detail**: `nextDue` (`src/lib/interval.ts:8`) is pure UTC epoch-day arithmetic, so Phase 2 §3's "DST spring-forward" assertion passes unconditionally. The only regression it guards — a rewrite onto local-time `Date` — would also pass under `TZ=UTC`, since UTC has no DST. The same blindfold covers `parseLocalDateString` (`date.ts:34`) and `formatShortDate` (`date.ts:40-42`), the only genuinely ambient-TZ-sensitive functions, and `parseLocalDateString` was assigned no assertion. Criterion 2.2 would catch this, but Phase 3's CI contract ran bare `pnpm test` only — so the shipped gate was blind to the exact regression class these cases exist to catch.
- **Fix A ⭐ Recommended**: Add a second non-UTC CI test step; give `parseLocalDateString` its own assertion.
  - Strength: One line in `ci.yml` promotes criterion 2.2 from a one-off local check to a permanent gate; the UTC leg still proves determinism.
  - Tradeoff: Suite runs twice — negligible (pure functions, no I/O).
  - Confidence: HIGH — TZ-sensitivity verified in source.
  - Blind spot: Whether Vitest's `test.env.TZ` reaches `Date`/`Intl` is unverified; a shell `TZ=` prefix sidesteps it (the plan now mandates the prefix).
- **Fix B**: Drop the config TZ default; set TZ per invocation. Rejected — bare `pnpm test` would inherit the developer's zone, giving up the determinism the plan deliberately bought.
- **Decision**: FIXED via Fix A. `TZ=America/New_York pnpm test` added to the Phase 3 workflow contract and to criterion 3.1; Phase 2 §2 gained a `parseLocalDateString` assertion; Phase 2 §3 now states the DST case only has teeth in the non-UTC leg (spring-forward date `2026-03-08` in that zone); Testing Strategy records that UTC is the weaker leg.

### F3 — Fixture's leap year (2028) diverges from the SQL script's (2024)

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: End-State Alignment
- **Location**: Phase 2 §1, criterion 2.6
- **Detail**: `supabase/tests/season-aware-intervals.sql:40-47` asserts 2024-02-29, 2024-03-01, 2024-10-31, 2024-11-01, 2024-12-15, 2025-02-28, 2025-03-01. Phase 2 §1 mandated "Feb 29 (leap year — use 2028)", guaranteeing criterion 2.6 would report mismatches on at least 2024-02-29 and 2024-12-15. Both rules are year-agnostic (TS reads only the month, `season.ts:17-18`; SQL rebuilds the range per year), so the year is semantically free — 2028 manufactured the divergence the fixture exists to remove.
- **Fix**: Fixture contract now enumerates all seven SQL dates verbatim plus five TS-only edges (`2024-02-27`, `2024-02-28`, `2024-10-30`, `2024-12-31`, `2025-01-01`), with an explicit "do not substitute a different leap year" note.
- **Decision**: FIXED

### F4 — Criterion 3.2 cannot fail: CI already shows as "active" today

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 3 Automated Verification, Progress 3.2
- **Detail**: `gh workflow list` already returns `CI  active  316209835` despite the dormant `master` trigger. The criterion passed before the change and after it — the same "gate that looks fine and never ran" failure mode Phase 3 exists to repair, reproduced in the phase's own verification.
- **Fix**: Replaced with `gh run list --workflow=ci.yml` reporting at least one run **and** `gh workflow view ci.yml --yaml` containing no `master`, with an inline note not to use `gh workflow list`. Progress row 3.2 retitled to match.
- **Decision**: FIXED

### F5 — Three fixture rows exercise a single code path

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 §1
- **Detail**: `getSeason` reads only the month, so 2024-02-27/28/29 are indistinguishable inputs and 2024-12-31 / 2025-01-01 both sit mid-dormancy. The rule's only decision edges are Feb→Mar and Oct→Nov. Row count was being presented as branch coverage the rule cannot exhibit.
- **Fix**: Fixture contract now requires the header comment to state the rule is month-granular today, so the intra-month rows read as a guard against a future day-level boundary rather than as distinct branches.
- **Decision**: FIXED

## What held up under verification

Every grounded claim in the plan checked out, including the ones easiest to get wrong: `getViteConfig`'s exact signature, `vitest@4.1.10`'s peer range against the resolved `vite@7.3.6`, all `eslint.config.js` line references, the flat-config ordering constraint (`reactConfig` at line 118 does match `**/*.ts`, so the override must follow `shadcnUiConfig`), and the three D-defect anchors. The `getMillisecondsUntilNextMidnight` "contract, not the search" framing is sound: 28 halvings of a 36 h window converge to sub-millisecond precision, so `now + result` / `now + result - 1ms` is a legitimate day-boundary assertion, and the 1000 ms floor case behaves as the plan describes.
