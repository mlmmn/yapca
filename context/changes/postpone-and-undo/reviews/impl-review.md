<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Postpone and Undo

- **Plan**: context/changes/postpone-and-undo/plan.md
- **Scope**: All phases (1–3 of 3)
- **Date**: 2026-07-23
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

Automated gates re-run during this review: `pnpm exec astro check` (0 errors), `pnpm lint` (clean), `pnpm build` (Cloudflare adapter, success). Generated `database.types.ts` contains `acted_on`, both event types, and all three RPC signatures. Migration reviewed by inspection (RLS preserved, ownership + row-lock + stale-event guard all present; direct insert/delete revoked; RPC execute granted to `authenticated` only).

## Findings

### F1 — Success notice shows raw ISO date instead of a formatted date

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/components/today-list/utils.ts:10
- **Detail**: `getSuccessMessage` interpolates `result.new_due_on` (a raw `YYYY-MM-DD` string) directly into the notice copy, so a user sees "Monstera marked watered · Next due 2026-07-25". Every other user-facing date in this feature is rendered through `formatShortDate` (e.g. "25 Jul") — the journal (`[id].astro:129,134,141`), the Today rows (`formatDueLabel`/`formatShortDate`), and the upcoming line. The design brief calls for "[exact date]" in the same visual language as the rest of the ledger, not the machine format. `getSuccessMessage` is the only user-facing string in the change that skips the shared formatter.
- **Fix**: In `getSuccessMessage`, format the date with `formatShortDate(dueDate)` from `@/lib/date` before interpolating (import it into `utils.ts`), so the notice matches the journal and Today list.
- **Decision**: FIXED — imported `formatShortDate` into `utils.ts` and formatted `dueDate` before interpolation.

### F2 — Pending Undo replaces the whole notice with a loading toast

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: src/components/today-list/today-list.tsx:182
- **Detail**: The design's "Pending Undo" section says to "disable only the selected notice's Undo action" and "keep the current list state", giving the control an accessible pending state "without replacing its label with an unexplained spinner". The implementation instead calls `toast.loading("Undoing <name>…", { id: noticeId })`, which swaps the entire success notice (its "marked watered · Next due …" copy and the Undo action) for a loading toast. It does keep the plant name and is not an *unexplained* spinner, so it satisfies the letter of that clause, but it drops the original notice content and the affordance rather than disabling just the action. Sonner's default action API has no per-action disabled state, so keeping the notice while disabling only the button would require a custom JSX toast — a real tradeoff, which is why this is an observation rather than a warning.
- **Fix**: If tighter design fidelity is wanted, render the notice as a custom `toast()` component whose Undo button carries a disabled/pending state instead of switching to `toast.loading`. Otherwise accept the current pragmatic behavior and note the deviation.
- **Decision**: SKIPPED — pragmatic loading-toast behavior accepted; deviation noted.

### F3 — Contextual focus always targets the Watered control, ignoring action kind

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/today-list/today-list.tsx:54
- **Detail**: After a keyboard-driven action, `focusNextAction` moves focus to `${nextPlant.id}:watered` regardless of whether the user pressed Watered or Postpone; the alternate-row fallback (line 65) and the undo-restore focus (line 211) do the same. The plan's UX spec says keyboard removal "advances to the equivalent next-row action". "Equivalent" reads as the same kind (postpone → next row's Postpone), so postponing via keyboard lands focus on the wrong control kind. The spec wording is mildly ambiguous and the primary action is a defensible default, so this is an observation.
- **Fix**: Pass the action `kind` into `focusNextAction` and target `${nextPlant.id}:${kind}` (falling back to `:watered` if that control is unavailable).
- **Decision**: FIXED — added `getRowButton(plantId, kind)` helper (kind-specific with `:watered` fallback); threaded `kind` through `focusNextAction` and the undo-restore focus.

### F4 — Leftover/inconsistent debug logging in markWatered

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/actions/index.ts:104
- **Detail**: `markWatered` logs the full RPC error (`code`, `message`, `details`) via a `no-console`-suppressed `console.error` labelled "debug RPC errors", but the sibling `postponePlant` and `undoWateringEvent` handlers — added in the same change and following the same error-mapping shape — do not log anything. The three RPC boundaries should handle errors uniformly; the lone debug line reads as leftover instrumentation. No security concern (server-side log only), purely a consistency nit.
- **Fix**: Either drop the debug `console.error` from `markWatered`, or apply the same logging consistently across all three RPC handlers.
- **Decision**: FIXED — added matching `console.error` debug lines to `postponePlant` and `undoWateringEvent` so all three RPC handlers log uniformly.
