---
change_id: testing-task-list-and-mutation-integrity
title: Task-list and mutation integrity rollout phase
status: archived
created: 2026-07-28
updated: 2026-07-31
archived_at: 2026-07-31T21:58:52Z
---

## Notes

Open a change folder for rollout Phase 2 of context/foundation/test-plan.md: "Task-list and mutation integrity".
Risks covered: #2, #3, #4. Test types planned: integration.
Risk response intent:
- Risk #2: prove that due and overdue tasks are present in the daily list when expected, and not silently filtered out.
- Risk #3: prove that editing name, intervals, and photo persists the full record intact and recalculates next-due correctly.
- Risk #4: prove that water / postpone / undo sequences leave schedule and journal in a consistent state.
After creating the folder, follow the downstream continuation rule.
