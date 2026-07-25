# User-Timezone Date Authority — Plan Brief

> Full plan: `context/changes/user-timezone-dates/plan.md`
> Roadmap slice: `context/foundation/roadmap.md` — S-08 (`ready`)

## What & Why

`todayLocalDateString()` reads the host machine's local date. In a browser that is the user's date; on Cloudflare Workers it is always UTC. Every server-rendered date surface therefore asserts the wrong calendar day for anyone far from UTC — a user at UTC+13 sees `/plants` say `Due today` about an already-overdue plant, for more than half of every day. This slice makes the user's timezone the single calendar authority, resolved once in middleware, and deletes the five client-side workarounds that exist only because the server didn't know the day.

## Starting Point

The date *math* is already sound — `toEpochDay`/`fromEpochDay` and `nextDue` work in UTC epoch days and cannot drift across DST. Only the acquisition of "what day is it for this user" is broken. Each slice so far worked around it locally instead of fixing it: a ~60-line inline script that rewrites season/due text after hydration, a Today list that renders a skeleton until the browser tells it the date, an add-plant label kept deliberately vague until hydration, pinned heights that exist only to absorb a text swap, and a `clientDate` posted with every mutation. Two `eslint-disable react-hooks/set-state-in-effect` comments mark where the pattern hurt most.

## Desired End State

Every surface agrees on what day it is, and that day is the user's. `/plants` and `/plants/[id]` server-render `Due today` correctly on the first byte with no client rewriting. The Today list is fully server-rendered — real rows, correctly filtered — with no skeleton. Mutations no longer accept a client-supplied date. When the timezone is genuinely unknown, every surface shows exact dates (`Due 3 Aug`) and omits relative phrasing rather than guessing a day.

## Key Decisions Made

| Decision | Choice | Why | Source |
| -------- | ------ | --- | ------ |
| Timezone source | Cookie, falling back to `cf.timezone` | Correct on the very first request for most users; the cookie still wins for VPN/travel, where geo-IP lies | Plan |
| Unknown timezone | Exact dates, no "today" phrasing | Never asserts a false day — matches PRODUCT.md's "deterministic and honest" bar | Roadmap default, confirmed |
| Cookie lifecycle | Inline head script, rewrite on mismatch | Cookie lands on first paint; travel/VPN self-corrects with one guarded reload | Plan |
| Today list | Full SSR; island keeps rollover + mutations | Kills the skeleton, the `null` branch, and the eslint-disable — correct in the first paint | Plan |
| Season summary | Delete the script, SSR the real text | The roadmap explicitly marks the S-05 patch as superseded by this slice | Roadmap + Plan |
| Rollover scope | Today list only | The one tab people leave open all day; other pages are correct when served | Plan |
| `clientDate` | Server derives it; removed from the contract | One authority across render and mutation — a client can't post a day that disagrees with what it was shown | Plan |
| Verification | Manual + lint/check/build, no test tooling | Consistent with every slice since S-01 (user chose this over adding Vitest) | Plan |

## Scope

**In scope:** `src/lib/timezone.ts`; `middleware.ts` resolution + `env.d.ts` typing; cookie-writing head script in `layout.astro`; `season-interval-summary` reduced to pure SSR; `authed-shell` + `today-list` server-rendered; `add-plant-form` prop-driven; `clientDate` removed from all three mutating actions and `types.ts`.

**Out of scope:** any schema, migration, or RPC change; a user-facing timezone setting; test tooling; rollover on `/plants` and `/plants/[id]`; the watering journal (historical dates, no relative phrasing); the season-boundary rule and its documented SQL/TS duplication.

## Architecture / Approach

```
cookie `tz`  →  Astro.request.cf.timezone  →  null
                                                │
                     Astro.locals.timeZone ─────┤
                     Astro.locals.today   ──────┘   (null ⇒ exact dates only)
```

Resolved once per request in middleware, consumed everywhere. Consumers branch once on `today: string | null` — a real date enables relative phrasing, `null` falls back to exact dates. The existing SSR fallback strings become the `null` branch verbatim, so nothing is lost; they just stop being the only thing the server can say. A head script writes the browser's real zone to the cookie and, by comparing against the day the server rendered with (`data-today` on `<html>`), triggers one guarded reload only when the day was actually wrong.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| ----- | ---------------- | -------- |
| 1. Timezone resolution foundation | `src/lib/timezone.ts`, middleware resolution, locals typing, cookie head script | The corrective reload looping on a browser that rejects cookies — guarded on both a day mismatch and a `sessionStorage` marker |
| 2. Server-rendered date surfaces | Season summary as pure SSR; `/plants` + `/plants/[id]` correct on the first byte | Removing pinned heights could regress layout at 320px |
| 3. Islands and the action contract | Today list SSR, add-plant form prop-driven, `clientDate` retired | Touches the working mutation path; the server side of each contract must land before the call sites change |

**Prerequisites:** S-02 (complete). Astro 6 + `@astrojs/cloudflare` v13 — note `Astro.locals.runtime` was removed; `cf` is now `Astro.request.cf`.
**Estimated effort:** ~2–3 sessions across 3 phases. Net line count decreases.

## Open Risks & Assumptions

- **Manual-only verification is the weakest point.** DST transitions and UTC±13/14 offsets are the likeliest defects and the hardest to reproduce by hand — you cannot check a UTC+13 midnight without changing your machine clock. The plan compensates with a 9-row manual matrix, but nothing guards `src/lib/timezone.ts` against future regression. (You chose this over adding Vitest for the date module; flagging it as the one place I'd revisit.)
- **`workerd` ships full ICU**, so `Intl.DateTimeFormat` with a `timeZone` resolves correctly. Verified locally under Node; Phase 1's build + manual check confirms it on the real runtime.
- **`cf` is undefined under `astro dev`**, so the unknown-timezone path is the default local-dev experience on a cold profile. That branch has to be genuinely good, not theoretical — it is treated as a first-class rendering, not a degraded one.
- **Geo-IP can be wrong** (VPN, corporate egress). The cookie always wins once written, and the corrective reload catches the case where the geolocated guess produced a different calendar day.
- **Future edge caching of authenticated HTML would need to vary on the `tz` cookie.** Nothing caches these responses today, so no action now.

## Success Criteria (Summary)

- A user at UTC+13, at 09:00 local, sees the same due labels on `/`, `/plants`, and `/plants/[id]` — and they are right.
- A cold, JavaScript-disabled visit shows exact dates and never claims something is "due today".
- `grep -r "set-state-in-effect\|clientDate" src` returns nothing.
