# Today Acquisition Defects — Plan Brief

> Full plan: `context/changes/today-acquisition-defects/plan.md`
> Research: `context/changes/today-acquisition-defects/research.md`

## What & Why

YAPCA currently resolves the user's calendar day independently during SSR, after hydration, and during mutation handling. Those sources can disagree across midnight, missing timezone data, or UTC boundaries, undermining the product's central promise that the watering schedule is exact and trustworthy.

The plan keeps Astro SSR but makes the browser authoritative for date-sensitive reads and writes. This delivers the structural fix at a fraction of the cost and risk of a static/SPA migration.

## Starting Point

Middleware seeds `today` from a timezone cookie or Cloudflare geolocation, Today alone maintains a rollover timer, Add/Edit freeze their SSR date, and all four dated Actions silently fall back to UTC. Unknown Today dates currently widen the list to every plant, while the layout's corrective reload is suppressed by its own timezone-keyed guard.

## Desired End State

SSR still supplies auth gating, initial data, and a provisional date seed. After hydration, one browser lifecycle owns every relative-date surface and refreshes it at midnight, on page restoration, and on visibility recovery.

Add, Update, Watered, and Postpone send a fresh browser-local date. The server accepts only real dates within ±1 UTC calendar day; it never substitutes UTC. Unknown or failed browser dates produce an honest non-actionable state rather than a guessed schedule.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| Rendering mode | Keep Astro SSR | Static migration costs roughly 30 items and removes useful auth/data behavior without improving the structural fix | Research |
| Date authority | Browser owns hydrated reads and dated writes | Browser is the only direct authority for the user's local day | Research / Plan |
| SSR date | Retain as provisional seed | Avoids unnecessary first-paint degradation while browser ownership begins after hydration | Research |
| Unknown Today date | Block list actions with explanatory state | Prevents future plants from appearing actionable | Plan |
| Mutation validation | Real date within ±1 UTC day | Supports every legitimate timezone while rejecting arbitrary dates | Plan |
| Midnight form race | Submit the fresh date without reconfirmation | Preserves one-click save; accepts a narrow preview mismatch window | Plan |
| Relative metadata | Enhance every date-aware surface | Prevents Today, forms, list, and detail from disagreeing | Plan |
| Date acquisition failure | Block and explain | Never persist a guessed or contradictory action date | Plan |
| Browser testing | Manual workerd matrix, no new runner | Fits the staged test strategy and current time budget | Plan |

## Scope

**In scope:**

- Shared browser-date acquisition, lifecycle, React hook, and ±1-day server validation
- Add, Edit, Today, and four dated Action contracts
- Relative metadata enhancement, failure UX, and obsolete reload removal
- Pure tests, required workerd matrix, and documentation corrections

**Out of scope:**

- Static/SPA migration or auth/data architecture changes
- Database schema, RPC, RLS, season-boundary, or generated-type changes
- Browser runner, workerd Vitest pool, or CI E2E coverage
- Overdue redesign, deployment automation, or production deployment
- Eliminating the selected immediate-submit preview race at midnight

## Architecture / Approach

Middleware continues to provide a provisional SSR seed. A shared browser subscription resolves the local day immediately after hydration and on lifecycle boundaries; React consumers access it through `useBrowserToday`, while one deduplicated Astro module enhancer updates all static season summaries. Mutation call sites independently acquire a fresh day and send it through Astro Actions, where semantic and ±1-day validation precede existing schedule calculations and RPC calls.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Canonical browser-date contracts | Shared acquisition, rollover, hook, and plausibility tests | Browser APIs must remain import-safe in Node tests |
| 2. Browser authority across UI and mutations | All surfaces and writes share the browser day; UTC fallback and reload guard disappear | Cross-midnight sequencing touches the core watering loop |
| 3. Workerd verification and documentation | Production-shaped evidence and accurate coverage/deployment records | Runtime lifecycle remains manual rather than CI-protected |

**Prerequisites:** Local Supabase via Docker, seeded test account, and the current Node/workerd toolchain.

**Estimated effort:** Approximately 2–3 implementation sessions across three phases, plus one focused manual verification session.

## Open Risks & Assumptions

- The chosen Add/Edit contract permits a tiny preview/persistence mismatch if Save lands after midnight before the preview rerenders; the fresh persisted date wins.
- A device clock more than one calendar day from UTC blocks dated actions until corrected.
- Browser lifecycle and Action wiring remain manual coverage debt until the test plan later introduces a browser runner.
- The timezone cookie and Cloudflare geolocation are SSR hints, not mutation trust anchors; deployment remains manual and separately authorized.

## Success Criteria (Summary)

- Every hydrated relative-date surface agrees in UTC− and UTC+ boundary scenarios and updates without a reload.
- All four dated mutations persist the fresh browser-local day, with no UTC fallback.
- Unknown or failed browser dates expose no actionable controls and persist nothing; pure gates, the Cloudflare build, and the manual workerd matrix pass.
