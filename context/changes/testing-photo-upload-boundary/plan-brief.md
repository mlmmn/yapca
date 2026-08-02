# Photo Upload Boundary — Plan Brief

> Full plan: `context/changes/testing-photo-upload-boundary/plan.md`
> Research: `context/changes/testing-photo-upload-boundary/research.md`

## What & Why

Close §3 Phase 4 of the test plan (Risk #7): a photo taken on a phone must either persist and be
retrievable afterwards, or fail visibly — never silently succeed without the file. The test plan
is explicit that this can only be asserted **at the real HTTP boundary**, because the failure it
protects against (a 12 MB phone photo hitting the Worker's request body ceiling) is unreachable
from an in-process Action call.

## Starting Point

Every existing integration test calls Actions in-process with a synthetic context, reaching real
Supabase, RLS and Storage — but skipping multipart encoding, the `/_actions` route, middleware and
`security.actionBodySizeLimit`. On top of that, **no test invokes `addPlant` at all**, so the
primary upload path has zero coverage. The fixture harness is close to ready: it already produces
authenticated cookie headers and owner-scoped Storage assertions. What is missing is a server
lifecycle and a real binary image fixture — the current one is a text string labelled `image/png`.

## Desired End State

`pnpm test:http` boots a local Astro dev server on workerd, POSTs real multipart requests to
`/_actions/addPlant` as an authenticated fixture user, and asserts the atomic user outcome for
four payload shapes. Test-plan §6.5 documents the pattern, §3 Phase 4 reads `complete`, and a
tickable release checklist lives at `context/foundation/manual-device-smoke.md`.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Server runtime | `astro dev` (not build + preview) | The Cloudflare adapter adds `cfVitePlugin` unconditionally, so `astro dev` already runs the SSR environment inside workerd — preview buys bundle fidelity, not runtime fidelity. | Plan |
| Suite home | Separate `vitest.http.config.ts` + `pnpm test:http` | Keeps the server boot cost out of `pnpm test:integration`, the command developers run most. | Plan |
| Success fixture size | Both exactly 4 MiB and just below | The exact case pins that `isValidPhoto`'s `<=` and the bucket's `file_size_limit` agree on inclusivity; the just-below case is the stable regression signal. | Plan |
| Fixture production | Committed seed JPEG, padded at runtime | Real JPEG magic bytes and EXIF without adding megabytes to every clone. | Plan |
| HEIC rejection | Automated HTTP case | iPhones default to HEIC, making it the likeliest real rejection path; a small payload makes it cheap. | Plan |
| `updatePlant` HTTP coverage | Out of scope | Keep/replace/remove already have in-process coverage; the one real gap (replacement-conflict rollback) has nothing to do with multipart. | Plan |
| Manual smoke home | `context/foundation/` + cookbook §6.5 | A per-release gate must not live in a change folder that gets archived. | Plan |
| Browser layer | Deferred | Test-plan §7 excludes the UI while the design is unsettled; revisit when roadmap slice S-09 lands. | Research |

## Scope

**In scope:**

- A workerd-backed HTTP test substrate (config, script, server lifecycle, provided base URL)
- Real binary JPEG and HEIC fixtures with deterministic size targeting
- Four `addPlant` cases: exactly 4 MiB, just below 4 MiB, ~12 MiB oversized, under-limit HEIC
- Test-plan §6.5 cookbook, §3/§4/§8 updates, and a manual device smoke checklist

**Out of scope:**

- Browser/E2E coverage — the accepted gap stays accepted
- `updatePlant` over HTTP, and the replacement-conflict rollback case (follow-up, in-process)
- Build-plus-preview orchestration; magic-byte sniffing; PNG/WebP repetition
- CI wiring — CI has no Supabase stack today, so that belongs to §3 Phase 5

## Architecture / Approach

```
test (node)  --multipart fetch + cookie-->  astro dev (workerd)
                                                  |
                                            /_actions/addPlant
                                                  |
                                            Supabase Storage + plants row
     <--- owner re-read + authenticated download ---
```

`globalSetup` composes the existing integration setup (run namespace, stale sweep, residual-object
teardown) with a dev-server child process, handing the base URL to workers via `project.provide` —
the same channel already used for the run namespace. The HTTP response is treated as *transport*
evidence only; the outcome is proven by re-reading the row as its owner and downloading the object.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. HTTP harness + fixtures | Config, script, server lifecycle, real image fixtures, one smoke test | Server lifecycle flakiness — port collisions, readiness races, orphaned processes |
| 2. Risk #7 case matrix | The four `addPlant` cases with row + object assertions | A green suite that stays green when the limit moves; the deliberate-break checks are the real acceptance test |
| 3. Cookbook, gate, smoke | §6.5 pattern, status updates, manual device checklist | Overstating coverage — HTTP proves the server contract, not the user-visible message |

**Prerequisites:** Local Supabase stack running (`pnpx supabase start`, requires Docker) with
`SUPABASE_URL`, `SUPABASE_KEY` and `SUPABASE_DB_URL` in `.env`. Phases 2 and 3 depend on Phase 1.

**Estimated effort:** ~2 sessions across 3 phases; Phase 1 carries most of the work.

## Open Risks & Assumptions

- **Server lifecycle is the main flake risk.** Vite + workerd cold-start is variable, so readiness
  must be probed rather than slept on, and teardown must stop the server before the delegated
  cleanup that can throw.
- **The exactly-4-MiB case could go red on a vendor inclusivity difference.** If it does, triage it
  as a limit-inclusivity finding — do not shrink the fixture, which would silently delete the
  assertion.
- **`pnpm test:http` will be the slowest suite in the repo** (~20 MiB of payload plus cold start).
  That is why it is opt-in; resist adding cases a cheaper layer can carry.
- **The known accepted gap stands.** If the React island drops the file before the request is
  formed, nothing here sees it. That is what the manual checklist covers, and it is a checklist,
  not a gate that can fail a build.

## Success Criteria (Summary)

- A near-4 MiB supported photo submitted over real HTTP lands in Storage and downloads back
  byte-identical, with the plant row pointing at it
- A phone-sized oversized payload and an under-limit HEIC each fail loudly, leaving neither a row
  nor an object
- Lowering `actionBodySizeLimit` back to Astro's old 1 MiB default turns the suite red — the
  regression that motivated this phase is genuinely gated
