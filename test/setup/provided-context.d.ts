// `test/setup/global-setup.ts` provides this value and `test/fixtures/user.ts` injects it.
// The augmentation lives in a declaration file rather than next to the `provide()` call
// because the consumer does not import the setup module, so an in-file augmentation would
// not be in its program and `inject()` would type as `never`.
declare module "vitest" {
  export interface ProvidedContext {
    integrationRunNamespace: string;
  }
}

export {};
