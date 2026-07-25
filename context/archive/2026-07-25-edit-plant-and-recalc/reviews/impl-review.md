<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Edit Plant and Schedule Recalculation

- **Plan**: `context/changes/edit-plant-and-recalc/plan.md`
- **Scope**: Phases 1–3 of 3 (full plan)
- **Date**: 2026-07-25
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 2 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Automated verification (re-run)

| Check | Result |
|---|---|
| `pnpm astro check` | exit 0 — 0 errors, 0 warnings, 9 hints |
| `pnpm lint` | exit 0 |
| `pnpm build` | exit 0 |
| 1.4 no photo constant outside shared module | PASS — `4 * 1024 * 1024` and `image/webp` appear only in `src/lib/photo.ts` |
| 1.5 single TTL definition | PASS — one line, `src/lib/photo.ts:15` |
| 1.6 `photo.ts` client-safe | PASS — no `astro:env/server`, no `@/lib/supabase` import |
| 3.4 no new eslint suppression | PASS in class — two new `no-console` suppressions at `src/actions/index.ts:183,194`, both the best-effort-cleanup class the plan itself sanctions in "Critical Implementation Details" |
| 2.4 edit route 200/404 | NOT RE-EXECUTED — needs a running Supabase + dev server. Verified by inspection: `src/pages/plants/[id]/edit.astro:45-47` sets `Astro.response.status = 404` on a missing or RLS-hidden row and renders the privacy-safe panel |

## Load-bearing behaviors verified by inspection

- **`updated_at` round-trips verbatim as a string.** SSR select (`edit.astro:28`) → `updatedAt` prop (`edit.astro:85`) → `formData.set("updated_at", updatedAt)` (`edit-plant-form.tsx:69`) → `z.string().min(1)` (`actions/index.ts:100`) → `.eq("updated_at", input.updated_at)` (`actions/index.ts:162`). No `Date`, no `.datetime()`, no reformatting anywhere in the chain. This was the plan's single most fragile requirement and it holds.
- **CAS guard scoped to schedule writes.** `actions/index.ts:157,161-163` — `next_due_on` is spread into the payload only when `deltaDays !== 0`, and the `.eq("updated_at", …)` guard is applied under the identical condition. Name/photo-only saves cannot be blocked by a concurrent watering.
- **`maybeSingle()` not `single()`**, with zero rows correctly disambiguated: `CONFLICT` when guarded, `NOT_FOUND` when not (`actions/index.ts:165-177`).
- **Photo lifecycle ordering is correct.** Upload (`:141-149`) → row write (`:165`) → old-object delete (`:179-186`), with the old object deleted only after `data` is confirmed non-null. The `catch` at `:189-204` removes `uploadedPhotoPath` on every failure path including `CONFLICT`, so a refused save leaves no orphan. Both cleanups are best-effort and logged, never masking the original error.
- **Object URL revocation** (`edit-plant-form.tsx:225-231`) revokes on replacement via the effect-cleanup closure and on unmount — the same pattern as `add-plant-form.tsx:128-134`.
- **No journal write, no migration, no `version` column, no clamping, no delete control.** The diff touches no file under `supabase/`, and `updatePlant` inserts no `watering_events` row.
- **Preview copy matches the plan's specified strings exactly**, including the rejected shared-string shortcut: `utils.ts:56-59` distinguishes the two `deltaDays === 0` cases by comparing the inactive interval's old and new values, and `:81-85` names the inactive change explicitly.
- **The three repointed consumers are minimal as required.** `authed-shell.astro` and `plants/index.astro` are +1/−2 each — only the TTL declaration swapped for an import; the `createSignedUrls` batch calls are untouched.

## Findings

### F1 — An invalid photo selection permanently disables Save with no in-form recovery

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: src/components/edit-plant-form/edit-plant-form.tsx:432
- **Detail**: `submitReady = valid && !submitting && photoError === null` gates the primary action on `photoError`, but `photoError` is only ever cleared by `handlePhotoChange` with a valid file (`:157`), `handleRemovePhoto` (`:164`), or `handleUndoPhotoRemoval` (`:164,175`). After a rejected file the selection is discarded (`:152`) and the photo intent stays `"keep"` — nothing is pending — yet Save stays disabled. For a plant with **no** existing photo, `photoRemovable` is `false` (`:102`) so `renderPhotoAction()` returns `null` (`:208-210`) and neither Remove nor Undo is rendered: the only escape is selecting a valid image or reloading the page and losing every entered value. `design.md:254` requires "Clear only the invalid file selection, not unrelated fields," and `design.md:464` requires invalid photos to have a recoverable state; blocking an unrelated name or interval edit violates both.
- **Fix A ⭐ Recommended**: Drop `photoError === null` from `submitReady` (`:432`) so the message stays advisory.
  - Strength: The rejected file is already discarded and the intent is still `"keep"`, so a save at that moment does exactly what `design.md:252` asks — leaves the stored photo unchanged. One-token change, no new UI.
  - Tradeoff: A user could save while the guidance message is still visible; the message then persists next to a control whose selection was already cleared.
  - Confidence: HIGH — the intent state machine already guarantees nothing invalid can be submitted; `formData.set("photo", …)` only fires when `photoIntent === "replace"` (`:71-73`).
  - Blind spot: Not checked against a designer's preference for a hard block over an advisory message.
- **Fix B**: Keep the gate but always render a control that clears `photoError` without changing the photo intent (e.g. render `Undo`/`Dismiss` whenever `photoError !== null`).
  - Strength: Preserves the "don't save while something looks wrong" posture and gives an explicit acknowledgement step.
  - Tradeoff: Adds a fourth photo control and a state combination the brief never describes; more surface to test at 320px.
  - Confidence: MEDIUM — `design.md` §7 enumerates only Replace / Remove / Undo photo removal, so a dismiss control is new vocabulary.
  - Blind spot: Interaction with the documented tab order (`plan.md` Phase 3 §2) not verified.
- **Decision**: FIXED via Fix A — `submitReady` at `edit-plant-form.tsx:432` no longer reads `photoError`; the guidance message is now advisory only.

### F2 — `isValidPhoto` uses `in`, so prototype-chain keys pass MIME validation

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/photo.ts:18
- **Detail**: `file.type in PHOTO_MIME_EXTENSIONS` walks the prototype chain, so a `File` whose `type` is `"constructor"`, `"toString"`, `"valueOf"`, `"__proto__"`, etc. passes the check. Both the client guard (`edit-plant-form.tsx:150`, `add-plant-form.tsx:97`) and the server guard (`actions/index.ts:10`) run through this one predicate. On the server the crafted type then reaches `buildPhotoPath` (`photo.ts:22`), where `PHOTO_MIME_EXTENSIONS["constructor"]` resolves to the `Object` function, the `!extension` guard at `:24` is bypassed, and the object path becomes `<uid>/<uuid>.function Object() { [native code] }` — while `upload(…, { contentType: file.type })` (`actions/index.ts:143`) writes that same attacker-chosen string as the stored content type. Blast radius is contained (the 4 MB ceiling still applies, storage RLS still confines writes to the caller's own folder, and none of the reachable prototype keys is a renderable content type), so this is hardening rather than an exploitable hole. Worth fixing here because this change is precisely the moment the check became the repo's single definition — and it is a mild regression for `add-plant-form`, which previously used a `Set` (`git show 1983680:src/components/add-plant-form/add-plant-form.tsx`) rather than `in`. The server-side `in` is pre-existing (`git show 1983680:src/actions/index.ts:19`).
- **Fix**: Change `photo.ts:18` to `file.size <= MAX_PHOTO_BYTES && Object.hasOwn(PHOTO_MIME_EXTENSIONS, file.type)`.
- **Decision**: FIXED — `isValidPhoto` now uses `Object.hasOwn`, closing the prototype-chain bypass for every client and server call site at once.

### F3 — Save-failure focus lands on the Save button, past the conflict recovery controls

- **Severity**: 👁️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/components/edit-plant-form/edit-plant-form.tsx:233-237
- **Detail**: `useEffect(… saveButtonRef.current?.focus(), [saveError])` moves focus to the submit button whenever a save fails. The `role="alert"` block that carries `Reload plant` and `Back to plant` precedes the action row in DOM order (`:414-428` before `:430`), so a keyboard or screen-reader user landing on Save must shift-tab backwards to reach the recovery controls the conflict state exists to offer. `plan.md` Phase 3 specifies focus movement only for the *invalid-control* case (implemented correctly at `:121-127,136`); this extra focus move is an addition that works against the conflict flow. The alert text is still announced, so this is a navigation-efficiency gap rather than a blocker.
- **Fix**: Give the alert container `tabIndex={-1}` and a ref, and focus that instead of `saveButtonRef`, so the message is read and its recovery controls are the next things in the tab order.
- **Decision**: FIXED — `saveButtonRef` replaced by `saveAlertRef` on the `role="alert"` container (`tabIndex={-1}`, `outline-none`); the now-dead button ref was removed.

### F4 — `getValidInterval` is a boolean predicate with a `get` prefix

- **Severity**: 👁️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/edit-plant-form/utils.ts:33
- **Detail**: `function getValidInterval(value: number | null): value is number` is a type guard returning a boolean, but `get` names a retrieval. `AGENTS.md` Naming calls for predicates to read as predicates (`isToday()`, `hasAccess()`), and this very change ships the correct form next door — `isValidPhoto` in `src/lib/photo.ts:17`, called from the same component. Reading `!getValidInterval(...)` at `utils.ts:40` is actively misleading about the return type.
- **Fix**: Rename to `isValidInterval` at `utils.ts:33` and its two call sites at `utils.ts:40`.
- **Decision**: FIXED — renamed to `isValidInterval`; the helper is module-local (not exported), so the rename is contained to `utils.ts:33,40`.

### F5 — `addPlant`'s photo rejection copy changed as a side effect of the constant consolidation

- **Severity**: 👁️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: src/actions/index.ts:10
- **Detail**: The shared `photoSchema` collapsed two refinements into one. Before this change (`git show 1983680:src/actions/index.ts:16-19`) an oversized upload was rejected with `Photo must be 4 MB or smaller` and a bad type with `Photo must be a JPEG, PNG, or WebP image`; both now return `Choose a JPEG, PNG, or WebP image up to 4 MB.` This is a user-visible copy change to the existing add-plant flow. `plan.md` Phase 1 §5 authorized repointing `addPlant`'s photo zod schema at the shared module but described the work as "without changing any existing behavior," and the plan's manual set (1.7) only covers the happy path, so the message change went unverified. The new copy is the string `design.md:402` mandates and matches what both client forms already show, so this reads as an improvement that simply outran its documentation.
- **Fix**: Note the copy unification in the plan as an addendum rather than reverting — it removes a client/server message mismatch that predated this slice.
- **Decision**: FIXED — recorded as addendum A1 in `plan.md` (new `## Addenda` section before `## Progress`); the copy itself is kept.
