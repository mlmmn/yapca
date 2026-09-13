# Delete Plant Implementation Plan

## Overview

Let a signed-in user permanently delete one of their own plants (FR-007, roadmap S-07). Deletion authoritatively removes the plant row and its whole watering journal (via the existing cascade), then makes a best-effort attempt to remove its private photo from Storage. The action lives in a separated "danger zone" on the edit page, is confirmed through an alert dialog, and on success redirects to All plants with a "<name> deleted" toast.

## Current State Analysis

- The database already supports owner-scoped deletion: `authenticated` holds `DELETE` on `public.plants` and the `plants_delete_own` policy restricts it to `auth.uid() = user_id` (`supabase/migrations/20260719120000_create_plants.sql:35,54-57`). `watering_events.plant_id` is `on delete cascade` (`20260720120000_create_watering_events.sql`).
- Two undo-stack foreign keys are `NO ACTION` but `deferrable initially deferred`: `plants.current_watering_event_id → watering_events` and `watering_events.previous_event_id → watering_events` (`20260801120000_explicit_undo_stack.sql`). A single `DELETE FROM plants` removes the plant (and its pointer) and cascades all of the plant's events, so every reference is gone by commit time. The test fixture reset already relies on this (`test/fixtures/user.ts:429` deletes plants with event chains via the client), but no test states it as a contract.
- `supabase/tests/per-account-isolation.sql:205-212,280-307` already proves a foreign plant DELETE affects 0 rows and an owner DELETE (of a plant with no events) affects 1.
- No `deletePlant` Action exists (`src/actions/index.ts`). Photos are private Storage objects at `{user_id}/{uuid}.{ext}`; a DB cascade does not remove them. `updatePlant` shows the best-effort cleanup pattern (`src/actions/index.ts:200-207`).
- No Dialog/AlertDialog exists in `src/components/ui/`. DESIGN.md:132,178 reserves `destructive` red for delete, as a ghost button with destructive text, promoted to a destructive fill only inside a confirmation.
- Sonner's standalone `<Toaster client:load />` is mounted in `src/layouts/layout.astro:33`; toasts do not survive a full-page `window.location.assign`, and a separate notice island would have no guaranteed hydration order relative to this subscriber.

## Desired End State

On `/plants/<id>/edit`, below the form, a visually separated section offers "Delete plant". Pressing it opens an accessible alert dialog naming the plant and stating that the plant and its watering history will be removed permanently. Confirming calls `actions.deletePlant`; on success the browser lands on `/plants`, the plant is absent, and a "<name> deleted" toast appears. Cancelling (button, Escape) closes the dialog with focus returned to the trigger. Failure keeps the dialog open with an inline error. The plant and its events are gone; the Action attempts private-photo cleanup afterward and logs a cleanup failure without rolling back the authoritative database deletion. Another account's plants cannot be deleted through the Action or directly.

### Key Discoveries:

- Owner DELETE grant + policy already in place — no migration needed (`20260719120000_create_plants.sql:35,54`).
- Deferred undo-stack FKs make cascade correctness a commit-time property worth an explicit SQL assertion (`20260801120000_explicit_undo_stack.sql`).
- Action error mapping convention: `NOT_FOUND` / `UNAUTHORIZED` / `INTERNAL_SERVER_ERROR`, `requireSession` guard (`src/actions/index.ts:13-21`).
- Integration fixtures to reuse: `createPlantFixture`, `readPlantState`/`tryReadPlant`/`tryReadWateringEvents`, `markPlantWatered`, `uploadPhotoFixture`, `expectPhotoAbsent`/`expectPhotoAvailable`, `expectActionNotFound`, `getIntegrationUserFixture(1)` for a second account (`src/actions/per-account-isolation.integration.test.ts`).
- Lesson: name `describe` blocks after the function under test (`server.deletePlant`), not the module.

## What We're NOT Doing

- No soft delete / archive, no undo for deletion.
- No delete entry point on plant detail, All plants, or Today.
- No bulk delete, no account deletion (FR-003 stays parked).
- No e2e (Playwright) test — dialog/redirect is manually verified.
- No schema migration and no changes to existing RPCs.
- No handling for other open tabs showing the deleted plant beyond existing NOT_FOUND paths (tracked separately in `multi-device-today-list-staleness`).

## Implementation Approach

Backend first: a thin `deletePlant` Action that deletes the owner-scoped row while returning its `id`, `name`, and `photo_path`, then best-effort removes the returned photo. Pin behaviour with integration tests and an SQL cascade test. Then UI: add a composed alert dialog that uses the shadcn aria-nova registry as a styling and behavior reference, a `delete-plant-dialog` React island rendered in a danger-zone section of the edit page, and a layout-level toast host that owns both Sonner and the post-redirect notice.

## Critical Implementation Details

- **Order of side effects**: delete the row first, then remove the photo. Removing the photo first would leave a photo-less plant if the row delete fails; the reverse only risks an orphaned private object, which is logged (same trade-off as `updatePlant`).
- **Atomic row capture / zero-row delete**: use `.delete().eq("id", plantId).select("id, name, photo_path").maybeSingle()` so the name and photo path come from the row actually deleted. Treat `null` as `NOT_FOUND`; RLS makes a foreign delete silently return no row rather than error. This avoids a preliminary-read race with concurrent edits.
- **Toast after redirect**: set a `sessionStorage` key (e.g. `yapca:deleted-plant-name`) right before `window.location.assign("/plants")`. Replace the standalone layout `<Toaster client:load />` with one `<ToastHost client:load />` island that renders `<Toaster />` and, in its post-mount effect after the subscriber is mounted, reads and clears the key before firing `toast.success`. This keeps subscription and notice consumption in one hydration boundary instead of relying on cross-island timing. Wrap storage access in try/catch; without storage the redirect still works, just without the toast.

## Phase 1: Delete Action and Backend Tests

### Overview

Add `server.deletePlant` and prove it deletes the plant and its events, removes its photo when Storage cleanup succeeds, rejects foreign/missing ids without side effects, and that the DB cascade succeeds across the deferred undo-stack FKs.

### Changes Required:

#### 1. deletePlant Action

**File**: `src/actions/index.ts`

**Intent**: Expose an owner-only hard delete that also cleans up the plant's Storage photo, following the existing Action conventions.

**Contract**: `deletePlant: defineAction({ accept: "form", input: z.object({ plantId: z.uuid() }) })`. Handler: `requireSession` → `.delete().eq("id", plantId).select("id, name, photo_path").maybeSingle()` (error → `INTERNAL_SERVER_ERROR` "Failed to delete plant."; null → `NOT_FOUND` "Plant not found.") → if the returned `photo_path` is present, `storage.from("plant-photos").remove([photo_path])`, logging (not throwing) on failure → return the deleted row's `{ id, name }`.

#### 2. Form-data fixture

**File**: `test/fixtures/plant-actions.ts`

**Intent**: Reuse `createPlantActionFormData`-style helper for the delete form payload (only `plantId`); add a `createDeletePlantFormData(plantId)` helper if the existing one's `clientDate` field would be misleading.

**Contract**: returns `FormData` with `plantId`.

#### 3. Integration tests

**File**: `src/actions/delete-plant.integration.test.ts`

**Intent**: Pin the Action's observable behaviour against the real local Supabase stack.

**Contract**: `describe("server.deletePlant")` with cases:
- deletes an owner's plant with a multi-event journal (at least one watered + one postponed/watered so the `previous_event_id` chain and `current_watering_event_id` pointer are populated): returns `{ id, name }`; `tryReadPlant` → null; `tryReadWateringEvents` → empty.
- removes the plant's photo on the successful-cleanup path: plant created with an uploaded photo path → after delete, `expectPhotoAbsent`.
- missing id (random uuid) → `NOT_FOUND`.
- foreign account (slot 1 attacker) → `NOT_FOUND`; owner's `readPlantState` before/after is equal and owner's photo still available.

#### 4. SQL cascade test

**File**: `supabase/tests/delete-plant-cascade.sql`

**Intent**: State the DB contract directly: as the owner (`set local role authenticated` + JWT claims), deleting a plant whose events form a `previous_event_id` chain and whose `current_watering_event_id` points at the newest event succeeds at commit-equivalent time and leaves no events for that plant; a second account's plant and events are untouched.

**Contract**: transaction-scoped (`begin … rollback`) like `per-account-isolation.sql`. Because FKs are deferred, force the check inside the transaction with `set constraints all immediate` after the delete so a violation raises before rollback. Build the chain via the `mark_watered` / `postpone_plant` RPCs (as the owner) rather than raw inserts, so the pointers match production shape.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `pnpm check`
- Linting passes: `pnpm lint`
- Unit tests pass: `pnpm test`
- Integration tests pass (incl. new delete suite): `pnpm test:integration`
- SQL tests pass (incl. new cascade test): `pnpm test:sql`

#### Manual Verification:

- Deliberate break check: temporarily removing the photo cleanup makes the photo test fail; removing the null-result mapping makes the missing/foreign-account tests fail (revert after)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human before proceeding to the next phase.

---

## Phase 2: Delete UI

### Overview

Give users a confirmed, accessible way to delete a plant from its edit page, and confirm success on All plants.

### Changes Required:

#### 1. Alert dialog UI primitive

**File**: `src/components/ui/alert-dialog/alert-dialog.tsx`, `index.ts`, `types.ts`

**Intent**: Create one composed `AlertDialog` component, using the shadcn aria-nova alert-dialog registry output only as a styling and behavior reference. Do not run the generator or modify `src/components/ui/button.tsx`; adapt the reference to the repository's one-component-per-module and component-folder conventions, omit Next.js client directives, and import `cn` from `@/lib/utils` if needed.

**Contract**: A narrowly scoped composed API for this feature, backed by React ARIA `Modal`/`Dialog` with `role="alertdialog"`, focus trap, and focus restore to the trigger. It accepts controlled `open` state plus an `onOpenChange` callback so `DeletePlantDialog` can reject close requests while deletion is pending. The component exposes the title, description, Cancel and confirmation actions needed by `DeletePlantDialog`; Cancel uses React ARIA's close behavior, while confirmation uses a normal non-close Button with a solid destructive fill. Both action targets are at least 44px tall. Escape dismisses only while idle, and entry/exit animation collapses to instant under `prefers-reduced-motion`.

#### 2. Delete plant dialog component

**File**: `src/components/delete-plant-dialog/delete-plant-dialog.tsx`, `index.ts`, `types.ts` (+ `utils.ts`/`constants.ts` only if needed)

**Intent**: Island that renders the "Delete plant" trigger (ghost button, destructive text), the confirmation dialog, and performs the delete.

**Contract**: props `{ plantId: string; plantName: string }`. Own controlled dialog open state. Dialog title "Delete <name>?", body stating the plant and its watering history are permanently removed and it can't be undone; actions "Cancel" (default focus and the only close-slot action) and "Delete plant" (a normal non-close Button with destructive fill). On confirm: disable both buttons, show a pending label, and call `actions.deletePlant(formData)` without closing. While pending, ignore `onOpenChange(false)` requests so Escape or other dismissal cannot hide the in-flight state. Success or `NOT_FOUND` (already gone) → write sessionStorage name, `window.location.assign("/plants")`. `UNAUTHORIZED` → redirect with `window.location.assign()` to `/auth/signin?error=${encodeURIComponent("Your session expired. Sign in again to continue.")}`; the existing sign-in error banner displays that exact message, and the existing successful sign-in flow continues to `/` with no return-to-edit behavior. Other errors (incl. rejected promise) → keep dialog open with an inline `role="alert"` error "Couldn't delete <name>. Try again." (text, not color only). Trigger disabled until hydrated (`useHydrated`), matching the edit form.

#### 3. Edit page danger zone

**File**: `src/pages/plants/[id]/edit.astro`

**Intent**: Render a separated section after `<EditPlantForm>` (top border/hairline, heading "Delete plant", one-line consequence text) containing `<DeletePlantDialog client:load plantId plantName />`.

**Contract**: only rendered when `plant` exists.

#### 4. Layout-level toast host and post-delete notice

**File**: `src/components/toast-host/toast-host.tsx`, `index.ts`; `src/layouts/layout.astro`; `src/lib/deleted-plant-notice.ts`

**Intent**: Replace the layout's standalone Toaster island with one host that renders `Toaster` and consumes the stored post-delete notice only after that shared hydration boundary has mounted.

**Contract**: `ToastHost` returns `<Toaster />` and uses one post-mount effect to call `takeDeletedPlantNotice()` and, when it returns a name, `toast.success("<name> deleted")`. `layout.astro` imports `ToastHost` and replaces `<Toaster client:load />` with `<ToastHost client:load />`; do not add an island to `src/pages/plants/index.astro`. The shared storage key and `setDeletedPlantNotice(name)` / `takeDeletedPlantNotice()` helpers live in `src/lib/deleted-plant-notice.ts`, with storage access guarded by try/catch so the dialog and host do not duplicate the key or browser-storage handling.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `pnpm check`
- Linting passes: `pnpm lint`
- Unit tests pass: `pnpm test`
- Integration tests still pass: `pnpm test:integration`
- Production build succeeds: `pnpm build`

#### Manual Verification:

- Edit page shows the separated "Delete plant" section; trigger is ghost with destructive text, not a red fill
- Dialog opens, names the plant, explains journal + photo loss; keyboard-only: Tab stays trapped, Escape and Cancel close and return focus to the trigger
- Confirm deletes, lands on `/plants` without the plant, and "<name> deleted" toast appears on a cold load
- Plant with a photo: after delete, its detail URL shows "Plant not found"
- While deletion is pending, disabled actions and Escape cannot close the dialog; a simulated failure (e.g. stop Supabase or go offline) restores the actions and keeps the dialog open with inline error text
- Reduced motion (OS setting) makes dialog open/close instant
- Mobile width (~375px): dialog and danger zone are usable, buttons ≥44px tall
- Expired session on confirm redirects to `/auth/signin`, whose error banner says "Your session expired. Sign in again to continue."

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful.

---

## Testing Strategy

### Unit Tests:

- None required: the sessionStorage helpers are trivial try/catch wrappers; add a small test only if logic grows beyond get/remove.

### Integration Tests:

- `server.deletePlant`: happy path with event chain, successful photo cleanup, missing id, foreign account (see Phase 1 §3).
- SQL: cascade through deferred undo-stack FKs with immediate constraint check; other account untouched (Phase 1 §4).

### Manual Testing Steps:

1. Add a plant with a photo, water it and postpone it on Today, then open Edit → Delete plant → Cancel; confirm nothing changed.
2. Delete it; confirm redirect, toast, absence on All plants and Today, and that `/plants/<id>` 404s.
3. Keyboard-only and reduced-motion passes on the dialog.
4. Expire the session after opening the edit page, confirm deletion, and verify redirect to sign-in with the exact expired-session message.

## Performance Considerations

None — a single delete returning one row (cascade over a handful of events, indexed on `plant_id`) and at most one Storage call.

## Migration Notes

No schema change. Existing data unaffected.

## References

- Roadmap slice: `context/foundation/roadmap.md` S-07; PRD FR-007
- Photo cleanup pattern: `src/actions/index.ts:200-207`
- Cross-account test pattern: `src/actions/per-account-isolation.integration.test.ts`
- SQL test pattern: `supabase/tests/per-account-isolation.sql`
- Design rules: `DESIGN.md:132,178`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Delete Action and Backend Tests

#### Automated

- [x] 1.1 Type checking passes: `pnpm check`
- [x] 1.2 Linting passes: `pnpm lint`
- [x] 1.3 Unit tests pass: `pnpm test`
- [x] 1.4 Integration tests pass (incl. new delete suite): `pnpm test:integration`
- [x] 1.5 SQL tests pass (incl. new cascade test): `pnpm test:sql`

#### Manual

- [x] 1.6 Deliberate break check: removing photo cleanup / null-result mapping fails the matching test

### Phase 2: Delete UI

#### Automated

- [ ] 2.1 Type checking passes: `pnpm check`
- [ ] 2.2 Linting passes: `pnpm lint`
- [ ] 2.3 Unit tests pass: `pnpm test`
- [ ] 2.4 Integration tests still pass: `pnpm test:integration`
- [ ] 2.5 Production build succeeds: `pnpm build`

#### Manual

- [ ] 2.6 Edit page shows separated danger zone with ghost destructive trigger
- [ ] 2.7 Dialog content, focus trap, Escape/Cancel with focus restore
- [ ] 2.8 Confirm redirects to /plants without the plant and shows the toast
- [ ] 2.9 Plant with photo: detail URL shows "Plant not found" after delete
- [ ] 2.10 Pending state blocks dismissal; simulated failure keeps dialog open with inline error
- [ ] 2.11 Reduced motion makes dialog transitions instant
- [ ] 2.12 Mobile width usable, touch targets ≥44px
- [ ] 2.13 Expired session redirects to sign-in with the exact message
