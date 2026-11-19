import { beforeEach, describe, expect, it } from "vitest";
import {
  AUTHENTICATION_ERROR_CODES,
  brokerFailureToAppError,
  classifyBrokerResponse,
  reportUnrecognizedBrokerErrorCode,
  resetReportedBrokerErrorCodes,
  type BrokerFailure,
} from "../src/angelone/broker-response.js";
import { listAuditFixtureNames, loadAuditFixture } from "./helpers/audit-fixtures.js";

function expectFailure(brokerResponse: unknown): BrokerFailure {
  const classification = classifyBrokerResponse(brokerResponse);
  if (classification.outcome !== "failure") {
    throw new Error("expected a failure classification");
  }
  return classification;
}

describe("classifyBrokerResponse with audit fixtures", () => {
  const successfulFixtureNames = listAuditFixtureNames().filter(
    (fixtureName) => !["getCandleData", "searchScrip"].includes(fixtureName),
  );

  it.each(successfulFixtureNames)("%s (live status:true) is a success", (fixtureName) => {
    const fixture = loadAuditFixture(fixtureName);
    const classification = classifyBrokerResponse(fixture);
    expect(classification.outcome).toBe("success");
    if (classification.outcome === "success") {
      expect(classification.envelope).toBe(fixture);
    }
  });

  it("getCandleData live {status:403,message:''} is a RATE_LIMIT_ERROR", () => {
    const failure = expectFailure(loadAuditFixture("getCandleData"));
    expect(failure).toMatchObject({ errorCode: "RATE_LIMIT_ERROR", httpStatus: 403 });
  });

  it("searchScrip bare array (SDK-unwrapped) is not a success envelope", () => {
    expect(expectFailure(loadAuditFixture("searchScrip")).errorCode).toBe("BROKER_API_ERROR");
  });

  it("success envelopes with data:null (empty order book / positions) are successes", () => {
    expect(classifyBrokerResponse(loadAuditFixture("getPosition")).outcome).toBe("success");
    expect(classifyBrokerResponse(loadAuditFixture("getOrderBook")).outcome).toBe("success");
  });
});

describe("classifyBrokerResponse simulated SDK outcomes", () => {
  it("{} (network error / timeout) is a NETWORK_ERROR", () => {
    expect(expectFailure({}).errorCode).toBe("NETWORK_ERROR");
  });

  it("[] (exception inside the SDK interceptor) is a BROKER_API_ERROR", () => {
    expect(expectFailure([]).errorCode).toBe("BROKER_API_ERROR");
  });

  it("null / undefined / primitives are BROKER_API_ERROR", () => {
    for (const invalidResponse of [null, undefined, "text", 0]) {
      expect(expectFailure(invalidResponse).errorCode).toBe("BROKER_API_ERROR");
    }
  });

  it("HTTP 403 and 429 are RATE_LIMIT_ERROR", () => {
    expect(expectFailure({ status: 403, message: "" }).errorCode).toBe("RATE_LIMIT_ERROR");
    expect(expectFailure({ status: 429, message: "Too Many Requests" }).errorCode).toBe("RATE_LIMIT_ERROR");
  });

  it("rate-limit texts inside status:false bodies are RATE_LIMIT_ERROR", () => {
    expect(expectFailure({ status: false, message: "Too many requests", errorcode: "AB9999", data: null }).errorCode).toBe(
      "RATE_LIMIT_ERROR",
    );
    expect(expectFailure({ status: false, message: "Access denied because of exceeding access rate" }).errorCode).toBe(
      "RATE_LIMIT_ERROR",
    );
  });

  it("HTTP 401 is AUTHENTICATION_ERROR", () => {
    expect(expectFailure({ status: 401, message: "Unauthorized" }).errorCode).toBe("AUTHENTICATION_ERROR");
  });

  it("AG8001 is AUTHENTICATION_ERROR in both errorcode and errorCode casings", () => {
    expect(expectFailure({ status: false, message: "Invalid Token", errorcode: "AG8001", data: null })).toMatchObject({
      errorCode: "AUTHENTICATION_ERROR",
      brokerErrorCode: "AG8001",
    });
    expect(expectFailure({ status: false, message: "Invalid Token", errorCode: "AG8001", data: null }).errorCode).toBe(
      "AUTHENTICATION_ERROR",
    );
  });

  it("the authentication code set is extendable", () => {
    AUTHENTICATION_ERROR_CODES.add("TEST0001");
    try {
      expect(expectFailure({ status: false, errorcode: "TEST0001" }).errorCode).toBe("AUTHENTICATION_ERROR");
    } finally {
      AUTHENTICATION_ERROR_CODES.delete("TEST0001");
    }
  });

  it("marginApi without orderType: HTTP 400 resolved object is a BROKER_API_ERROR with the status", () => {
    expect(expectFailure({ status: 400, message: "" })).toMatchObject({ errorCode: "BROKER_API_ERROR", httpStatus: 400 });
  });

  it("marginApi AB4033 status:false body is a BROKER_API_ERROR with the broker code", () => {
    const failure = expectFailure({ message: "Order type is required", errorcode: "AB4033", status: false, data: null });
    expect(failure).toMatchObject({ errorCode: "BROKER_API_ERROR", brokerErrorCode: "AB4033" });
  });

  it("5xx is a BROKER_API_ERROR", () => {
    expect(expectFailure({ status: 502, message: "Bad Gateway" })).toMatchObject({ errorCode: "BROKER_API_ERROR", httpStatus: 502 });
  });
});

describe("brokerFailureToAppError", () => {
  it("message starts with [CODE] and carries status, broker code and message", () => {
    const appError = brokerFailureToAppError(
      "marginApi",
      expectFailure({ message: "Order type is required", errorcode: "AB4033", status: false }),
    );
    expect(appError.code).toBe("BROKER_API_ERROR");
    expect(appError.message).toBe(
      "[BROKER_API_ERROR] marginApi: Angel One request failed (broker code AB4033, Order type is required)",
    );
  });

  it("rate limit message includes the HTTP status", () => {
    const appError = brokerFailureToAppError("getCandleData", expectFailure({ status: 403, message: "" }));
    expect(appError.message).toBe("[RATE_LIMIT_ERROR] getCandleData: Angel One rate limit exceeded (HTTP 403)");
  });
});

describe("reportUnrecognizedBrokerErrorCode", () => {
  beforeEach(() => resetReportedBrokerErrorCodes());

  it("logs an unrecognized code once, with a redacted message", () => {
    const warnings: string[] = [];
    const failure = expectFailure({
      status: false,
      errorcode: "ZZ1234",
      message: "odd failure token eyJhbGciOiJIUzUxMiJ9.eyJzdWIiOiJ4In0.c2ln",
    });
    expect(reportUnrecognizedBrokerErrorCode("getRMS", failure, (message) => warnings.push(message))).toBe(true);
    expect(reportUnrecognizedBrokerErrorCode("getRMS", failure, (message) => warnings.push(message))).toBe(false);
    expect(warnings).toEqual(["[broker] Unrecognized errorcode ZZ1234 from getRMS: odd failure token [REDACTED]"]);
  });

  it("does not log recognized codes", () => {
    const warnings: string[] = [];
    reportUnrecognizedBrokerErrorCode("marginApi", expectFailure({ status: false, errorcode: "AB4033" }), (message) =>
      warnings.push(message),
    );
    reportUnrecognizedBrokerErrorCode("getProfile", expectFailure({ status: false, errorcode: "AG8001" }), (message) =>
      warnings.push(message),
    );
    expect(warnings).toEqual([]);
  });
});
