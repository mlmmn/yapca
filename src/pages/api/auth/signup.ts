import type { APIRoute } from "astro";
import { z } from "astro/zod";
import { createClient } from "@/lib/supabase";

export const prerender = false;

const signUpSchema = z.object({
  email: z.email("Email must be a valid email address"),
  password: z.string().min(1, "Password is required"),
});

export const POST: APIRoute = async (context) => {
  const form = await context.request.formData();
  const email = form.get("email") as string;
  const password = form.get("password") as string;
  const validation = signUpSchema.safeParse({ email, password });

  if (!validation.success) {
    const error = validation.error.issues[0]?.message || "Invalid input";

    return context.redirect(`/auth/signup?error=${encodeURIComponent(error)}`);
  }

  const supabase = createClient(context.request.headers, context.cookies);

  if (!supabase) {
    return context.redirect(`/auth/signup?error=${encodeURIComponent("Supabase is not configured")}`);
  }

  const { error } = await supabase.auth.signUp({ email, password });

  if (error) {
    return context.redirect(`/auth/signup?error=${encodeURIComponent(error.message)}`);
  }

  const redirectUrl = new URL("/auth/confirm-email", context.url);

  redirectUrl.searchParams.set("email", email);

  return context.redirect(redirectUrl.toString());
};
