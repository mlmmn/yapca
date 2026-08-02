// `test/setup/global-setup.ts` provides `integrationRunNamespace` (injected by
// `test/fixtures/user.ts`); `test/setup/http-global-setup.ts` provides `httpBaseUrl`
// (injected by `test/fixtures/http-actions.ts`, and only defined under the HTTP config).
// The augmentation lives in a declaration file rather than next to the `provide()` call
// because the consumer does not import the setup module, so an in-file augmentation would
// not be in its program and `inject()` would type as `never`.
declare module "vitest" {
  export interface ProvidedContext {
    httpBaseUrl: string;
    integrationRunNamespace: string;
  }
}

export {};
