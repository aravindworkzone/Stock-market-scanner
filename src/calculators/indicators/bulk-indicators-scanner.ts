import { CONSTITUENT_CONFIG } from '../../indices/index.config.js';
import indexStock from '../../indices/index-stock.service.js';
import { AppError, toAppError } from '../../core/errors.js';
import { logger } from '../../core/logger.js';
import AllIndicators from './all-indicators.js';

export type ScannerIndexName = keyof typeof CONSTITUENT_CONFIG.NSE.indexFiles;

type AllIndicatorsResult = Awaited<ReturnType<typeof AllIndicators>>;

export interface BulkScannerOptions {
    exchange?: string;
    interval?: string;
    period?: number;
    concurrency?: number;
}

export interface StockIndicatorResult {
    symbol: string;
    companyName: string;
    industry: string;
    symboltoken: string;
    indicators: AllIndicatorsResult;
}

export interface FailedStock {
    symbol: string;
    symboltoken: string;
    reason: string;
}

export interface BulkScannerResult {
    index: ScannerIndexName;
    scannedAt: string;
    totalStocks: number;
    successCount: number;
    failedCount: number;
    results: StockIndicatorResult[];
    failedStocks: FailedStock[];
}

export interface StockIndicatorSummary {
    symbol: string;
    symboltoken: string;
    industry: string;
    close: number;
    sma10: number;
    sma20: number;
    sma50: number;
    sma200: number;
    ema10: number;
    ema20: number;
    ema50: number;
    ema200: number;
    rsi: number;
    macdLine: number;
    macdSignal: number;
    macdHistogram: number;
    atr: number;
    relativeVolume: number | null;
    week52High: number;
    week52Low: number;
    distanceFrom52wHighPct: number;
    distanceFrom52wLowPct: number;
    nearestSupport: number | null;
    nearestResistance: number | null;
}

const CACHE_TTL_MS = 15 * 60 * 1000;
const scanCache = new Map<string, { expiresAt: number; result: Promise<BulkScannerResult> }>();

export async function bulkIndicatorScanner(
    index: ScannerIndexName,
    options: BulkScannerOptions = {}
): Promise<BulkScannerResult> {
    const {
        exchange = 'NSE',
        interval = 'ONE_DAY',
        period = 14,
        concurrency = 10
    } = options;

    try {
        if (!(index in CONSTITUENT_CONFIG.NSE.indexFiles)) {
            throw new AppError('VALIDATION_ERROR', `Unsupported index: ${index}`);
        }

        if (!Number.isSafeInteger(concurrency) || concurrency <= 0) {
            throw new AppError('VALIDATION_ERROR', 'Concurrency must be a positive safe integer.');
        }

        const stocks = await indexStock(index);

        if (stocks.length === 0) {
            throw new AppError('NO_DATA', `No stocks found for index ${index}.`);
        }

        logger.info(`Bulk indicator scan started for ${index}: ${stocks.length} stocks.`);

        const results: StockIndicatorResult[] = [];
        const failedStocks: FailedStock[] = [];

        let next = 0;

        const worker = async () => {
            while (next < stocks.length) {
                const stock = stocks[next++];

                try {
                    const indicators = await AllIndicators(
                        exchange,
                        stock.symboltoken,
                        interval,
                        period
                    );

                    results.push({
                        symbol: stock.symbol,
                        companyName: stock.companyName,
                        industry: stock.industry,
                        symboltoken: stock.symboltoken,
                        indicators
                    });
                } catch (error) {
                    const reason = toAppError(error).message;

                    failedStocks.push({
                        symbol: stock.symbol,
                        symboltoken: stock.symboltoken,
                        reason
                    });

                    logger.error(`Indicator scan failed for ${stock.symbol}: ${reason}`);
                }
            }
        };

        await Promise.all(
            Array.from({ length: Math.min(concurrency, stocks.length) }, worker)
        );

        results.sort((a, b) => a.symbol.localeCompare(b.symbol));
        failedStocks.sort((a, b) => a.symbol.localeCompare(b.symbol));

        logger.info(
            `Bulk indicator scan finished for ${index}: ${results.length} succeeded, ${failedStocks.length} failed.`
        );

        return {
            index,
            scannedAt: new Date().toISOString(),
            totalStocks: stocks.length,
            successCount: results.length,
            failedCount: failedStocks.length,
            results,
            failedStocks
        };

    } catch (error) {
        const appError = toAppError(error);
        logger.error(appError.message, appError.code);
        throw appError;
    }
}

export function cachedBulkIndicatorScanner(
    index: ScannerIndexName,
    options: BulkScannerOptions = {}
): Promise<BulkScannerResult> {
    const key = JSON.stringify([index, options.exchange, options.interval, options.period]);
    const cached = scanCache.get(key);

    if (cached && cached.expiresAt > Date.now()) {
        return cached.result;
    }

    const result = bulkIndicatorScanner(index, options);
    scanCache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, result });

    result.catch(() => scanCache.delete(key));

    return result;
}

export function summarizeStock(stock: StockIndicatorResult): StockIndicatorSummary {
    const i = stock.indicators;

    return {
        symbol: stock.symbol,
        symboltoken: stock.symboltoken,
        industry: stock.industry,
        close: i.Week52HighLow['latest close'],
        sma10: i.SMA[10]['latest sma'],
        sma20: i.SMA[20]['latest sma'],
        sma50: i.SMA[50]['latest sma'],
        sma200: i.SMA[200]['latest sma'],
        ema10: i.EMA[10]['latest ema'],
        ema20: i.EMA[20]['latest ema'],
        ema50: i.EMA[50]['latest ema'],
        ema200: i.EMA[200]['latest ema'],
        rsi: i.RSI.value,
        macdLine: i.MACD['macd line'],
        macdSignal: i.MACD['signal line'],
        macdHistogram: i.MACD.histogram,
        atr: i.ATR.value,
        relativeVolume: i.VolumeAverage['relative volume'],
        week52High: i.Week52HighLow['52 week high'],
        week52Low: i.Week52HighLow['52 week low'],
        distanceFrom52wHighPct: i.Week52HighLow['distance from high (%)'],
        distanceFrom52wLowPct: i.Week52HighLow['distance from low (%)'],
        nearestSupport: i.SupportResistance.nearestSupport?.price ?? null,
        nearestResistance: i.SupportResistance.nearestResistance?.price ?? null
    };
}
