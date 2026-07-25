# Edit Plant and Schedule Recalculation — Design Brief

## 1. Feature Summary

This change adds a trustworthy edit flow to the existing plant detail page. A signed-in hobbyist can
update a plant's name, growing-season interval, dormancy-season interval, and photo without losing
their watering journal or having to recreate the plant.

The important behavior is schedule transparency. Name and photo edits leave the current due date alone;
an interval edit recalculates the next due date deterministically and shows the result before the user
submits. The detail page then reflects the authoritative saved schedule immediately.

This is S-06 from the roadmap. It extends S-02's detail view and journal; it does not add watering,
postpone, undo, delete, notes, future scheduling, or plant-science metadata.

## 2. Primary User Action

The user changes an interval and confidently saves, understanding exactly how the next watering date will
move before the change is committed.

The primary success signal is not merely that the form submits. It is that the user can answer, without
guessing:

1. Which values are being changed?
2. Which season's interval is active on the save date?
3. What will the next due date become?

## 3. Design Direction

### Visual lane

Use a **Restrained** color strategy and extend the existing Field Notebook system rather than creating a
feature-local visual treatment.

- True-white paper and confident ink remain the dominant surfaces.
- Canopy green is reserved for the primary `Save changes` action, focus, and the small active-season
  cue. Keep it below the One Voice Rule's 10% surface limit.
- Muted-surface panels and hairlines separate sections; resting cards do not use shadows.
- Amber remains reserved for overdue meaning. It must not be used to signify that an edit is pending or
  that an interval changed.
- Destructive red is not used in this slice because delete is explicitly owned by S-07.
- Figtree Variable, sentence-case labels, existing radii, and existing button/input components carry
  hierarchy.

### Scene sentence

A hobbyist stands beside a plant with a phone in one hand, adjusts a cadence after noticing the plant's
current routine, and wants to verify the new date in ordinary indoor daylight before putting the phone
away.

That calls for the existing high-legibility light surface with the established system dark-mode
inversion available when the device requests it. The edit flow should feel like correcting a field note,
not configuring an administrative record.

### Anchor references

- **Apple Contacts:** a clear identity header with a secondary edit action and familiar save/cancel
  behavior.
- **Things:** calm, short-session editing where the task stays more important than the controls.
- **A field notebook margin:** exact dates and observed schedule facts, with no ornamental illustration or
  dashboard chrome.

These are structural references only. Do not copy platform chrome, introduce a settings sidebar, or turn
the form into a multi-step wizard.

### Probe decision

No visual direction probe is needed for this change. The repository already has a committed design
system, and this is a focused extension of an existing detail surface rather than a new ambiguous visual
direction. The implementation must use the root tokens and component vocabulary.

## 4. Scope

### Fidelity

Production-ready design specification.

### Breadth

The complete responsive flow includes:

- The edit entry point on plant detail.
- The edit form at `/plants/<id>/edit`.
- Name, growing interval, dormancy interval, photo replacement, and photo removal.
- A live exact-date recalculation preview.
- Save, cancel, validation, loading, failure, stale-record, missing-photo, and not-found states.
- The saved detail view showing the new schedule and unchanged journal.

### Interactivity

Use a server-rendered edit page with a React form island for field validation, photo preview, and live
recalculation. The server action is authoritative for ownership, date/timezone resolution, photo storage,
and persistence. Browser navigation remains ordinary and linkable.

### Responsive and accessibility target

- Phone-first, composed desktop layout.
- WCAG 2.2 AA.
- Complete keyboard operation and visible focus.
- At least 44px touch targets along the primary mobile path.
- Usable at 320px wide and 200% zoom without horizontal scrolling.
- Full reduced-motion behavior; meaning and date updates never depend on animation.

### Explicit exclusions

- Delete or archive controls; S-07 owns deletion.
- Watered, Postpone, Undo, or any watering mutation from the edit page.
- Journal editing, manual journal entries, notes, reminders, future schedule views, or species metadata.
- A confirmation modal for interval changes.
- A second visual language, new palette, decorative botanical artwork, or photo-derived accent colors.

## 5. Recalculation Contract

The user-facing rule must be deterministic and match the server-side rule. The form may preview it, but
only the server writes the date.

### Values

- `oldNextDue`: the plant's stored `next_due_on` before the edit.
- `oldActiveInterval`: the interval from the existing record for the season active on the user's local
  save date.
- `newActiveInterval`: the submitted interval for that same active season.
- `delta`: `newActiveInterval - oldActiveInterval`.

### Rules

1. If only the name and/or photo changes, keep `next_due_on` unchanged.
2. If either interval changes, set `next_due_on` to `oldNextDue + delta` using exact calendar-day
   arithmetic.
3. Determine the active season from the user's local save date: growing season is March 1 through
   October 31; dormancy is November 1 through the final day of February.
4. Do not rewrite, backfill, or delete `watering_events`. The journal remains a record of what happened,
   not a projection of the newly edited schedule.
5. Recalculate on the server inside the ownership-checked update transaction. The client preview is
   advisory and must be replaced by the returned persisted plant.
6. A stale edit must not overwrite a newer schedule change. The update boundary should compare the
   submitted version/timestamp or lock and validate the current row before applying the update; on a
   conflict, return a retryable conflict state rather than silently replacing the newer data.

This shift rule preserves the current schedule phase and overdue state while changing the cadence. For
example, changing an active interval from 7 to 10 days moves a stored due date three calendar days later;
changing it from 10 to 7 moves it three days earlier. Editing the inactive season alone does not move the
current due date.

The preview must state the consequence in plain language, for example:

> Growing season is active. Next due will move from 14 Jul to 17 Jul.

If the due date does not change because only the inactive season or non-schedule fields changed, say so:

> The next due date stays 14 Jul until the active schedule changes.

## 6. Information Architecture and Layout

### 6.1 Detail entry point

Place `Edit plant` in the plant detail identity header, aligned with the plant name and schedule facts.
It is a secondary ghost/outline action, visually quieter than the identity and never mistaken for a
watering action.

On narrow screens, the action may wrap below the schedule facts but remains in the header before the
journal. It must not be hidden in an overflow menu; edit is a core CRUD capability and should be findable
from the record it changes.

Keep `Back to all plants` above the identity block. Preserve the existing photo/initial geometry and the
existing `SeasonIntervalSummary` vocabulary on the detail page.

### 6.2 Edit page shell

Use the same authenticated header and a centered reading column no wider than the existing form measure.
The page order is:

1. `Back to <plant name>` link, with a safe fallback of `Back to plant` for long or unavailable names.
2. Page heading: `Edit plant`.
3. A compact identity line showing the current photo/initial and plant name, so the user knows which
   record is being edited.
4. The editable fields.
5. The schedule consequence panel.
6. Photo controls, if they are not placed alongside the identity line by the existing form rhythm.
7. Action row: `Save changes` and `Cancel`.

Do not turn each field into a card. Use the existing `Field`, `FieldGroup`, `Input`, `NumberField`,
`FieldDescription`, and `FieldError` components. Section separation should come from spacing and one
deliberate hairline, not nested panels.

### 6.3 Field order

Use this order because it follows identity → cadence → consequence → media → commit:

1. **Plant name** — text input, prefilled, required.
2. **Growing season** — integer days, 1–365, with `March–October` description.
3. **Dormancy season** — integer days, 1–365, with `November–February` description.
4. **Schedule preview** — read-only derived message and exact date, updated when interval values change.
5. **Photo** — current thumbnail, replace control, and explicit `Remove photo` action when a photo exists.

The preview is not an editable field and must not look like a disabled input. It is a consequence of the
submitted values, visually grouped with the interval fields and labeled as such.

### 6.4 Action placement

On desktop, place `Save changes` first and `Cancel` second in a horizontal action row. On narrow screens,
allow the row to wrap or stack with full-width save above a full-width/fit cancel action, keeping both
controls comfortably reachable.

`Save changes` is the only canopy-green primary action. `Cancel` is a neutral link/ghost action and
navigates back without submitting. Browser Back remains valid and must not be trapped by a custom prompt.

## 7. Key States

### Default edit

- All saved values are prefilled.
- The current photo or initial fallback is visible.
- The preview states the current due date and whether a submitted interval change would move it.
- `Save changes` is enabled only when the form is valid and not submitting.

### Name/photo-only changes

- The preview explicitly says the next due date stays the same.
- The save action still persists the changed fields.
- No journal entry is created.

### Active interval change

- Update the preview as the number field changes after a valid integer is available.
- Identify the active season in sentence case: `Growing season is active` or `Dormancy season is active`.
- Show both old and new exact dates when the due date moves.
- Never use vague copy such as `Soon`, `Later`, or `Updated schedule`.

### Inactive interval change

- The preview identifies that the inactive season changed and that the current next due date is unchanged.
- The new inactive interval remains visible in the field; do not hide it merely because it has no immediate
  effect.

### Invalid name

- Empty or whitespace-only name: `Enter a plant name`.
- Keep the user's input, mark the field invalid semantically, and place the message directly with the
  field.

### Invalid interval

- Values must be integers from 1 through 365.
- Use one concise message: `Choose a number from 1 to 365`.
- The preview is replaced by a short instruction such as `Enter valid intervals to preview the next due
  date.` It must not display a fabricated date.

### Invalid photo

- Reject unsupported type or files over 4 MB before submission.
- Keep the current saved photo unchanged if replacement validation fails.
- Show `Choose a JPEG, PNG, or WebP image up to 4 MB.` next to the file control.
- Clear only the invalid file selection, not unrelated fields.

### Photo removed

- `Remove photo` is an explicit reversible-in-form action: replace the preview with the initial fallback
  and provide `Undo photo removal` until save or another file is selected.
- Do not delete the stored object before the plant update succeeds.
- Cancel leaves the persisted photo untouched.

### Submitting

- Disable both save and cancel only for the short mutation boundary if the existing navigation pattern
  requires it; never permit a second save.
- Keep the values and preview visible.
- Label the primary action `Saving changes…` rather than showing an unlabeled spinner.
- Do not animate fields or hide the form.

### Successful save

- Redirect to the plant detail page, or update the detail page from the returned authoritative plant with
  equivalent browser-history behavior.
- Show the saved name, photo state, both interval values, active-season summary, and exact recalculated
  due date before the journal.
- Use a concise success notice only if the existing toast vocabulary needs confirmation: `Plant updated ·
  Next due 17 Jul`.
- Do not create a journal entry for a schedule edit.

### Validation or network failure

- Keep the edit page and every user-entered value.
- Show `We couldn't save these changes. Check your connection and try again.` for a generic failure.
- Keep the form actionable after the message; do not force a full-page reload.
- If the server rejects the record as missing or unauthorized, show the same privacy-safe not-found state
  as the detail route rather than revealing ownership.

### Stale edit conflict

- Show `This plant changed elsewhere. Reload it before saving again.`
- Do not merge values silently or report success.
- Offer `Reload plant` and a safe `Back to plant` path; preserve the user's attempted values only if the
  implementation can do so without making a second save ambiguous.

### Loading and missing data

- SSR should load the plant and initial photo before the form island renders.
- If a client loading state is needed, use field-shaped skeletons and an identity placeholder matching the
  final geometry. Do not center a spinner.
- A missing plant returns HTTP 404 and uses `Plant not found` / `This plant may have been removed or isn't
  available to this account.` with `Back to all plants`.

### Long names and narrow screens

- Let plant names wrap to two or more lines; never truncate the identity needed to confirm the record.
- Keep the action row and field controls inside the viewport at 320px.
- Let schedule preview copy wrap naturally. Do not use fixed heights.

### Dark theme and reduced motion

- Use existing dark tokens and preserve contrast; do not introduce glowing inputs or green-filled panels.
- Any preview update is a content change, not an animation requirement. Under reduced motion, update
  immediately. If a subtle crossfade is used, it must be optional and under 200ms.

## 8. Interaction Model

### Navigation

- `Edit plant` is an ordinary anchor to `/plants/<id>/edit`.
- `Cancel` is an ordinary anchor back to `/plants/<id>` and does not submit.
- The back link includes the plant identity where available.
- Browser Back and refresh remain safe; no unsaved-change modal is required for this MVP.

### Live preview

- Recompute only after both intervals are valid integers and the user-local date is known.
- Keep the preview in a polite live region only when its text changes meaningfully, and avoid announcing
  every keystroke to screen readers. A practical implementation may update the visible preview on each
  valid change while announcing only the final consequence on field blur or submit attempt.
- The preview never mutates the database and never changes the journal.

### Photo control

- Selecting a valid file updates a local preview and records the pending replacement.
- Removing a photo updates only local form state until save.
- Replacing after removal cancels the removal state.
- Revoke object URLs on replacement/unmount to avoid leaking browser memory.

### Save

- Validate on blur and on submit using the existing form conventions.
- Build one form payload containing the name, both intervals, photo replacement/removal intent, and the
  optimistic concurrency value.
- Server returns the updated plant or a typed error. Never infer the new due date from the client preview
  after success.
- On failure, restore focus to the first invalid field or the save control, depending on the error.

### Focus and announcements

- Focus the first editable field on desktop only if that matches the existing add form behavior; do not
  steal focus on small screens.
- On validation failure, move focus to the first invalid control and preserve the user's context.
- On successful navigation, the detail page heading is the natural focus target.
- Do not move focus to a toast after save; the saved detail state is the durable confirmation.

### Motion

- Use existing input/button state transitions only.
- If schedule preview text is crossfaded, keep the old and new values from overlapping semantically and
  remove the transition under `prefers-reduced-motion`.
- No celebration, confetti, bounce, or progress choreography.

## 9. Content Requirements

### Navigation and headings

- `Edit plant`
- `Back to [plant name]`
- `Back to plant`
- `Save changes`
- `Cancel`
- `Plant not found`
- `Back to all plants`

### Fields

- `Plant name`
- `Growing season`
- `March–October`
- `Dormancy season`
- `November–February`
- `Photo (optional)`
- `Replace photo`
- `Remove photo`
- `Undo photo removal`

### Preview copy

- `Growing season is active. Next due will move from 14 Jul to 17 Jul.`
- `Dormancy season is active. Next due will move from 14 Jul to 11 Jul.`
- `The next due date stays 14 Jul until the active schedule changes.`
- `Enter valid intervals to preview the next due date.`

Use real formatted dates from the shared date helper and the user's timezone authority. The examples are
illustrative; never expose raw `YYYY-MM-DD` strings in the UI.

### Errors and status

- `Enter a plant name`
- `Choose a number from 1 to 365`
- `Choose a JPEG, PNG, or WebP image up to 4 MB.`
- `Saving changes…`
- `We couldn't save these changes. Check your connection and try again.`
- `This plant changed elsewhere. Reload it before saving again.`
- `Reload plant`
- `Plant updated · Next due 17 Jul`

Keep error copy specific, calm, and non-blaming. Do not say `Invalid plant`, `Schedule corrupted`, or
similar alarmist language.

### Media roles

The only media is the user's existing or newly selected plant photo. Use the current signed-URL storage
flow for the saved image and a local object URL for the unsaved preview. If no image exists, use the
trimmed uppercase initial or `?` in the existing muted-surface fallback. No generated raster, stock image,
botanical illustration, texture, or decorative SVG is needed.

## 10. Technical and Accessibility Requirements

- API/action routes must remain full SSR with `export const prerender = false` where applicable.
- Validate all submitted fields with zod on the server and in the client form.
- Keep ownership checks and RLS boundaries intact. A user can edit only their own plant and photo.
- Use an ownership-checked, atomic update boundary for the plant row and schedule calculation.
- Preserve photo storage hygiene: upload a replacement before commit, clean up an uploaded object if the
  plant update fails, and remove the old object only after the new database state is durable.
- Never rewrite journal rows during an edit.
- Announce validation errors through field associations (`aria-invalid`, `aria-describedby`) and keep the
  visible error text adjacent to the field.
- Do not rely on color to communicate the active season, invalid field, photo removal, or save failure.
- Keep keyboard order logical: back link → name → growing interval → dormancy interval → preview context →
  photo controls → save → cancel.
- Ensure focus rings remain visible on the true-white surface, muted-surface photo controls, and dark theme.
- Preserve user input after network failure and avoid disabling unrelated navigation.
- Test 320px, 375px, tablet, desktop, keyboard-only use, 200% zoom, dark mode, reduced motion, long plant
  names, missing photos, invalid files, and an overdue plant whose interval changes.

## 11. Recommended Impeccable References for Implementation

- `reference/layout.md` for the detail-header action, form measure, and responsive action row.
- `reference/harden.md` for stale edits, photo replacement/removal, network failures, and privacy-safe
  not-found behavior.
- `reference/adapt.md` for 320px/200% zoom behavior and wrapping schedule preview copy.
- `reference/audit.md` for semantics, focus, contrast, live-region restraint, dark mode, and reduced motion.
- `reference/typeset.md` for the exact-date preview and field metadata hierarchy.

Implementation must also remain aligned with `PRODUCT.md`, `DESIGN.md`, `AGENTS.md`, the PRD's FR-006,
and the S-06 definition in `context/foundation/roadmap.md`.

## 12. Acceptance Checklist

- [ ] Plant detail exposes a clear, secondary `Edit plant` action.
- [ ] Edit loads the correct owned plant, current intervals, and current photo/initial fallback.
- [ ] Name, growing interval, dormancy interval, photo replacement, and photo removal are all supported.
- [ ] Name/photo-only saves preserve `next_due_on` and create no journal event.
- [ ] An active interval edit shifts `next_due_on` by the exact interval delta using the user's local save
      date to choose growing vs dormancy.
- [ ] Editing the inactive interval alone does not move the current due date, but the saved value is shown.
- [ ] The preview shows a human-readable exact old/new date consequence before save.
- [ ] The server result, not the client preview, is rendered after success.
- [ ] Overdue status is preserved or shifted according to the deterministic date rule without color-only
      messaging.
- [ ] Journal entries remain unchanged and visible after the edit.
- [ ] Invalid values, invalid photos, network failures, missing plants, and stale edits have recoverable
      states.
- [ ] No old photo is lost on cancel or failed save; storage cleanup is safe on replacement failure.
- [ ] Mobile, keyboard, 200% zoom, dark mode, reduced motion, long names, and missing photos are covered.
- [ ] The feature uses existing tokens/components and introduces no decorative botanical or SaaS-template
      treatment.

## 13. Resolved Decisions

- Fidelity: production-ready.
- Breadth: detail entry point, edit page, live schedule preview, save/cancel, photo lifecycle, and
  supporting failure states.
- Color strategy: Restrained, existing Field Notebook system.
- Theme: existing light-first surface with token-driven dark support.
- Recalculation: interval delta applied to the stored next due date when the interval active for the
  user's local save date changes; name/photo-only edits preserve the date.
- Season boundaries: growing March 1–October 31; dormancy November 1–February's final day.
- Journal behavior: schedule edits do not create or rewrite watering events.
- Delete behavior: out of scope; S-07 owns it.
- Open questions: none for the shaped UX/UI brief.
