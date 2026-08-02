---
date: 2026-08-02T09:31:59+02:00
researcher: Codex
git_commit: f3b88d0e12292c8473e49759717e37114bbd875d
branch: main
repository: yapca
topic: "Testing photo upload boundary"
tags: [research, codebase, photo-upload, astro-actions, workerd, supabase-storage]
status: complete
last_updated: 2026-08-02
last_updated_by: Codex
---

# Research: Testing photo upload boundary

**Date**: 2026-08-02T09:31:59+02:00  
**Researcher**: Codex  
**Git Commit**: f3b88d0e12292c8473e49759717e37114bbd875d  
**Branch**: main  
**Repository**: yapca

## Research Question

Where is the real plant-photo upload boundary, what does the existing test harness already prove, and what is the thinnest high-value test that protects a phone-shaped upload from being silently dropped or opaquely rejected?

## Summary

The real boundary is not the photo helper or Astro Action handler in isolation. It is:

`browser FormData -> Astro /_actions route -> workerd request/body parser -> authenticated Action -> Supabase Storage -> plants.photo_path -> authenticated download`

The existing integration harness gives strong coverage below HTTP: it exercises Action schema parsing and handler logic with real authenticated Supabase clients, RLS, Storage, and Postgres. Existing edit tests already cover keep, replace, remove, retrievability, and cleanup. However, those tests call `server.<action>.orThrow` directly under Node, so they bypass multipart serialization/parsing, middleware, the generated Action route, workerd, and Astro's 5 MiB request limit. They cannot satisfy the Phase 4 risk.

The thinnest honest automated addition is a dedicated HTTP integration test for `addPlant` against a running local Astro workerd server and real local Supabase. It should submit native `FormData` with an authenticated cookie, then prove the outcome by re-reading the plant and downloading the stored object as its owner. A near-4 MiB supported image should succeed byte-for-byte; a phone-sized payload above 5 MiB should fail with no row and no object. A small HEIC rejection case is useful if budget allows.

Raw HTTP still cannot prove that the React island placed the selected file into the request or that the user saw the toast/field error. The accepted test strategy therefore needs a short manual real-device smoke alongside automation. Browser automation remains explicitly deferred while UI coverage is out of scope.

## Detailed Findings

### 1. The live upload path crosses five independently meaningful layers

- The add form creates a browser `FormData`, attaches the selected `File`, and calls `actions.addPlant`; failures are mapped to a visible retry message ([add-plant-form.tsx:53](https://github.com/mlmmn/yapca/blob/f3b88d0e12292c8473e49759717e37114bbd875d/src/components/add-plant-form/add-plant-form.tsx#L53), [add-plant-form.tsx:77](https://github.com/mlmmn/yapca/blob/f3b88d0e12292c8473e49759717e37114bbd875d/src/components/add-plant-form/add-plant-form.tsx#L77)).
- The edit form encodes three distinct intents: omit the file to keep the current photo, attach a file to replace it, or set `removePhoto` to remove it ([edit-plant-form.tsx:62](https://github.com/mlmmn/yapca/blob/f3b88d0e12292c8473e49759717e37114bbd875d/src/components/edit-plant-form/edit-plant-form.tsx#L62), [edit-plant-form.tsx:155](https://github.com/mlmmn/yapca/blob/f3b88d0e12292c8473e49759717e37114bbd875d/src/components/edit-plant-form/edit-plant-form.tsx#L155)).
- Shared validation accepts only JPEG, PNG, or WebP at no more than 4 MiB. Paths are generated server-side as `{authenticated_user_id}/{uuid}.{mime-derived-extension}` ([photo.ts:5](https://github.com/mlmmn/yapca/blob/f3b88d0e12292c8473e49759717e37114bbd875d/src/lib/photo.ts#L5), [photo.ts:17](https://github.com/mlmmn/yapca/blob/f3b88d0e12292c8473e49759717e37114bbd875d/src/lib/photo.ts#L17), [photo.ts:21](https://github.com/mlmmn/yapca/blob/f3b88d0e12292c8473e49759717e37114bbd875d/src/lib/photo.ts#L21)). The picker `accept` attribute is only a browser hint; both the form and Action repeat validation.
- Astro is configured for full SSR on Cloudflare workerd with a 5 MiB Action request limit, deliberately leaving about 1 MiB of multipart overhead above the 4 MiB file cap ([astro.config.mjs:9](https://github.com/mlmmn/yapca/blob/f3b88d0e12292c8473e49759717e37114bbd875d/astro.config.mjs#L9), [astro.config.mjs:15](https://github.com/mlmmn/yapca/blob/f3b88d0e12292c8473e49759717e37114bbd875d/astro.config.mjs#L15)). Astro can reject an oversized body before schema validation or the Action handler runs.
- `addPlant` uploads the object before inserting the plant row. If the insert fails, it attempts to delete the new object without masking the original error ([actions/index.ts:34](https://github.com/mlmmn/yapca/blob/f3b88d0e12292c8473e49759717e37114bbd875d/src/actions/index.ts#L34), [actions/index.ts:55](https://github.com/mlmmn/yapca/blob/f3b88d0e12292c8473e49759717e37114bbd875d/src/actions/index.ts#L55), [actions/index.ts:67](https://github.com/mlmmn/yapca/blob/f3b88d0e12292c8473e49759717e37114bbd875d/src/actions/index.ts#L67), [actions/index.ts:80](https://github.com/mlmmn/yapca/blob/f3b88d0e12292c8473e49759717e37114bbd875d/src/actions/index.ts#L80)). A successful HTTP response alone is therefore insufficient proof; the row pointer and downloadable object must agree.
- `updatePlant` reads the owner-visible row before upload, uploads the replacement, atomically updates row fields through an owner-bound RPC, deletes the previous object after success, and deletes the newly uploaded object after later failure ([actions/index.ts:109](https://github.com/mlmmn/yapca/blob/f3b88d0e12292c8473e49759717e37114bbd875d/src/actions/index.ts#L109), [actions/index.ts:136](https://github.com/mlmmn/yapca/blob/f3b88d0e12292c8473e49759717e37114bbd875d/src/actions/index.ts#L136), [actions/index.ts:146](https://github.com/mlmmn/yapca/blob/f3b88d0e12292c8473e49759717e37114bbd875d/src/actions/index.ts#L146), [actions/index.ts:200](https://github.com/mlmmn/yapca/blob/f3b88d0e12292c8473e49759717e37114bbd875d/src/actions/index.ts#L200)). Storage and database changes are coordinated but not transactional.
- Readback uses short-lived signed URLs from the private bucket; a signing failure degrades the image to a placeholder/null rather than failing the plant view ([photo.ts:31](https://github.com/mlmmn/yapca/blob/f3b88d0e12292c8473e49759717e37114bbd875d/src/lib/photo.ts#L31), [load-today-plants.ts:33](https://github.com/mlmmn/yapca/blob/f3b88d0e12292c8473e49759717e37114bbd875d/src/lib/services/load-today-plants.ts#L33)). Boundary tests should use authenticated Storage download for durable proof rather than depending on signed-URL presentation.

### 2. Storage constraints are defense in depth, not a substitute for HTTP testing

- The `plant-photos` bucket is private, independently capped at 4 MiB, and independently restricts MIME metadata to JPEG, PNG, and WebP ([create-plant-photos-bucket.sql:4](https://github.com/mlmmn/yapca/blob/f3b88d0e12292c8473e49759717e37114bbd875d/supabase/migrations/20260719120001_create_plant_photos_bucket.sql#L4)).
- Granular SELECT, INSERT, UPDATE, and DELETE policies require the first object-path segment to equal `auth.uid()` ([create-plant-photos-bucket.sql:13](https://github.com/mlmmn/yapca/blob/f3b88d0e12292c8473e49759717e37114bbd875d/supabase/migrations/20260719120001_create_plant_photos_bucket.sql#L13), [create-plant-photos-bucket.sql:21](https://github.com/mlmmn/yapca/blob/f3b88d0e12292c8473e49759717e37114bbd875d/supabase/migrations/20260719120001_create_plant_photos_bucket.sql#L21), [create-plant-photos-bucket.sql:29](https://github.com/mlmmn/yapca/blob/f3b88d0e12292c8473e49759717e37114bbd875d/supabase/migrations/20260719120001_create_plant_photos_bucket.sql#L29), [create-plant-photos-bucket.sql:41](https://github.com/mlmmn/yapca/blob/f3b88d0e12292c8473e49759717e37114bbd875d/supabase/migrations/20260719120001_create_plant_photos_bucket.sql#L41)). The Action's Supabase client uses the request cookie session and public key rather than a privileged service key ([supabase.ts:6](https://github.com/mlmmn/yapca/blob/f3b88d0e12292c8473e49759717e37114bbd875d/src/lib/supabase.ts#L6)).
- Phase 3 already proves cross-account Storage download, insert, replacement, and delete behavior with owner positive controls ([per-account-isolation.integration.test.ts:108](https://github.com/mlmmn/yapca/blob/f3b88d0e12292c8473e49759717e37114bbd875d/src/actions/per-account-isolation.integration.test.ts#L108)). Repeating these policy cases would add little Phase 4 signal.
- `plants.photo_path` is a string pointer with no database constraint tying it to an existing object or the row owner. The isolation suite intentionally proves that a foreign pointer can be stored but cannot be resolved by another user ([per-account-isolation.integration.test.ts:122](https://github.com/mlmmn/yapca/blob/f3b88d0e12292c8473e49759717e37114bbd875d/src/actions/per-account-isolation.integration.test.ts#L122)). The upload test must therefore assert both sides of the pointer.

### 3. Existing integration tests stop below the risky transport seam

- `pnpm test` runs Node unit tests; `pnpm test:integration` runs a separate Node suite backed by local Supabase ([package.json:16](https://github.com/mlmmn/yapca/blob/f3b88d0e12292c8473e49759717e37114bbd875d/package.json#L16), [vitest.integration.config.ts:23](https://github.com/mlmmn/yapca/blob/f3b88d0e12292c8473e49759717e37114bbd875d/vitest.integration.config.ts#L23)). There is no jsdom, happy-dom, Testing Library, or Playwright dependency.
- Integration tests construct native Node `FormData` but call Action `.orThrow` directly with a synthetic context ([harness.integration.test.ts:25](https://github.com/mlmmn/yapca/blob/f3b88d0e12292c8473e49759717e37114bbd875d/src/actions/harness.integration.test.ts#L25), [action-context.ts:5](https://github.com/mlmmn/yapca/blob/f3b88d0e12292c8473e49759717e37114bbd875d/test/fixtures/action-context.ts#L5)). This reaches schema parsing, handler code, authenticated Storage, RLS, and the database, but not HTTP multipart parsing, generated `/_actions/*` routing, middleware, request-size enforcement, or workerd.
- Existing photo fixtures contain short text labeled as `image/png`; they are not valid image binaries and never approach either size limit ([photos.ts:4](https://github.com/mlmmn/yapca/blob/f3b88d0e12292c8473e49759717e37114bbd875d/test/fixtures/photos.ts#L4)). Download and owner-only absence helpers are sound and reusable after HTTP submission ([photos.ts:19](https://github.com/mlmmn/yapca/blob/f3b88d0e12292c8473e49759717e37114bbd875d/test/fixtures/photos.ts#L19), [photos.ts:36](https://github.com/mlmmn/yapca/blob/f3b88d0e12292c8473e49759717e37114bbd875d/test/fixtures/photos.ts#L36)).
- Edit integration tests already prove keep/replace/remove semantics, object retrievability, and old-object cleanup through the in-process Action plus real Supabase ([update-plant.integration.test.ts:121](https://github.com/mlmmn/yapca/blob/f3b88d0e12292c8473e49759717e37114bbd875d/src/actions/update-plant.integration.test.ts#L121)). No test invokes `addPlant`, leaving the primary user-facing add/upload path uncovered.
- The integration fixture pool already supplies authenticated session cookies, per-worker user slots, and teardown that detects leaked Storage objects. These are suitable building blocks for HTTP requests and side-effect assertions ([user.ts:426](https://github.com/mlmmn/yapca/blob/f3b88d0e12292c8473e49759717e37114bbd875d/test/fixtures/user.ts#L426), [user.ts:470](https://github.com/mlmmn/yapca/blob/f3b88d0e12292c8473e49759717e37114bbd875d/test/fixtures/user.ts#L470), [global-setup.ts:56](https://github.com/mlmmn/yapca/blob/f3b88d0e12292c8473e49759717e37114bbd875d/test/setup/global-setup.ts#L56)).

### 4. Recommended automated boundary

Run a local Astro workerd server for a dedicated HTTP integration suite and use Node's native `fetch`, `File`, and `FormData`:

1. Acquire an existing authenticated integration user and its cookie header.
2. Build a valid add-plant multipart form and `POST /_actions/addPlant`.
3. Treat the HTTP result as transport evidence, not persistence evidence.
4. Query the unique plant by owner and name.
5. Assert `photo_path` is non-null and begins with `{user_id}/`.
6. Download that exact object as the owner and compare bytes with the uploaded fixture.
7. For every rejected case, assert both that no matching row exists and that the owner's Storage folder contains no new object.

Start one server per integration run, wait on a readiness probe rather than a fixed sleep, choose a collision-safe port, and terminate it deterministically. `astro dev` is the thinnest available seam and uses the project's Cloudflare adapter/workerd runtime. A build-plus-preview harness would be closer to production but adds more orchestration without changing the first risk this phase needs to catch.

Minimum high-signal matrix:

| Case | Automated assertion | Risk caught |
| --- | --- | --- |
| Supported real image near or exactly 4 MiB | HTTP Action succeeds; row points to an owner path; owner downloads byte-identical content | Regression to Astro's old 1 MiB default, multipart overhead error, dropped file, Storage failure, missing DB link |
| Phone-sized payload above 5 MiB, e.g. 12 MiB | HTTP 413/`CONTENT_TOO_LARGE`; no row; no object | Worker/body-parser rejection becoming a silent partial save |
| Under-limit `image/heic` (recommended if budget permits) | Explicit input rejection; no row; no object | Common phone format fails opaquely or accidentally persists contrary to the allowlist |

The success fixture should be a genuine JPEG with EXIF orientation metadata, not text labeled as an image. Byte equality proves transport and persistence; it does not prove that a browser renders the orientation correctly. PNG/WebP repetition is lower priority because the same allowlist is already shared between client, Action, and bucket.

An update replacement HTTP case is valuable only after the add boundary is protected. If included, target the uncovered composition: upload a replacement followed by a stale-update conflict, then prove the old object and pointer remain and the new object was cleaned up. Basic keep/replace/remove cases already have integration coverage.

### 5. Manual device smoke remains part of the acceptance contract

Perform before release on at least one representative iPhone and Android path:

- Select a camera/library photo and verify the preview represents the selected file.
- Save, confirm navigation completes, and verify the image loads again from the private bucket.
- Select an oversized or unsupported HEIC photo and verify the user sees actionable guidance, other fields remain intact, and retry is possible.
- Use an EXIF-rotated JPEG and verify the preview and saved image have acceptable orientation.

This smoke covers the accepted automation gap: the client island could drop the file before forming the request, and a raw HTTP test cannot prove a toast or inline error was actually rendered. Adding jsdom would still miss workerd limits, real Storage, and device file-picker behavior; adding browser E2E solely for this phase conflicts with the current test plan's explicit UI exclusion.

### 6. Known limitations and scope boundaries

- HEIC/HEIF is intentionally unsupported today. The required behavior is explicit, visible rejection with no side effects, not successful HEIC storage.
- EXIF metadata is stored opaquely; the app does not normalize orientation, resize, compress, check dimensions, or decode the image.
- MIME validation trusts client-declared `File.type`; bytes are not sniffed. This is recorded as accepted MVP security debt, so Phase 4 should pin current declared-MIME behavior unless hardening is opened as a separate product change.
- Cleanup after a database failure and cleanup of a superseded photo are best effort. A cleanup failure can leave an orphan and is only logged; there is no reconciliation job.
- A raw HTTP error response proves the server contract but not user-visible rendering. Do not describe HTTP-only coverage as proving the entire phrase "message the user actually sees."
- Deleting plants and hosted-versus-local migration drift are adjacent concerns, not part of this upload-boundary phase.

## Code References

- `src/components/add-plant-form/add-plant-form.tsx:53-120` — browser FormData submission, generic Action failure feedback, and client-side photo validation.
- `src/components/edit-plant-form/edit-plant-form.tsx:62-109,155-195` — keep/replace/remove intent and edit failure feedback.
- `src/actions/index.ts:11,34-94` — Action schema, upload-first add flow, row insert, and compensating cleanup.
- `src/actions/index.ts:97-225` — update photo tri-state, upload/RPC/delete sequence, and rollback cleanup.
- `src/lib/photo.ts:5-38` — shared limits, allowed MIME types, path generation, and signed URL resolution.
- `astro.config.mjs:9-18` — SSR Cloudflare adapter and 5 MiB Action body ceiling.
- `supabase/migrations/20260719120001_create_plant_photos_bucket.sql:4-47` — private bucket constraints and owner-folder policies.
- `vitest.integration.config.ts:23-45` — Node integration environment and real-Astro runtime shims.
- `test/fixtures/photos.ts:4-54` — current synthetic fixture and real Storage assertions.
- `test/fixtures/user.ts:426-478` — cleanup and authenticated request headers.
- `src/actions/update-plant.integration.test.ts:121-185` — existing below-HTTP lifecycle coverage.
- `src/actions/per-account-isolation.integration.test.ts:108-213` — existing Storage ownership coverage.

## Architecture Insights

The application intentionally uses an application-mediated upload rather than direct browser-to-Storage upload. This makes one Worker request responsible for transport, authentication, validation, Storage persistence, database linkage, and cleanup. It produces a valuable typed mutation surface but makes the Worker body limit part of the product contract.

There are three different size/type enforcement points: shared app validation, Astro request size, and Supabase bucket constraints. A unit test at any one point cannot establish that their envelopes compose correctly. The near-4 MiB HTTP success case is the cheapest composition test because it simultaneously proves that the Action ceiling leaves enough multipart overhead and that the bucket accepts the resulting object.

The database pointer and Storage object are not transactionally coupled. Correct tests must assert an atomic user outcome rather than only a response: success means row plus retrievable object; failure means neither. Update replacement additionally means old pointer/object preserved and new object absent after failure.

The current integration substrate is deliberately real rather than mocked. Extending it upward with a running workerd server preserves the project's cost-to-signal philosophy and avoids a parallel fake Storage model.

## Historical Context (from prior changes)

- `context/foundation/test-plan.md:42-85` defines Risk #7 and explicitly requires multipart integration at the real Worker HTTP boundary; direct helper calls and mocked Storage are named anti-patterns.
- `context/foundation/test-plan.md:64-72` accepts that HTTP automation will not detect a file dropped by the client before request formation and defers browser coverage on cost/UI-churn grounds.
- `context/foundation/test-plan.md:93-112` opens Phase 4 with the lowest rollout budget and requires automation plus documented manual smoke.
- `context/foundation/test-plan.md:263-267` leaves the Storage-boundary cookbook section for this phase to complete.
- `context/archive/2026-07-19-core-watering-loop/plan.md:18-24,142-154` identified Astro's former 1 MiB default as the likely silent-failure trap and chose a 4 MiB validated file under a 5 MiB Action envelope.
- `context/archive/2026-07-19-core-watering-loop/reviews/impl-review.md:92-100` accepted declared-MIME trust/no magic-byte sniffing as MVP debt.
- `context/archive/2026-07-28-testing-task-list-and-mutation-integrity/research.md:271-316` documents photo keep/replace/remove semantics and the non-atomic Storage/row lifecycle.
- `context/changes/testing-per-account-isolation/research.md:188-206,573-590` establishes the existing Storage policy coverage and the rule that denied listing is not proof of isolation.

Git history aligns with those artifacts: bucket foundation landed in `27e7271`, Action upload/body-ceiling work in `0461b49`, shared photo validation in `9c66f15` with follow-up `106fc70`, edit photo-integrity coverage in `d40f5c0`, and Storage isolation coverage in `107782f` with review fix `f7ced38`.

## Related Research

- `context/changes/testing-per-account-isolation/research.md` — current Storage policies, authenticated client behavior, and cross-account contract coverage.
- `context/archive/2026-07-28-testing-task-list-and-mutation-integrity/research.md` — existing Action integration harness and photo lifecycle semantics.
- `context/archive/2026-07-19-core-watering-loop/research.md` — original architecture exploration before the upload path was fixed as an Astro Action.

## Open Questions

1. Should the automated success fixture be exactly 4 MiB or slightly below it to avoid any vendor-side off-by-one ambiguity? Exact limit gives more precision; near-limit gives a more stable regression signal.
2. Is `astro dev` sufficient for the permanent suite, or should this phase pay for build-plus-preview orchestration to match the deployed bundle more closely?
3. Should HEIC rejection be a required automated case or remain in the manual smoke, given the phase's intentionally small budget?
4. Where should genuine binary fixtures live, and should the near-limit image be committed or deterministically generated from a small valid base image?
5. Does "visible failure" require browser automation now, or is a server-contract assertion plus the accepted manual device smoke sufficient until the UI layer is brought into the automated strategy?
6. Should this phase add the uncovered replacement-conflict cleanup composition, or keep its implementation plan focused on the missing add/HTTP boundary?
