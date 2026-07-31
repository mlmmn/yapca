---
change_id: undo-integrity-defects
title: Preserve undo integrity across colliding and edited schedules
status: new
created: 2026-07-31
updated: 2026-07-31
archived_at: null
---

## Notes

Resolve the reviewed V1 and V3 defects captured by
`src/actions/watering-sequence.integration.test.ts`: undo must reject an
out-of-order event when multiple events share a due date, and schedule-changing
plant edits must not invalidate a pending undo or leave its journal transition
inconsistent with the plant's current due date.
