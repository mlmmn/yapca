# Deployment Record — YAPCA on Cloudflare Workers

## Context

`context/foundation/infrastructure.md` selects **Cloudflare Workers** as the
target and its "Getting Started" section is the runbook; `tech-stack.md`
confirms Astro 6 + `@astrojs/cloudflare` on workerd with Supabase auth.

Goal: get the app live on a `*.workers.dev` URL via a **manual** `wrangler deploy`, backed by the
user's **hosted Supabase** project so auth works. Per decision: **no GitHub Actions / CI wiring**
this pass — deploy stays manual.

## Historical first-deploy baseline

The following describes the initial deployment plan and the application state
at that time. It is retained as an operational record, not a description of
the current app.
- Adapter/config correct: `output: "server"`, `@astrojs/cloudflare` v13, and `wrangler.jsonc`
  already has `compatibility_flags: ["nodejs_compat"]` + `compatibility_date: "2026-05-08"` and
  `observability.enabled` — the load-bearing baseline from the risk register is present.
- Cloudflare authenticated (`wrangler whoami` OK); GitHub repo `mlmmn/yapca` exists.
- App was a skeleton: `src/pages/index.astro` rendered "yapca"; auth API routes
  (`src/pages/api/auth/{signin,signup,signout}.ts`) exist; `PROTECTED_ROUTES` is empty; no
  migrations. `src/lib/supabase.ts` returns `null` when env is unset (graceful).

The remaining gap for that first deploy was the starter Worker name and the
hosted Supabase secrets.

## Verified current state — 2026-07-26

The current production app is deployed at
`https://yapca.mlmmn.workers.dev`. It includes the current UI, protected
routes, applied migrations, and middleware date resolution. The historical
skeleton description above must not be used to assess the live app.

Production deployment remains a manual `pnpx wrangler deploy` operation.
Rollback remains code-only with `pnpx wrangler rollback [<version-id>]`; it
does not revert database changes. Automated deployment is intentionally out
of scope for this record.

## Out of scope

- `.github/workflows/ci.yml` — currently targets `master` (repo default is
  `main`) and uses `npm`. It will not trigger and remains untouched because
  no GitHub Actions work is in scope.
- Automated deploy jobs, preview deploys, Cloudflare API tokens, and GitHub
  deployment secrets.

## Phase 1 — Prep & config

- [x] Collect hosted Supabase **Project URL** + **anon public key** (dashboard → Settings → API).
      Kept out of git; set as Worker secrets in Phase 3.
- [x] Rename the Worker in `wrangler.jsonc`: `"name": "10x-astro-starter"` → `"name": "yapca"`
      (determines the hostname `yapca.<subdomain>.workers.dev`). Single-line edit.

## Phase 2 — Build

- [x] Run `pnpm build` — produces `./dist`. `astro:env` `SUPABASE_*` fields are `optional`, so the
      build succeeds without local secrets. Build must be clean before proceeding. _(Clean; ~3.5s.
      Adapter auto-enabled `IMAGES` + KV `SESSION` bindings. Harmless sitemap warning: no `site`
      option set.)_

## Phase 3 — Secrets & deploy

- [x] Confirm Cloudflare auth: `pnpx wrangler whoami` (already logged in).
- [x] `pnpx wrangler secret put SUPABASE_URL` (creates the Worker if absent).
- [x] `pnpx wrangler secret put SUPABASE_KEY`.
      (anon key is designed to be publishable + RLS-protected; if you'd rather not paste it, run
      these two yourself via the `! <cmd>` prompt.)
- [x] `pnpx wrangler deploy` → capture the live `*.workers.dev` URL.
      **Live: https://yapca.mlmmn.workers.dev**

## Phase 4 — Verify

- [x] `pnpx wrangler deployments list` shows the new version.
- [x] `curl -sS https://yapca.mlmmn.workers.dev/` returns 200 with the "yapca" index HTML.
- [x] Auth round-trip: POST to `/api/auth/signin` (or use the sign-in form) with a test user from
      the hosted project; confirm a Supabase auth cookie is set and a follow-up request resolves
      `context.locals.user`. Per infra risk register, sanity-check first-render latency against the
      *remote* Supabase (dev hides cross-region latency). _(Verified via negative path: bogus creds
      → `Invalid login credentials`, proving env → `@supabase/ssr` → remote GoTrue → real response.
      Positive cookie-set path left for a real test user.)_
- [x] `pnpx wrangler tail` shows no `nodejs_compat`/`@supabase/ssr` runtime errors on first requests.

## Operational notes / risks (from infrastructure.md)

- Rollback is `pnpx wrangler rollback [<version-id>]` (last 100 versions) — code only, not DB.
- Retained logs aren't on by default; `wrangler tail` is live-only.
- Future deployment automation requires a separate, explicitly authorised
  change.
