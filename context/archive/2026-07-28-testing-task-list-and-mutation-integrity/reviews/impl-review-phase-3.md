<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Task-list and Mutation Integrity — Phase 3

- **Plan**: `context/changes/testing-task-list-and-mutation-integrity/plan.md`
- **Scope**: Phase 3 of 6 — Risk #2, Extract and Prove the Due Derivation (commit `a386f55`)
- **Date**: 2026-07-31
- **Verdict**: NEEDS ATTENTION → **RESOLVED** (triaged 2026-07-31)
- **Findings**: 0 critical, 4 warnings, 4 observations
- **Triage**: 6 fixed (F1, F2, F3, F4, F5, F7) · 1 deferred to follow-up (F8) · 1 skipped (F6)

## Post-triage verification

| Gate | Command | Result |
|---|---|---|
| Unit | `pnpm test` | 6 files, 90 tests passed |
| Integration | `pnpm test:integration` | 3 files, 6 tests passed |
| Lint | `pnpm lint` | No issues found |
| Types | `pnpm check` | 0 errors, 0 warnings |

Mutation probe confirming F1's fix is load-bearing: removing `.order("name", …)` from
`load-today-plants.ts` fails the ordering test (Anthurium/Zebra pair inverts), and removing
`.order("next_due_on", …)` fails it as well. Before the fix, neither mutant was detectable.
The loader was restored byte-identical after the probe.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

### Success criteria verification (run during this review)

| Criterion | Command | Exit | Result |
|---|---|---|---|
| 3.1 | `pnpm test` | 0 | 6 files, 89 tests passed |
| 3.2 | `pnpm test:integration` | 0 | 3 files, 5 tests passed (stack up) |
| 3.3 | `pnpm lint` / `pnpm check` | 0 / 0 | No issues; 0 errors, 0 warnings |
| 3.4 | grep for inline `next_due_on` comparison in `today-list.tsx` | 1 (no match) | Confirmed none remain |

Manual items 3.5–3.7 are self-attested, but the refactor was verified logically
behaviour-preserving by inspection: `today === null` short-circuits survive at
`today-list.tsx:258`/`:260`, and `!isDueOn(restoredPlant, currentToday)` at `:225` is
exactly the replaced `data.restored_due_on > currentToday`. Evidence is adequate; not
raised as a finding.

### What was verified clean

- `authed-shell.astro` → `load-today-plants.ts` extraction is **verbatim**: select columns,
  double `.order()`, `SIGNED_URL_TTL_SECONDS`, batched `createSignedUrls`, both `null`
  error paths, and the mapper are byte-equivalent to the pre-extraction frontmatter.
- Supabase client is constructed **inside** the function from per-request headers/cookies
  (`load-today-plants.ts:10`) — no module-scoped client, no cross-request session leak in a
  Worker isolate. Matches `src/middleware.ts:20` and `requireSession`.
- `PlantListItem` reused from `src/types.ts` rather than redeclared.
- No `Date` arithmetic introduced into any comparison path; lexicographic string
  comparison preserved as the plan required.
- Scope guardrails respected: no due filter added to the server query, no React island test.
- All filenames kebab-case; explicit `vitest` imports; `test()` not `it()`; no `@ts-ignore`;
  no new eslint-disable comments.

## Findings

### F1 — Ordering assertion cannot fail; the `name` tie-break is unproven

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: src/lib/services/load-today-plants.integration.test.ts:33
- **Detail**: The plan requires asserting "all four rows return ordered by `next_due_on`
  then `name`". The test asserts `result.plants.map(id)).toEqual(fixturePlants.map(id))`
  — fixtures are declared in due-date order, and Postgres returns heap order for an
  unordered query, so deleting **both** `.order()` calls from the loader would still pass.
  All four fixtures have distinct `next_due_on` values ("Due 30 days ago", "Due yesterday",
  "Due today", "Due later"), so `.order("name")` has zero coverage. In a phase whose stated
  purpose is mutation integrity, this is an assertion that cannot detect its own mutant.
- **Fix**: Declare the fixtures in an order that differs from their due-date order, and add
  two plants sharing one `next_due_on` with names that sort opposite to insertion order.
  - Strength: Makes both `.order()` calls load-bearing; a dropped clause fails the test.
  - Tradeoff: One extra fixture row; marginally slower integration run.
  - Confidence: HIGH — `createPlantFixture` already takes `name` and `dueOffsetDays`, so no
    fixture-layer change is needed.
  - Blind spot: None significant.
- **Decision**: FIXED — fixtures declared out of due order; "Zebra yesterday"/"Anthurium yesterday" share one `next_due_on` and sort opposite to insertion order, so both `.order()` clauses are now load-bearing.

### F2 — Test claims "for the current user" but proves no per-user scoping

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/load-today-plants.integration.test.ts:14
- **Detail**: The test name asserts a security property the body never exercises. Only slot 0
  has rows, and `resetUserSlot` (`test/fixtures/user.ts:427-452`) clears them before each
  test — so a loader with RLS disabled, or one that had acquired a privileged client, would
  pass identically. This is the single most valuable property to pin for a newly extracted
  session-carrying loader, and the harness already supports it: the pool has two slots
  (`test/fixtures/user.ts:35`). `src/actions/harness.integration.test.ts` already
  establishes the precedent by proving the unauthenticated case.
- **Fix**: Seed a plant on slot 1, call `loadTodayPlants` with slot 0's headers and cookies,
  and assert slot 1's plant id is absent from the result.
  - Strength: Turns the test title into a proven claim and covers the RLS boundary the plan's
    "Implementation Approach" section says the harness exists to exercise.
  - Tradeoff: Consumes the second pool slot in this test, and the rate-limit budget was sized
    for at most four sign-ins per run — this stays inside that bound but uses it.
  - Confidence: HIGH — `getIntegrationUserFixture(1)` is the documented cross-account path.
  - Blind spot: Have not re-run the sign-in-count arithmetic against
    `supabase/config.toml:189` with this addition present.
- **Decision**: FIXED — added a second test, "excludes plants owned by another user", seeding slot 1
  and asserting slot 0's loader result contains only its own row. The ordering test's title was
  narrowed to drop the unproven "for the current user" claim. Slot sign-ins are memoized per test
  file, so this costs one additional sign-in per run, not per test.

### F3 — `findNextUpcoming` silently depends on sorted input

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/lib/due.ts:13
- **Detail**: `records.find((record) => !isDueOn(record, today)) ?? null` returns the first
  record in **array order** that is not due — not the earliest upcoming one, which is what the
  name promises. It is correct today only because every caller passes sorted input (the
  loader's `.order("next_due_on")`, and the undo path re-sorts with `compareDueRecords` at
  `today-list.tsx:229`). Extracting it into a generic `src/lib/` helper with a
  `<T extends DueRecord>` signature and no comment makes that precondition invisible to the
  next caller, and `due.test.ts` only ever passes the pre-sorted `DUE_RECORDS`, so the gap is
  untested. This is precisely the "pass-through seam that asserts nothing" the plan's Testing
  Strategy section names as anti-pattern #2.
- **Fix A ⭐ Recommended**: Document the sorted-input precondition in a comment on
  `findNextUpcoming`, and add a unit case passing an unsorted array to pin the current
  first-match semantics.
  - Strength: Preserves the behaviour-preserving-refactor constraint the plan imposed on this
    phase, while making the contract legible; comment density matches `date.ts`/`schedule.ts`,
    where `due.ts` is currently the only new module with no "why" comments.
  - Tradeoff: The footgun remains — a future unsorted caller still gets a wrong answer.
  - Confidence: HIGH — no behaviour change, so it cannot regress Phase 3's manual criteria.
  - Blind spot: None significant.
- **Fix B**: Make it order-independent by reducing with `compareDueRecords` instead of `find`.
  - Strength: Removes the precondition entirely; the name becomes true unconditionally.
  - Tradeoff: A behaviour change inside a phase the plan explicitly scoped as
    "behaviour-preserving refactor only", and `compareDueRecords` requires `name`, so the
    generic `<T extends { next_due_on: string }>` signature the plan mandated would have to
    widen.
  - Confidence: MEDIUM — correct in principle, but it fights two explicit plan constraints.
  - Blind spot: Have not checked whether the optimistic row type carries `name`.
- **Decision**: FIXED via Fix B — `findNextUpcoming` now reduces with `compareDueRecords` and is
  constrained to `T extends DueRecord` (imported from `date.ts`); the predicates keep a narrower
  local `DueDated` constraint so `name`-less callers are unaffected. Blind spot resolved: the sole
  runtime caller (`today-list.tsx:260`) passes `PlantListItem`, which carries `name`. Added unit
  cases for unsorted input and same-day name tie-break; both fail under the old `find` version.
  Note this is a deliberate behaviour change inside a refactor-scoped phase — accepted knowingly.

### F4 — `DueRecord` shadows the exported type of the same name in `date.ts`

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/due.ts:1
- **Detail**: `due.ts:1` declares a local `type DueRecord = { next_due_on: string }` while
  `date.ts:81` exports `DueRecord = { next_due_on: string; name: string }`.
  `today-list.tsx` imports from both modules (`:9` and `:15`), so two different types named
  `DueRecord` are structurally in scope in one file. The plan placed `due.ts` beside
  `compareDueRecords` precisely to avoid drift; a name collision on day one is that drift.
- **Fix**: Rename the local type (e.g. `DueDated`) or derive it as
  `Pick<DueRecord, "next_due_on">` from `date.ts`.
- **Decision**: FIXED as a consequence of F3 — the local type is renamed `DueDated` (with a comment
  explaining why it is narrower), and `due.ts` now imports the canonical `DueRecord` from `date.ts`.
  Only one type named `DueRecord` is in scope anywhere.

### F5 — `max_rows` comment omits the details that make it load-bearing

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/lib/services/load-today-plants.ts:16
- **Detail**: The plan asked to "document in a comment that PostgREST's `max_rows = 1000`
  (`supabase/config.toml:18`) truncates silently with `error === null`". The shipped comment
  omits the value `1000`, the config citation, and — most importantly — `error === null`,
  which is the part that explains why truncation is undetectable. It also lives in the loader
  rather than the test, so the test file records nothing about the limitation it is scoped
  around. (`max_rows = 1000` confirmed at `supabase/config.toml:18`.)
- **Fix**: Extend the comment to name `max_rows = 1000`, cite `supabase/config.toml:18`, and
  state that truncation surfaces with `error === null`.
- **Decision**: FIXED — comment now names `max_rows = 1000`, cites `supabase/config.toml:18`
  (value confirmed), and states that the cut-off arrives with `error === null`, so neither the
  loader nor its caller can distinguish a truncated page from a complete one.

### F6 — `isDueOn` is not generic, unlike its two siblings

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/lib/due.ts:5
- **Detail**: The plan specified "functions generic over `<T extends { next_due_on: string }>`".
  `selectDueRecords` and `findNextUpcoming` are; `isDueOn` takes a plain `DueRecord`.
  Structural typing means both `PlantListItem` and the optimistic row still satisfy it, so
  there is no functional consequence — it is an inconsistency within a three-function module.
- **Fix**: Give `isDueOn` the same `<T extends DueRecord>(record: T, today: string)` shape as
  its siblings.
- **Decision**: SKIPPED — a generic buys nothing for a predicate returning `boolean`; no type flows
  through to the return. After F3, the module is intentionally non-uniform: the predicates take the
  narrow `DueDated`, `findNextUpcoming` requires the full `DueRecord` because it sorts by `name`.

### F7 — Duplicate `test.each` row and swapped title interpolation

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/due.test.ts:18
- **Detail**: Row `:18` `["across a year boundary", "2023-12-31", true]` has input identical to
  row `:15` `["overdue by one day", "2023-12-31", true]` — with `TODAY = "2024-01-01"`,
  overdue-by-one *is* the year boundary. The boundary is therefore genuinely covered; the row
  adds a label, not a case. Separately, the title template `"returns %s for %s"` (`:19`)
  interpolates `_description` then `nextDueOn`, so titles read "returns due today for
  2024-01-01" and the expected boolean never appears in any test name.
- **Fix**: Drop or re-input the duplicate row, and reorder the title template to
  `"%s → returns %s"` so the reporter line reads as a sentence.
- **Decision**: FIXED — duplicate row dropped, its documentation value folded into the label of the
  row that actually covers it ("overdue by one day, across the year boundary"). Title template is
  now `"%s (%s) → returns %s"`, which surfaces all three tuple values including the expected
  boolean, e.g. "due tomorrow (2024-01-02) → returns false".

### F8 — Storage and query errors are swallowed without a signal

- **Severity**: 📝 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/load-today-plants.ts:24, :32
- **Detail**: `createSignedUrls`'s error is destructured away entirely, so a Storage outage
  degrades every row to the initial-letter placeholder with no signal; the query `error`
  returns `{ plants: null }` without logging. `src/actions/index.ts` deliberately logs
  comparable non-fatal failures (`:86`, `:191`) with the sanctioned `no-console` disable.
  This is **pre-existing behaviour that the plan explicitly required be preserved verbatim**,
  so it is not a Phase 3 regression — but promoting the code into a named service module is
  the natural moment to make it observable, and this review is the record that it was seen.
- **Fix**: Log both branches with the same eslint-disable rationale pattern used in
  `src/actions/index.ts` — or leave as-is and carry it to the follow-up change, since fixing
  it here would break the phase's "verbatim preservation" contract.
- **Decision**: DEFERRED — queued in `follow-ups/review-fixes.md` rather than fixed here, to keep
  Phase 3's verbatim-preservation contract intact.
