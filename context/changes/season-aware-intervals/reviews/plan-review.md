<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Season-Aware Intervals

- **Plan**: `context/changes/season-aware-intervals/plan.md`
- **Mode**: Deep
- **Date**: 2026-07-24
- **Verdict**: REVISE → SOUND after triage
- **Findings**: 1 critical, 4 warnings, 3 observations (all 8 fixed in the plan)

## Verdicts

| Dimension | Verdict | After fixes |
|-----------|---------|-------------|
| End-State Alignment | WARNING | PASS |
| Lean Execution | PASS | PASS |
| Architectural Fitness | PASS | PASS |
| Blind Spots | WARNING | PASS |
| Plan Completeness | FAIL | PASS |

## Grounding

9/9 existing paths ✓ (`src/lib/season.ts` and `supabase/tests/` are new, expected), 5/5 symbols ✓ (`mark_watered`, `nextDue`, `formatIntervalLabel`, `PlantListItem`, `interval_days`), brief↔plan ✓, Progress↔Phase contract ✓.

## Findings

### F1 — Phase 1 cannot pass its own type-check and build gates

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Completeness
- **Location**: Phase 1 §4 + Phase 1 Success Criteria (1.4–1.6)
- **Detail**: Phase 1 drops `plants.interval_days`, regenerates `database.types.ts`, and replaces the singular field in `PlantListItem`/`AddPlantInput`, but leaves every consumer to Phases 2–3: `authed-shell.astro:19,45`, `plants/index.astro:20,45,129`, `[id].astro:14,30,107`, `today-list.tsx:410,415`, `actions/index.ts:36,43,65`, `add-plant-form.tsx:20,38,49,161,191`. The typed Supabase `.select("… interval_days …")` calls alone fail `astro check`, so criteria 1.4–1.6 cannot go green — and Phase 1 ends with a mandated human-confirmation pause that assumes a green build. The same break persists through Phase 2 (gates 2.1–2.3).
- **Fix A ⭐ Recommended**: Fold the mechanical consumer sweep into Phase 1.
  - Strength: Every phase ends compiling and deployable, which the per-phase gate + pause structure already assumes; the sweep is mechanical.
  - Tradeoff: Phase 1 grows and briefly touches files Phase 3 revisits.
  - Confidence: HIGH — breakage verified by grep against current code.
  - Blind spot: Whether eslint's type-aware rules also fail (astro check alone is sufficient to block).
- **Fix B**: Keep `interval_days` through Phase 2, drop it in a Phase 3 migration.
  - Strength: Narrow per-phase diffs.
  - Tradeoff: Two migrations, three sources of truth, unanswered write-path question.
  - Confidence: MEDIUM — contradicts the plan's own single-authoritative-value posture.
  - Blind spot: Which value the legacy column holds while both exist.
- **Decision**: FIXED via Fix A — new Phase 1 §5 "Compile-level consumer sweep"; old §5 renumbered to §6.

### F2 — SQL verification script has no authentication story

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 1 §6 + Success Criterion 1.2
- **Detail**: `mark_watered` is `SECURITY DEFINER` and raises `28000` when `auth.uid()` is null (`20260723120000_add_postpone_and_undo.sql:36-40`). Criterion 1.2 runs the script as the `postgres` superuser via psql, where there is no JWT — every assertion fails before testing a single boundary, and the cross-account case would pass for the wrong reason.
- **Fix**: Specify the session-impersonation preamble — `set local role authenticated` plus `set local request.jwt.claims` per fixture user, reset to `postgres` for setup/teardown, and assert `P0002` (not `28000`) for the wrong-user call.
  - Strength: Makes the RLS/ownership assertions meaningful and matches production execution.
  - Tradeoff: Boilerplate around every RPC call.
  - Confidence: HIGH — read directly from the shipped function bodies.
  - Blind spot: Whether `set local role` interacts with the `FOR UPDATE` ownership path.
- **Decision**: FIXED — "Session impersonation" paragraph added to Phase 1 §6.

### F3 — Phase 3 promises no Worker-clock dates, then keeps one on the same line

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: End-State Alignment
- **Location**: Phase 3 Overview + Phase 3 §4
- **Detail**: `plants/index.astro:54` and `[id].astro:74` derive `today` from `todayLocalDateString()` at SSR — the Worker clock, UTC on Cloudflare — and feed it to `formatDueLabel` at `index.astro:129` / `[id].astro:108`. Adding a browser-local season label puts two disagreeing calendars on one line: at UTC+13 on the morning of March 1, "Growing · Every 7 days" beside "Due 28 Feb" — the exact boundary case criterion 3.6 asks a human to verify.
- **Fix A ⭐ Recommended**: Have the same enhancement own the due label too.
  - Strength: The client pass already computes the browser-local date; correcting the adjacent label is near-free and aligns the static surfaces with `today-list.tsx:241`.
  - Tradeoff: Widens the component's contract; SSR fallback must handle the due label.
  - Confidence: HIGH — verified at both call sites.
  - Blind spot: The no-JS "Due 28 Feb" fallback is never wrong, only never "Due today".
- **Fix B**: Narrow Phase 3's stated goal and document the mismatch.
  - Strength: Minimal diff; defers a pre-existing issue.
  - Tradeoff: Ships a known contradiction on the boundary days the feature exists to clarify.
  - Confidence: MEDIUM.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A — "One calendar authority per surface" paragraph added to Phase 3 §2.

### F4 — No-JavaScript fallback vs. layout shift is left unresolved

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 3 §2 + Performance Considerations
- **Detail**: The server cannot render an active-only label, so SSR must emit something the script then replaces on every row. The plan states both "meaningful no-JavaScript schedule information without asserting a potentially wrong active season" and "minimize layout shift" without resolving the tension — the one decision that determines how Phase 3 looks.
- **Fix A ⭐ Recommended**: Fix the slot, swap only the label — server renders the truthful pair in a fixed-height slot with both intervals as data attributes; the script replaces text, never the box.
  - Strength: Truthful without JS, zero reflow, one markup shape for both modes.
  - Tradeoff: Rows slightly taller; no-JS view denser.
  - Confidence: MEDIUM — Astro hoists/dedupes component `<script>` (precedent at `auth/signin.astro:34`), but density at 320px unverified.
  - Blind spot: How the pair reads beside the due label on narrow screens.
- **Fix B**: SSR best-guess active season, corrected on hydrate.
  - Strength: Zero shift where Worker and browser agree.
  - Tradeoff: Violates the plan's own constraint and is wrong on exactly the boundary days.
  - Confidence: LOW.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A — "Server fallback and shift budget" paragraph added to Phase 3 §2.

### F5 — Active-season label can misdescribe the outstanding due date

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: End-State Alignment
- **Location**: Phase 3 §3–§4 (label semantics)
- **Detail**: A plant watered Oct 25 on growing=7 is due Nov 1, when dormancy is active — the row would read "Dormancy · Every 30 days · Due today" while the due date came from the 7. `PRODUCT.md:43` makes this honesty load-bearing. Every plant is in this state for one cycle after each boundary.
- **Fix**: Define the label as the cadence applying from the next watering ("Dormancy · then every 30 days"), state the rule once in plant detail, and add a manual criterion for a due date created in the previous season.
  - Strength: Removes the ambiguity where it appears; keeps the exact due date unqualified.
  - Tradeoff: Slightly longer label on the densest surface.
  - Confidence: MEDIUM — the ambiguity is certain; the best phrasing is not.
  - Blind spot: Whether the wording survives 320px.
- **Decision**: FIXED — "What the interval number means" paragraph added to Phase 3 §4; new criterion + Progress row 3.9.

### F6 — Type-generation criterion has no runnable command

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 Success Criteria (1.3)
- **Detail**: The only automated criterion without a command; `package.json` has no type-gen script.
- **Fix**: State `pnpx supabase gen types typescript --local > src/lib/database.types.ts` plus `git diff --exit-code`.
- **Decision**: FIXED — command added to criterion 1.3.

### F7 — Plan never mentions the existing `src/lib/interval.ts`

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Current State Analysis; Phase 1 §3; Phase 2 §3
- **Detail**: Phase 2 says "reuse `nextDue`" without naming its module; `nextDue` lives at `src/lib/interval.ts:7`, absent from Current State Analysis. `lessons.md:5` exists because helpers were duplicated here before.
- **Fix**: Name `interval.ts` as `nextDue`'s home and state where season selection lives.
- **Decision**: FIXED — "Module placement" paragraph added to Phase 1 §3.

### F8 — PRD open question #2 resolved by this plan but not marked resolved

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: References / Migration Notes
- **Detail**: `context/foundation/prd.md:164` still lists the season-boundary question as open, owner: user, "Blocks correct interval selection once implemented."
- **Fix**: Add a Migration Note to record the decision at `prd.md:164` once Phase 1 lands.
- **Decision**: FIXED — Migration Note added.
