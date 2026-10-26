export type AppErrorCode = "CONFIGURATION_ERROR" | "VALIDATION_ERROR" | "AUTHENTICATION_ERROR" | "RATE_LIMIT_ERROR" | "NETWORK_ERROR" | "BROKER_API_ERROR" | "INTERNAL_ERROR";

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
      "A network request failed.",
      error,
    );
  }

  return new AppError(
    "INTERNAL_ERROR",
    "An unexpected internal error occurred.",
    error,
  );
}