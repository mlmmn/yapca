---
project: YAPCA (Yet Another Plant Care App)
researched_at: 2026-07-19
recommended_platform: Cloudflare Workers
runner_up: Vercel
context_type: mvp
tech_stack:
  language: TypeScript / JavaScript
  framework: Astro 6 (SSR) + React 19 islands
  runtime: Cloudflare Workers (workerd)
---

## Recommendation

**Deploy on Cloudflare Workers.**

Cloudflare Workers is already the stack's first-class deployment target (`@astrojs/cloudflare`, `output: "server"`, GitHub Actions auto-deploy-on-merge), and every constraint from the interview reinforces it: it is the cheapest option for a mostly-idle low-QPS personal app (no idle billing — 100k requests/day free, $5/mo only if you outgrow that), you already know Cloudflare, it is edge-native, and it is content to keep DB/auth/storage external on Supabase. It scored a clean 5/5 on the agent-friendly criteria — full `wrangler` CLI coverage (`deploy`/`rollback`/`tail`), managed edge isolates, `llms.txt` + markdown docs, a deterministic deploy API, and first-party MCP servers. Astro 6 makes the local loop faithful too: `astro dev` now runs the real `workerd` runtime, so dev mirrors production.

## Platform Comparison

Hard filter applied first: the app needs **no persistent server-side connections** (`has_realtime: false`, `has_background_jobs: false`; the growing/dormancy season switch is date-derived at read time, not a scheduled job). No serverless platform is dropped on that basis. Interview weights then applied: **minimize cost**, **Cloudflare-familiar**, **single region is fine**, **external services fine (Supabase)**.

| Platform | CLI-first | Managed / serverless | Agent-readable docs | Stable deploy API | MCP / integration | Total |
|---|---|---|---|---|---|---|
| **Cloudflare Workers** | Pass | Pass | Pass | Pass | Pass | **5 Pass** |
| Vercel | Pass | Pass | Pass | Pass | Partial | 4 Pass / 1 Partial |
| Netlify | Pass | Pass | Pass | Pass | Pass | 5 Pass* |
| Fly.io | Pass | Partial | Pass | Pass | Partial | 3 Pass / 2 Partial |
| Railway | Pass | Pass | Partial | Pass | Partial | 3 Pass / 2 Partial |
| Render | Partial | Pass | Pass | Partial | Partial | 2 Pass / 3 Partial |

Per-platform notes:

- **Cloudflare Workers** — Full CLI loop via `wrangler` (`deploy`, `rollback` to any of the last 100 versions, live `tail`). Managed edge isolates with near-zero cold starts; no OS surface to misconfigure. Docs published as `llms.txt` and markdown on GitHub. Deterministic one-command deploy. First-party MCP servers across docs, Workers, and observability. Cost model is uniquely suited to a low-QPS app: you don't pay for idle, unlike any container PaaS.
- **Vercel** — Excellent DX and the best serverless cold starts in the group (V8 isolates). Full `vercel` CLI, MDX docs on GitHub, deterministic `vercel --prod`. MCP is OAuth-backed but **beta** as of 2026 (Partial). Per-invocation billing is less cost-optimal than Workers' no-idle model, and the free tier forbids monetization. Strong runner-up.
- **Netlify** — Clean CLI, good docs, deterministic deploys, and an **official Netlify MCP server** (a genuine edge on criterion 5). But independent 2026 measurements put Astro **SSR cold starts at 800ms–1.5s** on Netlify Functions after idle — a direct threat to the "daily list renders well under one second" NFR for the first hit.
- **Fly.io** — `flyctl` is strong and multi-region is real, but it leans toward container/VM management (more raw than pure serverless — Partial) and **removed its free tier for new accounts (Oct 2024)**; pure pay-as-you-go means paying for idle. Conflicts with "minimize cost."
- **Railway** — Great DX and full CLI, but **no free tier since 2023** ($5/mo Hobby + per-second metering). Same idle-billing problem for a mostly-idle app. Docs are thinner as agent-readable source (Partial).
- **Render** — Has a real free tier, but free web services **spin down after 15 min idle with a ~1-minute cold start** — fatal to the sub-second NFR. Deploy is hook/API-driven rather than a first-class CLI (Partial on two criteria).

### Shortlisted Platforms

#### 1. Cloudflare Workers (Recommended)

Wins on every weighted dimension: cheapest for low QPS (no idle billing, generous free tier), already the stack target with first-class Astro 6 tooling, edge-native, and familiar to the builder. Clean 5/5 on agent-friendliness. The local `workerd` dev runtime closes the dev/prod gap that used to make Cloudflare harder to develop against.

#### 2. Vercel

The strongest alternative on developer experience and cold-start latency. It loses to Cloudflare on cost (per-invocation vs. no-idle), on the monetization restriction in its free tier, and on a still-beta MCP. It would also mean swapping the adapter and deploy pipeline away from the stack's current Cloudflare wiring.

#### 3. Netlify

Notable for its official MCP server and a monetizable free tier. The gap versus the recommendation is the measured Astro SSR cold-start range (800ms–1.5s), which puts the product's headline "instant daily list" NFR at risk on first requests — a poor trade for a plant-care app whose whole value is the fast daily glance.

## Anti-Bias Cross-Check: Cloudflare Workers

### Devil's Advocate — Weaknesses

1. **Single-region Supabase nullifies the edge advantage.** Workers run at the PoP nearest each user, but DB/auth/storage sit in one Supabase region. Every SSR render of the daily list is bound by the Worker→Postgres round-trip across that gap — the list's speed is Supabase latency, not Cloudflare's.
2. **`workerd` is not Node.** Dependencies reaching for Node built-ins (`fs`, some `crypto`, `Buffer` edge cases) can fail at runtime unless `nodejs_compat` and a recent `compatibility_date` are set. `@supabase/ssr` works, but the failure mode is a cryptic runtime error, not a build error.
3. **Free-plan 10ms CPU limit.** SSR-ing React islands plus auth work can bump the limit, pushing you to the $5/mo plan earlier than "free forever" implies (waiting on Supabase is wall-clock, not CPU — but the compute itself still counts).
4. **Pages→Workers documentation churn.** Many Astro-on-Cloudflare tutorials are Pages-era and now subtly wrong; the adapter's v13 unified-entrypoint change moved what "correct" config looks like.
5. **Authed pages forfeit CDN caching.** Cookie-session SSR makes every logged-in route dynamic, so Cloudflare's global-CDN selling point mostly doesn't apply behind login.

### Pre-Mortem — How This Could Fail

The team shipped Astro + Supabase on Workers assuming "edge = fast." Supabase lived in one region; every render of the daily task list fired 2–3 sequential Postgres queries across a transatlantic hop from whatever PoP served the user. The sub-second NFR held perfectly in local dev — because `astro dev` (workerd) and local Supabase sat on the same laptop — and only degraded to 1.5–2.5s in production for distant users. The 10ms CPU limit looked like the culprit, so they bought the paid plan; it changed nothing, because they were waiting on I/O, not burning CPU. Hyperdrive helped Postgres wire latency but not geographic distance. RLS-heavy queries added more. Because auth cookies made every route dynamic, the edge CDN cached nothing. Undoing it meant co-locating compute near the DB (i.e. leaving Workers) or adding a caching layer they'd explicitly cut from scope. Six months in, "instant" felt sluggish — a production-only problem their dev loop had structurally hidden.

### Unknown Unknowns

- **Local dev hides remote-DB latency.** Astro 6's workerd dev server is a fidelity win, but pointed at local Supabase it makes production's cross-region DB latency invisible. Test the daily list against a real remote Supabase early.
- **`nodejs_compat` + `compatibility_date` are load-bearing.** `@supabase/ssr` and similar deps need them in `wrangler` config; omit them and you get runtime errors the Astro quickstart won't warn about.
- **`wrangler tail` is live-only.** Historical/persistent logs require Workers Logs or Logpush to be enabled — post-incident debugging is harder than on a Node platform with retained logs by default.
- **Pin the Supabase region near your users.** This single config choice dominates the sub-second NFR more than anything on the Cloudflare side.
- **Cron exists but isn't the season switch.** The date-derived season is read-time (correct). If reminders ever return (a current non-goal), Workers Cron Triggers have their own semantics — a post-MVP note.

## Operational Story

- **Preview deploys**: `wrangler versions upload` publishes a non-production **preview URL** (a versioned `*.workers.dev` alias) without shifting production traffic; wire it into the GitHub Actions PR job so each PR gets a preview build. Fork PRs won't have access to repo secrets — preview builds for external forks either skip or run without bindings. For authed previews, gate the preview hostname behind Cloudflare Access.
- **Secrets**: Runtime secrets live in **Workers Secrets** (`wrangler secret put SUPABASE_KEY`), never in `wrangler.jsonc`. CI needs a scoped **Cloudflare API token** stored in **GitHub Actions Secrets** for `wrangler deploy`. `SUPABASE_URL`/`SUPABASE_KEY` are declared in `astro.config.mjs` `env.schema` and read via `astro:env/server`. Rotate the Supabase key in the Supabase dashboard, then `wrangler secret put` the new value; rotate the CF API token in the Cloudflare dashboard and update the GitHub secret.
- **Rollback**: `wrangler rollback [<version-id>]` reverts to a prior version (last 100 retained); time-to-revert is seconds. Caveat: rollback reverts **code only** — a database migration that already ran against Supabase does **not** roll back with it. Treat schema changes as forward-only and keep them backward-compatible across a deploy.
- **Approval**: An agent may run `wrangler dev`/`astro dev`, build, upload preview versions, and read logs unattended. A human should approve: promoting to production (the merge-to-`main` that triggers auto-deploy), rotating the primary Supabase key or CF API token, and any destructive migration (drop/alter) against Supabase.
- **Logs**: `wrangler tail` streams live runtime logs (requests + `console.log`) to the terminal read-only — the agent's primary observability tool. GitHub Actions run logs are readable via `gh run view --log`. For retained/historical logs, enable Workers Logs or Logpush (not on by default).

## Risk Register

| Risk | Source | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Cross-region Worker→Supabase latency breaks the sub-second daily-list NFR in production | Pre-mortem / Devil's advocate | M | H | Pin Supabase to the region nearest the user; benchmark the list against remote Supabase early (not local); minimize sequential queries; consider Hyperdrive only if wire latency (not distance) dominates |
| Dev loop hides prod DB latency (workerd + local Supabase both local) | Unknown unknowns | H | M | Add a staging check that hits a real remote Supabase; measure p75 list render before calling the NFR met |
| `workerd` ≠ Node — dep uses an unsupported Node API and fails at runtime | Devil's advocate | M | M | Set `nodejs_compat` + a recent `compatibility_date` in `wrangler.jsonc`; smoke-test each new dependency under `astro dev` (workerd), not just typecheck |
| Missing `nodejs_compat`/`compatibility_date` yields cryptic `@supabase/ssr` runtime errors | Unknown unknowns | M | M | Set both from day one; treat them as required baseline config, documented in AGENTS.md |
| Free-plan 10ms CPU limit forces an earlier move to the $5/mo plan | Research finding / Devil's advocate | L | L | Accept $5/mo as the real MVP floor; keep SSR light; the cost is trivial and still beats idle-billed PaaS |
| Following Pages-era tutorials produces wrong adapter/deploy config | Devil's advocate | M | L | Follow only `@astrojs/cloudflare` v13+ and current Workers docs; ignore Pages-specific guides |
| Rollback reverts code but not an already-applied DB migration | Operational (rollback) | M | H | Keep migrations forward-only and backward-compatible; never couple a code rollback to a schema change that can't coexist with the prior version |
| No retained logs by default — hard to debug a past incident | Unknown unknowns | L | M | Enable Workers Logs/Logpush before launch if post-hoc debugging matters |
| Authed pages are all dynamic — edge CDN caching gives the logged-in app little | Devil's advocate | H | L | Expected for a cookie-session app; rely on fast SSR + regional DB rather than CDN caching; acceptable at MVP scale |

## Getting Started

Version-accurate for Astro 6 + `@astrojs/cloudflare` v13+ (pnpm; do not use npm per project rules):

1. **Confirm the adapter and config.** Ensure `@astrojs/cloudflare` is v13+ and `astro.config.mjs` has `output: "server"` with the Cloudflare adapter. In `wrangler.jsonc`, set `compatibility_flags: ["nodejs_compat"]` and a recent `compatibility_date` — required for `@supabase/ssr` on `workerd`.
2. **Develop with runtime fidelity — no separate `wrangler dev` needed.** Run `pnpm dev` (`astro dev`); in Astro 6 it uses the Cloudflare Vite plugin and the real `workerd` runtime, so local matches production. Use `pnpm build && pnpm preview` for a production-shaped local check.
3. **Authenticate and set secrets.** `pnpm dlx wrangler login`, then `pnpm dlx wrangler secret put SUPABASE_URL` and `... SUPABASE_KEY`. Create a scoped Cloudflare API token and add it to GitHub Actions Secrets for CI.
4. **First deploy.** `pnpm build` then `pnpm dlx wrangler deploy` — returns the live `*.workers.dev` URL. Verify the daily-list route renders and auth cookies round-trip.
5. **Wire CI (auto-deploy on merge).** GitHub Actions job runs `pnpm install && pnpm build && wrangler deploy` on merge to `main` (per the stack's `ci_default_flow`); add a PR job that runs `wrangler versions upload` for preview URLs.

## Out of Scope

The following were not evaluated in this research:
- Docker image configuration
- CI/CD pipeline setup (only the deploy/preview command surface is noted, not the full pipeline)
- Production-scale architecture (multi-region failover, HA, DR)
