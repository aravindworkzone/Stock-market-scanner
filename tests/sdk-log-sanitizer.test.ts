import { describe, expect, it } from "vitest";
import {
  REDACTED_PLACEHOLDER,
  buildSafeSdkLogRecord,
  collectSecretValues,
  redactSensitiveFields,
  scrubSecretText,
} from "../src/angelone/sdk-log-sanitizer.js";

const FAKE_API_KEY = "fakeApiKey_9f8e7d";
const FAKE_JWT = "eyJhbGciOiJIUzUxMiJ9.eyJzdWIiOiJURVNUIn0.c2lnbmF0dXJlX2Zha2U";
const FAKE_CLIENT_CODE = "Z9999999";
const FAKE_PIN = "4321";
const FAKE_TOTP = "123456";
const FAKE_MAC = "aa:bb:cc:dd:ee:ff";
const FAKE_LOCAL_IP = "10.20.30.40";

/** Shape the SDK passes for an HTTP 200 + status:false login failure (axios response). */
function buildLoginFailureLogInfo() {
  return {
    message: "Error on response data",
    clientId: FAKE_CLIENT_CODE,
    response: {
      status: 200,
      statusText: "OK",
      config: {
        method: "post",
        url: "/rest/auth/angelbroking/user/v1/loginByPassword",
        headers: {
          Authorization: `Bearer ${FAKE_JWT}`,
          "X-PrivateKey": FAKE_API_KEY,
          "X-ClientLocalIP": FAKE_LOCAL_IP,
          "X-MACAddress": FAKE_MAC,
        },
        data: JSON.stringify({ clientcode: FAKE_CLIENT_CODE, password: FAKE_PIN, totp: FAKE_TOTP }),
      },
      data: { status: false, message: "Invalid totp", errorcode: "AB1050", data: null },
    },
  };
}

/** Shape the SDK passes for HTTP 403 (axios error carrying a response). */
function buildRateLimitLogInfo() {
  return {
    message: "Error Response in if block",
    clientId: FAKE_CLIENT_CODE,
    response: {
      status: 403,
      statusText: "Forbidden",
      config: {
        method: "post",
        url: "/rest/secure/angelbroking/historical/v1/getCandleData?debug=1",
        headers: { Authorization: `Bearer ${FAKE_JWT}`, "X-PrivateKey": FAKE_API_KEY },
        data: "{}",
      },
      data: "Access denied because of exceeding access rate",
    },
  };
}

describe("buildSafeSdkLogRecord", () => {
  it("keeps diagnostics but never request headers, request bodies or clientId", () => {
    const safeRecord = buildSafeSdkLogRecord(buildLoginFailureLogInfo());
    const serializedRecord = JSON.stringify(safeRecord);

    expect(safeRecord).toMatchObject({
      source: "smartapi-javascript",
      sdkMessage: "Error on response data",
      method: "POST",
      urlPath: "/rest/auth/angelbroking/user/v1/loginByPassword",
      httpStatus: 200,
      brokerErrorCode: "AB1050",
      brokerMessage: "Invalid totp",
    });
    for (const secretValue of [FAKE_API_KEY, FAKE_JWT, FAKE_CLIENT_CODE, FAKE_PIN, FAKE_TOTP, FAKE_MAC, FAKE_LOCAL_IP]) {
      expect(serializedRecord).not.toContain(secretValue);
    }
    // Key-shaped checks: the URL path legitimately contains "loginByPassword".
    expect(serializedRecord).not.toMatch(/"headers"|"clientId"|"password"|"totp"|X-PrivateKey/i);
  });

  it("records a 403 rate-limit body text and strips the query string", () => {
    const safeRecord = buildSafeSdkLogRecord(buildRateLimitLogInfo());
    expect(safeRecord.httpStatus).toBe(403);
    expect(safeRecord.urlPath).toBe("/rest/secure/angelbroking/historical/v1/getCandleData");
    expect(safeRecord.brokerMessage).toBe("Access denied because of exceeding access rate");
    expect(JSON.stringify(safeRecord)).not.toContain(FAKE_API_KEY);
  });

  it("records network errors (no HTTP response) by code and message", () => {
    const networkError = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:9"), {
      code: "ECONNREFUSED",
      config: { method: "get", url: "/rest/secure/angelbroking/user/v1/getRMS", headers: { "X-PrivateKey": FAKE_API_KEY } },
    });
    const safeRecord = buildSafeSdkLogRecord({ message: "Error Response in else if block", response: networkError });
    expect(safeRecord).toMatchObject({
      method: "GET",
      urlPath: "/rest/secure/angelbroking/user/v1/getRMS",
      networkErrorCode: "ECONNREFUSED",
    });
    expect(safeRecord.httpStatus).toBeUndefined();
    expect(JSON.stringify(safeRecord)).not.toContain(FAKE_API_KEY);
  });

  it("scrubs known secret values and JWTs that appear inside broker text", () => {
    const logInfo = buildRateLimitLogInfo();
    logInfo.response.data = `denied for key ${FAKE_API_KEY} token ${FAKE_JWT}`;
    const safeRecord = buildSafeSdkLogRecord(logInfo, [FAKE_API_KEY]);
    expect(safeRecord.brokerMessage).toBe(`denied for key ${REDACTED_PLACEHOLDER} token ${REDACTED_PLACEHOLDER}`);
  });

  it("tolerates junk input without throwing", () => {
    for (const junkInput of [undefined, null, 42, "text", [], {}, { response: [] }, { response: "x" }]) {
      expect(() => buildSafeSdkLogRecord(junkInput)).not.toThrow();
    }
  });
});

describe("redactSensitiveFields", () => {
  it("redacts exact key names case-insensitively", () => {
    const redactedValue = redactSensitiveFields({
      JwtToken: FAKE_JWT,
      REFRESHTOKEN: "refresh",
      feedToken: "feed",
      macAddress: FAKE_MAC,
      clientLocalIP: FAKE_LOCAL_IP,
      ClientPublicIP: "1.2.3.4",
      nested: [{ password: FAKE_PIN, Totp: FAKE_TOTP, clientcode: FAKE_CLIENT_CODE }],
    });
    expect(redactedValue).toEqual({
      JwtToken: REDACTED_PLACEHOLDER,
      REFRESHTOKEN: REDACTED_PLACEHOLDER,
      feedToken: REDACTED_PLACEHOLDER,
      macAddress: REDACTED_PLACEHOLDER,
      clientLocalIP: REDACTED_PLACEHOLDER,
      ClientPublicIP: REDACTED_PLACEHOLDER,
      nested: [{ password: REDACTED_PLACEHOLDER, Totp: REDACTED_PLACEHOLDER, clientcode: REDACTED_PLACEHOLDER }],
    });
  });

  it("does not redact keys that merely contain a sensitive substring", () => {
    const tradingFields = {
      macd: 1.5,
      macdSignal: 1.2,
      ipo: "yes",
      description: "x",
      pinned: true,
      tokenCount: 3,
      shipDate: "2026-11-19",
    };
    expect(redactSensitiveFields(tradingFields)).toEqual(tradingFields);
  });
});

describe("scrubSecretText / collectSecretValues", () => {
  it("replaces Bearer tokens and bare JWTs", () => {
    expect(scrubSecretText(`Authorization: Bearer ${FAKE_JWT}`)).toBe(`Authorization: Bearer ${REDACTED_PLACEHOLDER}`);
    expect(scrubSecretText(`t=${FAKE_JWT}`)).toBe(`t=${REDACTED_PLACEHOLDER}`);
  });

  it("collects only configured secret env values of length >= 4", () => {
    const secretValues = collectSecretValues({
      ANGELONE_API_KEY: FAKE_API_KEY,
      ANGELONE_PIN: "12",
      ANGELONE_CLIENT_CODE: FAKE_CLIENT_CODE,
      UNRELATED_VARIABLE: "ignored-value",
    });
    expect(secretValues).toEqual([FAKE_API_KEY, FAKE_CLIENT_CODE]);
  });
});
