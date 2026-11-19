import { describe, expect, it } from "vitest";
import { checkCandleFreshness } from "../src/candles/candle-freshness.js";

const STOCKS = [
  { symbol: "SBIN", symboltoken: "3045" },
  { symbol: "RELIANCE", symboltoken: "2885" },
  { symbol: "INFY", symboltoken: "1594" },
  { symbol: "NEWLIST", symboltoken: "9999" },
];

describe("checkCandleFreshness", () => {
  it("counts up-to-date, stale and missing symbols against the expected latest date", async () => {
    const report = await checkCandleFreshness(
      {
        listStocks: async () => STOCKS,
        getLatestCandleDates: async () =>
          new Map([
            ["3045", "2026-11-18"],
            ["2885", "2026-11-12"],
            ["1594", "2026-11-17"],
          ]),
        // 2026-11-19 11:00 IST -> expected latest complete candle 2026-11-18
        now: () => new Date("2026-11-19T05:30:00Z"),
      },
      { exchange: "NSE", marketCloseBufferMinutes: 30, staleListLimit: 2 },
    );

    expect(report).toMatchObject({
      expectedLatestCandleDate: "2026-11-18",
      newestCandleDate: "2026-11-18",
      oldestLatestCandleDate: "2026-11-12",
      totalStocks: 4,
      upToDateCount: 1,
      staleCount: 2,
      missingCount: 1,
      staleSymbolsTruncated: true,
    });
    // Oldest first: missing (null) before 2026-11-12.
    expect(report.staleSymbols).toEqual([
      { symbol: "NEWLIST", symboltoken: "9999", lastCandleDate: null },
      { symbol: "RELIANCE", symboltoken: "2885", lastCandleDate: "2026-11-12" },
    ]);
  });
});
