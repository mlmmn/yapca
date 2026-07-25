# Edit Plant and Schedule Recalculation — Plan Brief

> Full plan: `context/changes/edit-plant-and-recalc/plan.md`
> Design brief: `context/changes/edit-plant-and-recalc/design.md`

## What & Why

Nothing in the app can change a plant after it is created — the only write path to the `plants` row is
`addPlant`. This slice (roadmap S-06, PRD FR-006) adds editing for name, both season intervals, and photo,
so a user can correct a cadence instead of deleting and recreating the plant and losing its watering
journal. The load-bearing requirement is not that the form submits, but that the user can answer three
questions before committing: which values am I changing, which season's interval is active today, and what
will the next due date become?

## Starting Point

The plant detail page renders the record read-only, with the journal below it. The schedule machinery needed
for an honest preview is already in place: `Astro.locals.today` gives the user's calendar day
(`src/middleware.ts`, landed with S-08), `getSeason()` encodes the March–October growing window, and
`toEpochDay`/`fromEpochDay` do timezone-independent calendar math. `plants` already carries a
trigger-maintained `updated_at`, and `add-plant-form.tsx` is a close structural template — including a
`form.Subscribe` block that already derives a season-aware consequence from live interval values.

Three values are already duplicated across files (the 4 MB photo limit and MIME list, the signed-URL TTL, and
the season rule). The edit flow needs all three, so it must consume shared ones or compound the drift the
lessons register warns about.

## Desired End State

A quiet `Edit plant` action in the plant detail header leads to a linkable, refreshable `/plants/<id>/edit`
with fields prefilled from the record. As the user changes an interval, a preview states in plain sentences
which season is active and what the exact next due date will become — including when the shift lands in the
past. Saving redirects to plant detail, which shows the server's authoritative record with the journal
completely unchanged.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| -------- | ------ | ---------------- | ------ |
| Recalculation rule | `next_due_on = oldNextDue + (newActiveInterval − oldActiveInterval)` | Preserves the current schedule phase and overdue honesty without rewriting journal history. | Design |
| Season boundaries | Growing Mar 1–Oct 31; dormancy Nov 1–end of Feb | Already encoded in `season.ts` and `mark_watered`. | Design |
| Journal on edit | Never written, never rewritten | The journal records what happened, not what is now planned. | Design |
| Update boundary | Conditional `UPDATE` in a new `updatePlant` action | One guarded `UPDATE` is already atomic in Postgres, so it needs no migration and adds no third copy of the season rule. | Plan |
| Concurrency token | Existing `updated_at`, round-tripped verbatim | Trigger-maintained already; a `version` column would be a migration for no added safety. | Plan |
| Stale-guard scope | Page-load token, enforced only when the save writes `next_due_on` | Catches a delta landing on a date the user never previewed, while a name-only fix is never blocked by a concurrent watering. | Plan |
| Past-landing shift | Keep pure delta arithmetic, state the overdue consequence in words | Clamping would make the rule non-invertible; text-first keeps meaning off color alone. | Plan |
| Photo code sharing | Share constants + validation via `src/lib/photo.ts`; keep each form's JSX local | Kills the constant duplication without refactoring an already-shipped form. | Plan |
| Post-save behavior | Plain redirect to plant detail, no toast | Matches `addPlant`'s precedent and guarantees the server record, not the client preview, is what the user sees. | Plan |

## Scope

**In scope:** `Edit plant` entry point on detail · `/plants/<id>/edit` route · name, both intervals, photo
replace/remove/undo · live exact-date preview · `updatePlant` action with CAS guard and photo lifecycle ·
validation, submitting, conflict, network-failure, invalid-photo, and not-found states · responsive,
keyboard, dark, and reduced-motion coverage.

**Out of scope:** delete/archive (S-07) · any watering mutation from the edit page · journal editing or
notes · migrations and new SQL functions · a confirmation modal or unsaved-changes prompt · test tooling ·
refactoring `add-plant-form`'s photo markup or the two batch signed-URL call sites · new design tokens.

## Architecture / Approach

One shared pure function, `resolveScheduleChange` in `src/lib/schedule.ts`, is called by **both** the client
preview and the server action, so they cannot disagree on a date. The server remains the sole authority: it
re-reads the row, recomputes the date from the fresh values, and commits through a single `UPDATE` guarded on
the `updated_at` the form was rendered with — compare-and-swap, so zero affected rows means conflict. The
guard is attached only when `next_due_on` is actually being written.

Photo storage is ordered upload-new → write-row → delete-old, with cleanup of the new object if the row write
fails. No object is deleted before the database state is durable.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| ----- | ---------------- | -------- |
| 1. Server foundation + `updatePlant` | `src/lib/photo.ts`, `src/lib/schedule.ts`, the action with CAS guard and photo lifecycle; existing consumers repointed | Repointing `addPlant` and the add form at shared constants could regress a shipped flow; the `updated_at` token must round-trip without reformatting |
| 2. Route, island, entry point | `/plants/<id>/edit`, `edit-plant-form`, the detail-header action — happy path and field validation | Preview copy must cover six distinct cases (moved, today, past, unchanged, invalid, unknown timezone) without ever fabricating a date |
| 3. Failure states + a11y hardening | Conflict, offline, invalid-photo, not-found recovery; focus, live-region restraint, 320px/200%/dark/reduced-motion | Broad manual surface with no automated tests to catch regressions |

**Prerequisites:** S-01, S-02, and S-08 complete (all landed). Local Supabase stack running for manual
verification.
**Estimated effort:** ~3 sessions, one per phase; Phase 2 is the largest.

## Open Risks & Assumptions

- `addPlant` still accepts a whitespace-only name while the edit path trims — a deliberate scope exclusion,
  candidate for S-09's polish pass.
- The season rule stays duplicated between `src/lib/season.ts` and `mark_watered`; this plan adds no third
  site but does not remove the pair.
- A storage orphan can survive a failed post-write delete. Logged, never surfaced, never retried here.
- No automated tests exist, so Phase 3's guarantees rest entirely on the manual matrix.

## Success Criteria (Summary)

- Changing an active interval moves the next due date by exactly the delta, in the direction the preview
  predicted, and the saved detail page agrees.
- Editing a name, a photo, or only the inactive season leaves the due date and the journal untouched.
- A concurrent watering cannot be silently overwritten by a stale interval edit — and cannot block an
  unrelated name fix either.
- No photo is ever lost on cancel, on a rejected file, or on a failed save.
