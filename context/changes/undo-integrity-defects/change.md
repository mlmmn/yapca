---
change_id: undo-integrity-defects
title: Preserve undo integrity across colliding and edited schedules
status: impl_reviewed
created: 2026-07-31
updated: 2026-08-01
archived_at: null
---

## Notes

Resolve the reviewed V1 and V3 defects captured by
`src/actions/watering-sequence.integration.test.ts`: undo must reject an
out-of-order event when multiple events share a due date, and schedule-changing
plant edits must not invalidate a pending undo or leave its journal transition
inconsistent with the plant's current due date.

V1 is not a newly discovered defect. The value-based Stale-Undo guard was named at
plan-review time for the original change and shipped knowingly —
`context/archive/2026-07-23-postpone-and-undo/reviews/plan-review.md:27` records it as
"Stale-Undo guard … is value-based rather than identity-based … Sound as designed". That
review cleared the guard by reasoning about a *race* ("closed by the plan's mandatory row
lock"); the adversarial case that actually breaks it is not a race but two ordinary
sequential same-day postpones producing an identical `new_due_on`. Treat the identity-based
correction as revisiting an accepted trade-off, not as fixing an oversight.
