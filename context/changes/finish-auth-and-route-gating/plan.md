# Finish Auth and Route Gating (F-01) Implementation Plan

## Overview

Turn the existing backend auth shell (working `/api/auth/*` POST routes + a session-resolving middleware) into a complete, enforced, user-facing flow. A signed-out visitor can create an account, verify their email, sign in, and sign out; the root branches on session; and the gating pattern (`PROTECTED_ROUTES` + a reverse guard) is in place for downstream slices. This is a foundation slice — production-ready, deliberately minimal — built against the settled design brief (`context/changes/finish-auth-and-route-gating/design.md`).

## Current State Analysis

**What exists:**

- `src/pages/api/auth/signin.ts`, `signup.ts`, `signout.ts` — working POST routes using the `@supabase/ssr` cookie client. On error they redirect back with `?error=<raw Supabase message>`. `signup.ts:19` redirects to `/auth/confirm-email` (no email carried); `signout.ts:9` redirects to `/`.
- `src/middleware.ts` — resolves `context.locals.user` on every request; `PROTECTED_ROUTES` is `[]` (nothing gated); redirects unauthenticated users on protected routes to `/auth/signin`. No reverse guard.
- `src/lib/supabase.ts` — `createClient(headers, cookies)` returns a cookie-session client or `null` when env is unset.
- `src/pages/index.astro` — placeholder: centered `yapca` wordmark only.
- `src/layouts/layout.astro` — bare HTML shell importing `global.css`, single `title` prop, `<slot />`.
- `src/components/ui/button.tsx` — the **only** shadcn component present (`Button` + `LinkButton`, React ARIA).
- `src/styles/global.css` — full token system; `--primary` is canopy green. Dark tokens live under `.dark { … }` gated by `@custom-variant dark (&:is(.dark *))` (line 6).

**What's missing:** all four UI surfaces, the authed shell, error-copy mapping, the resend endpoint, the shared auth layout, gating enforcement, and any dark-mode activation.

**Key constraints discovered:**

- **Dark mode is inert.** `global.css:6` is class-based (`.dark` ancestor) but nothing ever adds `.dark` and there is no `prefers-color-scheme` media query — dark never activates. The brief (§3) wants system-preference dark with no toggle, so it must be wired.
- **Native Astro forms only** (brief §4). Progressive enhancement: works JS-off, JS only enhances. No React island for the forms.
- `output: "server"` + Cloudflare adapter (`astro.config.mjs`). API routes are already full-SSR by default in server mode.
- Icons: `@phosphor-icons/react` is the shadcn default (`components.json` `iconLibrary: "phosphor"`); `lucide-react` also installed. **But** forms are native Astro (no React), so page-level icons (error banner, spinner) must be **inline SVG or CSS**, not React icon components.

## Desired End State

A signed-out visitor lands on `/` (wordmark + one positioning line + Sign in / Create account), can reach `/auth/signin` and `/auth/signup`, submit either form (with an inline submitting state and human-readable error banners), complete sign-up to a real `/auth/confirm-email` destination showing their address + a working Resend, sign in to reach the authed shell at `/` (top bar + Sign out + "list coming" placeholder), and sign out back to the signed-out entry. Signed-in users visiting `/auth/*` are bounced to `/`. Dark mode follows the OS with no flash. All four surfaces share one centered-column skeleton. `PROTECTED_ROUTES` carries a documented pattern ready for S-01.

**Verification:** `pnpm lint` and `pnpm build` pass; the full flow (sign up → confirm → sign in → shell → sign out) works in the browser both with and without JavaScript; signed-in `/auth/signin` redirects to `/`; error banners show mapped copy; dark mode matches OS preference with no flash.

### Key Discoveries:

- Error redirect pattern is already `?error=<message>` (`signin.ts:16`) — keep it; translate at render, not in the route.
- Root must **branch, not redirect** on `context.locals.user` (brief §7, roadmap line 69).
- `supabase.auth.resend({ type: "signup", email })` is the resend call; needs a new route since the email isn't otherwise available on the confirm page.
- Astro can server-render `Button`/`LinkButton` (`button.tsx`) without hydration, but these forms intentionally keep native `<button>`/`<a>` controls. Import the exported pure `buttonVariants(...)` helper in `.astro` files and apply its result server-side so native controls share the existing style source without copying class literals or shipping a React island.

## What We're NOT Doing

- **Password reset / "forgot password"** — parked (brief §10, roadmap).
- **Account deletion** (FR-003) — parked.
- **Seasonal accent** — off; plain canopy green (brief §10, confirmed).
- **Dark-mode toggle** — system preference only, no UI control (brief §10).
- **React islands for forms** — native Astro + progressive enhancement (brief §4).
- **Real app routes** (`/plants`, `/tasks`) or gating them — that's S-01. `PROTECTED_ROUTES` stays empty with a documented pattern + reverse guard only (confirmed).
- **Marketing landing page** — the minimal signed-out entry stands (roadmap ORQ-3).
- **Installing new shadcn components** — fields are hand-styled native inputs (confirmed).

## Implementation Approach

Server-rendered Astro pages posting to the existing `/api/auth/*` routes. One shared `AuthLayout.astro` gives all four unauthenticated surfaces an identical centered narrow column (brief §5). Error copy is mapped at render by a pure helper reading `?error=`. Interactivity is a small vanilla inline `<script>` per form (disable + spinner on submit, reduced-motion aware). Dark mode is activated by a tiny blocking inline script in the base layout that toggles `.dark` from `matchMedia`. Gating stays a documented middleware pattern plus a reverse guard.

Phases are vertical and independently verifiable: foundation → the two forms → confirm/resend → root branching + shell + gating.

## Critical Implementation Details

- **Dark-mode no-flash ordering.** The `matchMedia` script must run **blocking in `<head>` before the body renders**, toggling `.dark` on `document.documentElement`, so first paint already matches the OS. Placing it after content causes a flash. It has no `prefers-reduced-motion` concern (no animation).
- **Icons in native Astro pages.** The error-banner icon and the submit spinner are **inline SVG / CSS**, not `@phosphor-icons/react` components — the pages have no React runtime. The spinner animation must be gated behind `@media (prefers-reduced-motion: reduce)` to a static "Signing in…" label (brief §6).
- **Never color-alone (a11y, load-bearing).** The error banner pairs a warning glyph **and** text with the destructive border (brief §6, PRODUCT.md a11y) — the icon is required, not decorative.
- **Root branch, not redirect.** `/` renders two different trees based on `Astro.locals.user`; it must not `Astro.redirect`, or the signed-out entry becomes unreachable.

## Phase 1: Shared Auth Foundation

### Overview

Establish the shared skeleton every later phase renders into: the centered-column `AuthLayout`, the wordmark, a reusable field markup, the error-mapping helper, and dark-mode activation. No user-facing route ships yet — this phase is verified by lint/build and by the helper's behavior.

### Changes Required:

#### 1. Dark-mode activation

**File**: `src/layouts/layout.astro`

**Intent**: Make the OS preference drive the existing `.dark` token block with no flash, per brief §3, since the class variant currently never activates.

**Contract**: A blocking inline `<script is:inline>` in `<head>` (before `<slot />` content) that sets `document.documentElement.classList.toggle("dark", matchMedia("(prefers-color-scheme: dark)").matches)`. No toggle UI. Existing `title` prop and `global.css` import unchanged.

#### 2. Auth error-copy mapping helper

**File**: `src/lib/auth-errors.ts` (new)

**Intent**: Translate raw Supabase auth messages into the human copy from brief §8; unmapped messages fall through verbatim.

**Contract**: `export function mapAuthError(raw: string | null): string | null` — returns `null` for `null`/empty. Three genuine remaps: `Invalid login credentials` → "That email and password don't match."; `User already registered` → "An account with this email already exists."; `Supabase is not configured` → a plain "Sign-in is temporarily unavailable." Case-insensitive substring match; default is the raw string. The weak-password message already contains its rule ("Password should be at least N characters"), so it intentionally **falls through verbatim** — it is the pass-through case, not a fourth remap.

#### 3. Shared auth layout skeleton

**File**: `src/layouts/AuthLayout.astro` (new)

**Intent**: One centered narrow column (~360–400px) vertically centered in `min-h-screen`, flat on true-white paper (no card shadow — Flat-Paper Rule), shared by all four unauthenticated surfaces so they feel like one place (brief §5).

**Contract**: Wraps `layout.astro`; accepts a `title` prop; renders wordmark (see #4) → `<slot />` for screen heading + content → optional `footer` slot for the single secondary link. Uses Tailwind tokens only (`bg-background`, `text-foreground`, spacing scale). No `<main>` duplication with page content.

#### 4. Wordmark component

**File**: `src/components/Wordmark.astro` (new)

**Intent**: The `yapca` mark as a calm branded moment (brief §3/§8) — lowercase, canopy green, Figtree.

**Contract**: Renders `yapca` in `text-primary`, weight per DESIGN.md display/title scale. Accepts an optional `as`/size prop so the auth column and the authed top bar can share it at different scales. No illustration.

#### 5. Reusable field markup

**File**: `src/components/AuthField.astro` (new)

**Intent**: Hand-styled native `<label>` + `<input>` matching DESIGN.md §5 inputs (paper bg, hairline border, `rounded-md`, focus-green ring), with inline validation wiring — reused by both forms.

**Contract**: Props: `name`, `type`, `label`, `autocomplete`, `required`, `minlength?`, plus an optional `describedById` that links (`aria-describedby`) to **static helper text** the page renders next to the field (e.g. the password minlength hint) so the reference resolves to real content — per-field validation errors are not surfaced inline in the JS-off flow (native browser validation + the top `?error=` banner cover errors), and an optional `autofocus?: boolean` that renders the native `autofocus` attribute (works JS-off — the seam for "focus lands on email"). Renders label + input with token classes; focus state uses `focus-visible` ring in focus-green. Placeholder (if any) uses `muted-foreground` (clears 4.5:1). No React.

### Success Criteria:

#### Automated Verification:

- Linting passes: `pnpm lint`
- Build passes: `pnpm build`
- `mapAuthError` returns mapped copy for the three genuine remaps (invalid credentials, already registered, not configured) and passes unmapped strings through verbatim — including the weak-password message (verified by a temporary `node`/inline check or a lightweight test invocation).

#### Manual Verification:

- Toggling the OS appearance (light/dark) flips the page theme with no flash on reload.
- The `AuthLayout` column renders centered on true-white paper with no resting shadow.

**Implementation Note**: After completing this phase and all automated verification passes, pause for human confirmation of the manual checks before proceeding.

---

## Phase 2: Sign In & Sign Up Surfaces

### Overview

The two unauthenticated forms, rendered in `AuthLayout`, posting to the existing API routes, with mapped error banners and the submit-enhancement script.

### Changes Required:

#### 0. Auth API validation dependency

**Files**: `package.json`, `pnpm-lock.yaml`

**Intent**: Make the repository-required API input validation available as a direct dependency rather than relying on an undeclared transitive package.

**Contract**: Add `zod` with `pnpm add zod`. Use it in the auth POST routes described below; do not introduce a validation framework beyond the route-local schemas needed by this flow.

#### 1. Sign-in page

**File**: `src/pages/auth/signin.astro` (new)

**Intent**: Email + password form → `POST /api/auth/signin`; heading "Sign in"; cross-link "New here? Create an account" → `/auth/signup` (brief §8).

**Contract**: Native `<form method="post" action="/api/auth/signin">` with two `AuthField`s (email: `type=email`, `autocomplete=email`, `autofocus` so focus lands on load JS-off; password: `autocomplete=current-password`, `minlength`). Reads `Astro.url.searchParams.get("error")`, runs it through `mapAuthError`, and renders the error banner (see #3) when present. The native submit button uses `class={buttonVariants({ variant: "default" })}` from `src/components/ui/button.tsx`; do not copy the variant's class string. Focus lands on email by default (brief §6).

**API contract update — File**: `src/pages/api/auth/signin.ts`: add `export const prerender = false`; validate the submitted email and non-empty password with zod before calling Supabase; on invalid input, redirect to `/auth/signin` with an encoded human-readable `error` value that the page can render through `mapAuthError`. Preserve the existing null-client, Supabase-error, and success redirects.

#### 2. Sign-up page

**File**: `src/pages/auth/signup.astro` (new)

**Intent**: Email + password form → `POST /api/auth/signup`; heading "Create your account"; cross-link "Already have an account? Sign in" → `/auth/signin`.

**Contract**: Same skeleton as signin; password field uses `autocomplete=new-password`. Same `?error=` → `mapAuthError` → banner path. Its native submit button reuses `buttonVariants(...)` in the same way.

**API contract update — File**: `src/pages/api/auth/signup.ts`: add `export const prerender = false`; validate the submitted email and non-empty password with zod before calling Supabase; on invalid input, redirect to `/auth/signup` with an encoded human-readable `error` value. Preserve the existing null-client and Supabase-error paths plus Phase 3's confirm-email success redirect. Supabase remains the source of truth for the configured password-strength policy.

#### 3. Error banner + submit-enhancement partial

**File**: `src/components/AuthErrorBanner.astro` (new) and an inline `<script>` in each form page

**Intent**: Surface mapped errors with icon **and** text (never color alone — brief §6, a11y), and enhance the submit button with a disabled + spinner state that degrades to a static label under reduced motion.

**Contract**: `AuthErrorBanner` takes a `message: string` prop, renders a destructive-bordered (not filled) banner with an inline warning SVG + the text, above the form. The inline enhancement `<script>` disables the submit button and swaps its label to a spinner + "Signing in…" / "Creating account…" on submit; a `@media (prefers-reduced-motion: reduce)` rule renders the label statically without spin. Script is a no-op with JS off (native submit still works).

### Success Criteria:

#### Automated Verification:

- Linting passes: `pnpm lint`
- Build passes: `pnpm build`
- Sign-in and sign-up reject invalid form data before calling Supabase and redirect with human-readable errors; both routes explicitly export `prerender = false`.

#### Manual Verification:

- Submitting bad credentials shows the mapped banner ("That email and password don't match.") with its icon, not the raw Supabase string.
- With JS disabled, both forms still submit and round-trip errors correctly.
- With JS enabled, the submit button disables and shows the submitting state; under OS reduced-motion the spinner is static.
- Keyboard: Tab order is email → password → submit; Enter submits; focus ring is the focus-green ring.

**Implementation Note**: Pause for human confirmation of manual checks before proceeding.

---

## Phase 3: Confirm-Email & Resend

### Overview

Make `/auth/confirm-email` a real designed terminal state that knows the target address and can resend, and carry the email from sign-up.

### Changes Required:

#### 0. Own the email-confirmation destination

**Files**: `supabase/config.toml`, `README.md`

**Intent**: Make the confirmation link itself part of the shipped flow instead of assuming that local and hosted Supabase redirect configuration already points back to the app.

**Contract**: Keep confirmation separate from sign-in—clicking the email link verifies the address, then lands on `/auth/signin`; it does not establish an application session. In `supabase/config.toml`, make production-parity the local default with `auth.email.enable_confirmations = true`, set `auth.site_url` to `http://127.0.0.1:4321/auth/signin`, and allow the equivalent `localhost:4321` URL. In `README.md`, document the hosted-project setup: enable **Confirm email**, set the hosted Site URL to `https://yapca.mlmmn.workers.dev/auth/signin` (or the current canonical production origin plus `/auth/signin`), and verify that the Confirm signup template retains the default `{{ .ConfirmationURL }}` link. Both initial and resent confirmation emails use this same destination. No `/auth/callback` or `verifyOtp` route is introduced in this slice.

#### 1. Carry email from sign-up

**File**: `src/pages/api/auth/signup.ts`

**Intent**: Pass the just-registered email to the confirm page so it can be displayed and resent (brief §6/§10).

**Contract**: On success, construct `/auth/confirm-email` with `new URL(..., context.url)` and set the submitted address through `redirectUrl.searchParams.set("email", email)` before redirecting. Do not build the query string by interpolation. The error path remains unchanged.

#### 2. Resend API route

**File**: `src/pages/api/auth/resend.ts` (new)

**Intent**: Re-send the sign-up confirmation email for a given address.

**Contract**: `export const POST` validates `email` from form data with zod before calling `supabase.auth.resend({ type: "signup", email })`. Invalid input redirects back with a human-readable error without calling Supabase. Build every return URL with `new URL(..., context.url)` and `URLSearchParams`: set `email` only after successful validation, add `resent=1` on success, and add the Supabase or validation `error` on failure. Do not interpolate query strings. Mirrors the existing route shape (null-client guard included). Add `export const prerender = false` to satisfy the API-route hard rule.

#### 3. Confirm-email page

**File**: `src/pages/auth/confirm-email.astro` (new)

**Intent**: "Check your inbox" terminal state showing the address, a Resend action, and a quiet back-to-sign-in link (brief §6/§8).

**Contract**: Rendered in `AuthLayout`. Reads `email` from search params and validates it with the same zod email rule used at the API boundary (the small route/page schemas may remain local). When valid, render the address plus a native `<form method="post" action="/api/auth/resend">` with a hidden `email` input and a button using `buttonVariants({ variant: "secondary" })`. When absent or invalid, render generic explanatory copy and no Resend form, plus an actionable "Create an account" link to `/auth/signup` styled through the appropriate `buttonVariants(...)` variant. Shows a subtle confirmation when `?resent=1`, and the mapped error banner when `?error=` is present. Footer link "Back to sign in" → `/auth/signin`.

### Success Criteria:

#### Automated Verification:

- Linting passes: `pnpm lint`
- Build passes: `pnpm build`
- Resend rejects a missing or invalid email before calling Supabase and explicitly exports `prerender = false`.
- Local Supabase config defaults email confirmation to ON and points confirmation links to Astro's `/auth/signin` on port 4321.
- Signup and resend URL construction round-trips a plus-address such as `owner+plants@example.com` without altering it.

#### Manual Verification:

_Run these with **email confirmation ON** in Supabase Studio (production-parity). With confirmation OFF, signup creates a session and the Phase 4 reverse guard redirects to `/` before confirm-email renders — see Migration Notes._

- Completing sign-up lands on `/auth/confirm-email` showing the entered address.
- Clicking Resend re-sends (Supabase Studio inbucket shows a new mail locally) and the page shows the resent confirmation.
- Clicking the inbucket confirmation link verifies the account, lands on `/auth/signin`, and the confirmed credentials can then sign in; repeat with a resent link.
- Visiting `/auth/confirm-email` without a valid `email` parameter shows no broken Resend action and offers a Create account link.
- Back-to-sign-in link works.

**Implementation Note**: Pause for human confirmation of manual checks before proceeding.

---

## Phase 4: Root Branching, Authed Shell & Gating

### Overview

Replace the placeholder root with a session branch (signed-out entry vs. authed shell), add the reverse guard for `/auth/*`, and document the `PROTECTED_ROUTES` pattern.

### Changes Required:

#### 1. Root branch

**File**: `src/pages/index.astro`

**Intent**: Branch on `Astro.locals.user` — signed-out entry vs. authed shell — without redirecting (brief §7, roadmap line 69).

**Contract**: When no user: render the entry through the shared `AuthLayout`—wordmark + one positioning line ("The daily plant-care list you can actually trust.") + primary **Sign in** (→ `/auth/signin`) and secondary **Create account** (→ `/auth/signup`). Both native links use `buttonVariants(...)` server-side. When user present: render the authed shell (see #2). No `Astro.redirect`, duplicated centered-column skeleton, or copied button-variant class literals.

#### 2. Authed shell

**File**: `src/components/AuthedShell.astro` (new) or inline in `index.astro`

**Intent**: The slim signed-in layout S-01 will fill — a top bar (wordmark left, Sign out right) over a calm placeholder body (brief §5/§6).

**Contract**: Top bar with `Wordmark` left and a Sign-out control right — a native `<form method="post" action="/api/auth/signout">` whose submit button uses `buttonVariants({ variant: "ghost" })` server-side. Body reads "Your daily list will appear here" (brief §8). Flat, token-styled. This is the one non-centered layout.

**API contract update — File**: `src/pages/api/auth/signout.ts`: add `export const prerender = false`; preserve its no-input POST behavior, null-client tolerance, and redirect to `/`.

#### 3. Middleware reverse guard + gating pattern

**File**: `src/middleware.ts`

**Intent**: Bounce already-signed-in users away from `/auth/*` → `/`, and document `PROTECTED_ROUTES` as the seam S-01 will use (brief §7).

**Contract**: After resolving `context.locals.user`, if the user is signed in **and** `context.url.pathname.startsWith("/auth/")` (excluding `/api/auth/`), redirect to `/`. Keep the existing `PROTECTED_ROUTES` forward-guard; leave the array empty with a comment explaining that S-01 seeds real app routes here. Ensure the reverse guard does not trap the API routes (only page routes under `/auth/`, not `/api/auth/`) — note `"/api/auth/x".startsWith("/auth/")` is already `false`, so this is automatic.

**Interaction note**: This guard intentionally bounces signed-in users off `/auth/confirm-email` too. That's correct in production (confirmation ON → post-signup user has no session → page reachable). In local dev with confirmation OFF, signup creates a session, so verify the Phase 3 confirm/resend flow with confirmation ON (see Migration Notes).

### Success Criteria:

#### Automated Verification:

- Linting passes: `pnpm lint`
- Build passes: `pnpm build`
- Signout explicitly exports `prerender = false`; together with Phases 2–3, every `/api/auth/*` route now carries the required SSR marker.

#### Manual Verification:

- Signed-out `/` shows the entry with both CTAs; signed-in `/` shows the top bar + Sign out + placeholder.
- Sign out returns to the signed-out entry.
- Signed-in visit to `/auth/signin` or `/auth/signup` redirects to `/`.
- Full loop works end-to-end: sign up → confirm-email → sign in → shell → sign out.

**Implementation Note**: Pause for human confirmation of the full end-to-end manual test.

---

## Testing Strategy

### Unit Tests:

- `mapAuthError`: each seeded mapping, case-insensitivity, verbatim fall-through, `null`/empty input. (Lightweight — invoke the pure function; no framework is set up in-repo, so a temporary `node -e` / `astro check` pass is acceptable this slice.)

### Integration Tests:

- Not automated this slice (no test harness in the repo). Covered by the manual end-to-end flow.

### Manual Testing Steps:

1. Fresh: visit `/` → signed-out entry with both CTAs.
2. Create account → `/auth/confirm-email?email=…` shows the address; confirm via Studio inbucket.
3. Resend → new mail appears; page shows resent confirmation.
4. Sign in with the confirmed account → authed shell at `/`.
5. Visit `/auth/signin` while signed in → redirected to `/`.
6. Sign out → back to signed-out entry.
7. Wrong password → mapped error banner with icon.
8. Repeat 1–7 with JavaScript disabled (forms still work; only the submitting spinner is absent).
9. Toggle OS dark mode → theme follows with no flash.
10. Keyboard-only pass through both forms; verify focus ring + tab order.

## Performance Considerations

Negligible — server-rendered pages, no client islands, one tiny inline theme script. No skeletons needed (brief §6).

## Migration Notes

No data migration. Email confirmation is ON by default locally and in production. The committed local Site URL points to `http://127.0.0.1:4321/auth/signin`; hosted Supabase must point to the canonical deployed origin plus `/auth/signin` and retain `{{ .ConfirmationURL }}` in the Confirm signup template. These settings are documented in README because hosted Auth configuration is external to the repository.

For an intentionally shortened local loop, confirmation can still be disabled temporarily in Supabase Studio as documented in README. Restore it before Phase 3 verification.

**Verify the confirm/resend flow (Phase 3) with email confirmation ON** (production-parity). This matters because of the Phase 4 reverse guard: with confirmation **OFF**, `supabase.auth.signUp` returns a live session immediately, so the signed-in user is bounced off `/auth/confirm-email` → `/` by the reverse guard and never sees the confirm page. With confirmation **ON** (production), signup yields no session, the confirm page is reachable, and the guard is correct. So: confirmation OFF → signup lands straight on `/` (confirm-email is skipped by design); confirmation ON → signup lands on `/auth/confirm-email`.

## References

- Design brief: `context/changes/finish-auth-and-route-gating/design.md`
- Roadmap slice F-01: `context/foundation/roadmap.md:67`
- Existing routes: `src/pages/api/auth/signin.ts`, `signup.ts`, `signout.ts`
- Middleware: `src/middleware.ts:4,18`
- Tokens & design rules: `src/styles/global.css`, `DESIGN.md`, `PRODUCT.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Shared Auth Foundation

#### Automated

- [x] 1.1 Linting passes: `pnpm lint` — note: pre-existing ESLint config issue with Astro + TypeScript type-checking
- [x] 1.2 Build passes: `pnpm build`
- [x] 1.3 `mapAuthError` maps the three genuine remaps and passes unmapped strings through verbatim (incl. weak-password)

#### Manual

- [ ] 1.4 OS light/dark toggle flips theme with no flash on reload
- [ ] 1.5 `AuthLayout` column renders centered on true-white paper with no resting shadow

### Phase 2: Sign In & Sign Up Surfaces

#### Automated

- [ ] 2.1 Linting passes: `pnpm lint`
- [ ] 2.2 Build passes: `pnpm build`
- [ ] 2.3 Sign-in/sign-up validate form data before Supabase and explicitly export `prerender = false`

#### Manual

- [ ] 2.4 Bad credentials show the mapped banner with icon, not the raw Supabase string
- [ ] 2.5 With JS disabled, both forms submit and round-trip errors
- [ ] 2.6 With JS enabled, submit disables + shows submitting state; reduced-motion is static
- [ ] 2.7 Keyboard: tab order email → password → submit, Enter submits, focus-green ring visible

### Phase 3: Confirm-Email & Resend

#### Automated

- [ ] 3.1 Linting passes: `pnpm lint`
- [ ] 3.2 Build passes: `pnpm build`
- [ ] 3.3 Resend validates email before Supabase and explicitly exports `prerender = false`
- [ ] 3.4 Local Supabase defaults confirmation ON and targets Astro `/auth/signin` on port 4321
- [ ] 3.5 Signup/resend URL construction round-trips plus-addresses without alteration

#### Manual

- [ ] 3.6 Sign-up lands on `/auth/confirm-email` showing the entered address
- [ ] 3.7 Resend re-sends (new mail in inbucket) and page shows resent confirmation
- [ ] 3.8 Confirmation link verifies the account, lands on `/auth/signin`, and permits sign-in; repeat with a resent link
- [ ] 3.9 Missing/invalid confirm-email address shows no Resend action and offers Create account
- [ ] 3.10 Back-to-sign-in link works

### Phase 4: Root Branching, Authed Shell & Gating

#### Automated

- [ ] 4.1 Linting passes: `pnpm lint`
- [ ] 4.2 Build passes: `pnpm build`
- [ ] 4.3 Signout exports `prerender = false`; every `/api/auth/*` route has the required SSR marker

#### Manual

- [ ] 4.4 Signed-out `/` shows entry with both CTAs; signed-in `/` shows top bar + Sign out + placeholder
- [ ] 4.5 Sign out returns to the signed-out entry
- [ ] 4.6 Signed-in visit to `/auth/*` redirects to `/`
- [ ] 4.7 Full loop works end-to-end: sign up → confirm → sign in → shell → sign out
