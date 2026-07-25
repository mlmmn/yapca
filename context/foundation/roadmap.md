---
project: "YAPCA (Yet Another Plant Care App)"
version: 1
status: draft
created: 2026-07-19
updated: 2026-07-25
prd_version: 1
main_goal: quality
top_blocker: time
---

# Roadmap: YAPCA (Yet Another Plant Care App)

> Derived from `context/foundation/prd.md` (v1) + auto-researched codebase baseline.
> Edit-in-place; archive when superseded.
> Slices below are listed in dependency order. The "At a glance" table is the index.

## Vision recap

A hobbyist with dozens of houseplants can no longer track watering from memory: different plants want water on different cadences, and "what do I water today, and what did I miss?" becomes error-prone at collection scale. YAPCA replaces that mental load with a single daily task list driven by per-plant intervals. This is deliberately a personal-fit foundation, not a differentiated product — the PRD records that there is no MVP-level **product wedge** (the one distinguishing trait that would set it apart from existing plant apps) and defers differentiation to post-MVP. The build's value therefore lives in getting the core loop *correct*: deterministic interval math, recoverable actions, and strict per-account data isolation.

## North star

**S-01: Core watering loop** — a signed-in user adds a plant, sees it due on today's list, marks it Watered, and it reschedules exactly one interval (today + interval) later. This is the validation milestone: the PRD states "the loop working is the product working," so shipping this first proves the whole product hypothesis under the `quality` goal.

> "North star" here means the smallest end-to-end slice whose successful delivery would prove the core product works — placed as early as its prerequisites allow, because every other slice only matters if this one holds.

## At a glance

| ID   | Change ID                    | Outcome (user can …)                                          | Prerequisites | PRD refs                | Status   |
| ---- | ---------------------------- | ------------------------------------------------------------ | ------------- | ----------------------- | -------- |
| F-01 | finish-auth-and-route-gating | (foundation) sign up / sign in / sign out; app requires session | —             | FR-001, FR-002, Access Control | done     |
| S-01 | core-watering-loop           | add a plant, see it due today, mark Watered → reschedules 1 interval later | F-01          | FR-004, FR-009, FR-011  | proposed |
| S-02 | plant-detail-and-journal     | open a plant and see its details + watering journal          | S-01          | FR-005, FR-014          | proposed |
| S-03 | overdue-tasks-and-urgency    | see overdue tasks with a non-color-only urgency cue and clear them | S-01          | FR-009, FR-010          | proposed |
| S-04 | postpone-and-undo            | postpone a task 2 days; undo a Watered/Postpone misclick      | S-01, S-02    | FR-012, FR-013          | proposed |
| S-05 | season-aware-intervals       | set growing + dormancy intervals; app auto-applies by date    | S-01          | FR-008, FR-015          | blocked  |
| S-06 | edit-plant-and-recalc        | edit name/intervals/photo; interval change recalculates next due | S-01, S-02    | FR-006                  | proposed |
| S-07 | delete-plant                 | delete a plant                                                | S-01          | FR-007                  | proposed |
| S-08 | user-timezone-dates          | (correctness) see "Due today" mean today where *they* are, on every page | S-02          | FR-009, FR-011, NFR (deterministic math) | ready |
| S-09 | design-review-and-polish     | (quality) have the whole app design/UI/UX-reviewed with impeccable, triaged, and fixed | F-01, S-01–S-04, S-06, S-07, S-08 | quality goal, a11y NFR, DESIGN.md/PRODUCT.md | proposed |

## Streams

Navigation aid — groups items that share a Prerequisites chain. Canonical ordering still lives in the dependency graph below; this table is the proposed reading order across parallel tracks.

| Stream | Theme               | Chain                              | Note                                                                       |
| ------ | ------------------- | ---------------------------------- | -------------------------------------------------------------------------- |
| A      | Account & core loop | `F-01` → `S-01`                    | The spine; F-01 unlocks the north star S-01, which every other stream forks from. |
| B      | Plant record & history | `S-02` → `S-04` / `S-06`         | Forks off `S-01`. Detail view + journal, then undo (journal-backed) and edit. |
| C      | Daily triage        | `S-03`                             | Forks off `S-01`. Overdue surfacing + a11y urgency cue; parallel with Stream B. |
| D      | Season model        | `S-05`                             | Forks off `S-01`. Blocked until the season-boundary dates are decided (ORQ-2). |
| E      | Plant lifecycle     | `S-07`                             | Forks off `S-01`. Standalone delete; parallel with Streams B/C/D.          |
| F      | Calendar correctness | `S-02` → `S-08`                   | Forks off `S-02`. Makes the user's timezone — not the Worker's UTC clock — the calendar authority for every server-rendered date. Parallel with Streams B/C/D/E. |
| G      | Cross-cutting polish | `(all UI slices)` → `S-09`         | Terminal. Does not fork from `S-01`; converges every other stream — the final `impeccable` design/UI/UX pass over the assembled app. |

## Baseline

What's already in place in the codebase as of 2026-07-19 (auto-researched + user-confirmed).
Foundations below assume these are present and do NOT re-scaffold them.

- **Frontend:** present — Astro 6 + React 19 + Tailwind 4 wired; `src/pages/index.astro` is a placeholder, one shadcn `src/components/ui/button.tsx`, `src/layouts/layout.astro`. No feature UI yet.
- **Backend / API:** present — Astro SSR on `@astrojs/cloudflare`; auth API routes exist (`src/pages/api/auth/{signin,signup,signout}.ts`). No plant/task routes.
- **Data:** absent — `@supabase/ssr` + `supabase-js` installed and `supabase/config.toml` present, but `supabase/migrations/` does not exist. No schema, no tables, no RLS yet.
- **Auth:** partial — `@supabase/ssr` cookie client (`src/lib/supabase.ts`) + `src/middleware.ts` resolving `context.locals.user`, but `PROTECTED_ROUTES` is empty (nothing gated) and there are no auth UI pages (routes redirect to `/auth/signin` and `/auth/confirm-email`, which don't exist).
- **Deploy / infra:** present — `wrangler.jsonc`, `@astrojs/cloudflare`, `.github/workflows/ci.yml`.
- **Observability:** absent — no Sentry/Datadog/OTel. PRD implies none is needed for the MVP.

## Foundations

### F-01: Finish auth and route gating

- **Outcome:** (foundation) a user can register, sign in, and sign out through the UI, app routes require an authenticated session, and an unauthenticated visitor lands on a minimal signed-out entry (replacing the placeholder root) that routes to sign in / create account — the backend auth routes that already exist are now reachable and enforced end-to-end.
- **Change ID:** finish-auth-and-route-gating
- **PRD refs:** FR-001, FR-002, Access Control
- **Unlocks:** S-01 (the north star, and every downstream slice — all require a signed-in user); the per-account isolation NFR that every RLS policy in S-01+ depends on (RLS predicates need a real `auth.uid()`).
- **Prerequisites:** —
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Sequenced first because nothing user-facing works without a session and the baseline auth is a backend-only shell (routes exist; no UI, empty `PROTECTED_ROUTES`, placeholder `index.astro`). Scope is deliberately minimal — sign-up/in/out UI + gating + a bare signed-out entry (logo + auth CTA, not a marketing page — see ORQ-3); account deletion (FR-003, nice-to-have) is parked, not bundled here. Risk if skipped: RLS policies written later would have no authenticated principal to key on.
- **Status:** done

## Slices

### S-01: Core watering loop

- **Outcome:** user can add a plant (name, watering interval, optional photo), see it on today's due list, and mark it Watered so it reschedules exactly one interval later (today + interval).
- **Change ID:** core-watering-loop
- **PRD refs:** FR-004, FR-009, FR-011, NFR (deterministic interval math), NFR (per-account data isolation)
- **Prerequisites:** F-01
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** The north star and the heaviest slice by design — it stands up the `plants` table with per-account RLS and the deterministic interval-math module, the two "invest deeply in data" pieces. Kept to a single interval so the loop proves determinism without waiting on the season model (S-05); the growing/dormancy split lands in S-05. Main risk: interval math that drifts across repeated cycles would violate the core Success Criterion, so this slice carries the determinism verification.
- **Status:** proposed

### S-02: Plant detail view + watering journal

- **Outcome:** user can open a plant and see its details plus a per-plant watering journal (the history of Watered/Postpone actions).
- **Change ID:** plant-detail-and-journal
- **PRD refs:** FR-005, FR-014
- **Prerequisites:** S-01
- **Parallel with:** S-03, S-05, S-07
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Sequenced before postpone/undo (S-04) because the PRD states the journal is load-bearing for undo — it is the record of actions that undo reverses. Building the journal first means undo has a persisted history to reverse against rather than inventing ad-hoc state.
- **Status:** proposed

### S-03: Overdue tasks + urgency cue

- **Outcome:** user can see overdue tasks carried over from previous days alongside today's, distinguished by an urgency cue that does not rely on color alone, and clear them the same way as today's tasks.
- **Change ID:** overdue-tasks-and-urgency
- **PRD refs:** FR-009, FR-010, US-02, NFR (urgency perceivable without color alone)
- **Prerequisites:** S-01
- **Parallel with:** S-02, S-04, S-05, S-06, S-07
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Not deferred behind other feature slices because the `quality` goal treats the color-not-alone a11y NFR as launch-gating, not polish. Depends only on S-01 (the task list must exist first). Risk: overdue carry-over that silently drops tasks would defeat the product's whole reason for existing (memory fails).
- **Status:** proposed

### S-04: Postpone + undo

- **Outcome:** user can postpone a watering task by exactly 2 days, and undo a "Watered" or "Postpone" action after a misclick.
- **Change ID:** postpone-and-undo
- **PRD refs:** FR-012, FR-013, US-01 (acceptance)
- **Prerequisites:** S-01, S-02
- **Parallel with:** S-03, S-05, S-06, S-07
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Depends on S-02 because undo reverses journaled actions; without the journal, undo scope is ambiguous (the exact concern the PRD's FR-013 note raises). Postpone must shift a single task by 2 days without altering the plant's base interval — a subtle correctness boundary this slice must hold.
- **Status:** proposed

### S-05: Season-aware intervals

- **Outcome:** user can set two separate watering intervals per plant (growing season and dormancy season), and the app automatically applies the one matching the current calendar date.
- **Change ID:** season-aware-intervals
- **PRD refs:** FR-008, FR-015
- **Prerequisites:** S-01
- **Parallel with:** S-02, S-03, S-04, S-06, S-07
- **Blockers:** —
- **Unknowns:**
  - What are the calendar boundaries between growing and dormancy season, and are they fixed or user-configurable? — Owner: user. Block: yes.
- **Risk:** Blocked until the season-boundary decision (ORQ-2) resolves — automatic date-based selection cannot be implemented correctly without knowing the boundary dates (and whether they're user-adjustable). Sequencing it here, after the single-interval loop (S-01), avoids prejudging the answer: the loop already works on one interval, so this slice is a clean extension rather than a rework.
- **Status:** blocked

### S-06: Edit plant + interval recalculation

- **Outcome:** user can edit a plant's name, intervals, and photo, and changing an interval correctly recalculates the plant's next due date.
- **Change ID:** edit-plant-and-recalc
- **PRD refs:** FR-006
- **Prerequisites:** S-01, S-02
- **Parallel with:** S-03, S-04, S-05, S-07
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Edit lives on the plant detail view (S-02). Correct recalculation on interval change is an explicit PRD guardrail — the risk is a stale next-due date after an edit. If S-05 (season intervals) is already done, edit covers both intervals; if planned first, it covers the single interval and is revisited when S-05 lands.
- **Status:** proposed

### S-07: Delete plant

- **Outcome:** user can delete a plant at any time.
- **Change ID:** delete-plant
- **PRD refs:** FR-007
- **Prerequisites:** S-01
- **Parallel with:** S-02, S-03, S-04, S-05, S-06
- **Blockers:** —
- **Unknowns:**
  - Hard delete vs archive (the journal is lost on hard delete) — Owner: user. Block: no. PRD defers this ("archive-vs-delete deferred if it matters"); default to hard delete.
- **Risk:** Small, standalone CRUD slice depending only on the plant record (S-01). Delete must also clean up the plant's tasks/journal under RLS so no orphaned rows leak across the account boundary.
- **Status:** proposed

### S-08: User-timezone date authority

- **Outcome:** every server-rendered surface reports dates in the user's own calendar day — "Due today" means today where the user is, not where the Worker is — so All plants and plant detail agree with Today about what day it is.
- **Change ID:** user-timezone-dates
- **PRD refs:** FR-009, FR-011, NFR (deterministic interval math), PRODUCT.md "deterministic and honest"
- **Prerequisites:** S-02
- **Parallel with:** S-03, S-04, S-05, S-06, S-07
- **Blockers:** —
- **Unknowns:**
  - What does the very first request render, before the timezone cookie exists? — Owner: user. Block: no. Default: render the exact date (`Due 3 Aug`) and omit the "today" phrasing until the cookie lands — never guess a day.
- **Risk:** Fixes a live bug, not a missing feature. `todayLocalDateString()` (`src/lib/date.ts:31`) reads the host machine's local date; on Cloudflare Workers that is always UTC, and two pages call it during SSR (`src/pages/plants/index.astro:54`, `src/pages/plants/[id].astro:74`) before passing it to `formatDueLabel`. For a user at UTC+13 the Worker's day and the user's day disagree from midnight until 12:59 — over half of every day — so `/plants` shows `Due 1 Mar` for a plant that is due today, and `Due today` for one that is already overdue. Today's list is unaffected because it hydrates from the browser (`today-list.tsx:241-245`), which is exactly why the two pages can contradict it. The approach: capture the browser's IANA timezone once into a cookie, read it in the existing `src/middleware.ts`, and expose `context.locals.today` so pages render a correct date server-side. Sequenced after S-02 (the surfaces must exist) and before the terminal design pass (S-09) so the review sees corrected labels. **Supersedes the workaround in S-05** — season-aware-intervals patches these two labels client-side because it would otherwise put two disagreeing clocks on one line; this slice removes that patch and fixes the class of bug instead. Risk if skipped: every future server-rendered date surface (S-06's edit preview first) repeats the same mistake, and the workaround calcifies into the pattern.
- **Status:** ready

### S-09: Design/UI/UX review + polish

- **Outcome:** every user-facing surface — signed-out auth entry, today's due list, plant detail + watering journal, add/edit plant forms, overdue treatment, postpone/undo affordances, delete — is reviewed with the `impeccable` skill against the `DESIGN.md` visual system and the `PRODUCT.md`/`AGENTS.md` register and WCAG 2.2 AA-plus bar; the findings are triaged (severity-ranked) and the accepted fixes applied.
- **Change ID:** design-review-and-polish
- **PRD refs:** `main_goal: quality`, NFR (overdue cue perceivable without color alone), NFR (daily list feels instant), DESIGN.md / PRODUCT.md visual system (design context, not a numbered FR)
- **Prerequisites:** F-01, S-01, S-02, S-03, S-04, S-06, S-07, S-08
- **Parallel with:** — (terminal; nothing forks off it)
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Unlike S-01–S-07 this is a **horizontal, cross-cutting quality pass, not a vertical feature slice** — it ships no new user capability; it raises the quality of everything already shipped. Sequenced last because the botanical-with-editorial-restraint personality and the `quality` goal only verify holistically once the app is whole: reviewing surfaces slice-by-slice misses cross-surface inconsistency (spacing rhythm, type scale, the color-not-alone overdue cue read against the rest of the palette). If skipped, the `quality` goal and the launch-gating a11y NFR are never checked against the assembled product. S-05 caveat: if season-aware intervals (S-05) has shipped, its surfaces are covered here; if S-05 is still blocked, the review runs on what exists and S-05's surfaces are revisited when it lands.
- **Status:** proposed

## Backlog Handoff

| Roadmap ID | Change ID                    | Suggested issue title                              | Ready for `/10x-plan` | Notes                                             |
| ---------- | ---------------------------- | -------------------------------------------------- | --------------------- | ------------------------------------------------- |
| F-01       | finish-auth-and-route-gating | Finish auth: sign-up/in/out UI + route gating      | yes                   | Run `/10x-plan finish-auth-and-route-gating` — unlocks the north star |
| S-01       | core-watering-loop           | Core watering loop (add → due today → Watered)     | no                    | Prereq F-01; becomes ready once F-01 is done      |
| S-02       | plant-detail-and-journal     | Plant detail view + watering journal               | no                    | Prereq S-01                                       |
| S-03       | overdue-tasks-and-urgency    | Overdue tasks + non-color-only urgency cue         | no                    | Prereq S-01                                       |
| S-04       | postpone-and-undo            | Postpone 2 days + undo misclick                    | no                    | Prereq S-01, S-02                                 |
| S-05       | season-aware-intervals       | Season-aware growing/dormancy intervals            | no                    | Blocked on ORQ-2 (season boundary dates)          |
| S-06       | edit-plant-and-recalc        | Edit plant + next-due recalculation                | no                    | Prereq S-01, S-02                                 |
| S-07       | delete-plant                 | Delete a plant                                     | no                    | Prereq S-01                                       |
| S-08       | user-timezone-dates          | Make the user's timezone the SSR calendar authority | yes                  | Prereq S-02 (done). Run `/10x-plan user-timezone-dates` — supersedes the client-side date patch in S-05 |
| S-09       | design-review-and-polish     | Full design/UI/UX review + polish (impeccable pass) | no                   | Prereq F-01 + all UI slices incl. S-08; run last. Not a `/10x-plan` feature slice — an `impeccable` review + fix pass |

## Open Roadmap Questions

1. **What is the MVP-level differentiator (if any)?** — Owner: user. Block: `roadmap-wide` (non-blocking). Deferred to post-MVP by design; the MVP is a personal foundation. Worth naming before any wider release, but it gates no slice.
2. **What are the calendar boundaries between growing and dormancy season, and are they fixed or user-configurable?** — Owner: user. Block: `S-05`. Resolving this promotes S-05 from `blocked` to `proposed`.
3. **Does the MVP want a real marketing landing page, or is the bare auth-gateway root (delivered in F-01) sufficient?** — Owner: user. Block: `roadmap-wide` (non-blocking). No PRD FR/US covers a marketing surface, and the MVP has no stated differentiator to sell yet. If the answer is "yes, build one," it becomes a new post-MVP slice (traced to whatever FR/US you add first); until then F-01's minimal signed-out entry stands.

## Parked

- **Account deletion (FR-003)** — Why parked: nice-to-have in the PRD (demoted from must-have), and under the `time` blocker non-essentials are deferred rather than sequenced. Its Success Criterion was softened so nothing depends on it for the MVP.
- **Advanced plant-science model** — Why parked: PRD §Non-Goals — modeling substrate/pot/species/light/humidity would undermine the core simplicity bet; cadence stays a fixed user-entered interval.
- **Other care tasks (fertilize, clean, repot, flush)** — Why parked: PRD §Non-Goals — MVP is watering-only to keep the loop and data model small.
- **Future-tasks / upcoming-schedule view** — Why parked: PRD §Non-Goals — user sees today + overdue only; avoids a calendar/forecast surface.
- **Skip-without-watering task action** — Why parked: PRD §Non-Goals — only "Watered" and "Postpone 2 days" exist; prevents extra state/UX branches.
- **Native mobile apps** — Why parked: PRD §Non-Goals — responsive web only for the MVP.
- **Push / email reminders** — Why parked: PRD §Non-Goals — the daily list is pull, not push.
- **Shared / household collections** — Why parked: PRD §Non-Goals — strictly single-owner per account; locks the flat, single-tenant access model.

## Done

(Empty on first generation. `/10x-archive` appends here — and flips that item's `Status` to `done` — when a change whose `Change ID` matches an item is archived.)

- **F-01: (foundation) a user can register, sign in, and sign out through the UI, app routes require an authenticated session, and an unauthenticated visitor lands on a minimal signed-out entry (replacing the placeholder root) that routes to sign in / create account — the backend auth routes that already exist are now reachable and enforced end-to-end.** — Archived 2026-07-25 → `context/archive/2026-07-19-finish-auth-and-route-gating/`. Lesson: —.
