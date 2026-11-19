import { describe, expect, it } from "vitest";
import type { SmartAPI } from "smartapi-javascript";
import {
  createBrokerCaller as createRealBrokerCaller,
  type BrokerCallerDependencies,
  type CallRateLimiter,
  type SessionProvider,
} from "../src/angelone/getAngelone.js";
import { AppError } from "../src/core/errors.js";
import { loadAuditFixture } from "./helpers/audit-fixtures.js";
import { FakeSmartApiClient } from "./helpers/fake-smartapi.js";

class RecordingRateLimiter implements CallRateLimiter {
  acquisitions: string[] = [];
  penalties: number[] = [];
  async acquire(operationName: string): Promise<void> {
    this.acquisitions.push(operationName);
  }
  penalize(_operationName: string, delayMilliseconds: number): void {
    this.penalties.push(delayMilliseconds);
  }
}

const TEST_BACKOFF = { maxRetries: 3, initialDelayMilliseconds: 1000, multiplier: 2, maxDelayMilliseconds: 30_000 };

function createBrokerCaller(
  dependencies: Pick<BrokerCallerDependencies, "sessions" | "writeWarning"> & { rateLimiter?: CallRateLimiter },
) {
  return createRealBrokerCaller({
    rateLimiter: dependencies.rateLimiter ?? new RecordingRateLimiter(),
    backoff: TEST_BACKOFF,
    ...dependencies,
  });
}

function buildSessions(): SessionProvider & { recoveries: number; clients: SmartAPI[] } {
  const clients = [new FakeSmartApiClient("first").asSmartApi()];
  const sessions = {
    recoveries: 0,
    clients,
    getClient: async () => clients[clients.length - 1],
    recoverFromAuthenticationFailure: async () => {
      sessions.recoveries++;
      clients.push(new FakeSmartApiClient(`relogin-${sessions.recoveries}`).asSmartApi());
      return clients[clients.length - 1];
    },
  };
  return sessions;
}

describe("call()", () => {
  it("returns the success envelope unchanged", async () => {
    const sessions = buildSessions();
    const brokerCall = createBrokerCaller({ sessions, writeWarning: () => undefined });
    const profileFixture = loadAuditFixture("getRMS");
    await expect(brokerCall("getRMS", async () => profileFixture)).resolves.toBe(profileFixture);
  });

  it("re-logs in once on AUTHENTICATION_ERROR and retries with the new client", async () => {
    const sessions = buildSessions();
    const brokerCall = createBrokerCaller({ sessions, writeWarning: () => undefined });
    const usedClients: SmartAPI[] = [];
    const result = await brokerCall("getHolding", async (client) => {
      usedClients.push(client);
      return usedClients.length === 1
        ? { status: false, message: "Invalid Token", errorcode: "AG8001", data: null }
        : { status: true, message: "SUCCESS", errorcode: "", data: [] };
    });
    expect(result.status).toBe(true);
    expect(sessions.recoveries).toBe(1);
    expect(usedClients[1]).toBe(sessions.clients[1]);
  });

  it("gives up after one re-login", async () => {
    const sessions = buildSessions();
    const brokerCall = createBrokerCaller({ sessions, writeWarning: () => undefined });
    await expect(brokerCall("getPosition", async () => ({ status: 401, message: "Unauthorized" }))).rejects.toMatchObject({
      code: "AUTHENTICATION_ERROR",
      message: "[AUTHENTICATION_ERROR] getPosition: Angel One session is invalid or expired (HTTP 401, Unauthorized)",
    });
    expect(sessions.recoveries).toBe(1);
  });

  it("throws [CODE] errors for the SDK's resolved failure shapes", async () => {
    const brokerCall = createBrokerCaller({ sessions: buildSessions(), writeWarning: () => undefined });
    await expect(brokerCall("getRMS", async () => ({}))).rejects.toMatchObject({ code: "NETWORK_ERROR" });
    await expect(brokerCall("getRMS", async () => [])).rejects.toMatchObject({ code: "BROKER_API_ERROR" });
    await expect(brokerCall("getCandleData", async () => loadAuditFixture("getCandleData"))).rejects.toMatchObject({
      code: "RATE_LIMIT_ERROR",
    });
  });

  it("takes a rate-limit token before every attempt", async () => {
    const rateLimiter = new RecordingRateLimiter();
    const brokerCall = createBrokerCaller({ sessions: buildSessions(), rateLimiter, writeWarning: () => undefined });
    await brokerCall("getRMS", async () => loadAuditFixture("getRMS"));
    expect(rateLimiter.acquisitions).toEqual(["getRMS"]);
  });

  it("backs off exponentially on RATE_LIMIT_ERROR, then succeeds", async () => {
    const rateLimiter = new RecordingRateLimiter();
    const brokerCall = createBrokerCaller({ sessions: buildSessions(), rateLimiter, writeWarning: () => undefined });
    let attempts = 0;
    const result = await brokerCall("getCandleData", async () => {
      attempts++;
      return attempts <= 2 ? { status: 403, message: "" } : { status: true, message: "SUCCESS", errorcode: "", data: [] };
    });
    expect(result.status).toBe(true);
    expect(rateLimiter.penalties).toEqual([1000, 2000]);
    expect(rateLimiter.acquisitions).toHaveLength(3);
  });

  it("stops after maxRetries rate-limit retries and throws RATE_LIMIT_ERROR", async () => {
    const rateLimiter = new RecordingRateLimiter();
    const brokerCall = createBrokerCaller({ sessions: buildSessions(), rateLimiter, writeWarning: () => undefined });
    await expect(brokerCall("getCandleData", async () => ({ status: 403, message: "" }))).rejects.toMatchObject({
      code: "RATE_LIMIT_ERROR",
    });
    expect(rateLimiter.penalties).toEqual([1000, 2000, 4000]);
    expect(rateLimiter.acquisitions).toHaveLength(4);
  });

  it("converts thrown errors with toAppError", async () => {
    const brokerCall = createBrokerCaller({ sessions: buildSessions(), writeWarning: () => undefined });
    const thrownError = await brokerCall("getRMS", async () => {
      throw Object.assign(new Error("socket hang up"), { code: "ECONNRESET" });
    }).catch((error: unknown) => error);
    expect(thrownError).toBeInstanceOf(AppError);
    expect((thrownError as AppError).code).toBe("NETWORK_ERROR");
  });

  it("reports unrecognized broker codes through the injected warning writer", async () => {
    const warnings: string[] = [];
    const brokerCall = createBrokerCaller({ sessions: buildSessions(), writeWarning: (message) => warnings.push(message) });
    await brokerCall("getRMS", async () => ({ status: false, errorcode: "QQ0001", message: "odd" })).catch(() => undefined);
    expect(warnings).toEqual(["[broker] Unrecognized errorcode QQ0001 from getRMS: odd"]);
  });
});
