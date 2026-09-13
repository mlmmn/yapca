/* eslint-disable react-hooks/rules-of-hooks */
import { test as base } from "@playwright/test";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "@/lib/database.types";
import { getIntegrationEnv } from "test/setup/load-env";

type PlantCleanup = {
  track: (name: string) => void;
};

type Fixtures = {
  now: number;
  plantCleanup: PlantCleanup;
};

export const test = base.extend<Fixtures>({
  // eslint-disable-next-line no-empty-pattern
  now: async ({}, use) => {
    await use(Date.now());
  },

  // Deletes every plant a test tracked, as the signed-in user, through the same session cookies
  // the browser holds — so RLS scopes the delete and watering events cascade with the plant.
  // `getIntegrationEnv()` refuses any database but the local stack before a delete can run.
  plantCleanup: async ({ context }, use) => {
    const names: string[] = [];

    await use({
      track: (name) => {
        names.push(name);
      },
    });

    if (names.length === 0) {
      return;
    }

    const { SUPABASE_URL, SUPABASE_KEY } = getIntegrationEnv();
    const cookies = await context.cookies();
    const supabase = createServerClient<Database>(SUPABASE_URL, SUPABASE_KEY, {
      cookies: {
        getAll: () => cookies.map(({ name, value }) => ({ name, value })),
        setAll: () => {
          // Cleanup is this session's last request, so a refreshed token is never needed.
        },
      },
    });
    const { error } = await supabase.from("plants").delete().in("name", names);

    if (error) {
      throw new Error(`Failed to clean up e2e plants ${names.join(", ")}: ${error.message}`);
    }
  },
});

export { expect } from "@playwright/test";
