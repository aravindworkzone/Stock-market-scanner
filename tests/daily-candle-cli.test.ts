import { beforeEach, describe, expect, it, vi } from "vitest";

/** Every external effect is mocked: no broker, no database, no network. */
const effects = vi.hoisted(() => ({
  fetchCalls: 0,
  saveCalls: 0,
  latestDateReads: 0,
}));

vi.mock("../src/angelone/historical-candles.js", () => ({
  default: async () => {
    effects.fetchCalls++;
    throw new Error("broker must not be called in this test");
  },
}));

vi.mock("../src/candles/candles.repository.js", async (importOriginal) => {
  const originalModule = await importOriginal<typeof import("../src/candles/candles.repository.js")>();
  return {
    ...originalModule,
    getLatestCandleDates: async () => {
      effects.latestDateReads++;
      return new Map([["3045", "2026-11-10"]]);
    },
    saveDailyCandles: async () => {
      effects.saveCalls++;
      throw new Error("database writes must not happen in this test");
    },
  };
});

vi.mock("../src/indices/index-stock.service.js", () => ({
  default: async () => [
    { symbol: "SBIN", symboltoken: "3045", companyName: "State Bank of India", industry: "Financial Services", series: "EQ", isin: "INE062A01020" },
    { symbol: "RELIANCE", symboltoken: "2885", companyName: "Reliance Industries Ltd.", industry: "Oil Gas", series: "EQ", isin: "INE002A01018" },
  ],
}));

import { parseDailyCandleUpdateArguments, runDailyCandleUpdateCommand } from "../src/candles/run-daily-candle-update.js";

beforeEach(() => {
  effects.fetchCalls = 0;
  effects.saveCalls = 0;
  effects.latestDateReads = 0;
});

describe("parseDailyCandleUpdateArguments", () => {
  it("parses --dry-run and both index spellings", () => {
    expect(parseDailyCandleUpdateArguments([])).toEqual({ dryRun: false, indexName: "NIFTY 500" });
    expect(parseDailyCandleUpdateArguments(["--dry-run", "--index", "NIFTY 50"])).toEqual({ dryRun: true, indexName: "NIFTY 50" });
    expect(parseDailyCandleUpdateArguments(["--index=nifty_500"])).toEqual({ dryRun: false, indexName: "NIFTY 500" });
  });

  it("rejects unknown arguments and indexes", () => {
    expect(() => parseDailyCandleUpdateArguments(["--force"])).toThrow(/Unknown argument/);
    expect(() => parseDailyCandleUpdateArguments(["--index", "BANKNIFTY"])).toThrow(/Unsupported --index/);
  });
});

describe("run-daily-candle-update --dry-run", () => {
  it("prints a plan and never calls the broker or writes the database", async () => {
    const printedLines: string[] = [];
    const consoleSpy = vi.spyOn(console, "log").mockImplementation((printedText: unknown) => {
      printedLines.push(String(printedText));
    });
    try {
      const exitCode = await runDailyCandleUpdateCommand(["--dry-run", "--index", "NIFTY 50"]);
      expect(exitCode).toBe(0);
    } finally {
      consoleSpy.mockRestore();
    }

    expect(effects.latestDateReads).toBe(1);
    expect(effects.fetchCalls).toBe(0);
    expect(effects.saveCalls).toBe(0);
    const printedSummary = JSON.parse(printedLines[0]);
    expect(printedSummary).toMatchObject({ index: "NIFTY 50", dryRun: true, totalStocks: 2, plannedCount: 2, updatedCount: 0 });
  });

  it("returns exit code 2 for bad arguments", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      expect(await runDailyCandleUpdateCommand(["--bogus"])).toBe(2);
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });
});
