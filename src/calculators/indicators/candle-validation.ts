import { AppError } from '../../core/errors.js';
import type { AngelOneCandle } from '../../types/angelone.js';

/**
 * Shared candle validation for the pure indicator functions. Each reader validates
 * the fields it needs, then checks that timestamps strictly ascend (same order and
 * messages as the per-indicator copies it replaced).
 */

export interface HighLowCloseCandle {
    high: number;
    low: number;
    close: number;
    timestamp: string;
}

function assertCandleShape(candle: unknown, minimumLength: number): asserts candle is AngelOneCandle {
    if (!Array.isArray(candle) || candle.length < minimumLength) {
        throw new AppError('VALIDATION_ERROR', 'Invalid candle structure.');
    }
}

export function assertAscendingTimestamps(candles: AngelOneCandle[]): void {
    for (let candleIndex = 1; candleIndex < candles.length; candleIndex++) {
        const previousTime = new Date(candles[candleIndex - 1][0]).getTime();
        const currentTime = new Date(candles[candleIndex][0]).getTime();

        if (!Number.isFinite(previousTime) || !Number.isFinite(currentTime) || currentTime <= previousTime) {
            throw new AppError('VALIDATION_ERROR', 'Candles must be in valid chronological ascending order.');
        }
    }
}

/** Positive finite closes, in order. */
export function readValidatedCloses(candles: AngelOneCandle[]): number[] {
    const closes = candles.map((candle) => {
        assertCandleShape(candle, 5);
        const close = Number(candle[4]);
        if (!Number.isFinite(close) || close <= 0) {
            throw new AppError('VALIDATION_ERROR', 'Invalid candle close price.');
        }
        return close;
    });
    assertAscendingTimestamps(candles);
    return closes;
}

/** Positive high/low/close with low <= close <= high. */
export function readValidatedHighLowClose(candles: AngelOneCandle[]): HighLowCloseCandle[] {
    const parsedCandles = candles.map((candle) => {
        assertCandleShape(candle, 5);
        const high = Number(candle[2]);
        const low = Number(candle[3]);
        const close = Number(candle[4]);

        if (
            !Number.isFinite(high) ||
            !Number.isFinite(low) ||
            !Number.isFinite(close) ||
            high <= 0 ||
            low <= 0 ||
            close <= 0 ||
            high < low ||
            close > high ||
            close < low
        ) {
            throw new AppError('VALIDATION_ERROR', 'Invalid candle OHLC values.');
        }

        return { high, low, close, timestamp: String(candle[0]) };
    });
    assertAscendingTimestamps(candles);
    return parsedCandles;
}

/** Non-negative integer volumes. */
export function readValidatedVolumes(candles: AngelOneCandle[]): number[] {
    const volumes = candles.map((candle) => {
        assertCandleShape(candle, 6);
        const volume = Number(candle[5]);
        if (!Number.isSafeInteger(volume) || volume < 0) {
            throw new AppError('VALIDATION_ERROR', 'Invalid candle volume.');
        }
        return volume;
    });
    assertAscendingTimestamps(candles);
    return volumes;
}
