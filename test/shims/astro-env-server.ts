// Mirrors astro.config.mjs's `env.schema` exactly. Keep it a mirror, never a superset:
// an export the real `astro:env/server` lacks would let a test pass here and fail the
// real Astro build. Harness-only configuration (e.g. the direct postgres URL) belongs in
// the fixture that needs it, read from `process.env` there.
export const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
export const SUPABASE_KEY = process.env.SUPABASE_KEY ?? "";
