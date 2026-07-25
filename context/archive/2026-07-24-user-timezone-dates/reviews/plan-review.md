<!-- PLAN-REVIEW-REPORT -->
# Plan Review: User-Timezone Date Authority

- **Plan**: `context/changes/user-timezone-dates/plan.md`
- **Mode**: Deep
- **Date**: 2026-07-25
- **Verdict**: REVISE
- **Findings**: 3 critical, 3 warnings, 2 observations

Two FAIL dimensions, but the architecture is right — the resolution chain, the cookie
lifecycle, and the null-day invariant all hold up. Every fix below is a targeted edit
inside an existing phase, so this is REVISE rather than RETHINK.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | FAIL |
| Lean Execution | WARNING |
| Architectural Fitness | WARNING |
| Blind Spots | FAIL |
| Plan Completeness | WARNING |

## Grounding

17/17 paths ✓, 6/6 symbols ✓, brief↔plan ✓.

Astro 6 claim verified against the installed tree: `@astrojs/cloudflare` 13.7.0 + `astro`
6.4.8. `createLocals` (`node_modules/@astrojs/cloudflare/dist/utils/cf-helpers.js:23-38`)
defines `runtime.cf` as a getter that throws `"Astro.locals.runtime.cf has been removed in
Astro v6. Use 'Astro.request.cf' instead."` — the plan's key discovery is correct, and a
plan written the old way would have failed at runtime rather than at compile time.

Progress↔Phase contract ✓ — one `## Progress` heading at the bottom, 3/3 phase headings
match, 7 + 10 + 12 rows map to their Success Criteria bullets, no checkboxes outside
Progress.

`docs/reference/contract-surfaces.md` does not exist — contract-surface check skipped.

Note beyond the findings: `auth-layout.astro` wraps `layout.astro`, so the head script
lands on the sign-in page too. The `tz` cookie is already warm by the time the first
authed page renders — better than the plan assumes.

## Findings

### F1 — Today list's `today === null` path is contradictory and unbuildable

- **Severity**: ❌ CRITICAL
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: End-State Alignment
- **Location**: Phase 3 §1 and §2
- **Detail**: Two problems in the same branch.
  **(a) Internal contradiction.** §1 says that when `today` is `null` the shell "passes the
  full ordered list and lets the island resolve the day after hydration." §2 deletes
  exactly that mechanism — the bootstrap `useEffect` at `today-list.tsx:242-246` — and
  seeds state from the prop instead. Nothing is left to resolve the day.
  **(b) The null branch can't compile, let alone render.** §2 says the null day "renders
  real rows using the exact-date phrasing from Phase 2," but Phase 2 only widened
  `formatDueLabel`. The row body also calls `classifyDueStatus(plant.next_due_on, today)`
  (`today-list.tsx:366`), which throws `RangeError` on a future due date, plus
  `getSeason(today)` (`:411,:419`) and `selectSeasonInterval(today, …)` (`:413,:421`) —
  all `string`-only, all throwing via `validateSeasonDate` on bad input. No phase specifies
  what any of them do when the day is unknown.
  Worth noting when choosing: the null-with-JS case is transient. The head script sets
  `data-today=""`, which always mismatches, so it reloads once with the cookie. The durable
  null case is JS-off, where the island never hydrates anyway.
- **Fix A**: Keep a client-side resolution as the explicit null fallback — seed `today`
  from the prop; when the prop is null, resolve it in an effect after mount so row
  internals always see a string.
  - Strength: Preserves today's behaviour exactly; no new formatting branches to specify.
  - Tradeoff: One `set-state-in-effect` suppression survives — contradicting Desired End
    State and criterion 3.4, both of which would need amending.
  - Confidence: HIGH — it is the current code, minus the skeleton.
  - Blind spot: Dead in practice (see the transience note), so it adds a suppression for a
    path that rarely executes.
- **Fix B ⭐ Recommended**: Specify the full null-day row rendering in Phase 2 — extend
  Phase 2 to cover the unknown day across the row (no overdue classification, no season
  label, exact dates only), then Phase 3 consumes it. `classifyDueStatus` and the
  season-label path get explicit `today: string | null` contracts alongside
  `formatDueLabel`.
  - Strength: Keeps the "never assert a day we don't know" invariant the whole slice is
    built on; both eslint suppressions die as promised; JS-off users get an honest,
    complete list.
  - Tradeoff: More surface to specify in Phase 2, and with no day the list cannot be
    due-filtered — it shows every plant.
  - Confidence: HIGH — the branch shape already exists in `season-interval-summary.astro`'s
    fallback strings.
  - Blind spot: The unfiltered Today list needs a heading/empty-state decision that no
    phase currently makes.
- **Decision**: PENDING

### F2 — Server-side due-filtering breaks the empty state and `nextUpcoming`

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: End-State Alignment
- **Location**: Phase 3 §1 — Server-rendered Today list
- **Detail**: §1 has the shell "filter to `next_due_on <= today` for the due list." But the
  island derives two things from the *unfiltered* set:
  - `today-list.tsx:315` — `basePlants.length === 0` means "this user has no plants at all"
    and renders "Add your first plant." Under a pre-filtered list it also becomes true for a
    user with five plants, none due today, who should be seeing "Nothing needs water today."
  - `today-list.tsx:240` — `nextUpcoming` is `basePlants.find(p => p.next_due_on > today)`,
    the "Next: Fern on 3 Aug" line. A pre-filtered list contains no such plant, so the line
    silently disappears.

  §1 does say the shell "resolves the next upcoming plant," but the props contract in §2
  grows only `today` and `timeZone`. Neither `nextUpcoming` nor a total count is in it.
  `handleUndo`'s re-insert (`:202-210`) reads the same set.
- **Fix A ⭐ Recommended**: Keep passing the full ordered list; filter inside the island.
  - Strength: Output is byte-identical to the server-filtered version — the island renders
    on the server with a real day, so this is still full SSR. Empty state, `nextUpcoming`,
    and the undo re-insert all keep working untouched.
  - Tradeoff: Phase 3 §1's wording ("move due-filtering to the server") needs rewriting to
    "pass the resolved day so the island can filter during SSR."
  - Confidence: HIGH — only `today`'s source changes; every consumer of `basePlants` stays
    as-is.
  - Blind spot: Payload is unchanged rather than reduced; fine at this scale, worth
    revisiting at hundreds of plants.
- **Fix B**: Filter server-side and widen the props contract with `nextUpcoming` and a
  total count.
  - Strength: Matches §1's stated intent literally; smallest island payload.
  - Tradeoff: Three new props, and `handleUndo`'s re-insert has to be re-derived against a
    filtered set.
  - Confidence: MEDIUM — more moving parts, and the undo path is the one the plan already
    flags as the riskiest to touch.
  - Blind spot: Optimistic removal interacting with a filtered base set isn't traced
    anywhere in the plan.
- **Decision**: PENDING

### F3 — Moving date formatting server-side silently changes the locale

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 2 §1-2, Phase 3 §1-2
- **Detail**: `formatShortDate` (`src/lib/date.ts:53`) and `formatOverdueDate`
  (`today-list/utils.ts:27,30`) both call `new Intl.DateTimeFormat(undefined, …)`.
  `undefined` means "the host's locale" — the browser's today, the Worker's after this
  change. The plan treats timezone as the only host-derived input; locale is the second one
  and is never mentioned.

  Measured on this machine's ICU for `{day:"numeric", month:"short"}`:

  | Locale | Output |
  | ------ | ------ |
  | resolved default | `Aug 3` (en-US) |
  | `en-GB` | `3 Aug` |
  | `pl-PL` | `3 sie` |
  | `de-DE` | `3. Aug.` |

  Two consequences:
  1. **The plan's canonical string is wrong.** Every success criterion says `Due 3 Aug` —
     that's en-GB. A Worker defaulting to en-US emits `Due Aug 3`, so criteria 2.9, 3.x and
     matrix row 3 fail as written.
  2. **React hydration mismatch.** The Today list's date text is currently client-only (the
     null branch renders a skeleton). After Phase 3 it is SSR'd in the Worker's locale, then
     hydrated in the browser's. For any non-en-US user the text differs, React 19 logs a
     hydration error and re-renders — directly violating criterion 3.6 ("no visible flash of
     placeholder rows").
- **Fix A ⭐ Recommended**: Pin an explicit locale in the two formatters — replace
  `undefined` with a fixed locale (`"en-GB"` matches the plan's own `Due 3 Aug` examples).
  - Strength: Deterministic across Worker and browser, so the hydration mismatch cannot
    occur; two-line change in `src/lib/date.ts` and `today-list/utils.ts`; makes every
    criterion string in the plan literally true.
  - Tradeoff: Non-English users lose localized month names — though they don't reliably have
    them today either, since `/plants` is already SSR'd in the Worker's locale before the
    script rewrites it.
  - Confidence: HIGH — measured above; the app has no i18n story to break.
  - Blind spot: DESIGN.md may specify a date format; worth a check before picking the locale.
- **Fix B**: Resolve the browser locale alongside the timezone (cookie → `Accept-Language`
  → null) and format with it.
  - Strength: Genuinely localized dates; symmetric with the timezone chain.
  - Tradeoff: A second negotiated value, a second unknown branch, and real i18n scope in a
    slice explicitly about dates.
  - Confidence: MEDIUM — the mechanism is the same as `tz`, but the scope growth is
    significant and outside "What We're NOT Doing" only by omission.
  - Blind spot: Month-name width varies by locale; the 320px checks would need redoing per
    locale.
- **Decision**: PENDING

### F4 — Two notions of "today" survive Phase 3

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: End-State Alignment
- **Location**: Phase 3 §2 — Today list island
- **Detail**: Phase 3 says the rollover timer switches to `getTodayInTimeZone(timeZone)` "so
  it shares Phase 1's authority rather than re-deriving one." Two host-clock reads are left
  unaddressed:
  - `today-list.tsx:201` — `setToday(todayLocalDateString())` inside `handleUndo`, which
    overwrites the resolved day with the host's on every undo.
  - `today-list.tsx:205` — `data.restored_due_on > todayLocalDateString()` decides whether a
    restored plant reappears in the list.

  Separately, `msUntilNextLocalMidnight()` (`date.ts:40`) computes the delay from the
  *browser's* zone while the recompute uses `timeZone`. Once the cookie is warm these agree,
  so the exposure is narrow — a request served from `cf.timezone` where the geolocated zone
  differs from the browser's but the calendar day happens to match (the reload guard only
  fires on a day mismatch). Then the timer fires at the wrong instant.

  The Overview's own words are "so the app has exactly one notion of 'today'"; as written, it
  ends with two.
- **Fix**: In Phase 3 §2, name the two `handleUndo` call sites explicitly and route both
  through the resolved zone. Either make `msUntilNextLocalMidnight` take an optional
  `timeZone`, or state in the plan that it deliberately stays browser-local and why the
  residual mismatch is acceptable.
- **Decision**: PENDING

### F5 — The corrective reload is the plan's own "dangerous piece" for one page view

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Lean Execution
- **Location**: Phase 1 §4 / Critical Implementation Details
- **Detail**: The plan labels the reload "the one genuinely dangerous piece," then spends a
  `sessionStorage` marker, a two-condition guard, a `try/catch`, three manual criteria (1.5,
  1.6, matrix row 9) and a `data-today` attribute defending it. Removing it costs one thing:
  on a cold profile whose geolocated zone lands on a different calendar day, the *first* page
  view shows exact dates instead of relative labels — which the plan already declares an
  honest, first-class rendering rather than a degraded one. The cookie still lands on that
  same paint, so navigation two is correct either way.
- **Fix A ⭐ Recommended**: Write the cookie, drop the reload.
  - Strength: Removes the loop risk, the guard, the marker, `data-today`, and three
    verification rows; the fallback it avoids is one the plan already defends as good.
  - Tradeoff: One page view of exact dates for cold or geo-wrong profiles; the "correct on
    first byte" claim narrows to "correct on first byte once the cookie exists."
  - Confidence: HIGH — strictly less code and strictly fewer failure modes.
  - Blind spot: For a single-page visitor who never navigates, that one view is the whole
    session.
- **Fix B**: Keep it as specified.
  - Strength: First-visit relative labels even when geo-IP is wrong.
  - Tradeoff: Retains the plan's self-identified riskiest component and its whole guard
    apparatus.
  - Confidence: MEDIUM — the guard reasoning is sound, but it is defending against a failure
    mode that only exists because of the feature it enables.
  - Blind spot: `location.reload()` re-submits on a page reached by POST; no current form
    does a non-JS POST, but nothing prevents one later.
- **Decision**: PENDING

### F6 — `SeasonIntervalSummary` reads locals while its two siblings take props

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architectural Fitness
- **Location**: Phase 2 §2 vs. Phase 3 §2-3
- **Detail**: Phase 2 §2 has `season-interval-summary.astro` read `Astro.locals.today`
  directly, and §3 makes a point of it: "`SeasonIntervalSummary` sources the day from locals,
  not from props." Phase 3 then does the opposite for the other two consumers — `TodayList`
  gains a `today` prop, and `AddPlantForm` gains one from `new.astro`. Same value, three
  consumers, two conventions. Every other input to the summary (`growingIntervalDays`,
  `dormancyIntervalDays`, `dueDate`, `mode`) is already a prop, so this is the one hidden
  dependency in the component.
- **Fix**: Pass `today={Astro.locals.today}` from the two call sites
  (`plants/index.astro:128`, `plants/[id].astro:107`) and take it as a prop, matching the
  other two consumers and the component's existing props-only shape.
- **Decision**: PENDING

### F7 — "Remove the h-5 / h-10 pinned heights" is ambiguous about `truncate`

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 §2
- **Detail**: The class list at `season-interval-summary.astro:34` is
  `mode === "active" ? "h-5 truncate" : "h-10"`. Only `h-5`/`h-10` exist to absorb the text
  swap; `truncate` is what keeps a `/plants` row to one line at 320px and is unrelated to the
  workaround. An implementer reading "remove the h-5 / h-10 pinned heights" may take the
  whole ternary. Manual check 2.10 would catch it, but only after the fact.
- **Fix**: State that `truncate` is retained on the `active` branch and only the height
  utilities are dropped.
- **Decision**: PENDING

### F8 — Success Criteria headings drop the trailing colon used by prior plans

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phases 1-3, Success Criteria
- **Detail**: This plan writes `#### Automated Verification` / `#### Manual Verification`;
  `context/changes/season-aware-intervals/plan.md:145,154` (the last plan that shipped
  through `/10x-implement`) writes them with a trailing colon. The `## Progress` block itself
  is correct — `#### Automated` / `#### Manual` matches, and all 29 rows map to their phases
  — so nothing breaks. Cosmetic drift only.
- **Fix**: Add the trailing colon to the six Success Criteria headings.
- **Decision**: PENDING
