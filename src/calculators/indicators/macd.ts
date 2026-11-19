
import { AppError, toAppError } from '../../core/errors.js';
import fromToDate from '../../util/fromToDate.js';
import { getDailyCandles, toAngelOneCandles } from '../../candles/candles.repository.js';
import { AngelOneCandle } from '../../types/angelone.js';
import { readValidatedCloses } from './candle-validation.js';
import { assertDailyInterval } from './indicator-window.js';

export default async function MACD(
    exchange: string,
    symboltoken: string,
    interval: string,
    fastPeriod: number = 12,
    slowPeriod: number = 26,
    signalPeriod: number = 9
) {
    try {
        if (!exchange || !symboltoken || !interval) {
            throw new AppError(
                'VALIDATION_ERROR',
                'Exchange, symbol token and interval are required.'
            );
        }

        assertDailyInterval(interval);

        if (
            !Number.isSafeInteger(fastPeriod) ||
            !Number.isSafeInteger(slowPeriod) ||
            !Number.isSafeInteger(signalPeriod) ||
            fastPeriod <= 0 ||
            slowPeriod <= 0 ||
            signalPeriod <= 0
        ) {
            throw new AppError(
                'VALIDATION_ERROR',
                'All MACD periods must be positive safe integers.'
            );
        }

        if (fastPeriod >= slowPeriod) {
            throw new AppError(
                'VALIDATION_ERROR',
                'Fast EMA period must be smaller than slow EMA period.'
            );
        }

        const candleCount = slowPeriod * 5 + signalPeriod;

        if (!Number.isSafeInteger(candleCount)) {
            throw new AppError(
                'VALIDATION_ERROR',
                'MACD historical period is too large.'
            );
        }

        const currentDate = new Date().toLocaleDateString('en-CA', {
            timeZone: 'Asia/Kolkata'
        });

        const MACD_date = fromToDate(
            currentDate,
            'backward',
            candleCount
        );

        const Candle = await getDailyCandles(
            exchange,
            symboltoken,
            MACD_date.fromdate,
            MACD_date.todate
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

        const result = getMACD(
            data,
            fastPeriod,
            slowPeriod,
            signalPeriod
        );

        return result;

    } catch (error) {
        throw toAppError(error);
    }
}


export function getMACD(
    Candle: AngelOneCandle[],
    fastPeriod: number = 12,
    slowPeriod: number = 26,
    signalPeriod: number = 9
) {

    if (
        !Number.isSafeInteger(fastPeriod) ||
        !Number.isSafeInteger(slowPeriod) ||
        !Number.isSafeInteger(signalPeriod) ||
        fastPeriod <= 0 ||
        slowPeriod <= 0 ||
        signalPeriod <= 0
    ) {
        throw new AppError(
            'VALIDATION_ERROR',
            'All MACD periods must be positive safe integers.'
        );
    }

    if (fastPeriod >= slowPeriod) {
        throw new AppError(
            'VALIDATION_ERROR',
            'Fast EMA period must be smaller than slow EMA period.'
        );
    }

    const minimumCandles = slowPeriod + signalPeriod - 1;

    if (!Array.isArray(Candle) || Candle.length < minimumCandles) {
        throw new AppError(
            'NO_DATA',
            `At least ${minimumCandles} candles are required.`
        );
    }

    const closes = readValidatedCloses(Candle);

    function calculateEMA(values: number[], period: number): number[] {
        const emaValues = new Array(values.length).fill(NaN);

        let ema = values
            .slice(0, period)
            .reduce((sum, value) => sum + value, 0) / period;

        emaValues[period - 1] = ema;

        const multiplier = 2 / (period + 1);

        for (let i = period; i < values.length; i++) {
            ema = values[i] * multiplier + ema * (1 - multiplier);

            emaValues[i] = ema;
        }

        return emaValues;
    }

    const fastEMA = calculateEMA(closes, fastPeriod);
    const slowEMA = calculateEMA(closes, slowPeriod);

    const macdValues: number[] = [];

    for (let i = slowPeriod - 1; i < closes.length; i++) {
        macdValues.push(fastEMA[i] - slowEMA[i]);
    }

    const signalValues = calculateEMA(macdValues, signalPeriod);

    const latestMACD = macdValues[macdValues.length - 1];
    const latestSignal = signalValues[signalValues.length - 1];

    if (
        !Number.isFinite(latestMACD) ||
        !Number.isFinite(latestSignal)
    ) {
        throw new AppError(
            'INTERNAL_ERROR',
            'Unable to calculate valid MACD values.'
        );
    }

    const histogram = latestMACD - latestSignal;

    return {
        indicator: 'MACD',
        fastPeriod,
        slowPeriod,
        signalPeriod,
        source: 'close',
        'macd line': Number(latestMACD.toFixed(2)),
        'signal line': Number(latestSignal.toFixed(2)),
        histogram: Number(histogram.toFixed(2)),
        timestamp: Candle[Candle.length - 1][0]
    };
}