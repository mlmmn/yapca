function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

export function isUndoBlockedConflict(error: unknown): boolean {
  return hasErrorCode(error, "CONFLICT");
}

export function isUndoScheduleMismatch(error: unknown): boolean {
  return hasErrorCode(error, "PRECONDITION_FAILED");
}
