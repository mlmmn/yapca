declare module "virtual:yapca-test/astro-actions-server" {
  export { defineAction, getActionContext } from "astro/dist/actions/runtime/server";
}

declare module "virtual:yapca-test/astro-actions-client" {
  export { ActionError, isActionError, isInputError } from "astro/dist/actions/runtime/client";
}
