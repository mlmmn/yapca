<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Season-Aware Intervals

- **Plan**: `context/changes/season-aware-intervals/plan.md`
- **Scope**: Phases 1–3 of 3 (full plan)
- **Date**: 2026-07-24
- **Verdict**: NEEDS ATTENTION (triaged 2026-07-24 — 8 fixed, 1 dismissed)
- **Findings**: 0 critical, 5 warnings, 4 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | WARNING |

## Automated Verification (re-run during this review)

| Command | Result |
|---------|--------|
| `pnpm exec astro check` | PASS — 0 errors, 0 warnings, 9 hints (all pre-existing `ts(6385)` deprecations in `src/components/ui/radio-group.tsx`) |
| `pnpm lint` | PASS — "ESLint: No issues found" |
| `pnpm build` | PASS — Cloudflare adapter, server built in 6.81s |
| `psql … -f supabase/tests/season-aware-intervals.sql` | PASS — BEGIN/DO/SET…/ROLLBACK, no exception raised |
| `pnpx supabase gen types typescript --local` vs committed | PASS — byte-identical to `HEAD:src/lib/database.types.ts` |
| `pnpx supabase db reset` | NOT RUN — skipped to avoid destroying the running local dev database. Equivalent evidence holds: the local schema is migrated and generated types match the committed file exactly. |

## Findings

### F1 — Add form freezes `clientDate` at mount instead of reading it at submit

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/add-plant-form/add-plant-form.tsx:61
- **Detail**: Pre-change, the form evaluated the date at submit time: `formData.set("clientDate", todayLocalDateString())` (`git show aa3ae30^:src/components/add-plant-form.tsx:50`). The new code sends `localDate`, a `useMemo(…, [])` frozen at mount (`:40`). A form left open across local midnight submits **yesterday's** date. `src/actions/index.ts:45-50` uses that same value both to pick the seasonal interval and to compute `next_due_on`, so across a Feb 28→Mar 1 or Oct 31→Nov 1 rollover the plant is created with the wrong interval *and* the wrong due date. The plan's Phase 2 contract required preserving "the exact 'today' versus 'already watered' meaning".
- **Fix**: Keep `localDate` for the live preview, but read the date fresh inside `onSubmit`: `formData.set("clientDate", todayLocalDateString())`.
- **Decision**: FIXED — read `todayLocalDateString()` fresh inside `onSubmit`

### F2 — Add form derives the active season from the Worker clock during SSR

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality / Plan Adherence
- **Location**: src/components/add-plant-form/add-plant-form.tsx:40-42
- **Detail**: `src/pages/plants/new.astro:17` mounts the island with `client:load`, so Astro server-renders it. `const localDate = useMemo(() => todayLocalDateString(), [])` therefore runs on Cloudflare Workers, where `new Date()` is UTC. `activeSeason` / `activeSeasonLabel` (`:41-42`) and the "After N days" preview (`:232-263`) are rendered text derived from it. On a date boundary the server emits e.g. "Dormancy season · After 30 days" and the client hydrates to "Growing season · After 7 days" — a React 19 hydration text mismatch plus a visible flip. This contradicts the plan's own premise ("Static Astro pages cannot know that date reliably at SSR time", plan.md:16) and the documented precedent in the sibling component: `src/components/today-list/today-list.tsx:242-246` deliberately holds `today === null` until a post-hydration effect, with a comment explaining exactly why.
- **Fix**: Adopt the `today-list` shape — `const [localDate, setLocalDate] = useState<string | null>(null)` set in a `useEffect`, and render the season label / interval preview only once it is non-null (neutral placeholder before that).
  - Strength: Reuses the pattern already established and commented in this repo for the identical problem; removes the hydration mismatch class entirely rather than papering over one instance.
  - Tradeoff: The season label and "After N days" preview are absent for one frame on first paint; needs a non-shifting placeholder to avoid layout jump.
  - Confidence: HIGH — `today-list.tsx` is the same problem solved the same way in the same codebase.
  - Blind spot: Not verified whether a React hydration warning is actually observable in the Cloudflare preview at a boundary date — the reasoning is from the code, not a reproduced run.
- **Decision**: FIXED — adopted today-list's `useState<string|null>` + bootstrap `useEffect`; season label and preview render only once the browser-local date is known. Required an ESLint disable for `react-hooks/set-state-in-effect`, approved by the user, mirroring `today-list.tsx:244`

### F3 — SQL verification script never wraps a year, and depends on the seeded owner

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria / Plan Adherence
- **Location**: supabase/tests/season-aware-intervals.sql:34-42
- **Detail**: The plan required coverage of "February's final day (including leap year), March 1, October 31, November 1, and **year wrapping**" (plan.md:139). The case table covers Feb 29 2024, Mar 1 2024, Oct 31 2024, Nov 1 2024, Feb 28 2025, Mar 1 2025 — the closest to a wrap is `2024-11-01 → 2024-12-01`. No single computation crosses Dec 31, so the dormancy interval's `acted_on + N` year-rollover arithmetic is untested. Criterion 1.2 is marked `[x]`. Separately, the plan said the script "creates isolated fixtures"; only the second user is created (`:11-13`) — the owner `…0001` is assumed to exist from `supabase/seed.sql`, so the plant insert at `:15-20` fails on FK against a DB where the seed did not run.
- **Fix**: Add a December dormancy case (e.g. `(date '2024-12-15', date '2025-01-14')` with the 30-day dormancy fixture) to the case table, and insert the owner user in the fixture-setup block alongside the second user.
- **Decision**: FIXED — added the `2024-12-15 → 2025-01-14` year-wrap case and made the script create both accounts. Verified by deliberate break: a wrong expectation raises

### F4 — Plant detail never states the season rule in plain words

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: src/pages/plants/[id].astro:107-112
- **Detail**: The plan required the fixed boundary rule to be stated "once in plain words in plant detail's full-schedule mode rather than repeating it per row" (plan.md:276, echoed at plan.md:70), as the prescribed mitigation for the ambiguity it identified: a stored `next_due_on` can predate the active season, so a named interval must not read as the source of the displayed due date. Detail renders only `<SeasonIntervalSummary mode="full" …>`, whose full-mode output (`season-interval-summary.astro:49-52`) is `Growing: Every 7 days (active now) · Dormancy: Every 30 days (active now)` — no March–October / November–February copy and, unlike active mode (`:54`), no "then"/next-watering framing. The only place the boundary ranges appear anywhere in the app is the add form (`add-plant-form.tsx:194,223`). Criterion 3.9 is marked `[x]` without observable evidence in the diff. Active mode's `Dormancy · then Every 30 days` (used on Today and All plants) does satisfy the anti-ambiguity wording — the gap is detail-only.
- **Fix A ⭐ Recommended**: Add one line of static copy under the full-schedule summary in `[id].astro`, e.g. "Growing season runs March–October; dormancy November–February. The active interval applies from the next watering."
  - Strength: Puts the rule exactly where the plan asked, in the one surface that has room for it; no change to the shared component, so Today and All plants stay compact.
  - Tradeoff: The sentence lives in the page rather than the component, so a future second full-mode consumer would not inherit it.
  - Confidence: HIGH — detail is the only `mode="full"` consumer today (`grep` confirms).
  - Blind spot: Wording not checked at 320px against the surrounding layout.
- **Fix B**: Move the copy into `season-interval-summary.astro`'s full mode so any full-schedule consumer carries it.
  - Strength: Keeps the rule with the component that owns season presentation; automatically correct for future consumers.
  - Tradeoff: Adds a third line to a component whose no-JS fallback is already the denser of the two modes; more markup to keep reflow-stable.
  - Confidence: MEDIUM — depends on whether full mode is ever used somewhere tighter than detail.
  - Blind spot: Haven't assessed the fixed-height slot implications of adding a second text row (see F7).
- **Decision**: DISMISSED — deliberate product decision, not drift: the user judged a per-plant restatement of the rule too repetitive and directed its removal during implementation. `plan.md` amended at both sites so future reviews do not re-flag it

### F5 — PRD open question the plan said to close is still open

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/foundation/prd.md:164
- **Detail**: plan.md:343 states: "`context/foundation/prd.md:164` still records the season-boundary question as open … Record that resolution in the PRD once Phase 1 lands." Open Question 2 still reads "the exact boundary dates … and whether the user can adjust them are undecided. Owner: user. Blocks correct interval selection once implemented." Phase 1 landed in `aa3ae30`; the epilogue commit `e2cbeb8` touched only `change.md` and `plan.md`. The decision is recorded in `change.md` but not where the plan directed.
- **Fix**: Replace Open Question 2 with the resolution — fixed application-wide, growing March 1 through October 31 inclusive, dormancy November 1 through February's final day, not user-configurable — noting it was settled by `season-aware-intervals`.
- **Decision**: FIXED — PRD Open Question 2 replaced with the recorded resolution

### F6 — Season boundary encoded twice with no gate on the TypeScript side

- **Severity**: 📋 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architecture
- **Location**: src/lib/season.ts:14 and supabase/migrations/20260724120000_add_season_aware_intervals.sql:57-58
- **Detail**: This duplication is deliberate — the plan explicitly says to "mirror the same inclusive month boundaries inside the database mutation" (plan.md:54) — so it is not drift. The gap is asymmetric coverage. The **initial** `next_due_on` at plant creation comes from the TS path (`src/actions/index.ts:45`); every **subsequent** reschedule comes from the SQL path. The SQL side has boundary assertions (`supabase/tests/season-aware-intervals.sql:34-42`); the TS side has none, and `package.json` has no JS test runner at all — which the plan chose on purpose ("No new Vitest, Playwright, pgTAP"). If the two ever drift, a plant's first interval would silently disagree with all later ones.
- **Fix**: Add reciprocal comments — in `season.ts` naming the migration as the mirrored authority, and in the migration naming `src/lib/season.ts` — so the coupling is discoverable at both edit sites. Promote to a real assertion when a TS test runner lands.
- **Decision**: FIXED — reciprocal "mirrored authority, change both together" comments added in `season.ts` and in `mark_watered`

### F7 — `min-h-5` does not deliver the promised zero-reflow slot, and active mode's fallback states a different fact

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/components/season-interval-summary/season-interval-summary.astro:25
- **Detail**: The plan required the server to render the pair "into a fixed-height slot … the enhancement replaces that slot's text, never its box", giving "zero [reflow] on every row" (plan.md:251). The slot uses `min-h-5` — a *minimum*, reserving one `text-xs` line. In `full` mode the enhanced string (`Growing: Every 7 days (active now) · Dormancy: Every 30 days (active now)`) is materially longer than the fallback (`Growing Every 7 days · Dormancy Every 30 days`), so at 320px the wrapped line count — and the box height — can change on enhancement. Related: in `active` mode the fallback shows *both* intervals while the enhancement shows only the active one, so every load has a content swap (truthful per the plan's no-JS requirement, but a visible flash). The fallback also omits the colon the enhanced string uses (`:12` vs `:50`).
- **Fix**: Verify the two strings at 320px in both modes and, if the height changes, pin the slot with an explicit `h-*` (or a two-line `min-h-*` sized to the longer enhanced string) rather than a one-line minimum.
- **Decision**: FIXED — slot height pinned per mode (`h-5 truncate` for list rows, `h-10` for detail) instead of `min-h-5`; fallback punctuation aligned with the enhanced string. 320px line counts not verified in a browser — the box is now pinned by construction, so reflow is impossible either way

### F8 — Derived consts interleave the hooks block; generated-types header lost

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/add-plant-form/add-plant-form.tsx:40-44, src/lib/database.types.ts:1
- **Detail**: AGENTS.md orders a component body as non-void hooks → nested function declarations → void hooks → return. `activeSeason` and `activeSeasonLabel` (`:41-42`) are plain derivations sitting between `useMemo` (`:40`) and `useForm` (`:44`), splitting the non-void hooks block. Separately, regenerating `database.types.ts` wiped the repo's own header comment (`// Generated from the local Supabase schema — do not hand-edit. / Regenerate after any migration: pnpx supabase gen types typescript --local > …`), a documented convention, as collateral of `> file`. Note the diff also *fixes* a naming violation (`isSubmitting` → `submitting`, `:306-312`), and the folder move is a net compliance improvement.
- **Fix**: Move the two derivations below `useForm`, and restore the header comment atop `database.types.ts` (it is stripped by every regeneration — worth a note in the plan's regeneration step).
- **Decision**: FIXED — generated-types header restored, with the regeneration caveat noted in the file and in the plan's verification step. The hooks-ordering half was already resolved by the F2 fix

### F9 — Summary script captures a stale node list and never re-syncs outside the midnight timer

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/season-interval-summary/season-interval-summary.astro:34,71-79
- **Detail**: `summaries` is captured once at module-eval time and the recursive `setTimeout` is never cleared and never re-queries the DOM. The timer arithmetic itself is sound — `msUntilNextLocalMidnight()` (`src/lib/date.ts:40-45`) always returns `(0, 86_400_000]`, so no `setTimeout` overflow, no negative delay, and it is DST-correct. There is also no `ClientRouter`/`ViewTransitions` anywhere in the repo, so today this is a plain MPA and the script re-runs on every navigation — no duplicate-listener or orphaned-timer problem in practice. Two residual gaps: a bfcache restore or laptop resume can leave a stale date on screen until the next midnight tick, and if `ClientRouter` is ever adopted this breaks silently (stale node list, no refresh after client-side nav). `today-list.tsx:248-261` correctly `clearTimeout`s on unmount; the Astro script has no equivalent lifecycle.
- **Fix**: Re-query `[data-season-summary]` inside `refreshSummaries()` instead of closing over a snapshot, and add a `pageshow`/`visibilitychange` refresh.
- **Decision**: FIXED — `refreshSummaries()` re-queries the DOM instead of closing over a snapshot; added `pageshow` + `visibilitychange` re-sync

## Confirmed Correct (notable)

Recorded so a future review does not re-litigate these:

- **`mark_watered` replacement preserves every guarantee** — `security definer`, `set search_path = ''`, `auth.uid()` + `28000`, ownership predicate + `for update`, `P0002`, atomic update+insert, identical `returns table` shape, `revoke … from public, anon, authenticated` + `grant execute … to authenticated`. Verified line-by-line against `20260723120000_add_postpone_and_undo.sql:16-64,170-175`.
- **Migration ordering is safe on a populated table** — add nullable → backfill → `set not null` + independent `between 1 and 365` checks → `drop column`. The source column was already `int not null check (… between 1 and 365)`, so both constraints are guaranteed to validate. No `next_due_on` or `watering_events` mutation; index and all four RLS policies untouched. Caveats: the `drop column` is irreversible with no down-migration, and there is a deploy-ordering window where old app code 500s.
- **The due-label handover landed correctly** — the subtlest part of the plan. Both `plants/index.astro` and `[id].astro` deleted their SSR `todayLocalDateString()` and stopped importing `formatDueLabel`; the server emits only the exact `Due <date>` form, and the enhancement recomputes `formatDueLabel(dueDate, dateString)` (`season-interval-summary.astro:58-60`) from the same browser-local date on the same midnight schedule.
- **The Astro client script imports `@/lib/season` rather than re-implementing the boundary** (`:31-32`) — no lessons.md duplicate-helper violation, and `pnpm build` confirms the alias resolves and the script is hoisted into one bundled asset regardless of row count.
- **`season.ts` is timezone-safe** — classification uses `dateString.slice(5,7)`, never `new Date()`, and throws `RangeError` on invalid input rather than falling into dormancy. `nextDue` is not reimplemented.
- **Cross-account test asserts the right SQLSTATE** — `supabase/tests/season-aware-intervals.sql:86-97` switches `request.jwt.claims` to the second user while staying `authenticated`, and handles specifically `P0002`; a `28000` would not satisfy it.
- **Seed is aligned and useful** — `supabase/seed.sql:73-84` carries both columns in the insert and the `on conflict do update` clause, with unequal pairs (7/30, 4/14) exercising the seasonal branch locally.
- **No XSS surface** — the enhancement uses `textContent` only; no `set:html`/`innerHTML`, and only numeric intervals and a date column reach `data-*`.
- **Scope discipline is clean** — the diff outside `src/`, `supabase/`, `context/` is empty. No `package.json`, ESLint, Prettier, or `astro.config.mjs` changes; no new dependency or test framework; no cron/trigger; no read-time `next_due_on` rewrite; Postpone/Undo untouched.
