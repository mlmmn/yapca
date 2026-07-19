---
date: 2026-07-19T17:05:23+0200
researcher: mlmmn
git_commit: 70808bd928c8ca9f47316f481998aef51fca31f7
branch: main
repository: yapca
topic: "React form library selection + snappy/optimistic UX strategy for the core watering loop"
tags: [research, codebase, forms, optimistic-ui, astro-actions, tanstack-form, react-19]
status: complete
last_updated: 2026-07-19
last_updated_by: mlmmn
---

# Research: React form library + snappy/optimistic UX for the core watering loop

**Date**: 2026-07-19T17:05:23+0200
**Researcher**: mlmmn
**Git Commit**: 70808bd928c8ca9f47316f481998aef51fca31f7
**Branch**: main
**Repository**: yapca

## Research Question

For the `core-watering-loop` (S-01) slice:

1. Select a React form library to ease working with forms.
2. Achieve a snappy user experience with optimistic responses — decide whether Astro's built-in capabilities suffice, or whether a dedicated solution is warranted.

Scope (confirmed with user): compare-then-recommend on the form library; research the full optimistic spectrum (Astro-native → React 19 → TanStack Query) and recommend the lightest option that delivers a snappy "mark Watered" loop; hold both choices against **all** roadmap forms/mutations (S-01–S-07), not just S-01.

## Summary

**The decisive finding is the shape of the write surface.** Across the whole MVP roadmap, the app has **exactly one reusable form** (add-plant, which edit-plant and season-intervals extend rather than multiply) and **five single-button action mutations** (mark Watered, Postpone, Undo, Delete plant, + parked account-delete). So:

- **A form library is a low-stakes, low-leverage decision** — it only touches one form shape.
- **The load-bearing "snappy" concern is optimistic UI + undo on the single-button actions**, exactly where a form library does nothing. S-04 explicitly requires undo-after-misclick.

**Recommendations:**

1. **Form library → TanStack Form** (`@tanstack/react-form`). It is a defensible, good fit — but for a *different reason* than its usual reputation. The app's UI base is **react-aria-components** (shadcn "aria-nova"), whose inputs are **controlled**. TanStack Form is controlled-native and consumes Zod directly via Standard Schema (no resolver package), so react-aria fields wire cleanly. React Hook Form's headline advantage (uncontrolled/ref performance) is neutralized here because every react-aria field would need a `Controller` wrapper anyway. **Zero-dependency alternative worth acknowledging:** for a single 3–4 field form, native React 19 (`useActionState` + Astro Actions) needs no form library at all. Given there is only one form, TanStack Form's cost is small and its ergonomics are the best fit — this matches the preference already recorded in `change.md`.

2. **Snappy/optimistic → No, Astro's default SSR-redirect model is not enough; but you do NOT need TanStack Query either.** Adopt **Tier 2: Astro Actions (typesafe server mutations + Zod) + React 19 `useOptimistic`/`useActionState` in islands, glued by `@astrojs/react`'s `withState()`.** This is **zero new dependencies** (`@astrojs/react`, `react@19`, and `astro/zod` are already installed), gives **true optimistic feedback with automatic rollback**, and fits Astro's islands model. Astro's *own* built-ins (Actions + `<ClientRouter>` view transitions) are a real upgrade over the current pattern but are **not** sufficient alone for "instant" — they still block on the network before the item moves; view transitions animate, they don't make the update optimistic. TanStack Query (Tier 3) is overkill for a single-list MVP and is an easy additive adoption later if cross-view caching ever becomes real.

## Detailed Findings

### Current state: 100% server-driven, zero React islands, zero optimism

Every form today is a native `<form method="post" action="/api/...">` posting `FormData` to an Astro SSR API route that validates with `astro/zod` and `context.redirect`s back with a `?error=` query param. There is **no `fetch()` anywhere in `src/`**, **no `client:*` directive anywhere**, and the only `.tsx` file (`button.tsx`) is imported solely for its `buttonVariants` CSS helper — never hydrated.

- Sign-in form + native POST: `src/pages/auth/signin.astro:15`
- Server validation + redirect-with-error pattern: `src/pages/api/auth/signin.ts:7-33`
- Error round-trip → mapper → banner: `src/lib/auth-errors.ts:1-19`, `src/components/auth-error-banner.astro`
- Hand-rolled per-page loading `<script>` (duplicated verbatim): `src/pages/auth/signin.astro:34-52`, `signup.astro:38-56`
- React integration wired but unused for rendering: `astro.config.mjs:12` (`integrations: [react(), sitemap()]`)

**Implication:** any React form library or optimistic UI is a *new pattern* for this codebase — the add-plant form and today's-list view become the first hydrated islands. That is an acceptable cost: "snappy/optimistic" inherently requires client JS, and the app is behind a session. The zero-JS SSR pattern can stay for the auth forms.

### The write surface (S-01 → S-07): one form, five actions

Derived from `context/foundation/roadmap.md:82-166` and `context/foundation/prd.md:72-123`:

| Slice | Write | Type | Notes |
| --- | --- | --- | --- |
| S-01 | Add plant (name, interval, optional photo) | **FORM** | The only genuine form in the north star (FR-004) |
| S-01/S-03 | Mark Watered | **ACTION** | Reschedules next = today + interval (FR-011) — the core snappy interaction |
| S-04 | Postpone 2 days | **ACTION** | Shift one task by exactly 2 days (FR-012) |
| S-04 | Undo | **ACTION** | Reverse last journaled action (FR-013) — classic optimistic/undo-toast |
| S-05 | Set growing + dormancy intervals | **FORM** | Extends add/edit-plant (FR-008), not standalone; blocked on ORQ-2 |
| S-06 | Edit plant | **FORM** | Same field shape as add-plant (FR-006) → shared form definition |
| S-07 | Delete plant | **ACTION** | One button + confirm dialog (FR-007) |

**Takeaway:** form-library leverage is concentrated in a single add/edit-plant form; the bulk of writes are one-button actions where optimistic UI + undo is the more load-bearing concern.

### UI primitives available

- `src/components/ui/` contains **only `button.tsx`** (exports `Button`, `LinkButton`, `buttonVariants`), wrapping **`react-aria-components`** (`src/components/ui/button.tsx:3-8`) — confirming the "React ARIA base, aria-nova variant" convention in `AGENTS.md:36`.
- Missing (would be added via `pnpm dlx shadcn@latest add …`): Input, TextField, Label, FieldError, Form, NumberField (for intervals), Checkbox/Select, Dialog (for delete confirm).
- The current auth field (`src/components/auth-field.astro`) is a plain Astro/HTML input, **not** a reusable React primitive — a React form stack introduces a new primitive family rather than extending this one.

### Form library comparison (TanStack Form vs React Hook Form vs native React 19)

| Dimension | TanStack Form | React Hook Form | Native React 19 |
| --- | --- | --- | --- |
| Input model | **Controlled-native** | Uncontrolled (refs); controlled via `Controller` | Controlled (your code) |
| Fit with react-aria-components (controlled) | **Direct** — `field.state.value` / `field.handleChange` | Needs a `Controller` render-prop wrapper **per field** | Direct but manual |
| Zod validation | **Standard Schema — pass Zod schema directly**, no extra pkg | Needs `@hookform/resolvers` (`zodResolver`) | Manual / server-side only |
| Bundle | Lightweight (slightly larger than RHF) | Smallest feature-complete | **0 bytes (no lib)** |
| Best for | Deeply nested/dynamic forms, end-to-end TS inference | General default; large ecosystem | Simple 2–4 field forms |
| React 19 fit | Good | Works with `useActionState`/`useFormStatus`; has progressive-enhancement `<Form action>` | Native |

- TanStack Form + Standard Schema (Zod directly): confirmed in TanStack Form docs — Zod/Valibot/ArkType pass straight to `validators` with no resolver package.
- TanStack Form binds controlled UI-lib inputs via the `Field` render prop (`state.value` + `handleChange`) — the exact wiring react-aria-components needs.
- RHF's `Controller` (`react-hook-form.com/docs/usecontroller/controller`) is the documented bridge for controlled components (React-Select/AntD/MUI/**react-aria**) — necessary here on every field, which erases RHF's uncontrolled-perf edge.
- 2026 community consensus: RHF remains the general default (smallest, largest userbase, best adapters); **TanStack Form is the recommended pick when you value end-to-end TS inference or are in the TanStack ecosystem.** Because this app's inputs are controlled anyway and there is only one form, the RHF "default" advantage does not materialize — making TanStack Form the better *fit* and validating the `change.md` preference.

**Why not RHF here:** its main win (uncontrolled/ref performance, fewer re-renders) is nullified by the controlled react-aria base, and it adds a resolver dependency — so you'd take RHF's costs without its benefit.

### Optimistic-UX tiers (full spectrum)

**Tier 1 — Astro-native only: Astro Actions + `<ClientRouter>` view transitions.**
- Astro Actions (`defineAction` + `input: z.object(...)`) give typesafe server mutations with Zod, callable as RPC from a client `<script>`/island (`{ data, error }` return) — a strict upgrade over the current API-route + `?error=` redirect pattern, and they support progressive enhancement via `<form action={actions.x}>`.
- `<ClientRouter />` (`astro:transitions`) adds SPA-like navigation + view-transition animation.
- **Verdict: necessary groundwork, not sufficient for "instant."** The mark-Watered still round-trips before the item leaves today's list; view transitions animate the change, they don't remove the wait. Good complementary polish, not the optimism mechanism.

**Tier 2 — React 19 primitives on top of Astro Actions (RECOMMENDED).**
- `@astrojs/react` ships **`withState()`** which wires an Astro Action straight into React 19's `useActionState()` — documented in the Astro React integration guide (the `Like` button example: `useActionState(withState(actions.like), initial)` → `[state, action, pending]`).
- Pattern for the watering loop: the today's-list island renders tasks; "Watered"/"Postpone"/"Delete" use **`useOptimistic`** to immediately reschedule/remove the row, while `useActionState` (via `withState`) calls the Astro Action; on server response React reconciles, and on error the optimistic state auto-reverts. `useFormStatus`/`pending` drives per-button disabled/spinner (replacing the hand-rolled auth `<script>`s).
- **Zero new dependencies.** Typesafe end-to-end (Zod input in the Action, inferred output in the island).
- **Verdict: the sweet spot** — true optimistic feedback + rollback, fits Astro islands, no bundle cost beyond what hydrating the one list island already implies.

**Tier 3 — TanStack Query (`useMutation` optimistic).**
- Canonical pattern (`onMutate` → `cancelQueries` + `setQueryData` snapshot; `onError` → restore snapshot; `onSettled` → `invalidateQueries`) is powerful for many interdependent mutations, background refetch, and cross-view cache.
- **Cost in Astro islands:** each island is isolated, so the query cache does **not** persist across full-page navigations unless the app collapses into one large island (fighting Astro's model). Needs a `QueryClientProvider` and a new dependency.
- **Verdict: overkill for a single-list MVP.** Reserve for later if cross-view caching/refetching becomes real — it layers on additively without reworking Tier 2's Actions.

## Code References

- `src/pages/auth/signin.astro:15,34-52` — current native-POST form + hand-rolled loading script
- `src/pages/api/auth/signin.ts:7-33` — `astro/zod` `safeParse` → `context.redirect(?error=)` pattern (the pattern Astro Actions would replace)
- `src/lib/auth-errors.ts:1-19` — error-string mapper
- `src/components/auth-field.astro:36-46` — plain Astro/HTML input (not a React primitive)
- `src/components/ui/button.tsx:3-8` — the only React UI primitive; wraps `react-aria-components`
- `astro.config.mjs:12` — `react()` integration installed, currently unused for rendering
- `AGENTS.md:36` — shadcn "React ARIA base, aria-nova variant" convention
- `context/foundation/roadmap.md:82-166` — S-01–S-07 slice definitions
- `context/foundation/prd.md:72-123` — FR-004/006/007/008/011/012/013 backing the write surface

## Architecture Insights

- **Two problems, two tools — do not conflate them.** Forms (add/edit-plant) → TanStack Form. Actions (Watered/Postpone/Undo/Delete) → `useOptimistic` + Astro Action. The form library never touches the snappy path; the optimistic layer never needs the form library.
- **Astro Actions are the shared server substrate** for both, replacing the ad-hoc API-route + `?error=` redirect convention with typesafe `{ data, error }` returns and progressive-enhancement support.
- **`withState()` is the linchpin** that lets Astro Actions drive React 19's `useActionState`, so Tiers 1 and 2 are the *same* stack at different fidelity — you get Astro's typesafety and React's optimism together, no third library.
- **Islands boundary is a real design decision:** hydrate the today's-list view and the add/edit-plant form; keep auth forms as zero-JS SSR. Don't hydrate the whole app (that's the only thing that would push you toward TanStack Query prematurely).
- **RLS/interval-math determinism (the slice's core risk) is unaffected** by these choices — optimism is a client-render concern; the Astro Action handler remains the single source of truth that the optimistic state reconciles against.

## Historical Context (from prior changes)

- `context/changes/core-watering-loop/change.md` — Notes: "use tanstack form to ease working with forms." This research **confirms** that pick (for the react-aria/controlled-fit reason) while clarifying it is a low-leverage decision.
- `context/foundation/tech-stack.md:15-19` — stack flags `has_realtime: false`, `has_background_jobs: false`; the season switch is read-time date math, not a job — consistent with keeping the client data layer minimal (no TanStack Query).
- `context/foundation/roadmap.md:82-92` — S-01 "north star," heaviest slice; carries the determinism verification. `roadmap.md:118-128` — S-04 explicitly requires undo-after-misclick (the optimistic/undo motivation).

## Related Research

- None yet under `context/changes/**/research.md`. This is the first research artifact for `core-watering-loop`.

## Open Questions

- **File upload for the optional plant photo (FR-004/006):** which storage path (Supabase Storage) and does the add-plant form submit multipart via the Astro Action, or a separate upload step? Not blocking the library/optimism decision, but shapes the add-plant form implementation.
- **Undo affordance (S-04):** toast-with-undo vs inline — decided later in S-04, but the Tier-2 `useOptimistic` choice already supports either.
- **Whether to adopt `<ClientRouter>` now** (Tier 1 polish) or defer: cheap to add, but orthogonal to the optimistic core; recommend deferring to a UX-polish pass.
