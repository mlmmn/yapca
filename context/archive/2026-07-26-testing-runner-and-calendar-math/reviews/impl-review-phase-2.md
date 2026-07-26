<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Test-runner bootstrap and calendar math — Phase 2

- **Plan**: `context/changes/testing-runner-and-calendar-math/plan.md`
- **Scope**: Phase 2 of 4 (Calendar, season, and timezone unit tests) — commit `a6233c2`
- **Date**: 2026-07-26
- **Verdict**: NEEDS ATTENTION
- **Findings**: 1 critical, 4 warnings, 6 observations (F11 raised by the maintainer
  during triage, not by the review sweep)

## Toolchain state

As reviewed (commit `a6233c2`):

| Command | Exit | Result |
|---|---|---|
| `pnpm test` | 0 | 5 files, 44 tests passed |
| `TZ=America/New_York pnpm test` | 0 | 5 files, 44 tests passed (same count — no silent skipping) |
| `pnpm lint` | 0 | No issues found |
| `pnpm build` | 0 | Complete |

After triage (all 10 findings fixed, plus F8/F9 revised on user direction; uncommitted):

| Command | Exit | Result |
|---|---|---|
| `pnpm test` | 0 | 5 files, 54 tests passed |
| `TZ=America/New_York pnpm test` | 0 | 5 files, 54 tests passed |
| `pnpm lint` | 0 | No issues found |
| `pnpm build` | 0 | Complete |
| Deliberate fixture break (criterion 2.7) | 1 | 1 failed, 46 passed — reverted clean |

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | FAIL |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

Overall is NEEDS ATTENTION rather than REJECTED: the critical finding is a test-efficacy
defect with a one-line fix, not a failing suite, a security issue, or data-safety risk.

## Findings

### F1 — The DST regression guard cannot fail; spring-forward is the wrong half of the year

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/lib/interval.test.ts:10-12`
- **Detail**: The row `["2026-03-08", 1, "2026-03-09"]` is commented as a regression guard
  against `nextDue` being rewritten onto local-time `Date` objects, "its failure requires
  the America/New_York test leg." Reproduced directly: implementing that naive rewrite
  (`parseLocalDateString` + `getTime() + n * 86_400_000`) and running it under
  `TZ=America/New_York` gives
  `2026-03-08 +1 => 2026-03-09` — **passes, bug undetected**, because a 23-hour day makes
  the ms-addition overshoot past the next local midnight onto the correct date.
  Only fall-back detects it: `2026-11-01 +1 => 2026-11-01` — **fails, bug detected**
  (a 25-hour day pulls the result back into the same calendar day).
  `2026-10-31 +1` also passes and is likewise inert.
  The row is therefore a no-op under both CI legs and for both the correct and the broken
  implementation. This defeats the plan's own principle #1 ("Every gate must be observed
  failing, not only passing") and mirrors the exact failure mode — a gate that looks fine
  and never fires — that this change exists to repair. The plan text itself named
  `2026-03-08`, so this is a plan defect faithfully implemented, not implementer drift.
- **Fix**: Replace `["2026-03-08", 1, "2026-03-09"]` with
  `["2026-11-01", 1, "2026-11-02"]` (the America/New_York fall-back date), and reword the
  comment to say fall-back specifically rather than "DST transition" generally. Optionally
  keep the spring-forward row alongside it, but only if the comment states it is
  illustrative rather than load-bearing.
  - Strength: Verified empirically in both directions — the replacement row fails against
    the naive rewrite and passes against the current epoch-day implementation.
  - Tradeoff: None; one table row and one comment.
  - Confidence: HIGH — reproduced with a standalone script, not inferred.
  - Blind spot: The correction should also land in `plan.md` §Phase 2 item 3 so a future
    re-read of the plan does not reintroduce the spring-forward date.
- **Decision**: FIXED

### F2 — `getTodayInTimeZone` used as its own oracle

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/lib/timezone.test.ts:33`
- **Detail**: `expect(getTodayInTimeZone(warsaw, justBefore)).toBe(getTodayInTimeZone(warsaw, now))`
  computes both sides with the function under test. A self-consistent breakage (e.g. a
  uniformly wrong zone offset) satisfies it. The sibling assertion on line 32 correctly
  compares against the hard-coded `nextDate`; this one should be grounded the same way.
- **Fix**: Add a third tuple element per table row holding the current zone-local day
  (`"2026-02-14"`, `"2026-03-29"`, `"2026-10-25"`) and assert `justBefore` against that
  literal.
- **Decision**: FIXED

### F3 — Epoch-day round-trip has no absolute anchor

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/lib/date.test.ts:15-19`
- **Detail**: The only `toEpochDay` / `fromEpochDay` coverage is
  `fromEpochDay(toEpochDay(x)) === x`. A shared sign or offset error in both functions
  cancels out and the assertion still passes. The plan's "epoch zero" case is present as a
  round-trip input (`1970-01-01`) but never as an absolute claim about the epoch.
- **Fix**: Add `expect(toEpochDay("1970-01-01")).toBe(0)` and
  `expect(fromEpochDay(0)).toBe("1970-01-01")` alongside the round-trips.
- **Decision**: FIXED

### F4 — One `now` reads the system clock

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `src/lib/timezone.test.ts:20`
- **Detail**: `getTodayInTimeZone("Not/AZone", new Date())` is the only call in the suite
  that does not inject an explicit instant, against the plan's "every case passes dates and
  `now` explicitly" rule and against the convention every other line in the file follows.
  Harmless today (the guard throws before `now` is read), but it is the one seam through
  which clock-dependence could re-enter.
- **Fix**: Pass a frozen instant, e.g. `new Date("2026-02-14T10:00:00.000Z")`.
- **Decision**: FIXED

### F5 — `getMillisecondsUntilNextMidnight` throw path untested

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/lib/timezone.ts:67-72`
- **Detail**: `timezone.ts` has two independent unsupported-zone `RangeError` guards. Only
  `getTodayInTimeZone`'s is exercised (`timezone.test.ts:20`). The untested one is the
  riskier of the pair: removing it sends the 36-hour binary search into the formatter with
  an invalid zone. The plan's contract said "`RangeError` on an unsupported zone" without
  naming which function, so this reads as an incomplete rather than skipped item.
- **Fix**: Add `expect(() => getMillisecondsUntilNextMidnight("Not/AZone", fixedNow)).toThrow(RangeError)`.
- **Decision**: FIXED

### F6 — `deltaDays` assertion re-derives the implementation's own subtraction

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/lib/schedule.test.ts:14-24`
- **Detail**: The table builds `newGrowingIntervalDays` as
  `baseInput.oldGrowingIntervalDays + deltaDays`, then asserts `result.deltaDays === deltaDays`
  — the implementation's subtraction run in reverse. That assertion can only fail if
  `selectSeasonInterval` picks the wrong pair, which the third test already covers
  independently. The `newNextDue` assertions use hard-coded dates and carry the test.
- **Fix**: Write literal interval values in the table (new interval, expected delta,
  expected date) so the delta assertion is independently grounded.
- **Decision**: FIXED

### F7 — Progress rows 2.5, 2.6 and 2.8 are evidenced in the diff but still unchecked

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: `context/changes/testing-runner-and-calendar-math/plan.md:683-686`
- **Detail**: Verified during this review: **2.5** no assertion references the 36-hour
  window or the 28 halvings (whole file read); **2.6** all seven dates asserted by
  `supabase/tests/season-aware-intervals.sql:40-47` appear verbatim in
  `season-boundaries.fixture.ts`, with five deliberate TS-only extras and no date present
  in only the SQL side; **2.8** the alias import is live at `season.test.ts:2`. Only
  **2.7** (break a fixture case, confirm red, revert) has no evidence in the diff and is
  genuinely pending. Leaving all four unchecked understates the phase's real state.
- **Fix**: Check 2.5, 2.6 and 2.8 with the `a6233c2` sha; perform 2.7 and check it, or
  leave 2.7 pending explicitly.
- **Decision**: FIXED — rows 2.5/2.6/2.8 were already checked on disk by the time triage
  reached this finding. Criterion 2.7 was then actually performed: flipping
  `2024-03-01` from `growing` to `dormancy` in the fixture produced
  `1 failed | 46 passed` at exit code **1**, and the revert restored a clean diff and
  exit 0. The checkbox is now evidence-backed rather than rubber-stamped.

### F8 — `describe` titles use three different conventions across five files

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `src/lib/date.test.ts:14`, `interval.test.ts:4`, `season.test.ts:5`, `schedule.test.ts:13`, `timezone.test.ts:6`
- **Detail**: `"date primitives"` (prose) / `"nextDue"` (function) / `"season"` (module) /
  `"resolveScheduleChange"` (function) / `"time zone resolution"` (prose). Since Phase 4
  documents this suite as the pattern newcomers copy (§6.1 cookbook), the inconsistency
  propagates. `it` titles, explicit `vitest` imports, and `it.each` table form are
  uniformly good across all five. `date.test.ts` covers nine exported functions under one
  flat `describe` and is the file most in need of nesting.
- **Fix**: Standardize on the module under test (`"date"`, `"interval"`, `"season"`,
  `"schedule"`, `"timezone"`) with a nested `describe` per function where a file covers
  several exports.
- **Decision**: FIXED, but **not** by the fix as written — the user rejected module-name
  wrappers as a pointless level that duplicates the filename. Standardized the other way:
  **sibling top-level `describe`s named after the function under test, no module wrapper**.
  Recorded as a recurring rule in `context/foundation/lessons.md` ("Name test describe
  blocks after the function under test, not the module").

  The reshape forced three `it` blocks apart that had each been straddling two functions,
  which the module wrapper had been concealing: the shared unsupported-zone throw in
  `timezone.test.ts`, `parseLocalDateString` + `formatShortDate` in `date.test.ts`, and
  `getSeasonLabel` + `getShortSeasonLabel` in `season.test.ts`. Each now fails under the
  name of the function that actually broke. Two blocks remain deliberately paired:
  `toEpochDay and fromEpochDay` (every assertion exercises both directions) and
  `isValidDateString re-export` (named for the re-export under test, since `date.test.ts`
  already owns the function itself).

### F9 — `*.fixture.ts` is a new file-suffix convention with no precedent and no documentation

- **Severity**: 📋 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Pattern Consistency
- **Location**: `src/lib/season-boundaries.fixture.ts`
- **Detail**: Functionally clean — kebab-case, `SEASON_BOUNDARIES` is a non-verb constant,
  excluded from `vitest.config.ts:13`'s `include` glob, not matched by the test-file ESLint
  override (so it runs under `strictTypeChecked`, verified passing in isolation), and
  imported only by `season.test.ts`, so it never enters a production entry graph. The
  concern is conventional: it is the only `.fixture.*` file in the repo, AGENTS.md says
  nothing about test-only modules, `tsconfig.json`'s `include: ["**/*"]` typechecks it as
  app code, and nothing structurally stops a future production module from importing and
  shipping it. Worth deciding while there is exactly one such file.
- **Fix A ⭐ Recommended**: Document the `*.fixture.ts` suffix in AGENTS.md as the project's
  test-data convention, and mention it in the Phase 4 §6.1 cookbook entry.
  - Strength: Zero code churn; Phase 4 already edits both documents, so it costs nothing
    extra, and the suffix stays co-located with the module it describes.
  - Tradeoff: Relies on a written rule rather than a structural boundary — a future import
    from production code is discouraged, not prevented.
  - Confidence: HIGH — matches how this repo records other conventions (kebab-case,
    one-folder-per-component) in AGENTS.md rather than enforcing them mechanically.
  - Blind spot: Have not checked whether a lint rule could cheaply enforce the boundary.
- **Fix B**: Move it to `src/lib/__fixtures__/` (or `src/test/`), a directory that reads
  unambiguously as non-shipping.
  - Strength: Structural rather than advisory; a production import becomes visibly wrong.
  - Tradeoff: Breaks the `@/lib/season-boundaries.fixture` alias import that criterion 2.8
    exists to cover, so `season.test.ts:2` must be updated in step; also introduces a
    directory naming style (`__fixtures__`) that is itself without precedent here.
  - Confidence: MEDIUM — the mechanical change is trivial, but it trades one unprecedented
    convention for another.
  - Blind spot: Whether Phase 4's §6.1 cookbook wording already assumes the current path.
- **Decision**: FIXED by neither option — **the fixture file is gone**. On review the user
  rejected both the suffix and the directory: the table has exactly one consumer and no
  expectation of a second, so it is now a module-level `SEASON_BOUNDARIES` constant inside
  `src/lib/season.test.ts`. This dissolves the finding rather than mitigating it — a
  test-local constant cannot be imported by production code, and living inside a
  `*.test.ts` file puts it under the test-file ESLint override rather than the strict
  config, which is the correct scope for test data. No AGENTS.md entry was needed.

  Two consequences, both handled:
  - **Criterion 2.8 lost its anchor.** The fixture's `@/`-aliased import was the suite's
    only exercise of the `vite-tsconfig-paths` wiring. `season.test.ts` now imports the
    module under test as `@/lib/season` instead of `./season`, carrying the same comment,
    so dropping the plugin still fails the suite loudly. Verified: 54 tests green on both
    TZ legs after the change.
  - **Test-plan Phase 2's reconciliation obligation is unchanged** but now requires
    lifting the table out of the test file first. A comment above the constant records
    this, and the plan's Phase 2 item 1 carries an INLINED note plus updated references in
    all five places (including Desired End State) so a re-read cannot reintroduce a
    separate fixture module.

### F10 — Residual coverage gaps

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/lib/date.test.ts:45-52`, `src/lib/interval.test.ts`, `src/lib/schedule.test.ts`
- **Detail**: Four gaps, none required by the plan's contract:
  (a) `compareDueRecords` is never tested for the tie case (same date **and** same name →
  `0`); only `>0` and `<0` are asserted, so a `localeCompare` swap plus a sign flip would
  survive. (b) `interval.ts:11` re-exports `isValidDateString` with no test, so an
  accidental removal surfaces only at call sites. (c) `nextDue` is untested at interval `0`
  and at negative intervals — the module has no guard, and `schedule.ts` relies on the
  permissive behaviour for negative deltas, so it is worth pinning. (d) `schedule.test.ts`
  has no test that an invalid `activeDay` propagates `getSeason`'s `RangeError`; `date` and
  `season` both cover their throw paths, making `schedule` the odd one out.
  Separately noted and **not** recommended: `TIME_ZONE_COOKIE`'s duplication in
  `layout.astro` is flagged in `timezone.ts:1-5` as the module's biggest drift risk but is
  untested — the plan's "What We're NOT Doing" calls that duplication a deliberate recorded
  trade-off, so pinning it belongs to a later change, not this one.
- **Fix**: Add the four assertions (a)–(d); leave the cookie invariant to a follow-up.
- **Decision**: FIXED

### F11 — `test` vs `it` was unenforced (raised by the maintainer, not by this review)

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `eslint.config.js` (test override block), all five `src/lib/*.test.ts`
- **Detail**: The suite used `it`; the maintainer prefers `test`. Nothing enforced either
  way, so the choice would have drifted as the suite grew — and Phase 4's §6.1 cookbook
  documents this suite as the pattern newcomers copy.
- **Fix**: Add `@vitest/eslint-plugin` as a devDependency, register it on the existing
  test-file override, and enable
  `"vitest/consistent-test-it": ["error", { fn: "test", withinDescribe: "test" }]`.
- **Decision**: FIXED at the maintainer's explicit request. Notes:
  - **`withinDescribe` is load-bearing.** It defaults to `"it"`; since every test here
    sits inside a `describe`, setting only `fn` would have enforced `it` — the opposite of
    the intent. Confirmed against the plugin docs before writing the config.
  - **The rule was observed failing.** Reintroducing `it` in `interval.test.ts` fails
    `pnpm lint` at exit **1**; the revert returns exit 0. Per the plan's principle #1, a
    gate that has only ever been seen passing proves nothing.
  - **34 violations autofixed** by `eslint --fix`, including the `import { it }`
    specifiers and every `it.each` → `test.each`. No hand edits were needed.
  - **This crosses a "What We're NOT Doing" line, deliberately.** That list forbade ESLint
    *relaxation* beyond three granted rules; this adds a restriction rather than removing
    one, and was requested directly. The authorization is recorded as an EXTENDED note in
    the plan's Phase 1 item 3. In-code documentation was drafted and then dropped by the
    maintainer — both an `AGENTS.md` Conventions entry and a rationale comment at the rule
    itself. The rule is enforced mechanically and autofixed by ESLint, so the prose was
    redundant; `eslint.config.js` carries the config line only.
