# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-07-26

## 1. Strategy

Tests follow three non-negotiable principles for this project:

1. **Cost × signal.** The cheapest test that gives a real signal for the
   risk wins. Do not promote to e2e because e2e "feels safer." Do not put a
   vision model on top of a deterministic visual diff that already catches
   the regression.
2. **User concerns are first-class evidence.** Risks anchored in "the team
   is worried about X, and the failure would surface somewhere in `<area>`"
   carry the same weight as PRD lines or hot-spot data.
3. **Risks are scenarios, not code locations.** This plan documents *what
   could fail* and *why we believe it's likely* — drawn from documents,
   interview, and codebase *signal* (churn, structure, test base). It does
   NOT claim to know which line owns the failure. That knowledge is
   produced by `/10x-research` during each rollout phase. If the plan and
   research disagree about where the failure lives, research is the
   ground truth.

Hot-spot scope used for likelihood weighting: `src/`, `supabase/`
(excluding `context/`, `node_modules/`, build output). 35 commits in the
last 30 days — sufficient signal.

## 2. Risk Map

The top failure scenarios this project must protect against, ordered by
risk = impact × likelihood. Risks are failure scenarios in user / business
terms, not test names. The Source column cites the *evidence that surfaced
this risk* — never a specific file as "where the failure lives" (that is
research's job, see §1 principle #3).

| #   | Risk (failure scenario)                                                                                                                                             | Impact | Likelihood | Source (evidence — not anchor)                                                                                                                                                                                                                              |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | A task's "due today" resolves differently on the client than on the server, so the same plant appears due on one surface and not another — the user waters twice or not at all | High   | High       | interview Q1, Q3; hot-spot dir `src/lib/` — 8 commits/30d (top directory); `context/archive/2026-07-24-user-timezone-dates/`; `context/foundation/lessons.md` (helper duplicated across two components, drifted); PRD Non-Functional Requirements — deterministic, no drift |
| 2   | A due or overdue task is omitted from the daily list — the plant needs water, the list stays silent, and nothing surfaces the gap                                     | High   | High       | interview Q1; hot-spot dir `src/components/today-list/` — 5 commits/30d; PRD US-02 acceptance criteria ("overdue tasks are not silently dropped"); PRD FR-009                                                                                                 |
| 3   | Editing a plant silently drops a field, or interval recalculation produces a wrong next-due date                                                                      | High   | High       | interview Q1, Q3; hot-spot dir `src/components/edit-plant-form/` — 8 commits/30d (joint-top directory); `context/archive/2026-07-25-edit-plant-and-recalc/`; PRD Success Criteria guardrail — changing intervals correctly recalculates                        |
| 4   | Postpone or undo leaves the schedule inconsistent — the task disappears instead of shifting 2 days, or undo restores a due date that disagrees with the journal       | High   | Medium     | interview Q1, Q3 (the mutation module is changed without confidence); `context/archive/2026-07-23-postpone-and-undo/`; PRD FR-012, FR-013 (misclick must be recoverable)                                                                                      |
| 5   | One authenticated user reads or mutates another user's plant, task, or photo — ownership is not checked, only authentication                                          | High   | Medium     | PRD Non-Functional Requirements (data isolated per account); PRD Access Control (no cross-user visibility); `AGENTS.md` hard rule — RLS with granular per-operation, per-role policies; `context/archive/2026-07-19-finish-auth-and-route-gating/`             |
| 6   | The season boundary selects the wrong interval on transition days (Feb 28 → Mar 1, Oct 31 → Nov 1), so a plant gets the dormancy cadence in growing season or vice versa | Medium | High       | interview Q3 (explicit: boundary behaviour cannot be reasoned about); `context/archive/2026-07-24-season-aware-intervals/`; PRD Open Question 2 resolution (growing Mar 1–Oct 31, dormancy Nov 1–end of Feb); PRD FR-015                                       |
| 7   | A photo taken on a phone is not saved — the plant persists without it, or the save fails opaquely                                                                     | Medium | Medium     | interview Q1; hot-spot dir `src/lib/` — 8 commits/30d; PRD FR-004, FR-006 (photo optional)                                                                                                                                                                    |
| 8   | A migration destroys or orphans existing rows on deploy                                                                                                              | High   | Low        | interview Q1; hot-spot dir `supabase/migrations/` — 5 migrations, 2 in the last 3 days; `context/foundation/lessons.md` (keep local seed aligned with the database shape)                                                                                      |

Risk #8 is High-impact × Low-likelihood and is **not testable as code under
test** — every shipped migration to date is additive, so a test would have
to be written for a migration nobody has authored. Its honest response is a
CI gate that applies the migration chain to a seeded database, so it lands
in §3 Phase 5 rather than in a test phase.

Risk #5 was added by the abuse lens, not by the interview — the happy path
excludes the attacker. The product has authentication and per-account data,
the PRD names isolation as a requirement, and nothing currently proves it
holds.

**Known accepted gap on Risk #7.** Integration starts at the HTTP boundary
and therefore assumes a well-formed request. If the client island drops the
file *before* the request is sent, no test in this rollout sees it — the
user gets a silent no-op. Closing that gap needs a browser runner, which
this rollout does not buy: Risk #7 is the lowest impact × likelihood pair in
the map, and §7 excludes the UI while the design is unsettled. A browser
layer would carry real HEIC / EXIF fixtures perfectly well (Playwright ships
WebKit); the argument against it here is cost and UI churn, not capability.
Revisit per §8.

### Risk Response Guidance

| Risk | What would prove protection                                                                                                                                 | Must challenge                                                                                                                                            | Context `/10x-research` must ground                                                                                                       | Likely cheapest layer                                              | Anti-pattern to avoid                                                                                             |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| #1   | Given a user in a non-UTC zone at a boundary hour (e.g. 23:30 local, already the next day in UTC), every surface agrees on the same "today" and the same due / not-due verdict | That one canonical date helper exists — the lessons register says it did not. Also: "it works in the dev server" does not imply "it works on workerd" (`Date`/`Intl` differ) | Where the calendar date is authoritative (browser vs Worker), how the user's timezone reaches the server, which surfaces compute it independently | unit (pure date functions, fixed clock + fixed timezone)           | Running tests in the machine's ambient timezone — the test then passes only in the author's zone and proves nothing |
| #2   | Given plants due today, overdue by 1 day, and overdue by 30 days, all three appear on the list; given a plant not yet due, it does not                       | That an empty list means "nothing due" — it may mean the query silently filtered everything out. Assert the expected set is present, not merely that no error was thrown | How the due / overdue set is derived (database predicate vs in-memory filter), what the boundary comparison is, whether overdue has an upper bound | integration (seeded database → derived list)                        | Asserting the list equals whatever the current implementation returns — a tautology that green-lights the bug        |
| #3   | After editing name, both intervals, and photo, re-reading the plant returns every edited field intact, and the next-due date matches the documented recalculation from the last actual watering | That a successful save means nothing was lost — a dropped field also saves successfully. Assert the full record, not just the field you changed          | What recalculation rule applies on interval change, whether a partial update can null unedited columns, how "replace photo" differs from "keep photo" | integration (edit → full re-read)                                   | Asserting only the changed field; the data-loss defect lives in the fields you did not touch                        |
| #4   | Postpone shifts exactly +2 days and the task still appears on the list; undo restores the *previous* due date, and journal and schedule agree afterward      | That a 2xx from the mutation means the resulting state is correct. Also that undo is idempotent — a double undo must not walk backwards twice              | The mutation surface's contract, what the journal records, how undo identifies the event to reverse, whether postpone mutates the base interval | integration (mutation → re-read state + journal)                    | Testing postpone and undo in isolation only — the defect lives in the *sequence* (water → undo → postpone → undo)    |
| #5   | User B, authenticated, cannot read or mutate User A's plant, task, or photo when addressing it by direct id rather than through the UI                       | That RLS existing means RLS is correct. Per-operation policies can permit one verb while another path bypasses them. Authentication is not authorization  | Which policies exist per table / operation / role, whether mutations run under the user's session or a service key, how ownership is asserted | contract / integration (two seeded users, direct-id access)        | Testing isolation through the UI only — the UI never offers the other user's id, so the test cannot fail            |
| #6   | On each of Feb 28, Feb 29 (leap year), Mar 1, Oct 31, and Nov 1 the app selects the documented interval — growing Mar 1–Oct 31, dormancy Nov 1–end of Feb    | That "the season is right" implies "the due date is right" — the PRD states that crossing a boundary must never rewrite an existing due date              | Whether season is evaluated at schedule-creation time or at read time, and which of the two intervals an in-flight schedule keeps            | unit (table-driven over boundary dates, including a leap year)     | Testing only mid-season dates, where every implementation passes                                                    |
| #7   | A phone-shaped upload (large, HEIC / EXIF-rotated) either persists and is retrievable afterward, or fails with a message the user actually sees — never silently succeeds without the file | That a 2xx from the form means the file landed in storage — verify the object is *retrievable*, not that the request succeeded. Also that calling the upload helper directly is "integration": a direct call never meets the Worker's request body-size ceiling, which is exactly what a 12MB phone photo hits | The upload boundary (direct-to-storage vs through the Worker), size and type limits, what happens to the plant record when the upload fails   | integration **at the real HTTP boundary** — multipart request against the running Worker, using a real HEIC / EXIF-rotated fixture at phone-realistic size — plus a documented manual device smoke | Mocking the storage client — that tests the mock, not the boundary the user's phone actually hits. Equally: asserting below the HTTP layer, which silently skips multipart encoding and the body-size limit |
| #8   | Applying the full migration chain to a database holding representative rows leaves those rows intact and queryable                                           | That "the migration ran without error" means no data was lost — a destructive migration succeeds loudly and correctly                                     | Gate design only; there is no current code under test                                                                                        | CI gate (apply migrations to a seeded database, assert row survival) | Writing a unit test for a migration; the signal exists only when it runs against real data                          |

## 3. Phased Rollout

Each row is a discrete rollout phase that will open its own change folder
via `/10x-new`. Status moves left-to-right through the values below; the
orchestrator updates Status as artifacts appear on disk.

| #   | Phase name                     | Goal (one line)                                                                                            | Risks covered | Test types                                    | Status      | Change folder |
| --- | ------------------------------ | ---------------------------------------------------------------------------------------------------------- | ------------- | --------------------------------------------- | ----------- | ------------- |
| 1   | Runner bootstrap + calendar math | Every surface agrees on "today"; boundary dates select the documented interval                             | #1, #6        | test-runner setup, unit                       | complete | `context/changes/testing-runner-and-calendar-math/` |
| 2   | Task-list and mutation integrity | No due or overdue task is silently dropped; water / postpone / undo sequences leave schedule and journal consistent; edits lose nothing | #2, #3, #4    | integration                                   | not started | —             |
| 3   | Per-account isolation          | User B cannot reach User A's data by direct id, on any operation                                            | #5            | contract / integration                        | not started | —             |
| 4   | Photo upload boundary          | A phone-shaped upload is retrievable afterward, or fails visibly                                            | #7            | integration, documented manual device smoke   | not started | —             |
| 5   | Quality-gates wiring           | The floor cannot silently drop: tests, lint and typecheck gate merges; migrations proven non-destructive against seeded data | #8, cross-cutting | gates                                     | not started | —             |

Ordering rationale: nothing is testable until a runner exists, so Phase 1
bootstraps it against the top hot-spot directory using the cheapest possible
layer (pure functions, no database). Phase 2 takes the three
highest-impact risks, which need both the runner and a seeded database.
Phase 3 is logically independent but sequenced after Phase 2 so it can
reuse that seeded-database harness instead of building a bespoke one.
Phase 4 carries the lowest impact × likelihood pair and part of its signal
is genuinely manual, so it earns the least budget. Phase 5 is meaningless
before there are tests to gate on.

## 4. Stack

The classic test base for this project. AI-native tools (if any) carry a
`checked:` date so future readers can see which lines need re-verification.

| Layer                | Tool                                              | Version | Notes                                                                                                                     |
| -------------------- | ------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------- |
| unit + integration   | Vitest                                             | 4.1.10  | Configured for Node with `vite-tsconfig-paths`, which derives the `@/*` alias from `tsconfig.json`; the suite runs in UTC and in `America/New_York` in CI. checked: 2026-07-26 |
| Astro component render | none yet — optional, no phase claims it          | —       | Astro Container API (`experimental_AstroContainer`) exists if `.astro` components ever need rendering. Not scheduled — §7 excludes the UI layer. checked: 2026-07-25 |
| integration substrate | local Supabase stack (`pnpx supabase start`)     | CLI 2.x | Already a devDependency. Requires Docker. The seeded-database harness for §3 Phases 2–4.                                    |
| API mocking          | none — deliberate                                  | —       | The external boundary here is Supabase, and the local stack is real. Mocking it would test the mock (see §2 Risk #7 anti-pattern). |
| e2e                  | none — deliberate                                  | —       | No rollout phase claims a browser layer; §7 excludes the UI while the design is unsettled.                                  |
| accessibility        | `eslint-plugin-jsx-a11y`                           | 6.10.2  | Already wired into lint. The non-color-only overdue cue is a design constraint tracked in `DESIGN.md`, not an automated assertion. |
| lint + typecheck     | ESLint 9 + `astro check` / TypeScript              | 9.x / 5.9 | Already wired; `pnpm lint` runs with `--max-warnings=0`, and husky + lint-staged gate commits.                             |

**Stack grounding tools (current session):**

- Docs: Context7 — queried Astro's testing guide; confirmed `getViteConfig()` and the Container API as the current official setup; checked: 2026-07-25
- Search: Exa.ai — available, not used; the official docs answered the question directly; checked: 2026-07-25
- Runtime/browser: none — no Playwright or browser MCP is exposed in this session; not needed, since no phase plans a browser layer; checked: 2026-07-25
- Provider/platform: Cloudflare docs/search MCP available — relevant later for the §5 CI gates on the workerd runtime, not used yet; checked: 2026-07-25

## 5. Quality Gates

The full set of gates that must pass before a change reaches production.
"Required after §3 Phase N" means the gate is enforced once that rollout
phase lands; before that, the gate is planned.

| Gate                          | Where                | Required?                    | Catches                                                          |
| ----------------------------- | -------------------- | ---------------------------- | ---------------------------------------------------------------- |
| lint + typecheck              | local (husky) + CI   | required — already wired      | syntactic and type drift                                          |
| unit                          | local + CI           | required — enforced           | calendar and interval math regressions                            |
| integration                   | local + CI           | required after §3 Phase 2     | task-list omissions, mutation and recalculation defects           |
| per-account isolation         | CI on PR             | required after §3 Phase 3     | cross-user data access                                            |
| migration safety              | CI on PR             | required after §3 Phase 5     | migrations that drop or orphan existing rows                      |
| manual device photo smoke     | before release       | recommended after §3 Phase 4  | real-phone upload formats no automated test reproduces            |

## 6. Cookbook Patterns

How to add new tests in this project. Each sub-section is filled in once
the relevant rollout phase ships; before that, the sub-section reads
"TBD — see §3 Phase N."

### 6.1 Adding a unit test

Place pure-library tests beside the module they cover, using the
`src/lib/<module>.test.ts` name. Import `describe`, `expect`, and `test`
explicitly from `vitest`; globals are intentionally disabled. Name each top-level
`describe` after the function under test, not after the module.

Pass date strings and injectable `now` values explicitly. Do not depend on the
process timezone or the current clock: the Vitest configuration defaults to UTC as
a safety net, while CI also runs the suite with `TZ=America/New_York` to exercise
ambient-local formatting and DST-sensitive regressions.

Use table-driven cases for rules with boundaries. For season selection, extend the
authoritative `SEASON_BOUNDARIES` table in `src/lib/season.test.ts` instead of adding
another boundary list; it includes the SQL-covered dates and a leap-day case. Each
row should state its expected result and a short reason, then be run through the
public function under test. Assert observable contracts, not implementation details.

Relative imports are the norm, with one deliberate exception: `src/lib/season.test.ts`
imports its module under test as `@/lib/season`. That is the suite's only exercise of
the `vite-tsconfig-paths` plugin, which derives the `@/*` alias from `tsconfig.json`.
**Do not normalise it to a relative path** — doing so would leave the suite green while
silently removing the only check that alias resolution still works. If that file ever
stops using the alias, move the aliased import to another test rather than dropping it.

### 6.2 Adding an integration test

TBD — see §3 Phase 2. Will cover the seeded-database harness and the
pattern for asserting a mutation's *resulting state* rather than its
response code (Risks #2, #3, #4).

### 6.3 Adding a test for a mutation (Astro Action)

TBD — see §3 Phase 2. Will cover asserting the full record after a write,
and the multi-step sequence form that catches undo defects (Risks #3, #4).

### 6.4 Adding a per-account isolation test

TBD — see §3 Phase 3. Will cover the two-seeded-user fixture and direct-id
access, bypassing the UI (Risk #5).

### 6.5 Adding a test that crosses the storage boundary

TBD — see §3 Phase 4. Will cover asserting an uploaded object is
retrievable, and the manual device checklist for formats no automated test
reproduces (Risk #7).

### 6.6 Per-rollout-phase notes

(Filled in as phases land.)

## 7. What We Deliberately Don't Test

Exclusions agreed during the rollout interview (Q5). Future contributors
should respect these unless the underlying assumption changes.

- **Generated code** (database type definitions and similar) — the
  generator is the test. Re-evaluate if generated output is ever
  hand-edited. (Source: interview Q5.)
- **The UI layer** — visual, snapshot, and browser-level assertions are out
  while the design is still unsettled; a test written now would encode a
  design about to change. Re-evaluate once roadmap slice S-09
  (design-review-and-polish) lands. (Source: interview Q5.)
- **Supabase Auth itself** — it is a vendor product; we do not test their
  login. Note this does not exempt Risk #5: our *ownership* checks are ours
  to prove, and that is authorization, not authentication. (Source:
  interview Q5.)

## 8. Freshness Ledger

- Strategy (§1–§5) last reviewed: 2026-07-25
- Stack versions last verified: 2026-07-25
- AI-native tool references last verified: 2026-07-25

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive,
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner),
- §7 negative-space no longer matches what the team believes,
- **roadmap slice S-09 (design-review-and-polish) lands.** The UI exclusion
  in §7 was agreed while the design was unsettled. Once it settles,
  re-evaluate a browser layer for two things it would buy: a behavioural
  flow test for Risk #2 (sign in → plant due on the list → mark watered →
  disappears), which asserts product behaviour rather than design and so
  survives a restyle; and the client-side submit path for Risk #7's known
  accepted gap above. A browser runner is expensive to buy for Risk #7
  alone — but nearly free once Risk #2 justifies it.
