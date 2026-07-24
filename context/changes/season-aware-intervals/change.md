---
change_id: season-aware-intervals
title: Season aware intervals
status: implementing
created: 2026-07-23
updated: 2026-07-24
archived_at: null
---

## Notes

- Fixed application-wide season model: growing season is March 1 through October 31, inclusive; dormancy is November 1 through February's final day.
- The season active on the browser-local schedule-creation date selects the interval. Crossing a boundary does not rewrite an existing due date.
