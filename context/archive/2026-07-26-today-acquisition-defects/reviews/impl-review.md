<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Today Acquisition Defects

- **Plan**: `context/changes/today-acquisition-defects/plan.md`
- **Scope**: Phases 1–3 of 3
- **Date**: 2026-07-26
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 2 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | WARNING |

## Findings

### F1 — Undo can classify a restored plant using yesterday

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/components/today-list/today-list.tsx:102`
- **Detail**: The 10-second Undo toast captures the render's `handleUndo`, and that function closes over the same render's `today`. If Watered completes just before local midnight and Undo completes just after it, `restored_due_on` is compared with yesterday at lines 222–223. A plant due on the new day can therefore remain absent from Today until another state repair or reload, even though the database undo succeeded.
- **Fix**: Keep the latest hook date in a stable ref and compare `restored_due_on` with that ref when Undo completes; cover the before-midnight/after-midnight path in the existing manual workerd matrix.
- **Decision**: FIXED — the latest browser day is held in a stable ref and read when Undo completes, preventing the toast callback from classifying against its original render day.

### F2 — Runtime manual checks have no durable execution evidence

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Success Criteria
- **Location**: `context/changes/today-acquisition-defects/plan.md:387`
- **Detail**: Progress marks workerd criteria 3.4–3.6 complete, but commit `439d5bc` only checks the boxes and changes documentation/test fixtures. No saved verification log records the tested browser zones, cookie state, persisted rows, or observed results. The phase-2 review says criteria 2.6, 2.7, 2.9, and 2.13 needed re-checking after its fixes; the Phase 3 checkbox commit asserts that re-check without leaving observable evidence. The checks may have been performed, but the repository cannot substantiate the runtime boundary that the test plan explicitly treats as manual coverage.
- **Fix**: Add a concise workerd verification record with environment, scenarios, observed dates, mutation/database results, and pass/fail outcomes.
  - Strength: Makes the claimed runtime coverage auditable and directly closes the evidence gap identified by the test plan.
  - Tradeoff: Requires reproducing or reconstructing the manual matrix rather than relying on the checked Progress rows.
  - Confidence: HIGH — the reviewed commits and change artifacts contain no equivalent execution record.
  - Blind spot: The checks may have been completed correctly outside the repository.
- **Decision**: SKIPPED

### F3 — Plan still describes the superseded rejection protocol

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `context/changes/today-acquisition-defects/plan.md:155`
- **Detail**: Phase 2 still requires `BAD_REQUEST` plus an exact message match and says to remove `getActionDate`. The accepted Phase 2 review deliberately replaced that protocol with the safer dedicated `PRECONDITION_FAILED` marker and retained the helper name. Current code matches the accepted decision and the behavioral intent, but the plan remains stale at lines 155 and 159.
- **Fix**: Add a decision addendum that records the accepted dedicated error code and retained helper name without rewriting the original implementation history.
- **Decision**: FIXED — added a dated implementation decision addendum documenting the dedicated rejection code, shared predicate, and retained validation-helper name.

### F4 — Two justified fixture changes remain outside planned files

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: `supabase/seed.sql:7`
- **Detail**: `supabase/seed.sql` replaces local fixture IDs with valid UUIDv4 values so strict Action validation can exercise the manual matrix, and `supabase/tests/season-aware-intervals.sql:15` gives its auth fixtures unique emails so the required SQL check runs against a seeded database. Both changes are narrow, safe, and explained by implementation discoveries, but neither file appears in the plan's Changes Required list; the testing strategy also says the SQL suite remains unchanged.
- **Fix**: Record both fixture-only deviations in a plan decision addendum so the changed-file scope and rationale are explicit.
- **Decision**: FIXED — documented both fixture-only deviations and their safety boundaries in the implementation decision addendum.

## Success Criteria Evidence

All automated commands required by the three reviewed phases passed against the final tree:

| Command | Result |
|---------|--------|
| `pnpm test -- src/lib/date.test.ts src/lib/timezone.test.ts` | PASS — 5 files, 73 tests |
| `pnpm test` | PASS — 5 files, 73 tests |
| `TZ=America/New_York pnpm test` | PASS — 5 files, 73 tests |
| `pnpm check` | PASS — 0 errors, 10 pre-existing hints |
| `pnpm lint` | PASS |
| `pnpm build` | PASS — Cloudflare server build complete |
| `pnpm exec astro sync && pnpm lint && pnpm check && pnpm test && TZ=America/New_York pnpm test && pnpm build` | PASS |
| `pnpm exec prettier --check context/foundation/test-plan.md context/deployment/deployment-plan.md README.md` | PASS |
| `psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -f supabase/tests/season-aware-intervals.sql` | PASS — transaction rolled back |

Manual criteria 2.6–2.13 and 3.4–3.8 are checked. The final code and documentation provide observable support for the intended behavior, and documentation criteria 3.7–3.8 are directly evidenced by their diffs. Finding F2 records the missing durable execution evidence for workerd/runtime criteria 3.4–3.6.

## Review Notes

- Planned behavior matches the final implementation across browser-date acquisition, lifecycle cleanup, all four dated mutations, null-date gating, relative metadata enhancement, middleware/local retirement, and documentation reconciliation.
- The Phase 1 and Phase 2 review fixes remain present.
- Security/auth boundaries, data safety, resource cleanup, performance, architecture, naming, component structure, and recorded project lessons are otherwise compliant.
- No migration, RLS, RPC signature, generated type, browser-runner, SPA, deployment automation, or production-deployment scope was introduced.

## Triage Outcome

- **Fixed**: F1, F3, F4
- **Skipped**: F2
- **Pending**: None
