import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * In-memory stand-in for daily_candles (no real database). One row per weekday,
 * closes drift deterministically; a huge spike sits ~400 calendar days back,
 * inside the 365-trading-day fetch window but outside 52 weeks.
 */
const repositoryState = vi.hoisted(() => ({ spikeDate: "", rows: [] as Record<string, unknown>[] }));

vi.mock("../src/candles/candles.repository.js", async (importOriginal) => {
  const originalModule = await importOriginal<typeof import("../src/candles/candles.repository.js")>();
  return {
    ...originalModule,
    getDailyCandles: async (_exchange: string, _symbolToken: string, fromdate: string, todate: string) => ({
      status: true,
      message: "mock",
      data: repositoryState.rows.filter((row) => {
        const candleDate = String(row.candle_date);
        return candleDate >= fromdate.slice(0, 10) && candleDate <= todate.slice(0, 10);
      }),
    }),
  };
});

import AllIndicators from "../src/calculators/indicators/all-indicators.js";
import RSI from "../src/calculators/indicators/rsi.js";
import { SMA } from "../src/calculators/indicators/sma.js";
import { bulkIndicatorScanner } from "../src/calculators/indicators/bulk-indicators-scanner.js";
import { addCalendarDays } from "../src/util/ist.js";

const FIXED_NOW = new Date("2026-11-19T12:00:00Z");

function buildRows(): void {
  repositoryState.rows = [];
  repositoryState.spikeDate = addCalendarDays("2026-11-19", -400);
  let closePrice = 100;
  for (let dayOffset = -800; dayOffset <= 0; dayOffset++) {
    const candleDate = addCalendarDays("2026-11-19", dayOffset);
    const weekday = new Date(`${candleDate}T00:00:00Z`).getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    closePrice += Math.sin(dayOffset / 7) * 2;
    const isSpike = candleDate === repositoryState.spikeDate || candleDate === addCalendarDays(repositoryState.spikeDate, 1);
    repositoryState.rows.push({
      candle_date: candleDate,
      open: closePrice,
      high: isSpike ? 9999 : closePrice + 1,
      low: isSpike ? 1 : closePrice - 1,
      close: closePrice,
      volume: 1000 + (dayOffset % 13),
    });
  }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(FIXED_NOW);
  buildRows();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("B1: 52-week high/low covers 52 weeks", () => {
  it("calculate_all_indicators ignores candles older than 364 calendar days", async () => {
    const indicators = await AllIndicators("NSE", "3045", "ONE_DAY", 14);
    expect(indicators.Week52HighLow["52 week high"]).toBeLessThan(9999);
    expect(indicators.Week52HighLow["52 week low"]).toBeGreaterThan(1);
  });
});

describe("B2: DB-backed indicators reject non-daily intervals", () => {
  it("rejects FIVE_MINUTE instead of mislabeling daily data", async () => {
    await expect(AllIndicators("NSE", "3045", "FIVE_MINUTE", 14)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(RSI("NSE", "3045", "ONE_HOUR", 14)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(SMA("NSE", "3045", "FIFTEEN_MINUTE", 20, "2026-11-19", "backward")).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    await expect(bulkIndicatorScanner("NIFTY 50", { interval: "ONE_MINUTE" })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });
});

describe("B3: calculate_rsi uses the same warm-up as calculate_all_indicators", () => {
  it("returns the identical RSI value", async () => {
    const standaloneRsi = await RSI("NSE", "3045", "ONE_DAY", 14);
    const combined = await AllIndicators("NSE", "3045", "ONE_DAY", 14);
    expect(standaloneRsi.value).toBe(combined.RSI.value);
  });
});
