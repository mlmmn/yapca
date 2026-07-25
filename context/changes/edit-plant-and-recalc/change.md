---
change_id: edit-plant-and-recalc
title: Edit plant and recalc
status: impl_reviewed
created: 2026-07-25
updated: 2026-07-25
archived_at: null
---

## Notes

Shaped against `context/foundation/prd.md` (FR-006 and the deterministic scheduling guardrail),
`context/foundation/roadmap.md` (S-06), the existing plant-detail/journal flow, and the committed
YAPCA Field Notebook visual system in `PRODUCT.md` and `DESIGN.md`.

### Shaping outcome

- Add an `Edit plant` entry point to the existing plant detail header. Keep the detail page read-only
  for watering history and leave delete to S-07.
- Use a production-ready responsive edit flow for name, growing-season interval, dormancy-season
  interval, photo replacement, and explicit photo removal.
- Preserve `next_due_on` for name/photo-only edits. When either interval changes, recalculate the
  stored due date server-side by shifting the current due date by the difference between the old and
  new interval selected for the season active on the user's local save date. This preserves the
  current schedule phase, keeps overdue status honest, and is deterministic without rewriting journal
  history.
- Show the exact recalculated due date in the form before save and again on the detail page after a
  successful save. No confirmation modal is needed; the preview is the confirmation.
- Preserve the restrained Field Notebook direction: true-white paper, ink-led hierarchy, canopy green
  only for the primary save action/focus, flat surfaces, Figtree, sentence case, no decorative plant
  artwork, and no new feature-local tokens.
- Use the current user's timezone/date authority for the preview and mutation. The server remains the
  final authority; a stale or failed save leaves the form intact and explains what to retry.

See `design.md` for the complete UX/UI brief and acceptance checklist.
