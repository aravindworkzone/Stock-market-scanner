/**
 * Incremental daily-candle updater.
 *
 * For each symbol it fetches only the dates after the last stored candle_date (or a
 * bootstrap window for new symbols), up to the latest *complete* trading day:
 * today's candle is never requested or stored before 15:30 IST + a buffer.
 *
 * Resumable: candles are saved after every request range, and the plan is derived
 * from what is already in the database, so re-running after a crash, a rate-limit
 * stop or a Ctrl+C continues where it left off.
 *
 * All I/O is injected so the logic is tested without the broker or the database.
 * The production fetcher goes through call(), i.e. the shared rate limiter and backoff.
 */
import { AppError, toAppError } from "../core/errors.js";
import type { AngelOneCandle } from "../types/angelone.js";
import { addCalendarDays } from "../util/ist.js";
import { latestCompleteCandleDate } from "./candle-cutoff.js";

export interface UpdaterStock {
  symbol: string;
  symboltoken: string;
}

export interface CandleRequestRange {
  fromdate: string;
  todate: string;
}

export interface CandleUpdatePlan {
  symbol: string;
  symboltoken: string;
  lastStoredDate: string | null;
  fromDate: string;
  toDate: string;
  requestRanges: CandleRequestRange[];
}

export interface DailyCandleUpdateSettings {
  exchange: string;
  dryRun: boolean;
  /** Calendar days fetched for a symbol with no stored candles. */
  bootstrapCalendarDays: number;
  /** Max calendar days per getCandleData request. The official per-interval limit is UNKNOWN. */
  maxCalendarDaysPerRequest: number;
  /** Minutes after 15:30 IST before today's candle counts as complete. */
  marketCloseBufferMinutes: number;
  /** Stop the run after this many consecutive RATE_LIMIT_ERROR symbols (already retried by call()). */
  maxConsecutiveRateLimitFailures: number;
}

export interface DailyCandleUpdaterDependencies {
  listStocks: () => Promise<UpdaterStock[]>;
  getLatestCandleDates: (exchange: string, symbolTokens: string[]) => Promise<Map<string, string>>;
  fetchDailyCandles: (exchange: string, symbolToken: string, fromdate: string, todate: string) => Promise<AngelOneCandle[]>;
  saveDailyCandles: (exchange: string, symbolToken: string, symbol: string, candles: AngelOneCandle[]) => Promise<number>;
  now: () => Date;
  writeInfo: (message: string) => void;
  writeWarning: (message: string) => void;
}

export interface FailedSymbol {
  symbol: string;
  symboltoken: string;
  reason: string;
}

export interface DailyCandleUpdateSummary {
  exchange: string;
  dryRun: boolean;
  checkedAt: string;
  cutoffDate: string;
  totalStocks: number;
  upToDateCount: number;
  plannedCount: number;
  updatedCount: number;
  savedCandleCount: number;
  failedStocks: FailedSymbol[];
  stoppedEarly: string | null;
  plans: CandleUpdatePlan[];
}

/** Splits an inclusive date range into consecutive ranges of at most `maxCalendarDays` days. */
export function splitIntoRequestRanges(fromDate: string, toDate: string, maxCalendarDays: number): CandleRequestRange[] {
  if (!Number.isSafeInteger(maxCalendarDays) || maxCalendarDays <= 0) {
    throw new AppError("VALIDATION_ERROR", "[VALIDATION_ERROR] maxCalendarDaysPerRequest must be a positive integer.");
  }
  const requestRanges: CandleRequestRange[] = [];
  let rangeStart = fromDate;
  while (rangeStart <= toDate) {
    const candidateEnd = addCalendarDays(rangeStart, maxCalendarDays - 1);
    const rangeEnd = candidateEnd < toDate ? candidateEnd : toDate;
    requestRanges.push({ fromdate: `${rangeStart} 00:00`, todate: `${rangeEnd} 15:30` });
    rangeStart = addCalendarDays(rangeEnd, 1);
  }
  return requestRanges;
}

/** Plan for one symbol, or null when it is already up to date. */
export function planSymbolUpdate(
  stock: UpdaterStock,
  lastStoredDate: string | undefined,
  cutoffDate: string,
  settings: Pick<DailyCandleUpdateSettings, "bootstrapCalendarDays" | "maxCalendarDaysPerRequest">,
): CandleUpdatePlan | null {
  const fromDate =
    lastStoredDate !== undefined ? addCalendarDays(lastStoredDate, 1) : addCalendarDays(cutoffDate, -settings.bootstrapCalendarDays);
  if (fromDate > cutoffDate) {
    return null;
  }
  return {
    symbol: stock.symbol,
    symboltoken: stock.symboltoken,
    lastStoredDate: lastStoredDate ?? null,
    fromDate,
    toDate: cutoffDate,
    requestRanges: splitIntoRequestRanges(fromDate, cutoffDate, settings.maxCalendarDaysPerRequest),
  };
}

/** Keeps only candles inside [fromDate, toDate] (guards against partial "today" candles and overlap). */
export function candlesWithinDates(candles: AngelOneCandle[], fromDate: string, toDate: string): AngelOneCandle[] {
  return candles.filter((candle) => {
    const candleDate = String(candle[0]).slice(0, 10);
    return candleDate >= fromDate && candleDate <= toDate;
  });
}

export async function runDailyCandleUpdate(
  dependencies: DailyCandleUpdaterDependencies,
  settings: DailyCandleUpdateSettings,
): Promise<DailyCandleUpdateSummary> {
  const checkedAt = dependencies.now();
  const cutoffDate = latestCompleteCandleDate(checkedAt, settings.marketCloseBufferMinutes);
  const stocks = await dependencies.listStocks();
  const latestCandleDates = await dependencies.getLatestCandleDates(
    settings.exchange,
    stocks.map((stock) => stock.symboltoken),
  );

  const plans: CandleUpdatePlan[] = [];
  for (const stock of stocks) {
    const plan = planSymbolUpdate(stock, latestCandleDates.get(stock.symboltoken), cutoffDate, settings);
    if (plan !== null) {
      plans.push(plan);
    }
  }

  const summary: DailyCandleUpdateSummary = {
    exchange: settings.exchange,
    dryRun: settings.dryRun,
    checkedAt: checkedAt.toISOString(),
    cutoffDate,
    totalStocks: stocks.length,
    upToDateCount: stocks.length - plans.length,
    plannedCount: plans.length,
    updatedCount: 0,
    savedCandleCount: 0,
    failedStocks: [],
    stoppedEarly: null,
    plans,
  };

  dependencies.writeInfo(
    `[candles] ${plans.length}/${stocks.length} symbols need candles up to ${cutoffDate}${settings.dryRun ? " (dry run: nothing fetched or saved)" : ""}.`,
  );
  if (settings.dryRun) {
    return summary;
  }

  let consecutiveRateLimitFailures = 0;
  for (const plan of plans) {
    try {
      let symbolSavedCount = 0;
      for (const requestRange of plan.requestRanges) {
        const fetchedCandles = await dependencies.fetchDailyCandles(
          settings.exchange,
          plan.symboltoken,
          requestRange.fromdate,
          requestRange.todate,
        );
        const completeCandles = candlesWithinDates(fetchedCandles, plan.fromDate, plan.toDate);
        if (completeCandles.length > 0) {
          symbolSavedCount += await dependencies.saveDailyCandles(settings.exchange, plan.symboltoken, plan.symbol, completeCandles);
        }
      }
      summary.updatedCount++;
      summary.savedCandleCount += symbolSavedCount;
      consecutiveRateLimitFailures = 0;
    } catch (error: unknown) {
      const appError = toAppError(error);
      summary.failedStocks.push({ symbol: plan.symbol, symboltoken: plan.symboltoken, reason: appError.message });
      dependencies.writeWarning(`[candles] ${plan.symbol} failed: ${appError.message}`);

      consecutiveRateLimitFailures = appError.code === "RATE_LIMIT_ERROR" ? consecutiveRateLimitFailures + 1 : 0;
      if (consecutiveRateLimitFailures >= settings.maxConsecutiveRateLimitFailures) {
        summary.stoppedEarly = `Stopped after ${consecutiveRateLimitFailures} consecutive rate-limited symbols; re-run later to resume.`;
        dependencies.writeWarning(`[candles] ${summary.stoppedEarly}`);
        break;
      }
    }
  }

  dependencies.writeInfo(
    `[candles] Updated ${summary.updatedCount} symbols, saved ${summary.savedCandleCount} candles, ${summary.failedStocks.length} failed.`,
  );
  return summary;
}
