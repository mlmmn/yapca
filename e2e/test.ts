/* eslint-disable react-hooks/rules-of-hooks */
import { test as base } from "@playwright/test";

type Fixtures = {
  now: number;
};

export const test = base.extend<Fixtures>({
  // eslint-disable-next-line no-empty-pattern
  now: async ({}, use) => {
    await use(Date.now());
  },
});

export { expect } from "@playwright/test";
