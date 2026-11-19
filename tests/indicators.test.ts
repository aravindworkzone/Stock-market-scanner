import { describe, expect, it } from "vitest";
import { getSMA } from "../src/calculators/indicators/sma.js";
import { getEMA } from "../src/calculators/indicators/ema.js";
import { getRSI } from "../src/calculators/indicators/rsi.js";
import { getMACD } from "../src/calculators/indicators/macd.js";
import { getATR } from "../src/calculators/indicators/atr.js";
import { getVolumeAverage } from "../src/calculators/indicators/volume-average.js";
import { getWeek52HighLow } from "../src/calculators/indicators/week-52-high-low.js";
import { getSupportResistance } from "../src/calculators/indicators/support-resistance.js";
import type { AngelOneCandle } from "../src/types/angelone.js";

const FIRST_DATE = Date.parse("2026-01-01T00:00:00Z");

function timestampFor(candleIndex: number): string {
  return `${new Date(FIRST_DATE + candleIndex * 86_400_000).toISOString().slice(0, 10)}T00:00:00+05:30`;
}

/** Candles whose open/high/low equal the close (valid for close-only indicators). */
function candlesFromCloses(closes: number[]): AngelOneCandle[] {
  return closes.map((closePrice, candleIndex) => [timestampFor(candleIndex), closePrice, closePrice, closePrice, closePrice, 100]);
}

function candlesFromHighLowClose(rows: Array<[number, number, number]>): AngelOneCandle[] {
  return rows.map(([highPrice, lowPrice, closePrice], candleIndex) => [
    timestampFor(candleIndex),
    closePrice,
    highPrice,
    lowPrice,
    closePrice,
    100,
  ]);
}

function candlesFromVolumes(volumes: number[]): AngelOneCandle[] {
  return volumes.map((volume, candleIndex) => [timestampFor(candleIndex), 10, 10, 10, 10, volume]);
}

function expectAppErrorCode(action: () => unknown, errorCode: string): void {
  expect(action).toThrow(expect.objectContaining({ code: errorCode }));
}

describe("shared candle validation (all pure indicators)", () => {
  const sortedCandles = candlesFromCloses([1, 2, 3, 4, 5]);
  const unsortedCandles: AngelOneCandle[] = [sortedCandles[1], sortedCandles[0], ...sortedCandles.slice(2)];
  const pureIndicators: Array<[string, (candles: AngelOneCandle[]) => unknown]> = [
    ["getSMA", (candles) => getSMA(candles, 2)],
    ["getEMA", (candles) => getEMA(candles, 2)],
    ["getRSI", (candles) => getRSI(candles, 2)],
    ["getMACD", (candles) => getMACD(candles, 2, 3, 2)],
    ["getATR", (candles) => getATR(candles, 2)],
    ["getVolumeAverage", (candles) => getVolumeAverage(candles, 2)],
    ["getWeek52HighLow", (candles) => getWeek52HighLow(candles)],
    ["getSupportResistance", (candles) => getSupportResistance(candles, 1, 1, 1)],
  ];

  it.each(pureIndicators)("%s rejects candles that are not in ascending order", (_indicatorName, computeIndicator) => {
    expectAppErrorCode(() => computeIndicator(unsortedCandles), "VALIDATION_ERROR");
  });

  it.each(pureIndicators)("%s rejects malformed candles", (_indicatorName, computeIndicator) => {
    const malformedCandles = [...sortedCandles.slice(0, 4), ["2026-01-05T00:00:00+05:30", 1] as unknown as AngelOneCandle];
    expectAppErrorCode(() => computeIndicator(malformedCandles), "VALIDATION_ERROR");
  });
});

describe("getSMA", () => {
  it("averages the latest `period` closes", () => {
    expect(getSMA(candlesFromCloses([1, 2, 3, 4, 5]), 3)).toMatchObject({ indicator: "SMA", period: 3, "latest sma": 4 });
  });

  it("rounds to 2 decimals and reports the last timestamp", () => {
    const smaResult = getSMA(candlesFromCloses([1, 1, 2]), 3);
    expect(smaResult["latest sma"]).toBe(1.33);
    expect(smaResult.timestamp).toBe(timestampFor(2));
  });

  it("fails with NO_DATA when there are fewer candles than the period", () => {
    expectAppErrorCode(() => getSMA(candlesFromCloses([1, 2]), 3), "NO_DATA");
  });

  it("rejects non-positive closes and invalid periods", () => {
    expectAppErrorCode(() => getSMA(candlesFromCloses([1, 0, 3]), 2), "VALIDATION_ERROR");
    expectAppErrorCode(() => getSMA(candlesFromCloses([1, 2, 3]), 0), "VALIDATION_ERROR");
  });
});

describe("getEMA", () => {
  it("seeds with the SMA and smooths with 2/(period+1)", () => {
    // seed SMA(1,2,3)=2, k=0.5 -> 3 -> 4
    expect(getEMA(candlesFromCloses([1, 2, 3, 4, 5]), 3)).toMatchObject({ indicator: "EMA", "latest ema": 4 });
  });

  it("fails with NO_DATA when there are fewer candles than the period", () => {
    expectAppErrorCode(() => getEMA(candlesFromCloses([1, 2]), 3), "NO_DATA");
  });
});

describe("getRSI (Wilder)", () => {
  it("computes Wilder-smoothed RSI", () => {
    // changes +1,-1 -> avg 0.5/0.5; then +2 -> gain 1.25, loss 0.25 -> RS 5 -> 83.33
    expect(getRSI(candlesFromCloses([10, 11, 10, 12]), 2).value).toBe(83.33);
  });

  it("handles the edge cases: all gains 100, all losses 0, flat 50", () => {
    expect(getRSI(candlesFromCloses([1, 2, 3, 4]), 2).value).toBe(100);
    expect(getRSI(candlesFromCloses([4, 3, 2, 1]), 2).value).toBe(0);
    expect(getRSI(candlesFromCloses([5, 5, 5, 5]), 2).value).toBe(50);
  });

  it("needs period + 1 candles", () => {
    expectAppErrorCode(() => getRSI(candlesFromCloses([1, 2]), 2), "NO_DATA");
  });
});

describe("getMACD", () => {
  it("computes MACD, signal and histogram", () => {
    // fast EMA(2) - slow EMA(3) on a linear series is a constant 0.5; signal EMA(2) of that is 0.5.
    expect(getMACD(candlesFromCloses([1, 2, 3, 4, 5, 6]), 2, 3, 2)).toMatchObject({
      "macd line": 0.5,
      "signal line": 0.5,
      histogram: 0,
    });
  });

  it("is zero for a flat series", () => {
    expect(getMACD(candlesFromCloses(Array(40).fill(100)))).toMatchObject({ "macd line": 0, "signal line": 0, histogram: 0 });
  });

  it("validates periods and candle count", () => {
    expectAppErrorCode(() => getMACD(candlesFromCloses(Array(40).fill(1)), 26, 12, 9), "VALIDATION_ERROR");
    expectAppErrorCode(() => getMACD(candlesFromCloses([1, 2, 3]), 2, 3, 2), "NO_DATA");
  });
});

describe("getATR (Wilder)", () => {
  const atrCandles = candlesFromHighLowClose([
    [10, 8, 9],
    [11, 9, 10],
    [12, 10, 11],
    [15, 11, 14],
  ]);

  it("averages true ranges, then applies Wilder smoothing", () => {
    // TR = 2, 2, 4 -> seed (2+2)/2 = 2 -> (2*1 + 4)/2 = 3
    expect(getATR(atrCandles, 2)).toMatchObject({ indicator: "ATR", value: 3, timestamp: timestampFor(3) });
  });

  it("uses the previous close for gaps", () => {
    const gapCandles = candlesFromHighLowClose([
      [10, 9, 9.5],
      [20, 19, 19.5],
    ]);
    expect(getATR(gapCandles, 1).value).toBe(10.5);
  });

  it("rejects inconsistent OHLC and too few candles", () => {
    expectAppErrorCode(() => getATR(candlesFromHighLowClose([[10, 8, 11], [11, 9, 10], [12, 10, 11]]), 2), "VALIDATION_ERROR");
    expectAppErrorCode(() => getATR(atrCandles.slice(0, 2), 2), "NO_DATA");
  });
});

describe("getVolumeAverage", () => {
  it("compares the latest volume with the average of the last `period` volumes", () => {
    expect(getVolumeAverage(candlesFromVolumes([10, 20, 30, 40]), 2)).toMatchObject({
      "latest volume": 40,
      "average volume": 35,
      "relative volume": 1.14,
    });
  });

  it("returns null relative volume when the average is zero", () => {
    expect(getVolumeAverage(candlesFromVolumes([0, 0, 0]), 2)["relative volume"]).toBeNull();
  });

  it("rejects fractional or negative volume", () => {
    expectAppErrorCode(() => getVolumeAverage(candlesFromVolumes([10, 1.5]), 2), "VALIDATION_ERROR");
    expectAppErrorCode(() => getVolumeAverage(candlesFromVolumes([10, -1]), 2), "VALIDATION_ERROR");
  });
});

describe("getWeek52HighLow", () => {
  it("returns the extreme high/low and distances of the latest close", () => {
    const yearCandles = candlesFromHighLowClose([
      [120, 90, 100],
      [150, 80, 140],
      [130, 100, 120],
    ]);
    expect(getWeek52HighLow(yearCandles)).toMatchObject({
      "52 week high": 150,
      "52 week low": 80,
      "latest close": 120,
      "distance from high (%)": -20,
      "distance from low (%)": 50,
    });
  });

  it("fails with NO_DATA on an empty list", () => {
    expectAppErrorCode(() => getWeek52HighLow([]), "NO_DATA");
  });
});

describe("getSupportResistance", () => {
  const swingCandles = candlesFromHighLowClose([
    [10, 8, 9],
    [12, 9, 11],
    [11, 7, 8],
    [10, 8, 9],
    [10.5, 8.5, 9.5],
  ]);

  it("finds swing highs/lows and the nearest zones around the latest close", () => {
    const levels = getSupportResistance(swingCandles, 1, 1, 1);
    expect(levels.latestClose).toBe(9.5);
    expect(levels.nearestResistance).toEqual({ price: 12, touches: 1, lastTouched: timestampFor(1) });
    expect(levels.nearestSupport).toEqual({ price: 7, touches: 1, lastTouched: timestampFor(2) });
  });

  it("merges swing points within tolerancePercent into one zone", () => {
    const doubleTopCandles = candlesFromHighLowClose([
      [10, 8, 9],
      [20, 9, 10],
      [10, 8, 9],
      [20.1, 9, 10],
      [10, 8, 9],
      [10, 8, 9],
    ]);
    const levels = getSupportResistance(doubleTopCandles, 1, 1, 1);
    expect(levels.nearestResistance).toEqual({ price: 20.05, touches: 2, lastTouched: timestampFor(3) });
  });

  it("needs leftBars + rightBars + 1 candles and a sane tolerance", () => {
    expectAppErrorCode(() => getSupportResistance(swingCandles.slice(0, 2), 1, 1, 1), "NO_DATA");
    expectAppErrorCode(() => getSupportResistance(swingCandles, 1, 1, 0), "VALIDATION_ERROR");
  });
});
