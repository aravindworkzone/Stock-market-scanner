
import { AppError, toAppError } from '../../core/errors.js';
import fromToDate from '../../util/fromToDate.js';
import { getDailyCandles, toAngelOneCandles } from '../../candles/candles.repository.js';
import { AngelOneCandle } from '../../types/angelone.js';
import { readValidatedCloses } from './candle-validation.js';
import { assertDailyInterval, indicatorWarmupTradingDays } from './indicator-window.js';

export default async function RSI(
    exchange: string,
    symboltoken: string,
    interval: string,
    period: number
) {
    try {
        if (!exchange || !symboltoken || !interval) {
            throw new AppError(
                'VALIDATION_ERROR',
                'Exchange, symbol token and interval are required.'
            );
        }

        if (!Number.isSafeInteger(period) || period <= 0) {
            throw new AppError(
                'VALIDATION_ERROR',
                'Period must be a positive safe integer.'
            );
        }

        assertDailyInterval(interval);

        // B3: same warm-up window as calculate_all_indicators, so both tools agree.
        const candleCount = indicatorWarmupTradingDays(period);

        if (!Number.isSafeInteger(candleCount)) {
            throw new AppError(
                'VALIDATION_ERROR',
                'Period is too large.'
            );
        }

        const currentDate = new Date().toLocaleDateString('en-CA', {
            timeZone: 'Asia/Kolkata'
        });

        const RSI_date = fromToDate(
            currentDate,
            'backward',
            candleCount
        );

        const Candle = await getDailyCandles(
            exchange,
            symboltoken,
            RSI_date.fromdate,
            RSI_date.todate
        );

        if (!Candle || Candle.status !== true) {
            throw new AppError(
                'DATABASE_ERROR',
                `Unable to fetch daily candles: ${Candle?.message}`
            );
        }

        if (!Array.isArray(Candle.data)) {
            throw new AppError(
                'NO_DATA',
                'Invalid historical candle response.'
            );
        }

        const data: AngelOneCandle[] = toAngelOneCandles(Candle.data);

        const result = getRSI(data, period);

        return result;

    } catch (error) {
        throw toAppError(error);
    }
}


export function getRSI(Candle: AngelOneCandle[], period: number) {

    if (!Number.isSafeInteger(period) || period <= 0) {
        throw new AppError(
            'VALIDATION_ERROR',
            'Period must be a positive safe integer.'
        );
    }

    if (!Array.isArray(Candle) || Candle.length < period + 1) {
        throw new AppError(
            'NO_DATA',
            `At least ${period + 1} candles are required.`
        );
    }

    const closes = readValidatedCloses(Candle);

    let gains = 0;
    let losses = 0;

    for (let i = 1; i <= period; i++) {
        const change = closes[i] - closes[i - 1];

        if (change > 0) {
            gains += change;
        } else {
            losses += Math.abs(change);
        }
    }

    let averageGain = gains / period;
    let averageLoss = losses / period;

    for (let i = period + 1; i < closes.length; i++) {
        const change = closes[i] - closes[i - 1];

        const currentGain = Math.max(change, 0);
        const currentLoss = Math.max(-change, 0);

        averageGain =
            ((averageGain * (period - 1)) + currentGain) / period;

        averageLoss =
            ((averageLoss * (period - 1)) + currentLoss) / period;
    }

    let rsi: number;

    if (averageGain === 0 && averageLoss === 0) {
        rsi = 50;
    } else if (averageLoss === 0) {
        rsi = 100;
    } else if (averageGain === 0) {
        rsi = 0;
    } else {
        const relativeStrength = averageGain / averageLoss;
        rsi = 100 - (100 / (1 + relativeStrength));
    }

    return {
        indicator: 'RSI',
        period,
        source: 'close',
        value: Number(rsi.toFixed(2))
    };
}
