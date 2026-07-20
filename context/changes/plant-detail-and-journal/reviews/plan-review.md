<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Plant Detail View + Watering Journal

- **Plan**: context/changes/plant-detail-and-journal/plan.md
- **Mode**: Deep
- **Date**: 2026-07-20
- **Verdict**: SOUND
- **Findings**: 0 critical, 2 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | WARNING |

## Grounding

11/11 file paths verified ✓. Core claims verified against code: `markWatered` select-then-update (index.ts:92–113), `nextDue` epoch-day math (interval.ts:34), today-list ignores RPC payload (today-list.tsx:96–99), middleware `startsWith` gating (middleware.ts:19), route precedence with Astro static-first routing. Brief ↔ plan alignment ✓.

## Findings

### F1 — RPC 'not found' error has no distinguishable signal

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots / Plan Completeness
- **Location**: Phase 1 §2 (RPC) and §3 (action rewire)
- **Detail**: The action contract requires mapping an RPC error to `ActionError NOT_FOUND`, but the RPC contract only says "if not found, raise exception" — a bare raise surfaces as a generic PostgrestError with SQLSTATE P0001 (unspecified plpgsql error). Without a dedicated errcode, the implementer will likely string-match the message, which is brittle.
- **Fix**: RPC raises with explicit errcode — `raise exception 'Plant not found' using errcode = 'no_data_found';` (SQLSTATE `02000`) — and the action matches on `error.code === "02000"`, not message text. Specify both in the phase contract.
- **Decision**: FIXED

### F2 — Phase 1 body heading doesn't match Progress heading

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Line 59 vs line 263
- **Detail**: Body heading reads `## Phase 1: Journal data model + journaled \`markWatered\`` (with backticks); Progress heading reads `### Phase 1: Journal data model + journaled markWatered` (without). The names must be byte-identical for `/10x-implement` to pair them correctly.
- **Fix**: Remove backticks from the body heading (line 59).
- **Decision**: FIXED

### F3 — RPC contract leaves user_id source and search_path implicit

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness / Blind Spots
- **Location**: Phase 1 §2 (RPC body)
- **Detail**: The `insert into watering_events (...)` omits where `user_id` comes from — should be `auth.uid()` to satisfy the insert RLS `with check`. The function doesn't pin `search_path`; existing precedent (trigger) omits it, but a security-sensitive `SECURITY INVOKER` function should add `set search_path = ''` to silence the Supabase linter and remove any object-name resolution ambiguity.
- **Fix**: State the full `insert` with `user_id = auth.uid()`, and add `set search_path = ''` with schema-qualified refs (`public.plants`, `public.watering_events`, `auth.uid()`).
- **Decision**: FIXED

## Summary

All three findings are LOW-impact polish. No rework needed.

**What changed in plan.md:**
1. F1: Phase 1 §2 RPC now raises `'Plant not found' using errcode = 'no_data_found'` (SQLSTATE `02000`); §3 action maps `error.code === "02000"` → `NOT_FOUND`.
2. F2: Phase 1 heading (line 59) backticks removed; now byte-identical to Progress heading.
3. F3: RPC contract now specifies `user_id = auth.uid()` on insert and adds `set search_path = ''` with schema-qualified refs.

Plan is **SOUND** and ready for `/10x-implement`.
