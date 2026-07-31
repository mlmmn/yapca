import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createServerClient } from "@supabase/ssr";
import { createClient as createSupabaseClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { expect, inject } from "vitest";
import type { AstroCookies } from "astro";
import type { Database } from "@/lib/database.types";
import { getIntegrationEnv } from "../setup/load-env";

type CookieOptions = { maxAge?: number };
type CookieJar = Map<string, { value: string; options?: CookieOptions }>;
type CookieEntry = { name: string; options?: CookieOptions; value: string };
type IntegrationSupabaseClient = SupabaseClient<Database>;

type UserSlot = {
  client: IntegrationSupabaseClient;
  cookieJar: CookieJar;
  email: string;
  slotNumber: number;
  user: User;
  userId: string;
};

export type IntegrationUserFixture = {
  client: IntegrationSupabaseClient;
  cookieJar: CookieJar;
  createUniqueName: (prefix: string) => string;
  email: string;
  user: User;
  userId: string;
};

const FIXTURE_USER_PASSWORD = "yapca-integration-password";
const TEST_EMAIL_PREFIX = "yapca-integration+";
const USER_SLOT_COUNT = 2;
const SUPABASE_STORAGE_BUCKET = "plant-photos";
const TEST_IDENTIFIER_MAX_LENGTH = 48;
const userSlotPromises: (Promise<UserSlot> | null)[] = Array.from({ length: USER_SLOT_COUNT }, () => null);
const slotsPendingReset = new Set<number>();
let testSequence = 0;
let uniqueNameCounter = 0;

// Registered as a `beforeEach` by `test/setup/reset-integration-slots.ts`. The reset itself
// stays lazy — a test that never touches a slot pays nothing — but the *decision* to reset
// is driven by the hook rather than inferred from the test's name. An earlier version
// compared `expect.getState().currentTestName`, which carries no file path: two files with
// the same `describe > test` pair silently skipped the reset and inherited each other's
// rows, and a retried test ran against its own failed attempt's leftovers.
export function markIntegrationSlotsDirty() {
  testSequence += 1;

  for (let slotNumber = 0; slotNumber < USER_SLOT_COUNT; slotNumber += 1) {
    slotsPendingReset.add(slotNumber);
  }
}

function getRunNamespace() {
  const runNamespace = inject("integrationRunNamespace");

  if (!runNamespace) {
    throw new Error("Missing integrationRunNamespace. The integration global setup did not run.");
  }

  return runNamespace;
}

function getWorkerId() {
  return process.env.VITEST_POOL_ID ?? process.env.VITEST_WORKER_ID ?? "0";
}

function getDbUrl() {
  return getIntegrationEnv().SUPABASE_DB_URL;
}

function getSupabaseUrl() {
  return getIntegrationEnv().SUPABASE_URL;
}

function getSupabaseKey() {
  return getIntegrationEnv().SUPABASE_KEY;
}

function getCurrentTestName() {
  const currentTestName = expect.getState().currentTestName;

  if (!currentTestName) {
    throw new Error("Integration fixtures must be used from inside a running test.");
  }

  return currentTestName;
}

function createCookieJar() {
  return new Map<string, { value: string; options?: CookieOptions }>();
}

function getCookieHeader(cookieJar: CookieJar) {
  return Array.from(cookieJar.entries())
    .map(([name, { value }]) => {
      return `${name}=${value}`;
    })
    .join("; ");
}

function setCookieEntry(cookieJar: CookieJar, cookie: CookieEntry) {
  const maxAge = cookie.options?.maxAge;

  if (maxAge !== undefined && maxAge <= 0) {
    cookieJar.delete(cookie.name);

    return;
  }

  cookieJar.set(cookie.name, { value: cookie.value, options: cookie.options });
}

function cloneCookieJar(cookieJar: CookieJar) {
  const snapshot = createCookieJar();

  cookieJar.forEach((entry, name) => {
    snapshot.set(name, { value: entry.value, options: entry.options });
  });

  return snapshot;
}

function createFixtureClient(cookieJar: CookieJar) {
  return createServerClient<Database>(getSupabaseUrl(), getSupabaseKey(), {
    cookies: {
      getAll() {
        return Array.from(cookieJar.entries()).map(([name, entry]) => ({
          name,
          value: entry.value,
        }));
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach((cookie) => {
          setCookieEntry(cookieJar, {
            name: cookie.name,
            options: { maxAge: cookie.options.maxAge },
            value: cookie.value,
          });
        });
      },
    },
  });
}

function createCleanupClient() {
  return createSupabaseClient<Database>(getSupabaseUrl(), getSupabaseKey(), {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

function runPsql(sql: string) {
  execFileSync("psql", [getDbUrl(), "-v", "ON_ERROR_STOP=1", "-c", sql], { stdio: "pipe" });
}

function queryPsql(sql: string) {
  return execFileSync("psql", [getDbUrl(), "-t", "-A", "-F", "\t", "-c", sql], {
    encoding: "utf8",
    stdio: "pipe",
  }).trim();
}

function createFixtureEmail(slotNumber: number) {
  return `${TEST_EMAIL_PREFIX}${getRunNamespace()}+w${getWorkerId()}+s${slotNumber}@yapca.local`;
}

function sanitizeIdentifier(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, TEST_IDENTIFIER_MAX_LENGTH);
}

// Vitest isolates the module graph per *test file*, so this module's slot memo is file-local,
// not worker-local: every fixture-using file on a worker re-runs `createConfirmedUser` with
// the same worker+slot email. A random id there collided on `auth.users`' unique email index
// (`on conflict (id)` cannot catch that), so the second file on a worker failed outright.
// Deriving the id from the email makes the insert genuinely idempotent and lets the second
// file adopt the first file's row.
function createFixtureUserId(email: string) {
  const hash = createHash("sha1").update(email).digest("hex");

  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    `5${hash.slice(13, 16)}`,
    `8${hash.slice(17, 20)}`,
    hash.slice(20, 32),
  ].join("-");
}

function createConfirmedUser(email: string) {
  const userId = createFixtureUserId(email);
  const sql = `
    do $$
    declare
      v_user_id constant uuid := '${userId}';
      v_email constant text := '${email}';
    begin
      insert into auth.users (
        instance_id,
        id,
        aud,
        role,
        email,
        encrypted_password,
        email_confirmed_at,
        confirmation_token,
        email_change,
        email_change_token_new,
        recovery_token,
        raw_app_meta_data,
        raw_user_meta_data,
        created_at,
        updated_at
      )
      values (
        '00000000-0000-0000-0000-000000000000',
        v_user_id,
        'authenticated',
        'authenticated',
        v_email,
        crypt('${FIXTURE_USER_PASSWORD}', gen_salt('bf')),
        now(),
        '',
        '',
        '',
        '',
        '{"provider":"email","providers":["email"]}',
        '{}',
        now(),
        now()
      )
      on conflict (id) do nothing;

      insert into auth.identities (
        provider_id,
        user_id,
        identity_data,
        provider,
        created_at,
        updated_at
      )
      values (
        v_user_id::text,
        v_user_id,
        jsonb_build_object('sub', v_user_id::text, 'email', v_email),
        'email',
        now(),
        now()
      )
      on conflict (provider_id, provider) do nothing;
    end
    $$;
  `;

  runPsql(sql);

  return userId;
}

async function signInFixtureUser(email: string, cookieJar: CookieJar) {
  const client = createFixtureClient(cookieJar);
  const { data, error } = await client.auth.signInWithPassword({
    email,
    password: FIXTURE_USER_PASSWORD,
  });

  if (error) {
    throw new Error(`Failed to sign in integration fixture user ${email}: ${error.message}`);
  }

  return { client, user: data.user };
}

async function listStoragePaths(client: IntegrationSupabaseClient, userId: string) {
  const objectPaths: string[] = [];
  let offset = 0;
  let moreAvailable = true;

  while (moreAvailable) {
    const { data, error } = await client.storage.from(SUPABASE_STORAGE_BUCKET).list(userId, {
      limit: 1000,
      offset,
      sortBy: { column: "name", order: "asc" },
    });

    if (error) {
      throw new Error(`Failed to list storage objects for ${userId}: ${error.message}`);
    }

    data.forEach((entry) => {
      if (entry.id) {
        objectPaths.push(`${userId}/${entry.name}`);
      }
    });

    moreAvailable = data.length === 1000;
    offset += data.length;
  }

  return objectPaths;
}

// `supabase/config.toml:189` allows 30 sign-ins per 5 minutes per IP. Every helper that
// mints its own session spends one of those, per call, on top of the pooled slot sign-in
// the plan budgeted for — so the storage helpers take an already-authenticated client.
// The `…ForUser` wrappers below sign in and exist only for stale-run cleanup in
// `test/setup/global-setup.ts`, where no slot is initialized yet.
export async function removeAllStorageObjects(client: IntegrationSupabaseClient, userId: string) {
  const objectPaths = await listStoragePaths(client, userId);

  if (objectPaths.length === 0) {
    return;
  }

  const { error: removeError } = await client.storage.from(SUPABASE_STORAGE_BUCKET).remove(objectPaths);

  if (removeError) {
    throw new Error(`Failed to remove storage objects for ${userId}: ${removeError.message}`);
  }
}

export async function assertNoStorageObjects(client: IntegrationSupabaseClient, userId: string) {
  const objectPaths = await listStoragePaths(client, userId);

  if (objectPaths.length > 0) {
    throw new Error(`Expected no storage objects for ${userId}, found ${objectPaths.join(", ")}`);
  }
}

async function createAuthenticatedCleanupClient(email: string) {
  const client = createCleanupClient();
  const { error: signInError } = await client.auth.signInWithPassword({
    email,
    password: FIXTURE_USER_PASSWORD,
  });

  if (signInError) {
    throw new Error(`Failed to sign in cleanup client for ${email}: ${signInError.message}`);
  }

  return client;
}

// Returns what it removed rather than asserting emptiness afterwards. Deleting and then
// asserting the delete worked is close to tautological; reporting the residue lets the caller
// clean up unconditionally and *then* fail on what the suite left behind — which is the
// property "no Storage objects remain after the suite" is actually about.
export async function clearStorageObjectsForUser(email: string, userId: string) {
  const client = await createAuthenticatedCleanupClient(email);
  const objectPaths = await listStoragePaths(client, userId);

  await removeAllStorageObjects(client, userId);

  return objectPaths;
}

export function listFixtureUsers(emailPattern: string) {
  const output = queryPsql(`
    select id::text, email
    from auth.users
    where email like '${emailPattern}'
    order by email asc;
  `);

  if (!output) {
    return [];
  }

  return output.split("\n").map((line) => {
    const [id, email] = line.split("\t");

    return { email, id };
  });
}

export function deleteFixtureUsers(emailPattern: string) {
  runPsql(`delete from auth.users where email like '${emailPattern}';`);
}

async function ensureUserSlot(slotNumber: number) {
  const existingPromise = userSlotPromises[slotNumber];

  // The pool size is load-bearing, not a default: `supabase/config.toml:189` caps sign-ins
  // at 30 per 5 minutes per IP, and the plan's budget assumes at most USER_SLOT_COUNT
  // sign-ins per worker. Growing the pool silently would spend that budget unnoticed.
  if (!Number.isInteger(slotNumber) || slotNumber < 0 || slotNumber >= USER_SLOT_COUNT) {
    throw new Error(`Integration user slot ${slotNumber} is outside the pool of ${USER_SLOT_COUNT}.`);
  }

  if (existingPromise) {
    return existingPromise;
  }

  const slotPromise = (async () => {
    const email = createFixtureEmail(slotNumber);
    const cookieJar = createCookieJar();

    createConfirmedUser(email);

    const { client, user } = await signInFixtureUser(email, cookieJar);

    return {
      client,
      cookieJar,
      email,
      slotNumber,
      user,
      userId: user.id,
    };
  })();

  userSlotPromises[slotNumber] = slotPromise;

  return slotPromise;
}

async function resetUserSlot(slot: UserSlot) {
  await removeAllStorageObjects(slot.client, slot.userId);

  const { error } = await slot.client.from("plants").delete().eq("user_id", slot.userId);

  if (error) {
    throw new Error(`Failed to reset integration fixture plants for ${slot.email}: ${error.message}`);
  }
}

export async function getIntegrationUserFixture(slotNumber = 0): Promise<IntegrationUserFixture> {
  const testName = getCurrentTestName();

  // Without the hook every test after the first would silently reuse the previous test's
  // rows, and the suite would still be green. Fail loudly instead of quietly sharing state.
  if (testSequence === 0) {
    throw new Error(
      "Integration slot reset hook never ran. Is test/setup/reset-integration-slots.ts in the integration project's setupFiles?",
    );
  }

  const slot = await ensureUserSlot(slotNumber);

  if (slotsPendingReset.has(slotNumber)) {
    await resetUserSlot(slot);
    slotsPendingReset.delete(slotNumber);
  }

  return {
    client: slot.client,
    cookieJar: slot.cookieJar,
    createUniqueName(prefix: string) {
      uniqueNameCounter += 1;

      // The counter is monotonic per worker rather than per test: uniqueness must not
      // depend on test names being distinct. The test name is here for traceability only.
      return `${sanitizeIdentifier(prefix)}-${sanitizeIdentifier(testName)}-${uniqueNameCounter}`;
    },
    email: slot.email,
    user: slot.user,
    userId: slot.userId,
  };
}

export function createActionRequestHeaders(cookieJar: CookieJar) {
  const headers = new Headers();
  const cookieHeader = getCookieHeader(cookieJar);

  if (cookieHeader) {
    headers.set("Cookie", cookieHeader);
  }

  return headers;
}

export function createActionCookies(parentCookieJar: CookieJar) {
  const requestCookieJar = cloneCookieJar(parentCookieJar);
  const cookies = {
    delete(name: string) {
      requestCookieJar.delete(name);
      parentCookieJar.delete(name);
    },
    get(name: string) {
      const cookie = requestCookieJar.get(name);

      if (!cookie) {
        return undefined;
      }

      return { json: () => cookie.value, name, value: cookie.value };
    },
    has(name: string) {
      return requestCookieJar.has(name);
    },
    set(name: string, value: string, options?: CookieOptions) {
      const cookie = { name, options, value };

      setCookieEntry(requestCookieJar, cookie);
      setCookieEntry(parentCookieJar, cookie);
    },
  };

  return {
    cookies: cookies as unknown as AstroCookies,
    requestCookieJar,
  };
}

export const integrationFixtureConfig = {
  FIXTURE_USER_PASSWORD,
  TEST_EMAIL_PREFIX,
};
