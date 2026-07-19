# AGENTS.md

YAPCA (Yet Another Plant Care App): Astro 6 SSR app, React 19 islands, Tailwind 4, Supabase auth, shadcn/ui. Deployed to Cloudflare Workers.

## Hard rules

- **Package manager is `pnpm`** — never `npm` (pnpm-lock.yaml, no package-lock.json).
- **Always enable RLS on new tables**, with granular per-operation, per-role policies.
- **API routes must `export const prerender = false`** (full SSR — `output: "server"`).

## Commands

Scripts live in `@package.json` (`pnpm` dev/build/preview/lint/format); build/preview go through `@astrojs/cloudflare` on the **workerd** runtime. Two commands are _not_ package.json scripts:

- `pnpx supabase start` — local Supabase stack (requires Docker); prints `SUPABASE_URL` + anon key.
- `pnpm dlx shadcn@latest add [name]` — install a shadcn/ui component.

Pre-commit (husky + lint-staged): `eslint --fix` on `*.{ts,tsx,astro}`, `prettier --write` on `*.{json,css,md}`.

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
