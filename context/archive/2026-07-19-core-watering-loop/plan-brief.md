# Core Watering Loop (S-01) — Plan Brief

> Full plan: `context/changes/core-watering-loop/plan.md`
> Design authority: `context/changes/core-watering-loop/design.md` (wins on conflict)
> Research: `context/changes/core-watering-loop/research.md`

## What & Why

Build the north-star loop: a signed-in user adds a plant (name, interval, optional photo), sees it on today's list, and marks it **Watered** so it reschedules to exactly `today + interval`. The PRD states "the loop working is the product working" — shipping this proves the whole product hypothesis, and correctness of the loop (deterministic interval math, per-account isolation) is the value.

## Starting Point

The app is 100% server-driven with zero React islands, no Astro Actions, and an empty data layer — `supabase/migrations/` doesn't exist yet, `PROTECTED_ROUTES` is empty, and `authed-shell.astro` is a "Your daily list will appear here" placeholder. Auth (Supabase cookie session + middleware) and one shadcn `button.tsx` are in place.

## Desired End State

A user can add a plant through an explicit Today/After `[interval]` days choice, see it in a responsive, continuous Today ledger, and mark it Watered — the row and count update instantly and reschedule server-side, reverting in stable order with a retryable toast on failure. No user can see another's plants or photos.

## Key Decisions Made

| Decision                     | Choice                                             | Why (1 sentence)                                                            | Source   |
| ---------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------- | -------- |
| Form library                 | TanStack Form                                       | Controlled-native, consumes Zod directly, fits the controlled react-aria base. | Research |
| Snappy path                  | Astro Actions + React 19 `useOptimistic` with a mounted list coordinator | True optimistic feedback + correlated rollback for concurrent rows, zero new data-layer deps. | Plan review |
| "Today" definition           | Client sends local date (`YYYY-MM-DD`)              | Correct near midnight for the user, no timezone settings surface.           | Plan     |
| Task model                   | `next_due_on DATE` column on `plants`              | Smallest correct model; journal (S-02) adds history later.                  | Plan     |
| First-due timing             | Explicit Today / After `[interval]` days radio     | Replaces ambiguous checkbox wording while preserving the existing boolean server contract. | Design |
| Photo                        | In scope now, via Supabase Storage; list thumbnails via SSR signed URLs | User chose to complete FR-004's photo and show thumbnails on the list.  | Plan     |
| Determinism verification     | Manual only (no Vitest)                             | User opted out of test tooling for S-01; math kept in a pure module.        | Plan     |
| Add-plant form placement     | Dedicated `/plants/new` page                       | Simplest structure; plays well with a file input.                          | Plan     |
| Today surface                | Flat continuous ledger with distinct empty/error states | Keeps the daily glance scannable for 10–30 plants without dashboard/card drift. | Design |
| Optimistic failure UX        | Stable-order rollback + Retry toast                | Gives the user a direct recovery path while preserving trust in the list.   | Design |

## Scope

**In scope:** `plants` table + RLS; `plant-photos` Storage bucket + RLS; interval-math module; Astro Actions (`addPlant`, `markWatered`); add-plant form island (TanStack Form); optimistic today's-list island; route gating; photo upload.

**Out of scope:** journal/history (S-02), Postpone/Undo (S-04), overdue urgency cue (S-03), season split (S-05), edit/delete (S-06/S-07), full plant detail view (S-02; list thumbnails are in scope), automated tests, `<ClientRouter>`.

## Architecture / Approach

Two problems, two tools, one substrate. The add-plant form uses TanStack Form and calls the `addPlant` Action as an RPC; the Watered path uses a mounted list-level coordinator with `useOptimistic` and direct typed `actions.markWatered(FormData)` calls, keeping concurrent results correlated by plant ID. Both go through Astro Actions, while `design.md` governs the flat, responsive field-notebook experience: explicit initial scheduling radios, a narrow form, and a hairline-ledger Today list rather than cards or a dashboard.

## Phases at a Glance

| Phase                              | What it delivers                                          | Key risk                                              |
| ---------------------------------- | -------------------------------------------------------- | ----------------------------------------------------- |
| 1. Data & domain foundation        | `plants` + RLS, Storage bucket + RLS, types, math module | Getting RLS granular and Storage-path isolation right |
| 2. Server actions substrate        | `addPlant` + `markWatered` Actions, body-size limit, gating | 1 MB action body limit silently blocking photos       |
| 3. Add-plant form island           | `/plants/new` TanStack Form island                       | First hydrated form + multipart-through-Action wiring |
| 4. Today's-list + optimistic Water | Hydrated list, coordinated optimistic Watered, Sonner toast | Concurrent reconcile/revert correctness            |

**Prerequisites:** F-01 (auth + gating) is done. Local Supabase stack (`pnpx supabase start`, needs Docker). No GitHub remote needed.
**Estimated effort:** ~3–4 sessions across 4 phases (heaviest slice in the roadmap).

## Open Risks & Assumptions

- **Determinism is manually verified only.** The core NFR (no drift across cycles) has no automated guard; a future slice could regress it silently. Mitigated by isolating the math in a pure module. Worth revisiting with Vitest before wider release.
- **"Today" trusts a client-supplied date.** The server validates it's a plausible `YYYY-MM-DD` but cannot fully attest it — acceptable for a single-user personal MVP.
- **Photo upload enlarges the heaviest slice** (bucket RLS, multipart Action, body-size limit) — the most likely source of setup friction.
- Assumes the aria-nova shadcn registry provides the needed field primitives (Input/TextField/NumberField/Label/FieldError/RadioGroup/Sonner).

## Success Criteria (Summary)

- A user completes add → due today → Watered without error, and the plant reappears **exactly** `interval` days later (not before).
- Mark Watered feels instant; failures restore the row and count in stable order with a Retry toast.
- No plant or photo crosses the account boundary (two-account RLS check).
