---
project: "YAPCA (Yet Another Plant Care App)"
version: 1
status: draft
created: 2026-07-19
context_type: greenfield
product_type: web-app
target_scale:
  users: small
  qps: low
  data_volume: small
timeline_budget:
  mvp_weeks: 3
  hard_deadline: 2026-09-14
  after_hours_only: true
---

# PRD — YAPCA (Yet Another Plant Care App)

## Vision & Problem Statement

A hobbyist plant owner with a sizable collection (dozens or more houseplants) relies on their own memory to track which plants need watering and when. At collection scale this breaks down in three ways: the daily "what do I water today?" decision becomes tedious and error-prone; the owner loses track across many plants that each have different watering intervals (decision paralysis); and the knowledge of "when did I last water this one?" lives only in their head and evaporates. The cost is real care mistakes — over- or under-watering — that leave plants sick or dead.

This is a personal-fit project. The builder is not claiming an MVP-level competitive edge over the many existing plant-care apps; the intended differentiation is fitting the builder's own needs and preferences, and that is deferred to post-MVP. The MVP is deliberately a foundation to build on, not a differentiated product. (See Open Questions — the absence of an MVP-level wedge is recorded, not resolved.)

## User & Persona

**Primary persona — Hobbyist with a large collection.** A private individual who keeps dozens or more houseplants at home. Their collection has grown past the point where memory reliably scales: different plants want water on different cadences, and the mental overhead of tracking it all is what drives the errors. They reach for this product at the moment of the daily watering decision — opening it to answer "what needs water today, and what did I miss?"

## Success Criteria

### Primary
- A user can complete the core watering loop end-to-end: add a plant (name, watering intervals, photo), see it on today's task list, and mark it "Watered" or "Postpone 2 days" without error. The loop working is the product working.
- The simplified frequency model behaves predictably: a plant set to "every 3 days" disappears from the list when marked watered and reappears exactly 3 days later.

### Secondary
- None. For the MVP the core loop is the whole point; no nice-to-have is tracked as a success signal.

### Guardrails
- Interval math is deterministic and predictable — the reappearance date is exactly the interval, never approximate.
- Changing a plant's intervals correctly recalculates its next due date.
- A misclick on "Watered" / "Postpone" is recoverable via undo.
- A user can delete a plant at any time. (Account deletion is supported but nice-to-have — see FR-003; it is not a hard guardrail for the MVP.)

## User Stories

### US-01: User adds a plant and waters it through the daily list

- **Given** a signed-in user
- **When** they add a plant with a name and its watering intervals (and optionally a photo)
- **Then** the plant appears on the appropriate day's watering task list, and marking it "Watered" removes it from the list and reschedules it exactly one interval later

#### Acceptance Criteria
- A plant set to "every 3 days" reappears exactly 3 days after being marked watered.
- The active interval used is the one matching the current season (growing vs dormancy).
- "Postpone 2 days" moves the task exactly 2 days forward without altering the base interval.
- A misclick on "Watered" or "Postpone" can be undone.

### US-02: User sees and clears overdue tasks

- **Given** a user who missed watering tasks on previous days
- **When** they open today's task list
- **Then** overdue tasks appear alongside today's, marked with a clear urgency indicator, and can be cleared the same way as today's tasks

#### Acceptance Criteria
- Overdue tasks are visually distinct from tasks due today (warning/urgent styling).
- Overdue tasks are not silently dropped — they persist until acted on.

## Functional Requirements

### Accounts
- FR-001: User can register an account with an email and password. Priority: must-have
  > Socrates: Counter considered: "a personal single-user MVP could skip auth and use a
  > local profile." Resolution: kept — real accounts are a deliberate foundation choice.
- FR-002: User can sign in and sign out. Priority: must-have
  > Socrates: Counter considered: "sign-out is unused on a personal device." Resolution:
  > kept — table stakes for a multi-user accounts model.
- FR-003: User can delete their account and all its data at any time. Priority: nice-to-have
  > Socrates: Counter considered: "account deletion proves nothing about the watering
  > loop; it's not core-loop value." Resolution: demoted from must-have to nice-to-have;
  > the corresponding success criterion is softened so the two no longer contradict.

### Plant management
- FR-004: User can add a plant with a name, watering intervals, and an optional photo. Priority: must-have
  > Socrates: Counter considered: "requiring both intervals up front and photo upload adds
  > friction/scope." Resolution: kept — name + intervals + optional photo is the minimal plant.
- FR-005: User can view a plant's details. Priority: must-have
  > Socrates: Counter considered: "a detail view is redundant with the list." Resolution:
  > kept — it hosts editing and the watering journal.
- FR-006: User can edit a plant's name, intervals, and photo. Priority: must-have
  > Socrates: Counter considered: "mid-cycle interval edits are fiddly; delete+recreate is
  > simpler." Resolution: kept — correct recalculation on interval change is a guardrail.
- FR-007: User can delete a plant. Priority: must-have
  > Socrates: Counter considered: "hard delete loses the journal; archive instead."
  > Resolution: kept as delete — expected CRUD; archive-vs-delete deferred if it matters.
- FR-008: User can set two separate watering intervals per plant — one for the growing season and one for the dormancy season. Priority: must-have
  > Socrates: Counter considered: "one interval is simpler; the season split could be
  > post-MVP." Resolution: kept — the explicit growing/dormancy split is core to the idea.

### Watering tasks
- FR-009: User can see watering tasks due today, including overdue tasks carried over from previous days. Priority: must-have
  > Socrates: Counter considered: "carrying overdue forward clutters the list." Resolution:
  > kept — surfacing overdue is central, since the whole problem is that memory fails.
- FR-010: User can visually distinguish overdue tasks via an urgency indicator. Priority: must-have
  > Socrates: Counter considered: "urgency styling is polish, not function." Resolution:
  > kept — making overdue unmissable is core to the value.
- FR-011: User can mark a watering task as "Watered", which schedules the next occurrence as the actual watering date (today) plus the plant's current active interval. Priority: must-have
  > Socrates: Counter considered: "rescheduling from the interval ignores early/late
  > watering." Resolution: refined — next due = today (actual watering date) + interval,
  > so the clock resets from when the plant is actually watered, not from the original due date.
- FR-012: User can postpone a watering task by 2 days. Priority: must-have
  > Socrates: Counter considered: "why fixed at 2 days / overlaps with watering later."
  > Resolution: kept — a fixed 2-day defer is a deliberate, simple affordance.
- FR-013: User can undo a "Watered" or "Postpone" action after a misclick. Priority: must-have
  > Socrates: Counter considered: "a confirm dialog is simpler; undo scope is ambiguous."
  > Resolution: kept — undo-on-misclick is an explicit success criterion.
- FR-015: The app automatically determines each plant's active season (growing vs dormancy) from the calendar date and applies the matching interval. Priority: must-have
  > Socrates: Counter considered: "automatic switching hides logic; global dates fit no one
  > perfectly." Resolution: kept — automatic date-based seasons keep the daily UX zero-effort;
  > exact boundary dates and configurability tracked in Open Questions.

### History
- FR-014: User can view a per-plant watering journal (task history) on the plant's view. Priority: must-have
  > Socrates: Counter considered: "the loop works without a log; it could be cut if time is
  > tight." Resolution: kept — the user notes the journal is essential to undo (it is the
  > record of actions that undo reverses), so it is load-bearing, not optional polish.

## Non-Functional Requirements

- Interval math is deterministic: a plant with an interval of N days reappears exactly N days after it is marked watered, with no approximation and no drift accumulating across repeated cycles.
- Data is isolated per account: a user's plants, photos, and watering history are visible only to that user's account, and no plant or task data crosses between users.
- The overdue urgency cue is perceivable without relying on color alone (e.g. also an icon, label, or shape), so color-blind users can still distinguish overdue tasks.
- The daily task list feels instant: on a typical consumer connection and device, the list of due and overdue tasks is rendered in well under one second.

## Business Logic

For each plant, the app computes the next watering date as the actual watering date plus a user-defined interval selected by the current season (growing vs dormancy, determined by the calendar date), and surfaces the resulting due and overdue tasks as a single daily list.

The rule consumes three user-facing inputs: the plant's growing-season interval, its dormancy-season interval, and the moments the user marks a plant watered or postpones it. From these it produces a next-due date per plant and, aggregated across the collection, the day's task list — everything due today plus anything still overdue from earlier. The current season is derived from the calendar date, which selects which of the two intervals is in effect at any given time.

The user encounters the rule as the daily task list (what to water now, what is overdue), as the immediate rescheduling that happens when they mark a plant watered — the plant vanishes and reappears exactly one interval later, counted from the day they watered it — and as the per-plant journal that records the history of these actions. "Postpone 2 days" shifts a single task forward by two days without changing the plant's underlying interval or its subsequent cadence.

## Access Control

Multi-user with real accounts. Authentication is email + password. A user can self-register, and can delete their own account at any time.

Flat ownership model — no roles. Every authenticated user is an equal owner of their own data and sees only their own plants and watering tasks; there is no admin, no shared collections, and no cross-user visibility. An unauthenticated visitor has no access to any plant or task data.

## Non-Goals

Functional non-goals (capabilities the MVP will not build):

- **No advanced plant-science model** — no modeling of substrate, pot, species, light, or humidity; watering cadence is purely the fixed, user-entered interval. This is the core simplicity bet; a physical model would undermine it.
- **No other care tasks** — fertilizing, cleaning, repotting, and flushing are out; the MVP is watering-only. Keeps the loop and data model small.
- **No future-tasks view** — the user sees today plus overdue only, never an upcoming schedule. Avoids a calendar/forecast surface.
- **No skipping tasks** — the only task actions are "Watered" and "Postpone 2 days"; there is no skip-without-watering. Prevents state/UX branches.
- **No native mobile apps** — web only for the MVP (responsive web is acceptable).
- **No push or email reminders** — notifications are out; the daily list is pull, not push. The user opens the app to see what's due.
- **No shared or household collections** — strictly single-owner per account; no sharing a collection across users. Locks the flat, single-tenant access model.

## Open Questions

1. **What is the MVP-level differentiator (if any)?** — The builder deferred product differentiation to post-MVP and frames the MVP as a personal foundation. Owner: user. Non-blocking for a personal project, but worth naming before any wider release.
2. ~~**What are the calendar boundaries between growing and dormancy season, and are they fixed or user-configurable?**~~ — **Resolved 2026-07-24 by the `season-aware-intervals` change.** The boundaries are fixed application-wide and not user-configurable: growing season runs March 1 through October 31 inclusive, dormancy November 1 through February's final day. The season active on the browser-local schedule-creation date selects the interval; crossing a boundary never rewrites an existing due date.
