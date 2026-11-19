export type AppErrorCode = "CONFIGURATION_ERROR" | "VALIDATION_ERROR" | "AUTHENTICATION_ERROR" | "RATE_LIMIT_ERROR" | "NETWORK_ERROR" | "BROKER_API_ERROR" | "INTERNAL_ERROR" | "DATABASE_ERROR" | "NO_DATA";

export class AppError extends Error {
  constructor(
    public readonly code: AppErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

/** Node / undici error codes that mean the network failed (not a programming bug). */
export const NETWORK_ERROR_CODES: ReadonlySet<string> = new Set([
  "ECONNRESET",
  "ENOTFOUND",
  "ETIMEDOUT",
  "ECONNREFUSED",
  "EAI_AGAIN",
]);

const NETWORK_ERROR_NAMES: ReadonlySet<string> = new Set(["AbortError", "TimeoutError"]);
const MAX_CAUSE_DEPTH = 4;

/** True for abort/timeout errors and socket/DNS failures, including ones wrapped in `cause` (e.g. fetch's "fetch failed"). */
export function isNetworkError(error: unknown): boolean {
  let currentError: unknown = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth++) {
    if (typeof currentError !== "object" || currentError === null) {
      return false;
    }
    const errorRecord = currentError as Record<string, unknown>;
    if (typeof errorRecord.name === "string" && NETWORK_ERROR_NAMES.has(errorRecord.name)) {
      return true;
    }
    if (
      typeof errorRecord.code === "string" &&
      (NETWORK_ERROR_CODES.has(errorRecord.code) || errorRecord.code.startsWith("UND_ERR_"))
    ) {
      return true;
    }
    currentError = errorRecord.cause;
  }
  return false;
}

function readNumericHttpStatus(errorRecord: Record<string, unknown>): number | undefined {
  // Only numeric fields are HTTP statuses. String `code` values (Postgres SQLSTATE such
  // as "23505", Node "ECONNRESET") are never coerced into statuses.
  for (const candidate of [errorRecord.statusCode, errorRecord.status]) {
    if (typeof candidate === "number" && Number.isInteger(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }

  if (isNetworkError(error)) {
    return new AppError(
      "NETWORK_ERROR",
      error instanceof Error && error.message ? error.message : "A network request failed.",
      error,
    );
  }

  if (error instanceof TypeError) {
    return new AppError("INTERNAL_ERROR", error.message || "An unexpected internal error occurred.", error);
  }

  if (typeof error === "object" && error !== null) {
    const httpStatus = readNumericHttpStatus(error as Record<string, unknown>);

    if (httpStatus === 401) {
      return new AppError("AUTHENTICATION_ERROR", `Angel One rejected the request. HTTP status: ${httpStatus}`, error);
    }

    if (httpStatus === 403 || httpStatus === 429) {
      return new AppError("RATE_LIMIT_ERROR", `Angel One API rate limit exceeded. HTTP status: ${httpStatus}`, error);
    }

    if (httpStatus !== undefined && httpStatus >= 500 && httpStatus <= 599) {
      return new AppError("BROKER_API_ERROR", `Angel One server error. HTTP status: ${httpStatus}`, error);
    }
  }

  return new AppError(
    "INTERNAL_ERROR",
    error instanceof Error
      ? error.message
      : "An unexpected internal error occurred.",
    error,
  );
}
