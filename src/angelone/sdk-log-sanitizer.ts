/**
 * Pure helpers that turn whatever smartapi-javascript hands to its error logger
 * (axios responses, axios errors, plain errors) into a small, whitelisted,
 * secret-free record.
 *
 * The SDK passes full axios objects that carry request headers (Bearer JWT,
 * X-PrivateKey API key, MAC / IP) and request bodies (client code, PIN, TOTP).
 * Nothing from request headers or request bodies is ever copied here.
 */

/**
 * Exact key names (compared case-insensitively) whose values are always replaced.
 * Matching is by whole key, never by substring, so keys such as "macd" or
 * "description" are left untouched.
 */
export const REDACTED_KEY_NAMES: ReadonlySet<string> = new Set(
  [
    "authorization",
    "cookie",
    "set-cookie",
    "x-privatekey",
    "privatekey",
    "api_key",
    "apikey",
    "x-clientlocalip",
    "x-clientpublicip",
    "x-macaddress",
    "clientlocalip",
    "clientpublicip",
    "macaddress",
    "local_ip",
    "public_ip",
    "mac_addr",
    "jwttoken",
    "refreshtoken",
    "feedtoken",
    "accesstoken",
    "access_token",
    "refresh_token",
    "password",
    "pin",
    "totp",
    "clientcode",
    "client_code",
    "clientid",
  ].map((keyName) => keyName.toLowerCase()),
);

export const REDACTED_PLACEHOLDER = "[REDACTED]";

const JWT_PATTERN = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g;
const BEARER_PATTERN = /Bearer\s+[A-Za-z0-9._-]+/gi;
const MAX_TEXT_LENGTH = 300;
const MAX_SERIALIZED_RESPONSE_LENGTH = 1000;
const MAX_REDACTION_DEPTH = 6;
const MINIMUM_SECRET_VALUE_LENGTH = 4;

/** Environment variables whose literal values are scrubbed from any logged string. */
export const SECRET_ENVIRONMENT_KEYS = [
  "ANGELONE_API_KEY",
  "ANGELONE_CLIENT_CODE",
  "ANGELONE_PIN",
  "ANGELONE_TOTP_SECRET",
  "MCP_AUTH_TOKEN",
  "DATABASE_URL",
  "DATABASE_URL_UNPOOLED",
] as const;

export interface SafeSdkLogRecord {
  timestamp: string;
  source: "smartapi-javascript";
  sdkMessage?: string;
  method?: string;
  urlPath?: string;
  httpStatus?: number;
  statusText?: string;
  brokerErrorCode?: string;
  brokerMessage?: string;
  brokerResponse?: unknown;
  networkErrorCode?: string;
  networkErrorMessage?: string;
}

type UnknownRecord = Record<string, unknown>;

function asRecord(candidate: unknown): UnknownRecord | undefined {
  return typeof candidate === "object" && candidate !== null && !Array.isArray(candidate)
    ? (candidate as UnknownRecord)
    : undefined;
}

function asNonEmptyString(candidate: unknown): string | undefined {
  return typeof candidate === "string" && candidate.length > 0 ? candidate : undefined;
}

function truncateText(text: string, maximumLength: number = MAX_TEXT_LENGTH): string {
  return text.length > maximumLength ? `${text.slice(0, maximumLength)}…[truncated]` : text;
}

export function collectSecretValues(
  environment: NodeJS.ProcessEnv = process.env,
): string[] {
  const secretValues: string[] = [];
  for (const environmentKey of SECRET_ENVIRONMENT_KEYS) {
    const secretValue = environment[environmentKey]?.trim();
    if (secretValue && secretValue.length >= MINIMUM_SECRET_VALUE_LENGTH) {
      secretValues.push(secretValue);
    }
  }
  // Longest first so a value that contains another value is replaced whole.
  return secretValues.sort((first, second) => second.length - first.length);
}

/** Removes JWTs, Bearer tokens and any known secret values from free text. */
export function scrubSecretText(text: string, secretValues: readonly string[] = []): string {
  let scrubbedText = text.replace(BEARER_PATTERN, `Bearer ${REDACTED_PLACEHOLDER}`);
  scrubbedText = scrubbedText.replace(JWT_PATTERN, REDACTED_PLACEHOLDER);
  for (const secretValue of secretValues) {
    scrubbedText = scrubbedText.split(secretValue).join(REDACTED_PLACEHOLDER);
  }
  return scrubbedText;
}

/**
 * Deep copy of `value` with every key in REDACTED_KEY_NAMES replaced and every
 * string scrubbed. Exported so the broker wrapper can reuse it when logging
 * unrecognised broker error codes.
 */
export function redactSensitiveFields(
  value: unknown,
  secretValues: readonly string[] = [],
  currentDepth = 0,
): unknown {
  if (typeof value === "string") {
    return scrubSecretText(value, secretValues);
  }
  if (typeof value !== "object" || value === null) {
    return value;
  }
  if (currentDepth >= MAX_REDACTION_DEPTH) {
    return "[TRUNCATED: too deep]";
  }
  if (Array.isArray(value)) {
    return value.map((arrayItem) => redactSensitiveFields(arrayItem, secretValues, currentDepth + 1));
  }

  const redactedRecord: UnknownRecord = {};
  for (const [keyName, keyValue] of Object.entries(value as UnknownRecord)) {
    redactedRecord[keyName] = REDACTED_KEY_NAMES.has(keyName.toLowerCase())
      ? REDACTED_PLACEHOLDER
      : redactSensitiveFields(keyValue, secretValues, currentDepth + 1);
  }
  return redactedRecord;
}

function extractUrlPath(rawUrl: unknown): string | undefined {
  const urlText = asNonEmptyString(rawUrl);
  if (urlText === undefined) {
    return undefined;
  }
  try {
    return new URL(urlText, "http://relative.invalid").pathname;
  } catch {
    return urlText.split("?")[0];
  }
}

function boundedBrokerResponse(responseBody: UnknownRecord, secretValues: readonly string[]): unknown {
  const redactedBody = redactSensitiveFields(responseBody, secretValues);
  const serializedBody = JSON.stringify(redactedBody);
  if (serializedBody === undefined || serializedBody.length <= MAX_SERIALIZED_RESPONSE_LENGTH) {
    return redactedBody;
  }
  return truncateText(serializedBody, MAX_SERIALIZED_RESPONSE_LENGTH);
}

/**
 * Builds the record written for one SDK error-log call.
 * `sdkLogInfo` is the object the SDK passes to `errorLogger.error(...)`:
 * `{ message, clientId, response }` where `response` is an axios response,
 * an axios error, or another thrown value. `clientId` is always dropped.
 */
export function buildSafeSdkLogRecord(
  sdkLogInfo: unknown,
  secretValues: readonly string[] = [],
  now: Date = new Date(),
): SafeSdkLogRecord {
  const safeRecord: SafeSdkLogRecord = {
    timestamp: now.toISOString(),
    source: "smartapi-javascript",
  };

  const infoRecord = asRecord(sdkLogInfo);
  const sdkMessage = asNonEmptyString(infoRecord?.message);
  if (sdkMessage !== undefined) {
    safeRecord.sdkMessage = truncateText(scrubSecretText(sdkMessage, secretValues));
  }

  const responseOrError = asRecord(infoRecord?.response);
  if (responseOrError === undefined) {
    return safeRecord;
  }

  const nestedResponse = asRecord(responseOrError.response);
  const httpResponse =
    nestedResponse ?? (typeof responseOrError.status === "number" ? responseOrError : undefined);
  const requestConfig = asRecord(httpResponse?.config) ?? asRecord(responseOrError.config);

  const requestMethod = asNonEmptyString(requestConfig?.method);
  if (requestMethod !== undefined) {
    safeRecord.method = requestMethod.toUpperCase();
  }
  const urlPath = extractUrlPath(requestConfig?.url);
  if (urlPath !== undefined) {
    safeRecord.urlPath = scrubSecretText(urlPath, secretValues);
  }

  if (httpResponse !== undefined) {
    if (typeof httpResponse.status === "number") {
      safeRecord.httpStatus = httpResponse.status;
    }
    const statusText = asNonEmptyString(httpResponse.statusText);
    if (statusText !== undefined) {
      safeRecord.statusText = truncateText(statusText);
    }

    const responseBody = httpResponse.data;
    const responseBodyRecord = asRecord(responseBody);
    if (typeof responseBody === "string" && responseBody.length > 0) {
      safeRecord.brokerMessage = truncateText(scrubSecretText(responseBody, secretValues));
    } else if (responseBodyRecord !== undefined) {
      const brokerErrorCode =
        asNonEmptyString(responseBodyRecord.errorcode) ?? asNonEmptyString(responseBodyRecord.errorCode);
      if (brokerErrorCode !== undefined) {
        safeRecord.brokerErrorCode = scrubSecretText(brokerErrorCode, secretValues);
      }
      const brokerMessage = asNonEmptyString(responseBodyRecord.message);
      if (brokerMessage !== undefined) {
        safeRecord.brokerMessage = truncateText(scrubSecretText(brokerMessage, secretValues));
      }
      safeRecord.brokerResponse = boundedBrokerResponse(responseBodyRecord, secretValues);
    }
    return safeRecord;
  }

  // No HTTP response: network error, timeout, or an exception inside the SDK.
  const networkErrorCode = asNonEmptyString(responseOrError.code);
  if (networkErrorCode !== undefined) {
    safeRecord.networkErrorCode = networkErrorCode;
  }
  const networkErrorMessage = asNonEmptyString(responseOrError.message);
  if (networkErrorMessage !== undefined) {
    safeRecord.networkErrorMessage = truncateText(scrubSecretText(networkErrorMessage, secretValues));
  }
  return safeRecord;
}
