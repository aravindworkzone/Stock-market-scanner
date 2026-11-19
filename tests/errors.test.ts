import { describe, expect, it } from "vitest";
import { AppError, isNetworkError, toAppError } from "../src/core/errors.js";

function codedError(message: string, errorCode: string): Error {
  return Object.assign(new Error(message), { code: errorCode });
}

describe("toAppError", () => {
  it("returns AppErrors unchanged", () => {
    const original = new AppError("NO_DATA", "nothing");
    expect(toAppError(original)).toBe(original);
  });

  it("maps plain TypeErrors (programming bugs) to INTERNAL_ERROR", () => {
    expect(toAppError(new TypeError("Cannot read properties of undefined")).code).toBe("INTERNAL_ERROR");
  });

  it.each(["ECONNRESET", "ENOTFOUND", "ETIMEDOUT", "ECONNREFUSED", "EAI_AGAIN", "UND_ERR_SOCKET", "UND_ERR_CONNECT_TIMEOUT"])(
    "maps %s to NETWORK_ERROR",
    (errorCode) => {
      expect(toAppError(codedError("socket failure", errorCode)).code).toBe("NETWORK_ERROR");
    },
  );

  it("maps AbortError and TimeoutError to NETWORK_ERROR", () => {
    expect(toAppError(new DOMException("aborted", "AbortError")).code).toBe("NETWORK_ERROR");
    expect(toAppError(new DOMException("timed out", "TimeoutError")).code).toBe("NETWORK_ERROR");
  });

  it("maps fetch's TypeError('fetch failed') with a network cause to NETWORK_ERROR", () => {
    const fetchError = new TypeError("fetch failed", { cause: codedError("getaddrinfo ENOTFOUND host", "ENOTFOUND") });
    expect(isNetworkError(fetchError)).toBe(true);
    expect(toAppError(fetchError).code).toBe("NETWORK_ERROR");
  });

  it("maps numeric HTTP statuses: 401 auth, 403/429 rate limit, 5xx broker", () => {
    expect(toAppError({ status: 401 }).code).toBe("AUTHENTICATION_ERROR");
    expect(toAppError({ status: 403 }).code).toBe("RATE_LIMIT_ERROR");
    expect(toAppError({ statusCode: 429 }).code).toBe("RATE_LIMIT_ERROR");
    expect(toAppError({ status: 503 }).code).toBe("BROKER_API_ERROR");
  });

  it("does not coerce Postgres string SQLSTATE codes into HTTP statuses", () => {
    expect(toAppError(codedError("duplicate key", "23505")).code).toBe("INTERNAL_ERROR");
    expect(toAppError(codedError("serialization failure", "40001")).code).toBe("INTERNAL_ERROR");
    expect(toAppError({ code: "403" }).code).toBe("INTERNAL_ERROR");
  });

  it("wraps unknown values as INTERNAL_ERROR", () => {
    expect(toAppError("boom").code).toBe("INTERNAL_ERROR");
    expect(toAppError(new Error("boom")).message).toBe("boom");
  });
});
