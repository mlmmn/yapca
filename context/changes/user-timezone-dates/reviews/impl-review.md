<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: User-Timezone Date Authority

- **Plan**: `context/changes/user-timezone-dates/plan.md`
- **Scope**: Full plan — Phases 1–3 of 3
- **Date**: 2026-07-25
- **Verdict**: NEEDS ATTENTION
- **Findings**: 1 critical, 6 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | FAIL |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

**Why NEEDS ATTENTION and not REJECTED**: the one CRITICAL finding is a build-tooling regression in `package.json`, not a defect in the shipped feature. Security is clean (the untrusted `tz` cookie is shape-gated before reaching `Intl`, nothing is reflected into HTML, authz on the actions is untouched, and removing `clientDate` strictly shrank the attack surface). The reload-loop analysis — the plan's own "one genuinely dangerous piece" — terminates on every hostile input examined. All automated success criteria were re-run and pass.

## Success Criteria Verification

All re-run from a clean tree on 2026-07-25:

| Check | Result |
|---|---|
| `pnpm astro check` | PASS — 0 errors, 0 warnings, 9 hints (all pre-existing `ts(6385)` deprecations in `src/components/ui/`) |
| `pnpm exec eslint . --max-warnings=0` | PASS — no issues; working tree still clean afterwards |
| `pnpm build` | PASS — server built in 6.87s |
| `grep -r "clientDate" src` | PASS — empty |
| `grep -r "set-state-in-effect" src` | PASS — empty |
| `grep -r "data-season" src` | PASS — empty |
| `grep -c "<script>" season-interval-summary.astro` | PASS — `0` |

Manual criteria: all 16 Progress rows are `[x]` and each has plausible supporting evidence in the diff (rollover listeners for 3.11, removed pinned heights for 2.10/3.12, seeded `useState` for 3.6). No rubber-stamping flagged.

## Findings

### F1 — `pnpm lint` was silently converted into an auto-fixer

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: package.json:11
- **Detail**: The Phase 3 commit (`ece0e5e`) changed `"lint": "eslint . --max-warnings=0"` to `"lint": "eslint . --max-warnings=0 --fix"` and deleted `lint:fix` entirely. This is unrelated to the timezone slice, appears nowhere in the plan, and touches lint tooling that AGENTS.md puts behind an explicit-permission rule. The consequence is that the project's verification gate now *mutates* the tree instead of *checking* it: `eslint.config` extends `eslint-plugin-prettier/recommended` and `@stylistic/padding-line-between-statements`, so nearly the whole ruleset is auto-fixable — those violations get silently rewritten and ESLint exits 0. `.github/workflows/ci.yml:20` runs `npm run lint`, so in CI the fixes are applied to the ephemeral checkout, discarded at teardown, and the run reports green on code that never satisfied the rules. Every plan under `context/changes/**` that cites `pnpm lint` as its pass/fail gate now asserts something weaker than it claims. `lint-staged` is unaffected (package.json:70-72 invokes `eslint --fix --max-warnings=0` directly, which is correct there because it re-stages).
- **Fix**: Restore `"lint": "eslint . --max-warnings=0"` and re-add `"lint:fix": "eslint . --max-warnings=0 --fix"`.
- **Note (pre-existing, out of scope)**: `ci.yml` uses `cache: npm` + `npm ci`, but the repo has only `pnpm-lock.yaml` — `npm ci` fails hard without a lockfile. It also triggers on `branches: [master]` while the repo's branch is `main`. CI is very likely not running at all today, which is *why* this regression could land unnoticed. Worth a separate change.
- **Decision**: FIXED — restored `"lint": "eslint . --max-warnings=0"` and re-added `lint:fix` (package.json:11-12). The restored checking gate immediately caught a real violation during the F2 fix.

### F2 — Midnight-rollover scheduling costs ~88 `Intl.DateTimeFormat` constructions on the main thread at hydration

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/lib/timezone.ts:47-67
- **Detail**: `getMillisecondsUntilNextMidnight` binary-searches the midnight boundary with a fixed 42 iterations. Each iteration calls `getTodayInTimeZone`, which calls `isSupportedTimeZone` (constructing one `Intl.DateTimeFormat`) and then constructs a *second* one for `formatToParts` — so ~88 formatter constructions per call, plus the seed-window `while` loop. It is called from `scheduleRollover` (`today-list.tsx:248`) synchronously inside the `client:load` effect on `/`, the app's primary screen. Two independent wastes: the 36 h search window is ~1.3e8 ms, so ~28 iterations already narrow to sub-millisecond — 14 iterations are pure overhead; and `getTodayInTimeZone` re-validates a zone the caller already validated, doubling every construction. The math itself is correct and genuinely DST-safe (the 36 h seed exceeds the 25 h maximum day length, and it samples through `Intl` in the user's zone rather than the browser's) — only the cost is wrong.
- **Fix**: Hoist a per-zone formatter cache to module scope in `timezone.ts`, add an internal day-formatting helper that skips re-validation, and drop the loop to ~28 iterations.
- **Decision**: FIXED — module-scope per-zone formatter cache in `timezone.ts`; validation and formatting now share one construction, and the binary search dropped to 28 iterations. Rollover boundary re-verified across DST transitions and half-hour offsets (Auckland, Los Angeles, Lord Howe, Kathmandu, UTC).

### F3 — Server records a UTC date while the client shows a browser-zone date

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/actions/index.ts:31-35
- **Detail**: `getActionDate` falls back to `getTodayInTimeZone("UTC")` when `locals.today` is `null` — which the plan explicitly sanctioned and required to be commented inline, and it is. But Phase 3 also gave the Today list a *different* fallback: `today-list.tsx:229` recovers via `getBrowserTimeZone()`. So the two halves disagree in exactly the case the fallback exists for. Failing scenario: a user in `Pacific/Auckland` with cookies blocked (no `tz` cookie, and no `cf` under `astro dev` or a non-Cloudflare edge) loads `/` at 10:00 local on 26 Jul. The island hydrates, resolves the browser zone, and labels a plant "due today" for 26 Jul. They tap Watered. UTC is 21:00 on **25 Jul**, so the action calls `mark_watered(p_acted_on = '2025-07-25')` — `new_due_on` lands a day early and the journal records yesterday. Because the cookie never sticks, this repeats on every mutation, not once. Note this also contradicts the plan's own Desired End State ("when the timezone is genuinely unknown … it never guesses a day") — the island does guess, per the Phase 3 contract. The plan is internally inconsistent here; the implementation followed the more specific of the two statements.
- **Fix A ⭐ Recommended**: Have the island send its resolved zone with the mutation — add an optional `timeZone` field to the three action schemas, validated with `isSupportedTimeZone`, used only when `locals.today` is `null`.
  - Strength: Closes the divergence at the one point where it produces a wrong stored date, and keeps the server the validator rather than the client the authority — a forged zone can still only shift the user's own rows by ±1 day under their own RLS scope.
  - Tradeoff: Reintroduces a client-supplied hint to a contract this slice deliberately cleaned; needs a comment distinguishing it from the `clientDate` it replaced.
  - Confidence: MED — resolves the concrete off-by-one, but the "unknown zone" path is rare enough that it has not been observed in practice.
  - Blind spot: Have not verified the non-JS form-POST path, where no island exists to attach the zone.
- **Fix B**: Make the island's fallback match the server's — drop `getBrowserTimeZone()` and render exact dates when `timeZone` is `null`, honouring the plan's Desired End State literally.
  - Strength: Restores one notion of "today" across the whole app with no contract change; strictly simpler.
  - Tradeoff: A cookie-blocked user loses relative phrasing and midnight rollover entirely — a real UX downgrade in exchange for correctness.
  - Confidence: HIGH — a deletion, and the exact-date branch it falls back to already exists and is exercised.
  - Blind spot: Unclear how many real users actually land on the null path; if it is effectively nobody, both fixes are low-value.
- **Decision**: FIXED via Fix B — `getBrowserTimeZone()` fallback removed from the island; an unknown zone keeps `today === null` and renders exact dates. Comment added so the fallback is not reintroduced. Recorded as plan addendum A2.

### F4 — `authed-shell.astro` never took over filtering, contrary to the phase intent

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: src/components/authed-shell.astro:65,67
- **Detail**: Phase 3.1's stated intent was "Move due-filtering and sorting to the server, where the day is now known," with the shell filtering to `next_due_on <= today` and resolving the next upcoming plant. The shell only forwards `today` and `timeZone`; both computations stayed in the island (`today-list.tsx:221` `dueList`, `:223` `nextUpcoming`) and the full plant list is passed unconditionally. User-visible output is correct — Astro server-renders the `client:load` island and the island seeds `today` from props, so the first byte already carries the filtered list, and criterion 3.6 genuinely passes. What was not realized is the data-shape half: every plant, including ones due months out, is still serialized into the island's props on every render of `/`.
- **Fix A ⭐ Recommended**: Record the deviation as an addendum in the plan — the intent's user-visible half was met, and the payload half becomes a follow-up if list sizes warrant it.
  - Strength: Costs nothing, and the behaviour is correct as shipped; a 40-plant collection is a trivial payload, so the optimization has no current justification.
  - Tradeoff: The plan stops being a faithful description of the code, which weakens future reviews that use it as ground truth.
  - Confidence: HIGH — verified the rendered output is correct and the divergence is payload-only.
  - Blind spot: Have not measured actual serialized prop size against a realistic collection.
- **Fix B**: Implement the filtering in the shell as planned and pass only the due rows plus the resolved next-upcoming plant.
  - Strength: Matches the plan exactly and shrinks the island payload proportionally to how far out the collection extends.
  - Tradeoff: The island still needs the full list for the midnight-rollover case (a plant due tomorrow must appear after rollover without a refetch), so this likely means passing both lists — more props, not fewer.
  - Confidence: LOW — the rollover interaction suggests the implementer may have hit exactly this and chosen the simpler shape deliberately.
  - Blind spot: No commit message or code comment explains why the shell filtering was dropped.
- **Decision**: FIXED via Fix A — recorded as plan addendum A1; payload trim left as a future follow-up.

### F5 — `formatShortDate` constructs a formatter per call, now once per plant row on the server

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/date.ts:54
- **Detail**: `formatShortDate` builds `new Intl.DateTimeFormat("en-GB", …)` on every call. Phase 2 moved `SeasonIntervalSummary` from a client script to SSR, so this became a per-row Worker cost: `plants/index.astro` renders the component once per plant → `formatDueLabel` → `formatShortDate` → one formatter construction per plant per request; `plants/[id].astro:132-144` adds up to three per journal entry. Formatter construction (pattern resolution) is the expensive half of ICU formatting. The plan's own Performance section anticipated this — "Constructing `Intl.DateTimeFormat` is the more expensive half" — but applied the lesson only to `today`, not to the formatters. `formatOverdueDate` (`today-list/utils.ts:26,29`) has the same shape.
- **Fix**: Hoist module-scope constants — `const SHORT_DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" })` — and reuse. Both call sites use fixed locale and options, so no cache keying is needed.
- **Decision**: FIXED — `SHORT_DATE_FORMATTER` hoisted in `src/lib/date.ts`; `OVERDUE_DATE_FORMATTER` / `OVERDUE_DATE_WITH_YEAR_FORMATTER` hoisted in `today-list/utils.ts`.

### F6 — Dead host-clock helpers left in the shared date module

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/lib/date.ts:31,40
- **Detail**: `todayLocalDateString()` and `msUntilNextLocalMidnight()` survive with **zero callers anywhere in `src`** (verified by grep; `parseLocalDateString` is still used by `formatShortDate` and is fine). The plan's Desired End State expected the grep to return "only the intended residue (the client-side rollover helper)" — but Phase 3 replaced that helper with `getMillisecondsUntilNextMidnight`, so the residue is now dead too. These are worse than ordinary dead code: they encode precisely the host-clock semantics this slice exists to abolish, they are exported from the module every date consumer already imports, and ESLint does not flag unused exports. A future contributor reaching for `todayLocalDateString()` silently reintroduces the Worker-UTC bug on the server.
- **Fix**: Delete both functions from `src/lib/date.ts`.
- **Decision**: FIXED — `todayLocalDateString` and `msUntilNextLocalMidnight` deleted from `src/lib/date.ts`. Extended by decision to `getBrowserTimeZone` in `src/lib/timezone.ts`, which the F3 fix left dead and which carries the same guess-a-zone hazard.

### F7 — Head script duplicates `getTodayInTimeZone` and hardcodes the cookie name, with no sync comment

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/layouts/layout.astro:23-35
- **Detail**: The inline script re-implements `getTodayInTimeZone` verbatim (same `"en-US"` locale, same `2-digit` options) and writes the literal `tz=` rather than `TIME_ZONE_COOKIE` — the constant the plan introduced specifically "so middleware and the head script cannot drift." The duplication is unavoidable (`is:inline` cannot import), but there is no comment on either side marking it. If someone changes the locale or option shape in `timezone.ts:24-29`, `browserToday !== dataset.today` becomes permanently true and every visitor pays one extra document request per session. This repo already has the right precedent for exactly this hazard: the paired "change both together" comments on `src/lib/season.ts` ↔ the `mark_watered` migration.
- **Fix**: Add mutual "keep in sync with …" comments on `src/lib/timezone.ts` and the `layout.astro` script, matching the `season.ts` precedent.
- **Decision**: FIXED — paired keep-in-sync comments added on `src/lib/timezone.ts:1` and the `layout.astro` inline script, matching the `season.ts` ↔ migration precedent.

### F8 — Cookie write sits behind the date computation inside one shared `try`

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/layouts/layout.astro:20-35
- **Detail**: The cookie write (`:35`) comes *after* `browserToday` is computed (`:22-32`), both inside the same `try`. The date computation is needed only for the reload comparison, not for the cookie, yet any throw in `:22-32` skips the cookie write entirely. The plan itself warned about this class of failure — "a throw here would leave the page without its cookie" — and prescribed the `try/catch`, but not the ordering. Failing scenario: a runtime where `formatToParts` throws or returns unexpected parts (a stripped-ICU build, an exotic `Intl` polyfill) resolves the zone fine at `:21` but never writes the cookie, and fails identically on every subsequent load. The server never learns the zone, which is a permanent silent degradation into the UTC path of F3.
- **Fix**: Move the `document.cookie` write to immediately after the zone resolution at `:21`, before computing `browserToday`.
- **Decision**: FIXED — the `document.cookie` write now runs immediately after zone resolution, before the date computation, with a comment on the ordering.

### F9 — `season-interval-summary` computes a dead `schedule` branch on the unknown-day path

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/season-interval-summary/season-interval-summary.astro:18-25
- **Detail**: `schedule` is computed eagerly even when `today === null`, in which case `:24` interpolates a `null` `seasonLabel` and produces the literal string `"null · then Every 7 days"` — which `:25` then discards. The `activeInterval ?? growingIntervalDays` fallback on `:24` exists solely to stop that dead branch from crashing, so it reads as a meaningful fallback but never fires. Per the repo's stated preference for early returns and top-of-block declarations, the `today === null` case should branch first.
- **Fix**: Branch on `today === null` up front and compute `schedule`/`activeInterval` only in the non-null path.
- **Decision**: FIXED — `today === null` branches first via a `buildSchedule(activeDay)` helper; the discarded `"null · then …"` string and the phantom `?? growingIntervalDays` fallback are gone.

### F10 — Overdue date formatting silently pinned from viewer locale to `en-GB`

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: src/components/today-list/utils.ts:26,29
- **Detail**: Phase 3 changed `new Intl.DateTimeFormat(undefined, …)` to `new Intl.DateTimeFormat("en-GB", …)` in `formatOverdueDate`. This is an unplanned, user-visible behaviour change — overdue dates no longer follow the viewer's locale. It is coherent with the slice's "server and client must agree on rendering" thesis and matches the pre-existing `en-GB` in `formatShortDate`, so it is very likely deliberate, but it appears nowhere in the plan or the commit message.
- **Fix**: Keep the change (server/client agreement requires a fixed locale) and note it as a plan addendum so the locale decision is recorded rather than inferred.
- **Decision**: FIXED via Fix A — `en-GB` kept; locale decision recorded as plan addendum A3.

## Notes on what was checked and found clean

- **Security**: `isSupportedTimeZone` gates emptiness → length ≤ 100 → regex → only then probes `Intl`, so the untrusted cookie never reaches the sink unvalidated and an 8 KB cookie short-circuits before the pattern. The regex is not ReDoS-prone (the repeated group is anchored by a literal `/` absent from its character class). `data-today` carries only `formatToParts` output and is attribute-escaped by Astro; the inline script uses no `define:vars`, no `set:html`, and no server-value interpolation. `requireSession` still gates every mutation. Removing `clientDate` removed no control — `clientDateSchema` validated shape only, never plausibility — so the new model is strictly stronger.
- **Reload loop**: no unbounded loop constructible. `sessionStorage.setItem` precedes `location.reload()`, so a throwing `setItem` (Safari private mode, blocked storage) *prevents* the reload rather than looping it; blocked cookies, a day-skewed browser clock, crossing midnight between loads, and bfcache restore each cap at one extra request.
- **DST and date arithmetic**: clean. `getTodayInTimeZone` derives the day through `Intl` in the target zone; `toEpochDay`/`fromEpochDay` are pure UTC epoch-day math; `nextDue` never touches a local `Date`.
- **Timer and listener hygiene** in `today-list.tsx:225-270`: correct — `timer` is a shared closure binding reassigned on each recursion, cleanup clears the latest plus both listeners, `[timeZone]` is the right dependency.
- **`classifyDueStatus` throw paths**: safe — `:349` only calls it when `today !== null`, in which case `dueList` has already filtered to `next_due_on <= today`.
- **Scope guardrails**: all respected. No settings surface, `supabase/` untouched, no test tooling, rollover confined to the Today list, journal untouched. One conscious consequence worth acknowledging: `auth-layout.astro` wraps `layout.astro`, so the cookie-sync script runs on `/auth/*` too — a cold-profile visitor to `/auth/signin` may get one extra document request. That follows directly from the plan placing the script in the shared root layout.
- **`src/components/add-plant-form/types.ts`** (new, unplanned file): benign convention-following extraction, matching AGENTS.md's component-local-types rule and the `today-list/types.ts` precedent. Not scope creep.
