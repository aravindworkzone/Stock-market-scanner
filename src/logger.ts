import { config } from "./config.js";
import type { AppErrorCode } from "./errors.js";

type LogLevel = "debug" | "info" | "warn" | "error";

const levels: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function writeLog(
  level: LogLevel,
  message: string,
  code?: AppErrorCode
): void {

  if (levels[level] < levels[config.LOG_LEVEL]) {
    return;
  }

  console.error(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      ...(code && { code }),
      message,
    }),
  );
}

export const logger = {
  debug: (message: string) => writeLog("debug", message),
  info: (message: string) => writeLog("info", message),
  warn: (message: string) => writeLog("warn", message),
  error: (message: string, code: AppErrorCode = 'INTERNAL_ERROR') =>
    writeLog("error", message, code),
};