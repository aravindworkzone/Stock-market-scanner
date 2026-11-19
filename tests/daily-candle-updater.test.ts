import { describe, expect, it } from "vitest";
import { latestCompleteCandleDate } from "../src/candles/candle-cutoff.js";
import {
  candlesWithinDates,
  planSymbolUpdate,
  runDailyCandleUpdate,
  splitIntoRequestRanges,
  type DailyCandleUpdateSettings,
  type DailyCandleUpdaterDependencies,
  type UpdaterStock,
} from "../src/candles/daily-candle-updater.js";
import { AppError } from "../src/core/errors.js";
import type { AngelOneCandle } from "../src/types/angelone.js";
import { addCalendarDays } from "../src/util/ist.js";

/** UTC instant for an IST wall-clock time. */
function istMoment(dateText: string, timeText: string): Date {
  return new Date(new Date(`${dateText}T${timeText}:00Z`).getTime() - (5 * 60 + 30) * 60_000);
}

const SETTINGS: DailyCandleUpdateSettings = {
  exchange: "NSE",
  dryRun: false,
  bootstrapCalendarDays: 10,
  maxCalendarDaysPerRequest: 5,
  marketCloseBufferMinutes: 30,
  maxConsecutiveRateLimitFailures: 2,
};

describe("latestCompleteCandleDate", () => {
  it("excludes today before 15:30 IST + buffer and includes it after", () => {
    expect(latestCompleteCandleDate(istMoment("2026-11-19", "11:00"), 30)).toBe("2026-11-18");
    expect(latestCompleteCandleDate(istMoment("2026-11-19", "15:45"), 30)).toBe("2026-11-18");
    expect(latestCompleteCandleDate(istMoment("2026-11-19", "16:00"), 30)).toBe("2026-11-19");
    expect(latestCompleteCandleDate(istMoment("2026-11-19", "15:30"), 0)).toBe("2026-11-19");
  });

  it("rolls back over weekends and holidays", () => {
    // Saturday -> Friday; Monday morning -> Friday
    expect(latestCompleteCandleDate(istMoment("2026-11-21", "18:00"), 30)).toBe("2026-11-20");
    expect(latestCompleteCandleDate(istMoment("2026-11-23", "09:00"), 30)).toBe("2026-11-20");
    // 2026-11-24 is a configured holiday
    expect(latestCompleteCandleDate(istMoment("2026-11-24", "18:00"), 30)).toBe("2026-11-23");
  });

  it("is computed in IST even late at night UTC", () => {
    // 2026-11-19 20:00 UTC is 2026-11-20 01:30 IST -> latest complete day is 2026-11-19
    expect(latestCompleteCandleDate(new Date("2026-11-19T20:00:00Z"), 30)).toBe("2026-11-19");
  });
});

describe("planning", () => {
  const stock: UpdaterStock = { symbol: "SBIN", symboltoken: "3045" };

  it("splits ranges into chunks of at most maxCalendarDays", () => {
    expect(splitIntoRequestRanges("2026-11-01", "2026-11-12", 5)).toEqual([
      { fromdate: "2026-11-01 00:00", todate: "2026-11-05 15:30" },
      { fromdate: "2026-11-06 00:00", todate: "2026-11-10 15:30" },
      { fromdate: "2026-11-11 00:00", todate: "2026-11-12 15:30" },
    ]);
    expect(() => splitIntoRequestRanges("2026-11-01", "2026-11-02", 0)).toThrow();
  });

  it("starts the day after the last stored candle", () => {
    expect(planSymbolUpdate(stock, "2026-11-16", "2026-11-18", SETTINGS)).toMatchObject({
      lastStoredDate: "2026-11-16",
      fromDate: "2026-11-17",
      toDate: "2026-11-18",
      requestRanges: [{ fromdate: "2026-11-17 00:00", todate: "2026-11-18 15:30" }],
    });
  });

  it("returns null when already up to date", () => {
    expect(planSymbolUpdate(stock, "2026-11-18", "2026-11-18", SETTINGS)).toBeNull();
  });

  it("bootstraps symbols with no stored candles", () => {
    expect(planSymbolUpdate(stock, undefined, "2026-11-18", SETTINGS)).toMatchObject({
      lastStoredDate: null,
      fromDate: "2026-11-08",
      toDate: "2026-11-18",
    });
  });

  it("drops candles outside the planned dates (e.g. a partial today candle)", () => {
    const candles: AngelOneCandle[] = [
      ["2026-11-17T00:00:00+05:30", 1, 1, 1, 1, 1],
      ["2026-11-18T00:00:00+05:30", 2, 2, 2, 2, 2],
      ["2026-11-19T00:00:00+05:30", 3, 3, 3, 3, 3],
    ];
    expect(candlesWithinDates(candles, "2026-11-18", "2026-11-18").map((candle) => candle[1])).toEqual([2]);
  });
});

interface FakeStore {
  latestDates: Map<string, string>;
  savedCandles: Array<{ symbolToken: string; candleDates: string[] }>;
  fetchRequests: Array<{ symbolToken: string; fromdate: string; todate: string }>;
}

function buildDependencies(
  stocks: UpdaterStock[],
  store: FakeStore,
  now: Date,
  fetchOverride?: (symbolToken: string) => Promise<AngelOneCandle[] | undefined>,
): DailyCandleUpdaterDependencies {
  return {
    listStocks: async () => stocks,
    getLatestCandleDates: async () => new Map(store.latestDates),
    fetchDailyCandles: async (_exchange, symbolToken, fromdate, todate) => {
      store.fetchRequests.push({ symbolToken, fromdate, todate });
      const overridden = await fetchOverride?.(symbolToken);
      if (overridden !== undefined) return overridden;
      // Broker returns every weekday in range, plus (to prove the guard) a partial "today" candle.
      const candles: AngelOneCandle[] = [];
      for (let candleDate = fromdate.slice(0, 10); candleDate <= addCalendarDays(todate.slice(0, 10), 1); candleDate = addCalendarDays(candleDate, 1)) {
        const weekday = new Date(`${candleDate}T00:00:00Z`).getUTCDay();
        if (weekday !== 0 && weekday !== 6) candles.push([`${candleDate}T00:00:00+05:30`, 10, 11, 9, 10, 100]);
      }
      return candles;
    },
    saveDailyCandles: async (_exchange, symbolToken, _symbol, candles) => {
      const candleDates = candles.map((candle) => String(candle[0]).slice(0, 10));
      store.savedCandles.push({ symbolToken, candleDates });
      const lastDate = candleDates[candleDates.length - 1];
      if (lastDate !== undefined) store.latestDates.set(symbolToken, lastDate);
      return candles.length;
    },
    now: () => now,
    writeInfo: () => undefined,
    writeWarning: () => undefined,
  };
}

function emptyStore(latestDates: Record<string, string> = {}): FakeStore {
  return { latestDates: new Map(Object.entries(latestDates)), savedCandles: [], fetchRequests: [] };
}

const STOCKS: UpdaterStock[] = [
  { symbol: "SBIN", symboltoken: "3045" },
  { symbol: "RELIANCE", symboltoken: "2885" },
  { symbol: "INFY", symboltoken: "1594" },
];

describe("runDailyCandleUpdate", () => {
  it("fetches only missing dates and never stores today's candle before the close buffer", async () => {
    const store = emptyStore({ "3045": "2026-11-16", "2885": "2026-11-18", "1594": "2026-11-17" });
    const summary = await runDailyCandleUpdate(buildDependencies(STOCKS, store, istMoment("2026-11-19", "14:00")), SETTINGS);

    expect(summary).toMatchObject({ cutoffDate: "2026-11-18", totalStocks: 3, upToDateCount: 1, plannedCount: 2, updatedCount: 2 });
    expect(store.fetchRequests).toEqual([
      { symbolToken: "3045", fromdate: "2026-11-17 00:00", todate: "2026-11-18 15:30" },
      { symbolToken: "1594", fromdate: "2026-11-18 00:00", todate: "2026-11-18 15:30" },
    ]);
    const allSavedDates = store.savedCandles.flatMap((savedBatch) => savedBatch.candleDates);
    expect(allSavedDates).not.toContain("2026-11-19");
    expect(store.savedCandles).toEqual([
      { symbolToken: "3045", candleDates: ["2026-11-17", "2026-11-18"] },
      { symbolToken: "1594", candleDates: ["2026-11-18"] },
    ]);
    expect(summary.savedCandleCount).toBe(3);
  });

  it("includes today after 15:30 IST + buffer", async () => {
    const store = emptyStore({ "3045": "2026-11-18" });
    await runDailyCandleUpdate(buildDependencies([STOCKS[0]], store, istMoment("2026-11-19", "16:05")), SETTINGS);
    expect(store.savedCandles).toEqual([{ symbolToken: "3045", candleDates: ["2026-11-19"] }]);
  });

  it("dry run plans but never fetches or saves", async () => {
    const store = emptyStore({ "3045": "2026-11-10" });
    const summary = await runDailyCandleUpdate(buildDependencies(STOCKS, store, istMoment("2026-11-19", "18:00")), {
      ...SETTINGS,
      dryRun: true,
    });
    expect(summary.dryRun).toBe(true);
    expect(summary.plannedCount).toBe(3);
    expect(summary.plans[0].requestRanges.length).toBeGreaterThan(1);
    expect(store.fetchRequests).toEqual([]);
    expect(store.savedCandles).toEqual([]);
  });

  it("is resumable: a second run after success has nothing to do", async () => {
    const store = emptyStore();
    const now = istMoment("2026-11-19", "18:00");
    const firstRun = await runDailyCandleUpdate(buildDependencies(STOCKS, store, now), SETTINGS);
    expect(firstRun.updatedCount).toBe(3);
    const secondRun = await runDailyCandleUpdate(buildDependencies(STOCKS, store, now), SETTINGS);
    expect(secondRun.plannedCount).toBe(0);
  });

  it("records a failing symbol and continues with the rest", async () => {
    const store = emptyStore({ "3045": "2026-11-17", "2885": "2026-11-17", "1594": "2026-11-17" });
    const summary = await runDailyCandleUpdate(
      buildDependencies(STOCKS, store, istMoment("2026-11-19", "18:00"), async (symbolToken) => {
        if (symbolToken === "2885") throw new AppError("BROKER_API_ERROR", "[BROKER_API_ERROR] getCandleData: boom");
        return undefined;
      }),
      SETTINGS,
    );
    expect(summary.updatedCount).toBe(2);
    expect(summary.failedStocks).toEqual([
      { symbol: "RELIANCE", symboltoken: "2885", reason: "[BROKER_API_ERROR] getCandleData: boom" },
    ]);
    expect(summary.stoppedEarly).toBeNull();
  });

  it("stops early after consecutive rate-limited symbols so a re-run can resume", async () => {
    const store = emptyStore({ "3045": "2026-11-17", "2885": "2026-11-17", "1594": "2026-11-17" });
    const summary = await runDailyCandleUpdate(
      buildDependencies(STOCKS, store, istMoment("2026-11-19", "18:00"), async () => {
        throw new AppError("RATE_LIMIT_ERROR", "[RATE_LIMIT_ERROR] getCandleData: Angel One rate limit exceeded (HTTP 403)");
      }),
      SETTINGS,
    );
    expect(summary.failedStocks).toHaveLength(2);
    expect(summary.stoppedEarly).toMatch(/Stopped after 2 consecutive rate-limited symbols/);
    expect(store.fetchRequests.map((fetchRequest) => fetchRequest.symbolToken)).toEqual(["3045", "2885"]);
  });
});
