<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Undo Integrity Defects

- **Plan**: context/changes/undo-integrity-defects/plan.md
- **Scope**: Phases 1–3 of 3 (full plan)
- **Date**: 2026-08-01
- **Verdict**: REJECTED at review time → **all findings triaged; 9 fixed, 1 skipped**
- **Findings**: 1 critical, 3 warnings, 6 observations

## Triage outcome (2026-08-01)

| | Findings |
|---|---|
| Fixed | F1 (Fix A), F2, F4, F5, F6, F7, F8, F9, F10 |
| Skipped | F3 — already documented in the commit message and in `lefthook.yml` itself |

Post-triage verification, after a full `pnpx supabase db reset`: `test:sql` 0 (with a
deliberate-break check on the two new grant assertions), `test:integration` 24/24, `test` 102/102,
`check` 0, `lint` 0, `stryker --mutate src/lib/errors.ts` 100% (20 killed, 0 survived).

Post-triage the Safety & Quality FAIL is cleared: the confirmed exploit no longer reproduces, and
`undo-integrity.sql` now fails if the grant that closed it is ever restored.

The verdict is driven **solely by F1**. Plan adherence is the strongest this reviewer has
seen in this repo — 13 of 13 planned changes verified MATCH, all 20 automated Progress rows
re-run green, and `src/lib/errors.ts` at a 100% mutation score. F1 is a security hole created
by a *new* column meeting a *pre-existing* blanket grant, and it is confirmed by an executed
exploit, not inferred.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | FAIL |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Success criteria re-run (all green)

| Command | Result |
|---|---|
| `pnpx supabase db reset` | PASS — both migrations applied |
| `pnpm test:sql` | PASS — both gates, exit 0 |
| `pnpm test:integration` | PASS — 24 tests / 5 files |
| `pnpm test` | PASS — 102 tests / 7 files |
| `pnpm check` | PASS — 0 errors, 0 warnings |
| `pnpm lint` | PASS — exit 0 |
| `stryker --mutate src/lib/errors.ts` | PASS — 100%, 20 killed, 0 survived |

Type regeneration verified: both header comment lines intact at `database.types.ts:1-2`; both
stack columns and `update_plant_schedule` present; no `.skip`/`.only` remains in any test file.

Manual rows: 1.9 is checked with an honest deferral note explaining it is only observable
alongside 3.6 — that is documented reasoning, not rubber-stamping. 2.8–2.10 and 3.6–3.8 each
have corresponding shipped code.

## Findings

### F1 — Any authenticated user can permanently break another user's undo and plant deletion

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260801120000_explicit_undo_stack.sql:7-8
- **Detail**: The new `plants.current_watering_event_id` is a plain FK to `watering_events(id)`
  with no validation that the referenced event belongs to the same user. `authenticated` holds a
  table-wide `UPDATE` grant on `public.plants` (`20260719120000_create_plants.sql:35`), and
  `plants_update_own` only constrains `user_id` — it cannot constrain which event UUID the column
  points at. The FK is `NO ACTION`, so a dangling inbound reference blocks the victim's own writes.

  **Confirmed by executed probe against the local stack** (not reasoning):
  - `PROBE 2 (write): tamper UPDATE affected 1 row(s)` — attacker sets their own plant's pointer
    to the victim's event id through an ordinary RLS-checked `UPDATE`.
  - `PROBE 5 (commit check): VICTIM BROKEN, 23503 : insert or update on table "plants" violates
    foreign key constraint "plants_current_watering_event_id_fkey"` — the victim's own
    `undo_watering_event` then fails at constraint-check time. Plant deletion fails identically,
    since the cascade removes the referenced event.

  The action layer maps `23503` nowhere, so the victim sees an opaque `INTERNAL_SERVER_ERROR`.

  **Honest exploitability limit**: a separate probe confirmed RLS blocks reading other users'
  events (`PROBE 1 (read): attacker can SELECT 0 watering_events rows`), so the attacker must
  learn the victim's event UUID out of band. UUID secrecy is not an access control, but it does
  mean this is not trivially mass-exploitable.

  **Not a regression in the guard itself**: the self-inflicted variant — rewinding your own
  pointer to your own older event — is correctly refused by this change's new `P0004`
  date-alignment check (`ERROR: This action is no longer aligned with the plant schedule`). The
  defense-in-depth Phase 1 added works; it just cannot protect a victim whose *own* stack is
  perfectly aligned.

- **Fix A ⭐ Recommended**: Revoke the blanket `UPDATE` on `public.plants` and re-grant it
  column-scoped, excluding `current_watering_event_id`:
  `revoke update on public.plants from authenticated;`
  `grant update (name, growing_interval_days, dormancy_interval_days, next_due_on, photo_path) on public.plants to authenticated;`
  Optionally also make the FK `on delete set null` as belt-and-braces.
  - Strength: removes the write primitive entirely rather than validating it, and matches the
    repo's existing explicit-grant philosophy — `create_plants.sql:33-34` already carries a comment
    reasoning about grants vs. RLS. **Verified low-risk**: `grep` shows no production code performs
    a direct `.from("plants").update(...)` any more (Phase 2 moved the last one behind the RPC);
    the only direct update left is the legacy-divergence test fixture at
    `watering-sequence.integration.test.ts:401`, which writes `next_due_on` and stays within the
    proposed grant.
  - Tradeoff: the column list must be maintained as the table grows; a forgotten column surfaces
    as a runtime permission error rather than a type error.
  - Confidence: HIGH — exploit and fix surface both verified directly against the local stack.
  - Blind spot: I did not audit the Astro pages for a direct plant update outside `src/actions`;
    the grep covered all of `src/` for `from("plants")` and found only reads there, but a
    dynamically-built query would not match.
- **Fix B**: Add a `before insert or update` trigger on `public.plants` validating that
  `current_watering_event_id` resolves to an event with the same `plant_id` and `user_id`, plus the
  mirror check for `watering_events.previous_event_id`.
  - Strength: enforces the invariant regardless of future grant changes, and covers
    `previous_event_id` (see F-note in the migration) in the same stroke.
  - Tradeoff: a per-write trigger with an extra lookup on every plant write, including the hot
    RPC paths; more moving parts than a grant change.
  - Confidence: MEDIUM — correct in principle, but the trigger must not deadlock against the
    plant→event lock ordering this change carefully established.
  - Blind spot: interaction with the deferrable FKs during plant deletion cascade is unverified.
- **Decision**: FIXED via Fix A — `supabase/migrations/20260801120002_secure_and_index_undo_stack.sql`
  revokes the table-wide `UPDATE` and re-grants only
  `name, growing_interval_days, dormancy_interval_days, next_due_on, photo_path`.
  `id`/`user_id`/`created_at` were withheld too (row identity and ownership are not client-editable),
  as was `updated_at` — it is the optimistic-lock token `update_plant_schedule` compares against, so a
  client able to forge it could defeat the lock.
  **Verified after a full `db reset`**: the exploit probe now reports
  `PROBE 2 (write): BLOCKED by 42501: permission denied for table plants` and
  `PROBE 5 (commit check): constraints OK -- victim NOT broken`.
  Regression sweep all green — `test:sql` 0, `test:integration` 24/24, `test` 102/102,
  `check` 0, `lint` 0.

### F2 — Neither new foreign key has a covering index

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260801120000_explicit_undo_stack.sql:5,8
- **Detail**: Confirmed against the live schema — `pg_indexes` for `plants` and `watering_events`
  lists only `plants_pkey`, `plants_user_id_next_due_on_idx`, `watering_events_pkey`, and
  `watering_events_plant_id_created_at_idx`. Neither `previous_event_id` nor
  `current_watering_event_id` is indexed. Postgres does not auto-index the referencing side, so
  every `undo_watering_event` — which deletes an event row — forces a sequential scan of both
  `watering_events` and `plants` to validate the inbound references, as does every cascaded row on
  plant deletion. Undo is now on the hot path for the app's primary interaction.
- **Fix**: Add `create index on public.watering_events (previous_event_id);` and
  `create index on public.plants (current_watering_event_id);` in a follow-up migration.
- **Decision**: FIXED — both indexes added to
  `supabase/migrations/20260801120002_secure_and_index_undo_stack.sql` (renamed from
  `…_restrict_plant_column_grants.sql` now that it carries both concerns). Verified present in
  `pg_indexes` after a full reset; `test:sql` and `test:integration` still green.

### F3 — `lefthook.yml` modified despite the plan explicitly fencing it off

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: lefthook.yml:5-11
- **Detail**: `plan.md:239` states "Do not modify `lint-staged`/lefthook wiring in this phase." Phase 1
  added `--no-warn-ignored` to the pre-commit ESLint step anyway. The change is genuinely forced by
  the plan's own work — regenerating `src/lib/database.types.ts` stages an ESLint-ignored file, and
  naming an ignored file explicitly emits a warning that `--max-warnings=0` promotes to a failed
  commit. It is scope-minimal, carries a six-line explanatory comment, does not weaken rule
  enforcement, and is disclosed in the `fcbc0b1` commit message. Flagged only because the plan drew
  an explicit boundary and the boundary moved without the plan being amended.
- **Fix**: Accept and record it as an addendum in the plan so a future review reading `plan.md:239`
  as ground truth does not re-raise it.
- **Decision**: SKIPPED — the deviation is already documented in the `fcbc0b1` commit message and in
  a six-line comment in `lefthook.yml` itself; the plan is left as the historical record.

### F4 — The plan contradicts itself on the legacy-divergence undo error code

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/changes/undo-integrity-defects/plan.md:400
- **Detail**: Phase 2 #4's contract says the legacy-divergence regression must assert undo
  "rejects with `CONFLICT`", while the plan's own Testing Strategy at `:550` says
  `PRECONDITION_FAILED`. Only the latter is consistent with the `P0004` design the same plan
  specifies at `:136` and `:180-184`. The shipped test asserts `PRECONDITION_FAILED`
  (`watering-sequence.integration.test.ts:424`) — **the code is right and the plan is wrong.**
  Recording this so the discrepancy is not later misread as implementation drift.
- **Fix**: Correct `plan.md:400` to say `PRECONDITION_FAILED`.
- **Decision**: FIXED — `plan.md:400` now reads `PRECONDITION_FAILED`, matching `:550`, the `P0004`
  design at `:136`, and the shipped assertion.

### F5 — `hasErrorCode` duplicates the narrowing already inlined in `date.ts`

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/errors.ts:1-3
- **Detail**: The `unknown`-narrowing helper in `errors.ts` is a byte-for-byte reimplementation of
  the predicate inlined at `src/lib/date.ts:53-55` (`isClientDateRejection`), and
  `today-list.tsx` now imports both modules for what is the same shape check. This is the exact
  class of drift `context/foundation/lessons.md` records under "Extract generic helpers to
  src/lib, don't duplicate them" — both copies are already in `src/lib`, so the letter of the rule
  is met while its intent (one definition, one place to fix a bug) is not.
- **Fix**: Keep `hasErrorCode` in `errors.ts` as the single definition and have `date.ts:53` call it.
- **Decision**: FIXED — `hasErrorCode` is now exported from `src/lib/errors.ts:1-3` and
  `isClientDateRejection` (`src/lib/date.ts:55`) calls it instead of re-inlining the narrowing.

### F6 — Undo-named predicates actually test generic action codes

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/errors.ts:5-11
- **Detail**: `isUndoBlockedConflict` and `isUndoScheduleMismatch` are named for the undo domain but
  match only the generic `CONFLICT` / `PRECONDITION_FAILED` codes, so they return true for any
  action error carrying those codes; `errors.test.ts` locks in exactly that generic behaviour.
  Harmless at the single call site — the plan explicitly reasons at `:476` that client-date
  rejection cannot reach `handleUndo` — but the names promise a narrowing the code does not perform,
  which misleads on reuse.
- **Fix**: Either rename to `isConflict` / `isPreconditionFailed`, or keep the names and add a
  comment pinning that they are only sound inside the undo handler.
- **Decision**: FIXED — renamed to `isConflict` / `isPreconditionFailed` across `errors.ts`,
  `errors.test.ts` and `today-list.tsx`; names now match behaviour.

  **Discovered while fixing**: `src/lib/date.ts:5` defines
  `CLIENT_DATE_ERROR_CODE = "PRECONDITION_FAILED"` — the *same* code. So `isClientDateRejection`
  and `isPreconditionFailed` are now provably the identical predicate, and the only thing keeping
  the undo handler from mistaking a client-date rejection for a schedule mismatch is the
  reachability argument recorded at `plan.md:476`. The rename makes that dependency visible rather
  than hiding it behind a domain-specific name. Worth a dedicated marker code if the two paths
  ever converge.

### F7 — `28000` (authentication required) is mapped nowhere and surfaces as a 500

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/actions/index.ts:178-186
- **Detail**: All four RPCs raise `28000` when `auth.uid()` is null, but no call site maps it, so it
  falls through to `INTERNAL_SERVER_ERROR`. `requireSession` makes this near-unreachable; a session
  expiring mid-request surfaces as a 500 rather than a re-auth prompt. Pre-existing pattern, not
  introduced here, but the new RPC inherits it.
- **Fix**: Map `28000` to `UNAUTHORIZED` in the shared RPC error handling.
- **Decision**: FIXED — all four RPC call sites in `src/actions/index.ts` (`update_plant_schedule`,
  `mark_watered`, `postpone_plant`, `undo_watering_event`) now map `28000` to `UNAUTHORIZED`
  ("Sign in to continue.") ahead of the `INTERNAL_SERVER_ERROR` fallthrough.

### F8 — Silent no-op when the head-event lookup finds nothing

- **Severity**: 💡 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260801120001_atomic_plant_schedule_update.sql:62
- **Detail**: When the head-event `select … for update` finds no row, `v_current_event_new_due_on`
  stays NULL, the comparison at `:62` evaluates to NULL, and the stack amendment is skipped without
  any signal. The intended "divergent legacy stack" skip and a genuinely corrupted pointer (reachable
  via F1) are therefore indistinguishable — both silently produce an unamended stack. This is the
  correct *conservative* behaviour, but it is undiagnosable in production.
- **Fix**: Distinguish "pointer set but event not found" from a genuine date mismatch and
  `raise warning` on the former, so corruption leaves a trace.
- **Decision**: FIXED — `update_plant_schedule` is redefined in
  `20260801120002_secure_and_index_undo_stack.sql` with a `v_current_event_found := found;`
  capture and a distinct `raise warning` branch. Behaviour is unchanged; the dangling-pointer case
  simply leaves a trace instead of sharing the divergent-stack path. Redefined in the follow-up
  migration rather than editing the already-applied `…120001`, so deployed history stays immutable.
  Verified live via `pg_proc.prosrc`.

### F9 — Two assertions the plan asked for are only implied, never made

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: supabase/tests/undo-integrity.sql:155-164
- **Detail**: Two soft gaps against the plan's contracts. (1) `plan.md:392` asks for an explicit
  assertion that the amended event's `new_due_on` equals the plant's `next_due_on` — calling that
  invariant "what this change is really about" — but the shipped test only asserts each side equals
  `addDays(…, 1)` separately, so the equality holds transitively rather than being pinned. (2) The
  zero-delta SQL case asserts a stale token *succeeds* but not that `next_due_on` and the journal are
  left untouched, which `plan.md:422` also requested; those are implied by later baseline dates only.
- **Fix**: Add the two direct assertions.
- **Decision**: FIXED — (1) `watering-sequence.integration.test.ts` now asserts
  `amendedState.wateringEvents[0].new_due_on === amendedState.plant.next_due_on` directly, pinning
  the plant-journal invariant instead of leaving it transitive. (2) `undo-integrity.sql` snapshots
  `next_due_on` and the full journal (`jsonb_agg(to_jsonb(e.*) order by e.id)`) before the
  zero-delta call and asserts both are unchanged after it.

### F10 — SQL gate has no case for pointer tampering or `anon` execution

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/tests/undo-integrity.sql
- **Detail**: The gate covers LIFO ordering, cross-user rejection, divergence and delta amendment
  well, but has no case asserting that a client cannot write `current_watering_event_id` directly
  (F1) and none asserting `anon` cannot execute the new RPCs. The grant footers are correct today;
  nothing would catch a future migration re-granting them.
- **Fix**: Add both cases once F1 is resolved — the F1 probe script in this session's scratchpad is
  a ready-made starting point.
- **Decision**: FIXED — `undo-integrity.sql` gained two blocks: one asserting `authenticated` holds
  no `UPDATE` on `current_watering_event_id`, `id`, `user_id` or `updated_at` **and still holds it
  on all five editable columns** (so the fix cannot regress into breaking the app), and one
  asserting `anon` holds no `EXECUTE` on any of the four RPCs. Written against grants rather than
  policies because only a grant can express this.

  **Deliberate-break verified** — both assertions fail when the invariant is violated and pass when
  restored:
  - `grant update (current_watering_event_id) …` → exit 3,
    `ERROR: authenticated must not hold UPDATE on plants.current_watering_event_id`
  - `grant execute on function public.undo_watering_event(uuid) to anon` → exit 3,
    `ERROR: anon must not hold EXECUTE on: public.undo_watering_event(uuid)`
  - after revoking both → exit 0
