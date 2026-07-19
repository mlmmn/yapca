# Finish Auth and Route Gating (F-01) — Plan Brief

> Full plan: `context/changes/finish-auth-and-route-gating/plan.md`
> Design brief: `context/changes/finish-auth-and-route-gating/design.md`

## What & Why

Turn YAPCA's working backend auth shell (`/api/auth/*` routes + a session-resolving middleware) into a complete, enforced, user-facing flow: a signed-out visitor can create an account, verify their email, sign in, and sign out; the root branches on session. It's the foundation slice that unlocks the north-star watering loop (S-01) and the per-account RLS everything downstream depends on.

## Starting Point

The routes work but nothing reaches them: `PROTECTED_ROUTES` is empty, there are no auth UI pages (`/auth/signin`, `/auth/signup`, `/auth/confirm-email` all 404), and `index.astro` is a placeholder wordmark. Middleware resolves `context.locals.user` but has no reverse guard. Only `button.tsx` exists in `ui/`, and dark-mode tokens are defined but never activate.

## Desired End State

A visitor lands on a quiet branded signed-out entry, moves through sign-up → a real confirm-email page (with their address + working Resend) → sign-in → a minimal authed shell (top bar + Sign out + "list coming" placeholder) → sign out. Signed-in users can't re-enter `/auth/*`. The whole flow works with JavaScript off; JS only adds a submitting state. Dark mode follows the OS with no flash.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Email confirmation | ON in production | Confirm-email is a real designed destination, not a stub. | Design |
| Front door | Quiet branded moment | Centered column, wordmark in canopy green, one accent. | Design |
| Forms | Native Astro + progressive enhancement | Works JS-off; JS only enhances the submit button. | Design |
| Route gating | Reverse-guard + documented `PROTECTED_ROUTES` pattern | Only gate what exists; `/` branches, S-01 seeds real routes later. | Plan |
| Form fields | Hand-styled native inputs | Zero JS/hydration, matches the "no island" intent exactly. | Plan |
| Dark mode | Inline no-flash script toggles `.dark` from `matchMedia` | Keeps the class-based token system; no FOUC; toggle-ready. | Plan |
| Seasonal accent | Off — plain canopy green | Keeps F-01 minimal; the ambient-season moment waits. | Design |
| Error copy | `mapAuthError` helper, applied at page render | Single source, testable; routes keep forwarding raw messages. | Plan |
| Resend | New `POST /api/auth/resend`; signup carries `?email=` | `supabase.auth.resend` needs the address the confirm page lacks. | Plan |

## Scope

**In scope:** four auth surfaces (`/`, `/auth/signin`, `/auth/signup`, `/auth/confirm-email`), the authed shell, shared centered-column layout, error-copy mapping, resend flow, middleware reverse guard + gating pattern, system-preference dark mode.

**Out of scope:** password reset, account deletion, seasonal accent, dark-mode toggle, React form islands, real app routes / their gating, marketing landing page, new shadcn components.

## Architecture / Approach

Server-rendered Astro pages post to the existing `/api/auth/*` routes and round-trip errors via `?error=`. A shared `AuthLayout.astro` gives all four unauthenticated surfaces one identical centered narrow column on true-white paper. A pure `mapAuthError` helper translates raw Supabase strings at render. A small vanilla inline `<script>` per form handles the submitting state; a blocking inline script in the base layout activates dark mode. Gating is a middleware reverse guard plus a documented (empty for now) `PROTECTED_ROUTES` seam.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Shared auth foundation | `AuthLayout`, wordmark, field markup, error helper, dark-mode wiring | Dark no-flash script ordering; getting the token-styled column right |
| 2. Sign in & sign up | The two native forms, error banner, submit enhancement | A11y: never-color-alone banner, JS-off parity, keyboard/focus |
| 3. Confirm-email & resend | Signup `?email=`, confirm page, resend route | Resend correctness; email carried safely through the redirect |
| 4. Root branch, shell & gating | `/` session branch, authed shell, reverse guard | `/` must branch (not redirect); reverse guard must skip `/api/auth/` |

**Prerequisites:** none (F-01 is first). Local Supabase stack running for manual verification (README).
**Estimated effort:** ~2–3 focused sessions across the 4 phases.

## Open Risks & Assumptions

- No test harness in the repo — verification is lint/build + a manual end-to-end pass (including a JS-disabled run).
- Assumes the design brief's §10 defaults hold (all confirmed this session).
- Dark mode won't apply with JavaScript fully disabled — acceptable, it falls back to the light paper default.

## Success Criteria (Summary)

- A new user completes sign up → confirm → sign in → shell → sign out end-to-end, with and without JavaScript.
- Error banners show human copy (icon + text), signed-in users can't re-enter `/auth/*`, and dark mode follows the OS with no flash.
- `pnpm lint` and `pnpm build` pass; the gating pattern is ready for S-01 to seed.
