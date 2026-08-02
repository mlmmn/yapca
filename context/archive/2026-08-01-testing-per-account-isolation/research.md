---
date: 2026-08-01T20:03:48+02:00
researcher: mlmmn
git_commit: a3f455df3972d63fe52b22f0796c04cc8fce19c0
branch: main
repository: yapca
topic: "Per-account isolation — prove User B cannot reach User A's data by direct id"
tags: [research, codebase, rls, authorization, supabase, security-definer, storage, integration-tests]
status: complete
last_updated: 2026-08-01
last_updated_by: mlmmn
---

# Research: Per-account isolation — prove User B cannot reach User A's data by direct id

**Date**: 2026-08-01T20:03:48+02:00
**Researcher**: mlmmn
**Git Commit**: `a3f455df3972d63fe52b22f0796c04cc8fce19c0`
**Branch**: `main`
**Repository**: yapca

## Research Question

Rollout Phase 3 of `context/foundation/test-plan.md` — Risk #5: one authenticated
user reads or mutates another user's plant, task, or photo because ownership is
not checked, only authentication. Ground the four things the test plan says
research must establish:

1. Which policies exist per table / operation / role
2. Whether mutations run under the user's session or a service key
3. How ownership is asserted
4. What the existing harness can already do, so Phase 3 reuses it

## Summary

**The authorization model is layered and, at every layer I could inspect, correct
today — with two structural exceptions and one confirmed open hole.** The
important finding is not that isolation is broken; it is *what is actually
holding it up*, because the load-bearing control is frequently not the one a test
author would assume.

Four mechanisms enforce isolation, in descending order of how much weight they
carry:

| Mechanism | Where it applies | Assessment |
| --- | --- | --- |
| Hand-written `user_id = v_user_id` predicates inside four `SECURITY DEFINER` RPCs | **all mutations** of plants and events | Correct in all four. RLS is *off* inside these functions, so these predicates are the entire boundary. |
| Column-scoped `UPDATE` grant on `plants` | direct PostgREST writes | The only thing preventing ownership transfer — see structural finding #1. |
| RLS `SELECT` policies | **all reads** (pages, list, journal, `updatePlant` pre-read) | Correct, and *never once asserted by an automated test*. |
| `storage.objects` folder-prefix policies | every photo verb | The cleanest layer in the codebase; all four verbs covered, `UPDATE` has both `USING` and `WITH CHECK`. |

**Confirmed open hole (verified directly, not just reported):** the `plants`
INSERT grant is still table-wide
(`supabase/migrations/20260719120000_create_plants.sql:35`), while only the
UPDATE grant was narrowed by the F1 fix
(`supabase/migrations/20260801120002_secure_and_index_undo_stack.sql:23-31`). The
`current_watering_event_id` FK-poisoning attack that the F1 fix closed on the
UPDATE verb is therefore **still open on the INSERT verb**. This is the precise
shape of failure the change brief names: "per-operation policies can permit one
verb while another path bypasses them."

**Two structural fragilities** that are safe today only because of a single
upstream guard:

- `plants_update_own` has a `USING` clause and **no `WITH CHECK`**
  (`supabase/migrations/20260719120000_create_plants.sql:49-52`). Ownership
  transfer is blocked *only* by the column grant, not by the policy. A grant
  regression and a policy regression are different failures; today only the
  former is asserted.
- `update_plant_schedule`'s final `return query select * from public.plants where
  id = p_plant_id` has no owner predicate, inside a `SECURITY DEFINER` function
  where RLS does not apply
  (`supabase/migrations/20260801120002_secure_and_index_undo_stack.sql:149-152`).
  It is unreachable today because the guard at `:91-97` raises `P0002` first —
  one guard deep, returning the full row including `user_id`, straight to the
  client.

**No privileged client exists.** There is exactly one Supabase client factory
(`src/lib/supabase.ts:6-26`), it uses the publishable key and the request's
session cookies, and no `service_role` key is declared, imported, or deployed.
The privilege escalation in this codebase lives entirely in `SECURITY DEFINER`
functions, not in a key.

**Harness verdict: no new fixture infrastructure is needed.** Slot 1 was built
during Phase 2 specifically for this phase and is currently unused at the Action
layer. Two independent authenticated users, per-user row creation, and invoking
an Action as an arbitrary user against an arbitrary id all work today. Six
smaller helper gaps are listed in §4.4 — one of which is a trap that would
produce a permanently-passing test.

**The historical finding that should shape this phase most:** every isolation
claim in this repo's history was verified by a human ticking a manual checkbox or
by code inspection. The one time anyone actually *executed* a cross-user probe
(`context/archive/2026-07-31-undo-integrity-defects/reviews/impl-review.md:61-84`),
they found a CRITICAL cross-user defect that no RLS policy could express.

## Detailed Findings

### 1. Database layer — policies, grants, RPCs

#### 1.1 Tables and ownership

Only two application tables exist. Both carry a direct `user_id`, so there is
**no transitive-ownership risk** — `watering_events` does not depend on its
parent plant for attribution.

- `public.plants` — `user_id uuid not null references auth.users(id) on delete cascade`
  (`supabase/migrations/20260719120000_create_plants.sql:6`)
- `public.watering_events` — own `user_id` column
  (`supabase/migrations/20260720120000_create_watering_events.sql:8`), plus
  `plant_id ... on delete cascade` (`:7`)

There is **no constraint that `watering_events.user_id` matches
`plants.user_id`** for its `plant_id`, and none that `previous_event_id` /
`current_watering_event_id` point at same-owner rows. Ownership consistency of
the object graph is enforced only by RPC bodies and grants, never by the schema.
That is the substrate for finding #3.1.

No views exist anywhere (`src/lib/database.types.ts:140-142` confirms
`Views: { [_ in never]: never }`), so the `security_invoker` view-bypass class of
bug is moot here.

#### 1.2 Policy matrix

RLS is enabled on both tables
(`supabase/migrations/20260719120000_create_plants.sql:37`,
`supabase/migrations/20260720120000_create_watering_events.sql:23`) and never
disabled since. `FORCE ROW LEVEL SECURITY` is **absent on both** — which is why
the `SECURITY DEFINER` functions run with RLS entirely off.

Every policy in the codebase is `to authenticated`. There is **no policy for
`anon`, `public`, or `service_role` anywhere**, and no predicate broader than
`auth.uid() = user_id`.

`public.plants` (`supabase/migrations/20260719120000_create_plants.sql:39-57`):

| Policy | Cmd | `USING` | `WITH CHECK` |
| --- | --- | --- | --- |
| `plants_select_own` | SELECT | `auth.uid() = user_id` | — |
| `plants_insert_own` | INSERT | — | `auth.uid() = user_id` |
| `plants_update_own` | UPDATE | `auth.uid() = user_id` | **NONE** ⚠ |
| `plants_delete_own` | DELETE | `auth.uid() = user_id` | — |

`public.watering_events`: only `watering_events_select_own`
(`supabase/migrations/20260720120000_create_watering_events.sql:25-28`) survives.
The INSERT and DELETE policies were **deliberately dropped**
(`supabase/migrations/20260723120000_add_postpone_and_undo.sql:13-14`) alongside
the grant revoke; UPDATE never had either. This is intentional deny-by-default —
and it means `watering_events` write isolation is 100% RPC-body logic.

#### 1.3 Grants — where isolation actually lives

- `plants`: `grant select, insert, update, delete`
  (`supabase/migrations/20260719120000_create_plants.sql:35`), later
  `revoke update` (`.../20260801120002_secure_and_index_undo_stack.sql:23`) and
  re-granted **column-scoped** to `name, growing_interval_days,
  dormancy_interval_days, next_due_on, photo_path` (`:25-31`).
  **`insert` remains table-wide.**
- `watering_events`: `grant select, insert, delete`
  (`supabase/migrations/20260720120000_create_watering_events.sql:21`) →
  `revoke insert, delete`
  (`supabase/migrations/20260723120000_add_postpone_and_undo.sql:12`). Net:
  **SELECT only.**
- Functions: each migration does `revoke all ... from public, anon,
  authenticated` then `grant execute ... to authenticated`. Consistent across all
  five migrations.

#### 1.4 The four RPCs

All four are `security definer` with `set search_path = ''` and fully
schema-qualified bodies, all in
`supabase/migrations/20260801120000_explicit_undo_stack.sql` unless noted:

| Function | Lines | Client-supplied ids | Ownership assertion |
| --- | --- | --- | --- |
| `mark_watered` | `:31-106` | `p_plant_id` | `where p.id = p_plant_id and p.user_id = v_user_id for update` (`:63`); null-uid guard `:56-58`; raises `P0002` |
| `postpone_plant` | `:108-173` | `p_plant_id` | `:137`, uid guard `:130-132` |
| `undo_watering_event` | `:175-247` | `p_event_id` | event filtered by `e.user_id` (`:203`, `:222`) **and** plant re-checked (`:212`); uid guard `:196-198` |
| `update_plant_schedule` | `.../20260801120002:60-154` | `p_plant_id`, `p_photo_path` | plant `:92`, uid guard `:85-87`; event sub-queries `:117`, `:131`, `:139` |

**No `SECURITY DEFINER` function takes an id and omits an ownership check.**
Stating that explicitly, because it is the single most likely place for this
class of bug and it is not present.

Two sub-findings inside otherwise-clean functions are covered in §5 (structural
findings #2 and #3).

#### 1.5 Storage

Bucket `plant-photos`, `public = false`, 4 MB cap, MIME allowlist
(`supabase/migrations/20260719120001_create_plant_photos_bucket.sql:4-11`). Four
policies on `storage.objects`, all `to authenticated`, all predicated on
`bucket_id = 'plant-photos' and (storage.foldername(name))[1] = auth.uid()::text`
(`:13-47`). Notably `plant_photos_update_own` (`:29-39`) has **both `USING` and
`WITH CHECK`** — stricter than `plants_update_own`, and deliberately so: the
original plan says it exists "so an object cannot be moved across ownership
boundaries" (`context/archive/2026-07-19-core-watering-loop/plan.md:89-91`).

Paths are always built server-side: `buildPhotoPath(userId, mime)` →
`` `${userId}/${crypto.randomUUID()}.${ext}` `` (`src/lib/photo.ts:21-29`),
called with `user.id` at `src/actions/index.ts:56` and `:139`. **No application
code path accepts a storage path from client input.** URLs are signed with a
1-hour TTL (`src/lib/photo.ts:15,31-38`) using the *user's own* session client,
so signing a foreign path is itself RLS-checked.

I found **no hole in the storage layer.**

### 2. Application layer — access paths

#### 2.1 Client construction: one client, no service key

`src/lib/supabase.ts:6-26` is the only factory. It calls `createServerClient`
with `SUPABASE_URL` / `SUPABASE_KEY` from `astro:env/server`, wired to the
request's `Cookie` header (`:14-18`) and `AstroCookies.set` (`:19-23`).
`SUPABASE_KEY` is declared once (`astro.config.mjs:22`); `.env.example` lists
only `SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_DB_URL`. The only `service_role`
string in the repo is in `supabase/.temp/start-secrets/` — local-stack
scaffolding written by `pnpx supabase start`, never imported.

Every request-path client therefore carries the user's session, runs as
`authenticated`, and has a real `auth.uid()`. Call sites: `src/middleware.ts:20`,
`src/actions/index.ts:14`, `src/lib/services/load-today-plants.ts:10`,
`src/pages/plants/index.astro:11`, `src/pages/plants/[id].astro:23`,
`src/pages/plants/[id]/edit.astro:20`, and the four `src/pages/api/auth/*` routes.

#### 2.2 Middleware is authentication only

`src/middleware.ts:8-43`. Sets `locals.today` (`:18`) and `locals.user` (`:27`/`:29`)
via `supabase.auth.getUser()` (`:25`) — real token verification, not a cookie
decode. `PROTECTED_ROUTES = ["/plants"]` (`:6`), matched with `startsWith`
(`:32`). It never inspects `Astro.params.id` or any row; authorization is
delegated entirely downstream. `/_actions/*` is not in the list — Actions guard
themselves via `requireSession` (`src/actions/index.ts:13-21`).

#### 2.3 Astro Actions — all five, all in one file

| Action | Line | Client id | Ownership via | Returns data |
| --- | --- | --- | --- | --- |
| `addPlant` | `:34-95` | none | inserts `user_id: user.id` (`:71`) + RLS `with check` | yes (`:93`) |
| `updatePlant` | `:97-227` | `plantId` (`:100`) | **pre-read: bare RLS** (`:112-118`); write: RPC (`:159-168`) | yes, full row (`:209`) |
| `markWatered` | `:229-264` | `plantId` (`:232`) | RPC (`:239`) | yes (`:262`) |
| `postponePlant` | `:266-304` | `plantId` (`:268`) | RPC (`:275`) | yes (`:302`) |
| `undoWateringEvent` | `:306-350` | `eventId` (`:308`) | RPC (`:311`) | yes (`:348`) |

Three details that directly shape what the tests must assert:

- **Error shapes are uniform and non-leaking.** Foreign id and nonexistent id
  both collapse to `NOT_FOUND` everywhere (`:125`, `:179`, `:197`, `:249`,
  `:289`, `:324`). There is no `FORBIDDEN` anywhere in the codebase. An isolation
  test must assert `NOT_FOUND` — asserting `FORBIDDEN` would fail against correct
  code, and asserting "it threw" would pass against a harness bug.
- **`28000` → `UNAUTHORIZED`** (`:189`, `:255`, `:295`, `:341`) maps a null
  `auth.uid()` to a clean error. Worth exercising with the harness's existing
  `createSessionlessActionContext`.
- **No plant-delete Action exists**, despite `grant delete` and a delete policy.
  DELETE is reachable only by hand-crafted PostgREST, never through the app.

#### 2.4 Pages — three direct-id reads, all trust-RLS

| Page | Query | Missing-row behaviour |
| --- | --- | --- |
| `src/pages/plants/index.astro:17-20` | unfiltered `select` — scoped purely by RLS | `status = "empty"` (`:58`) |
| `src/pages/plants/[id].astro:29-33` | `.eq("id", plantId).single()` — **no `user_id`** | 404 (`:66`) + "isn't available to this account" (`:156-159`) |
| `src/pages/plants/[id].astro:46-50` | journal: `.eq("plant_id", plantId)` — **separate RLS dependency** | empty journal (`:119`) |
| `src/pages/plants/[id]/edit.astro:26-30` | `.eq("id", plantId).maybeSingle()` | 404 (`:46`) |
| `authed-shell.astro:7` → `load-today-plants.ts:20-24` | unfiltered `select` | error state |

The 404 body is **identical** for "no such plant" and "someone else's plant" —
and this indistinguishability is a deliberate design property, not an accident:
`context/archive/2026-07-25-edit-plant-and-recalc/design.md:287` says the edit
route 404s "as the detail route rather than revealing ownership". That makes it
an assertable property, not merely an implementation detail.

The journal query at `[id].astro:46-50` is the sharpest single target on this
list: it keys on `plant_id`, not `user_id`, so it is a *separate* RLS dependency
from the plant read. A plant-RLS-holds / events-RLS-regresses split would surface
only there.

### 3. Test harness — what exists

#### 3.1 Commands and environment

| Script | Config | Scope |
| --- | --- | --- |
| `pnpm test` | `vitest.config.ts` | `src/**/*.test.{ts,tsx}`, **excludes** `*.integration.test.*` (`:22-23`). No Docker. |
| `pnpm test:integration` | `vitest.integration.config.ts` | **only** `src/**/*.integration.test.{ts,tsx}` (`:35`) |
| `pnpm test:sql` | none — raw `psql` ×2 | `package.json:15`; hardcoded file list — **adding a third SQL file requires editing this script** |
| `pnpm test:mutants` | `stryker.config.json` | pinned to `vitest.config.ts`; **never sees integration tests** |

Integration needs `SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_DB_URL`
(`test/setup/load-env.ts:4`), Docker, and a `psql` binary on PATH
(`test/fixtures/user.ts:158-167`). `assertLocalDatabaseUrl`
(`test/setup/load-env.ts:23-48`) hard-fails unless the host is loopback on port
`54322`. `testTimeout: 15000`, `maxWorkers: 2`
(`vitest.integration.config.ts:43-44`).

#### 3.2 Slots — the thing Phase 3 was promised

```ts
// test/fixtures/user.ts:436
export async function getIntegrationUserFixture(slotNumber = 0): Promise<IntegrationUserFixture>
```

```ts
// test/fixtures/user.ts:24-31
export type IntegrationUserFixture = {
  client: SupabaseClient<Database>;   // createServerClient, ANON key + this slot's cookie jar
  cookieJar: Map<string, { value: string; options?: { maxAge?: number } }>;
  createUniqueName: (prefix: string) => string;
  email: string;
  user: User;
  userId: string;
};
```

`USER_SLOT_COUNT = 2` — verified at `test/fixtures/user.ts:35`. Slots `0` and `1`
only; `ensureUserSlot` throws outside that range (`:395-397`), and the comment at
`:392-394` records why the cap is load-bearing: Supabase's sign-in limit is 30 per
5 minutes per IP (`supabase/config.toml:189`).

**Slot 1 is not special in kind — only in identity.** Creation is fully symmetric;
the email embeds the run namespace, worker id and slot number
(`test/fixtures/user.ts:169-171`), and the user id is a SHA-1 fold of that email
(`:187-197`) so inserts are idempotent per worker.

Three answers Phase 3 depends on:

- **Two slots live in one test: yes, already proven** —
  `src/lib/services/load-today-plants.integration.test.ts:50-64` holds both.
- **Sessions independent: yes.** Each slot gets its own `createCookieJar()`
  (`:405`) and its own client (`:127-147`). `createActionCookies` (`:481`) clones
  the jar before handing it over (`:503-504`).
- **Worker collision: no.** Emails embed `VITEST_POOL_ID`/`VITEST_WORKER_ID`
  (`:67-69`) plus the run namespace (`:57-65`). The residual hazard the code
  documents itself (`test/setup/global-setup.ts:53`): the stale sweep is
  *namespace-blind*, so two concurrent integration runs against one stack collide
  at startup.

#### 3.3 Data fixtures and Action invocation

`createPlantFixture` (`test/fixtures/plants.ts:24`) inserts with
`user_id: userFixture.userId` **using `userFixture.client`** (`:36-46`) — so
creating a row *as a nominated user* already works by passing the slot-1 fixture.

`readPlantState` (`test/fixtures/plants.ts:57`) reads with `userFixture.client` —
**user-scoped, anon key, RLS applies.** This matters enormously: it is not a
privileged peek, so it is a legitimate victim-side verifier. But it uses
`.single()` and throws on error (`:64-66`, `:74-76`), so an RLS-filtered miss
surfaces as a thrown `Failed to read plant <id>` (PGRST116) — usable to assert
"A's row is unchanged", **not** usable to assert "B sees nothing" without
conflating denial with a broken fixture.

`createActionContext(userFixture)` (`test/fixtures/action-context.ts:5`) builds
`{ cookies, locals: { today: null, user }, request }` with the slot's `Cookie`
header. The JWT path is production code end to end: cookie jar →
`createActionRequestHeaders` (`test/fixtures/user.ts:470-479`) → `Request`
headers → `src/lib/supabase.ts` → real Supabase JWT → RLS/RPC.

**Invoking an Action as user X against user Y's row id works today with zero new
helpers** — `createActionContext(attacker)` plus a `FormData` carrying the
victim's id. Both the app guard and RLS see the attacker. Siblings
`createSessionlessActionContext` (`:21`) and `createUnauthenticatedActionContext`
(`:29`) cover the `28000` and `UNAUTHORIZED` paths.

The `astro:actions` shim (`test/shims/astro-actions.ts`) resolves to paths absent
from Astro's `exports` map (`vitest.integration.config.ts:18-21,29-31`); its own
header warns an Astro upgrade breaks it in two places.

#### 3.4 Existing cross-account coverage

**One** integration test touches two users:
`src/lib/services/load-today-plants.integration.test.ts:50-75` — "excludes plants
owned by another user". It is a *list-scoping* test, not a direct-id test.

At the SQL layer, `supabase/tests/undo-integrity.sql` is richer: cross-user
`P0002` for `undo_watering_event` (`:307-313`) and `update_plant_schedule`
(`:315-330`), plus direct grant assertions on
`current_watering_event_id`/`id`/`user_id`/`updated_at` (`:344-358`), the five
editable columns (`:362-369`), and `anon` execute (`:375-393`).
`supabase/tests/season-aware-intervals.sql:95-106` covers cross-user
`mark_watered`.

**Plainly absent:**

- **No read-isolation test at all, at any layer.** Nothing asserts that B
  selecting A's plant or A's watering event *by direct id* returns zero rows.
  This is the single property the phase exists to prove.
- No cross-account Action-layer test for `markWatered`, `postponePlant`,
  `updatePlant`, or `addPlant`.
- No `postpone_plant` cross-account SQL case (only `mark_watered` and
  `undo_watering_event` are covered).
- No cross-account storage test of any kind.
- No direct PostgREST-shaped write test — only the *grant* is asserted, never the
  *policy* behaviour.
- No HTTP-boundary capability at all; the harness is in-process by design
  (`context/foundation/test-plan.md:218-220`).

## Code References

- `supabase/migrations/20260719120000_create_plants.sql:35` — table-wide INSERT grant (open hole #1)
- `supabase/migrations/20260719120000_create_plants.sql:49-52` — `plants_update_own`, `USING` with no `WITH CHECK`
- `supabase/migrations/20260719120001_create_plant_photos_bucket.sql:13-47` — four storage policies, folder-prefix predicate
- `supabase/migrations/20260723120000_add_postpone_and_undo.sql:12-14` — revoke + policy drop on `watering_events`
- `supabase/migrations/20260801120000_explicit_undo_stack.sql:31-247` — three RPCs, all owner-filtered
- `supabase/migrations/20260801120002_secure_and_index_undo_stack.sql:23-31` — column-scoped UPDATE re-grant (the F1 fix)
- `supabase/migrations/20260801120002_secure_and_index_undo_stack.sql:107` — `p_photo_path` written verbatim, unvalidated
- `supabase/migrations/20260801120002_secure_and_index_undo_stack.sql:149-152` — unguarded final `return query`
- `src/lib/supabase.ts:6-26` — the only client factory; publishable key + session cookies
- `src/middleware.ts:6,32-36` — `PROTECTED_ROUTES`, authentication-only gate
- `src/actions/index.ts:13-21` — `requireSession`
- `src/actions/index.ts:112-118` — `updatePlant` pre-read, bare RLS, no `user_id` filter
- `src/actions/index.ts:159-168,209` — RPC call and full-row return
- `src/actions/index.ts:125,179,197,249,289,324` — every `NOT_FOUND` path
- `src/pages/plants/[id].astro:29-33,46-50` — plant read and the separate journal read
- `src/lib/photo.ts:15,21-29,31-38` — path construction and signed URLs
- `test/fixtures/user.ts:35,169-171,389-424,436,470-481` — slot pool, identity, fixture API
- `test/fixtures/plants.ts:24,57` — `createPlantFixture`, `readPlantState`
- `test/fixtures/action-context.ts:5,21,29` — three context builders
- `test/setup/global-setup.ts:34-84` — namespace, stale sweep, teardown exit code
- `test/setup/reset-integration-slots.ts:8` — per-test dirty marking
- `src/lib/services/load-today-plants.integration.test.ts:50-75` — the only two-user test today
- `supabase/tests/undo-integrity.sql:296-393` — existing SQL cross-user and grant assertions

## Architecture Insights

**Isolation is enforced by four different mechanisms, and which one is
load-bearing changes per operation.** This is the central insight for test
design. A test author who assumes "RLS protects everything" will write tests that
pass for the wrong reason:

- **Reads** → RLS policies, exclusively. No application query filters by
  `user_id`. This is a deliberate architectural decision, stated explicitly:
  "RLS makes ownership checks implicit and privacy-safe… a redundant filter is
  not needed in the action, and **none should be added as a substitute for
  RLS**" (`context/archive/2026-07-25-edit-plant-and-recalc/plan.md:73-76`).
- **Mutations** → hand-written predicates inside `SECURITY DEFINER` RPCs. RLS is
  off in there. Every RPC test is therefore a *security* test, not a correctness
  test.
- **Direct PostgREST writes** → column-scoped grants. As the prior review put it,
  the assertion was "written against grants rather than policies **because only a
  grant can express this**"
  (`context/archive/2026-07-31-undo-integrity-defects/reviews/impl-review.md:292-299`).
- **Photos** → `storage.objects` folder-prefix policies, plus the fact that no
  code path accepts a client-supplied path.

**A documented tension worth surfacing to planning.** The earliest impl-review
(`context/archive/2026-07-19-core-watering-loop/reviews/impl-review.md:53-62`,
finding F4) called RLS-only authorization "single-layer defense: a future
service-role-key swap or RLS regression would open cross-tenant writes" and
*added* an explicit `.eq("user_id", user.id)` to `markWatered`. Six days later,
`edit-plant-and-recalc` decided the opposite for reads. Both positions are
defensible and the current code follows both (mutations are double-checked inside
RPCs; reads are not). **Phase 3's job is to test the boundary as designed, not to
relitigate it** — but the plan should note that a failing read-isolation test has
exactly one correct fix (repair the policy), not two.

**Deny-by-default was chosen over policy coverage for `watering_events`.** The
absence of INSERT/UPDATE/DELETE policies there is not a gap; it is the design.
Tests should assert the *grant* absence, not look for a missing policy.

**UUID secrecy is explicitly not treated as access control** in this repo's
history — stated verbatim at
`context/archive/2026-07-31-undo-integrity-defects/reviews/impl-review.md:78-82`.
That precedent settles how to rate open hole #1: "the attacker needs to learn the
event UUID out of band" is a mitigating factor, not a dismissal.

## Historical Context (from prior changes)

- **`context/archive/2026-07-19-finish-auth-and-route-gating/`** — cited by the
  test plan as Risk #5 evidence, but it contains **no RLS work at all** (and no
  `research.md`). It is auth UI + route gating; `design.md:108-110` describes
  `PROTECTED_ROUTES` as authentication-only, and `plan-brief.md:36` puts real app
  routes out of scope. The citation is bibliographically thin — the actual RLS
  design is one slice later.
- **`context/archive/2026-07-19-core-watering-loop/`** — the real origin.
  `plan.md:83` specifies the four granular plant policies; `plan.md:89-91`
  specifies the storage path-ownership predicate and *why* UPDATE needs both
  `USING` and `WITH CHECK`. Verification was manual only: `plan.md:120-124` and
  `:314` are two-account checklists, and `plan-brief.md:38` puts automated tests
  out of scope. `reviews/impl-review.md:53-62` (F4) is the earliest written
  statement of this exact threat model.
- **`context/archive/2026-07-23-postpone-and-undo/`** — where `SECURITY DEFINER`
  entered (`plan.md:51,83`). The review's verification method was "**migration
  reviewed by inspection**" (`reviews/impl-review.md:21`).
- **`context/archive/2026-07-31-undo-integrity-defects/`** — the most important
  precedent. `reviews/impl-review.md:61-84` records F1, CRITICAL: "Any
  authenticated user can permanently break another user's undo and plant
  deletion", found by an **executed probe** ("`PROBE 2 (write): tamper UPDATE
  affected 1 row(s)`", "`PROBE 5 … VICTIM BROKEN, 23503`"). Fixed by column-scoped
  grants at `:126-138`. F10 (`:292-299`) is the meta-lesson: the gate had no case
  asserting a client cannot write `current_watering_event_id`, and "nothing would
  catch a future migration re-granting them". `:100-103` records a stated blind
  spot: the reviewer did not audit Astro pages for direct plant updates outside
  `src/actions`.
- **`context/archive/2026-07-20-plant-detail-and-journal/`** — `plan.md:55`
  establishes the governing rule: "**Not-found = 404, not 500.** RLS makes
  another user's plant simply return zero rows (same as a nonexistent id)."
  `plan.md:234` and `:294-295` are manual two-user criteria.
- **`context/archive/2026-07-25-edit-plant-and-recalc/`** — `plan.md:73-76` is the
  "do not add redundant filters" decision. `plan.md:616` is the manual step
  "another account's plant id and a random uuid → identical 404".
  `reviews/impl-review.md:32` admits the check was "**NOT RE-EXECUTED** — verified
  by inspection".
- **`context/archive/2026-07-28-testing-task-list-and-mutation-integrity/`** — the
  harness. `plan.md:129-133` explains why real JWTs matter: "table access runs
  under RLS while the RPCs are `security definer` and bypass it… A harness that
  minted users with a service-role key would exercise neither mechanism."
  `plan.md:306`: "Default tests use slot 0; **cross-account tests may request slot
  1**" — slot 1 was built speculatively for this phase. `research.md:167-168`
  names the second seed user as "**Phase 3's concern**".
- **PRD** — `prd.md:131` (NFR): "Data is isolated per account: a user's plants,
  photos, and watering history are visible only to that user's account, and no
  plant or task data crosses between users." `prd.md:147` (Access Control): "Flat
  ownership model — no roles… there is no admin, no shared collections, and **no
  cross-user visibility**."
- **`context/foundation/lessons.md`** — zero entries touch RLS, ownership or
  isolation. No prior lesson constrains this phase.

**The cross-cutting conclusion:** every isolation claim in this repo's history
rests on a manual tick or an inspection. The one executed probe found a CRITICAL
defect. That is the strongest possible argument for this phase, and it should be
quoted in the plan's motivation.

## Recommended Test Inventory (input to `/10x-plan`)

Ordered by value. Layer choice follows §1's cost × signal principle — SQL where
the property is a grant or a policy, integration where it is an Action contract.

**Tier 1 — the unasserted core property (read isolation).** No test exists at any
layer today.

1. B selects A's plant by direct id → zero rows. *(SQL + integration)*
2. B selects A's `watering_events` by `plant_id` and by direct event id → zero
   rows. Separate assertion from #1 — separate RLS dependency
   (`src/pages/plants/[id].astro:46-50`). *(SQL + integration)*
3. B invoking `updatePlant` on A's plant gets `NOT_FOUND` — the pre-read
   (`src/actions/index.ts:112-118`) is the only mutation control-flow that depends
   on read RLS. *(integration)*

**Tier 2 — the confirmed open hole and the structural fragilities.**

4. B inserts a plant whose `current_watering_event_id` points at A's event →
   assert the current behaviour and the resulting `23503` on A's undo. This is
   the F1 attack on the un-narrowed verb
   (`supabase/migrations/20260719120000_create_plants.sql:35`). *(SQL)*
   **Expected to fail — file the defect rather than encoding today's behaviour as correct.**
5. B attempts `update plants set user_id = B where id = <A's plant>` → rejected /
   zero rows. Tests the *policy*, complementing the existing *grant* assertion at
   `supabase/tests/undo-integrity.sql:354-358`. *(SQL)*
6. `update_plant_schedule` on a foreign plant raises `P0002` **before** the
   unguarded `return query` — pins the one-guard-deep invariant at
   `.../20260801120002:149-152`. Already covered at
   `supabase/tests/undo-integrity.sql:315-330`; add an explicit comment tying it
   to the unguarded return so a future refactor cannot quietly drop it. *(SQL)*

**Tier 3 — completing the per-verb matrix.**

7. `postpone_plant` cross-account (the only RPC with no cross-user SQL case).
8. Action-layer cross-account for `markWatered`, `postponePlant`,
   `undoWateringEvent` → assert `NOT_FOUND` **and** that A's `next_due_on` and
   full event set are unchanged afterwards.
9. Storage: A uploads; B `download`s the exact path → error, plus a **positive
   control** that A can download it. See the trap in §4.4.
10. B sets their own plant's `photo_path` to `A-uid/<uuid>.jpg`
    (`.../20260801120002:107` writes it verbatim) → assert the storage layer still
    denies B a signed URL. This is a pointer leak, not a content leak — the test
    proves storage is what stops it.

**Explicitly out of scope for this phase:** anything needing an HTTP boundary
(§4.4 gap 3) — the middleware redirect and the `/api/auth/*` routes. That is a
different capability purchase and belongs in a later phase, not smuggled in here.

### 4.4 Harness gaps to close first

1. **A non-throwing user-scoped reader** — `tryReadPlant(fixture, plantId)` using
   `.maybeSingle()`, so "B sees zero rows" is a positive assertion.
   `readPlantState` throws on an RLS miss (`test/fixtures/plants.ts:64-66`).
2. **A shared "denied" assertion helper** — denial arrives in at least three
   shapes (`ActionError` `NOT_FOUND`, a silent zero-row PostgREST result, an empty
   Storage listing). A shared helper is what stops a test accepting the wrong one.
3. **No raw HTTP capability** — in-process only. Not a small addition; keep it out
   of scope.
4. **No shared photo fixture** — `uploadPhoto` is file-local to
   `src/actions/update-plant.integration.test.ts:60-70` and hardcodes slot 0.
5. **⚠ A trap: `assertNoStorageObjects(attackerClient, victimUserId)` would pass
   trivially.** Supabase Storage `list` under a denying policy returns an empty
   array, **not** an error — so "denied" and "empty" are indistinguishable and the
   assertion can never fail. Cross-account storage tests must assert positively
   (owner downloads successfully; attacker's `download` errors). This is exactly
   the §2 anti-pattern — an assertion that green-lights the bug.
6. **No watering-event fixture** — events exist only by invoking `markWatered`, so
   every undo-isolation test costs an extra Action round trip.
7. **`pnpm test:sql` has no runner** (`package.json:15`) — a third SQL file
   requires editing the script. Trivial, but it is a step the plan must include.
8. **Slot budget is exactly 2** (`test/fixtures/user.ts:35`) — sufficient for
   isolation. Do not raise it; the comment at `:392-394` explains the sign-in
   budget.

Constraints for any new integration file: place it under `src/` as
`<area>/<name>.integration.test.ts` (the include glob is `src/**` —
`vitest.integration.config.ts:35`; a test under `test/` **will not run**); import
`describe`/`expect`/`test` explicitly; no `test.concurrent`; acquire both fixtures
at the top of the test, since slot resets are lazy and per-slot.

## Open Questions

1. **Is open hole #1 (INSERT-path FK poisoning) real end to end?** The grant and
   policy are confirmed by direct inspection; the *consequence* (A's undo failing
   with `23503`) is inferred from the F1 write-up rather than re-executed. A probe
   during planning would settle it — and it is the same probe that produced the
   only real finding in this repo's history.
2. **Does production match the migrations?** All findings derive from
   `supabase/migrations/`. A policy dropped by hand in the hosted project would be
   invisible here. `context/deployment/deployment-plan.md:68` confirms only the
   anon key is deployed, but says nothing about policy drift.
3. **Does the local stack add storage policies beyond the migration?** Supabase
   seeds some `storage.objects` defaults; confirming needs a live query, which a
   read-only pass did not run. It matters because a permissive default would make
   a storage isolation test pass locally and fail in production, or vice versa.
4. **What does `createSignedUrls` do with a mixed batch** (some own, some foreign
   paths) — partial success or whole-batch error? The code handles per-item errors
   (`src/pages/plants/index.astro:35`, `src/lib/services/load-today-plants.ts:47`),
   but the behaviour is empirical and worth pinning.
5. **Orphaned storage objects after plant delete** — `roadmap.md:170` requires
   delete to clean up tasks and journal "so no orphaned rows leak across the
   account boundary", but does not mention storage objects. There is no delete
   Action yet, so this is a future-phase concern, not Phase 3's.
6. **Should Tier-2 item #4 be fixed in this change or filed separately?** The
   phase's mandate is to *prove* isolation, not to repair it. Writing a test that
   documents today's broken behaviour as expected would be the worst outcome; the
   plan needs an explicit decision here.
