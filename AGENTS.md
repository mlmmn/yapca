# AGENTS.md

YAPCA (Yet Another Plant Care App): Astro 6 SSR app, React 19 islands, Tailwind 4, Supabase auth, shadcn/ui. Deployed to Cloudflare Workers.

## Hard rules

- **Package manager is `pnpm`** — never `npm` (pnpm-lock.yaml, no package-lock.json).
- **Always enable RLS on new tables**, with granular per-operation, per-role policies.
- **API routes must `export const prerender = false`** (full SSR — `output: "server"`).
- **Never create a git branch unless explicitly asked to.**
- **All filenames use kebab-case** — every module (Astro, React, TypeScript, etc.) follows kebab-case naming regardless of extension (e.g. `auth-field.astro`, `confirm-email.astro`, `auth-errors.ts`, not `AuthField.astro` or `authErrors.ts`).
- **Never modify global eslint or prettier config** — unless explicitly asked. Report config issues instead of fixing them unilaterally.
- **Never use `@ts-ignore`** – unresolvable TypeScript issues can be marked with `@ts-expect-error` comment with a Why-comment.
- **Ask for permission before adding eslint ignore comment** – the only exception are console calls.
- **Every component lives in its own folder, no exceptions** — never a bare component file next to its siblings. This applies from the moment the component is created, even if the folder holds nothing but the component file and its barrel.

## Commands

Scripts and lint-staged configuration live in `@package.json`; build/preview go through `@astrojs/cloudflare` on the **workerd** runtime. Two commands are _not_ package.json scripts:

- `pnpx supabase start` — local Supabase stack (requires Docker); prints `SUPABASE_URL` + anon key.
- `pnpm dlx shadcn@latest add [name]` — install a shadcn/ui component.

## Setup gotchas

Local setup, env vars, and the "disable Confirm email" step live in `@README.md`.

## Architecture

- **Auth**: `src/lib/supabase.ts` creates a `@supabase/ssr` cookie-session client, reading `SUPABASE_URL`/`SUPABASE_KEY` via `astro:env/server` (declared in astro.config.mjs `env.schema`). `src/middleware.ts` runs on every request, resolves the user onto `context.locals.user`, and redirects unauthenticated users away from `PROTECTED_ROUTES`.

## Conventions

- **Path alias**: `@/*` → `./src/*`.
- **Astro components** for static content/layout; **React** only when interactivity is needed. No Next.js directives (`"use client"` etc.).
- **Class names**: use `cn()` from `@/lib/utils` for conditional/merged classes — never concatenate class strings manually.
- **shadcn/ui**: React ARIA as base, "aria-nova" variant, components in `src/components/ui/`.
- **API routes**: uppercase `GET`/`POST` exports; validate input with zod.
- **Migrations**: `supabase/migrations/`, named `YYYYMMDDHHmmss_short_description.sql`. _(RLS requirement in Hard rules.)_
- **React hooks** → `src/components/hooks/`. **Services/helpers** → `src/lib/` (or `src/lib/services/`). **Shared types** (entities, DTOs) → `src/types.ts`.
- **Declare `const`/`let` bindings at the top of their enclosing block whenever possible** — group declarations before the logic that uses them, rather than interleaving them with statements. Applies within any block (function bodies, `if`/`else` branches, loop bodies), not just top-level component bodies; where it conflicts with early returns, the guard clause still comes first and each subsequent block declares its own variables at its top.

## Component Structure

- **One component per module** — a file exports exactly one component.
- **One folder per component**, with a barrel (`index.ts`) re-exporting the component. If the component has its own types, they go in `types.ts` inside that folder. Helper functions and constants used only by that component go in one shared `utils.ts` (or `constants.ts` for constants, if that split reads cleaner) inside that folder — do not give each function its own file; if reused elsewhere, they move to `src/components/hooks/` or `src/lib/` per the Conventions section below.
- **Inside a component function body, order statements as**:
  1. Non-void hooks (hooks that return a value: `useState`, `useMemo`, `useRef`, custom hooks with a return value, etc.).
  2. Nested function declarations (event handlers, derived-value helpers local to this component).
  3. Void hooks (hooks with no return value, e.g. `useEffect`, `useLayoutEffect`).
  4. `return`.
- **Prefer early returns** over nested conditionals — guard clauses at the top of the function body over wrapping the rest in an `if`.
- **Use blank lines to separate logical groups of statements** (e.g. between the hooks block, the handlers block, and the return) rather than writing the function body as one dense block.

## Naming

- **Function names start with a verb naming the action performed**, e.g. `getUser()`, `formatString()`, `isToday()`, `hasAccess()`, `fetchAds()`. This applies to every callable, including predicates that return a boolean.
- **Non-function names (variables, properties, class fields) never start with a verb.** In particular, a boolean value is never prefixed with `is`/`has`/`should`/etc. — those prefixes are reserved for functions. Name the value after the state it represents (`active`, `visible`, `loading`), not the check that produces it. Rule of thumb: a leading verb means "this is called"; a noun/adjective means "this is a value."

## Design Context

The strategic design brief lives in `@PRODUCT.md`; the visual system specification lives in `@DESIGN.md`. Read both before building UI. Load-bearing constraints: overdue cues are never color-only, and reduced-motion support is first-class.

## Mutation testing

Repo uses Stryker for selective mutation testing on risk-critical modules.
Run it only for code covered by the current change or a risk from test-plan.md,
prefer narrowed scope with --mutate "path/to/file.ts:start-end", and do not chase
100% mutation score. Survived mutants should be reviewed one by one: add an
assertion only when the mutant represents a user-visible or business-relevant bug.
