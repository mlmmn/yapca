# Plant Detail View + Watering Journal — Plan Brief

> Full plan: `context/changes/plant-detail-and-journal/plan.md`

## What & Why

Deliver roadmap slice **S-02** (FR-005, FR-014): let a signed-in user open any of their plants and see its details plus a **watering journal** — the recorded history of watering actions. The journal is load-bearing: the roadmap sequences it before undo (S-04) because undo reverses journaled actions, so the history must exist and be reversible-by-design first.

## Starting Point

The core watering loop (S-01) works: users add plants and mark them watered from a "Today" list. But `markWatered` only overwrites `plants.next_due_on` — **no history is kept**. There is no detail route, and the home shows only due/overdue plants with non-clickable rows, so a plant not due today can't be opened at all. `/plants` is already gated by middleware.

## Desired End State

A user can open a plant (from a today-list row or a new "All plants" page) and see its name, photo, interval, due status, and a newest-first watering journal. Each "Watered" now writes a journal entry atomically, so opening the plant afterward shows the reschedule it produced. Plants with no history show a clear empty state; unknown/other-user ids return 404.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Journal storage | New `watering_events` table + RLS | Clean append-only history matching the codebase's relational grain; extends to Postpone later | Plan |
| Event fields | before + after due dates (`watered_on`, `prev_due_on`, `new_due_on`) | Lets undo (S-04) restore state deterministically without recomputation | Plan |
| Write atomicity | Postgres `mark_watered` RPC (single transaction) | Plant due date and journal can never diverge, honoring the determinism guardrail | Plan |
| Event scope | Watered events only; no backfill | Matches FR-014 + PRD Non-Goals; no fabricated history | Plan |
| Detail page | Read-only detail + journal | Keeps slice to FR-005/FR-014; edit/delete stay in S-06/S-07 | Plan |
| Navigation | Link today rows **and** add "All plants" view | FR-005 requires reaching plants not due today | Plan |

## Scope

**In scope:** `watering_events` table + RLS; atomic `mark_watered` RPC; rewired `markWatered` action; read-only `/plants/[id]` detail page with journal; `/plants` All-plants collection page; today-row + header navigation.

**Out of scope:** edit (S-06), delete (S-07), undo (S-04), Postpone (S-04), overdue urgency (S-03), a Mark-Watered action on the detail page, any backfill of existing plants.

## Architecture / Approach

Migration adds `watering_events` (RLS per-op, `on delete cascade` from `plants`) and a `SECURITY INVOKER` `mark_watered(plant_id, watered_on)` function that reads the current due date into `prev_due_on`, reschedules the plant, inserts the event, and returns the new due date — all in one transaction. The `markWatered` action calls the RPC (same return shape, so `today-list.tsx` is untouched). Two read-only SSR pages (detail + All plants) load data server-side with signed photo URLs, mirroring `index.astro`; the journal is static so no React island is needed.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Data model + journaled markWatered | `watering_events` table, `mark_watered` RPC, rewired action, regenerated types | RPC atomicity/RLS correctness; preserving determinism |
| 2. Plant detail page (SSR) | Read-only `/plants/[id]` with details + journal + 404 path | Not-found handled as 404 not 500; RLS isolation |
| 3. Navigation | Clickable today rows + `/plants` All-plants view + header link | Row link must not hijack the "Watered" button |

**Prerequisites:** S-01 (core-watering-loop) implemented — done. Local Supabase running for migration + type regen.
**Estimated effort:** ~2–3 focused sessions across 3 phases.

## Open Risks & Assumptions

- The `mark_watered` RPC must run as `SECURITY INVOKER` so RLS still constrains it to the caller's rows — a `DEFINER` mistake would be a data-isolation hole.
- Date arithmetic in SQL (`date + int`) must match `src/lib/interval.ts` epoch-day semantics exactly, or determinism drifts between the two code paths.
- Nesting the "Watered" button inside a row-level link would break the optimistic flow; the button must stay a sibling of the link.

## Success Criteria (Summary)

- Marking a plant watered records exactly one correct journal event in the same transaction as the reschedule.
- Any owned plant (due or not) is reachable and shows its details + newest-first journal; empty and not-found states are clear.
- No regression in the existing today-list mark-watered loop, and no cross-user data leakage.
