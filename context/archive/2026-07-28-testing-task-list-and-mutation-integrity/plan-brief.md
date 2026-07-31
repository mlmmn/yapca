# Task-list and Mutation Integrity — Plan Brief

> Full plan: `context/changes/testing-task-list-and-mutation-integrity/plan.md`
> Research: `context/changes/testing-task-list-and-mutation-integrity/research.md`

## What & Why

Rollout Phase 2 of `context/foundation/test-plan.md` takes the three highest-impact
risks in the map: a due or overdue task silently omitted from the daily list (#2), an
edit that drops a field or miscalculates next-due (#3), and a postpone/undo sequence
that leaves schedule and journal disagreeing (#4). All three need a seeded database,
which this repo does not have a harness for.

## Starting Point

Phase 1 bootstrapped Vitest on Node with pure-function unit tests under `src/lib/`.
Nothing database-facing exists: no fixtures, no reset machinery, no integration script,
and CI has no Docker step. Research found three things that reshape the phase before
any test is written — Risk #2's predicate is client-side inside a React island that
`§7` forbids testing; the test plan misstates Risk #3's recalculation rule; and the
mutation defects live not in the RPCs (which are atomic and correct) but at the seams
between them and code added later.

## Desired End State

An opt-in `pnpm test:integration` suite runs against a local Supabase stack and proves
the three risks by asserting resulting state rather than response codes. `pnpm test`
and the pre-commit hook stay green on a machine with no Docker. Two genuine defects are
captured as reviewed, skipped assertions handed to a follow-up change. The test plan's
wrong Risk #3 rule is corrected and the cookbook is written from what shipped.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Risk #2 testability | Extract the due predicate to `src/lib/due.ts`, then unit + integration test | It exists in three places inside the island today — extracting converts a plan-vs-code conflict into a `lessons.md`-compliant refactor | Plan |
| Action invocation | In-process via `.orThrow.call(ctx, formData)` | No HTTP server needed; Phase 4 needs a real multipart boundary regardless, so nothing is stranded | Plan |
| CI scope | Split Vitest projects now, CI wiring deferred to rollout Phase 5 | Disarms the `include`-glob landmine immediately while respecting the phase boundary the test plan drew | Plan |
| `test-plan.md:80` | In-place amendment + freshness stamp | §1 principle #3 already makes research ground truth when plan and code disagree | Research → Plan |
| Postpone divergence | Pin the implemented `acted_on + 2`, flag the PRD conflict | The behaviour was deliberate; a testing phase should not silently arbitrate a product question | Research → Plan |
| SQL suite | Give it a runner + reconcile boundary dates against `SEASON_BOUNDARIES` | It is the only executable proof of the PL/pgSQL Stryker cannot mutate | Research → Plan |
| Isolation | Per-test user minting via direct psql + real sign-in | The only approach exercising both RLS *and* the `security definer` RPCs' hand-written ownership checks | Research → Plan |
| Defect disposition | `test.skip` + follow-up change, not fixed here | V1 needs a migration and V3 needs a semantics decision — both deserve their own design and review | Plan |

## Scope

**In scope:** Vitest project split and virtual-module shims; fixture layer (users,
plants, action contexts, cleanup); extraction of the due derivation and its rewiring;
integration tests for Risks #2, #3, #4; vectors V1, V2, V3, V8, V11; the `test-plan.md`
Risk #3 correction; a runnable SQL gate with boundary reconciliation; a narrowed
Stryker audit; cookbook §6.2/§6.3.

**Out of scope:** Fixing V1/V3; the client-state vectors V4–V7 (React island, excluded
by `§7`); CI Supabase wiring (rollout Phase 5); real-HTTP invocation (rollout Phase 4);
adding a server-side due filter; changing postpone behaviour, the PRD, or UI copy;
restoring `getViteConfig()`.

## Architecture / Approach

Two Vitest projects share one config. The unit project is unchanged and Docker-free.
The integration project adds `resolve.alias` entries pointing `astro:env/server` and
`astro:actions` at local shims — the latter by absolute path into
`node_modules/astro/dist/actions/runtime/{server,client}.js`, because the package's
public entrypoint imports `virtual:astro:actions/options` and cannot be aliased.

Each test mints its own confirmed `auth.users` row via direct psql (the pattern
`supabase/seed.sql:9-71` already proves), then signs in through the anon-key client for
a genuine JWT. Actions are invoked in-process with a hand-built
`{ request, cookies, locals: { user } }`. RLS therefore applies exactly as in
production — which matters because table access runs under RLS while the RPCs are
`security definer` and bypass it.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Runner split + shims | Database tests can exist without breaking `pnpm test` | `astro:actions` shim is coupled to Astro internals; fragile across upgrades |
| 2. Fixture layer | Users, plants, action contexts, cleanup — proven by a smoke test | A harness that runs privileged would silently test neither RLS nor the RPC checks |
| 3. Risk #2 | `src/lib/due.ts` extracted, unit-tested; list query integration-tested | Touches production code — the island refactor must be behaviour-preserving |
| 4. Risk #3 | Full-record edit assertions + the interval-delta contract | Asserting `newNextDue >= today` would encode the wrong rule; no clamping is deliberate |
| 5. Risk #4 | Sequence tests + V2/V8/V11 pinned, V1/V3 skipped | Deciding which vectors are defects vs designed behaviour |
| 6. SQL gate + audit | Runnable SQL suite, Stryker survivor review, cookbook | Stryker cannot see the PL/pgSQL where the real business logic lives |

**Prerequisites:** Docker + `pnpx supabase start`; Phase 1 test conventions
(`test-plan.md` §6.1); the research doc read.
**Estimated effort:** ~4–6 sessions across six phases; Phases 1–2 are infrastructure
and carry most of the unknowns.

## Open Risks & Assumptions

- **The `astro:actions` shim targets unexported internals.** Verified working on astro
  6.4.8; a major upgrade may move `dist/actions/runtime/`. Named in-code so the failure
  is legible rather than mysterious.
- **PRD divergence on postpone is left open.** Code does `acted_on + 2`; `prd.md:56`,
  `:141` and the UI copy say "moves the task exactly 2 days forward." For an overdue
  plant these differ. Needs a product decision outside this phase.
- **`lefthook.yml` invokes `pnpm run eslint` and `pnpm run vitest`, neither of which is
  a defined script.** Whether the hook actually executes today needs verifying in
  Phase 1 — and reporting rather than unilaterally fixing, per the AGENTS.md rule on
  config changes.
- **Integration stays local-only until rollout Phase 5**, so `§5`'s "required after §3
  Phase 2" promise slips by one phase.
- **Skipped tests decay.** V1/V3 only stay honest if the follow-up change is actually
  opened in Phase 5, not merely referenced.
- **Sign-in rate limit** is 30 per 5 minutes per IP; a suite that outgrows it needs
  session reuse, not a config change.

## Success Criteria (Summary)

- A plant due today, overdue by 1, and overdue by 30 all reach the list; one due
  tomorrow does not — proven, not assumed.
- Editing a plant returns every untouched column intact, and next-due follows the
  interval-delta rule including when the result lands in the past.
- `water → undo → postpone → undo` returns the plant and its journal to their original
  state, asserted at every step rather than by response code.
