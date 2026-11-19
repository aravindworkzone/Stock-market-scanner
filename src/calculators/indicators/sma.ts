
import { AngelOneCandle } from '../../types/angelone.js';
import { readValidatedCloses } from './candle-validation.js';
import { AppError, toAppError } from '../../core/errors.js';
import { getDailyCandles, toAngelOneCandles } from '../../candles/candles.repository.js';
import { Direction } from '../../types/indices.js';
import fromToDate from '../../util/fromToDate.js';
import { assertDailyInterval } from './indicator-window.js';

export async function SMA(
    exchange: string,
    symboltoken: string,
    interval: string,
    period: number,
    date: string,
    direction: Direction
) {
    try {
        if (!date) {
            throw new AppError('VALIDATION_ERROR', 'Date is required.');
        }

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

        if (!['forward', 'backward'].includes(direction)) {
            throw new AppError('VALIDATION_ERROR', 'Invalid direction.');
        }

        assertDailyInterval(interval);

        // Parse as UTC so toISOString() round-trips to the same calendar date
        const parsedDate = new Date(`${date}T00:00:00Z`);

        if (
            !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
            Number.isNaN(parsedDate.getTime()) ||
            parsedDate.toISOString().slice(0, 10) !== date
        ) {
            throw new AppError('VALIDATION_ERROR', 'Invalid date format. Expected YYYY-MM-DD.');
        }

        const tradingDays = fromToDate(date, direction, period);

        const Candle = await getDailyCandles(
            exchange,
            symboltoken,
            tradingDays.fromdate,
            tradingDays.todate
        );

        if (!Candle || Candle.status !== true) {
            throw new AppError(
                'DATABASE_ERROR',
                `Unable to fetch daily candles: ${Candle?.message}`
            );
        }

        if (!Array.isArray(Candle.data) || Candle.data.length === 0) {
            throw new AppError(
                'NO_DATA',
                'No candle data available for the given parameters.'
            );
        }

        const data: AngelOneCandle[] = toAngelOneCandles(Candle.data);

        const result = getSMA(data, period);

        return result;

    } catch (error) {
        throw toAppError(error);
    }
}


export function getSMA(Candle: AngelOneCandle[], period: number) {

    if (!Number.isSafeInteger(period) || period <= 0) {
        throw new AppError(
            'VALIDATION_ERROR',
            'Period must be a positive safe integer.'
        );
    }

    if (!Array.isArray(Candle) || Candle.length < period) {
        throw new AppError(
            'NO_DATA',
            `Insufficient candles. Required: ${period}, Available: ${Candle?.length ?? 0}.`
        );
    }

    const closes = readValidatedCloses(Candle);

    const latestCloses = closes.slice(-period);

    const latestSMA = latestCloses.reduce((sum, close) => sum + close, 0) / period;

    return {
        indicator: 'SMA',
        period,
        source: 'close',
        'latest sma': Math.round(latestSMA * 100) / 100,
        timestamp: Candle[Candle.length - 1][0]
    };
}
