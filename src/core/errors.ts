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

export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }

  if (error instanceof TypeError) {
    return new AppError(
      "NETWORK_ERROR",
      error.message || "A network request failed.",
      error,
    );
  }

  if (typeof error === "object" && error !== null) {
    const err = error as Record<string, unknown>;

    const status = Number(
      err.statusCode ?? err.status ?? err.code
    );

    if (status === 401 || status === 403) {
      return new AppError(
        "AUTHENTICATION_ERROR",
        `Angel One rejected the request. HTTP status: ${status}`,
        error,
      );
    }

    if (status === 429) {
      return new AppError(
        "RATE_LIMIT_ERROR",
        "Angel One API rate limit exceeded.",
        error,
      );
    }

    if (status >= 500 && status <= 599) {
      return new AppError(
        "BROKER_API_ERROR",
        `Angel One server error. HTTP status: ${status}`,
        error,
      );
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
