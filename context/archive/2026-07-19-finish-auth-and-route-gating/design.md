---
change_id: finish-auth-and-route-gating
title: Finish auth and route gating — design brief
kind: design-brief
created: 2026-07-19
updated: 2026-07-19
---

# Design Brief — F-01: Finish auth and route gating

## 1. Feature summary

The front door and the lock for YAPCA. Five thin surfaces that turn the existing
backend auth shell (working `/api/auth/*` routes, a session-resolving middleware)
into a complete, enforced flow: a signed-out visitor can create an account,
verify their email, sign in, and sign out; every app route requires a session.
It's a foundation slice — production-ready code, deliberately minimal scope —
that unlocks the north-star watering loop (S-01) and the per-account RLS
everything downstream depends on.

## 2. Primary user action

**Get in.** A first-time visitor's single job is "create an account and reach the
app"; a returning user's is "sign in." Everything on these screens serves that one
path — no marketing, no distraction.

## 3. Design direction

**Color strategy: Restrained** (the product floor — PRODUCT.md/DESIGN.md,
non-negotiable here). Canopy green is the only saturated voice, on the primary
button, focus ring, and wordmark; ≤10% of the surface. Body is **true white
paper**, not cream.

**Scene sentence:** *A plant owner stands in a bright room among their plants,
phone in one hand, and taps through a two-field form to get to today's list —
calm, unhurried, trusting the tool.* → Light theme is the primary target; dark
theme is respected via system preference (tokens already defined; **no toggle in
this slice** — asserted).

**Anchor references:** Linear's auth screens (centered, quiet, one accent),
Stripe's login (dense trust, no ornament), a naturalist's field-notebook title
page (the wordmark as a calm mark, not a logo splash).

**Front-door character (chosen): a quiet branded moment.** Centered single
column, generous vertical calm, the `yapca` wordmark in canopy green, one
restrained seasonal cue (see §8). Still Restrained — the identity is spacing,
type, and one color, never illustration (no leaves, no kitsch — the DESIGN.md
bans hold).

## 4. Scope

- **Fidelity:** production-ready (this is real shipping foundation code).
- **Breadth:** a small flow — 5 surfaces + middleware gating.
- **Interactivity:** shipped-quality. **Approach:** server-rendered Astro forms
  posting to the existing `/api/auth/*` routes (progressive enhancement — works
  with JS off, matches the current redirect-with-`?error=` pattern, on-brand for
  an SSR product). JS only *enhances*: disable+spinner the submit button, plus
  client autocomplete niceties. No React island unless a form genuinely needs
  one — it doesn't.
- **Time intent:** polish until it ships.

## 5. Layout strategy

One shared **centered narrow column** (~360–400px form width) vertically centered
in `min-h-screen`, identical skeleton across all four unauthenticated surfaces so
they feel like one place: wordmark → screen heading → content → one secondary link
at the bottom. Type carries the hierarchy (Figtree weight/size). Flat — no card
shadow at rest (Flat-Paper Rule); the column sits directly on paper, separated by
whitespace, not a floating box. Fully responsive by shrinking margins, not by
fluid type.

The **signed-in authed shell** (root `/` with a session) is the one different
layout: a slim top bar (wordmark left, Sign out right) over a calm placeholder
body that reads "today's list is coming" — this establishes the header S-01 will
fill in.

## 6. Key states

Per unauthenticated form (sign in / sign up):

- **Default** — empty fields, focus lands on email.
- **Typing / filled** — standard input focus (focus-green border + ring).
- **Submitting** — button disabled with an inline spinner (reduced-motion: static
  "Signing in…" label).
- **Error** — a banner above the form from `?error=`, paired with an icon + text
  (never color alone), destructive-bordered but not shouting. Common Supabase
  messages are mapped to human copy (§8).
- **Field validation** — required email/password, native `type=email` +
  minlength; error surfaced inline via `aria-describedby`.

Other surfaces:

- **Confirm-email** — real terminal destination: "Check your inbox," the address
  it was sent to, a **Resend** action (re-POSTs; email carried via query param),
  and a quiet "back to sign in" link.
- **Signed-out root** — wordmark, one-line positioning, primary **Sign in** +
  secondary **Create account**.
- **Authed shell** — placeholder body + working **Sign out**; genuinely empty but
  teaches ("Your daily list will appear here").
- **Loading** — negligible (server-rendered); no skeletons needed.

## 7. Interaction model

Native form submit → API route → redirect. Success: sign-in → `/`, sign-up →
`/auth/confirm-email`, sign-out → `/` (signed-out entry). Errors round-trip back
to the same page with `?error=`. **Routing model:** `/` branches on
`context.locals.user` (signed-out entry vs. authed shell) — not a redirect. A
**reverse guard** sends already-signed-in users away from `/auth/*` → `/`.
`PROTECTED_ROUTES` is seeded so future app routes (plants, tasks) require a
session and bounce to `/auth/signin`. Focus management and Enter-to-submit come
free from native forms.

## 8. Content requirements

Plain, human, never cutesy or corporate (brand voice). Needed copy:

- **Wordmark:** `yapca`, lowercase, canopy green.
- **Signed-out entry:** one positioning line (e.g. "The daily plant-care list you
  can actually trust.") + two CTAs.
- **Sign in / Sign up:** headings ("Sign in", "Create your account"), field
  labels, button text, cross-links ("New here? Create an account" / "Already have
  an account? Sign in").
- **Error mapping:** translate raw Supabase strings — e.g. `Invalid login
  credentials` → "That email and password don't match." ; `User already
  registered` → "An account with this email already exists." ; weak password →
  the actual rule. Unmapped errors fall through verbatim.
- **Confirm-email:** "Check your inbox," instruction line, the target address,
  Resend, sign-in link.
- **Authed shell:** wordmark + "Sign out" + a one-line "coming soon" body.
- **Seasonal cue (optional, opt-in):** the front-door accent could derive the
  active season from the calendar (it's date-based, no data needed) and shift the
  single accent — canopy green in growing season, a muted amber-leaning tone in
  dormancy — a literal expression of "season is ambient." Default is plain canopy
  green; opt in explicitly to bring this into scope.

## 9. Recommended references

- **`interaction-design.md`** — form controls, validation, focus, autocomplete
  tokens.
- **`clarify.md`** — the error-copy mapping and microcopy voice.
- **`harden.md`** — error/edge states, the confirm-email resend, guard behavior.
- **`onboard.md`** — the signed-out entry and the empty authed shell (both are
  first-run moments).

## 10. Resolved defaults

All prior forks resolved. Decisions defaulted (override any):

- **Email confirmation:** ON in production — confirm-email is a real designed
  destination.
- **Signed-in root (this slice):** minimal authed shell (top bar + Sign out +
  "list coming" placeholder).
- **Front-door character:** quiet branded moment.
- **Password reset:** parked (roadmap keeps F-01 minimal); no "forgot password"
  link this slice.
- **Dark mode:** system-preference only, no toggle.
- **Resend email:** included, with the address carried to the confirm page via
  query param.
- **Seasonal accent:** off by default (plain canopy green).

---

## Surfaces at a glance

| Route | Session | Purpose |
|---|---|---|
| `/` | none | Signed-out entry: wordmark + positioning + Sign in / Create account |
| `/` | active | Authed shell: top bar (wordmark + Sign out) + "list coming" placeholder |
| `/auth/signin` | none | Email + password form → `POST /api/auth/signin` |
| `/auth/signup` | none | Email + password form → `POST /api/auth/signup` |
| `/auth/confirm-email` | none | "Check your inbox" terminal state + Resend |
| middleware | — | `PROTECTED_ROUTES` seeded; reverse-guard `/auth/*` for signed-in users |
