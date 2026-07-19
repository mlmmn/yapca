---
bootstrapped_at: 2026-07-19T00:03:13Z
starter_id: 10x-astro-starter
starter_name: 10x Astro Starter (Astro + Supabase + Cloudflare)
project_name: yapca
language_family: js
package_manager: pnpm
cwd_strategy: git-clone
bootstrapper_confidence: first-class
phase_3_status: ok
audit_command: npm audit --json
---

## Hand-off

```yaml
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
```

### Why this stack

A solo builder shipping a plant-care MVP in a 3-week after-hours budget with email+password accounts and optional plant photos needs a battle-tested, agent-friendly starter that hands over auth, database, and file storage without assembly. The 10x Astro Starter (Astro + React + TypeScript + Supabase + Cloudflare) is the recommended default for `(web, js)` and clears all four agent-friendly gates. Its Supabase layer covers accounts (FR-001–003) and plant-photo storage (FR-004/006), while TypeScript-first contracts suit the deterministic interval-math guardrails the PRD leans on. Auth is flagged; payments, realtime, AI, and background jobs are out per the PRD's non-goals — the automatic season switch is date-derived at read time, not a scheduled job. Deployment lands on Cloudflare Workers (via `@astrojs/cloudflare`), since Cloudflare Pages is deprecated for new projects and Workers is the current target; CI runs on GitHub Actions with auto-deploy on merge, the shipping-first shape that fits a solo cadence. Bootstrapper confidence is first-class, so scaffolding should be smooth with only occasional manual touch-ups. Package manager is pnpm (overriding the starter card's npm default — safe here because the starter clones and runs `<pm> install`); pin it in package.json via `"packageManager": "pnpm@11.13.1"` and remove the shipped npm lockfile after the initial `pnpm install`.

## Pre-scaffold verification

| Signal      | Value                                                      | Severity | Notes                                                                          |
| ----------- | ------------------------------------------------------------ | -------- | --------------------------------------------------------------------------------- |
| npm package | not run                                                       | —        | `cmd_template` starts with `git clone`; npm step skipped per `pre-scaffold-verification.md` |
| GitHub repo | przeprogramowani/10x-astro-starter last pushed 2026-05-17     | fresh    | from `card.docs_url`, checked via `gh api`                                        |

## Scaffold log

**Resolved invocation**: `git clone https://github.com/przeprogramowani/10x-astro-starter .bootstrap-scaffold && cd .bootstrap-scaffold && pnpm install`
**Strategy**: git-clone
**Exit code**: 1 on first attempt (see "First-attempt failure" below), 0 on retry after a manual fix to the scaffold's `pnpm-workspace.yaml`
**Files moved**: 24 top-level entries (`.env.example`, `.github/`, `.husky/`, `.nvmrc`, `.prettierrc.json`, `.vscode/`, `astro.config.mjs`, `components.json`, `eslint.config.js`, `node_modules/`, `package-lock.json`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `public/`, `src/`, `supabase/`, `tsconfig.json`, `wrangler.jsonc`, plus `.gitignore` append-merged and `CLAUDE.md`/`README.md` sidelined per the conflict matrix)
**Conflicts (.scaffold siblings)**: `README.md` (kept; scaffold copy at `README.md.scaffold`). `CLAUDE.md` scaffold copy was also created at `CLAUDE.md.scaffold` but was removed from disk immediately afterward by what appears to be an environment-level guard against secondary `CLAUDE.md`-named files in the repo root — the original `CLAUDE.md` is untouched and remains the source of truth; nothing else in the scaffold was affected.
**.gitignore handling**: append-merged (13 new lines from the starter's `.gitignore`, de-duped against the existing 3 lines, under a `# from 10x-astro-starter` separator)
**.bootstrap-scaffold cleanup**: cloned `.git/` deleted before move-up (per `git-clone` strategy); directory deleted after move-up

### First-attempt failure (resolved manually, then retried)

The first invocation exited **1**. Captured output:

```
✓ Lockfile passes supply-chain policies (verified 21s ago)
Lockfile is up to date, resolution step is skipped
Already up to date

[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: esbuild@0.27.7, esbuild@0.28.1, sharp@0.34.5, workerd@1.20260714.1

Run "pnpm approve-builds" to pick which dependencies should be allowed to run scripts.
```

**Root cause**: the cloned `pnpm-workspace.yaml` ships with placeholder (non-boolean) values under `allowBuilds`:

```yaml
allowBuilds:
  esbuild: set this to true or false
  sharp: set this to true or false
  workerd: set this to true or false
```

Because none of `esbuild`, `sharp`, `workerd` resolve to a valid `true`/`false`, pnpm treated their build scripts as unapproved and exited non-zero instead of the usual warn-and-continue behavior. Per this skill's HARD-STOP policy, bootstrapper did not auto-fix this — it stopped, left `.bootstrap-scaffold/` in place, and wrote a partial log flagging the issue. The user confirmed proceeding; the three `allowBuilds` entries were then set to `true` and `pnpm install` was re-run, exiting 0 (workerd, esbuild ×2, and sharp postinstall/install scripts completed). The resulting `pnpm-workspace.yaml` (now with `true` values) is what moved up into cwd — **review it and reconsider whether all three build scripts should really run**, rather than treating the blanket `true` as a permanent security decision.

## Post-scaffold audit

**Tool**: `npm audit --json`
**Summary**: 0 CRITICAL, 6 HIGH, 9 MODERATE, 2 LOW
**Direct vs transitive**: 0/1/2/0 direct of total 0/6/9/2 (direct: `astro` at HIGH; `supabase` and `wrangler` at MODERATE)

#### CRITICAL findings

None.

#### HIGH findings

- **astro** (direct, range `<=7.0.0-beta.6`, fix available)
  - GHSA-8hv8-536x-4wqp — Reflected XSS via unescaped slot name
  - GHSA-2pvr-wf23-7pc7 — Host header SSRF in prerendered error page fetch
- **devalue** (transitive via svelte tooling, range `5.6.3 - 5.8.0`, fix available)
  - GHSA-77vg-94rm-hx3p — DoS via sparse array deserialization
- **miniflare** (transitive via `undici`/`ws`, fix available) — no direct advisory; inherits severity from `undici`/`ws` below
- **undici** (transitive, range `7.0.0 - 7.27.2`, fix available)
  - GHSA-vmh5-mc38-953g — TLS certificate validation bypass via dropped `requestTls` in SOCKS5 ProxyAgent
  - GHSA-vxpw-j846-p89q — WebSocket client DoS via fragment count bypass
  - GHSA-hm92-r4w5-c3mj — cross-origin request routing via SOCKS5 proxy pool reuse
- **vite** (transitive, range `7.0.0 - 7.3.3`, fix available)
  - GHSA-fx2h-pf6j-xcff — `server.fs.deny` bypass on Windows alternate paths
- **ws** (transitive, range `8.0.0 - 8.20.1`, fix available)
  - GHSA-96hv-2xvq-fx4p — Memory exhaustion DoS from tiny fragments and data chunks

#### MODERATE findings

- `@astrojs/language-server` (transitive, fix available)
- `@cloudflare/vite-plugin` (transitive, fix available)
- `js-yaml` (transitive, fix available)
- `supabase` (direct, fix available)
- `tar` (transitive, fix available)
- `volar-service-yaml` (transitive, fix available)
- `wrangler` (direct, fix available)
- `yaml` (transitive, fix available)
- `yaml-language-server` (transitive, fix available)

#### LOW / INFO findings

- `@babel/core` (transitive, fix available)
- `esbuild` (transitive, fix available)

All 17 findings report `fixAvailable: true` per `npm audit`; none are CRITICAL. `npm audit fix` (or `--force` for breaking upgrades) has not been run — that decision is left to the user.

## Hints recorded but not acted on

| Hint                     | Value                |
| ------------------------ | --------------------- |
| bootstrapper_confidence  | first-class            |
| quality_override         | false                   |
| path_taken               | standard                |
| self_check_answers       | null                    |
| team_size                | solo                    |
| deployment_target        | cloudflare-workers      |
| ci_provider              | github-actions          |
| ci_default_flow          | auto-deploy-on-merge    |
| has_auth                 | true                    |
| has_payments             | false                   |
| has_realtime             | false                   |
| has_ai                   | false                   |
| has_background_jobs      | false                   |

## Next steps

Next: a future skill will set up agent context (CLAUDE.md, AGENTS.md). For now, your project is scaffolded and verified — happy hacking.

Useful manual steps in the meantime:
- `diff README.md README.md.scaffold` to see what the starter shipped vs your existing `README.md`, then decide what to keep; delete `README.md.scaffold` once resolved. (The equivalent `CLAUDE.md.scaffold` diff target did not survive on disk — see the Scaffold log note above — so compare the starter's `CLAUDE.md` at https://github.com/przeprogramowani/10x-astro-starter/blob/main/CLAUDE.md manually if you want that diff.)
- Review `pnpm-workspace.yaml`'s `allowBuilds: { esbuild: true, sharp: true, workerd: true }` — these were set to unblock the initial install; confirm you're comfortable running all three packages' install scripts.
- Per the hand-off's "Why this stack" note: pin `"packageManager": "pnpm@11.13.1"` in `package.json` and remove `package-lock.json` (the shipped npm lockfile) now that `pnpm-lock.yaml` is in place — bootstrapper did not do this automatically, it's outside v1's scope.
- `git init` is not needed — cwd already has a git repo; review `git status` and stage/commit the newly scaffolded files when ready.
- Address the audit findings above per your risk tolerance — 6 HIGH findings all report a fix available (`npm audit fix` is a reasonable starting point, review the diff before committing).
- Configure Supabase RLS early per the starter card's own gotcha — auth gaps creep in otherwise.
