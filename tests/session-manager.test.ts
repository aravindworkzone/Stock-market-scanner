import { describe, expect, it } from "vitest";
import type { AngelOneSession } from "../src/angelone/auth.js";
import {
  SessionManager,
  computeRefreshAfterMilliseconds,
  decodeJwtExpiryMilliseconds,
  nextIstMidnightMilliseconds,
} from "../src/angelone/session-manager.js";
import { buildFakeJwt, FakeSmartApiClient } from "./helpers/fake-smartapi.js";

const MINUTE = 60_000;
// 2026-11-19 11:10 IST
const LOGIN_TIME = Date.parse("2026-11-19T05:40:00Z");
// 2026-11-20 00:00 IST
const MIDNIGHT_IST = Date.parse("2026-11-19T18:30:00Z");

interface Harness {
  manager: SessionManager;
  createdClients: FakeSmartApiClient[];
  setNow: (milliseconds: number) => void;
  warnings: string[];
}

function buildHarness(options: { loginDelayMilliseconds?: number; expirySeconds?: number } = {}): Harness {
  let currentTime = LOGIN_TIME;
  const createdClients: FakeSmartApiClient[] = [];
  const warnings: string[] = [];
  const createSession = async (): Promise<AngelOneSession> => {
    if (options.loginDelayMilliseconds) {
      await new Promise((resolve) => setTimeout(resolve, options.loginDelayMilliseconds));
    }
    const client = new FakeSmartApiClient(`client-${createdClients.length + 1}`);
    createdClients.push(client);
    const expirySeconds = options.expirySeconds ?? MIDNIGHT_IST / 1000;
    return { client: client.asSmartApi(), tokens: { jwtToken: buildFakeJwt(expirySeconds), refreshToken: "refresh-1" } };
  };
  const manager = new SessionManager({
    createSession,
    now: () => currentTime,
    refreshMarginMilliseconds: 15 * MINUTE,
    writeInfo: () => undefined,
    writeWarning: (message) => warnings.push(message),
  });
  return { manager, createdClients, setNow: (milliseconds) => (currentTime = milliseconds), warnings };
}

describe("JWT expiry helpers", () => {
  it("decodes exp (seconds) into milliseconds", () => {
    expect(decodeJwtExpiryMilliseconds(buildFakeJwt(MIDNIGHT_IST / 1000))).toBe(MIDNIGHT_IST);
  });

  it("returns undefined for tokens without exp or malformed tokens", () => {
    expect(decodeJwtExpiryMilliseconds(buildFakeJwt(undefined))).toBeUndefined();
    expect(decodeJwtExpiryMilliseconds("not-a-jwt")).toBeUndefined();
    expect(decodeJwtExpiryMilliseconds("a.%%%.c")).toBeUndefined();
  });

  it("computes the next 00:00 IST", () => {
    expect(nextIstMidnightMilliseconds(LOGIN_TIME)).toBe(MIDNIGHT_IST);
    expect(nextIstMidnightMilliseconds(MIDNIGHT_IST)).toBe(MIDNIGHT_IST + 24 * 60 * MINUTE);
  });

  it("refreshes `margin` before expiry, or at expiry when that moment has passed", () => {
    expect(computeRefreshAfterMilliseconds(MIDNIGHT_IST, LOGIN_TIME, 15 * MINUTE)).toBe(MIDNIGHT_IST - 15 * MINUTE);
    expect(computeRefreshAfterMilliseconds(MIDNIGHT_IST, MIDNIGHT_IST - 5 * MINUTE, 15 * MINUTE)).toBe(MIDNIGHT_IST);
  });
});

describe("SessionManager", () => {
  it("memoizes the in-flight login: concurrent callers trigger one login", async () => {
    const harness = buildHarness({ loginDelayMilliseconds: 20 });
    const clients = await Promise.all(Array.from({ length: 10 }, () => harness.manager.getClient()));
    expect(harness.createdClients).toHaveLength(1);
    expect(new Set(clients).size).toBe(1);
  });

  it("reuses the session until the refresh window", async () => {
    const harness = buildHarness();
    const firstClient = await harness.manager.getClient();
    harness.setNow(MIDNIGHT_IST - 20 * MINUTE);
    expect(await harness.manager.getClient()).toBe(firstClient);
    expect(harness.createdClients).toHaveLength(1);
  });

  it("refreshes proactively with generateToken before 00:00 IST", async () => {
    const harness = buildHarness();
    const firstClient = await harness.manager.getClient();
    const fakeClient = harness.createdClients[0];
    const tomorrowMidnight = MIDNIGHT_IST + 24 * 60 * MINUTE;
    fakeClient.generateTokenResponses.push({
      status: true,
      message: "SUCCESS",
      errorcode: "",
      data: { jwtToken: buildFakeJwt(tomorrowMidnight / 1000, "refreshed"), refreshToken: "refresh-2" },
    });

    harness.setNow(MIDNIGHT_IST - 10 * MINUTE);
    const refreshedClient = await harness.manager.getClient();

    expect(refreshedClient).toBe(firstClient);
    expect(fakeClient.generateTokenCalls).toEqual(["refresh-1"]);
    expect(fakeClient.accessToken).toBe(buildFakeJwt(tomorrowMidnight / 1000, "refreshed"));
    expect(fakeClient.refreshToken).toBe("refresh-2");
    expect(harness.createdClients).toHaveLength(1);

    // No second refresh until the new window.
    harness.setNow(MIDNIGHT_IST + 60 * MINUTE);
    await harness.manager.getClient();
    expect(fakeClient.generateTokenCalls).toHaveLength(1);
  });

  it("falls back to a fresh login when the refresh fails", async () => {
    const harness = buildHarness();
    await harness.manager.getClient();
    harness.createdClients[0].generateTokenResponses.push({ status: 403, message: "" });
    harness.setNow(MIDNIGHT_IST - 10 * MINUTE);
    await harness.manager.getClient();
    expect(harness.createdClients).toHaveLength(2);
    expect(harness.warnings.some((warning) => warning.includes("RATE_LIMIT_ERROR"))).toBe(true);
  });

  it("logs in again (no refresh) once the token has expired", async () => {
    const harness = buildHarness();
    await harness.manager.getClient();
    harness.setNow(MIDNIGHT_IST + MINUTE);
    await harness.manager.getClient();
    expect(harness.createdClients).toHaveLength(2);
    expect(harness.createdClients[0].generateTokenCalls).toHaveLength(0);
  });

  it("re-logs in once for concurrent authentication failures on the same client", async () => {
    const harness = buildHarness({ loginDelayMilliseconds: 10 });
    const failedClient = await harness.manager.getClient();
    const recoveredClients = await Promise.all(
      Array.from({ length: 5 }, () => harness.manager.recoverFromAuthenticationFailure(failedClient)),
    );
    expect(harness.createdClients).toHaveLength(2);
    expect(new Set(recoveredClients).size).toBe(1);
    expect(recoveredClients[0]).not.toBe(failedClient);
    // A stale failure report after recovery does not trigger another login.
    await harness.manager.recoverFromAuthenticationFailure(failedClient);
    expect(harness.createdClients).toHaveLength(2);
  });

  it("treats the SDK session-expiry hook as a refresh signal", async () => {
    const harness = buildHarness();
    await harness.manager.getClient();
    harness.createdClients[0].sessionExpiryHook?.();
    await harness.manager.getClient();
    expect(harness.createdClients[0].generateTokenCalls).toEqual(["refresh-1"]);
  });

  it("uses next 00:00 IST when the JWT has no exp", async () => {
    let currentTime = LOGIN_TIME;
    let loginCount = 0;
    const manager = new SessionManager({
      createSession: async () => {
        loginCount++;
        return { client: new FakeSmartApiClient("no-exp").asSmartApi(), tokens: { jwtToken: buildFakeJwt(undefined) } };
      },
      now: () => currentTime,
      refreshMarginMilliseconds: 15 * MINUTE,
      writeInfo: () => undefined,
      writeWarning: () => undefined,
    });
    await manager.getClient();
    currentTime = MIDNIGHT_IST - 20 * MINUTE;
    await manager.getClient();
    expect(loginCount).toBe(1);
    currentTime = MIDNIGHT_IST - 10 * MINUTE;
    await manager.getClient();
    expect(loginCount).toBe(2);
  });
});
