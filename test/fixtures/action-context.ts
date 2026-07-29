import type { ActionAPIContext } from "astro:actions";
import type { IntegrationUserFixture } from "./user";
import { createActionCookies, createActionRequestHeaders } from "./user";

export function createActionContext(userFixture: IntegrationUserFixture): ActionAPIContext {
  const { cookies } = createActionCookies(userFixture.cookieJar);

  return {
    cookies,
    locals: { today: null, user: userFixture.user },
    request: new Request("http://localhost/__tests__/action", {
      headers: createActionRequestHeaders(userFixture.cookieJar),
      method: "POST",
    }),
  } as ActionAPIContext;
}

// `requireSession` only checks `locals.user`, so a context with a user but no session cookie
// passes the app guard and reaches the database with an anon-key client. That is the only way
// to observe whether the harness is genuinely unprivileged rather than merely guarded.
export function createSessionlessActionContext(userFixture: IntegrationUserFixture): ActionAPIContext {
  return {
    cookies: createActionCookies(new Map()).cookies,
    locals: { today: null, user: userFixture.user },
    request: new Request("http://localhost/__tests__/action", { method: "POST" }),
  } as ActionAPIContext;
}

export function createUnauthenticatedActionContext(): ActionAPIContext {
  return {
    cookies: createActionCookies(new Map()).cookies,
    locals: { today: null, user: null },
    request: new Request("http://localhost/__tests__/action", { method: "POST" }),
  } as ActionAPIContext;
}
