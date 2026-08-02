# Photo Upload Boundary Implementation Plan

## Overview

Close §3 Phase 4 of the test plan (Risk #7): prove that a phone-shaped photo upload either
persists and is retrievable afterwards, or fails visibly — never silently succeeds without the
file. The test plan is explicit that this must be asserted **at the real HTTP boundary**, because
the failure mode it protects against (a 12 MB phone photo hitting the Worker's request body
ceiling) is unreachable from an in-process Action call.

This change stands up a workerd-backed HTTP test substrate, drives a four-case `addPlant` matrix
through it, and converts the result into a durable cookbook pattern plus a release-time manual
device checklist.

## Current State Analysis

**The gap is precise and confirmed.** Every existing integration test invokes Actions in-process
via `server.<action>.orThrow.call(context, formData)` with a synthetic context built by
`createActionContext` (`test/fixtures/action-context.ts:5`). That reaches real Supabase JWTs, RLS,
RPCs and Storage — but it never serializes multipart, never routes through `/_actions/*`, never
runs middleware, and never meets `security.actionBodySizeLimit`. Additionally, **no test invokes
`addPlant` at all**; the primary user-facing upload path has zero coverage of any kind.

**The harness is close to ready.** Three pieces already exist and are directly reusable:

- `createActionRequestHeaders(cookieJar)` (`test/fixtures/user.ts:466`) returns a `Headers` object
  carrying exactly the `Cookie` header a raw `fetch` needs. The fixture sign-in already populates
  that jar with real Supabase session cookies.
- `expectPhotoAvailable` / `expectPhotoAbsent` (`test/fixtures/photos.ts:23,41`) assert Storage
  side effects as the owner, with `expectPhotoAbsent` deliberately using owner-scoped listing
  rather than a failed download.
- `test/setup/global-setup.ts` provides the run namespace, sweeps stale fixture users, and fails
  the run on residual Storage objects at teardown.

**What is missing:** a server lifecycle, a real binary image fixture (the current one is a text
string labelled `image/png`, `test/fixtures/photos.ts:5`), and a home for the new suite.

**Cost constraint.** `globalSetup` is shared by the whole integration suite. Booting a dev server
there would tax every `pnpm test:integration` run — the command developers run most — for tests
that do not need it.

## Desired End State

`pnpm test:http` starts a local Astro dev server on workerd, runs a dedicated suite that POSTs
real multipart requests to `/_actions/addPlant` as an authenticated fixture user, and asserts the
atomic user outcome for four payload shapes. The test plan's §6.5 cookbook section is filled in,
§3 Phase 4 reads `complete`, and a tickable manual device checklist lives at
`context/foundation/manual-device-smoke.md`.

Verify by: running `pnpm test:http` green against a local Supabase stack; deliberately raising
`MAX_PHOTO_BYTES` above `security.actionBodySizeLimit` and confirming the near-limit success case
turns red; deliberately removing `image/heic` handling expectations and confirming the rejection
case turns red.

### Key Discoveries:

- **`astro dev` already runs in workerd.** `@astrojs/cloudflare/dist/index.js:153` adds
  `cfVitePlugin(...)` to the Vite plugin list unconditionally — not only under `preview`. The
  Cloudflare Vite plugin runs the `ssr` environment inside Miniflare/workerd. This resolves
  research Open Question #2: build-plus-preview buys bundle fidelity, not runtime fidelity, and
  is not worth its orchestration cost for this phase.
- **`POST /_actions/<name>` returns a real `Response`, not a redirect.**
  `astro/dist/actions/runtime/server.js:145` decides RPC-vs-form by *route pattern*: a request
  matching `/_actions/[...path]` is classified `from: "rpc"`, and
  `astro/dist/actions/handler.js:26` returns a serialized JSON `Response` with an HTTP status.
  Only the `?_astroAction=` query-param form gets the redirect-plus-`locals` treatment. A raw
  `fetch` therefore observes the full server contract without a browser.
- **The size limit is enforced before schema validation.** `parseRequestBody`
  (`astro/dist/actions/runtime/server.js:154-163`) reads `content-length` and throws
  `ActionError` `CONTENT_TOO_LARGE` before the zod schema runs. The oversized case never reaches
  `isValidPhoto`, and the near-limit success case is the *only* test that proves the 5 MiB
  envelope actually leaves room for multipart overhead above the 4 MiB file cap.
- **Three limits are byte-identical at 4 MiB.** `MAX_PHOTO_BYTES` (`src/lib/photo.ts:5`) and the
  bucket's `file_size_limit` (`supabase/migrations/20260719120001_create_plant_photos_bucket.sql:8`)
  are both `4194304`. `isValidPhoto` uses `<=`; Supabase rejects on `size > limit`. Both should
  accept an exactly-4-MiB file, but that agreement is currently assumed, not asserted.
- **`addPlant` requires a plausible `clientDate`.** `getActionDate` (`src/actions/index.ts:26`)
  throws before any upload if the field is missing or implausible. Every HTTP request in this
  suite must carry it, or every case fails for the wrong reason.
- **`addPlant` uploads before inserting** (`src/actions/index.ts:55-91`), with best-effort object
  cleanup on insert failure. A 2xx alone is not proof of persistence — the row pointer and the
  downloadable object must be asserted together.
- **CI does not run integration tests today.** `.github/workflows/ci.yml` runs lint, check, unit
  (twice, for TZ) and build. There is no Docker or Supabase step, so the §5 "required after Phase
  2/3" gate rows are aspirational. Wiring `test:http` into CI belongs to §3 Phase 5
  (quality-gates wiring), not to this change.
- **The existing `globalSetup` is composable** — a default-exported `async function(project)`
  returning a teardown closure — so the HTTP config can delegate to it rather than fork its
  namespace and stale-sweep logic.

## What We're NOT Doing

- **No browser layer.** Test plan §7 excludes the UI while the design is unsettled, and §2 records
  the accepted gap: if the React island drops the file before the request is formed, no test here
  sees it. That is what the manual device smoke covers. Revisit per §8 when roadmap slice S-09
  lands.
- **No `updatePlant` HTTP coverage.** Keep/replace/remove already have in-process coverage
  (`src/actions/update-plant.integration.test.ts:121`). The one genuinely uncovered composition —
  replacement upload followed by a stale-`updated_at` conflict, requiring the new object to be
  cleaned up (`src/actions/index.ts:210-218`) — is a real gap but has nothing to do with multipart
  or body limits. It belongs in a follow-up change at the in-process layer.
- **No build-plus-preview harness.** See Key Discoveries — `astro dev` is already workerd.
- **No magic-byte sniffing or MIME hardening.** Declared-MIME trust is recorded accepted MVP debt
  (`context/archive/2026-07-19-core-watering-loop/reviews/impl-review.md:92-100`). This phase pins
  current behaviour; it does not change it.
- **No PNG/WebP repetition.** The same allowlist is shared by client, Action and bucket; a third
  supported-format case adds cost without signal.
- **No CI wiring.** See Key Discoveries — that is §3 Phase 5.
- **No EXIF orientation normalisation.** Byte equality proves transport and persistence. Whether a
  browser renders the orientation correctly is a manual-smoke item.

## Implementation Approach

A separate Vitest config and script (`vitest.http.config.ts`, `pnpm test:http`) keeps the server
cost opt-in, mirroring the reason `vitest.integration.config.ts` was split off from the unit config
in the first place. Its `globalSetup` composes the existing integration setup with a dev-server
lifecycle and hands the base URL to workers via `project.provide`, the same channel already used
for the run namespace.

Tests build native `FormData`, attach a real `File`, and `fetch` the running server with the
fixture user's cookie header. The HTTP response is treated as *transport* evidence only; the
outcome is proven by re-reading the plant row as its owner and downloading the stored object.

Phase 1 proves the substrate with a single smoke test. Phase 2 adds the risk matrix. Phase 3
converts the result into documentation and a release gate.

## Critical Implementation Details

**Lifecycle and teardown ordering.** Launch Astro's CLI entry point directly as a child process,
not through a `pnpm` wrapper whose termination can leave descendants alive. The HTTP `globalSetup`
must wrap server startup and readiness in `try`/`catch`: if setup fails after the child starts,
terminate the child process group and await the delegated integration teardown before rethrowing.
Vitest does not register a returned teardown until setup resolves, so the returned teardown cannot
cover this path. During normal teardown, stop the server *before* delegating to the integration
teardown, using `try`/`finally` so delegated cleanup still runs when server shutdown fails. Send
`SIGTERM`, await exit for a bounded interval, then escalate the process group to `SIGKILL`. The
integration teardown throws on residual Storage objects and sets `process.exitCode = 1`; it must
not be able to strand the server or its workerd descendant.

**Server address and readiness.** Pass Astro an explicit candidate port and
`--host 127.0.0.1`, then derive the actual base URL from that child's ready output before probing
it. Do not assume `--port 0` produces a discoverable OS-assigned port in this adapter stack, and do
not probe candidate ports before associating the URL with the spawned child — Vite may increment an
occupied port, while an unrelated `pnpm dev` may already answer on the candidate. Probe the
announced URL until it answers, with a bounded timeout and early failure when the child exits;
never use a fixed `sleep`. Vite + workerd cold-start is variable and a fixed delay is either flaky
or wasteful.

**Exact-limit triage rule.** The exactly-4-MiB case asserts that `isValidPhoto`'s `<=` and
Supabase's `file_size_limit` agree on inclusivity. If it goes red, triage it as a
limit-inclusivity finding first — do not assume the fixture is wrong and shrink it, which would
silently delete the assertion.

**Oversized-case mechanics.** `undici`'s `fetch` sets `content-length` for a fully-buffered
`FormData` body, so the >5 MiB case hits the fast-path check in `parseRequestBody` and never
streams. Assert the HTTP status and the `CONTENT_TOO_LARGE` code, then assert *both* absences —
no plant row with that name, and no new object in the owner's Storage folder.

**Successful-case cleanup.** Every case that persists a plant and photo must remove both through
the owner fixture in a `finally` block after its persistence assertions, then positively assert
that the row and object are absent. The delegated integration teardown treats any remaining
Storage object as a suite failure, so it is a backstop for failed cleanup rather than the normal
cleanup mechanism. This rule also keeps focused execution of a single successful case green.

## Phase 1: HTTP harness + binary fixtures

### Overview

Stand up the substrate — config, script, server lifecycle, real image fixtures — and prove it with
one smoke test. This phase ships no Risk #7 signal; its job is to make Phase 2's assertions
trustworthy.

### Changes Required:

#### 1. HTTP suite configuration

**File**: `vitest.http.config.ts`

**Intent**: A third Vitest config for tests that cross the real HTTP boundary, so the server boot
cost stays out of `pnpm test:integration`. Mirrors `vitest.integration.config.ts` in environment,
TZ handling, worker count and `tsconfig-paths` wiring, but includes only `*.http.test.ts(x)` and
points at the new globalSetup.

**Contract**: `test.include` matches `src/**/*.http.test.{ts,tsx}`; `test.globalSetup` points at
`test/setup/http-global-setup.ts`; `test.setupFiles` reuses `test/setup/load-env.ts` and
`test/setup/reset-integration-slots.ts`. The `astro:actions` / `astro:env/server` aliases from the
integration config are **not** needed here — this suite never imports app modules that resolve
them; it talks HTTP. Add a header comment stating that, so a future reader does not copy the
aliases in as cargo. `testTimeout` must exceed the integration suite's 15s: a 4 MiB upload plus a
download round trip is slower than an in-process call.

#### 2. Server lifecycle

**File**: `test/setup/http-global-setup.ts`

**Intent**: Compose the existing integration globalSetup with an `astro dev` child process, so the
HTTP suite inherits the run namespace, stale sweep and residual-object teardown verbatim rather
than forking them.

**Contract**: Default-exports `async function(project: TestProject)` returning a teardown closure,
matching the existing setup's shape. Awaits the existing `globalSetup` first (capturing its
teardown), starts Astro's CLI directly on an explicit localhost port, obtains the actual URL from
the spawned child's ready output, probes that URL, then `project.provide("httpBaseUrl", <url>)`.
Setup failure terminates the process group and runs the delegated teardown before rethrowing. The
returned teardown uses bounded TERM-to-KILL shutdown and stops the process group before awaiting
the delegated teardown — see Critical Implementation Details.

#### 3. Provided-context type augmentation

**File**: `test/setup/provided-context.d.ts`

**Intent**: Add `httpBaseUrl` alongside `integrationRunNamespace` so `inject("httpBaseUrl")` types
correctly. The existing file's header comment already explains why the augmentation lives in a
declaration file rather than beside the `provide()` call — that reasoning applies unchanged.

**Contract**: `ProvidedContext` gains `httpBaseUrl: string`.

#### 4. Real binary photo fixtures

**Files**: `test/fixtures/images/seed.jpg` (new binary asset), `test/fixtures/photos.ts`

**Intent**: Replace the text-labelled-as-PNG fixture's role for boundary tests with a genuine JPEG
carrying EXIF orientation metadata, plus a helper that pads it deterministically to a requested
byte size. Keeps the repo small while giving every case real JPEG magic bytes. Also add a small
HEIC fixture for the rejection case.

**Contract**: A helper that takes a target byte count and returns a `File` of exactly that size
with `type: "image/jpeg"`, and a helper returning a small `File` with `type: "image/heic"`. Do not
remove `createPhotoFile` — the existing integration and isolation suites depend on it.

Padding is appended after the JPEG's EOI marker so the leading bytes stay a valid image. Document
in a comment that this is deliberate and that a future magic-byte-sniffing change must revisit the
helper — otherwise a reader will "fix" it into an invalid file.

#### 5. HTTP request helper

**File**: `test/fixtures/http-actions.ts`

**Intent**: One place that builds an authenticated multipart POST to an Action route, so each test
states only what varies. Encodes the two easy-to-forget details: the fixture cookie header, and
the required `clientDate` field.

**Contract**: Takes a user fixture, an action name and a `FormData`; returns the raw `Response`.
Error cases parse the ordinary JSON error body explicitly where needed; successful cases prove the
outcome through database and Storage re-reads rather than treating Astro's Devalue wire payload as
ordinary JSON. Uses `createActionRequestHeaders(userFixture.cookieJar)` for auth and
`inject("httpBaseUrl")` for the target. Set `Origin` to the injected base URL's origin — Node's
`fetch` does not synthesize it, and Astro rejects multipart POSTs whose origin does not match the
request URL. Must **not** set `Content-Type` manually — `fetch` derives the multipart boundary from
the `FormData` body, and an explicit header breaks the boundary parameter. Add a helper that builds
a valid baseline `addPlant` form (name, both intervals, `alreadyWatered`, `clientDate`) so each test
overrides only the photo.

#### 6. Substrate smoke test

**File**: `src/actions/add-plant.http.test.ts`

**Intent**: Prove the harness end to end before Phase 2 depends on it — an authenticated
`addPlant` POST with a small valid JPEG returns success, the row exists with an owner-prefixed
`photo_path`, and the object downloads.

**Contract**: One test. Asserts `photo_path` starts with `${userFixture.userId}/`, and uses
`expectPhotoAvailable` for the object. This test stays in place after Phase 2 as the harness's own
canary — a Phase 2 failure is ambiguous if the substrate has no independent check. Clean up the
created row and object according to the Successful-case cleanup rule.

#### 7. Script wiring

**File**: `package.json`

**Intent**: Add `test:http` so the suite is runnable and discoverable.

**Contract**: `"test:http": "vitest run --config vitest.http.config.ts"`. Do not add it to any
existing composite script — CI wiring is §3 Phase 5.

#### 8. Local setup documentation

**File**: `README.md`

**Intent**: Keep the local Supabase prerequisites accurate after adding a second Supabase-backed
test command.

**Contract**: State that both `pnpm test:integration` and `pnpm test:http` require the local
Supabase stack plus `SUPABASE_URL`, `SUPABASE_KEY` and `SUPABASE_DB_URL`. Keep the existing startup
and `.env` guidance as the single source of setup details rather than duplicating it in the test
plan.

### Success Criteria:

#### Automated Verification:

- Lint passes: `pnpm lint`
- Type checking passes: `pnpm check`
- Unit suite still passes: `pnpm test`
- Existing integration suite still passes and is not slowed by a server boot: `pnpm test:integration`
- The new suite passes: `pnpm test:http`
- Running `pnpm test:http` twice in a row passes both times (no leaked port, no leaked fixture state)
- README formatting passes: `pnpm exec prettier --check README.md`

#### Manual Verification:

- `pnpm test:http` exits cleanly with no orphaned `astro dev` process (`ps` shows none afterwards)
- Starting `pnpm dev` first, then running `pnpm test:http`, does not wedge on a port collision
- Killing the Supabase stack mid-run produces a readable failure, not a hang

**Implementation Note**: After completing this phase and all automated verification passes, pause
for manual confirmation before proceeding to Phase 2.

---

## Phase 2: Risk #7 case matrix

### Overview

Drive the four payload shapes through the harness and assert the atomic user outcome for each.
This is the phase that produces the Risk #7 signal.

### Changes Required:

#### 1. Near-limit success cases

**File**: `src/actions/add-plant.http.test.ts`

**Intent**: Prove that a phone-realistic supported image survives the whole boundary — that the
5 MiB Action envelope leaves enough room for multipart overhead above the 4 MiB file cap, that the
bucket accepts the resulting object, and that the row points at it.

**Contract**: Two cases. The **exactly-`MAX_PHOTO_BYTES`** case is primary: it asserts byte
equality between the uploaded fixture and the downloaded object, and pins the inclusive `<=`
agreement between `isValidPhoto` and the bucket's `file_size_limit`. The **just-below** case
(e.g. `MAX_PHOTO_BYTES - 1024`) is the stability signal and may assert size and prefix without a
full byte comparison. Import `MAX_PHOTO_BYTES` from `@/lib/photo` rather than restating `4194304`
— a test that hardcodes the number stops tracking the constant it exists to protect.

Both cases clean up their created row and object according to the Successful-case cleanup rule.

#### 2. Oversized payload case

**File**: `src/actions/add-plant.http.test.ts`

**Intent**: Prove the exact scenario the test plan names — a 12 MB phone photo — fails loudly at
the Worker body ceiling and leaves nothing behind. This case is unreachable from an in-process
Action call, and is the reason this suite exists.

**Contract**: A ~12 MiB `image/jpeg` payload. Assert the HTTP status and the `CONTENT_TOO_LARGE`
code from the serialized error body. Then assert **both** absences: no plant row with the unique
name, and no new object in the owner's Storage folder. A single absence assertion is not enough —
the failure being protected against is a partial save.

#### 3. HEIC rejection case

**File**: `src/actions/add-plant.http.test.ts`

**Intent**: Pin that the most common phone format is rejected *explicitly* rather than
accidentally persisted or surfaced as a 500. iPhones default to HEIC, making this the likeliest
real-world rejection path.

**Contract**: A small (well under the size limit) `image/heic` file, so the failure is
unambiguously about type rather than size. Assert the rejection is an input/validation failure
carrying `PHOTO_GUIDANCE`-shaped feedback — not `INTERNAL_SERVER_ERROR`. Then assert no row and no
object, as above.

Add a comment stating what this case does **not** prove: that the user saw the guidance. That is
`context/foundation/manual-device-smoke.md`'s job. Without the comment, a future reader will
reasonably assume this covers the user-visible message.

#### 4. Shared assertion helper

**File**: `test/fixtures/photos.ts`

**Intent**: The "no row and no object" pair is asserted by three cases; give it one name so a
future case cannot half-assert it.

**Contract**: A helper taking a user fixture and a plant name that asserts no matching plant row
exists and the owner's Storage folder gained no object. Reuses the owner-scoped listing approach
already documented in `expectPhotoAbsent`'s comment — a denied list returns `[]` and proves
nothing, so this must always run as the owner.

### Success Criteria:

#### Automated Verification:

- Lint passes: `pnpm lint`
- Type checking passes: `pnpm check`
- Full matrix passes: `pnpm test:http`
- Existing suites unaffected: `pnpm test` and `pnpm test:integration`
- Suite teardown reports no residual Storage objects (the run exits 0)

#### Manual Verification:

- Deliberate break: raise `MAX_PHOTO_BYTES` above `security.actionBodySizeLimit` — the near-limit
  success cases must turn red. Revert.
- Deliberate break: add `image/heic` to `PHOTO_MIME_EXTENSIONS` — the HEIC case must turn red.
  Revert.
- Deliberate break: lower `security.actionBodySizeLimit` to 1 MiB (Astro's old default) — the
  near-limit success cases must turn red. This is the specific regression
  `context/archive/2026-07-19-core-watering-loop/plan.md:18-24` identified as the silent-failure
  trap. Revert.
- Confirm the oversized case fails at the body limit rather than at schema validation (the error
  code is `CONTENT_TOO_LARGE`, not a zod message)

**Implementation Note**: The deliberate-break checks are the phase's real acceptance test — a
green suite that stays green when the limit moves is a tautology. Pause for manual confirmation
before proceeding to Phase 3.

---

## Phase 3: Cookbook, gate, and manual smoke

### Overview

Convert the working suite into something the next contributor can follow, and turn the manual
half of the Risk #7 response into a tickable release gate rather than a paragraph.

### Changes Required:

#### 1. Cookbook §6.5

**File**: `context/foundation/test-plan.md`

**Intent**: Replace the `TBD — see §3 Phase 4` placeholder with the actual pattern: when to reach
for `pnpm test:http` instead of `pnpm test:integration`, how the server lifecycle works, and the
non-obvious rules a new test will otherwise get wrong.

**Contract**: The section must state the decision rule (use HTTP only when multipart encoding, the
Action route, middleware, or the body ceiling is part of the risk — otherwise the cheaper
in-process layer wins, per §1 principle #1), the `clientDate` requirement, the "never set
Content-Type manually" rule, and the "assert the atomic outcome, not the response" rule. Also
record what the layer does **not** prove, so nobody describes HTTP coverage as proving the
user-visible message.

#### 2. Rollout status and stack rows

**File**: `context/foundation/test-plan.md`

**Intent**: Reflect reality in §3, §4 and §8 now that the phase has landed.

**Contract**: §3 Phase 4 Status becomes `complete`. §4 gains a row for the HTTP suite naming
`astro dev` on workerd as the substrate, with a `checked:` date. §8 Freshness Ledger gets a dated
entry. Leave the §5 gate row's "recommended after §3 Phase 4" wording intact for the manual smoke,
and do **not** claim `test:http` is CI-enforced — CI has no Supabase stack, and that wiring is
§3 Phase 5.

#### 3. Manual device smoke checklist

**File**: `context/foundation/manual-device-smoke.md`

**Intent**: Make the manual half of the Risk #7 response executable. It lives in
`context/foundation/` rather than the change folder because the change folder gets archived and a
per-release gate must not disappear with it.

**Contract**: A tickable checklist with pass/fail rows covering at least one iPhone and one
Android path, drawn from research §5: camera/library selection with a preview matching the chosen
file; save, navigate, and confirm the image reloads from the private bucket; an oversized or HEIC
selection showing actionable guidance with other fields intact and retry possible; an EXIF-rotated
JPEG with acceptable orientation in both preview and saved image.

Each row states what a failure means, so a tester who sees one knows whether it is a bug or an
environment problem. Head the file with why it exists — it covers the accepted automation gap
recorded in test-plan §2, namely that the client island could drop the file before the request is
formed and no HTTP test would see it.

#### 4. Change close-out

**File**: `context/changes/testing-photo-upload-boundary/change.md`

**Intent**: Mark the change complete.

**Contract**: `status: complete`, `updated` set to the completion date.

### Success Criteria:

#### Automated Verification:

- Markdown formatting passes: `pnpm exec prettier --check context/foundation/test-plan.md context/foundation/manual-device-smoke.md`
- Full local floor still green: `pnpm lint`, `pnpm check`, `pnpm test`, `pnpm test:integration`, `pnpm test:http`

#### Manual Verification:

- §6.5 is followable: a reader can tell from it alone whether a new test belongs in the HTTP suite
  or the integration suite
- The manual checklist is executed once against a real phone, and its rows are specific enough to
  produce an unambiguous pass or fail
- §3 Phase 4 status and §8 ledger reflect what actually shipped, with no claim of CI enforcement

---

## Testing Strategy

This change *is* tests, so the strategy is about what each layer is allowed to claim.

### The HTTP layer proves:

- Multipart serialization and parsing survive a ~4 MiB payload
- `security.actionBodySizeLimit` composes correctly with `MAX_PHOTO_BYTES` — the envelope leaves
  room for multipart overhead
- The Worker rejects an oversized body with `CONTENT_TOO_LARGE` and no partial save
- The type allowlist rejects HEIC explicitly, with no side effects
- A successful upload produces a row pointer and a byte-identical downloadable object

### The HTTP layer does not prove:

- That the React island put the selected file into the request (the accepted gap, test-plan §2)
- That the user saw a toast or inline error
- That a browser renders EXIF orientation correctly

### Manual device smoke covers:

The four checklist items in Phase 3 — precisely the claims above that automation cannot make.

### What stays where it is:

Keep/replace/remove semantics, cleanup of superseded objects, and cross-account Storage policy
already have in-process integration coverage
(`src/actions/update-plant.integration.test.ts:121`, `src/actions/per-account-isolation.integration.test.ts:108`).
Repeating them over HTTP would add cost without signal.

## Performance Considerations

`pnpm test:http` is the slowest suite in the repo by construction: Vite plus workerd cold-start,
plus roughly 20 MiB of payload across four cases. That cost is why it lives behind its own config
and script rather than in `test:integration`. Do not add cases to it that a cheaper layer can
carry — test-plan §1 principle #1 is the governing rule.

The exactly-4-MiB and just-below cases are both near-limit uploads; if the suite becomes a
bottleneck later, the just-below case is the one to drop, since the exact case carries the
inclusivity assertion.

## Migration Notes

None — this change adds tests and documentation. No schema, no runtime code, no user-visible
behaviour changes. Reverting it removes coverage and nothing else.

One forward dependency: §3 Phase 5 (quality-gates wiring) will need to add a Docker/Supabase step
to `.github/workflows/ci.yml` before `test:integration` or `test:http` can be enforced. That work
is explicitly out of scope here but should be noted when Phase 5 opens.

## References

- Related research: `context/changes/testing-photo-upload-boundary/research.md`
- Risk #7 definition and response guidance: `context/foundation/test-plan.md:50,84`
- Accepted automation gap: `context/foundation/test-plan.md:64-72`
- Cookbook slot to fill: `context/foundation/test-plan.md:263-267`
- Upload path under test: `src/actions/index.ts:34-94`
- Shared photo limits: `src/lib/photo.ts:5-19`
- Body ceiling: `astro.config.mjs:16-18`
- Bucket constraints: `supabase/migrations/20260719120001_create_plant_photos_bucket.sql:4-11`
- Reusable fixtures: `test/fixtures/user.ts:466`, `test/fixtures/photos.ts:23-54`
- Config to mirror: `vitest.integration.config.ts`
- Setup to compose: `test/setup/global-setup.ts`
- Astro RPC-vs-form classification: `node_modules/astro/dist/actions/runtime/server.js:145`
- Astro body-limit enforcement: `node_modules/astro/dist/actions/runtime/server.js:154-163`
- Original 1 MiB trap analysis: `context/archive/2026-07-19-core-watering-loop/plan.md:18-24`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: HTTP harness + binary fixtures

#### Automated

- [x] 1.1 Lint passes: `pnpm lint` — ab35fa9
- [x] 1.2 Type checking passes: `pnpm check` — ab35fa9
- [x] 1.3 Unit suite still passes: `pnpm test` — ab35fa9
- [x] 1.4 Existing integration suite still passes and is not slowed by a server boot: `pnpm test:integration` — ab35fa9
- [x] 1.5 The new suite passes: `pnpm test:http` — ab35fa9
- [x] 1.6 Running `pnpm test:http` twice in a row passes both times — ab35fa9
- [x] 1.7 README formatting passes: `pnpm exec prettier --check README.md` — ab35fa9

#### Manual

- [x] 1.8 `pnpm test:http` exits cleanly with no orphaned `astro dev` process — ab35fa9
- [x] 1.9 Running `pnpm dev` first does not wedge `pnpm test:http` on a port collision — ab35fa9
- [x] 1.10 Killing the Supabase stack mid-run produces a readable failure, not a hang — ab35fa9

### Phase 2: Risk #7 case matrix

#### Automated

- [x] 2.1 Lint passes: `pnpm lint` — 9843786
- [x] 2.2 Type checking passes: `pnpm check` — 9843786
- [x] 2.3 Full matrix passes: `pnpm test:http` — 9843786
- [x] 2.4 Existing suites unaffected: `pnpm test` and `pnpm test:integration` — 9843786
- [x] 2.5 Suite teardown reports no residual Storage objects — 9843786

#### Manual

- [x] 2.6 Deliberate break: raising `MAX_PHOTO_BYTES` above the body limit turns the near-limit cases red — 9843786
- [x] 2.7 Deliberate break: adding `image/heic` to the allowlist turns the HEIC case red — 9843786
- [x] 2.8 Deliberate break: lowering `actionBodySizeLimit` to 1 MiB turns the near-limit cases red — 9843786
- [x] 2.9 Oversized case fails at the body limit, not at schema validation — 9843786

### Phase 3: Cookbook, gate, and manual smoke

#### Automated

- [x] 3.1 Markdown formatting passes: `pnpm exec prettier --check` on the two docs — dbba1e1
- [x] 3.2 Full local floor still green: lint, check, test, test:integration, test:http — dbba1e1

#### Manual

- [ ] 3.3 §6.5 is followable: a reader can tell which suite a new test belongs in
- [ ] 3.4 The manual checklist is executed once against a real phone and produces unambiguous rows
- [ ] 3.5 §3 Phase 4 status and §8 ledger reflect what shipped, with no claim of CI enforcement
