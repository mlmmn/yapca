import path from "node:path";
import { fileURLToPath } from "node:url";

const requiredVariableNames = ["SUPABASE_URL", "SUPABASE_KEY", "SUPABASE_DB_URL"] as const;
const thisDirectory = path.dirname(fileURLToPath(import.meta.url));
const envFilePath = path.resolve(thisDirectory, "..", "..", ".env");

type IntegrationEnv = {
  SUPABASE_URL: string;
  SUPABASE_KEY: string;
  SUPABASE_DB_URL: string;
};

let cachedEnv: IntegrationEnv | null = null;

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

  cachedEnv = {
    SUPABASE_URL: supabaseUrl,
    SUPABASE_KEY: supabaseKey,
    SUPABASE_DB_URL: supabaseDbUrl,
  };

  return cachedEnv;
}

getIntegrationEnv();
