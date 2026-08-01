import { describe, expect, test } from "vitest";
import { isConflict, isPreconditionFailed } from "./errors";

describe("isConflict", () => {
  test("recognizes only a conflict error", () => {
    expect(isConflict({ code: "CONFLICT" })).toBe(true);
    expect(isConflict({ code: "PRECONDITION_FAILED" })).toBe(false);
    expect(isConflict({ code: "INTERNAL_SERVER_ERROR" })).toBe(false);
  });

  test.each([null, undefined, "CONFLICT", {}])("rejects a non-error value: %s", (error) => {
    expect(isConflict(error)).toBe(false);
  });
});

describe("isPreconditionFailed", () => {
  test("recognizes only a schedule mismatch error", () => {
    expect(isPreconditionFailed({ code: "PRECONDITION_FAILED" })).toBe(true);
    expect(isPreconditionFailed({ code: "CONFLICT" })).toBe(false);
    expect(isPreconditionFailed({ code: "INTERNAL_SERVER_ERROR" })).toBe(false);
  });

  test.each([null, undefined, "PRECONDITION_FAILED", {}])("rejects a non-error value: %s", (error) => {
    expect(isPreconditionFailed(error)).toBe(false);
  });
});
