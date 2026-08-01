# Per-Account Isolation — Plan Brief

> Full plan: `context/changes/testing-per-account-isolation/plan.md`
> Research: `context/changes/testing-per-account-isolation/research.md`

## What & Why

Prove that User B, authenticated, cannot read or mutate User A's plant, task, or
photo when addressing it **by direct id** rather than through the UI — across
every operation, not just reads. This is Rollout Phase 3 of the test plan,
covering Risk #5.

The case for doing it now, in one line from research: **every isolation claim in
this repo's history rests on a manual tick or a code inspection, and the one time
anyone actually executed a cross-user probe, they found a CRITICAL cross-user
defect.**

## Starting Point

Isolation is enforced by four different mechanisms, and **which one is
load-bearing changes per operation** — reads rely on RLS policies alone,
mutations on hand-written predicates inside `SECURITY DEFINER` RPCs where RLS is
off, direct PostgREST writes on column-scoped grants, and photos on
`storage.objects` folder-prefix policies. Every layer is correct today except
one: the `plants` INSERT grant is still table-wide, leaving the FK-poisoning
attack that was closed on UPDATE still open on INSERT. Read isolation — the
property the phase exists to prove — has **no test at any layer**. The two-slot
fixture harness needed for all of this already exists; slot 1 was built during
Phase 2 specifically for this phase and is currently unused.

## Desired End State

Every operation on every mechanism has an executed cross-account assertion at the
cheapest layer that can express it. The confirmed INSERT-grant hole is closed by
a migration and pinned by a regression test that demonstrably fails when the
migration is reverted. `pnpm test:sql` picks up new SQL files automatically, and
test-plan §6.4 documents the pattern — including the one trap that produces a
permanently-green test — so later phases extend it rather than reinvent it.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Confirmed INSERT-grant hole | Fix it, then test it | Leaves the codebase actually secure and lets the test assert correct behaviour rather than documenting a bug; the F1 column-grant remedy is already proven here | Plan |
| Layer allocation | Both, deliberately split | SQL owns policy and grant primitives ("only a grant can express this"); integration owns Action contracts SQL cannot see — each layer tests what only it can | Plan |
| Storage scope | Full per-verb isolation matrix | Cross-account SELECT, INSERT, UPDATE and DELETE probes plus the `photo_path` pointer leak are ownership properties belonging to Risk #5; file-format and upload-boundary validation remain Phase 4 concerns | Plan |
| Two structural fragilities | Pin with tests, don't change code | Tests the boundary as designed rather than relitigating it mid-test-phase, while comments make the single point of failure visible | Plan |
| Denial assertions | Shape-specific + positive control | A helper accepting all three denial shapes can't tell you which it got; without a positive control a broken fixture and a working policy are indistinguishable | Plan |
| Action-layer assertions | Error code + victim state unchanged | An error response doesn't prove nothing was written — the RPCs run with RLS off, so a partial write before a raise is physically possible | Plan |
| `test:sql` runner | Glob script | A hardcoded file list means the next author must remember; a forgotten file is a green suite that tests nothing | Plan |
| CI gate | Document now, wire in Phase 5 | Phase 5 owns gate wiring for every layer; piecemeal wiring means two CI configurations to reconcile | Plan |
| Isolation model itself | Not relitigated | A failing read-isolation test has exactly one correct fix — repair the policy | Research |
| Harness infrastructure | Reuse Phase 2's, no new fixtures | Slot 1 already exists and works; only six small helper gaps need closing | Research |

## Scope

**In scope:** read isolation on both tables (SQL + integration); the `plants`
INSERT-grant fix and its regression test; direct plant INSERT, UPDATE and DELETE
policy probes; cross-account `markWatered`,
`postponePlant`, `undoWateringEvent`, `updatePlant`; `postpone_plant` and
ownership-transfer SQL gaps; comment-anchored pins on the two structural
fragilities; cross-account Storage SELECT, INSERT, UPDATE and DELETE plus the
`photo_path` pointer leak; a glob SQL runner; test-plan §6.4.

**Out of scope:** any HTTP-boundary test (in-process harness by design);
relitigating the RLS-only-for-reads decision; *hardening* the two fragilities;
raising the slot count above 2; wiring the CI gate (Phase 5 owns it); orphaned
storage objects after delete (no delete Action exists); verifying the hosted
project matches the migrations.

## Architecture / Approach

Two layers with an explicitly stated division, because the biggest waste here
would be writing the same check twice at two costs. **SQL**
(`supabase/tests/per-account-isolation.sql`) uses the existing `begin; … rollback;`
plus `set local request.jwt.claims` impersonation idiom to assert policy and
grant primitives — zero-row selects, `has_column_privilege`, RPC `P0002` raises —
costing no sign-in budget. **Integration** (two new
`*.integration.test.ts` files) drives the real cookie-jar → JWT → RLS/RPC path to
assert Action contracts and client-path properties SQL cannot see. Every denial
assertion is shape-specific and paired with a positive control proving the owner
still succeeds.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Read isolation and harness groundwork | The unasserted core property at both layers; non-throwing readers, denial assertions, glob SQL runner | Helpers that conflate "correctly denied" with "fixture broken" — mitigated by positive controls and a deliberate-break check |
| 2. Mutation isolation and the INSERT-grant fix | Full plant per-verb cross-account matrix; migration closing the confirmed hole | The narrowed grant must retain `id` and `user_id` or `addPlant` and every integration fixture break |
| 3. Storage isolation and close-out | All four Storage verbs, pointer-leak case, test-plan §6.4 | Storage denial can be a filtered no-op, so owner-state positive controls are required |

**Prerequisites:** Docker with the local Supabase stack running (`pnpx supabase
start`), `psql` on PATH, and `.env` carrying `SUPABASE_URL`, `SUPABASE_KEY`,
`SUPABASE_DB_URL`. Phase 2 of the rollout is complete, so the harness exists.

**Estimated effort:** ~3 sessions, one per phase, each ending at a manual
confirmation gate.

## Open Risks & Assumptions

- **Production may not match the migrations.** Every finding derives from
  `supabase/migrations/`; a policy dropped by hand in the hosted project would be
  invisible to this work. Out of scope, but worth a separate check.
- **The local stack may add `storage.objects` defaults beyond the migration.** A
  permissive default would make a storage test pass locally and fail in
  production, or vice versa. Phase 3's positive controls limit but don't
  eliminate this.
- **`createSignedUrls` behaviour on a mixed batch** (some own, some foreign
  paths) is empirical — partial success or whole-batch error is unpinned.
- **The `astro:actions` shim resolves to paths absent from Astro's `exports`
  map**; an Astro upgrade breaks the integration layer in two places.
- **Tests are written but not enforced until Phase 5** wires the CI gate, so a
  cross-user regression could merge in the interim.

## Success Criteria (Summary)

- A cross-account probe exists and passes for every operation on every
  enforcement mechanism — and each one can be made to fail on demand.
- The `current_watering_event_id` FK-poisoning attack is closed on both the
  UPDATE and INSERT verbs, with a regression test that fails when the fix is
  reverted.
- A contributor can add a fourth isolation case from test-plan §6.4 alone,
  without reading this plan.
