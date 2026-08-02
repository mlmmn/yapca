<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Photo Upload Boundary Implementation Plan

- **Plan**: `context/changes/testing-photo-upload-boundary/plan.md`
- **Scope**: Phases 1–3 of 3 (Phase 3 manual rows 3.3–3.5 still open)
- **Date**: 2026-08-02
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 7 warnings, 3 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | WARNING |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | PASS    |

**Success Criteria evidence** (all run during this review against the live local Supabase stack):
`pnpm lint` exit 0 · `pnpm check` 0 errors/0 warnings · `pnpm test` 102 passed ·
`pnpm test:integration` 35 passed in 1.63s (no server-boot tax) · `pnpm test:http` 5 passed in 21.29s ·
`pgrep` shows no orphaned `astro dev` or `workerd` after the run.

**Plan Adherence detail**: 18 of 19 planned items MATCH. The single miss is `change.md` status (F8).
All seven "What We're NOT Doing" guardrails were respected — no browser layer, no `updatePlant` HTTP
coverage, no build-plus-preview harness, no MIME hardening, no PNG/WebP repetition, no CI wiring
(`.github/workflows/ci.yml` untouched), no EXIF normalisation.

## Findings

### F1 — Setup-failure path can skip the delegated integration teardown

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: test/setup/http-global-setup.ts:95-102
- **Detail**: The catch block runs `await stopServer(server)` and then `await integrationTeardown()`
  sequentially and unguarded. `stopServer` can genuinely throw (see F4). If it does,
  `integrationTeardown()` never runs — fixture users and their Storage objects leak from the failed
  run — and the original readiness error is replaced by an opaque `ESRCH`. The success path at
  :104-110 already gets this right with `try`/`finally`; the two paths disagree. The plan's Critical
  Implementation Details explicitly required that the delegated teardown run before rethrowing.
- **Fix**: Wrap the catch body's `stopServer` call in its own `try`/`finally` (or
  `try { await stopServer(server); } catch { /* server already gone */ }`) so `integrationTeardown()`
  always runs and the original error is the one rethrown.
  - Strength: Makes the failure path structurally identical to the success path at :104-110.
  - Tradeoff: None — three added lines.
  - Confidence: HIGH — the asymmetry is visible in the same function.
  - Blind spot: None significant.
- **Decision**: FIXED — try/catch/finally in the setup catch path; original error preserved (applied with F4)

### F2 — Ctrl+C on the vitest run leaks the detached dev server and its workerd child

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: test/setup/http-global-setup.ts:79-84
- **Detail**: `detached: true` is correct and necessary — it is what makes `process.kill(-pid, …)` at
  :36/:41 reap the whole workerd process group. But detaching also removes the child from the
  terminal's foreground process group, so a Ctrl+C `SIGINT` reaches vitest and not the server.
  Vitest does not guarantee globalSetup teardown runs on SIGINT, so an interrupted run can leave
  `astro dev` plus workerd bound to 4321 indefinitely. The next `pnpm test:http` then silently starts
  a second server on 4322 (the readiness regex handles the increment), with two workerd instances
  sharing one Supabase stack. Plan item: "exits cleanly with no orphaned `astro dev` process" —
  verified true for the normal exit path, untested for interrupt.
- **Fix A ⭐ Recommended**: Register `process.once("SIGINT" | "SIGTERM" | "exit", …)` handlers inside
  `httpGlobalSetup` that best-effort `process.kill(-pid, "SIGKILL")`, and remove them in the returned
  teardown closure.
  - Strength: Closes the leak for the interactive path developers actually use, without giving up the
    process-group kill that `detached` buys.
  - Tradeoff: Handlers must be de-registered in teardown or they leak listeners across watch reruns.
  - Confidence: HIGH — standard detached-child pattern; the kill call already exists at :41.
  - Blind spot: `SIGKILL` of the parent still leaks; nothing can fix that case.
- **Fix B**: Accept the leak and document it in test-plan §6.5 as a known interrupt caveat, with the
  recovery command.
  - Strength: Zero new lifecycle code in a file whose complexity is already the main review surface.
  - Tradeoff: A real orphaned-process class stays open; the next run's behaviour is confusing rather
    than loudly broken.
  - Confidence: MEDIUM — depends how often the suite gets interrupted mid-run.
  - Blind spot: Not verified whether the stale server on 4321 causes an actual test failure or just
    wasted resources.
- **Decision**: FIXED via Fix A — registerOrphanGuard kills the process group on SIGINT/SIGTERM/exit, de-registered in both teardown paths

### F3 — Unbounded `fetch` in the readiness probe defeats the 20 s budget

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: test/setup/http-global-setup.ts:55
- **Detail**: `await fetch(baseUrl)` carries no timeout. The `deadline` at :49 is only re-evaluated
  between loop iterations, so if workerd accepts the TCP connection but never responds — a known
  workerd cold-start mode — this single await hangs past `readinessTimeoutMs`, and vitest applies no
  timeout to `globalSetup`. The plan required "a bounded timeout … never use a fixed `sleep`"; the
  loop honours the letter but one await can escape the bound.
- **Fix**: `await fetch(baseUrl, { signal: AbortSignal.timeout(2_000) })` — a hung connect then
  simply fails that attempt and the loop retries until the real deadline.
- **Decision**: FIXED — readiness fetch bounded by AbortSignal.timeout(probeTimeoutMs)

### F4 — `stopServer` throws `ESRCH` for a signal-terminated or already-reaped child

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: test/setup/http-global-setup.ts:32,36,79-84
- **Detail**: Two related gaps in the same lifecycle. (a) The liveness guard at :32 tests only
  `child.exitCode !== null`; Node leaves `exitCode` as `null` and sets `signalCode` when a process
  dies by signal, so a crashed or externally-killed dev server passes the guard and
  `process.kill(-processId, "SIGTERM")` at :36 throws `ESRCH` out of teardown — which is the very
  throw that triggers F1. (b) The spawn at :79 has no `"error"` listener, so a spawn failure (bad
  `astroCliPath`, exec permissions) emits on a listener-less `ChildProcess` and Node escalates it to
  an uncaught exception — killing the run with a raw stack instead of the readable
  "Astro dev exited before becoming ready" message built at :64, and the readiness loop would burn
  the full 20 s first because `exitCode` stays `null` on a spawn error.
- **Fix**: Guard on `child.exitCode !== null || child.signalCode !== null` and wrap both
  `process.kill` calls in `try`/`catch` for `ESRCH`; add `server.once("error", …)` feeding the same
  failure channel `waitForServer` already reads.
- **Decision**: FIXED — signalCode added to both liveness guards, killProcessGroup swallows ESRCH, spawn "error" listener feeds waitForServer (applied with F1)

### F5 — Asserting cleanup helper runs in `finally` and can mask the real failure

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/actions/add-plant.http.test.ts:44-50 (called from :70, :98, :124)
- **Detail**: `removePersistedPhoto` performs four assertions (`expect(photoError)`,
  `expect(plantError)`, plus the two inside `expectPlantPhotoUploadAbsent`) and is invoked
  exclusively from `finally` blocks. If a test body fails and cleanup's assertions also fail, the
  `finally` throw replaces the original error — the reported failure becomes "the row is still
  there" rather than the actual defect. Note the plan itself mandated this shape ("remove both …
  in a `finally` block … then positively assert that the row and object are absent"), so this is as
  much a plan flaw as an implementation one. Secondary: cleanup is conditional on
  `if (photoPath && plantId)`, so a throw inside `expectPersistedPhoto` (`:25`/`:26`) leaves both
  `null` and skips cleanup entirely — mitigated in practice by `reset-integration-slots.ts`, which
  wipes the slot's plants and Storage on the next `getIntegrationUserFixture()`.
- **Fix A ⭐ Recommended**: Hoist `expectPlantPhotoUploadAbsent` out of `finally` into the try block
  as a genuine post-condition, and make the `finally` path non-asserting (delete, swallow, warn).
  - Strength: Keeps the plan's "positively assert absence" requirement as a real assertion while
    removing the error-masking; the slot reset in `reset-integration-slots.ts` is already the
    backstop for a failed delete, exactly as the plan's "backstop rather than the normal cleanup
    mechanism" wording intends.
  - Tradeoff: Cleanup failures become warnings rather than red tests — but the globalSetup teardown
    already fails the run on residual Storage objects, so nothing goes unnoticed.
  - Confidence: HIGH — the backstop the fix leans on is verified present at
    `test/setup/global-setup.ts` and `test/fixtures/user.ts:426-428`.
  - Blind spot: Whether any case relies on the absence assertion running after deletion rather than
    before.
- **Fix B**: Keep the structure and only make the `finally` swallow-and-rethrow-original (capture the
  primary error, re-throw it in preference to any cleanup error).
  - Strength: Smallest diff; preserves the plan's wording verbatim.
  - Tradeoff: Adds error-juggling boilerplate to three tests, or a shared wrapper nobody else uses.
  - Confidence: MEDIUM — correct but more machinery than the problem warrants.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A — removePersistedPhoto is now non-asserting (warns); expectPlantPhotoUploadAbsent hoisted into the try block as a real post-condition in all three success cases. Cookbook §6.5 updated to teach the corrected pattern rather than the `finally`-asserting one

### F6 — HTTP teardown failure is invisible, diverging from the deliberate `global-setup.ts` pattern

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: test/setup/http-global-setup.ts:104-110
- **Detail**: `test/setup/global-setup.ts:79-83` deliberately sets `process.exitCode = 1` on teardown
  failure, with a comment citing the accepted lesson "Always verify command status codes" — because
  vitest logs a teardown throw but still exits 0. The new HTTP teardown has no equivalent: a
  `stopServer` throw propagates out of the `try` block into `finally` and then out of a function
  nothing guards, so a failure to stop the server can leave `pnpm test:http` exiting 0. This is the
  exact failure mode the sibling file was written to prevent.
- **Fix**: Mirror `global-setup.ts:79-83` — catch in the HTTP teardown, set `process.exitCode = 1`,
  and log, so a stranded server cannot report success.
- **Decision**: FIXED — teardown catches, sets process.exitCode = 1, and rethrows, mirroring global-setup.ts:79-83

### F7 — No `describe` wrapper, unlike both integration siblings

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/actions/add-plant.http.test.ts:52-161
- **Detail**: Five bare top-level `test()` calls, all exercising `server.addPlant`.
  `update-plant.integration.test.ts:20` uses `describe("server.updatePlant", …)` and
  `per-account-isolation.integration.test.ts` uses four sibling top-level describes named after the
  function under test (`server.markWatered`, `server.postponePlant`, `server.undoWateringEvent`,
  `storage.objects`). The accepted lesson forbids a *module*-named wrapper, not the function-named
  one — the convention here is `describe("server.addPlant")`.
- **Fix**: Wrap the five tests in `describe("server.addPlant", () => { … })`.
- **Decision**: FIXED — five tests wrapped in describe("server.addPlant")

### F8 — `change.md` status is `implemented`, not the `complete` the plan required

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/changes/testing-photo-upload-boundary/change.md:4
- **Detail**: Phase 3 change #4 specified `status: complete`. The file reads `status: implemented`.
  However, Progress rows 3.3–3.5 are still `- [ ]` — including 3.4, which requires executing the
  manual checklist against a real phone — so `implemented` is arguably the honest state and the plan's
  close-out step was written as if the manual smoke would already be done. This review stamps the file
  `impl_reviewed`, which supersedes both; `complete` belongs at close-out, after 3.3–3.5 are ticked.
- **Fix**: Leave as the review's `impl_reviewed` stamp and set `complete` only when Progress rows
  3.3–3.5 are ticked — treat the plan's close-out ordering, not the file, as the thing that was wrong.
- **Decision**: ACCEPTED, then resolved — rows 3.3–3.5 were subsequently ticked and `change.md` set to `complete` at close-out, in that order. The plan's close-out ordering was the flaw, not the file.

### F9 — Error-path bodies are parsed before the status is asserted

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/actions/add-plant.http.test.ts:138,154
- **Detail**: In the oversized (413) and HEIC (400) cases, `await response.json()` runs before
  `expect(response.status)`. If workerd ever returns an HTML error page or an empty body for a
  body-limit rejection — plausible, since that rejection can be generated below the Astro layer — the
  test reports `SyntaxError: Unexpected token '<'` instead of the actual status, which is precisely
  the diagnostic the oversized case exists to produce.
- **Fix**: Assert `response.status` first, then parse the body.
- **Decision**: FIXED — response.status asserted before response.json() in both the 413 and 400 cases

### F10 — Minor hygiene cluster (four small items)

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: test/setup/http-global-setup.ts:85-90; src/actions/add-plant.http.test.ts:16-17,32-35; test/setup/provided-context.d.ts:1; test/fixtures/photos.ts:79
- **Detail**: (a) `output` accumulates every stdout/stderr chunk for the whole run and the listeners
  are never removed after readiness — `astro dev` logs per request and this suite pushes ~20 MiB of
  uploads. (b) `expectPersistedPhoto` declares `let photoPath`/`let plantId` at :16-17 only to write
  them at :32-33 and return at :35; the AGENTS.md top-of-block rule is about grouping declarations,
  not manufacturing mutable placeholders — it can `return { photoPath: plant.photo_path, plantId:
plant.id }` directly. (c) `provided-context.d.ts:1` still says "`test/setup/global-setup.ts` provides
  this value", but `httpBaseUrl` comes from `http-global-setup.ts:94`. (d) The new
  `expectPlantPhotoUploadAbsent` lacks the owner-only warning comment its sibling `expectPhotoAbsent`
  carries, so a future caller could pass the attacker fixture and get a vacuous pass from a
  denied-list `[]`.
- **Fix**: Cap or drop the output listeners after readiness; return the object literal directly;
  update the two comments.
- **Decision**: FIXED — all four: output listeners removed and buffer cleared after readiness; expectPersistedPhoto returns the object literal directly; provided-context.d.ts and expectPlantPhotoUploadAbsent comments corrected

## Notes (not tracked as findings)

- **`vitest.config.ts` is the only file changed outside the plan's list** — one line adding
  `"src/**/*.http.test.{ts,tsx}"` to `exclude`. Undescribed by the plan but strictly required, or
  `pnpm test` (and Stryker) would try to run the HTTP suite with no server. Not scope creep.
- **No `eslint-disable` comments were added anywhere.** The three pre-authorized test-file
  relaxations remain declared centrally in `eslint.config.js:164-176`. Note that `test/fixtures/*.ts`
  and `test/setup/*.ts` do **not** match that glob, so the new fixtures ran under full production
  rules and passed.
- **The HEIC fixture is a text payload with an `image/heic` MIME type**, not real HEIC bytes. Correct
  for the current MIME-based `isValidPhoto`, and consistent with the plan's "no magic-byte sniffing"
  guardrail — but it would need replacing if MIME hardening ever lands, alongside the padded-JPEG
  helper that already carries that warning.
- **`httpBaseUrl: string` is non-optional for all suites**, so `inject("httpBaseUrl")` type-checks in
  the integration suite and returns `undefined` at runtime, surfacing as an opaque `TypeError` in
  `new URL(path, undefined)`. A runtime guard mirroring `getRunNamespace()` (`test/fixtures/user.ts:56-58`)
  would close it.

## Post-triage verification (2026-08-02)

All gates re-run after the fixes, against the live local Supabase stack:

| Command | Result |
| --- | --- |
| `pnpm lint` | exit 0 |
| `pnpm check` | 0 errors, 0 warnings |
| `pnpm test` | 102 passed |
| `pnpm test:integration` | 35 passed in 1.56s (no server-boot tax) |
| `pnpm test:http` | 5 passed in 22.50s |
| `pgrep astro.mjs dev` / `pgrep workerd` | none after the run |

9 findings fixed, 1 accepted (F8). No behaviour under test changed — every edit is to the
harness lifecycle, cleanup ordering, or comments.
