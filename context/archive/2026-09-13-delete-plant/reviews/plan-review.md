<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Delete Plant Implementation Plan

- **Plan**: context/changes/delete-plant/plan.md
- **Mode**: Deep
- **Date**: 2026-09-13
- **Verdict**: SOUND (after triage; originally RETHINK)
- **Findings**: 2 critical, 4 warnings, 0 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | PASS |
| Plan Completeness | PASS |

## Grounding

Grounding: 10/10 existing paths ✓, 12/12 symbols ✓, brief↔plan ✓, Progress↔phases ✓

## Findings

### F1 — Raw shadcn output violates repository and UI contracts

- **Severity**: ❌ CRITICAL
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Architectural Fitness
- **Location**: Phase 2 §1 — Alert dialog UI primitive
- **Detail**: The current alert-dialog dry run creates the bare file `src/components/ui/alert-dialog.tsx` with `"use client"`, imports `cn` from `"cn"`, and exports eleven components from one module. It also overwrites `src/components/ui/button.tsx` and affects its eleven existing consumers. This contradicts the repository's component-folder, one-component-per-module, no-Next-directive, and `cn`-import rules. Generated animations have no reduced-motion override. The existing destructive button is translucent and 32px tall, so it also does not provide the promised solid destructive fill or ≥44px target without adaptation.
- **Fix A ⭐ Recommended**: Treat the registry as a styling reference and create one composed AlertDialog component in its own folder.
  - Strength: Obeys repository rules, preserves `button.tsx`, and keeps the primitive narrowly matched to this feature.
  - Tradeoff: Deviates from shadcn's compound-component API.
  - Confidence: HIGH — the dry-run output and repository rules are explicit.
  - Blind spot: Future dialog variants may require expanding the API.
- **Fix B**: Split and sanitize the generated compound components into separate component folders and barrels.
  - Strength: Retains the reusable shadcn compound API.
  - Tradeoff: Creates many modules for one current use and requires protecting `button.tsx` plus fixing imports and motion.
  - Confidence: HIGH — mechanically feasible but substantially larger.
  - Blind spot: Maintenance cost if the registry changes later.
- **Decision**: FIXED — Fix A

### F2 — Best-effort photo cleanup contradicts the promised end state

- **Severity**: ❌ CRITICAL
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: End-State Alignment
- **Location**: Desired End State; Phase 1 §1
- **Detail**: The plan promises that the photo is gone and no orphan remains, but the Action logs Storage removal failures and still succeeds. Database deletion and Storage removal are separate operations. If Storage fails after the row commits, the photo path is no longer persisted for retry. The happy-path photo test cannot verify this failure mode. Stopping Supabase or going offline generally fails before database deletion, not specifically after DB success and before Storage cleanup.
- **Fix A ⭐ Recommended**: Explicitly define deletion as authoritative DB removal with best-effort private-photo cleanup, and narrow the end state, UI copy, and success criteria accordingly.
  - Strength: Matches the existing update pattern and keeps the MVP scope.
  - Tradeoff: Private orphaned objects and storage cost remain possible.
  - Confidence: HIGH — this is exactly what the planned code implements.
  - Blind spot: Expected long-term orphan accumulation is unknown.
- **Fix B**: Persist cleanup intent atomically with deletion and retry Storage removal until it succeeds.
  - Strength: Preserves the absolute no-orphan promise.
  - Tradeoff: Requires migration/RPC and retry-worker design, contradicting the current no-migration scope.
  - Confidence: MEDIUM — the architecture is sound, but its executor and retry lifecycle are not yet designed.
  - Blind spot: Cloudflare scheduling and cleanup retention need research.
- **Decision**: FIXED — Fix A

### F3 — Separate read and delete creates a TOCTOU race

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architectural Fitness
- **Location**: Critical Implementation Details; Phase 1 §1 and verification
- **Detail**: A concurrent edit can replace the name/photo after the preliminary read but before deletion. The Action then deletes the updated row, removes the old photo, leaves the new photo orphaned, and returns a stale name. The claimed mutation check is also ineffective: a foreign request exits at the preliminary owner-scoped read, so that test never exercises the zero-row delete branch.
- **Fix**: Replace both queries with `.delete().eq("id", plantId).select("id, name, photo_path").maybeSingle()`; map null to `NOT_FOUND`, clean up the returned path, and use the returned name for the success notice.
- **Decision**: FIXED

### F4 — A zero-delay timeout does not resolve the toast hydration race

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Critical Implementation Details; Phase 2 §4
- **Detail**: Sonner publishes only to current subscribers and does not replay history. Astro imports and hydrates separate `client:load` islands independently. Therefore `setTimeout(..., 0)` can still fire before Toaster subscribes. Because the notice key is removed first, that confirmation is then lost.
- **Fix A ⭐ Recommended**: Use one layout-level toast-host island that renders Toaster and consumes the stored notice only after that hydration boundary has mounted and the subscriber is ready.
  - Strength: Removes cross-island ordering from the contract.
  - Tradeoff: Adds `layout.astro` and the toast host to the change surface.
  - Confidence: HIGH — it directly controls the currently unordered work.
  - Blind spot: A small browser/component test harness may still be useful.
- **Fix B**: Add an explicit, sticky Toaster-ready handshake and consume the storage key only after readiness.
  - Strength: Preserves a page-scoped notice component.
  - Tradeoff: Adds coordination state and event-ordering machinery.
  - Confidence: MEDIUM — correct only if late listeners can observe readiness.
  - Blind spot: Listener attachment after the ready event must be handled.
- **Decision**: FIXED — Fix A

### F5 — Generated confirmation closes before async failure can render

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2 §2 — Delete plant dialog
- **Detail**: The generated `AlertDialogAction` uses React Aria's close slot and closes immediately when pressed. That contradicts the requirement to keep the dialog open and show an inline error. Disabling buttons also does not prevent Escape from dismissing the dialog while deletion is pending.
- **Fix**: Require controlled open state, use a normal non-close Button for confirmation, use the close slot only for Cancel, and reject Escape/open-state closure while pending.
- **Decision**: FIXED

### F6 — The referenced UNAUTHORIZED client pattern does not exist

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 §2 — Delete plant dialog
- **Detail**: Existing client forms do not have a sign-in-prompt pattern; they map `UNAUTHORIZED` into generic failures. “Same message pattern as other forms” leaves the implementer to invent copy and navigation behavior.
- **Fix**: Specify the exact expired-session message, whether it includes an `/auth/signin` link or redirects, and add it to manual verification.
- **Decision**: FIXED
