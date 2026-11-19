/**
 * Pure classification of whatever smartapi-javascript resolves with.
 *
 * The SDK never rejects (audit/REPORT.md B0):
 *   - HTTP 200 + status:true          -> success envelope
 *   - HTTP 200 + status:false         -> { status:false, message, errorcode, data:null }
 *   - HTTP non-2xx                    -> { status:<httpCode>, message:<statusText> } (body dropped)
 *   - network error / timeout         -> {}
 *   - exception inside the interceptor -> []
 */
import type { SmartApiEnvelope } from "smartapi-javascript";
import { AppError, type AppErrorCode } from "../core/errors.js";
import { collectSecretValues, scrubSecretText } from "./sdk-log-sanitizer.js";

/**
 * Broker error codes that mean "session is invalid". Extend this set when a new
 * code is confirmed. AG8001 is the code the SDK itself treats as session expiry
 * (smartapi-connect.js:93). Matched against both `errorcode` and `errorCode`.
 */
export const AUTHENTICATION_ERROR_CODES: Set<string> = new Set(["AG8001"]);

/**
 * Broker error codes already understood, so they are not reported as unrecognized.
 * AB4033 ("Order type is required") was observed live from marginApi (audit fixtures).
 */
export const RECOGNIZED_BROKER_ERROR_CODES: Set<string> = new Set(["AB4033"]);

/** HTTP statuses Angel One uses for throttling. 403 carries "Access denied because of exceeding access rate". */
export const RATE_LIMIT_HTTP_STATUSES: ReadonlySet<number> = new Set([403, 429]);

/** Broker message texts that mean throttling (observed in error.log and live samples). */
export const RATE_LIMIT_MESSAGE_PATTERNS: readonly RegExp[] = [/too many requests/i, /exceeding access rate/i];

export type BrokerFailureCode = Extract<
  AppErrorCode,
  "NETWORK_ERROR" | "BROKER_API_ERROR" | "RATE_LIMIT_ERROR" | "AUTHENTICATION_ERROR"
>;

export interface BrokerSuccess<TData> {
  outcome: "success";
  envelope: SmartApiEnvelope<TData>;
}

export interface BrokerFailure {
  outcome: "failure";
  errorCode: BrokerFailureCode;
  description: string;
  httpStatus?: number;
  brokerErrorCode?: string;
  brokerMessage?: string;
}

export type BrokerResponseClassification<TData> = BrokerSuccess<TData> | BrokerFailure;

function readBrokerErrorCode(responseRecord: Record<string, unknown>): string | undefined {
  for (const candidate of [responseRecord.errorcode, responseRecord.errorCode]) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }
  return undefined;
}

export function classifyBrokerResponse<TData = unknown>(brokerResponse: unknown): BrokerResponseClassification<TData> {
  if (Array.isArray(brokerResponse)) {
    return {
      outcome: "failure",
      errorCode: "BROKER_API_ERROR",
      description: "SDK returned an array instead of a response (internal SDK error)",
    };
  }

  if (typeof brokerResponse !== "object" || brokerResponse === null) {
    return {
      outcome: "failure",
      errorCode: "BROKER_API_ERROR",
      description: "SDK returned no response object",
    };
  }

  const responseRecord = brokerResponse as Record<string, unknown>;

  if (Object.keys(responseRecord).length === 0) {
    return {
      outcome: "failure",
      errorCode: "NETWORK_ERROR",
      description: "no response from Angel One (network error or timeout)",
    };
  }

  if (responseRecord.status === true) {
    return { outcome: "success", envelope: responseRecord as unknown as SmartApiEnvelope<TData> };
  }

  const httpStatus = typeof responseRecord.status === "number" ? responseRecord.status : undefined;
  const brokerErrorCode = readBrokerErrorCode(responseRecord);
  const brokerMessage =
    typeof responseRecord.message === "string" && responseRecord.message.length > 0 ? responseRecord.message : undefined;
  const failureDetails = { httpStatus, brokerErrorCode, brokerMessage };

  const isRateLimited =
    (httpStatus !== undefined && RATE_LIMIT_HTTP_STATUSES.has(httpStatus)) ||
    (brokerMessage !== undefined && RATE_LIMIT_MESSAGE_PATTERNS.some((pattern) => pattern.test(brokerMessage)));
  if (isRateLimited) {
    return { outcome: "failure", errorCode: "RATE_LIMIT_ERROR", description: "Angel One rate limit exceeded", ...failureDetails };
  }

  const isAuthenticationFailure =
    httpStatus === 401 || (brokerErrorCode !== undefined && AUTHENTICATION_ERROR_CODES.has(brokerErrorCode));
  if (isAuthenticationFailure) {
    return { outcome: "failure", errorCode: "AUTHENTICATION_ERROR", description: "Angel One session is invalid or expired", ...failureDetails };
  }

  return { outcome: "failure", errorCode: "BROKER_API_ERROR", description: "Angel One request failed", ...failureDetails };
}

/** Builds the AppError for a failed broker call. Messages always start with `[CODE]`. */
export function brokerFailureToAppError(operationName: string, failure: BrokerFailure): AppError {
  const detailParts: string[] = [];
  if (failure.httpStatus !== undefined) {
    detailParts.push(`HTTP ${failure.httpStatus}`);
  }
  if (failure.brokerErrorCode !== undefined) {
    detailParts.push(`broker code ${failure.brokerErrorCode}`);
  }
  if (failure.brokerMessage !== undefined) {
    detailParts.push(scrubSecretText(failure.brokerMessage, collectSecretValues()));
  }
  const detailText = detailParts.length > 0 ? ` (${detailParts.join(", ")})` : "";
  return new AppError(failure.errorCode, `[${failure.errorCode}] ${operationName}: ${failure.description}${detailText}`, failure);
}

const reportedBrokerErrorCodes = new Set<string>();

export function isRecognizedBrokerErrorCode(brokerErrorCode: string): boolean {
  return AUTHENTICATION_ERROR_CODES.has(brokerErrorCode) || RECOGNIZED_BROKER_ERROR_CODES.has(brokerErrorCode);
}

/**
 * Logs an unrecognized broker errorcode once per process (code + redacted message).
 * Returns true when a log line was written.
 */
export function reportUnrecognizedBrokerErrorCode(
  operationName: string,
  failure: BrokerFailure,
  writeWarning: (message: string) => void,
): boolean {
  const brokerErrorCode = failure.brokerErrorCode;
  if (brokerErrorCode === undefined || isRecognizedBrokerErrorCode(brokerErrorCode) || reportedBrokerErrorCodes.has(brokerErrorCode)) {
    return false;
  }
  reportedBrokerErrorCodes.add(brokerErrorCode);
  const redactedMessage = scrubSecretText(failure.brokerMessage ?? "", collectSecretValues());
  writeWarning(`[broker] Unrecognized errorcode ${brokerErrorCode} from ${operationName}: ${redactedMessage}`);
  return true;
}

/** Test hook: forget which unrecognized codes were already reported. */
export function resetReportedBrokerErrorCodes(): void {
  reportedBrokerErrorCodes.clear();
}
