import { ActionError } from "astro:actions";
import { expect } from "vitest";

// Action calls deliberately collapse foreign and nonexistent identifiers into NOT_FOUND. A
// PostgREST zero-row result or Storage error is a different boundary shape and must not pass here.
export async function expectActionNotFound(call: () => Promise<unknown>): Promise<void> {
  try {
    await call();
  } catch (error) {
    expect(error).toBeInstanceOf(ActionError);
    expect(error).toMatchObject({ code: "NOT_FOUND" });

    return;
  }

  throw new Error("Expected ActionError NOT_FOUND, but the Action resolved.");
}

// RLS read policies deny access by filtering rows, rather than rejecting the request like an
// Action or Storage policy. This accepts only the zero-row shapes from tryRead* helpers.
export function expectNoRowVisible(value: unknown): void {
  const absent = value === null || (Array.isArray(value) && value.length === 0);

  expect(absent).toBe(true);
}

// Storage download/signing denies access with an error and null data. Do not use list here:
// a denied list returns [], which is indistinguishable from an empty folder.
export function expectStorageDenied(result: { data: unknown; error: unknown }): void {
  expect(result.error).not.toBeNull();
  expect(result.data).toBeNull();
}
