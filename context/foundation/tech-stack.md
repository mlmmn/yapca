---
starter_id: 10x-astro-starter
package_manager: pnpm
project_name: yapca
hints:
  language_family: js
  team_size: solo
  deployment_target: cloudflare-workers
  ci_provider: github-actions
  ci_default_flow: auto-deploy-on-merge
  bootstrapper_confidence: first-class
  path_taken: standard
  quality_override: false
  self_check_answers: null
  has_auth: true
  has_payments: false
  has_realtime: false
  has_ai: false
  has_background_jobs: false
---

## Why this stack

A solo builder shipping a plant-care MVP in a 3-week after-hours budget with email+password accounts and optional plant photos needs a battle-tested, agent-friendly starter that hands over auth, database, and file storage without assembly. The 10x Astro Starter (Astro + React + TypeScript + Supabase + Cloudflare) is the recommended default for `(web, js)` and clears all four agent-friendly gates. Its Supabase layer covers accounts (FR-001–003) and plant-photo storage (FR-004/006), while TypeScript-first contracts suit the deterministic interval-math guardrails the PRD leans on. Auth is flagged; payments, realtime, AI, and background jobs are out per the PRD's non-goals — the automatic season switch is date-derived at read time, not a scheduled job. Deployment lands on Cloudflare Workers (via `@astrojs/cloudflare`), since Cloudflare Pages is deprecated for new projects and Workers is the current target; CI runs on GitHub Actions with auto-deploy on merge, the shipping-first shape that fits a solo cadence. Bootstrapper confidence is first-class, so scaffolding should be smooth with only occasional manual touch-ups. Package manager is pnpm (overriding the starter card's npm default — safe here because the starter clones and runs `<pm> install`); pin it in package.json via `"packageManager": "pnpm@11.13.1"` and remove the shipped npm lockfile after the initial `pnpm install`.
