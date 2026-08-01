export function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

export function isConflict(error: unknown): boolean {
  return hasErrorCode(error, "CONFLICT");
}

export function isPreconditionFailed(error: unknown): boolean {
  return hasErrorCode(error, "PRECONDITION_FAILED");
}
