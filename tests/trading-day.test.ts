import { describe, expect, it } from "vitest";
import tradingDay from "../src/util/tradingDay.js";
import fromToDate from "../src/util/fromToDate.js";

describe("tradingDay", () => {
  it("includes the anchor date when it is a trading day and skips weekends (backward)", () => {
    // 2026-11-16 is a Monday
    expect(tradingDay("2026-11-16", "backward", 3)).toEqual(["2026-11-16", "2026-11-13", "2026-11-12"]);
  });

  it("skips configured holidays (2026-11-24) going forward", () => {
    expect(tradingDay("2026-11-23", "forward", 3)).toEqual(["2026-11-23", "2026-11-25", "2026-11-26"]);
  });

  it("includes special trading days even on a weekend (2026-11-08 is a Sunday)", () => {
    expect(tradingDay("2026-11-08", "forward", 2)).toEqual(["2026-11-08", "2026-11-09"]);
  });

  it("rejects invalid input", () => {
    expect(() => tradingDay("", "backward", 1)).toThrow("Date is required");
    expect(() => tradingDay("2026-11-19", "sideways" as "forward", 1)).toThrow("Invalid direction");
    expect(() => tradingDay("2026-11-19", "backward", 0)).toThrow("Number of days must be positive");
    expect(() => tradingDay("19-11-2026", "backward", 1)).toThrow("Invalid date format");
    expect(() => tradingDay("2026-02-30", "backward", 1)).toThrow("Invalid date");
  });
});

describe("fromToDate", () => {
  it("returns the earliest and latest trading day with market-day times", () => {
    expect(fromToDate("2026-11-16", "backward", 3)).toEqual({
      fromdate: "2026-11-12 00:00",
      todate: "2026-11-16 15:30",
    });
  });

  it("works forward as well", () => {
    expect(fromToDate("2026-11-23", "forward", 3)).toEqual({
      fromdate: "2026-11-23 00:00",
      todate: "2026-11-26 15:30",
    });
  });
});
