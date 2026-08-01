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
  // Normalised to an array so a genuine leak prints the offending row, rather than reporting
  // "expected false to be true" at the one moment the row's contents matter most.
  const singleRows = value === null ? [] : [value];
  const visibleRows = Array.isArray(value) ? value : singleRows;

  expect(visibleRows).toEqual([]);
}

// Storage download/signing denies access with an error and null data. Do not use list here:
// a denied list returns [], which is indistinguishable from an empty folder.
export function expectStorageDenied(result: { data: unknown; error: unknown }): void {
  // `toBeTruthy` rather than `not.toBeNull`: the latter also passes for `undefined`, which is the
  // shape a helper that forgot to return the Storage result would produce.
  expect(result.error).toBeTruthy();
  expect(result.data).toBeNull();
}
