<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Edit Plant and Schedule Recalculation

- **Plan**: `context/changes/edit-plant-and-recalc/plan.md`
- **Mode**: Deep
- **Date**: 2026-07-25
- **Verdict**: REVISE
- **Findings**: 2 critical, 4 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | WARNING |
| Lean Execution | WARNING |
| Architectural Fitness | WARNING |
| Blind Spots | PASS |
| Plan Completeness | FAIL |

## Grounding

8/8 paths ✓, 12/12 symbols ✓, brief↔plan ✓, Progress↔Phase contract ✓ (5+8 / 4+9 / 4+11 rows, all matched to
Success Criteria bullets; one `## Progress` heading at the bottom; no stray checkboxes in phase bodies).
Two Current-State claims are contradicted by the code — see F3 and F6.

The core architecture is sound. The CAS design was traced under concurrent-watering, concurrent-edit, and
coincidental-value scenarios: computing `deltaDays` from the freshly read row while guarding on the page-load
`updated_at` token is consistent in every case, and scoping the guard to schedule writes does exactly what the
plan claims. The findings below concern the plan's edges, not its spine.

## Findings

### F1 — src/lib/photo.ts mixes client constants with a server-only resolver

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architectural Fitness
- **Location**: Phase 1 §1 — Shared photo module
- **Detail**: The module's contract bundles four client-consumed values (byte ceiling, MIME map, guidance copy,
  `File` predicate) with a server-only "single-path signed-URL resolver". Both `add-plant-form.tsx`
  (`client:load`, per `src/pages/plants/new.astro:17`) and the new edit island will import the constants. A
  resolver written the natural way — mirroring `src/pages/plants/[id].astro:24`'s loader and calling
  `createClient(headers, cookies)` — pulls `@/lib/supabase`, which imports `astro:env/server` at
  `src/lib/supabase.ts:3`. That virtual module is not available in a client bundle, so the island build fails.
  The plan never states the constraint.
- **Fix A ⭐ Recommended**: Keep `photo.ts` isomorphic — the resolver takes an already-created client as a
  parameter, with `import type { SupabaseClient }` only.
  - Strength: One module, no new file; the type import is erased at build so nothing server-only enters the
    client graph. Call sites already hold a client (`[id].astro:24`).
  - Tradeoff: The constraint is invisible in the code — one careless `import { createClient }` later
    reintroduces the break.
  - Confidence: HIGH — `src/lib/supabase.ts:3` imports `astro:env/server` directly.
  - Blind spot: Not confirmed whether Vite would tree-shake it away before Astro's client-import guard fires.
- **Fix B**: Split into `src/lib/photo.ts` (isomorphic constants + predicate) and a separate server-only
  resolver module.
  - Strength: The boundary is structural, not a comment; impossible to regress by accident.
  - Tradeoff: A second lib module for one function; the plan's "one home for photo values" framing weakens.
  - Confidence: HIGH — same evidence.
  - Blind spot: Naming/placement not covered by any existing convention.
- **Decision**: Fixed via Fix A (isomorphic `photo.ts`; resolver takes a client parameter, type-only Supabase import)

### F2 — Phase 1 gates on manual verification Phase 1 makes impossible

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 Success Criteria / Progress 1.8–1.13
- **Detail**: Phase 1's Overview states "Nothing is user-visible at the end of this phase." Yet six of its
  eight manual rows require exercising `updatePlant` end to end: interval delta (1.8), name-only save (1.9),
  inactive-season save (1.10), conflict via a second tab (1.11, 1.12), photo replace and orphan check (1.13).
  No route, form, or entry point exists until Phase 2. Invoking the action means hand-posting multipart
  `FormData` to `/_actions/updatePlant` with a session cookie — nowhere documented. The phase closes with
  "pause for manual confirmation before proceeding", so the implementer either stalls or ticks rows they never
  ran. Rows 1.6 and 1.7 (add-plant and detail-photo regression checks) are genuinely runnable and should stay.
- **Fix**: Move rows 1.8–1.13 into Phase 2's manual set, where the form that exercises them exists. Phase 1
  keeps 1.1–1.7.
- **Decision**: Fixed (manual rows moved to Phase 2 as 2.15–2.20; Phase 1 keeps 1.1–1.8)

### F3 — The cited `error.code` precedent does not exist in the codebase

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Completeness
- **Location**: Key Discoveries; Phase 3 §1
- **Detail**: Key Discoveries claims "`today-list.tsx:139-142,179-182` rethrows the `ActionError`, so
  `CONFLICT` can be distinguished ... the pattern `undoWateringEvent` already relies on." Both blocks are bare
  `catch { }` (`today-list.tsx:150, 190`) — they discard the error and show a generic failure.
  `grep -rn "error\.code" src/components src/pages` returns nothing; `ActionError` is imported nowhere outside
  `src/actions`. `undoWateringEvent` throws `CONFLICT` server-side, but no client reads it. The mechanism
  itself is real (Astro deserializes into a client-side `ActionError` carrying `code`), so Phase 3's conflict
  UX is achievable — but it is a first in this repo, not a pattern to copy, and the plan presents it as settled.
- **Fix**: Correct the discovery to say no island reads `code` today, and give Phase 3 the shape explicitly:
  read `code` off the resolved `{ error }` (`error.code === "CONFLICT"`), with a bare `catch` for the
  network-rejection path documented at `add-plant-form.tsx:77-83`.
- **Decision**: Fixed (Key Discoveries corrected; Phase 3 §1 now specifies the `error.code` shape explicitly)

### F4 — Automated criterion 1.4 cannot pass as written

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 Automated Verification / Progress 1.4
- **Detail**: `grep -rn "4 \* 1024 \* 1024\|image/webp" src/` is specified to return only `src/lib/photo.ts`.
  It also matches `add-plant-form.tsx:303` — `accept="image/jpeg,image/png,image/webp"` — which "What We're NOT
  Doing" explicitly protects from refactoring, and the new edit form will add the same attribute. The check
  fails by construction.
- **Fix**: Export an `accept` string from `photo.ts` derived from the MIME map (which also satisfies the
  module's own "derive, don't re-list" contract) and have both forms consume it; otherwise narrow the grep to
  the constant declarations only.
- **Decision**: Fixed (derived `accept` string exported from `photo.ts`, consumed by both forms)

### F5 — The signed-URL TTL de-duplication nets zero copies

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Lean Execution
- **Location**: Current State Analysis table; Phase 1 §5; What We're NOT Doing
- **Detail**: Current State names the TTL as one of "three duplications this slice would otherwise compound" —
  `authed-shell.astro:8`, `plants/index.astro:9`, `[id].astro:10`. The plan adds a fourth definition in
  `photo.ts`, removes one, and rules the two batch sites out of scope: three copies before, three after.
  Criterion 1.5 codifies the non-improvement as a pass. Repointing the batch sites at the shared *constant* is
  one import line each and touches neither `createSignedUrls` call.
- **Fix**: Import `SIGNED_URL_TTL_SECONDS` from `photo.ts` in `authed-shell.astro` and `plants/index.astro`,
  leaving their batch call shape untouched; restate 1.5 as "`photo.ts` is the only definition".
- **Decision**: Fixed (both batch sites import the shared TTL constant; criterion restated as “only definition”)

### F6 — "The saved detail page shows the overdue treatment" is false

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Testing Strategy step 4; Progress 3.15
- **Detail**: Overdue treatment exists only in `today-list.tsx:345-394` (warning tokens, the non-color marker,
  `Overdue · Due …` copy). The detail page renders `SeasonIntervalSummary`, whose `formatDueLabel`
  (`src/lib/date.ts:44`) yields plain "Due 4 Jul" with no overdue cue at any date. An implementer following
  step 4 either fails the check or builds overdue styling into the detail page — scope this slice never granted.
- **Fix**: Reword step 4 / row 3.15 to verify the exact shifted date on the detail page, and the overdue
  treatment on the Today list where the plant now appears.
- **Decision**: Fixed (step 4 and row 3.15 now check the shifted date on detail, the overdue cue on Today)

### F7 — Two design.md §7 promises have no backing plan text

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: End-State Alignment
- **Location**: Phase 2 §3 (preview copy); Phase 3 §1 (submitting state)
- **Detail**: (a) `design.md:215` — "`Save changes` is enabled only when the form is valid and not submitting."
  The plan specifies only the submitting state, and `add-plant-form.tsx:316` disables on submit alone, so the
  inherited behavior misses half the requirement. (b) `design.md:232` — the inactive-interval preview should
  "identify that the inactive season changed". The plan's `deltaDays === 0` branch reuses one string across
  name/photo-only and inactive-season edits, and says so deliberately; that string never names the inactive
  change.
- **Fix**: Add the enabled-when-valid rule to Phase 2's contract, and either split the `deltaDays === 0` copy
  into two cases or record the shared string as a deliberate deviation in Open Risks.
- **Decision**: Fixed (enabled-when-valid added to Phase 2 §3; `deltaDays === 0` copy split into two cases)
