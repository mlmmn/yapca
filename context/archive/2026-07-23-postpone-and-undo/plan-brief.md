# Postpone and Undo — Plan Brief

> Full plan: `context/changes/postpone-and-undo/plan.md`
> Design: `context/changes/postpone-and-undo/design.md`

## What & Why

Extend Today so a plant owner can postpone a watering task until exactly two browser-local calendar days after the action and undo an individual Watered or Postpone misclick for ten seconds. The feature keeps fast one-step actions trustworthy by making every committed schedule change journaled, exact, and reversibly tied to an immutable event.

## Starting Point

Watered already uses an optimistic, independently concurrent Today-list coordinator and an atomic `mark_watered` database function. The journal stores previous and resulting due dates, but it supports only Watered, returns no event ID to the client, and has no safe reversal operation; success notices and Postpone do not exist.

## Desired End State

Watered and Postpone remove a due row and update the count immediately, then show separate ten-second notices with exact authoritative dates. Undo targets one event, restores its stored previous due date only when that event still governs the plant, conditionally returns the row to Today, and removes the reversed event from the active journal.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| Postpone date | Browser-local action date + 2 days | Guarantees an overdue task leaves Today while keeping the fixed consequence exact | Plan |
| Undo identity | Immutable event ID | Keeps stacked and concurrent actions independently reversible | Design |
| Stale Undo | Reject without mutation | Prevents an older event from overwriting a newer schedule | Plan |
| Undo window | Client-enforced 10-second affordance | Keeps the interaction rule local without server clock coupling | Plan |
| Mutation security | Hardened `SECURITY DEFINER` RPC boundary | Prevents direct event writes from bypassing atomic schedule/journal invariants | Plan |
| Event date | Rename `watered_on` to `acted_on` | Gives Watered and Postpone one truthful non-null action date | Plan |
| Feedback | Extend Sonner with event-keyed custom actions | Reuses the established notice region while supporting independent pending/Retry state | Plan |
| Keyboard focus | Advance contextually after keyboard removal | Avoids focus loss without moving pointer users or focusing success feedback | Plan |
| Component conventions | Full alignment for every touched component | Satisfies current repository hard rules without a repository-wide refactor | Plan |
| Verification | Existing gates + local Supabase + manual matrix | Test infrastructure is not yet prepared and is explicitly outside this change | Plan |

## Scope

**In scope:**

- Watered/Postpone/Undo transactional RPCs, event IDs, row locking, stale-event protection, grants, and RLS
- Postpone 2 days in Today with shared optimistic removal, rollback, Retry, and per-plant pending state
- Independent ten-second success notices with Undo and notice-local failure/Retry
- Conditional Undo reinsertion, stable sorting, local-midnight handling, and contextual keyboard focus
- Watered/Postponed journal copy and removal of undone active-history events
- Full convention alignment for touched component modules
- Existing automated gates, local Supabase verification, and production-ready manual accessibility/responsive checks

**Out of scope:**

- Arbitrary postpone duration, Skip, future tasks, confirmation dialogs, or detail-page actions
- Persistent or indefinite Undo, activity tray, immutable audit UI, or cross-tab real-time sync
- New automated test framework, repository-wide cleanup, lint/format config, or CI repair

## Architecture / Approach

The database owns durable truth: privileged, explicitly authorized RPCs lock the plant, change its due date, and write or reverse one journal event atomically. The mounted Today island owns transient truth: per-plant optimistic removal and failure rollback plus per-event notices and server-confirmed Undo reconciliation. Sonner remains the shared feedback surface; the journal remains SSR-rendered active history.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Transactional Event Lifecycle | Generalized event schema, secure RPCs, typed Actions, deterministic reversal | Privileged-function ownership checks and stale-event correctness |
| 2. Today Actions and Independent Undo Notices | Postpone, optimistic count/list state, event-keyed Undo, responsive/a11y behavior | Concurrent state and timer/focus lifecycle |
| 3. Journal Representation and Acceptance Hardening | Event-aware journal and complete manual regression matrix | Unverified calendar, accessibility, or cross-account edge cases |

**Prerequisites:** S-01 core watering loop and S-02 plant journal are implemented; local Supabase/Docker is available for database verification.

**Estimated effort:** Approximately 3 implementation sessions across 3 phases, plus a focused manual acceptance pass.

## Open Risks & Assumptions

- The ten-second limit is intentionally a client affordance; the RPC does not reject a technically valid reversal solely because wall-clock time elapsed.
- Sonner's per-notice hover/focus/touch pause behavior must be verified and may require a small wrapper extension beyond configuration.
- No automated harness covers transactional concurrency, timers, dates, or accessibility, so manual evidence is load-bearing.
- Production rollback becomes data-sensitive after the first Postpone event because the old schema accepts only Watered.
- Existing CI uses `npm` despite the repository's `pnpm` hard rule; correcting it remains separate config debt.

## Success Criteria (Summary)

- Watered and Postpone feel immediate, return exact dates, and remain independently undoable without corrupting newer state.
- Schedule and active journal never diverge across success, failure, Retry, stale Undo, or cross-account attempts.
- The complete flow works at 320px and 200% zoom with keyboard, screen reader, dark mode, reduced motion, and local-midnight/calendar-boundary behavior verified.
