import path from "node:path";
import { fileURLToPath } from "node:url";

const requiredVariableNames = ["SUPABASE_URL", "SUPABASE_KEY", "SUPABASE_DB_URL"] as const;
const localDatabaseHostnames = ["127.0.0.1", "localhost", "::1"];
const localDatabasePort = "54322";
const nonLocalEscapeHatch = "YAPCA_ALLOW_NONLOCAL_INTEGRATION_DB";
const thisDirectory = path.dirname(fileURLToPath(import.meta.url));
const envFilePath = path.resolve(thisDirectory, "..", "..", ".env");

type IntegrationEnv = {
  SUPABASE_URL: string;
  SUPABASE_KEY: string;
  SUPABASE_DB_URL: string;
};

let cachedEnv: IntegrationEnv | null = null;

// The fixture harness deletes rows from `auth.users`, and `plants`/`watering_events` cascade from
// it — so a `SUPABASE_DB_URL` pointing anywhere but the local stack destroys real data. Presence
// checks alone cannot catch that; `package.json`'s `test:sql` hardcodes 127.0.0.1:54322 for the
// same reason. Fail before anything caches or connects.
function assertLocalDatabaseUrl(databaseUrl: string): void {
  let parsedUrl: URL;

  if (process.env[nonLocalEscapeHatch]) {
    return;
  }

  try {
    parsedUrl = new URL(databaseUrl);
  } catch {
    throw new Error(`SUPABASE_DB_URL is not a valid URL. Expected the local stack's connection string.`);
  }

  const hostname = parsedUrl.hostname.replace(/^\[|\]$/g, "");
  const local = localDatabaseHostnames.includes(hostname) && parsedUrl.port === localDatabasePort;

  if (!local) {
    throw new Error(
      [
        "Integration tests delete rows from auth.users and would destroy real data.",
        `SUPABASE_DB_URL must point at the local Supabase stack (127.0.0.1:${localDatabasePort}), but it points at ${hostname}:${parsedUrl.port || "(no port)"}.`,
        `Start it with \`pnpx supabase start\`. If your local stack genuinely runs elsewhere, set ${nonLocalEscapeHatch}=1.`,
      ].join(" "),
    );
  }
}

export function getIntegrationEnv(): IntegrationEnv {
  if (cachedEnv) {
    return cachedEnv;
  }

  try {
    process.loadEnvFile(envFilePath);
  } catch {
    // A missing or unreadable .env is not the error worth surfacing — Node throws a bare
    // ENOENT that says nothing about how to fix it. Fall through to the check below, which
    // names `pnpx supabase start`. Variables supplied directly by the environment (CI, or an
    // inline override) still satisfy it without any .env file present.
  }

  const missingVariableNames = requiredVariableNames.filter((variableName) => {
    return !process.env[variableName];
  });

  if (missingVariableNames.length > 0) {
    throw new Error(
      [
        "Integration tests require a local Supabase stack.",
        "Start it with `pnpx supabase start`, then copy SUPABASE_URL, SUPABASE_KEY, and SUPABASE_DB_URL into `.env`.",
        `Missing: ${missingVariableNames.join(", ")}`,
      ].join(" "),
    );
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_KEY;
  const supabaseDbUrl = process.env.SUPABASE_DB_URL;

  if (!supabaseUrl || !supabaseKey || !supabaseDbUrl) {
    throw new Error("Integration env validation failed after missing-variable checks.");
  }

  assertLocalDatabaseUrl(supabaseDbUrl);

  cachedEnv = {
    SUPABASE_URL: supabaseUrl,
    SUPABASE_KEY: supabaseKey,
    SUPABASE_DB_URL: supabaseDbUrl,
  };

  return cachedEnv;
}

getIntegrationEnv();
