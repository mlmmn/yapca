import { defineMiddleware } from "astro:middleware";
import { createClient } from "@/lib/supabase";
import { getTodayInTimeZone, isSupportedTimeZone, TIME_ZONE_COOKIE } from "@/lib/timezone";

// Routes that require authentication. S-01 seeds real app routes here.
const PROTECTED_ROUTES: string[] = ["/plants"];

export const onRequest = defineMiddleware(async (context, next) => {
  const requestWithCf = context.request as Request & {
    cf?: { timezone?: unknown };
  };
  const cookieValue = context.cookies.get(TIME_ZONE_COOKIE)?.value;
  const cookieTimeZone = cookieValue && isSupportedTimeZone(cookieValue) ? cookieValue : null;
  const cfValue = requestWithCf.cf?.timezone;
  const cfTimeZone = typeof cfValue === "string" && isSupportedTimeZone(cfValue) ? cfValue : null;
  const timeZone = cookieTimeZone ?? cfTimeZone;

  context.locals.timeZone = timeZone;
  context.locals.today = timeZone ? getTodayInTimeZone(timeZone) : null;

  const supabase = createClient(context.request.headers, context.cookies);

  if (supabase) {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    context.locals.user = user ?? null;
  } else {
    context.locals.user = null;
  }

  if (PROTECTED_ROUTES.some((route) => context.url.pathname.startsWith(route))) {
    if (!context.locals.user) {
      return context.redirect("/auth/signin");
    }
  }

  if (context.locals.user && context.url.pathname.startsWith("/auth/")) {
    return context.redirect("/");
  }

  return next();
});
