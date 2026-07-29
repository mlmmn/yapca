// This shim points at Astro's internal runtime files on disk instead of the public
// `astro:actions` entrypoint because Astro 6.4.8's published entrypoint imports the
// unresolved virtual module `virtual:astro:actions/options`.
//
// `dist/actions/runtime/` is absent from Astro's `exports` map, so an upgrade that moves it
// breaks this harness in TWO places that must be revisited together:
//   1. the runtime aliases in `vitest.config.ts` (astroActionsServerPath / …ClientPath)
//   2. the type-only re-exports in `./astro-actions-runtime.d.ts`
// Only (1) fails loudly at test time; (2) surfaces as a `pnpm check` error instead.
export type ActionAPIContext = import("astro").APIContext;

export { defineAction, getActionContext } from "virtual:yapca-test/astro-actions-server";
export { ActionError, isActionError, isInputError } from "virtual:yapca-test/astro-actions-client";
