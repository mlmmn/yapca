import type { APIRoute } from "astro";
import { z } from "astro/zod";
import { createClient } from "@/lib/supabase";

export const prerender = false;

const resendSchema = z.object({
  email: z.email("Email must be a valid email address"),
});

export const POST: APIRoute = async (context) => {
  const form = await context.request.formData();
  const email = form.get("email") as string;
  const validation = resendSchema.safeParse({ email });

  if (!validation.success) {
    const error = validation.error.issues[0]?.message || "Invalid input";
    const redirectUrl = new URL("/auth/confirm-email", context.url);

    redirectUrl.searchParams.set("email", email);
    redirectUrl.searchParams.set("error", error);

    return context.redirect(redirectUrl.toString());
  }

  const supabase = createClient(context.request.headers, context.cookies);

  if (!supabase) {
    const redirectUrl = new URL("/auth/confirm-email", context.url);

    redirectUrl.searchParams.set("email", email);
    redirectUrl.searchParams.set("error", "Supabase is not configured");

    return context.redirect(redirectUrl.toString());
  }

  const { error } = await supabase.auth.resend({ type: "signup", email });
  const redirectUrl = new URL("/auth/confirm-email", context.url);

  redirectUrl.searchParams.set("email", email);

  if (error) {
    redirectUrl.searchParams.set("error", error.message);
  } else {
    redirectUrl.searchParams.set("resent", "1");
  }

  return context.redirect(redirectUrl.toString());
};
