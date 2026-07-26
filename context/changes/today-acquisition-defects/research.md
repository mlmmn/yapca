---
date: 2026-07-26T17:59:53+02:00
researcher: mlmmn
git_commit: 5a77d7ef14850187d8e0766ac38b0b7dd0d66d89
branch: main
repository: yapca
topic: "Resolving the date-acquisition defects for good, and whether SSR is worth keeping"
tags: [research, codebase, dates, timezone, ssr, rendering-mode, architecture, mvp-readiness]
status: complete
last_updated: 2026-07-26
last_updated_by: mlmmn
---

# Research: Resolving the date-acquisition defects for good, and whether SSR is worth keeping

**Date**: 2026-07-26T17:59:53+02:00
**Researcher**: mlmmn
**Git Commit**: `5a77d7ef14850187d8e0766ac38b0b7dd0d66d89`
**Branch**: `main`
**Repository**: yapca

> **Note on references.** Local `HEAD` (`5a77d7e`) is **two commits ahead of `origin/main`** (`727c590`). GitHub permalinks at this SHA would 404, so all references below are local paths. Push before treating any reference here as a shareable link.

## Research Question

> today-acquisition-defects — I want date issues to be resolved once and for all. Assess if it's worth completely ditching SSR, since it gives more headaches than providing an actual benefit. Right now the test plan is done on 1st phase, so I guess we have some room to adjust before considering MVP is ready to be handed over to course assessment.

**Scope agreed before research** (via clarification):
- The course rubric places **no constraint** on rendering mode — the SSR question is decided on engineering merit alone.
- Deliverable is a **full option comparison**, not a narrow keep/ditch verdict.
- **Research only.** No fix is prescribed; planning happens in a separate pass.

---

## Summary

**On the SSR question: ditching SSR would genuinely dissolve two of the three defects, and it is not worth doing.** The reason is not that SSR is load-bearing — remarkably little of it is — but that a much cheaper change buys the same structural fix. The defects are caused by *split date ownership*, not by server rendering. SSR is where the split is currently visible, not where it originates.

Five findings drive that conclusion:

1. **Nothing blocks a static migration, and the cost is still ~30 discrete items.** There is no service-role key anywhere in the repo, no httpOnly cookie barrier (`@supabase/ssr` defaults to `httpOnly: false` and the code overrides nothing), no email-callback route to rebuild, and RLS is a complete authorization layer independent of the server tier. But `/plants` and `/plants/[id]` are **145 and 168 lines of pure Astro with zero islands** and would need wholesale React ports; the two dynamic routes have no `getStaticPaths` and would need SPA-fallback routing; and Astro middleware does not run per-request in a static build, so auth gating *and* date resolution both lose their home at once.

2. **The date defects are a split-ownership problem with a cheaper structural fix.** `today` is resolved at three moments from three sources: middleware (cookie → `cf.timezone` → null) at render, the island's rollover effect after hydration, and `getActionDate` at submit — with a **UTC fallback** the user never sees. Making the browser the single authority for both reads and writes kills D-2 and D-3 exactly as thoroughly as going static would, at roughly a third of the work, while keeping SSR.

3. **SSR was never actually chosen.** No document in `context/` weighs SSR against static or SPA. `output: "server"` enters the record as a *discovered constraint* at `context/archive/2026-07-19-finish-auth-and-route-gating/plan.md:25`, inherited from the starter. There is no sunk decision to relitigate — the question is genuinely open, which is precisely why it deserves a decision on the merits rather than a reflex either way.

4. **A fourth defect exists and it is the one that makes D-1 unrescuable.** The corrective-reload guard in `src/layouts/layout.astro:43` is keyed on the **time zone**, not the date. After a real local midnight the browser's day disagrees with `data-today`, but the guard already matches — so no reload fires. The app's only stale-date correction outside `TodayList` is structurally suppressed in exactly the situation it was built for. Recorded below as **D-4**.

5. **Production empirically confirms `cf.timezone` closes the null window.** A cold `curl` with no cookie against `https://yapca.mlmmn.workers.dev/` returns `data-today="2026-07-26"` — the middleware resolved a real calendar date from IP geolocation alone, on request one. This is direct evidence for the claim that D-2 and D-3 are predominantly `pnpm dev` / `pnpm preview` phenomena, and equally direct evidence that **Option 3 would remove the mechanism that currently protects production**. The same check also retires a documentation-based concern: the deployed app is current, not the skeleton `context/deployment/deployment-plan.md:18-20` describes (see §3.6).

**On the timing question:** you have ~7 after-hours weeks to the recorded `hard_deadline: 2026-09-14`, against a backlog of S-07 (delete-plant, a must-have FR), S-09 (design polish), four pending test-plan phases, and this change. Phase 1 being complete gives you room to adjust the *test* strategy cheaply — 55 of 56 assertions are pure and survive any rendering-mode change — but it gives you no slack in the *build* budget.

---

## Detailed Findings

### Part 1 — How `today` actually flows

#### 1.1 The three resolution moments

| # | Moment | Site | Source | Failure behaviour |
|---|---|---|---|---|
| 1 | **Request** | `src/middleware.ts:12-19` | `tz` cookie → `request.cf.timezone` → `null` | `locals.today = null` (silent) |
| 2 | **Post-hydration** | `src/components/today-list/today-list.tsx:236-244` | `Intl` browser zone, self-rescheduling timer | Inert when `timeZone === null` (early return `:229-231`) |
| 3 | **Submit** | `src/actions/index.ts:22-26` | `locals.today` → **`getTodayInTimeZone("UTC")`** | Cannot fail; silently produces a possibly-wrong day |

Moment 3's fallback is the sharp edge. It cannot throw, it is never surfaced to the user, and it feeds `selectSeasonInterval`, `nextDue`, `resolveScheduleChange`, and both RPCs' `p_acted_on` unmodified.

#### 1.2 Who consumes it

`today` reaches five surfaces, and only one of them owns it:

```
middleware.ts:18-19  →  context.locals.{timeZone, today}
   │
   ├─► layouts/layout.astro:13          data-today="…"      (feeds the reload heuristic)
   │
   ├─► components/authed-shell.astro:64,66
   │        <TodayList today timeZone />  ── the ONLY island that also receives timeZone
   │        └─► today-list.tsx:28  useState → refreshed at :236-244   ✅ owns its date
   │
   ├─► pages/plants/new.astro:17
   │        <AddPlantForm today />        ── frozen for the island's lifetime   ❌
   │
   ├─► pages/plants/[id]/edit.astro:87
   │        <EditPlantForm today />       ── frozen for the island's lifetime   ❌
   │
   └─► season-interval-summary.astro:13
            reads Astro.locals.today DIRECTLY — no prop   ❌ welded to the server
```

Two asymmetries matter for any fix:
- **`timeZone` is drilled to exactly one component.** The two forms *cannot* recompute their date even if you wanted them to — they were never given the zone.
- **`SeasonIntervalSummary` reaches into `Astro.locals`** rather than accepting a prop, making it the one component that cannot be reused outside an Astro request. Note this was flagged in review at `context/archive/2026-07-24-user-timezone-dates/reviews/plan-review.md:241` (F6) and the decision line reads `PENDING`.

#### 1.3 The database is not a party to this

Verified across all four migrations: **the DB never computes a calendar date.** `next_due_on`, `acted_on`, `prev_due_on`, `new_due_on` are all `date` columns with no defaults, always supplied by the app. The only clock Postgres reads is `now()` for `created_at`/`updated_at` audit timestamps, plus `current_date` in `supabase/seed.sql:75-77` (local fixtures only). The SQL season branch (`supabase/migrations/20260724120000_add_season_aware_intervals.sql:60-65`) is a pure function of the app-supplied `p_acted_on`.

**Consequence:** the database is a faithful mirror of whatever day the app decides. It can neither correct a wrong one nor detect one. This is deliberate and locked in early — `context/archive/2026-07-19-core-watering-loop/plan.md:23` rejects `timestamptz` for `next_due_on` because *"storing a time-of-day would let the reappearance instant drift across cycles, violating the determinism NFR."* Do not reopen that; it is correct.

#### 1.4 No SQL filters by date

Worth stating explicitly because it changes the migration calculus: `authed-shell.astro:19-20` and `plants/index.astro:20` order by `next_due_on` / `name` and nothing more. **The "due today" cut is made entirely client-side** at `today-list.tsx:221`. All filtering, all classification, and all formatting already run in the browser today.

---

### Part 2 — The defects, verified

#### D-1 — Forms freeze `today`; preview and save can disagree — **CONFIRMED**

`Astro.locals.today` is captured at SSR (`plants/new.astro:17`, `plants/[id]/edit.astro:87`) and passed as a plain prop. Neither island has any effect touching it — `add-plant-form.tsx` has effects only at `:119-123` (autofocus) and `:125-131` (object-URL cleanup); `edit-plant-form.tsx` only at `:219-223`, `:225-231`, `:233-237`. At submit, middleware re-runs and `getActionDate` returns the **new** day.

**Failure scenario.** `Europe/Warsaw`, 2026-10-31 (final growing day) at 23:52. Open `/plants/new`, set growing = 7, dormancy = 30. The radio at `add-plant-form.tsx:256-262` renders *"After 7 days"* and *"Growing season"*. Submit at 00:04 on 2026-11-01. `actions/index.ts:41-45` picks **30**; `:46` stores `next_due_on = 2026-12-01`. The user was promised 2026-11-07.

The edit form fails worse. `buildSchedulePreview` (`edit-plant-form/utils.ts:48-55`) computed `deltaDays` against the growing pair; `updatePlant` (`actions/index.ts:121-128`) recomputes against the dormancy pair. A change that previewed *"no movement"* (`deltaDays === 0`, so `:157` omits `next_due_on` and `:161-163` skips the concurrency guard) instead moves the due date **and** activates an `updated_at` check the user never expected — surfacing as *"This plant changed elsewhere"* (`:173`).

**Historical note:** this exact bug was found and fixed once already, at S-05 (`context/archive/2026-07-23-season-aware-intervals/reviews/impl-review.md:34-42`, F1 — *"A form left open across local midnight submits yesterday's date"*). S-08 then removed the client-side date mechanism that carried the fix, and the exclusion it wrote — *"No midnight rollover outside the Today list"* (`context/archive/2026-07-24-user-timezone-dates/plan.md:56`) — **does not name the forms.** The regression was descoped implicitly, never reasoned about.

#### D-2 — UTC fallback picks the wrong season west of UTC — **CONFIRMED**

`src/actions/index.ts:25`, reachable from all four dated actions (`:40`, `:104`, `:214`, `:243`) whenever the null window is open.

**Failure scenario.** `America/Los_Angeles` (UTC−8), cookies blocked, non-Cloudflare host. 2026-02-28 at 17:00 local is 2026-03-01 01:00 UTC. Monstera with growing = 7, dormancy = 30: correct reschedule is 2026-02-28 + 30 = **2026-03-30**. Instead `mark_watered` receives `p_acted_on = '2026-03-01'`, the SQL branch at `20260724120000:60-61` classifies it *growing*, and stores **2026-03-08** — 22 days early. The journal row records `acted_on = 2026-03-01`, a day the user had not reached, displayed verbatim at `plants/[id].astro:130`.

The error is symmetric: `Pacific/Kiritimati` (UTC+14) is wrong in the other direction, which `src/lib/timezone.test.ts:26-27` already pins as a property of the helper.

**This fallback was a knowing trade.** `context/archive/2026-07-24-user-timezone-dates/plan.md:265`: *"a mutation must record some day, and this is the only case where the app has nothing better. Note that decision inline, since it is the one place the plan knowingly accepts the old behaviour."* What was not reasoned about is the season-boundary consequence — the fallback triggers on exactly the four dates Risk #6 names.

#### D-3 — `today === null` widens the Today list — **CONFIRMED on the widening; the recovery claim needs correcting**

`today-list.tsx:221`:
```ts
const dueList = today === null ? optimisticPlants : optimisticPlants.filter((p) => p.next_due_on <= today);
```

`optimisticPlants` is every plant the user owns, unfiltered from `authed-shell.astro:16-20`. The degraded screen lists plants due months out, with no count (`:316` suppresses it), no overdue cues (`:345` → `dueStatus = null`), and **fully live Watered / Postpone buttons** (`:404-421`). One tap on a not-yet-due plant fires `markWatered` → D-2's UTC date → a persisted reschedule the user never intended. D-3 and D-2 compound.

**Correction to the handed-off description.** The claim that a blocked `sessionStorage` leaves the browser degraded *indefinitely* is too strong. The cookie is written at `layout.astro:28`, **before** any `sessionStorage` access at `:43` — deliberately, per the F8 fix at `context/archive/2026-07-24-user-timezone-dates/reviews/impl-review.md:130-138`. So a throwing `sessionStorage` degrades **one page**, and the next navigation recovers.

The genuinely unrecoverable configuration is the inverse: **cookies blocked while `sessionStorage` works**, on a host with no `cf.timezone`. Line `:28` silently no-ops, `:44` stores the zone, `:45` reloads once, and the second load short-circuits at `:43` — no cookie, no further reloads, `today` null for the session, no signal to the user. Same terminal state with JS off.

**Production is largely protected** by `cf.timezone` (`middleware.ts:14-15`). The null window is predominantly a `pnpm dev` / `pnpm preview` phenomenon plus edge cases where IP geolocation returns nothing.

**On the intended contract — the record is silent.** The archive states clearly that unknown-zone means *exact dates, never a guessed day* (`plan.md:46`, matrix row 9 at `:309`). It says nothing about Today-list *membership*. The one acknowledgement is a tradeoff line inside the recommended review fix — `context/archive/2026-07-24-user-timezone-dates/reviews/plan-review.md:85`: *"with no day the list cannot be due-filtered — it shows every plant"* — immediately followed by `:89`: *"Blind spot: The unfiltered Today list needs a heading/empty-state decision that no phase currently makes."* The decision line reads `PENDING`. The hand-off note in `change.md` is right to refuse to settle it.

Also worth recording: the reasoning that made Fix B tolerable was *"the null-with-JS case is transient"* (`plan-review.md:64-66`). D-3 and D-4 are precisely the invalidation of that assumption.

#### D-4 — The reload guard is keyed on the zone, so it suppresses midnight correction — **NEW**

`src/layouts/layout.astro:42-47`:
```js
if (browserToday !== document.documentElement.dataset.today) {
  if (sessionStorage.getItem("tz-sync") !== timeZone) {   // ← keyed on the ZONE
    sessionStorage.setItem("tz-sync", timeZone);
    location.reload();
  }
}
```

The outer condition detects a **date** mismatch; the inner guard is keyed on the **zone**. After a real local midnight on any page, the outer condition is true and the inner one is false — so nothing happens. The app's only stale-date correction mechanism outside `TodayList` is structurally unable to fire in the one situation it would help.

This is why D-1 has no safety net. The reload was itself a contested piece: `plan-review.md:210-239` (F5) recommended dropping it entirely — *"the corrective reload is the plan's own 'dangerous piece' for one page view"* — and the recommendation was **silently declined with no written rationale**. The guard as shipped keeps the danger and loses the benefit.

Whether this is worth fixing depends entirely on which option below is taken — under Options 2 and 3 the script is deleted outright.

---

### Part 3 — The SSR option comparison

#### 3.1 What SSR actually buys, audited

| Claimed benefit | Reality |
|---|---|
| **SEO** | **Nil.** Every page except the signed-out `/` and `/auth/*` sits behind auth. The public content is one sentence (`index.astro:14`). `@astrojs/sitemap` is installed (`astro.config.mjs:11`) but **`site` is never configured**, so it emits nothing. No meta description, no OG tags, no robots.txt. |
| **Data before paint** | Real on 4 of 8 pages (`authed-shell.astro:9-51`, `plants/index.astro:10-51`, `[id].astro:20-55`, `edit.astro:19-40`). A latency nicety an island fetch replaces — and `context/foundation/infrastructure.md:59,67` already argues *"the list's speed is Supabase latency, not Cloudflare's"*. |
| **No auth flash** | **Real and user-visible.** `middleware.ts:33-41` returns a 302 before any HTML. Lost in a static build. |
| **No-JS auth forms** | **Real and user-visible.** Sign-in/up/out/resend are plain `<form method="post">` (`signin.astro:15`, `header.astro:30`). Lost in a static build. |
| **Server-set 404s** | Real HTTP 404s at `[id].astro:60,66`, `edit.astro:46`. Minor. |
| **Honest server-rendered relative dates** | S-08's headline benefit (`context/archive/2026-07-24-user-timezone-dates/plan.md:5,42-43`) — *and the direct cause of D-1 through D-4.* |
| **CDN caching** | Already forfeited. `infrastructure.md:63`: *"Cookie-session SSR makes every logged-in route dynamic, so Cloudflare's global-CDN selling point mostly doesn't apply behind login."* |

Honest accounting: **two of seven are genuinely user-visible**, and one is the source of the problem being investigated.

#### 3.2 What blocks a static migration — nothing hard

Verified negative on every classic blocker:
- **No service-role key.** `grep service_role` across `src/`, `supabase/migrations/`, `scripts/`, `.github/` → **zero hits**. All five actions and all four API routes use the anon key under RLS.
- **No httpOnly barrier.** `@supabase/ssr` `DEFAULT_COOKIE_OPTIONS` is `httpOnly: false`, and `src/lib/supabase.ts:19-23` overrides nothing. A `createBrowserClient` on the same origin reads and refreshes the *same* cookies.
- **No secret that cannot ship to a browser.** Only `SUPABASE_URL` + `SUPABASE_KEY` (anon), declared `context: "server"` by convention at `astro.config.mjs:21-22`. Flipping to `context: "client", access: "public"` is a two-line change.
- **No email-callback route to rebuild.** There is no `/auth/callback`, no `exchangeCodeForSession`, no `verifyOtp` anywhere. Supabase's hosted `/auth/v1/verify` handles the link. *(Caveat: this also means the flow is not PKCE-complete. If email confirmation is ever enabled in production, a callback route is needed — under either architecture.)*
- **No RLS or migration changes at all.** The four migrations are a complete authorization layer independent of the server tier.

**The real blockers are shape, not security:**
1. **Middleware does not run per-request in a static build.** Verified against Astro 6 docs via Context7: `output: 'static'` prerenders by default, and middleware evaluates at *build* time per prerendered page. `locals.user`, `locals.today`, and the `PROTECTED_ROUTES` redirect would all resolve once at build against no real request. Auth gating and date resolution lose their home simultaneously. *(Context7 gap worth flagging: `middlewareMode: 'edge'` is documented for the Netlify and Vercel adapters; no equivalent is documented for `@astrojs/cloudflare`.)*
2. **Two pages are pure Astro with zero islands.** `plants/index.astro` (145 lines of markup) and `plants/[id].astro` (168 lines, including the journal list and a `SeasonIntervalSummary` usage) would need wholesale React ports.
3. **Dynamic routes have no `getStaticPaths`.** `/plants/[id]` and `/plants/[id]/edit` have unknowable-at-build IDs. Requires SPA-fallback rewriting in `wrangler.jsonc` (currently `not_found_handling: "404-page"`).
4. **Signed URLs expire in 1 hour** (`src/lib/photo.ts:15`). Server-rendered, every page load re-signs. A long-lived SPA session needs re-signing-on-expiry logic that does not exist today.

Full enumeration: **30 discrete work items**, clustered in auth guards (7), the two Astro→React page ports (2 large), and route resolution (1). Items that *remove* code rather than relocate it: exactly 3 (the date items).

#### 3.3 The four options

| | **1 — Fix in place** | **2 — Client owns the date** | **3 — Ditch SSR** | **4 — Document, don't fix** |
|---|---|---|---|---|
| **Shape** | Keep server-authoritative dates; patch each defect | Browser is the single date authority for reads *and* writes; SSR keeps everything else | `output: "static"` + client-side data | Ship as-is; record known limitations |
| **D-1** | ✅ Drill `timeZone` into both forms, add rollover | ✅ Dissolves — form reads its date at submit | ✅ Dissolves | ❌ |
| **D-2** | ⚠️ **Not structurally.** A mutation must have *some* date; the UTC fallback survives by construction | ✅ Dissolves — browser always knows its zone | ✅ Dissolves | ❌ |
| **D-3** | ⚠️ Needs the product decision either way, then a fix | ⚠️ Needs the product decision for **first paint only**; the island can own its day after hydration | ✅ Dissolves | ❌ |
| **D-4** | Must fix (re-key guard on the date) | Script deleted outright | Script deleted outright | ❌ |
| **Effort** | ~6–10 files | ~8–12 items | **~30 items**, incl. 2 wholesale page ports | 0 |
| **Loses** | Nothing | S-08's server-rendered relative dates on first paint | No-JS auth forms; redirect-before-paint; server 404s | Nothing |
| **Adds** | Nothing | A trust boundary: client-supplied date needs plausibility validation | Auth flash; SPA-fallback routing; signed-URL re-signing | Nothing |
| **Reversibility** | High | High | **Low** — the Astro→React ports are one-way |
| **Test-plan impact** | None | Minor | **§8 refresh trigger**; Phases 2 and 4 re-scoped, Phase 5 mechanics change |
| **Reopens** | — | S-08's abolition of client-side dates (needs written rationale) | Never-made SSR decision (nothing to reopen) | — |

#### 3.4 The load-bearing observation about Option 2

Option 2 is the one the archive appears to foreclose — and the foreclosure does not survive inspection.

S-08 removed client-side date resolution for a specific, correct reason. `context/archive/2026-07-24-user-timezone-dates/reviews/impl-review.md:62` (F3): *"Server records UTC while the island shows a browser-zone date — Auckland + cookies blocked → `mark_watered(p_acted_on='…-07-25')` a day early… this repeats on every mutation, not once."* The fix removed the browser fallback so that reads could not disagree with writes. That reasoning is sound **given that the server dates the writes**.

Option 2 removes that premise. If the *write* is also dated by the browser, reads and writes agree by construction, and the prohibition dissolves along with its cause. The comment now standing at `today-list.tsx:226-228` — *"Guessing a day here would disagree with what gets stored"* — becomes false rather than violated.

Note also that this is not novel territory: **S-01 through S-07 shipped a client-supplied `clientDate`**, validated server-side by `clientDateSchema` (`context/archive/2026-07-20-plant-detail-and-journal/plan.md:24`). The recorded reservation was `context/archive/2026-07-19-core-watering-loop/plan-brief.md:59`: *"The server validates it's a plausible YYYY-MM-DD but cannot fully attest it — acceptable for a single-user personal MVP."* Under Option 2 the server can now do materially better than S-01 could, because `cf.timezone` gives it an independent plausibility check that did not exist then.

**And the PRD already specifies browser-local.** `context/foundation/prd.md:164`: *"The season active on the **browser-local** schedule-creation date selects the interval."* The current server-authoritative design is an *approximation* of the PRD's stated contract, and D-1 through D-4 are the places where the approximation leaks.

#### 3.5 What the SSR decision would cost the schedule

Recorded constraints (`prd.md:12-15`, `roadmap.md:10`):
```yaml
timeline_budget: { mvp_weeks: 3, hard_deadline: 2026-09-14, after_hours_only: true }
top_blocker: time
main_goal: quality
```

~7 calendar weeks remain, after-hours only. Outstanding work:
- **S-07 delete-plant** — `proposed`, and FR-007 is a **must-have**. Not optional for MVP completeness.
- **S-09 design-review-and-polish** — `proposed`, terminal, and the gate for the launch-blocking a11y NFR.
- **Test-plan Phases 2–5** — four of five pending.
- **This change** — unplanned, `status: preparing`.
- **A redeploy** — see below.

Option 3 consumes a large fraction of that budget and re-scopes two pending test phases, against a `top_blocker: time` / `main_goal: quality` posture that `roadmap.md:221` already interprets as *"non-essentials are deferred rather than sequenced."*

#### 3.6 Deployment: verified current, and the record is stale

`context/deployment/deployment-plan.md:18-20` records the app as **"a skeleton"** when deployed — `index.astro` rendering the word "yapca", empty `PROTECTED_ROUTES`, no migrations — predating S-01 through S-08, with no record of a redeploy since and no deploy job in CI to have done one automatically (`context/archive/2026-07-26-testing-runner-and-calendar-math/plan.md:527-531`).

**Checked directly on 2026-07-26; the record is out of date and the deployment is current:**

```
GET /             → 200, 9114 B, <title>yapca</title>
                    "The daily plant-care list you can actually trust."   ← current hero copy
                    data-today="2026-07-26"                               ← middleware live
GET /auth/signin  → 200
GET /plants       → 302                                                   ← PROTECTED_ROUTES active
```

Two things follow. First, the handover risk here is documentation, not deployment: **`context/deployment/deployment-plan.md` should be corrected** so the next reader is not misled the way this research initially was. Second, and more useful — the `data-today` value arrived on a **cold request with no `tz` cookie**, which is a live production demonstration that `cf.timezone` resolves the zone on request one. Two consequences for the options table:

- D-2 and D-3 are, in production, **narrow** — confined to visitors whose IP yields no geolocation, or who block cookies *and* would need the fallback anyway. Their severity in daily use is far lower than a local-dev reading suggests. This weakens the urgency case for any option.
- Option 3 **deletes this protection.** A static build has no request object and therefore no `cf.timezone`, making the browser-handshake window universal on first paint — in production, not just locally. Going static to fix the date defects would remove the one mechanism currently preventing them from being widespread.

---

## Code References

**Date resolution**
- `src/middleware.ts:12-19` — the cookie → `cf.timezone` → null chain; sets `locals.timeZone` / `locals.today`
- `src/actions/index.ts:22-26` — `getActionDate`, the UTC fallback (**D-2**)
- `src/layouts/layout.astro:13` — `data-today` on `<html>`
- `src/layouts/layout.astro:23-51` — inline cookie-write + corrective reload; `:42-47` is the zone-keyed guard (**D-4**)
- `src/lib/timezone.ts:1-5` — the paired keep-in-sync comment contract with `layout.astro`
- `src/lib/timezone.ts:57-65,67-94` — `getTodayInTimeZone`, `getMillisecondsUntilNextMidnight`

**Consumers**
- `src/components/today-list/today-list.tsx:28` — the only island that owns its date
- `src/components/today-list/today-list.tsx:221` — the null-widening filter (**D-3**)
- `src/components/today-list/today-list.tsx:236-244,247-258` — rollover timer, `pageshow`/`visibilitychange`
- `src/components/add-plant-form/add-plant-form.tsx:31,237-238` — frozen `today` (**D-1**)
- `src/components/edit-plant-form/edit-plant-form.tsx:37,344-351` — frozen `today` (**D-1**)
- `src/components/season-interval-summary/season-interval-summary.astro:13` — reads `Astro.locals` directly, no prop
- `src/components/authed-shell.astro:64,66` / `src/pages/plants/new.astro:17` / `src/pages/plants/[id]/edit.astro:87` — prop sites

**Rendering mode**
- `astro.config.mjs:10,15` — `output: "server"`, `adapter: cloudflare()`
- `astro.config.mjs:11` — `sitemap()` with no `site`, emits nothing
- `astro.config.mjs:16-18,21-22` — `actionBodySizeLimit`, the two `context: "server"` env vars
- `wrangler.jsonc:4,7-11` — SSR entrypoint, `not_found_handling: "404-page"`
- `src/lib/supabase.ts:11,19-23` — `createServerClient`, cookie adapters, no `cookieOptions` override
- `src/pages/plants/index.astro:104-138` / `src/pages/plants/[id].astro:78-164` — zero-island Astro markup

**Persistence**
- `supabase/migrations/20260724120000_add_season_aware_intervals.sql:60-67` — SQL season branch on `p_acted_on`
- `supabase/migrations/20260723120000_*.sql:101` — `postpone_plant` `p_acted_on + 2`
- `supabase/migrations/20260719120000_create_plants.sql:17-30` — `updated_at` trigger (concurrency token)

**Tests**
- `vitest.config.ts:1-6` — why `getViteConfig()` is deliberately not used
- `src/lib/timezone.test.ts:68-74` — the one SSR-design-coupled test (reads `layout.astro`, asserts `tz=`)
- `src/lib/season.test.ts:16-29` — the authoritative `SEASON_BOUNDARIES` table
- `.github/workflows/ci.yml:35-36` — the dual `TZ=UTC` / `TZ=America/New_York` legs

---

## Architecture Insights

**The bug class is "split ownership of a client-local fact", not "server rendering".** `today` is knowable only in the browser, needed in three places, and currently resolved independently in each. Every one of D-1 through D-4 is two of those resolutions disagreeing. Any architecture reducing them to one authority fixes the class; the rendering mode determines only *where* that authority lives, and both placements are viable.

**Coupling is far weaker than it looks.** The entire `src/lib` date layer — `date.ts`, `season.ts`, `interval.ts`, `schedule.ts`, `timezone.ts` — is pure, I/O-free, and **already ships to the browser**: `today-list.tsx:5-7` imports three of the five today. Only three things genuinely need the server: the `cf.timezone` first-paint guess, the date stamped onto SSR HTML, and the date attached to a mutation. `TodayList` is the existing proof that a seed-then-own pattern works; the two forms simply never took that step.

**The season rule is triplicated and only pairwise guarded.** TypeScript (`src/lib/season.ts:14`), SQL (`20260724120000:60-65`), and the boundary tables in `season.test.ts:16-29` and `supabase/tests/season-aware-intervals.sql:39-45`. The duplication is deliberate and documented on both sides, but the SQL half is hand-run via `psql` — Phase 2 inherits the reconciliation (`context/archive/2026-07-26-testing-runner-and-calendar-math/plan.md:684-688`).

**`cf.timezone` is the quiet load-bearer.** It is why production largely escapes the null window and why D-2/D-3 read as dev-only in practice. It is also Cloudflare-specific and disappears under any static build. Anyone reasoning about the null window from local-dev experience will systematically over-estimate its production frequency — and anyone removing SSR will systematically under-estimate it.

**Phase 1's tests are insulated by construction.** `environment: "node"`, no DOM, no workerd, no Astro imports — 55 of 56 assertions survive any rendering-mode change. The single exception is the `TIME_ZONE_COOKIE` drift guard (`timezone.test.ts:68-74`), whose entire premise is the cookie handshake. That insulation is a real asset for adjusting now: the *test* investment is not hostage to the architecture decision. The *build* budget is.

**A rendering-mode change would produce zero test failures while changing every deployed behaviour.** No test touches `astro.config.mjs`, `wrangler.jsonc`, the middleware, any page, or any action. This is the same silent-gate class Phase 1 was created to eliminate, and it applies with full force to Option 3.

---

## Historical Context (from prior changes)

- `context/archive/2026-07-19-core-watering-loop/plan.md:23` — `next_due_on` must be `DATE`, not `timestamptz`. Settled; do not reopen.
- `context/archive/2026-07-19-core-watering-loop/plan-brief.md:59` — the original client-supplied-date posture: *"acceptable for a single-user personal MVP."* Relevant precedent for Option 2.
- `context/archive/2026-07-19-finish-auth-and-route-gating/plan.md:25` — the only place `output: "server"` appears in the record, as a discovered fact. **No SSR decision was ever made.**
- `context/archive/2026-07-20-overdue-tasks-and-urgency/plan.md:25,33` — overdue cues excluded from `/plants` and detail *"because the exact browser-local date is only trustworthy inside the hydrated Today island."* **S-08 removed that constraint and this exclusion was never revisited** — a live product-quality gap independent of every option here.
- `context/archive/2026-07-23-season-aware-intervals/reviews/impl-review.md:34-42` — D-1's first occurrence, fixed at S-05 by reading the date fresh at submit.
- `context/archive/2026-07-24-user-timezone-dates/plan.md:56` — *"No midnight rollover outside the Today list"* — the exclusion that silently un-fixed the above. **Does not name the forms.**
- `context/archive/2026-07-24-user-timezone-dates/plan.md:265` — the UTC fallback accepted knowingly, without reasoning about season boundaries.
- `context/archive/2026-07-24-user-timezone-dates/plan.md:309` — matrix row 9, the *"settles on exact dates"* line. Constrains **phrasing and request count only** — silent on list membership.
- `context/archive/2026-07-24-user-timezone-dates/reviews/plan-review.md:85,89` — the only acknowledgement that null means "show every plant", plus the explicit note that its empty state *"no phase currently makes"*. Decision line: `PENDING`.
- `context/archive/2026-07-24-user-timezone-dates/reviews/plan-review.md:210-239` — F5 recommended deleting the corrective reload. Silently declined, no rationale. See **D-4**.
- `context/archive/2026-07-24-user-timezone-dates/reviews/impl-review.md:62-79` — F3, the reason client-side dates were abolished. Its premise is removed by Option 2.
- `context/foundation/prd.md:164` — *"the season active on the **browser-local** schedule-creation date selects the interval."*
- `context/foundation/infrastructure.md:59,63,67` — the pre-mortem already argues the bottleneck is Supabase latency, not rendering, and that authed pages forfeit CDN caching anyway.
- `context/deployment/deployment-plan.md:18-20` — describes the deployment as a skeleton. **Stale as of 2026-07-26** — verified current by direct check (§3.6). Correct this file.

## Related Research

- `context/archive/2026-07-26-testing-runner-and-calendar-math/research.md:538-564` — the origin of D-1/D-2/D-3; §2's *"where today comes from"* table at `:110-121` is the direct ancestor of Part 1 above
- `context/foundation/test-plan.md` §2 Risks #1 and #6, §3 Phase 1, §7 exclusions, §8 freshness ledger — note §8 names a tech-stack change as an explicit refresh trigger
- `context/foundation/roadmap.md:160-171,186-196` — S-07 and S-09, the two remaining slices

## Open Questions

1. ~~**Is the deployed app current?**~~ — **Resolved 2026-07-26 by direct check** (§3.6). It is current; `deployment-plan.md:18-20` is stale and should be corrected. Residual question: with no deploy job in CI, deployment stays a manual `wrangler deploy` — is that acceptable through handover, or does it belong in test-plan Phase 5 alongside branch protection?

2. **What should the Today list show when the zone is unknown?** Still unsettled, and still the blocker `change.md` names. The record fixes the *phrasing* contract (exact dates, never a guessed day) and is silent on *membership*. Three coherent answers: show every plant with honest dates (current); show none with an explanatory empty state; or block the screen until the zone resolves. Note that Option 2 shrinks this question to first paint only — under it, the island owns its day immediately after hydration.

3. **Should client-supplied mutation dates return, and validated how?** Option 2's trust boundary. `cf.timezone` now offers an independent plausibility check that S-01 did not have. Needs an explicit written decision because it reverses S-08.

4. **Should S-03's overdue-cue exclusion be revisited?** `overdue-tasks-and-urgency/plan.md:25` excluded urgency cues from `/plants` and detail purely because the SSR date was untrustworthy. S-08 made it trustworthy. Nobody has revisited it. This is a product gap living independently of everything else here.

5. **Workerd ICU completeness and `Date.now()` freezing remain unverified** — carried forward unresolved from `context/archive/2026-07-26-testing-runner-and-calendar-math/research.md:579-584`. Does not affect the Phase 1 `node` runner, but blocks any future `@cloudflare/vitest-pool-workers` adoption, and would need re-checking if the runtime story changes.

6. **`@astrojs/cloudflare` middleware behaviour in static output could not be confirmed.** Astro 6 docs describe `middlewareMode: 'edge'` for Netlify and Vercel; no Cloudflare equivalent is documented. If Option 3 is ever seriously considered, this must be settled first — it determines whether auth gating has any per-request home at all.
