export function mapAuthError(raw: string | null): string | null {
  if (!raw) return null;

  const lowerRaw = raw.toLowerCase();

  if (lowerRaw.includes("invalid login credentials")) {
    return "That email and password don't match.";
  }

  if (lowerRaw.includes("user already registered")) {
    return "An account with this email already exists.";
  }

  if (lowerRaw.includes("supabase is not configured")) {
    return "Sign-in is temporarily unavailable.";
  }

  return raw;
}
