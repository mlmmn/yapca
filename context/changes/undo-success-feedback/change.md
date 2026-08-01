---
change_id: undo-success-feedback
title: A successful undo can produce no visible feedback
status: blocked
created: 2026-08-01
updated: 2026-08-01
archived_at: null
---

## Notes

**Deliberately postponed until after MVP.** `status: blocked` records a scheduling decision,
not a technical blocker — nothing prevents this work starting; it is being held back on
purpose. Flip to `new` when it becomes eligible for planning.

OBSERVATION: pressing Undo on a watering/postpone toast can succeed server-side while
producing no visible change anywhere in the UI — no message, no list movement. The user
cannot distinguish this from a dead button.

VERIFIED CODE FACTS (read 2026-08-01, no interpretation):

- `src/components/today-list/today-list.tsx:225-227` — in `handleUndo`'s success path, the
  restored plant is re-added to the list only when `isDueOn(restoredPlant, currentToday)`;
  otherwise `return current` leaves the list untouched.
- `src/components/today-list/today-list.tsx:232` — the success path then calls
  `toast.dismiss(noticeId)`. There is no `toast.success` anywhere in `handleUndo`.
- `src/components/today-list/utils.ts:17,23` — the module exports `getSuccessMessage` and
  `getFailureMessage`; there is no undo-specific message helper.
- For contrast, the forward-action paths in the same file do report their outcome:
  `showUndoNotice` (`:104-119`) on success, `showActionFailure` (`:121-136`) on failure.
  `handleUndo` reports only failure (`:239-249`).
- Consequence: whenever an undo restores a date that is not due today, both feedback
  channels are silent simultaneously.

PRODUCT CONTEXT: undo is FR-013 in `context/foundation/prd.md:114`, priority **must-have**,
scoped there as misclick recovery. Recorded here as a fact, not an argument about timing —
the postponement is a deliberate decision made with this in mind.

SCOPE NOT YET DECIDED: whether the fix is a success message, a different list-membership
rule, a different undo model, or something else has not been settled. Treat everything above
as observation only; no direction has been chosen.

SUGGESTED ENTRY POINT: `/10x-frame undo-success-feedback` — the right remedy depends on
unresolved product questions (what a user expects one undo to accomplish, and what the
watering journal is a record of), so framing should precede planning.
