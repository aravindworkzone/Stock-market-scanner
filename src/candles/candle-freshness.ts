import { latestCompleteCandleDate } from "./candle-cutoff.js";
import type { UpdaterStock } from "./daily-candle-updater.js";

export interface CandleFreshnessDependencies {
  listStocks: () => Promise<UpdaterStock[]>;
  getLatestCandleDates: (exchange: string, symbolTokens: string[]) => Promise<Map<string, string>>;
  now: () => Date;
}

export interface CandleFreshnessOptions {
  exchange: string;
  marketCloseBufferMinutes: number;
  staleListLimit: number;
}

export interface StaleSymbol {
  symbol: string;
  symboltoken: string;
  lastCandleDate: string | null;
}

export interface CandleFreshnessReport {
  checkedAt: string;
  /** Latest trading date whose candle should already be stored (today only after 15:30 IST + buffer). */
  expectedLatestCandleDate: string;
  newestCandleDate: string | null;
  oldestLatestCandleDate: string | null;
  totalStocks: number;
  upToDateCount: number;
  staleCount: number;
  missingCount: number;
  staleSymbols: StaleSymbol[];
  staleSymbolsTruncated: boolean;
}

/** Read-only: compares each symbol's last stored candle_date with the expected latest date. */
export async function checkCandleFreshness(
  dependencies: CandleFreshnessDependencies,
  options: CandleFreshnessOptions,
): Promise<CandleFreshnessReport> {
  const checkedAt = dependencies.now();
  const expectedLatestCandleDate = latestCompleteCandleDate(checkedAt, options.marketCloseBufferMinutes);
  const stocks = await dependencies.listStocks();
  const latestCandleDates = await dependencies.getLatestCandleDates(
    options.exchange,
    stocks.map((stock) => stock.symboltoken),
  );

  const staleSymbols: StaleSymbol[] = [];
  let missingCount = 0;
  let newestCandleDate: string | null = null;
  let oldestLatestCandleDate: string | null = null;

  for (const stock of stocks) {
    const lastCandleDate = latestCandleDates.get(stock.symboltoken) ?? null;
    if (lastCandleDate === null) {
      missingCount++;
    } else {
      if (newestCandleDate === null || lastCandleDate > newestCandleDate) newestCandleDate = lastCandleDate;
      if (oldestLatestCandleDate === null || lastCandleDate < oldestLatestCandleDate) oldestLatestCandleDate = lastCandleDate;
    }
    if (lastCandleDate === null || lastCandleDate < expectedLatestCandleDate) {
      staleSymbols.push({ symbol: stock.symbol, symboltoken: stock.symboltoken, lastCandleDate });
    }
  }

  // Oldest data first: the most urgent symbols to refresh.
  staleSymbols.sort((first, second) => (first.lastCandleDate ?? "").localeCompare(second.lastCandleDate ?? ""));

  return {
    checkedAt: checkedAt.toISOString(),
    expectedLatestCandleDate,
    newestCandleDate,
    oldestLatestCandleDate,
    totalStocks: stocks.length,
    upToDateCount: stocks.length - staleSymbols.length,
    staleCount: staleSymbols.length - missingCount,
    missingCount,
    staleSymbols: staleSymbols.slice(0, options.staleListLimit),
    staleSymbolsTruncated: staleSymbols.length > options.staleListLimit,
  };
}
