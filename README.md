# YAPCA (Yet Another Plant Care App)

Track when each of your plants needs watering. Built for a single hobbyist tending tens of plants at home: answer "what needs watering today?" without holding every plant's cadence in your head.

## What it does

- **One list, every morning** — see exactly which plants need watering today.
- **Waters on their schedule, not yours** — each plant drinks more in growth, less in rest; YAPCA adjusts as the seasons turn.
- **Tap and forget** — mark it watered, it comes back right on time. No drift, no math.
- **Never lose a plant to a bad memory** — overdue plants stay flagged until you get to them.

## Tech stack

Astro · React 19 islands · TypeScript 5 · Tailwind 4 · shadcn/ui · Supabase · Cloudflare Workers. Node 22.14.0 (`.nvmrc`).

shadcn/ui uses `b7BFbwzXk` preset with React ARIA as base.

## Local setup

Requires [Docker](https://www.docker.com/) for the local Supabase stack.

```bash
cp .env.example .env          # Node
pnpx supabase start           # prints SUPABASE_URL + anon key on first run
```

Copy the printed `SUPABASE_URL` and anon `SUPABASE_KEY` into `.env`:

```
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_KEY=<anon key from CLI output>
```

For a hosted project instead, use its Project URL and `anon` public key (dashboard → Settings → API).

Email confirmation is enabled by default locally (production-parity). Confirmation links redirect to `/auth/signin`. To sign in immediately after sign-up during local dev, disable email confirmation temporarily in Studio (`http://localhost:54323`) → **Authentication → Email → Confirm email** (remember to restore it before Phase 3 verification).

```bash
pnpm dev
```

Auth uses Supabase's built-in `auth.users`. Application tables (plants, tasks) live in `supabase/migrations/`.

### Hosted Supabase Setup

For a hosted Supabase project:

1. In the Supabase dashboard, navigate to **Authentication → Email → Confirm email** and enable it.
2. Set the **Site URL** to your deployed origin with the path `/auth/signin`, e.g., `https://yapca.mlmmn.workers.dev/auth/signin`.
3. Verify the **Confirm signup template** retains the default `{{ .ConfirmationURL }}` link (no edits needed).

## Scripts

- `pnpm dev` — dev server (Cloudflare workerd runtime)
- `pnpm build` / `pnpm preview` — production build / preview
- `pnpm lint` / `pnpm lint:fix` — ESLint (type-checked)
- `pnpm format` — Prettier

## Deploy

```bash
pnpm build
pnpx wrangler deploy
```

Set `SUPABASE_URL` and `SUPABASE_KEY` as Worker secrets via `npx wrangler secret put` or the Cloudflare dashboard.
