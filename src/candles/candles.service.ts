import getHistoricalCandles from "../angelone/historical-candles.js";
import { toAppError, AppError } from "../core/errors.js";
import searchInstruments from "../instruments/instrument-search.js";
import { logger } from "../core/logger.js";
import { config } from "../config/config.js";
import { getLatestCandleDates, saveDailyCandles } from "./candles.repository.js";
import indexStock from "../indices/index-stock.service.js";
import type { IndexName } from "../indices/index-stock.service.js";
import { latestCompleteCandleDate } from "./candle-cutoff.js";
import {
  candlesWithinDates,
  runDailyCandleUpdate,
  type DailyCandleUpdateSettings,
  type DailyCandleUpdateSummary,
  type DailyCandleUpdaterDependencies,
} from "./daily-candle-updater.js";

const DAILY_INTERVAL = "ONE_DAY";

export function buildDailyCandleUpdateSettings(overrides: Partial<DailyCandleUpdateSettings> = {}): DailyCandleUpdateSettings {
  return {
    exchange: "NSE",
    dryRun: false,
    bootstrapCalendarDays: config.CANDLE_UPDATE_BOOTSTRAP_DAYS,
    maxCalendarDaysPerRequest: config.CANDLE_UPDATE_MAX_DAYS_PER_REQUEST,
    marketCloseBufferMinutes: config.CANDLE_UPDATE_MARKET_CLOSE_BUFFER_MINUTES,
    maxConsecutiveRateLimitFailures: config.CANDLE_UPDATE_MAX_CONSECUTIVE_RATE_LIMITS,
    ...overrides,
  };
}

/** Production wiring: NSE index constituents, Neon daily_candles, Angel One via call() (rate-limited). */
export function createProductionUpdaterDependencies(indexName: IndexName): DailyCandleUpdaterDependencies {
  return {
    listStocks: () => indexStock(indexName),
    getLatestCandleDates: (exchange, symbolTokens) => getLatestCandleDates(exchange, symbolTokens),
    fetchDailyCandles: async (exchange, symbolToken, fromdate, todate) => {
      const candleEnvelope = await getHistoricalCandles(exchange, symbolToken, DAILY_INTERVAL, fromdate, todate);
      return candleEnvelope.data ?? [];
    },
    saveDailyCandles: (exchange, symbolToken, symbol, candles) => saveDailyCandles(exchange, symbolToken, symbol, candles),
    now: () => new Date(),
    writeInfo: logger.info,
    writeWarning: logger.warn,
  };
}

/** Incremental, resumable, rate-limited update of every constituent of `indexName`. */
export function updateIndexDailyCandles(
  indexName: IndexName,
  overrides: Partial<DailyCandleUpdateSettings> = {},
): Promise<DailyCandleUpdateSummary> {
  return runDailyCandleUpdate(createProductionUpdaterDependencies(indexName), buildDailyCandleUpdateSettings(overrides));
}

/** Kept for compatibility; now incremental instead of re-downloading two years every run. */
export function uploadNifty500HistoricalData(overrides: Partial<DailyCandleUpdateSettings> = {}): Promise<DailyCandleUpdateSummary> {
  return updateIndexDailyCandles("NIFTY 500", overrides);
}

/** One-off loader for a single symbol and explicit range. Incomplete (today, pre-close) candles are dropped. */
export async function uploadCandleData(
  exchange: string,
  symboltoken: string,
  interval: string,
  fromdate: string,
  todate: string,
  symbol?: string,
) {
  try {
    if (interval !== DAILY_INTERVAL) {
      throw new AppError("VALIDATION_ERROR", `[VALIDATION_ERROR] daily_candles only stores ${DAILY_INTERVAL} candles.`);
    }
    if (!symbol) {
      const instrument = await searchInstruments({ token: symboltoken }, exchange);
      symbol = instrument[0]?.symbol;
    }
    if (!symbol) {
      throw new AppError("VALIDATION_ERROR", `No instrument found for token ${symboltoken} on exchange ${exchange}.`);
    }

    const historicalCandles = await getHistoricalCandles(exchange, symboltoken, interval, fromdate, todate);
    const cutoffDate = latestCompleteCandleDate(new Date(), config.CANDLE_UPDATE_MARKET_CLOSE_BUFFER_MINUTES);
    const completeCandles = candlesWithinDates(historicalCandles.data ?? [], fromdate.slice(0, 10), cutoffDate);
    if (completeCandles.length === 0) {
      throw new AppError(
        "NO_DATA",
        `[NO_DATA] No complete candle data for ${exchange} | ${symboltoken} | ${interval} | ${fromdate} | ${todate}`,
      );
    }
    return await saveDailyCandles(exchange, symboltoken, symbol, completeCandles);
  } catch (error) {
    const appError = toAppError(error);
    logger.error(appError.message, appError.code);
    throw appError;
  }
}
