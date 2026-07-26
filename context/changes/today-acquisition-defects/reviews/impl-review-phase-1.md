<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Today Acquisition Defects

- **Plan**: context/changes/today-acquisition-defects/plan.md
- **Scope**: Phase 1 of 3 — Canonical Browser-Date Contracts
- **Date**: 2026-07-26
- **Verdict**: APPROVED (was NEEDS ATTENTION; all 4 findings triaged and resolved)
- **Findings**: 0 critical, 2 warnings, 2 observations — 2 fixed, 2 no change needed

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS (WARNING at review time; F1 and F2 fixed in triage) |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Automated verification

| Criterion | Command | Exit | Result |
|---|---|---|---|
| 1.1 Date and timezone unit tests | `pnpm test -- src/lib/date.test.ts src/lib/timezone.test.ts` | 0 | 73 passed |
| 1.2 Full suite in UTC | `pnpm test` | 0 | 5 files, 73 passed |
| 1.3 Full suite in non-UTC zone | `TZ=America/New_York pnpm test` | 0 | 5 files, 73 passed |
| 1.4 Type checking | `pnpm check` | 0 | 0 errors, 0 warnings, 10 hints (pre-existing) |
| 1.5 Linting | `pnpm lint` | 0 | clean |

Phase 1 declares no manual criteria, so there is no rubber-stamping risk in the Progress block.

## Scope

Files changed under `src/` match the Phase 1 plan list exactly — `src/lib/date.ts`, `src/lib/date.test.ts`,
`src/lib/timezone.ts`, `src/lib/timezone.test.ts`, `src/components/hooks/use-browser-today.ts`. No Phase 2
or Phase 3 file was touched. No unplanned source file appears in the diff.

## Findings

### F1 — SSR seed is discarded when first browser acquisition fails

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/lib/timezone.ts:116, src/components/hooks/use-browser-today.ts:8
- **Detail**: `subscribeToBrowserToday` initialises its closure-local `previousToday` to `null` and never
  receives the consumer's known day. `useBrowserToday` seeds React state from `initialToday`, but the
  subscription's first `refreshToday()` runs `callback(getNextBrowserToday(null, acquired))`. When
  acquisition fails, `acquired` is `null`, so the callback fires with `null` and overwrites the SSR seed.
  Plan §5 requires "The initial render preserves the SSR seed", and Plan §4 names exactly this case —
  "the previously known day must not silently revert to `null`". The reducer already implements the
  protection and `src/lib/timezone.test.ts:24-27` asserts it, but the protective branch is unreachable on
  first emit because the seed never crosses the boundary. The guarded regression is testable and untriggered
  rather than actually prevented.
- **Fix**: Give `subscribeToBrowserToday` an `initialToday: string | null = null` parameter that initialises
  `previousToday`, and have `useBrowserToday` pass its `initialToday` through in the effect.
  - Strength: Makes the existing reducer test meaningful at the only boundary that matters, and removes a
    silent Phase 2 degradation where Today would drop to "Finding your local date…" despite a usable seed.
  - Tradeoff: Adds an argument to the subscription; the effect must list `initialToday` in its deps or
    deliberately capture the mount-time value.
  - Confidence: HIGH — the reducer and its test already encode the intended behaviour; only the wiring is absent.
  - Blind spot: Phase 2's Astro summary enhancer will need the same seed passed from its data attribute; not
    yet written, so unverified.
- **Decision**: FIXED — `subscribeToBrowserToday` gained an `initialToday: string | null = null` parameter
  initialising `previousToday`; `useBrowserToday` passes its seed through with `initialToday` in the effect
  deps. The default keeps the two-arg call optional for Phase 2's Astro enhancer.

### F2 — Rollover pure seam is a pass-through; the reschedule step stays untestable

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: src/lib/timezone.ts:107-109, src/lib/timezone.ts:126-133, src/lib/timezone.test.ts:78-86
- **Detail**: Plan §3 requires a rollover-delay calculator over `(timeZone, now)` "wrapping the existing
  `getMillisecondsUntilNextMidnight`, **including the reschedule-from-newly-observed-day step**", because
  "otherwise the Node runner cannot reach the riskiest code in this change". `getBrowserRolloverDelay` is a
  verbatim one-line delegation that adds no behaviour, and the reschedule step actually lives in
  `scheduleRollover()`, which calls `new Date()` and `Intl.DateTimeFormat().resolvedOptions()` internally —
  impure and unreachable from the Node runner. The test named "reschedules from the newly observed day rather
  than the original seed" only calls the pure function twice with different `now` values; it would pass
  identically against `getMillisecondsUntilNextMidnight` and asserts nothing about rescheduling. The change's
  highest-risk logic therefore remains manual-only coverage while reading as covered.
- **Fix A ⭐ Recommended**: Make the seam a pure next-timer calculator over explicit inputs — e.g.
  `getBrowserRolloverDelay(timeZone, now, previousToday)` returning the delay computed from the observed
  instant — and reduce `scheduleRollover` to reading the clock and calling it. Retarget the test to assert the
  chained case: feed the scheduled instant back in and assert the second delay is computed from the new day,
  not the seed.
  - Strength: Converts the actual reschedule decision to Node-testable code, which is the stated purpose of the
    seam; keeps the impure wrapper to two statements.
  - Tradeoff: Slightly wider signature than the plan text implies; needs the test rewritten, not just extended.
  - Confidence: MEDIUM — the shape is clear, but "chained reschedule" has more than one reasonable encoding.
  - Blind spot: Have not confirmed whether Phase 2's Astro enhancer will want the same calculator or its own.
- **Fix B**: Keep the pass-through and instead rename it plus retarget the test to state honestly that it
  covers delay calculation only, recording the reschedule loop as manual coverage debt in Phase 3's test-plan
  update.
  - Strength: No production code churn; the Phase 3 test-plan reconciliation already exists to record debt.
  - Tradeoff: Accepts that the riskiest logic in the change ships with zero automated coverage, which is the
    outcome Plan §3 was written to prevent.
  - Confidence: MEDIUM — honest, but it trades away a plan commitment rather than meeting it.
  - Blind spot: Phase 3 wording is not yet drafted, so the debt may not actually get recorded.
- **Decision**: FIXED via Fix A — `getBrowserRolloverDelay` replaced by pure `getBrowserRolloverState(timeZone,
  now): { today, delay }`, deriving the observed day and its delay from one instant. `subscribeToBrowserToday`
  reduces to wiring over a single `acquireBrowserRollover()` impure boundary; `emitToday`/`scheduleRollover`
  removed. The test now chains two ticks and pins each delay to the boundary itself — verified by deliberate
  break (a fixed 24 h reschedule fails the test; previously it would have passed).

### F3 — Unreachable-false guard in getBrowserToday

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/timezone.ts:96-105
- **Detail**: `getBrowserToday` calls `getTodayInTimeZone(timeZone)` first and only then evaluates
  `isSupportedTimeZone(timeZone)` in the return expression. `getTodayInTimeZone` throws `RangeError` for
  precisely the zones `isSupportedTimeZone` rejects, so the ternary's false branch can never be taken — the
  throw reaches the `catch` first. Net behaviour is correct, but the line reads as a live guard while doing a
  redundant formatter lookup, and it inverts AGENTS.md's guard-clause-first ordering.
- **Fix**: Hoist the check to a guard clause — `if (!isSupportedTimeZone(timeZone)) return null;` — then return
  `getTodayInTimeZone(timeZone)`, keeping the `try/catch` for `Intl` resolution failure.
- **Decision**: NO CHANGE NEEDED — eliminated by F2's restructure. `getBrowserTimeZone` applies
  `isSupportedTimeZone` before any formatting, and `getBrowserToday` early-returns on a null zone.

### F4 — Time zone resolved twice per refresh

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/timezone.ts:120, src/lib/timezone.ts:127
- **Detail**: Each `refreshToday()` resolves the IANA zone independently twice — once inside
  `getBrowserToday()` for the emitted day, once inside `scheduleRollover()` for the delay. If the OS zone
  changes between the two calls, the scheduled midnight belongs to a different zone than the day just emitted.
  The window is tiny and self-corrects at the next `pageshow` or visibility recovery, but the duplication is
  avoidable and both `pageshow` and `visibilitychange` firing on a bfcache restore doubles the binary-search
  work.
- **Fix**: Resolve the zone once per refresh and pass it to both the acquisition and the delay calculation.
  Natural to fold into whichever option is chosen for F2.
- **Decision**: NO CHANGE NEEDED — eliminated by F2's restructure. `refreshToday` calls
  `acquireBrowserRollover()` once, which resolves the zone once and derives the emitted day and the scheduled
  midnight from a single `new Date()`.

## Post-triage verification

| Command | Exit | Result |
|---|---|---|
| `pnpm test` | 0 | 5 files, 73 passed |
| `TZ=America/New_York pnpm test` | 0 | 5 files, 73 passed |
| `pnpm check` | 0 | 0 errors, 0 warnings |
| `pnpm lint` | 0 | clean |

Deliberate-break check: replacing the computed delay with a fixed 24 h value fails
`getBrowserRolloverState > reschedules from the newly observed day rather than the original seed`, confirming
the retargeted test constrains the behaviour it names. Source restored after the check.

All four findings are resolved; Phase 1 verdict moves to APPROVED.
