<!-- PLAN-REVIEW-REPORT -->

# Plan Review: Finish Auth and Route Gating (F-01)

- **Plan**: context/changes/finish-auth-and-route-gating/plan.md
- **Mode**: Deep
- **Date**: 2026-07-19
- **Verdict**: SOUND (REVISE before triage; all findings fixed)
- **Findings**: 1 critical, 3 warnings, 0 observations

## Verdicts

| Dimension             | Verdict       |
| --------------------- | ------------- |
| End-State Alignment   | PASS after F2 |
| Lean Execution        | PASS          |
| Architectural Fitness | PASS after F4 |
| Blind Spots           | PASS after F3 |
| Plan Completeness     | PASS after F1 |

## Grounding

Grounding: 10/10 existing paths ✓, 7/7 symbols ✓, brief↔plan ✓. Deep verification confirmed the middleware ordering and narrow blast radius. The final Progress contract is valid: exactly one `## Progress` block, 4/4 phase headings matched, 29/29 verification criteria represented, and no checkboxes outside Progress.

## Findings

### F1 — Auth API contracts violate repository rules

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Completeness
- **Location**: Phases 2–4 — Auth API routes
- **Detail**: The repository requires zod validation and explicit `export const prerender = false` on API routes. The original plan specified unvalidated form-data access for Resend, only added the prerender export there, and did not add zod as a direct dependency. Existing signin/signup also cast form values directly, while signin/signup/signout lacked the explicit SSR marker.
- **Fix**: Normalize the complete auth API surface: add zod directly; validate signin, signup, and resend input; define invalid-input redirects; and add `prerender = false` to signin, signup, signout, and resend.
  - Strength: Makes the shipped auth surface conformant and removes unsafe form-data casts.
  - Tradeoff: Adds `package.json`, `pnpm-lock.yaml`, and otherwise-small edits to all existing auth routes.
  - Confidence: HIGH — confirmed against AGENTS.md and every current API route.
  - Blind spot: Validation-error copy needed an explicit contract.
- **Decision**: FIXED — Phase 2 now adds zod and normalizes signin/signup; Phase 3 validates resend; Phase 4 normalizes signout; matching automated Progress rows were added.

### F2 — Email verification handoff is not planned

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: End-State Alignment
- **Location**: Phase 3 and Migration Notes
- **Detail**: The end state promised that users could verify their email, but Phase 3 originally stopped after sending and resending. No step owned the clicked-link destination, hosted Supabase URL/template configuration, or failure-path verification. Local configuration also had confirmations disabled and pointed its Site URL at port 3000 instead of Astro's port 4321. Supabase identifies Site URL configuration as critical for confirmations; its Astro SSR guide documents the callback alternative ([Redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls), [Astro auth guide](https://supabase.com/docs/guides/auth/quickstarts/astrojs)).
- **Fix A ⭐ Recommended**: Keep confirmation separate from sign-in, but explicitly configure and verify the default confirmation-link flow locally and in hosted Supabase.
  - Strength: Minimal and consistent with the intended confirm → sign-in journey.
  - Tradeoff: Requires documented hosted-dashboard configuration.
  - Confidence: MEDIUM — the hosted email template cannot be inspected locally.
  - Blind spot: An already-customized hosted template might require a callback.
- **Fix B**: Add `/auth/callback`, verify `token_hash` with `verifyOtp`, configure the email template, and redirect after success.
  - Strength: App-controlled success/error behavior following the documented SSR pattern.
  - Tradeoff: Adds a route and local/hosted template configuration.
  - Confidence: HIGH — documented by Supabase for Astro SSR.
  - Blind spot: Requires deciding whether confirmation establishes a session.
- **Decision**: FIXED via Fix A — Phase 3 now owns local and hosted confirmation configuration, retains the default `{{ .ConfirmationURL }}` flow, targets `/auth/signin`, and verifies the clicked initial and resent links.

### F3 — Resend breaks for missing and insufficiently encoded email values

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 3 — Resend API and confirm-email page
- **Detail**: The original resend redirect interpolated `email=<email>`, which could corrupt plus-addresses and allow delimiter characters to alter query parameters. Direct visits without `?email=` also rendered a Resend form whose hidden email would be empty.
- **Fix**: Build confirmation redirects with `URL`/`URLSearchParams`, verify plus-address round trips, and only show Resend for a validated email; otherwise provide an actionable Create account link.
- **Decision**: FIXED — signup and resend now require structured URL construction; the confirm page validates the query email and omits Resend when it is missing or invalid; automated and manual Progress checks were added.

### F4 — Shared UI contracts permit unnecessary duplication

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architectural Fitness
- **Location**: Implementation Approach and Phase 4
- **Detail**: The plan promised one shared unauthenticated skeleton but called the root only “AuthLayout-style,” allowing duplicated markup. It also incorrectly said React components require hydration in Astro. Astro renders framework components server-side by default without hydrating them ([Astro directives](https://docs.astro.build/en/reference/directives-reference/)); the existing exported `buttonVariants` helper is the appropriate native-control style source.
- **Fix**: Require the signed-out root to use `AuthLayout`; retain native controls; apply `buttonVariants(...)` server-side; and correct the hydration statement.
- **Decision**: FIXED — all auth controls now reuse `buttonVariants(...)` without copied class strings, and the signed-out root explicitly renders through `AuthLayout`.

## Triage Summary

- **Fixed**: F1, F2 (Fix A), F3, F4
- **Skipped**: None
- **Accepted**: None
- **Dismissed**: None
- **Verdict after fixes**: SOUND
