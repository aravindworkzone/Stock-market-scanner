import { describe, expect, it } from "vitest";
import {
  assertDailyInterval,
  candlesOnOrAfter,
  indicatorWarmupTradingDays,
  week52WindowStartDate,
} from "../src/calculators/indicators/indicator-window.js";
import { addCalendarDays, isAfterMarketCloseIst, istDateString, istMinutesOfDay } from "../src/util/ist.js";
import type { AngelOneCandle } from "../src/types/angelone.js";

describe("indicator window helpers", () => {
  it("accepts ONE_DAY and rejects other intervals with a [VALIDATION_ERROR]", () => {
    expect(() => assertDailyInterval("ONE_DAY")).not.toThrow();
    expect(() => assertDailyInterval("FIVE_MINUTE")).toThrow(/^\[VALIDATION_ERROR\] Interval FIVE_MINUTE is not supported/);
  });

  it("warm-up is max(period x 5, 365) trading days", () => {
    expect(indicatorWarmupTradingDays(14)).toBe(365);
    expect(indicatorWarmupTradingDays(100)).toBe(500);
  });

  it("52-week window starts 364 calendar days before the current date", () => {
    expect(week52WindowStartDate("2026-11-19")).toBe("2025-11-20");
  });

  it("filters candles by their IST date prefix", () => {
    const candles: AngelOneCandle[] = [
      ["2025-11-19T00:00:00+05:30", 1, 1, 1, 1, 1],
      ["2025-11-20T00:00:00+05:30", 2, 2, 2, 2, 2],
      ["2026-11-19T00:00:00+05:30", 3, 3, 3, 3, 3],
    ];
    expect(candlesOnOrAfter(candles, "2025-11-20").map((candle) => candle[1])).toEqual([2, 3]);
  });
});

describe("IST helpers", () => {
  it("converts UTC instants to IST dates and minutes", () => {
    expect(istDateString(new Date("2026-11-19T18:29:00Z"))).toBe("2026-11-19");
    expect(istDateString(new Date("2026-11-19T18:30:00Z"))).toBe("2026-11-20");
    expect(istMinutesOfDay(new Date("2026-11-19T10:00:00Z"))).toBe(15 * 60 + 30);
  });

  it("market-close check honours the buffer", () => {
    expect(isAfterMarketCloseIst(new Date("2026-11-19T10:00:00Z"), 0)).toBe(true);
    expect(isAfterMarketCloseIst(new Date("2026-11-19T10:00:00Z"), 30)).toBe(false);
    expect(isAfterMarketCloseIst(new Date("2026-11-19T10:30:00Z"), 30)).toBe(true);
  });

  it("adds calendar days across month and year ends", () => {
    expect(addCalendarDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addCalendarDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});
