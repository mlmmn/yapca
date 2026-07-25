declare namespace App {
  interface Locals {
    user: import("@supabase/supabase-js").User | null;
    timeZone: string | null;
    today: string | null;
  }
}
