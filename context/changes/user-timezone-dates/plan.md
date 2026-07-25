# User-Timezone Date Authority Implementation Plan

## Overview

Make the user's timezone — not the Cloudflare Worker's UTC clock — the single calendar authority for every date the app renders or records. The timezone is resolved once per request in middleware and exposed as `Astro.locals.today`, so pages can server-render honest relative dates ("Due today") for the first time. With a correct day available server-side, the five client-side workarounds that exist only because the server didn't know the day are deleted rather than patched.

This is roadmap slice **S-08** (`context/foundation/roadmap.md`, status `ready`, prerequisite S-02 complete).

## Current State Analysis

`todayLocalDateString()` (`src/lib/date.ts:31`) reads the **host machine's** local calendar date. In a browser that is the user's date and is correct. On Cloudflare Workers the host is always UTC, so any server-side call returns the Worker's day.

Two surfaces render dates server-side (`src/pages/plants/index.astro`, `src/pages/plants/[id].astro`) via `SeasonIntervalSummary`. For a user at UTC+13 the Worker's day and the user's day disagree from local midnight until 12:59 — more than half of every day — so `/plants` can show `Due 1 Mar` for a plant due today, and `Due today` for one already overdue. The Today list does not have this bug precisely because it refuses to render until the browser tells it the date, which is exactly why the two page types can contradict each other.

Rather than fix the cause, each slice so far worked around it locally. Five distinct workarounds are now in the tree:

| # | Location | Workaround |
| - | -------- | ---------- |
| 1 | `src/components/season-interval-summary/season-interval-summary.astro:12-16,42-104` | SSR emits a truthful-but-vague fallback (`Growing: … · Dormancy: …`, `Due 3 Aug`), then a ~60-line inline script re-reads the browser date and rewrites the text, with its own midnight timer, `pageshow`, and `visibilitychange` listeners. |
| 2 | `src/components/today-list/today-list.tsx:42,238-262` | `today` starts `null`, so the component renders a `BOOTSTRAP_ROW_COUNT` skeleton and sets the real date in an effect after hydration, requiring an `eslint-disable react-hooks/set-state-in-effect`. Due-filtering and sorting cannot happen server-side. |
| 3 | `src/components/add-plant-form/add-plant-form.tsx:40,126-131` | `localDate` starts `null`, so the "After the seasonal interval" radio label is deliberately vague until hydration; second `eslint-disable react-hooks/set-state-in-effect`. |
| 4 | `src/components/season-interval-summary/season-interval-summary.astro:29-37` | `h-5` / `h-10` pinned heights exist solely so workaround #1's text swap cannot shift layout. |
| 5 | `src/components/add-plant-form/add-plant-form.tsx:61`, `src/components/today-list/today-list.tsx:146`, `src/actions/index.ts:15,40,101,130` | Every mutation posts a `clientDate` because the server had no way to know the user's day. |

The date math itself is already sound and timezone-independent: `toEpochDay`/`fromEpochDay` (`src/lib/date.ts:4-17`) and `nextDue` (`src/lib/interval.ts:8`) work in UTC epoch days and cannot drift across DST. Only the *acquisition* of "what day is it for this user" is broken.

### Key Discoveries

- **Astro 6 changed the Cloudflare runtime API.** `Astro.locals.runtime` was **removed** in adapter v13 / Astro 6; the `cf` object is now reached as `Astro.request.cf` (and `context.request.cf` in middleware). Any plan written against `Astro.locals.runtime.cf` would not compile.
- **`cf.timezone` is available on all Cloudflare plans** — an IANA name such as `"America/Chicago"`, derived from IP geolocation. This closes the roadmap's open question about what the very first request (before any cookie exists) can render.
- **`cf` is `undefined` under `astro dev`** (no Cloudflare runtime without platform proxy) and is documented as absent in the Workers dashboard/playground preview. The unknown-timezone path is therefore the *default* local-dev experience on a cold profile, and must be genuinely good rather than a theoretical branch.
- **No dependency is needed to compute a date in a timezone.** `Intl.DateTimeFormat` with a `timeZone` option resolves it directly; verified locally against `Pacific/Auckland`. `workerd` ships full ICU.
- **The season rule is duplicated on purpose**, in `src/lib/season.ts:17` and in `mark_watered` (`supabase/migrations/20260724120000_add_season_aware_intervals.sql`), with paired "change both together" comments. This plan changes neither — the SQL takes `p_acted_on` from the caller and stays correct as long as the app passes a correct date, which is precisely what this slice fixes.
- **No test infrastructure exists** — no Vitest, no Playwright, no `test` script in `package.json`. Automated verification is `pnpm lint`, `astro check`, `pnpm build`. This matches the S-01 decision to skip test tooling.
- **`supabase/seed.sql` exists and this plan does not touch the schema**, so the seed stays aligned (per `context/foundation/lessons.md`, "Keep local seed data aligned with the database shape").
- **`src/lib/date.ts` is already the shared home for date helpers**, established by the lessons register after `todayLocalDateString()` was found duplicated across two components. New helpers belong there or in a sibling `src/lib/timezone.ts`, never inside a component.

## Desired End State

Every surface in the app agrees on what day it is, and that day is the user's:

- `/plants` and `/plants/[id]` server-render `Due today` / `Growing · then every 7 days` correctly on the first byte, with no client-side text rewriting and no reserved-height placeholders.
- The Today list is fully server-rendered — real rows, correctly filtered and sorted by the user's day — with no bootstrap skeleton and no `set-state-in-effect` suppression.
- The add-plant form's seasonal radio label is correct in the initial HTML.
- Mutations no longer accept a client-supplied date; the server derives it from the resolved timezone.
- When the timezone is genuinely unknown (no cookie, no geolocation), every surface renders exact dates (`Due 3 Aug`) and omits relative phrasing entirely — it never guesses a day.
- Neither `eslint-disable react-hooks/set-state-in-effect` comment remains in the codebase.

Verified by: loading `/plants` with the OS timezone set to `Pacific/Auckland` between local midnight and 13:00 and seeing the same due labels the Today list shows; and by `grep -r "clientDate\|set-state-in-effect\|todayLocalDateString" src` returning only the intended residue (the client-side rollover helper).

## What We're NOT Doing

- **No user-facing timezone setting.** The zone is detected, never asked for. A settings surface is not in the PRD.
- **No schema or migration changes.** No `timezone` column on `plants` or on any user record; no change to `mark_watered` / `postpone_plant` / `undo_watering_event`. The season rule stays duplicated exactly as documented.
- **No test tooling.** Verification is manual plus lint/typecheck/build, consistent with every prior slice (user decision; see Open Risks in the brief).
- **No midnight rollover outside the Today list.** `/plants` and `/plants/[id]` are correct when served and refresh on navigation.
- **No changes to the journal on `/plants/[id]`.** `acted_on`, `prev_due_on`, and `new_due_on` are historical facts rendered with `formatShortDate`; they carry no relative phrasing and need none.
- **No timezone handling for auth pages.** They render no dates.
- **No re-litigating the season boundary** (March 1 – October 31) or the postpone interval (2 days).

## Implementation Approach

One resolution chain, computed once per request, consumed everywhere:

```
cookie `tz`  →  Astro.request.cf.timezone  →  null
                                                │
                     Astro.locals.timeZone ─────┤
                     Astro.locals.today   ──────┘   (null ⇒ "unknown", render exact dates only)
```

An inline script in the document head writes the browser's real IANA zone to a long-lived cookie, so the cookie — the only source that survives a VPN or a trip — wins from the second request onward. Because the script also compares the browser's day against the day the server actually rendered with (exposed as `data-today` on `<html>`), it can trigger a single guarded reload in the rare case the server got the day wrong, rather than reloading whenever the zone string merely differs.

Consumers receive a `today: string | null` and branch once: a real date enables relative phrasing, `null` falls back to exact dates. That single branch replaces all five workarounds — the existing SSR fallback strings in `season-interval-summary.astro` become the `null` branch verbatim, so nothing is lost, it just stops being the *only* thing the server can say.

## Critical Implementation Details

**Reload-loop safety.** The head script's correcting reload is the one genuinely dangerous piece in this plan. It must be guarded on two independent conditions — the day actually differing, *and* a `sessionStorage` marker keyed to the resolved zone — so that a browser that refuses the cookie (third-party-cookie-blocking or private modes) degrades to "renders exact dates" rather than reloading forever.

**`cf` typing.** `Astro.request.cf` is not in the DOM `Request` type. The project forbids `@ts-ignore`; use a narrow local type assertion for the one property being read rather than a broad cast or an `@ts-expect-error`.

**Ordering within Phase 3.** `authed-shell.astro` must pass `today` before `today-list.tsx` drops its `null` branch, and the actions must accept the new input shape before the call sites stop sending `clientDate` — otherwise zod rejects mid-phase. Land the server side of each contract first.

---

## Phase 1: Timezone Resolution Foundation

### Overview

Establish the resolution chain and the cookie lifecycle. Nothing consumes `Astro.locals.today` yet, so this phase is invisible to users — which is exactly what makes it safe to verify in isolation.

### Changes Required

#### 1. Timezone primitives

**File**: `src/lib/timezone.ts` (new)

**Intent**: Provide the two primitives everything else depends on: validating an untrusted IANA zone string, and resolving a calendar date within a zone. Lives beside `date.ts` per the lessons register rather than inside any consumer.

**Contract**: `isSupportedTimeZone(value: string): boolean` and `getTodayInTimeZone(timeZone: string, now?: Date): string` returning `YYYY-MM-DD`. Validation must reject on shape *before* reaching `Intl` (the value arrives from a user-writable cookie), then confirm via a constructor attempt. Export the cookie name as a shared constant so middleware and the head script cannot drift.

The resolution primitive is the load-bearing piece and is easy to get subtly wrong with locale-dependent formatting, so it is specified rather than described:

```ts
const parts = new Intl.DateTimeFormat("en-US", {
  timeZone,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).formatToParts(now);
```

Assemble `year-month-day` from the named parts. Do **not** rely on a locale (including `en-CA`) emitting ISO order from `format()`.

#### 2. Request-scoped resolution

**File**: `src/middleware.ts`

**Intent**: Resolve the timezone once per request and hang it on `context.locals`, so no page, component, or action ever asks the host what day it is again. Runs alongside the existing user resolution, before the route guards.

**Contract**: sets `context.locals.timeZone: string | null` and `context.locals.today: string | null`. Precedence is cookie → `context.request.cf?.timezone` → `null`; an invalid or unsupported value at either source falls through to the next rather than throwing. Middleware never writes the cookie — the browser owns it.

#### 3. Locals typing

**File**: `src/env.d.ts`

**Intent**: Type the two new locals so consumers get `string | null` and are forced to handle the unknown case.

**Contract**: `App.Locals` gains `timeZone: string | null` and `today: string | null`.

#### 4. Cookie write + correcting reload

**File**: `src/layouts/layout.astro`

**Intent**: Give the browser — the only party that actually knows the user's zone — a way to tell the server, on the first paint, and to correct the server when geolocation guessed a zone whose calendar day is wrong.

**Contract**: `<html>` carries `data-today={Astro.locals.today ?? ""}`. An inline (non-deferred) script in `<head>` reads `Intl.DateTimeFormat().resolvedOptions().timeZone`, writes cookie `tz` (`Path=/`, `SameSite=Lax`, `Max-Age` one year, `Secure` only when `location.protocol === "https:"`), and reloads at most once when the browser's day differs from `data-today`.

The reload guard is the non-obvious part:

```js
if (browserToday !== document.documentElement.dataset.today) {
  if (sessionStorage.getItem("tz-sync") !== zone) {
    sessionStorage.setItem("tz-sync", zone);
    location.reload();
  }
}
```

A browser that rejects the cookie writes the marker, reloads once, still mismatches, and then stops — landing on the exact-dates rendering instead of looping. Wrap the whole script in `try/catch`: `sessionStorage` throws in some privacy modes, and a throw here would leave the page without its cookie.

### Success Criteria

#### Automated Verification

- Type checking passes: `pnpm astro check`
- Linting passes: `pnpm lint`
- Production build succeeds: `pnpm build`

#### Manual Verification

- With OS timezone set to `Pacific/Auckland`, load any page: the `tz` cookie is present with the correct IANA value.
- Reloading again does not trigger a second reload (check the Network panel for exactly one document request).
- Deleting the cookie and reloading with cookies blocked in DevTools produces at most one extra document request, then settles.
- In `astro dev` with a fresh profile, the first request resolves `today` to `null` (no `cf`) and the second — after the cookie lands — resolves it to the browser's date.

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 2: Server-Rendered Date Surfaces

### Overview

Make `/plants` and `/plants/[id]` tell the truth on the first byte, and delete the client-side patch (workarounds #1 and #4) that the roadmap explicitly marks as superseded by this slice.

### Changes Required

#### 1. Unknown-day formatting

**File**: `src/lib/date.ts`

**Intent**: Let the shared formatter express "I don't know what day it is" instead of pushing that branch into every caller.

**Contract**: `formatDueLabel(dateString: string, today: string | null): string` — returns `Due 3 Aug` when `today` is `null`, otherwise the existing today-relative behaviour. This widens the existing signature; no call site changes shape.

#### 2. Season summary becomes pure SSR

**File**: `src/components/season-interval-summary/season-interval-summary.astro`

**Intent**: Render the final text server-side and delete the workaround. The current SSR fallback strings are not thrown away — they become the `today === null` branch, so the honest-but-vague rendering survives exactly where it is still warranted.

**Contract**: The component reads `Astro.locals.today`. Removed entirely: the `<script>` block, every `data-season-*` attribute, and the `h-5` / `h-10` pinned heights (nothing swaps text anymore, so nothing can shift). The `mode: "active" | "full"` prop and both text shapes are retained — `full` keeps the `(active now)` annotation on the matching season, `active` keeps `{Season} · then Every N days`. With `today === null` the output is today's fallback pair: `Due {date}` plus `Growing: … · Dormancy: …`.

#### 3. Page surfaces

**Files**: `src/pages/plants/index.astro`, `src/pages/plants/[id].astro`

**Intent**: No behavioural change beyond inheriting a correct day — confirm neither page reintroduces a host-clock read and that both still render with `today === null`.

**Contract**: No prop changes; `SeasonIntervalSummary` sources the day from locals, not from props. The journal block in `[id].astro` is untouched.

### Success Criteria

#### Automated Verification

- Type checking passes: `pnpm astro check`
- Linting passes: `pnpm lint`
- Production build succeeds: `pnpm build`
- No client script remains in the component: `grep -c "<script>" src/components/season-interval-summary/season-interval-summary.astro` returns `0`
- No stale data attributes remain: `grep -r "data-season" src` returns nothing

#### Manual Verification

- With OS timezone `Pacific/Auckland` and local time between 00:30 and 12:00, a plant due today shows `Due today` on `/plants` — identical to what the Today list says.
- View source on `/plants`: the final season/interval text is present in the initial HTML, not injected afterwards.
- With JavaScript disabled, `/plants` and `/plants/[id]` still render correct relative labels (the cookie persists from an earlier JS-enabled load).
- With the `tz` cookie deleted and JS disabled, both pages show exact dates (`Due 3 Aug`) and no "today" phrasing.
- At 320px width no label wraps or clips where the pinned heights used to be.

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 3: Islands and the Action Contract

### Overview

Retire the remaining three workarounds. The Today list becomes server-rendered, the add-plant form's seasonal label is correct in the initial HTML, and `clientDate` leaves the mutation contract so the app has exactly one notion of "today".

### Changes Required

#### 1. Server-rendered Today list

**File**: `src/components/authed-shell.astro`

**Intent**: Move due-filtering and sorting to the server, where the day is now known, so the island receives rows it can render immediately.

**Contract**: Passes `today={Astro.locals.today}` to `TodayList`. When `today` is non-null the shell filters to `next_due_on <= today` for the due list and resolves the next upcoming plant; when `null` it passes the full ordered list and lets the island resolve the day after hydration. Existing Supabase query, signed-URL batching, and error handling are unchanged.

#### 2. Today list island

**Files**: `src/components/today-list/today-list.tsx`, `src/components/today-list/types.ts`, `src/components/today-list/utils.ts`

**Intent**: Delete the bootstrap workaround. The island stops being the thing that discovers the date and becomes what it should be: the thing that mutates rows and survives midnight.

**Contract**: `TodayListProps` gains `today: string | null` and `timeZone: string | null`. `useState` seeds from the `today` prop instead of `null`; the bootstrap `useEffect` that set it, and its `eslint-disable react-hooks/set-state-in-effect`, are removed. The `today === null` skeleton branch and `BOOTSTRAP_ROW_COUNT` are deleted — with a `null` day the list renders real rows using the exact-date phrasing from Phase 2.

Retained and extended: the midnight rollover timer, which now recomputes via `getTodayInTimeZone(timeZone)` (falling back to the browser zone when `timeZone` is `null`) so it shares Phase 1's authority rather than re-deriving one. Because this island is now the *only* surface with rollover, it also picks up the `pageshow` and `visibilitychange` rechecks deleted from `season-interval-summary.astro` in Phase 2 — a sleeping laptop or a bfcache restore can land past midnight without the timer having fired.

#### 3. Add-plant form

**File**: `src/components/add-plant-form/add-plant-form.tsx`

**Intent**: Remove the second bootstrap workaround so the seasonal radio label is right in the initial HTML.

**Contract**: Accepts `today: string | null` as a prop (passed from `src/pages/plants/new.astro`), replacing the `localDate` state and its `useEffect` + `eslint-disable`. The existing `null` rendering — "After the seasonal interval" with no season label — is preserved verbatim as the unknown-day branch. The `clientDate` line in `onSubmit` is deleted.

#### 4. Server-derived mutation dates

**Files**: `src/actions/index.ts`, `src/types.ts`

**Intent**: Make the server the sole authority for the acted-on date, so a client can no longer post a day that disagrees with what it was shown.

**Contract**: `clientDate` is removed from the `addPlant`, `markWatered`, and `postponePlant` zod schemas, and from `AddPlantInput` / `MarkWateredInput` in `src/types.ts`. Each handler derives the date from `context.locals.today`. Because the head script writes the cookie before any interaction is possible, `locals.today` being `null` at mutation time means both the cookie and geolocation are unavailable; in that case fall back to a UTC-derived date — a mutation must record *some* day, and this is the only case where the app has nothing better. Note that decision inline, since it is the one place the plan knowingly accepts the old behaviour. `undoWateringEvent` takes no date and is unchanged; all three SQL RPCs and their `p_acted_on` parameters are unchanged.

### Success Criteria

#### Automated Verification

- Type checking passes: `pnpm astro check`
- Linting passes: `pnpm lint`
- Production build succeeds: `pnpm build`
- Both suppressions are gone: `grep -r "set-state-in-effect" src` returns nothing
- The client date contract is gone: `grep -r "clientDate" src` returns nothing

#### Manual Verification

- Loading `/` with a warm cookie shows real plant rows in the initial HTML (view source) — no skeleton frame, no visible flash of placeholder rows.
- Marking a plant watered still reschedules correctly and the undo toast restores the prior due date.
- Postpone still advances by 2 days and undo reverts it.
- Adding a plant with "After the seasonal interval" selected uses the correct seasonal interval; the radio label shows the right day count and season on first paint, before hydration.
- With OS timezone `Pacific/Auckland` between 00:30 and 12:00, `/` and `/plants` agree on which plants are due.
- Crossing local midnight with the Today list open (or sleeping the machine across it) refreshes the day on wake without a manual reload.
- On `/plants/new`, `/`, and `/plants` at 320px, no layout regression versus the current build.

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation. This is the final phase.

---

## Testing Strategy

No automated test tooling is introduced (user decision, consistent with S-01 onward). Verification rests on typecheck, lint, build, and a deliberate manual matrix.

### Manual Testing Matrix

Timezone is changed at the OS level; the browser follows. Delete the `tz` cookie between rows to test cold state.

| # | Timezone | Cookie | JS | Expect |
| - | -------- | ------ | -- | ------ |
| 1 | `Pacific/Auckland` (UTC+12/13), local time 00:30–12:00 | present | on | `/`, `/plants`, `/plants/[id]` all agree; a plant due today reads `Due today` everywhere |
| 2 | `Pacific/Auckland` | deleted | on | First paint may show exact dates; exactly one corrective reload; then correct relative labels |
| 3 | `Pacific/Auckland` | deleted | off | Exact dates (`Due 3 Aug`) on every surface, no "today" phrasing, no broken layout |
| 4 | `Pacific/Kiritimati` (UTC+14) | present | on | Same as row 1 — the widest positive offset |
| 5 | `Pacific/Midway` (UTC-11) | present | on | Same as row 1 — the widest negative offset |
| 6 | `Europe/Warsaw`, clock set to 23:58 | present | on | Today list rolls over at 00:00 without a manual reload |
| 7 | `Europe/Warsaw`, DST boundary (last Sunday of March, ~02:00→03:00) | present | on | The day does not skip or repeat; intervals stay calendar-exact |
| 8 | Any, cookie forged to `Not/AZone` | present | on | Falls back to geolocation, then to exact dates — never throws, never 500s |
| 9 | Any, cookies blocked at the browser level | n/a | on | At most one extra document request, then settles on exact dates |

### Regression Checks

Re-run the postpone/undo and add-plant flows from `context/changes/postpone-and-undo` and `context/changes/core-watering-loop` after Phase 3, since both had their input contract changed.

## Performance Considerations

The resolution chain is two cookie reads and one `Intl.DateTimeFormat` construction per request — negligible against the existing Supabase round trips. Constructing `Intl.DateTimeFormat` is the more expensive half; resolve `today` once in middleware and pass it down rather than re-resolving per component.

Net client-side, the change is a reduction: ~60 lines of inline script and a skeleton render leave the bundle, replaced by a handful of lines in `<head>`. The corrective reload costs one extra document request, and only on a cold profile whose geolocated zone lands on a different calendar day than the browser's.

Because rendering now varies by the `tz` cookie, any future edge caching of authenticated HTML would need to vary on it. Nothing in the current setup caches these responses, so no action is required now.

## Migration Notes

No data migration. Existing rows carry `next_due_on` as a plain `DATE`, which is already timezone-independent; this change alters only how the app *interprets* "today" when comparing against it. No stored dates are rewritten.

Existing users get the cookie on their next page load. On that first load their zone may be geolocated or unknown, so they may see exact dates or one corrective reload; from the second load on, behaviour is stable.

Rollback is a straight revert — no schema, RPC, or stored-data changes to unwind.

## References

- Roadmap slice: `context/foundation/roadmap.md` — S-08, including the "supersedes the workaround in S-05" instruction
- Superseded workaround, as originally planned: `context/changes/season-aware-intervals/plan.md`
- The `clientDate` decision this slice reverses: `context/changes/core-watering-loop/plan-brief.md:25`
- Shared-helper rule: `context/foundation/lessons.md` — "Extract generic helpers to src/lib"
- Astro 6 Cloudflare runtime API: `Astro.request.cf`; `Astro.locals.runtime` removed in adapter v13
- Season rule duplication: `src/lib/season.ts:17` ↔ `supabase/migrations/20260724120000_add_season_aware_intervals.sql`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Timezone Resolution Foundation

#### Automated

- [x] 1.1 Type checking passes: `pnpm astro check` — 20507ec
- [x] 1.2 Linting passes: `pnpm lint` — 20507ec
- [x] 1.3 Production build succeeds: `pnpm build` — 20507ec

#### Manual

- [x] 1.4 `tz` cookie is written with the correct IANA value — 20507ec
- [x] 1.5 Second load does not trigger another reload — 20507ec
- [x] 1.6 Cookies-blocked case settles after at most one extra request — 20507ec
- [x] 1.7 `astro dev` cold profile resolves `null` then the browser's date — 20507ec

### Phase 2: Server-Rendered Date Surfaces

#### Automated

- [x] 2.1 Type checking passes: `pnpm astro check` — 712f949
- [x] 2.2 Linting passes: `pnpm lint` — 712f949
- [x] 2.3 Production build succeeds: `pnpm build` — 712f949
- [x] 2.4 No `<script>` remains in `season-interval-summary.astro` — 712f949
- [x] 2.5 No `data-season` attributes remain in `src` — 712f949

#### Manual

- [x] 2.6 `/plants` agrees with the Today list at UTC+13 before noon — 712f949
- [x] 2.7 Final season/interval text is present in the initial HTML — 712f949
- [x] 2.8 Both pages render correct labels with JavaScript disabled — 712f949
- [x] 2.9 Cookie-less + JS-disabled renders exact dates only — 712f949
- [x] 2.10 No wrap or clip at 320px where heights were pinned — 712f949

### Phase 3: Islands and the Action Contract

#### Automated

- [x] 3.1 Type checking passes: `pnpm astro check`
- [x] 3.2 Linting passes: `pnpm lint`
- [x] 3.3 Production build succeeds: `pnpm build`
- [x] 3.4 No `set-state-in-effect` suppressions remain in `src`
- [x] 3.5 No `clientDate` references remain in `src`

#### Manual

- [x] 3.6 Today list renders real rows in the initial HTML, no skeleton flash
- [x] 3.7 Mark watered + undo still work end to end
- [x] 3.8 Postpone + undo still work end to end
- [x] 3.9 Add plant "After the seasonal interval" is correct on first paint
- [x] 3.10 `/` and `/plants` agree on due plants at UTC+13
- [x] 3.11 Midnight rollover and wake-from-sleep refresh the day
- [x] 3.12 No layout regression at 320px on the three surfaces
