# Per-Account Isolation Implementation Plan

## Overview

Prove that User B, authenticated, cannot read or mutate User A's plant, task, or
photo when addressing it **by direct id** rather than through the UI — across
every operation and every enforcement mechanism — and close the one confirmed
open hole discovered while establishing that proof.

This is Rollout Phase 3 of `context/foundation/test-plan.md`, covering Risk #5
(one authenticated user reads or mutates another user's data because ownership is
not checked, only authentication).

The motivating fact, quoted directly from research: **every isolation claim in
this repo's history rests on a manual tick or a code inspection. The one time
anyone actually executed a cross-user probe, they found a CRITICAL cross-user
defect** (`context/archive/2026-07-31-undo-integrity-defects/reviews/impl-review.md:61-84`).

## Current State Analysis

Isolation is enforced by **four different mechanisms, and which one is
load-bearing changes per operation.** This is the central fact for test design —
a test author who assumes "RLS protects everything" writes tests that pass for
the wrong reason on three of the four.

| Mechanism | Applies to | State today |
| --- | --- | --- |
| Hand-written `user_id = v_user_id` predicates inside four `SECURITY DEFINER` RPCs | **all mutations** of plants and events | Correct in all four. `FORCE ROW LEVEL SECURITY` is absent, so RLS is *off* inside these functions and these predicates are the entire boundary. |
| Column-scoped `UPDATE` grant on `plants` | direct PostgREST writes | The only thing preventing ownership transfer — `plants_update_own` has no `WITH CHECK`. |
| RLS `SELECT` policies | **all reads** (pages, list, journal, `updatePlant` pre-read) | Correct, and **never once asserted by an automated test at any layer**. |
| `storage.objects` folder-prefix policies | every photo verb | The cleanest layer; all four verbs covered, `UPDATE` has both `USING` and `WITH CHECK`. |

**One confirmed open hole.** The `plants` INSERT grant is still table-wide
(`supabase/migrations/20260719120000_create_plants.sql:35`), while only the
UPDATE grant was narrowed by the F1 fix
(`supabase/migrations/20260801120002_secure_and_index_undo_stack.sql:23-31`). The
`current_watering_event_id` FK-poisoning attack that F1 closed on the UPDATE verb
is therefore **still open on the INSERT verb** — precisely the failure shape the
change brief names: "per-operation policies can permit one verb while another
path bypasses them."

**Two structural fragilities**, safe today only because of a single upstream
guard:

- `plants_update_own` has `USING` and **no `WITH CHECK`**
  (`supabase/migrations/20260719120000_create_plants.sql:49-52`). Ownership
  transfer is blocked *only* by the column grant. A grant regression and a policy
  regression are different failures; today only the former is asserted.
- `update_plant_schedule`'s final `return query select * from public.plants where
  id = p_plant_id` has no owner predicate, inside a `SECURITY DEFINER` function
  where RLS does not apply
  (`supabase/migrations/20260801120002_secure_and_index_undo_stack.sql:149-152`).
  Unreachable today because the guard at `:91-97` raises `P0002` first — one
  guard deep, returning the full row including `user_id` straight to the client.

**No privileged client exists.** One Supabase client factory
(`src/lib/supabase.ts:6-26`), publishable key plus session cookies. No
`service_role` key is declared, imported, or deployed. Privilege escalation lives
entirely in `SECURITY DEFINER` functions, not in a key.

**Harness state.** No new fixture infrastructure is needed. Slot 1 was built
during Phase 2 specifically for this phase and is unused at the Action layer.
Invoking an Action as user X against user Y's row id works today with zero new
helpers. Six smaller helper gaps exist, one of which is a trap that would produce
a permanently-passing test.

### Key Discoveries

- **Denial has three distinct shapes**: `ActionError` `NOT_FOUND`, a silent
  zero-row PostgREST result, and a Storage error. There is **no `FORBIDDEN`
  anywhere in the codebase** — foreign id and nonexistent id both collapse to
  `NOT_FOUND` (`src/actions/index.ts:125,179,197,249,289,324`). Asserting
  `FORBIDDEN` would fail against correct code; asserting "it threw" would pass
  against a harness bug.
- **The 404 indistinguishability is a deliberate design property, not an
  accident** — `context/archive/2026-07-25-edit-plant-and-recalc/design.md:287`
  says the edit route 404s "as the detail route rather than revealing ownership".
  That makes it assertable.
- **The journal query is a separate RLS dependency from the plant query.**
  `src/pages/plants/[id].astro:46-50` keys on `plant_id`, not `user_id`, so a
  plant-RLS-holds / events-RLS-regresses split surfaces only there. It needs its
  own assertion.
- **`updatePlant`'s pre-read uses `.maybeSingle()`** (`src/actions/index.ts:118`),
  so a foreign plant yields `null` → `NOT_FOUND`. Read RLS is the *only* control
  on that mutation's control flow — the read-isolation test is a mutation
  safeguard too.
- **`readPlantState` throws on an RLS miss** (`test/fixtures/plants.ts:64-66`,
  `.single()`). Usable to assert "A's row is unchanged", **not** usable to assert
  "B sees nothing" without conflating denial with a broken fixture.
- **The SQL suite already has the impersonation idiom.** `set local
  request.jwt.claims = '{"sub":"…","role":"authenticated"}'` inside `begin; …
  rollback;` (`supabase/tests/undo-integrity.sql:25-26`). Switching the claim
  mid-transaction *is* impersonation, and it costs no sign-in budget.
- **`createPlantFixture` inserts `id` explicitly** (`test/fixtures/plants.ts:41`)
  while `addPlant` does not (`src/actions/index.ts:69-76`). Any narrowing of the
  INSERT grant must retain `id` or every integration test breaks.
- **Slot budget is exactly 2** (`test/fixtures/user.ts:35`). Do not raise it —
  the comment at `:392-394` records that Supabase's sign-in limit is 30 per 5
  minutes per IP (`supabase/config.toml:189`).
- **`pnpm test:sql` has no runner** — two hardcoded `psql` invocations
  (`package.json:15`).

## Desired End State

Every operation on every mechanism has an executed cross-account assertion, at
the cheapest layer that can express it. The confirmed INSERT-grant hole is
closed by a migration and pinned by a regression test. `pnpm test:sql` picks up
new SQL files automatically. `context/foundation/test-plan.md` §6.4 documents
the pattern so Phase 4 and later contributors extend it rather than reinvent it.

Verified by: `pnpm test:sql` and `pnpm test:integration` both green, with the
INSERT-grant regression test demonstrably failing when the new migration is
reverted.

## What We're NOT Doing

- **Any HTTP-boundary test.** The harness is in-process by design
  (`context/foundation/test-plan.md:218-220`). The middleware redirect and the
  `/api/auth/*` routes need a raw HTTP capability that is a separate purchase and
  belongs to a later phase — not smuggled in here.
- **Relitigating the RLS-only-for-reads decision.** The earliest impl-review
  (`context/archive/2026-07-19-core-watering-loop/reviews/impl-review.md:53-62`,
  F4) called it single-layer defence; `edit-plant-and-recalc` decided the
  opposite for reads six days later
  (`context/archive/2026-07-25-edit-plant-and-recalc/plan.md:73-76`: "none should
  be added as a substitute for RLS"). **This phase tests the boundary as
  designed.** A failing read-isolation test has exactly one correct fix — repair
  the policy — not two.
- **Hardening the two structural fragilities.** They are pinned by tests with
  comments naming the fragility, not changed. Adding a `WITH CHECK` or an owner
  predicate to the unguarded `return query` is a schema change this phase did not
  ask for.
- **Raising `USER_SLOT_COUNT` above 2.** Two slots are sufficient for isolation.
- **Adding a plant-delete test path.** No delete Action exists; DELETE is
  reachable only by hand-crafted PostgREST. The grant and policy are asserted at
  the SQL layer only.
- **Wiring the CI gate.** Phase 5 of the rollout (quality-gates) owns gate wiring
  for every layer; doing it piecemeal here means two CI configurations to
  reconcile.
- **Orphaned storage objects after plant delete** (`roadmap.md:170`). No delete
  Action exists yet.
- **Verifying production matches the migrations.** All findings derive from
  `supabase/migrations/`. Policy drift in the hosted project is out of scope and
  recorded as an open risk.

## Implementation Approach

**Layer allocation is deliberate and stated per assertion**, because the biggest
waste here would be writing the same check twice at two costs:

- **SQL layer** (`supabase/tests/per-account-isolation.sql`) owns anything that
  is a *policy* or a *grant* primitive: zero-row selects under a foreign JWT
  claim, `has_column_privilege` assertions, RPC `P0002` raises. Transaction-scoped
  and fast; costs no sign-in budget.
- **Integration layer** (`*.integration.test.ts`) owns anything that is an
  *Action contract* or a *client-path* property SQL cannot see: the `NOT_FOUND`
  collapse, victim-state-unchanged after a rejected mutation, and Storage verbs
  through the real signed-URL path.

**Every denial assertion is shape-specific and paired with a positive control.**
A green isolation test is only meaningful if the same setup demonstrably works
for the owner — otherwise a fixture that silently stopped creating rows makes
every test pass vacuously. This is the anti-pattern §2 of the test plan names
most often, and §4.4 of the research documents a concrete instance of it.

**The INSERT-grant fix mirrors the proven F1 remedy** — `revoke insert` then
`grant insert (<explicit columns>)` — rather than inventing a new mechanism.

## Critical Implementation Details

**Storage `list` cannot express denial.** Under a denying policy Supabase Storage
`list` returns an **empty array, not an error**, so "denied" and "empty" are
indistinguishable and an assertion built on it can never fail. Cross-account
storage tests must assert positively: the owner's `download` succeeds *and* the
attacker's `download` errors. Note this **inverts** the existing same-user idiom
in `src/actions/update-plant.integration.test.ts`, which correctly asserts
absence by listing — that comment is right for its case and wrong for this one.

**Fixture acquisition ordering.** Slot resets are lazy and per-slot, so both
user fixtures must be acquired at the **top** of a test before any row creation.
Acquiring slot 1 midway can reset it after slot 0's rows exist.

**Watering events cannot be inserted directly.** The INSERT and DELETE grants and
policies on `watering_events` were deliberately revoked
(`supabase/migrations/20260723120000_add_postpone_and_undo.sql:12-14`) — net
SELECT only. This is intentional deny-by-default, not a gap. Any event fixture
must go through the `mark_watered` RPC, and tests should assert the *grant
absence*, not look for a missing policy.

**The INSERT grant must retain `id` and `user_id`.** `createPlantFixture` writes
`id` explicitly (`test/fixtures/plants.ts:41`) and `addPlant` writes `user_id`
(`src/actions/index.ts:70`), which the RLS `with check (auth.uid() = user_id)`
requires. Withholding either breaks the app or the entire integration suite.

---

## Phase 1: Read Isolation and Harness Groundwork

### Overview

Assert the single property this phase exists to prove and which no test covers
today at any layer: B cannot read A's plant or A's watering events by direct id.
Land the harness helpers that make "B sees nothing" a positive assertion rather
than an ambiguous thrown error, and replace the hardcoded SQL runner so the new
SQL file cannot be silently omitted.

### Changes Required

#### 1. Non-throwing user-scoped readers

**File**: `test/fixtures/plants.ts`

**Intent**: `readPlantState` throws on an RLS miss, so it cannot distinguish
"correctly denied" from "fixture broken". Add readers that return absence as a
value, so zero-row denial becomes a positive assertion.

**Contract**: Export `tryReadPlant(userFixture, plantId): Promise<PlantRow |
null>` and `tryReadWateringEvents(userFixture, plantId):
Promise<WateringEventRow[]>`, both using `userFixture.client` (anon key, RLS
applies — **not** a privileged peek) and `.maybeSingle()` / plain select. A
genuine PostgREST error still throws; only an RLS-filtered miss returns
`null` / `[]`. Also export `tryReadWateringEventById(userFixture, eventId):
Promise<WateringEventRow | null>` — the journal reads by `plant_id`, but direct
event-id addressing is a separate attack shape. Leave `readPlantState` unchanged;
it remains the right tool for "A's row is unchanged".

#### 2. Shape-specific denial assertions

**File**: `test/fixtures/denial.ts` (new)

**Intent**: Denial arrives in three shapes and a helper that accepts all three
cannot tell you which one it got — an Action regressing from `NOT_FOUND` to a
thrown fixture error would still pass. One narrow assertion per shape.

**Contract**: Export three assertions, each documenting in a comment which
mechanism it covers and why the other two shapes are not interchangeable:

- `expectActionNotFound(call: () => Promise<unknown>): Promise<void>` — awaits
  the rejection and asserts the thrown value is an `ActionError` whose `code` is
  exactly `"NOT_FOUND"`. Must fail on a generic `Error`, on
  `INTERNAL_SERVER_ERROR`, and on a resolved promise.
- `expectNoRowVisible(value: unknown | null): void` — asserts a `tryRead*` result
  is `null` (or `[]` for the list form), the PostgREST zero-row shape.
- `expectStorageDenied(result: { data: unknown; error: unknown }): void` —
  asserts `error` is non-null **and** `data` is null. Carries the comment that
  `list` returning `[]` is not denial.

#### 3. Glob-based SQL runner

**File**: `scripts/run-sql-tests.sh` (new), `package.json`

**Intent**: `test:sql` is two hardcoded `psql` invocations; a third file requires
editing the script, and a forgotten file is a green suite that tests nothing.

**Contract**: A shell script iterating every `supabase/tests/*.sql` in sorted
order, each run with `-v ON_ERROR_STOP=1` against the same local connection
string used today. Must exit non-zero on the first failing file — per the lessons
register's "always verify command status codes", a loop that swallows a non-zero
`psql` exit is the specific defect to avoid here. `package.json`'s `test:sql`
becomes an invocation of the script.

#### 4. SQL read-isolation cases

**File**: `supabase/tests/per-account-isolation.sql` (new)

**Intent**: Assert the RLS `SELECT` policies on both tables actually filter by
owner — the mechanism carrying every read in the application, currently unproven.

**Contract**: Follows the established `begin; … rollback;` structure of
`supabase/tests/undo-integrity.sql`: seed two `auth.users` and owned rows in a
`do $$` block, then `set local role authenticated` and switch
`request.jwt.claims` between the two subjects. Assertions, each raising a named
exception on failure:

- As B: `select` A's plant by direct id → 0 rows. **Positive control**: as A, the
  same select → 1 row.
- As B: `select` A's `watering_events` by `plant_id` → 0 rows, and by direct
  event id → 0 rows. Asserted separately from the plant, with a comment tying it
  to `src/pages/plants/[id].astro:46-50` and its independent RLS dependency.
  **Positive control**: as A, both selects return the seeded rows.
- Assert `authenticated` holds no INSERT, UPDATE or DELETE privilege on
  `public.watering_events` via `has_table_privilege` — the deny-by-default design,
  asserted as a grant rather than as a missing policy.

#### 5. Integration read-isolation cases

**File**: `src/lib/services/per-account-isolation.integration.test.ts` (new)

**Intent**: Assert the same property through the real JWT path — cookie jar →
`src/lib/supabase.ts` → Supabase JWT → RLS — which the SQL layer's synthetic
claim cannot exercise. Placed beside `load-today-plants.integration.test.ts`,
today's only two-user test.

**Contract**: Both fixtures acquired at the top (`getIntegrationUserFixture(1)`
then `getIntegrationUserFixture()`). Per the lessons register, top-level
`describe` blocks are named after the function under test, as siblings — no
module-level wrapper. Cases:

- B reading A's plant by direct id → `expectNoRowVisible`; positive control that
  A reads it.
- B reading A's watering events by `plant_id` and by event id → both
  `expectNoRowVisible`; positive control for A. Events created by invoking
  `markWatered` as A.
- B invoking `updatePlant` on A's plant id → `expectActionNotFound`. This case
  belongs here rather than in Phase 2 because it is the pre-read
  (`src/actions/index.ts:112-118`) that denies it — a read-RLS property wearing
  an Action's clothes. A comment must say so, or a future reader moves it.

### Success Criteria

#### Automated Verification

- Glob runner discovers all three SQL files and passes: `pnpm test:sql`
- Integration suite passes: `pnpm test:integration`
- Unit suite unaffected: `pnpm test`
- Type checking passes: `pnpm check`
- Linting passes: `pnpm lint`
- Deliberate-break check: temporarily drop `plants_select_own` and confirm both
  the SQL and integration read-isolation cases fail

#### Manual Verification

- `scripts/run-sql-tests.sh` exits non-zero when any single SQL file fails,
  confirmed by temporarily breaking one assertion
- Each positive control fails when its fixture creation is removed, confirming
  the tests cannot pass vacuously

**Implementation Note**: After completing this phase and all automated
verification passes, pause here for manual confirmation from the human before
proceeding to Phase 2.

---

## Phase 2: Mutation Isolation and the INSERT-Grant Fix

### Overview

Complete the per-verb cross-account matrix at both layers, and close the
confirmed open hole: narrow the table-wide `plants` INSERT grant so B cannot
insert a plant pointing at A's watering event.

### Changes Required

#### 1. Narrow the `plants` INSERT grant

**File**: `supabase/migrations/20260802120000_narrow_plants_insert_grant.sql` (new)

**Intent**: Close the FK-poisoning attack on the INSERT verb, mirroring the F1
fix applied to UPDATE. B can currently insert their own plant with
`current_watering_event_id` pointing at A's event; A's undo and plant deletion
then fail at constraint-check time with `23503` — a cross-tenant denial of
service the victim cannot clear.

**Contract**: `revoke insert on public.plants from authenticated`, then `grant
insert (id, user_id, name, growing_interval_days, dormancy_interval_days,
next_due_on, photo_path) on public.plants to authenticated`.

`id` is retained because `createPlantFixture` writes it explicitly
(`test/fixtures/plants.ts:41`); `user_id` because `addPlant` writes it
(`src/actions/index.ts:70`) and the RLS `with check (auth.uid() = user_id)`
requires it. `current_watering_event_id` is the column being withheld —
`created_at` and `updated_at` are withheld alongside it since both have defaults
and neither is client-authored. The migration must carry a comment explaining
that this is the INSERT-verb counterpart of the UPDATE narrowing in
`20260801120002`, so the pair is not separated by a future refactor.

#### 2. INSERT-grant regression assertions

**File**: `supabase/tests/per-account-isolation.sql`

**Intent**: Pin the fix. F10's meta-lesson
(`context/archive/2026-07-31-undo-integrity-defects/reviews/impl-review.md:292-299`)
is that nothing would catch a future migration re-granting these columns.

**Contract**: Assert `has_column_privilege('authenticated', 'public.plants',
'current_watering_event_id', 'insert')` is **false**, alongside `created_at` and
`updated_at`. Then assert the columns the app legitimately writes on insert —
`id`, `user_id`, `name`, `growing_interval_days`, `dormancy_interval_days`,
`next_due_on`, `photo_path` — **remain granted**, aggregating any that are
missing into one named exception. Without that second half the app breaks in a
way no other assertion catches.

Add a behavioural case: as B, attempt an insert setting
`current_watering_event_id` to A's event id → must be rejected. Positive control:
the same insert without that column succeeds.

#### 3. SQL mutation-isolation cases

**File**: `supabase/tests/per-account-isolation.sql`

**Intent**: Fill the two RPC/policy gaps research identified and pin the two
structural fragilities without changing them.

**Contract**:

- As B: `insert into plants (..., user_id, ...) values (..., <A>, ...)` →
  rejected by `plants_insert_own`. **Positive control**: the equivalent insert
  with B's `user_id` succeeds. This is distinct from the FK-poisoning case above:
  that case tests the narrowed column grant on B's own row; this one tests the
  INSERT policy's ownership check.
- `postpone_plant` invoked as B against A's plant → raises `P0002`. The only RPC
  with no existing cross-user SQL case.
- As B: update an allowed column such as `name` on A's plant → 0 rows affected.
  This tests `plants_update_own`; attempting to update `user_id` would fail the
  column grant before RLS is evaluated and therefore cannot prove the policy.
  Keep the existing `user_id` privilege assertion at
  `supabase/tests/undo-integrity.sql:354-358` as the separate ownership-transfer
  control. The case must carry a comment recording that the policy has no
  `WITH CHECK` (`20260719120000_create_plants.sql:49-52`) and the grant and policy
  are independent controls.
- As B: delete A's plant by id → 0 rows affected. **Positive control**: A can
  delete an owner-controlled disposable plant. This executes
  `plants_delete_own`, which is otherwise reachable only through direct
  PostgREST/SQL because no delete Action exists.
- `update_plant_schedule` as B against A's plant → raises `P0002`. Already
  covered at `supabase/tests/undo-integrity.sql:315-330`; the addition here is a
  comment tying the raise to the **unguarded final `return query`** at
  `20260801120002:149-152`, which has no owner predicate and returns the full row
  including `user_id`. The guard is one deep; the comment is what stops a future
  refactor quietly dropping it.

#### 4. Action-layer cross-account mutations

**File**: `src/actions/per-account-isolation.integration.test.ts` (new)

**Intent**: Assert the Action contract that SQL cannot see — the `NOT_FOUND`
collapse — and, critically, that a rejected mutation wrote nothing. The RPCs are
`SECURITY DEFINER` with RLS off, so a partial write before a raise is physically
possible; an error response alone does not prove nothing happened.

**Contract**: For each of `markWatered`, `postponePlant` and `undoWateringEvent`,
invoked via `createActionContext(attackerFixture)` with a `FormData` carrying A's
plant or event id:

- `expectActionNotFound` on the call.
- A full before/after snapshot of A's state via `readPlantState(ownerFixture,
  plantId)`, asserting the plant row **and** the complete ordered
  `watering_events` array are unchanged. Per the §6.3 cookbook rule applied to
  the abuse path: assert every field whose state matters, not just the one the
  Action would have touched. The event set matters most — F1's damage was an
  injected FK, not a changed column.
- `undoWateringEvent` requires an event to exist, created by invoking
  `markWatered` as A first.

Do not add another `createSessionlessActionContext` case here. Without a session
cookie that context reaches PostgREST as `anon`, and the RPC's authenticated-only
EXECUTE grant rejects it with `42501` before the function can raise `28000`.
`src/actions/harness.integration.test.ts:53-74` already pins the real
`42501` → `INTERNAL_SERVER_ERROR` Action contract. Function-level null-UID
guards are outside this cross-account matrix; if they need direct coverage, use
an authenticated SQL role with no subject claim rather than this Action context.

### Success Criteria

#### Automated Verification

- Migration applies cleanly against a reset local stack
- SQL suite passes: `pnpm test:sql`
- Integration suite passes: `pnpm test:integration`
- Type checking passes: `pnpm check`
- Linting passes: `pnpm lint`
- Reverting `20260802120000` makes the INSERT-grant regression cases fail —
  demonstrating the test would have caught the hole
- Foreign-owner plant INSERT, allowed-column UPDATE and DELETE policy cases pass with owner positive controls

#### Manual Verification

- Adding a plant through the running app still works end to end, with and without
  a photo — the narrowed INSERT grant does not break the real write path
- Editing an existing plant still works, confirming the UPDATE grant is untouched

**Implementation Note**: After completing this phase and all automated
verification passes, pause here for manual confirmation from the human before
proceeding to Phase 3.

---

## Phase 3: Storage Isolation and Close-Out

### Overview

Cover the photo half of Risk #5 — "another user's plant, task, or **photo**" —
then document the pattern in the test plan so Phase 4 and later contributors
extend it rather than reinvent it.

### Changes Required

#### 1. Shared photo fixture

**File**: `test/fixtures/photos.ts` (new), `src/actions/update-plant.integration.test.ts`

**Intent**: The upload helper is file-local to `update-plant.integration.test.ts`
and hardcodes slot 0, so no cross-account test can use it.

**Contract**: Extract `createPhotoFile()`, `uploadPhotoFixture(userFixture,
path)` and `downloadPhoto(userFixture, path)` into a shared fixture, each taking
the user fixture as a parameter rather than calling
`getIntegrationUserFixture()` internally. Update
`update-plant.integration.test.ts` to import them. The current
`expectPhotoRetrievable(path)` both downloads and asserts; split that helper so
`downloadPhoto()` returns the Storage result and keep its existing assertions at
the caller. This is a small caller-contract rewrite plus parameterisation, and
the test's observable behaviour must not change.

#### 2. Cross-account storage cases

**File**: `src/actions/per-account-isolation.integration.test.ts`

**Intent**: Prove the `storage.objects` folder-prefix policies deny a foreign
path, and that the verbatim `photo_path` write is not a content leak.

**Contract**:

- A uploads a photo at a path built by `buildPhotoPath(A.userId, mime)`. B calls
  `download` on that exact path → `expectStorageDenied`. **Positive control**: A
  calls `download` on the same path and receives a non-empty blob. The positive
  control is not optional here — without it the test cannot distinguish a working
  policy from a failed upload.
- A uploads an object, then B writes that A-prefixed path into B's own plant via
  `attackerFixture.client.from("plants").update({ photo_path: ownerPath }).eq("id",
  attackerPlant.id)`. This direct PostgREST update is legal because `photo_path`
  is an allowed UPDATE column and RLS admits B's own row; `updatePlant` is not the
  route because it never accepts an arbitrary path. Assert the write succeeded,
  then call `resolvePhotoUrl(ownerFixture.client, ownerPath)` and require a
  non-null URL as the positive control; the same call with
  `attackerFixture.client` must return `null`. A comment must state that this is a
  **pointer leak, not a content leak**: the database accepts the string, and the
  real application resolver plus Storage policy stops B from turning it into a
  usable URL. A reader who assumes the database should have rejected it would
  fix the wrong layer.
- **INSERT policy**: B attempts to upload a new object at an A-prefixed path →
  Storage error and no object. **Positive control**: A uploads that path and can
  download the bytes.
- **UPDATE policy**: A uploads a baseline object; B attempts to replace the same
  A-prefixed path → Storage error and A still downloads the original bytes.
  **Positive control**: A replaces it and downloads the replacement bytes. This
  pins both `USING` and `WITH CHECK` on `plant_photos_update_own`.
- **DELETE policy**: A uploads a disposable object; B attempts to remove it. Do
  not rely only on the remove response, which may represent a policy-filtered
  no-op: assert A can still download the object afterwards. **Positive control**:
  A removes it and an owner-scoped absence check confirms it is gone.

Use a separate object path per verb so the INSERT, UPDATE and DELETE controls do
not depend on execution order. Together with the download/signing cases, these
execute all four `storage.objects` policies under foreign and owner JWTs.

#### 3. Test plan documentation

**File**: `context/foundation/test-plan.md`

**Intent**: §6.4 currently reads "TBD — see §3 Phase 3". Fill it, and move the
phase status.

**Contract**: Write §6.4 covering: the two-slot fixture and why the budget is
capped at 2; the layer-allocation rule (SQL for policy and grant primitives,
integration for Action contracts and client paths); the requirement that every
denial assertion is shape-specific and paired with a positive control; and the
Storage `list` trap explicitly, since it is the one mistake that produces a
permanently-green test. Set §3 Phase 3 Status to `complete`. Leave §5's
"per-account isolation — required after §3 Phase 3" row as-is; CI wiring is
Phase 5's.

#### 4. Change close-out

**File**: `context/changes/testing-per-account-isolation/change.md`

**Intent**: Reflect completion.

**Contract**: `status: complete`, `updated` stamped.

### Success Criteria

#### Automated Verification

- SQL suite passes: `pnpm test:sql`
- Integration suite passes: `pnpm test:integration`
- Unit suite passes: `pnpm test`
- Type checking passes: `pnpm check`
- Linting passes: `pnpm lint`
- `update-plant.integration.test.ts` passes unchanged after the fixture
  extraction
- Storage SELECT, INSERT, UPDATE and DELETE isolation cases pass with owner positive controls

#### Manual Verification

- Uploading and viewing a photo through the running app still works
- The cross-account `download` denial fails if the positive control's upload is
  removed — confirming it is not passing vacuously
- §6.4 is specific enough that a contributor could add a fourth isolation case
  without reading this plan

**Implementation Note**: This is the final phase. After automated verification
passes, confirm the manual checks before closing the change.

---

## Testing Strategy

### SQL layer (`supabase/tests/per-account-isolation.sql`)

- Read isolation on both tables, by `plant_id` and by direct id, with positive
  controls
- `watering_events` grant absence (deny-by-default asserted as a grant)
- `plants` INSERT column-privilege matrix, both negative and positive halves
- FK-poisoning insert rejected; clean insert accepted
- `postpone_plant` and `update_plant_schedule` cross-account `P0002`
- Allowed-column foreign UPDATE affects zero rows; ownership-column UPDATE stays denied by its grant
- Foreign-owner INSERT and DELETE are denied, with owner positive controls

### Integration layer

- `src/lib/services/per-account-isolation.integration.test.ts` — read isolation
  through real JWTs, plus `updatePlant`'s read-RLS-dependent `NOT_FOUND`
- `src/actions/per-account-isolation.integration.test.ts` — `markWatered`,
  `postponePlant`, `undoWateringEvent` cross-account with full victim-state
  snapshots; signed-URL isolation; and cross-account Storage SELECT, INSERT,
  UPDATE and DELETE cases

### Manual testing steps

1. Add a plant with a photo through the running app — confirm the narrowed INSERT
   grant does not break the real write path
2. Edit that plant, changing name, both intervals, and replacing the photo
3. Water, postpone and undo it — confirm no RPC regressed
4. Revert `20260802120000` locally, re-run `pnpm test:sql`, confirm the
   INSERT-grant cases fail, then restore it

### Deliberate-break checks

Each phase's automated criteria include one break-and-confirm step. These are the
guard against the anti-pattern the test plan names most often — an assertion
whose expected value was lifted from the implementation under test. A test that
cannot be made to fail is not evidence.

## Performance Considerations

The SQL suite is transaction-scoped and adds negligible time. The integration
additions are constrained by the **sign-in budget**, not by CPU: Supabase allows
30 sign-ins per 5 minutes per IP (`supabase/config.toml:189`), which is why
`USER_SLOT_COUNT` is 2. Slots are reused within a worker, so adding tests does
not add sign-ins — but `test.concurrent` must not be used, since slots and cookie
jars are intentionally shared. `maxWorkers` stays at 2
(`vitest.integration.config.ts:44`).

Pushing the grant and policy primitives to SQL rather than duplicating them at
the integration layer is a deliberate cost choice, not only a correctness one.

## Migration Notes

`20260802120000_narrow_plants_insert_grant.sql` is a privilege change with no
data movement — it is safe to apply to a populated database and reversible by
re-granting. The only compatibility surface is code that inserts into
`public.plants`: `addPlant` (`src/actions/index.ts:69-76`) and
`createPlantFixture` (`test/fixtures/plants.ts:36-48`). Both are covered by the
retained column list; there are no other insert paths in the repo.

Per the lessons register, confirm the local seed still applies cleanly after the
migration.

## References

- Research: `context/changes/testing-per-account-isolation/research.md`
- Change brief: `context/changes/testing-per-account-isolation/change.md`
- Test plan: `context/foundation/test-plan.md` §2 Risk #5, §3 Phase 3, §6.4
- The F1 precedent (executed probe, CRITICAL finding, column-grant fix):
  `context/archive/2026-07-31-undo-integrity-defects/reviews/impl-review.md:61-84,126-138,292-299`
- SQL test idiom: `supabase/tests/undo-integrity.sql:1-26,296-393`
- Two-user integration idiom: `src/lib/services/load-today-plants.integration.test.ts:50-75`
- The UPDATE-grant narrowing this phase mirrors:
  `supabase/migrations/20260801120002_secure_and_index_undo_stack.sql:23-31`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Read Isolation and Harness Groundwork

#### Automated

- [x] 1.1 Glob runner discovers all three SQL files and passes: `pnpm test:sql` — 0239f72
- [x] 1.2 Integration suite passes: `pnpm test:integration` — 0239f72
- [x] 1.3 Unit suite unaffected: `pnpm test` — 0239f72
- [x] 1.4 Type checking passes: `pnpm check` — 0239f72
- [x] 1.5 Linting passes: `pnpm lint` — 0239f72
- [x] 1.6 Deliberate-break check: dropping `plants_select_own` fails both SQL and integration read-isolation cases — 0239f72

#### Manual

- [x] 1.7 `scripts/run-sql-tests.sh` exits non-zero when any single SQL file fails — 0239f72
- [x] 1.8 Each positive control fails when its fixture creation is removed — 0239f72

### Phase 2: Mutation Isolation and the INSERT-Grant Fix

#### Automated

- [x] 2.1 Migration applies cleanly against a reset local stack — fe4e489
- [x] 2.2 SQL suite passes: `pnpm test:sql` — fe4e489
- [x] 2.3 Integration suite passes: `pnpm test:integration` — fe4e489
- [x] 2.4 Type checking passes: `pnpm check` — fe4e489
- [x] 2.5 Linting passes: `pnpm lint` — fe4e489
- [x] 2.6 Reverting `20260802120000` makes the INSERT-grant regression cases fail — fe4e489
- [x] 2.10 Foreign-owner plant INSERT, allowed-column UPDATE and DELETE policy cases pass with owner positive controls — fe4e489

#### Manual

- [x] 2.7 Adding a plant through the running app still works, with and without a photo — fe4e489
- [x] 2.8 Editing an existing plant still works — fe4e489

### Phase 3: Storage Isolation and Close-Out

#### Automated

- [x] 3.1 SQL suite passes: `pnpm test:sql`
- [x] 3.2 Integration suite passes: `pnpm test:integration`
- [x] 3.3 Unit suite passes: `pnpm test`
- [x] 3.4 Type checking passes: `pnpm check`
- [x] 3.5 Linting passes: `pnpm lint`
- [x] 3.6 `update-plant.integration.test.ts` passes unchanged after the fixture extraction
- [x] 3.10 Storage SELECT, INSERT, UPDATE and DELETE isolation cases pass with owner positive controls

#### Manual

- [x] 3.7 Uploading and viewing a photo through the running app still works
- [x] 3.8 Cross-account `download` denial fails if the positive control's upload is removed
- [x] 3.9 §6.4 is specific enough to add a fourth isolation case without reading this plan
