import { describe, expect, it } from "vitest";
import {
  DEFAULT_BACKOFF,
  DEFAULT_OPERATION_RATE_LIMITS,
  DEFAULT_RATE_LIMIT,
  TokenBucketRateLimiter,
  computeBackoffDelayMilliseconds,
  parseRateLimitOverrides,
  type RateLimitSettings,
} from "../src/angelone/rate-limiter.js";

/** Virtual clock: sleep() advances time instantly, so tests never wait. */
function buildLimiter(operationSettings: Record<string, RateLimitSettings> = {}) {
  let currentTime = 1_000_000;
  const sleeps: number[] = [];
  const limiter = new TokenBucketRateLimiter({
    now: () => currentTime,
    sleep: async (milliseconds) => {
      sleeps.push(milliseconds);
      currentTime += milliseconds;
    },
    operationSettings,
  });
  return { limiter, sleeps, now: () => currentTime, advance: (milliseconds: number) => (currentTime += milliseconds) };
}

describe("TokenBucketRateLimiter", () => {
  it("allows a burst, then spaces requests at the sustained rate", async () => {
    const { limiter, now } = buildLimiter({ testOperation: { requestsPerSecond: 2, burst: 3 } });
    const startTime = now();
    const grantTimes: number[] = [];
    for (let requestIndex = 0; requestIndex < 6; requestIndex++) {
      await limiter.acquire("testOperation");
      grantTimes.push(now() - startTime);
    }
    expect(grantTimes).toEqual([0, 0, 0, 500, 1000, 1500]);
  });

  it("serves concurrent callers in FIFO order", async () => {
    const { limiter } = buildLimiter({ testOperation: { requestsPerSecond: 1, burst: 1 } });
    const grantOrder: number[] = [];
    await Promise.all(
      [0, 1, 2, 3].map((callerIndex) => limiter.acquire("testOperation").then(() => grantOrder.push(callerIndex))),
    );
    expect(grantOrder).toEqual([0, 1, 2, 3]);
  });

  it("keeps separate buckets per operation", async () => {
    const { limiter, now } = buildLimiter({
      slowOperation: { requestsPerSecond: 0.1, burst: 1 },
      otherOperation: { requestsPerSecond: 0.1, burst: 1 },
    });
    const startTime = now();
    await limiter.acquire("slowOperation");
    await limiter.acquire("otherOperation");
    expect(now() - startTime).toBe(0);
  });

  it("penalize() blocks the operation for the backoff delay", async () => {
    const { limiter, now } = buildLimiter({ testOperation: { requestsPerSecond: 10, burst: 5 } });
    await limiter.acquire("testOperation");
    const penaltyStart = now();
    limiter.penalize("testOperation", 4000);
    await limiter.acquire("testOperation");
    expect(now() - penaltyStart).toBeGreaterThanOrEqual(4000);
  });

  it("uses conservative defaults: getCandleData 1 per 2 s, unknown operations 1 per s", async () => {
    const { limiter } = buildLimiter();
    expect(limiter.settingsFor("getCandleData")).toEqual(DEFAULT_OPERATION_RATE_LIMITS.getCandleData);
    expect(limiter.settingsFor("getCandleData")).toEqual({ requestsPerSecond: 0.5, burst: 1 });
    expect(limiter.settingsFor("someNewOperation")).toEqual(DEFAULT_RATE_LIMIT);
  });

  it("config overrides win over defaults", () => {
    const { limiter } = buildLimiter({ getCandleData: { requestsPerSecond: 0.25, burst: 1 } });
    expect(limiter.settingsFor("getCandleData")).toEqual({ requestsPerSecond: 0.25, burst: 1 });
  });
});

describe("parseRateLimitOverrides", () => {
  it("parses valid JSON and treats empty input as no overrides", () => {
    expect(parseRateLimitOverrides(undefined)).toEqual({});
    expect(parseRateLimitOverrides("  ")).toEqual({});
    expect(parseRateLimitOverrides('{"getRMS":{"requestsPerSecond":0.5,"burst":2}}')).toEqual({
      getRMS: { requestsPerSecond: 0.5, burst: 2 },
    });
  });

  it("rejects invalid settings", () => {
    expect(() => parseRateLimitOverrides('{"getRMS":{"requestsPerSecond":0,"burst":1}}')).toThrow();
    expect(() => parseRateLimitOverrides("not json")).toThrow();
  });
});

describe("computeBackoffDelayMilliseconds", () => {
  it("grows exponentially and is capped", () => {
    expect([0, 1, 2, 3, 10].map((retryIndex) => computeBackoffDelayMilliseconds(retryIndex, DEFAULT_BACKOFF))).toEqual([
      2000, 4000, 8000, 16000, 30000,
    ]);
  });
});
