# Delete Plant — Plan Brief

> Full plan: `context/changes/delete-plant/plan.md`

## What & Why

Users can add and edit plants but not remove them. FR-007 (must-have, roadmap S-07) requires that a user can delete a plant at any time, without leaving orphaned journal rows or photos, and without any path to touch another account's data.

## Starting Point

The DB already grants owner-scoped `DELETE` on `plants` (RLS `plants_delete_own`) and cascades `watering_events`. There's no Action, no UI, and no dialog primitive; photos live in private Storage and aren't covered by the DB cascade.

## Desired End State

On a plant's edit page, a separated "Delete plant" section opens an accessible confirmation dialog. Confirming removes the plant, its whole watering journal, and its photo, then lands the user on All plants with a "<name> deleted" toast.

## Key Decisions Made

| Decision        | Choice                                  | Why (1 sentence)                                                             |
| --------------- | --------------------------------------- | ---------------------------------------------------------------------------- |
| Delete kind     | Hard delete                             | Reuses existing grants/RLS/cascade with no migration; matches PRD default.   |
| Entry point     | Edit page, danger zone                  | Keeps a red, irreversible action away from everyday browsing.                |
| Confirmation    | shadcn aria-nova alert dialog           | DESIGN.md: destructive fill only inside a confirmation; React ARIA focus mgmt. |
| After delete    | Redirect to `/plants` + toast           | Explicit feedback on a valid page; toast carried via sessionStorage.         |
| Testing         | Action integration tests + SQL cascade  | Covers orphans, cross-account, deferred-FK cascade at cheapest layers.       |
| Side-effect order | Row delete first, then photo (best-effort) | Worst case is an orphaned private object, not a broken plant.             |

## Scope

**In scope:**
- `server.deletePlant` Action (owner read, zero-row check, photo cleanup)
- Integration tests + SQL cascade test through undo-stack FKs
- Alert dialog primitive, `delete-plant-dialog` island, edit-page danger zone
- Post-redirect toast on `/plants`

**Out of scope:**
- Soft delete / archive / undo, bulk delete, account deletion
- Delete entry points on detail, All plants, or Today
- Playwright e2e, migrations, RPC changes

## Architecture / Approach

Edit page (Astro) renders `DeletePlantDialog` island → `actions.deletePlant` → Supabase read (`id, name, photo_path`) → `DELETE plants` (RLS + cascade to events, deferred FKs satisfied at commit) → Storage `remove(photo_path)` → client stores name in sessionStorage → `/plants` → `DeletedPlantNotice` island fires Sonner toast.

## Phases at a Glance

| Phase                              | What it delivers                                  | Key risk                                              |
| ---------------------------------- | ------------------------------------------------- | ----------------------------------------------------- |
| 1. Delete Action and backend tests | Working, tested owner-only hard delete            | Deferred undo-stack FKs failing the cascade at commit |
| 2. Delete UI                       | Danger zone, confirm dialog, redirect + toast     | Toast lost to island hydration order                  |

**Prerequisites:** Local Supabase stack running (`pnpx supabase start`) for integration/SQL tests.
**Estimated effort:** ~1–2 sessions across 2 phases.

## Open Risks & Assumptions

- Assumes shadcn's aria-nova registry provides `alert-dialog` (fallback: `dialog`).
- Sonner may drop a toast emitted before `<Toaster>` subscribes; mitigated by deferring and manual verification.
- A failed Storage removal leaves an orphaned private object (logged, not surfaced).

## Success Criteria (Summary)

- A user can delete their plant from the edit page after an explicit confirmation and sees it confirmed.
- No events or photo remain for the deleted plant; other accounts are unaffected.
- Dialog is keyboard-operable, reduced-motion friendly, and usable on mobile.
