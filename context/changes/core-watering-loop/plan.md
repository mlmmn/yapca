# Core Watering Loop (S-01) Implementation Plan

## Overview

Stand up the north-star loop end-to-end: a signed-in user adds a plant (name, watering interval, optional photo), sees it on today's due list, and marks it **Watered** so it reschedules to exactly **today + interval**. This slice establishes four load-bearing foundations the rest of the roadmap builds on: the first data table (`plants`) with per-account RLS, a Supabase Storage bucket for photos, the deterministic interval-math module, the first Astro Actions server substrate, and the first two React islands (add-plant form, optimistic today's-list).

**Design authority:** [`design.md`](design.md) is the production UI contract for this slice. If it conflicts with this plan, its layout, content, responsive behavior, accessibility, and interaction requirements win; this plan supplies the implementation sequencing and server/data contracts.

## Current State Analysis

- **100% server-driven, zero islands.** Every form today is a native `<form method="post" action="/api/...">` → SSR API route → `context.redirect(?error=)` (`src/pages/api/auth/signin.ts:12-34`). There is no `client:*` directive, no `fetch`, no Astro Actions (`src/actions/` does not exist), and the only `.tsx` is `button.tsx` (imported for `buttonVariants`, never hydrated).
- **Data layer is empty.** `@supabase/ssr` cookie client (`src/lib/supabase.ts`) + middleware resolving `context.locals.user` (`src/middleware.ts:12-14`) exist, but `supabase/migrations/` **does not exist** — no tables, no RLS, no Storage buckets. `PROTECTED_ROUTES` is `[]` (`src/middleware.ts:5`).
- **`authed-shell.astro` is a placeholder** — header + "Your daily list will appear here" (`src/components/authed-shell.astro:18-22`). This is where the today's-list island lands. Root `/` already branches on `Astro.locals.user` between the auth CTA and `<AuthedShell />` (`src/pages/index.astro:7-27`).
- **UI primitives:** only `button.tsx` (react-aria-components base, aria-nova). Input/TextField/NumberField/Label/FieldError/RadioGroup/Sonner all still need `pnpm dlx shadcn add`.
- **No test tooling** — no Vitest, no test script in `package.json`. (Decision below: keep manual-only verification for S-01.)
- **React + Zod already installed.** `@astrojs/react@5`, `react@19`, `astro/zod` are present (`package.json:16-41`). `@tanstack/react-form` is **not** yet installed. `astro.config.mjs` already wires `react()` (`astro.config.mjs:12`) with `SUPABASE_URL`/`SUPABASE_KEY` env schema.

### Key Discoveries:

- **Astro Actions body-size limit defaults to 1 MB** — photo uploads will exceed it, so `security.actionBodySizeLimit` must be raised in `astro.config.mjs` (Astro docs, verified). This is the single most likely silent-failure trap in this slice.
- **Astro Action clients return typed `{ data, error }` results** when called with `FormData`. The mounted list coordinator calls `actions.markWatered(formData)` directly inside React transitions so each in-flight promise remains correlated with its plant ID; a single `useActionState` queue would serialize unrelated rows and lose failure correlation.
- **Astro Action form validators:** `accept: 'form'` + `z.instanceof(File)` for the photo, `z.coerce.boolean()` for the radio group's internal `alreadyWatered` value, `z.number()`/`z.coerce.number()` for the interval (Astro docs, verified).
- **`next_due_on` must be a calendar `DATE`, not `timestamptz`** — storing a time-of-day would let the reappearance instant drift across cycles, violating the determinism NFR.
- **"Today" is client-local, not server-UTC** — Cloudflare Workers run in UTC and cannot know the browser's calendar date on the first request. SSR therefore renders stable app chrome, the Today heading, and a row-shaped bootstrap shell, but does not expose UTC-filtered rows. On hydration the island derives the browser-local `YYYY-MM-DD`, reveals the correctly filtered ledger, computes the date afresh for every Action dispatch, and schedules a rollover at the next local midnight.

## Desired End State

A signed-in user can:

1. Navigate to `/plants/new`, fill name + interval, choose the explicit first-appearance radio option (Today or After _n_ days), optionally attach a photo, and be returned to the list with the plant persisted (row + photo object under the user's Storage folder).
2. See that plant on the today's-list in `authed-shell` — due today for the default Today choice, or hidden until `today + interval` for the After choice.
3. Click **Watered**: the row and count update instantly (optimistic), the Action persists `next_due_on = today + interval`, and a retryable failure restores the row in stable order with the specified Retry toast.
4. Never see another user's plants (RLS enforced at the row and Storage-object level).

Verification: the loop is manually exercised across a full cycle (add → due today → Watered → confirm it reappears exactly `interval` days later by setting the client clock forward), plus a two-account RLS isolation check.

## What We're NOT Doing

- **No watering journal / history table** (S-02) — `next_due_on` lives as a column on `plants`; there is no per-occurrence or event table yet.
- **No Postpone, no Undo** (S-04) — the only task action in S-01 is Mark Watered.
- **No overdue urgency cue / styling** (S-03) — the list query naturally includes `next_due_on <= today` (so past-due rows appear), but S-01 does **not** build the non-color-only urgency indicator.
- **No season split** (S-05) — a single `interval_days` per plant; no growing/dormancy intervals, no date-based season selection.
- **No edit / delete plant** (S-06 / S-07).
- **No plant detail view** (S-02) — the photo is captured and stored in S-01, and shown as a thumbnail on the list, but the full detail view lands in S-02.
- **No automated tests / Vitest** — verification is manual for this slice (see Open Risks).
- **No `<ClientRouter>` view transitions** — deferred to a later UX-polish pass (research Open Question).

## Implementation Approach

Two problems, two tools, one shared server substrate (per research):

- **The one form** (add-plant) → **TanStack Form** (controlled-native, consumes Zod via Standard Schema, wires cleanly to controlled react-aria fields). It calls the `addPlant` Astro Action directly as an RPC on valid submit and navigates to the list — no optimism needed (it leaves the page).
- **The one action** (Mark Watered) → **`useOptimistic` + direct typed `actions.markWatered(FormData)` calls coordinated at list level** — the load-bearing "snappy" path and the pattern S-04 will reuse.
- **Astro Actions** (`src/actions/index.ts`) are the shared, typesafe `{ data, error }` server substrate for both, replacing the auth routes' `?error=` redirect convention. Both mutations accept `FormData`: this keeps photo submission native and lets the list coordinator dispatch `markWatered` directly while preserving typed results.

Build bottom-up: data + domain module first (nothing renders without the table and the math), then the server actions, then the two islands (form, then list).

The islands implement the authoritative design brief rather than inventing a surface: a field-notebook presentation with composed light and dark token palettes following the system preference; one centered working column; flat, hairline-separated ledger rows; no lifestyle backdrops, decorative shadows, administrative table treatment, oversized check controls/dropzones, sidebar, or bottom navigation. Existing design tokens carry the visual system; canopy green remains limited to primary actions and focus.

## Critical Implementation Details

- **Photo and Action size limits:** define `MAX_PHOTO_BYTES = 4 * 1024 * 1024` for JPEG, PNG, and WebP files, and raise `security.actionBodySizeLimit` to `5 * 1024 * 1024`. The separate limits leave room for multipart fields and boundaries; validation and UI guidance use the 4 MB file limit consistently.
- **Date arithmetic must be calendar-only and DST-proof:** the interval module parses `YYYY-MM-DD`, adds days via UTC epoch math, and reformats to `YYYY-MM-DD` — never constructing a local-time `Date` that could shift across a DST boundary. `next_due_on` is a `DATE` column; the client-supplied "today" is a `YYYY-MM-DD` string validated server-side.
- **Optimistic reconciliation:** the mounted list island owns base state, the `useOptimistic` overlay, and a pending-mutation map keyed by plant ID. Row components remain presentational; they dispatch to the list-level coordinator so removing a row visually never unmounts the owner of the in-flight Action. The coordinator calls the typed Astro Action directly, and each promise closure retains its plant ID. On success, it patches/removes the row in base state before clearing the optimistic entry. On failure, base state remains intact, the optimistic entry is cleared, and the coordinator restores stable order, focus, and Retry context before firing the Sonner toast. Retry dispatches a new mutation through a React transition. This durable owner supports multiple plants being watered concurrently while preventing a duplicate mutation for the same plant.
- **React Action dispatch:** define `markWatered` with `accept: 'form'` and call `actions.markWatered(formData)` directly from the mounted coordinator. Start optimistic work in a React transition; after the awaited result, perform base-state reconciliation in a new transition. Return `{ plantId, next_due_on }` on success. Do not use a single `useActionState(withState(...))` queue for the whole list because it serializes unrelated row mutations and an error result carries no plant identifier.

---

## Phase 1: Data & domain foundation

### Overview

Create the `plants` table with per-account RLS, the `plant-photos` Storage bucket with owner-only RLS, the shared types, and the pure deterministic interval-math module. Nothing renders yet; this phase is verified by migrations applying cleanly and a manual RLS isolation check.

### Changes Required:

#### 1. Plants table migration

**File**: `supabase/migrations/<YYYYMMDDHHmmss>_create_plants.sql` (new; directory does not exist yet)

**Intent**: Create the first data table backing the whole roadmap. One row per plant, owned by a user, carrying the single interval and the next due calendar date the loop reschedules.

**Contract**: Table `public.plants` with: `id uuid pk default gen_random_uuid()`; `user_id uuid not null references auth.users(id) on delete cascade`; `name text not null`; `interval_days int not null check (interval_days between 1 and 365)`; `next_due_on date not null`; `photo_path text` (nullable; Storage object path); `created_at timestamptz not null default now()`; `updated_at timestamptz not null default now()`. Add a before-update trigger that refreshes `updated_at`. Enable RLS. Add **four granular policies** for the `authenticated` role — `select` / `update` / `delete` using `auth.uid() = user_id`, `insert` with `with check (auth.uid() = user_id)`. Index `(user_id, next_due_on)` to back the list query.

#### 2. Plant-photos Storage bucket + RLS migration

**File**: `supabase/migrations/<YYYYMMDDHHmmss>_create_plant_photos_bucket.sql` (new)

**Intent**: A private bucket for plant photos, isolated per account at the object level so a photo can never leak across the account boundary.

**Contract**: Insert a **private** bucket `plant-photos` into `storage.buckets`, with a 4 MB object limit and allowed MIME types `image/jpeg`, `image/png`, and `image/webp`. RLS policies on `storage.objects` for the `authenticated` role scoped to `bucket_id = 'plant-photos'` and ownership by path — the first path segment is the owner's uid: `(storage.foldername(name))[1] = auth.uid()::text`. Grant select/delete with `using`, insert with `with check`, and update with both `using` and `with check` under that predicate so an object cannot be moved across ownership boundaries. Path convention: `{user_id}/{uuid}.{ext}`, with the extension derived from the validated MIME-type allowlist rather than the original filename.

#### 3. Shared types

**File**: `src/types.ts` (new)

**Intent**: Home for the `Plant` entity and the DTOs the Actions and islands exchange, per the `src/types.ts` convention in `AGENTS.md`.

**Contract**: A `Plant` type mirroring the row (dates as `string` `YYYY-MM-DD`), and the input/output DTO shapes for `addPlant` and `markWatered`. No behavior.

#### 4. Deterministic interval-math module

**File**: `src/lib/interval.ts` (new)

**Intent**: The single source of truth for "given a watering date and an interval, when is it next due" — extracted as a pure, side-effect-free module so the determinism guardrail is isolated and inspectable.

**Contract**: `nextDue(fromDate: string /* YYYY-MM-DD */, intervalDays: number): string /* YYYY-MM-DD */`, computed by UTC epoch-day addition (no local-time `Date`), plus a small `isValidDateString` guard for the client-supplied date. Deterministic and idempotent: `nextDue` of the same inputs always yields the same output, with no drift across repeated application.

### Success Criteria:

#### Automated Verification:

- Migrations apply cleanly on a fresh DB: `pnpx supabase db reset`
- Type checking passes: `pnpm exec astro check`
- Linting passes: `pnpm lint`
- Production build passes: `pnpm build`

#### Manual Verification:

- With two test accounts, a `plants` row created for user A is not selectable/updatable/deletable as user B (RLS isolation).
- A file uploaded to `plant-photos/{userA}/…` is not readable by user B.
- Spot-check `nextDue` across a month boundary (e.g. `2026-01-30` + 3 → `2026-02-02`) and a year boundary — deterministic and correct.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the RLS and interval-math checks passed before proceeding.

---

## Phase 2: Server actions substrate

### Overview

Introduce Astro Actions as the typesafe server substrate, with `addPlant` (name, interval, first-appearance boolean, optional photo, client date) and `markWatered` (plantId, client date). Raise the action body-size limit for photos, and gate `/plants/*` in middleware.

### Changes Required:

#### 1. Actions module

**File**: `src/actions/index.ts` (new)

**Intent**: Define the two server mutations the islands call. Both resolve a request-scoped Supabase client (reusing `createClient` from `src/lib/supabase.ts`), enforce authentication at the handler boundary, and then rely on RLS as defense in depth keyed to the real `auth.uid()`; both return Astro's `{ data, error }`.

**Contract**:
- Export `server = { addPlant, markWatered }` from the module, using `defineAction` schemas from `astro/zod`.
- At the start of both handlers, require `createClient(context.request.headers, context.cookies)` to return a client and require `context.locals.user` to be present. If either is absent, throw `new ActionError({ code: 'UNAUTHORIZED', message: 'You must be signed in.' })` before constructing a Storage path, reading a plant, or attempting any mutation. Route gating protects pages; this check protects the independently callable Action endpoint; RLS remains the final account-isolation boundary.
- `addPlant` — `defineAction({ accept: 'form', input: z.object({...}) })`. Input: `name` (`z.string().min(1)`), `interval_days` (`z.coerce.number().int().min(1).max(365)`), `alreadyWatered` (`z.coerce.boolean()`), `clientDate` (`z.string()` refined by `isValidDateString`), `photo` (`z.instanceof(File)` optional, refined to at most `MAX_PHOTO_BYTES` and MIME type `image/jpeg`, `image/png`, or `image/webp`). Handler: compute `next_due_on` = `alreadyWatered ? nextDue(clientDate, interval_days) : clientDate`; if a photo is present, derive its extension from the MIME allowlist, upload to `plant-photos/{user_id}/{uuid}.{ext}`, and capture `photo_path`; insert the row (RLS supplies isolation, `user_id` from the session user). If the upload succeeds but the row insert fails, attempt `storage.from('plant-photos').remove([photo_path])` before returning the original insert failure; log a cleanup failure without masking that original error. Return the created plant; surface failures as `ActionError`.
- `markWatered` — `defineAction({ accept: 'form', input: z.object({ plantId: z.string().uuid(), clientDate: z.string()… }) })`. Handler: read the plant's `interval_days` (RLS-scoped select), compute `next_due_on = nextDue(clientDate, interval_days)`, update the row, and return `{ plantId, next_due_on }`. The direct `FormData` Action call preserves typed results while the coordinator's promise closure correlates both success and error with the submitted plant.

#### 2. Raise action body-size limit

**File**: `astro.config.mjs`

**Intent**: Allow photo-carrying `addPlant` submissions past Astro's 1 MB default.

**Contract**: Add `security: { actionBodySizeLimit: 5 * 1024 * 1024 }` to the `defineConfig` object, alongside the existing `output`/`adapter`/`env`. Keep the validated photo maximum at 4 MB so multipart overhead cannot hit the framework limit first.

#### 3. Route gating

**File**: `src/middleware.ts`

**Intent**: Require a session for the plant surfaces. Root `/` stays public (it branches between the auth CTA and the authed shell), so gate the new plant routes only.

**Contract**: Add `"/plants"` to `PROTECTED_ROUTES` (`src/middleware.ts:5`). Existing redirect logic (`:19-23`) then covers `/plants/new`.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `pnpm exec astro check`
- Linting passes: `pnpm lint`
- Production build passes: `pnpm build`

#### Manual Verification:

- Calling `addPlant` (via the temporary form in Phase 3, or a scratch invocation) persists a row with correct `next_due_on` for both the Today and After first-appearance choices.
- A photo over 1 MB uploads successfully (confirms the body-size limit was raised) and lands under the user's Storage folder.
- Forcing the database insert to fail after a successful photo upload triggers best-effort deletion of the uploaded object; a cleanup failure is logged without replacing the insert error shown to the client.
- Visiting `/plants/new` while signed out redirects to `/auth/signin`.
- Calling either Action directly while signed out returns an `UNAUTHORIZED` Action error and performs no database or Storage operation.

**Implementation Note**: Pause for manual confirmation before proceeding to Phase 3.

---

## Phase 3: Add-plant form island

### Overview

Install the shadcn form primitives, add `@tanstack/react-form`, and build the `/plants/new` page hosting a TanStack Form island that validates with Zod (Standard Schema), wires controlled react-aria fields, uses an explicit first-appearance radio choice, calls `actions.addPlant`, and returns to the list on success.

### Changes Required:

#### 1. Install form dependencies + primitives

**File**: `package.json` / `src/components/ui/` (generated)

**Intent**: Bring in the controlled-native form library and the react-aria field primitives the form composes from.

**Contract**: `pnpm add @tanstack/react-form`; `pnpm dlx shadcn@latest add` for the input, text-field, number-field, label, field/field-error, radio-group, and Sonner primitives (resolve exact aria-nova registry names at install). These land in `src/components/ui/` following the `button.tsx` pattern.

#### 2. Add-plant form island

**File**: `src/components/add-plant-form.tsx` (new)

**Intent**: The first hydrated form. TanStack Form owns controlled field state and client-side Zod validation for snappy inline errors; on valid submit it builds `FormData` (including the file and the client-local date) and calls the Action.

**Contract**: Use a narrow, single-column form with a conventional back link and fields in this order: Plant name; Water every (NumberField with a visible `days` suffix and 1–365 support); “When should it first appear?” radio group; Photo (optional); Save plant. The radio options are Today / “It needs water now.” (default) and After `[interval]` days / “I watered it today.” (the label updates as interval changes); map the selected value to the existing `alreadyWatered` Action boolean. `useForm` receives the Zod schema via `validators` (Standard Schema — no resolver package) using `revalidateLogic()` (`onDynamic`): it validates on submit, then revalidates on change as the user edits. Bind fields through `Field` (`state.value` / `handleChange`) to controlled react-aria primitives. Use a standard file picker with concise type/size guidance, cropped square preview, file name, and Remove photo control; do not use a drag-and-drop zone. On submit call `actions.addPlant(formData)` with the browser's local `YYYY-MM-DD`; change the button to “Saving plant…”, prevent duplicate submits, preserve values/preview on failure where browser security allows, show plain field-specific errors and the specified form-level recovery message, then navigate to `/` on success. Focus Plant name on desktop only; never force the mobile keyboard open before the page context is visible.

#### 3. New-plant page

**File**: `src/pages/plants/new.astro` (new)

**Intent**: Host the island behind the gate, within the app chrome.

**Contract**: An Astro page reusing the flat app chrome and rendering a conventional back link plus `<AddPlantForm client:load />`. Gated by Phase 2's middleware entry; no sidebar or bottom navigation.

#### 4. Application-wide CSS-only theme behavior

**Files**: `src/layouts/layout.astro`, `src/styles/global.css`

**Intent**: Apply the existing light and dark token palettes across the entire application according to the operating-system preference, without an inline script, class toggle, or pre-hydration theme mutation.

**Contract**: Remove the inline `prefers-color-scheme` script from `layout.astro`. In `global.css`, remove the class-based `@custom-variant dark` override, keep the light tokens on `:root`, and move the existing `.dark` token declarations unchanged into `@media (prefers-color-scheme: dark) { :root { ... } }`. With the custom class variant removed, Tailwind's built-in media-based `dark:` utilities follow the same system preference. This behavior is application-wide through the shared layout, including Today, add plant, sign-in, sign-up, confirmation, and resend surfaces. Do not add a theme-control UI in S-01.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `pnpm exec astro check`
- Linting passes: `pnpm lint`
- Production build passes: `pnpm build`

#### Manual Verification:

- Submitting valid input creates the plant and returns to `/`; the plant is persisted with the correct `next_due_on`.
- Invalid input (empty name, interval out of 1–365) shows the specified inline field errors on submit, then revalidates on change as the user edits, without a page reload.
- The first-appearance radios default to Today; the After option updates with singular/plural interval text and correctly controls today-list appearance.
- Uploading a valid photo shows its square preview, name, and Remove control; an invalid file preserves other values and explains the allowed type/size; omitting a photo still succeeds.
- Saving prevents duplicate submission, uses “Saving plant…”, preserves entered values after a server/upload failure, and offers the specified retry-ready recovery message.
- Mobile and desktop layouts preserve the dedicated, narrow form order, back link, visible days suffix, 44px touch-safe controls, visible focus, and no forced mobile autofocus.
- With JavaScript enabled or disabled, all authenticated and authentication surfaces follow the system light/dark preference through CSS alone; both palettes retain readable contrast, visible focus, and consistent initial paint without a theme flash.

**Implementation Note**: Pause for manual confirmation before proceeding to Phase 4.

---

## Phase 4: Today's-list island + optimistic Mark Watered

### Overview

Hydrate the today's-list in `authed-shell`: SSR passes the user's plants to the island while rendering stable chrome, heading, and a row-shaped bootstrap shell. After hydration the island computes the client-local "today", reveals everything `next_due_on <= today`, and marks Watered optimistically through a mounted coordinator using `useOptimistic` plus direct typed Action calls, with stable-order rollback and a Retry toast on retryable failure. Includes local-midnight rollover plus distinct empty and fetch-failure states.

### Changes Required:

#### 1. SSR the plant list into the shell

**File**: `src/components/authed-shell.astro`

**Intent**: Replace the "Your daily list will appear here" placeholder with a server-fetched list handed to the island, including a short-lived signed URL per photo (the bucket is private) so the island can render thumbnails without exposing photos publicly.

**Contract**: Retain the flat top bar with wordmark at the start and quiet account/sign-out access at the end; Add plant is the only promoted navigation action. Query all user plants (`select id, name, interval_days, next_due_on, photo_path order by next_due_on, name`) via the request-scoped Supabase client so the island can distinguish a first empty collection from a clear day and show an optional next plant. For rows with a `photo_path`, batch-generate signed URLs (`storage.from('plant-photos').createSignedUrls(paths, ttl)`) and map results by each returned `path`, never by response position. A top-level signing error, per-item error, or null `signedUrl` degrades only that photo to the neutral initial fallback; it does not turn a successful plants query into the list fetch-error state. Render `<TodayList client:load plants={...} />`. Preserve chrome/title on query failure and pass a fetch-error result that renders “We couldn’t load your plants” with Try again — never an empty state. Do not introduce sidebar or bottom navigation.

#### 2. Today's-list island

**File**: `src/components/today-list.tsx` (new)

**Intent**: The load-bearing snappy surface. Filters to due/overdue against the client-local date, and makes Mark Watered feel instant.

**Contract**: Seed base state from sorted `plants` props (including `photoUrl`). During SSR and the first hydration render, output stable app chrome, the Today heading, and row-shaped bootstrap placeholders only; do not filter with Worker UTC or expose rows that may be wrong for the browser's date. Immediately after hydration, derive `today` as browser-local `YYYY-MM-DD`, reveal the singular/plural due count and due rows (`next_due_on <= today`), and schedule a timer for the next local midnight that recomputes `today` and the visible list without a reload. Render the revealed rows as a continuous, hairline-separated ledger in a centered working column — never individual cards or a table. Each row has a 48px mobile / 56px desktop square thumbnail (`object-fit: cover`, `alt=""` because adjacent text names the plant) or muted tonal initial fallback; two-line-clamped plant name; exact “Due today” or locale-formatted “Due [day month]”; correctly pluralized “Every [n] day(s)”; and an always-visible, labeled Watered button in a stable action column. Mobile uses a compact two-line content block with the action pinned inline-end and a 44px minimum target. Do not label or tint carry-over rows as overdue in S-01. `TodayList` is the durable mutation owner: keep list-level base state, a `useOptimistic` overlay, and a pending-mutation map keyed by plant ID containing the retry seed, original sort position, and focus target. Row forms submit `plantId` to the coordinator, which computes a fresh browser-local `clientDate` and builds `FormData` at each initial or Retry dispatch. Start the optimistic removal and direct `actions.markWatered(formData)` call inside a React transition; when its promise settles, reconcile base and pending state in a new transition associated with that promise's plant ID. Update the row and count together, reject a second mutation for the same plant, and allow different plants to remain in flight concurrently. A successful result patches/removes the row in base state before clearing its optimistic entry so it cannot flicker back. A failure leaves base state intact, clears the optimistic entry to restore the row at its sorted position, restores the count with a short crossfade (instant under reduced motion), returns keyboard focus to its Watered button when practical, and shows “Couldn’t mark [plant] watered. Try again.” with Retry; Retry builds a new mutation with the current local date. Use a 180–200ms ease-out fade/collapse for successful removal; under reduced motion remove it instantly. Rows may receive a subtle pointer hover, but are not themselves clickable; keyboard focus remains on controls with the green focus ring. Render distinct states: no plants (“Add your first plant” plus teaching copy and primary Add plant); plants but none due (“Nothing needs water today,” optional “Next: …,” secondary Add plant); and fetch failure (the specified error plus Try again). Any later client refetch also uses row-shaped skeletons rather than a spinner.

#### 3. Sonner toaster

**File**: `src/components/ui/sonner.*` + layout mount (generated + edit)

**Intent**: The failure surface chosen for the optimistic path.

**Contract**: `pnpm dlx shadcn@latest add sonner`; mount `<Toaster />` once in the authed chrome (e.g. `authed-shell.astro` or `layout.astro`) so `toast()` from the island renders.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `pnpm exec astro check`
- Linting passes: `pnpm lint`
- Production build passes: `pnpm build`

#### Manual Verification:

- A plant due today appears; clicking **Watered** removes it from the list instantly (no visible network wait).
- Advancing the client clock by `interval` days makes the plant reappear on the list exactly on that day — and not before (full-cycle determinism check).
- Simulating a retryable Action failure (e.g. offline) restores the row and count in stable order and shows the specified Retry toast.
- A past-due plant (`next_due_on < today`) also appears without an Overdue label or amber styling (that is S-03).
- The Today heading and singular/plural count update with optimistic removal and rollback; retryable failure restores the row at its stable `next_due_on, name` position, focus where practical, and shows the specified Retry toast.
- A plant with a photo shows an appropriately cropped thumbnail with empty alt; a plant without one shows the neutral initial fallback.
- A top-level or per-item signed-URL failure preserves the plant list and uses the neutral initial fallback only for affected photos.
- No-plants, clear-day (with optional Next), and fetch-failure states render their distinct specified messages/actions without misrepresenting an error as an empty day.
- At 10–30 rows (including 80-character names), ledger rhythm, two-line clamp, date/interval grammar, desktop action alignment, mobile 44px action reachability, keyboard focus, and natural scrolling remain intact.
- Success and rollback motion is 180–200ms / short crossfade respectively, with instant equivalents under `prefers-reduced-motion`.
- The first render never exposes a Worker-UTC-filtered ledger: the stable bootstrap shell transitions to the browser-local list after hydration, and an open page updates correctly across local midnight.

**Implementation Note**: After this phase and its automated verification, pause for the human to confirm the full manual loop (add → due → Watered → reappears after interval) before closing the slice.

---

## Testing Strategy

Per the confirmed decision, S-01 uses **manual verification only** — no Vitest is introduced. The interval math is nonetheless isolated in a pure module (`src/lib/interval.ts`) so it is easy to reason about and to add automated tests to later.

### Manual Testing Steps:

1. Add a plant with interval 3 and the default Today radio → it appears on today's list.
2. Mark it Watered → it leaves the list instantly; DB `next_due_on` = today + 3.
3. Set the client clock forward 2 days → still absent; forward 3 days → reappears.
4. Add a plant with the explicit After 3 days radio → absent today, appears after `interval` days.
5. Two-account RLS isolation: user B cannot see or mutate user A's plants or photos.
6. Force a retryable Action error → optimistic row and count revert at their sorted position, focus returns where practical, and the specified toast’s Retry succeeds.
7. Photo > 1 MB uploads successfully (body-size limit).

## Performance Considerations

The "list feels instant" NFR is met by the optimistic removal (the row leaves before the network settles). The list query is indexed on `(user_id, next_due_on)`. Data volume is small (single user, dozens of plants), so no pagination is needed.

## Migration Notes

Greenfield data layer — `supabase/migrations/` is created by this slice. `pnpx supabase db reset` applies both migrations from clean. No existing data to migrate.

## References

- Related research: `context/changes/core-watering-loop/research.md`
- Roadmap slice S-01: `context/foundation/roadmap.md:82-92`
- PRD FRs: `context/foundation/prd.md:84,101,107` (FR-004, FR-009, FR-011) + NFRs (`:130-133`)
- Existing SSR + Zod pattern being upgraded to Actions: `src/pages/api/auth/signin.ts:7-34`
- Authoritative UI contract: `context/changes/core-watering-loop/design.md` (wins on conflict)
- Auth-shell placeholder to replace: `src/components/authed-shell.astro:18-22`
- Middleware gating: `src/middleware.ts:5,19-23`
- Only React UI primitive today: `src/components/ui/button.tsx`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Data & domain foundation

#### Automated

- [x] 1.1 Migrations apply cleanly on a fresh DB: `pnpx supabase db reset` — 27e7271
- [x] 1.2 Type checking passes: `pnpm exec astro check` — 27e7271
- [x] 1.3 Linting passes: `pnpm lint` — 27e7271
- [x] 1.4 Production build passes: `pnpm build` — 27e7271

#### Manual

- [x] 1.5 Two-account RLS isolation on `plants` rows verified — 27e7271
- [x] 1.6 Storage-object isolation across accounts verified — 27e7271
- [x] 1.7 `nextDue` spot-checked across month + year boundaries — 27e7271

### Phase 2: Server actions substrate

#### Automated

- [x] 2.1 Type checking passes: `pnpm exec astro check` — 0461b49
- [x] 2.2 Linting passes: `pnpm lint` — 0461b49
- [x] 2.3 Production build passes: `pnpm build` — 0461b49

#### Manual

- [x] 2.4 `addPlant` persists correct `next_due_on` for both due-now and already-watered branches — d309ce1
- [x] 2.5 Photo > 1 MB uploads successfully to the user's Storage folder — d309ce1
- [x] 2.6 `/plants/new` redirects to `/auth/signin` when signed out — d309ce1
- [x] 2.7 Direct signed-out Action calls return `UNAUTHORIZED` without mutation — d309ce1
- [x] 2.8 Failed plant insert triggers best-effort uploaded-photo cleanup — d309ce1

### Phase 3: Add-plant form island

#### Automated

- [x] 3.1 Type checking passes: `pnpm exec astro check` — 4beec48
- [x] 3.2 Linting passes: `pnpm lint` — 4beec48
- [x] 3.3 Production build passes: `pnpm build` — 4beec48

#### Manual

- [x] 3.4 Valid submit creates the plant and returns to `/` — 4beec48
- [x] 3.5 Invalid input shows specific inline errors on submit, then revalidates on change — 4beec48
- [x] 3.6 First-appearance radios default to Today, update their interval label, and control today-list appearance — 4beec48
- [x] 3.7 Photo picker supports preview, removal, invalid-file recovery, and omission — 4beec48
- [x] 3.8 Saving prevents duplicates and preserves form values after recoverable failure — 4beec48
- [x] 3.9 Mobile and desktop form layouts meet navigation, focus, and 44px-target requirements — 4beec48
- [x] 3.10 CSS-only system theme verified across authenticated and authentication surfaces — 4beec48

### Phase 4: Today's-list island + optimistic Mark Watered

#### Automated

- [x] 4.1 Type checking passes: `pnpm exec astro check` — d309ce1
- [x] 4.2 Linting passes: `pnpm lint` — d309ce1
- [x] 4.3 Production build passes: `pnpm build` — d309ce1

#### Manual

- [x] 4.4 Watered removes the row instantly with no visible network wait — d309ce1
- [x] 4.5 Full-cycle determinism: plant reappears exactly `interval` days later, not before — d309ce1
- [x] 4.6 Retryable action failure restores row, count, stable position, focus where practical, and Retry toast — d309ce1
- [x] 4.7 Past-due plant appears without Overdue label or amber styling — d309ce1
- [x] 4.8 Photo thumbnail crop/empty alt and neutral initial fallback render correctly — d309ce1
- [x] 4.9 No-plants, clear-day, and fetch-failure states render their distinct messages and actions — d309ce1
- [x] 4.10 Ledger handles 10–30 rows, 80-character names, date/interval grammar, and responsive action alignment — d309ce1
- [x] 4.11 Success and rollback motion honor `prefers-reduced-motion` — d309ce1
- [x] 4.12 Browser-local hydration bootstrap and local-midnight rollover verified — d309ce1
- [x] 4.13 Signed-URL failures degrade affected photos to initial fallbacks — d309ce1
