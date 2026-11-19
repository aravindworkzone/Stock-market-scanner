/**
 * Replaces smartapi-javascript's winston error logger BEFORE the SDK loads.
 *
 * The stock logger (node_modules/smartapi-javascript/lib/winston_log.js) writes
 * `./error.log` in the process cwd with full request headers (Bearer JWT,
 * X-PrivateKey API key, MAC/IP) and request bodies (client code, PIN, TOTP).
 *
 * Import this module before anything that imports "smartapi-javascript".
 * It seeds Node's require cache with a safe logger, so the SDK's
 * `require('./winston_log')` never builds the winston file transport and
 * `./error.log` is never created. If the SDK was somehow loaded first, the
 * existing winston logger is closed and redirected instead.
 *
 * Output: one redacted JSON line per SDK error in
 * `<project root>/logs/smartapi-errors.log` (override with SMARTAPI_LOG_DIR,
 * absolute or relative to the project root), rotated at 5 MB, 3 files kept.
 */
import fs from "node:fs";
import path from "node:path";
import Module from "node:module";
import { buildSafeSdkLogRecord, collectSecretValues } from "./sdk-log-sanitizer.js";

const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_LOG_DIRECTORY = path.join(PROJECT_ROOT, "logs");
const LOG_FILE_NAME = "smartapi-errors.log";
const MAX_LOG_FILE_BYTES = 5 * 1024 * 1024;
const MAX_ROTATED_FILES = 3;
const SDK_LOGGER_MODULE_ID = "smartapi-javascript/lib/winston_log.js";

export type SdkLoggerInstallState = "replaced-before-load" | "patched-after-load" | "sdk-logger-not-found";

export function resolveSdkLogFilePath(environment: NodeJS.ProcessEnv = process.env): string {
  const configuredDirectory = environment.SMARTAPI_LOG_DIR?.trim();
  const logDirectory = configuredDirectory
    ? path.resolve(PROJECT_ROOT, configuredDirectory)
    : DEFAULT_LOG_DIRECTORY;
  return path.join(logDirectory, LOG_FILE_NAME);
}

function rotateLogFileIfNeeded(logFilePath: string): void {
  let currentSize: number;
  try {
    currentSize = fs.statSync(logFilePath).size;
  } catch {
    return;
  }
  if (currentSize < MAX_LOG_FILE_BYTES) {
    return;
  }
  for (let rotationIndex = MAX_ROTATED_FILES - 1; rotationIndex >= 1; rotationIndex--) {
    const olderFilePath = `${logFilePath}.${rotationIndex}`;
    if (fs.existsSync(olderFilePath)) {
      fs.renameSync(olderFilePath, `${logFilePath}.${rotationIndex + 1}`);
    }
  }
  fs.renameSync(logFilePath, `${logFilePath}.1`);
}

function writeSafeSdkLog(sdkLogInfo: unknown): void {
  // Must never throw: an exception here would make the SDK interceptor resolve `[]`.
  try {
    const safeRecord = buildSafeSdkLogRecord(sdkLogInfo, collectSecretValues());
    const logFilePath = resolveSdkLogFilePath();
    fs.mkdirSync(path.dirname(logFilePath), { recursive: true });
    rotateLogFileIfNeeded(logFilePath);
    fs.appendFileSync(logFilePath, `${JSON.stringify(safeRecord)}\n`, "utf8");
  } catch {
    // Logging is best-effort; never surface logging failures to the broker call.
  }
}

/** Drop-in replacement for the SDK's `errorLogger` (the SDK only calls `.error`). */
export const safeSdkErrorLogger = {
  error: (sdkLogInfo: unknown): void => writeSafeSdkLog(sdkLogInfo),
};

interface WinstonLikeLogger {
  clear?: () => unknown;
  error: (sdkLogInfo: unknown) => unknown;
}

function installSafeSdkLogger(): SdkLoggerInstallState {
  let sdkLoggerModulePath: string;
  try {
    sdkLoggerModulePath = require.resolve(SDK_LOGGER_MODULE_ID);
  } catch {
    return "sdk-logger-not-found";
  }

  const cachedSdkLoggerModule = require.cache[sdkLoggerModulePath];
  if (cachedSdkLoggerModule === undefined) {
    const replacementModule = new Module(sdkLoggerModulePath);
    replacementModule.filename = sdkLoggerModulePath;
    replacementModule.loaded = true;
    replacementModule.exports = { errorLogger: safeSdkErrorLogger };
    require.cache[sdkLoggerModulePath] = replacementModule;
    return "replaced-before-load";
  }

  // Fallback: the SDK logger was already loaded (and winston may have created an
  // empty ./error.log). Close its transports and route its calls through ours.
  const existingSdkLogger = (cachedSdkLoggerModule.exports as { errorLogger?: WinstonLikeLogger })
    .errorLogger;
  if (existingSdkLogger !== undefined && existingSdkLogger !== safeSdkErrorLogger) {
    existingSdkLogger.clear?.();
    existingSdkLogger.error = safeSdkErrorLogger.error;
    console.error(
      "[sdk-logger] smartapi-javascript logger was loaded before sdk-logger; patched in place. Import sdk-logger earlier.",
    );
  }
  return "patched-after-load";
}

export const sdkLoggerInstallState: SdkLoggerInstallState = installSafeSdkLogger();
