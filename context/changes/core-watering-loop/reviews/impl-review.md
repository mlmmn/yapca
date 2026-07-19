<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Core Watering Loop (S-01)

- **Plan**: context/changes/core-watering-loop/plan.md
- **Scope**: Phases 1–4 of 4 (full plan)
- **Date**: 2026-07-20
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 3 warnings, 5 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | WARNING |

## Findings

### F1 — Sonner primitive ships `"use client"` + `next-themes`

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/ui/sonner.tsx:1,3
- **Detail**: AGENTS.md explicitly forbids Next.js directives ("No Next.js directives (`"use client"` etc.)"). This shadcn-generated file carries `"use client"` and imports `next-themes`; `useTheme()` always resolves to `"system"` in this non-Next app (harmless, since theming is CSS-only via `prefers-color-scheme`), but it violates a stated hard convention and pulls in an unused dependency.
- **Fix**: Strip the `"use client"` directive and the `next-themes` import; hardcode `theme="system"` on `<Sonner>` (or read the media query directly), then drop `next-themes` from package.json if nothing else uses it.
- **Decision**: SKIPPED

### F2 — `z.coerce.boolean()` on `alreadyWatered` coerces any non-empty string to true

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/actions/index.ts:34
- **Detail**: `z.coerce.boolean()` treats any non-empty string as `true` (`z.coerce.boolean("false") === true`). The current form is safe because it omits the field when false (undefined → false), but a direct form POST of `alreadyWatered=false` would be read as `true` and reschedule the plant to `today + interval` instead of today. Blast radius is limited to the user's own data, but the input boundary is fragile.
- **Fix**: Replace with an explicit, unambiguous decode — `z.preprocess((v) => v === "true", z.boolean())` (or a `z.enum(["true","false"])` mapped to boolean) so only a literal `"true"` is truthy.
- **Decision**: FIXED

### F3 — `astro check` gate is currently red (out-of-scope pre-existing error)

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: src/components/auth-field.astro:39
- **Detail**: Every phase marked "Type checking passes: `pnpm exec astro check`" as done, but the gate currently reports **1 error** — `ts(2322)` on `auth-field.astro:39` (`type={type}`). The file was last touched in `70808bd` (finish-auth-and-route-gating), *before* this slice's Phase 1 (`27e7271`), so it is not attributable to core-watering-loop. `pnpm lint` and `pnpm build` both pass. The concern is a persistently red type gate masks future real type regressions in this and later slices.
- **Fix**: Fix the out-of-scope `auth-field.astro:39` type error (narrow/annotate the `type` prop) in a separate small change so the `astro check` gate returns to green; not part of this slice's work but should be tracked.
- **Decision**: FIXED — typed the prop with `JSX.HTMLInputTypeAttribute` imported from `astro/jsx-runtime` (replaces the React `HTMLInputTypeAttribute` import). Importable type resolves cleanly in both the Astro TS plugin and astro-eslint-parser, so no eslint-disable is needed. Both gates green.

### F4 — `markWatered` authorizes via RLS only, no explicit `user_id` filter

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/actions/index.ts:83-112
- **Detail**: `markWatered` selects and updates `plants` by `id` alone. This is safe today — the cookie client runs as `authenticated`, `SUPABASE_KEY` is the anon key, and RLS scopes every row to `auth.uid() = user_id`. But it is single-layer defense: a future service-role-key swap or RLS regression would open cross-tenant writes. An explicit filter also lets you distinguish NOT_FOUND from not-owned.
- **Fix**: Add `.eq("user_id", user.id)` to the select and update in `markWatered` as defense-in-depth (mirrors the ownership intent already enforced by RLS).
- **Decision**: FIXED

### F5 — Add-plant validation triggers on submit/change, not blur+submit as specified

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/components/add-plant-form.tsx:42-44
- **Detail**: The plan (and Phase 3 criterion 3.5) specifies inline errors "after blur and on submit". The implementation uses `revalidateLogic()` + `onDynamic`, whose default is submit-then-revalidate-on-change; `field.handleBlur` is wired but does not itself gate validation. Behavior is close but the error-surfacing moment differs from the contract (errors can appear on keystroke-change rather than on blur).
- **Fix**: Confirm against design.md whether blur-timed validation is required; if so, configure the validator to validate `onBlur` (plus submit) rather than the dynamic change mode. If the current UX is acceptable, update the plan/criterion wording to match.
- **Decision**: RESOLVED — accepted the current submit+revalidate-on-change UX; reworded plan.md contract (L206), success criterion (L235), and Progress row 3.5 (L383) to match.

### F6 — `useOptimistic` layer in today-list is largely inert / redundant

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/components/today-list.tsx:88-99
- **Detail**: `commitRemoval` calls `removeOptimistically` inside a *synchronous* `startTransition`. `useOptimistic` only holds its overlay while an async transition/action is pending, so it reverts almost immediately; the row stays hidden only because `leavingIds` collapses it via CSS until the success handler filters `basePlants`. Net behavior is correct and timers/refs are cleaned up (no leaks), but the optimistic layer is misleading — a future maintainer (and S-04, which is meant to reuse this pattern) may reason incorrectly about where the "snappy" removal actually comes from.
- **Fix A ⭐ Recommended**: Drive removal purely through `leavingIds` + `basePlants` and delete the `useOptimistic` overlay.
  - Strength: Removes a no-op abstraction so the real mechanism (CSS collapse + base-state filter) is legible; S-04 reuses an honest pattern.
  - Tradeoff: Touches the load-bearing coordinator; needs the full manual optimistic/rollback loop re-verified.
  - Confidence: MED — behavior is already carried by `leavingIds`, but the coordinator is subtle and concurrency-sensitive.
  - Blind spot: Haven't traced every rollback/Retry path to confirm nothing reads the optimistic value.
- **Fix B**: Keep `useOptimistic` but make the removal genuinely pending — hold the optimistic state across the awaited `markWatered` promise instead of a synchronous transition.
  - Strength: Preserves the intended React idiom and keeps the door open for richer optimistic states.
  - Tradeoff: More rework than Fix A for the same visible result; re-introduces the risk the code was already routing around.
  - Confidence: MED — depends on reshaping the transition boundaries carefully.
  - Blind spot: Interaction with `leavingIds` crossfade timing under concurrent mutations.
- **Decision**: FIXED via Fix B — reworked `handleWatered` into a single async `startTransition`: the optimistic reducer now marks the row `deleting` (before any `await`) instead of filtering, so the overlay is genuinely held across the awaited `markWatered` and the row stays mounted to animate its collapse; `basePlants` commits the permanent removal on success (post-`await` updates re-wrapped in `startTransition` per React 19), and the overlay auto-reverts on failure. Dropped the now-redundant `leavingIds`/`enteringIds` state (collapse + re-open ride the existing max-height transition). Verified: `astro check`, `pnpm lint`, `pnpm build` all green.

### F7 — Photo upload trusts client-declared MIME, bytes not sniffed

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/actions/index.ts:45-53
- **Detail**: The upload derives the extension and stored `contentType` from `input.photo.type` (client-controlled); Supabase enforces `allowed_mime_types` against the declared type, not the actual bytes, so arbitrary bytes could be stored labeled `image/png`. Impact is confined — private bucket, own `{user_id}/` folder, own signed-URL view, rendered in `<img>` — so acceptable for MVP.
- **Fix**: Note as accepted MVP risk; if hardened later, sniff the magic bytes server-side before upload and reject mismatches.
- **Decision**: ACCEPTED — MVP risk; blast radius confined to private bucket / own `{user_id}/` folder / own signed-URL view. Revisit with server-side magic-byte sniffing if hardened later.

### F8 — `loadPlants` query is unbounded (no limit/pagination)

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/authed-shell.astro:17-21
- **Detail**: `loadPlants` selects all of a user's plants with no `.limit()`, then batch-signs every photo path. Correctly batched (single `createSignedUrls`, no N+1) and fine at expected scale (dozens of plants, as the plan notes), but unbounded as the collection grows. The plan explicitly defers pagination, so this is expected.
- **Fix**: Accept as designed; revisit a cap only if real lists grow large.
- **Decision**: ACCEPTED — plan explicitly defers pagination; query is correctly batched and fine at expected scale. Revisit a `.limit()` cap only if real lists grow large.
