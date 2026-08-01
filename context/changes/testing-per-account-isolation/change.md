---
change_id: testing-per-account-isolation
title: Per-account isolation — prove User B cannot reach User A's data by direct id
status: implemented
created: 2026-08-01
updated: 2026-08-01
archived_at: null
---

## Notes

Rollout Phase 3 of `context/foundation/test-plan.md`: "Per-account isolation".

**Risk covered — #5**: one authenticated user reads or mutates another user's
plant, task, or photo because ownership is not checked, only authentication
(High impact, Medium likelihood). Evidence: PRD Non-Functional Requirements
(data isolated per account), PRD Access Control (no cross-user visibility),
`AGENTS.md` hard rule requiring RLS with granular per-operation, per-role
policies, `context/archive/2026-07-19-finish-auth-and-route-gating/`.

**Test types planned**: contract / integration.

**Risk response intent**: prove that User B, authenticated, cannot read or
mutate User A's plant, task, or photo when addressing it by direct id rather
than through the UI — across every operation, not just reads.

**Must challenge**: that "RLS exists" means "RLS is correct". Per-operation
policies can permit one verb while another path bypasses them, and
authentication is not authorization.

**Anti-pattern to avoid**: testing isolation through the UI, which never offers
the other user's id and therefore cannot fail.

**Harness**: reuse the Phase 2 seeded-database harness (`test/fixtures/`,
`test/setup/` — fixture users, per-worker slots) rather than building a bespoke
one. See `context/foundation/test-plan.md` §6 cookbook.
