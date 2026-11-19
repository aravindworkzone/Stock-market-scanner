import { AppError } from '../../core/errors.js';
import { addCalendarDays } from '../../util/ist.js';
import type { AngelOneCandle } from '../../types/angelone.js';

/** The only interval the DB-backed indicator tools can serve: daily_candles stores daily bars. */
export const DAILY_INTERVAL = 'ONE_DAY';

/**
 * DB-backed indicators are computed from stored daily candles. Any other interval
 * would silently return daily values labeled as intraday, so reject it.
 */
export function assertDailyInterval(interval: string): void {
    if (interval !== DAILY_INTERVAL) {
        throw new AppError(
            'VALIDATION_ERROR',
            `[VALIDATION_ERROR] Interval ${interval} is not supported: this indicator is computed from stored daily candles. Use ONE_DAY, or get_historical_candles for intraday data.`
        );
    }
}

/**
 * Trading days fetched for warm-up-dependent indicators (RSI/ATR/volume in
 * calculate_all_indicators, and calculate_rsi), so both tools return the same RSI.
 * Never fewer than 365 trading days, which also covers the 52-week window.
 */
export function indicatorWarmupTradingDays(period: number): number {
    return Math.max(period * 5, 365);
}

/** 52 weeks = 364 calendar days, the same window as the get_52_week_high_low tool. */
export const WEEK_52_CALENDAR_DAYS = 364;

/** First calendar date (YYYY-MM-DD, IST) of the 52-week window ending on `currentDate`. */
export function week52WindowStartDate(currentDate: string): string {
    return addCalendarDays(currentDate, -WEEK_52_CALENDAR_DAYS);
}

/** Candles dated on or after `startDate` (YYYY-MM-DD). Candle timestamps start with the IST date. */
export function candlesOnOrAfter(candles: AngelOneCandle[], startDate: string): AngelOneCandle[] {
    return candles.filter((candle) => String(candle[0]).slice(0, 10) >= startDate);
}
