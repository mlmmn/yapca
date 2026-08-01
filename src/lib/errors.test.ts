import { describe, expect, test } from "vitest";
import { isUndoBlockedConflict, isUndoScheduleMismatch } from "./errors";

describe("isUndoBlockedConflict", () => {
  test("recognizes only a conflict error", () => {
    expect(isUndoBlockedConflict({ code: "CONFLICT" })).toBe(true);
    expect(isUndoBlockedConflict({ code: "PRECONDITION_FAILED" })).toBe(false);
    expect(isUndoBlockedConflict({ code: "INTERNAL_SERVER_ERROR" })).toBe(false);
  });

  test.each([null, undefined, "CONFLICT", {}])("rejects a non-error value: %s", (error) => {
    expect(isUndoBlockedConflict(error)).toBe(false);
  });
});

describe("isUndoScheduleMismatch", () => {
  test("recognizes only a schedule mismatch error", () => {
    expect(isUndoScheduleMismatch({ code: "PRECONDITION_FAILED" })).toBe(true);
    expect(isUndoScheduleMismatch({ code: "CONFLICT" })).toBe(false);
    expect(isUndoScheduleMismatch({ code: "INTERNAL_SERVER_ERROR" })).toBe(false);
  });

  test.each([null, undefined, "PRECONDITION_FAILED", {}])("rejects a non-error value: %s", (error) => {
    expect(isUndoScheduleMismatch(error)).toBe(false);
  });
});
