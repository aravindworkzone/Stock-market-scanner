import { AppError, toAppError } from '../../errors.js';
import fromToDate from '../../util/fromToDate.js';
import getHistoricalCandles from '../../angelone/historical-candles.js';
import { AngelOneCandle } from '../../types/angelone.js';

export default async function Week52HighLow(
    exchange: string,
    symboltoken: string
) {
    try {
        if (!exchange || !symboltoken) {
            throw new AppError(
                'VALIDATION_ERROR',
                'Exchange and symbol token are required.'
            );
        }

        const currentDate = new Date().toLocaleDateString('en-CA', {
           timeZone: 'Asia/Kolkata'
        });

        const to = new Date(`${currentDate}T00:00:00.000Z`);
        const from = new Date(to);
        from.setUTCDate(from.getUTCDate() - 364);
        const fromdate = `${from.toISOString().slice(0, 10)} 09:15`;
        const todate = `${currentDate} 15:30`;

        const Candle = await getHistoricalCandles(
            exchange,
            symboltoken,
            'ONE_DAY',
            fromdate,
            todate
        );

        if (!Candle || Candle.status !== true) {
            throw new AppError(
                'BROKER_API_ERROR',
                `Angel One failed: status=${Candle?.status}, code=${Candle?.errorcode}, msg=${Candle?.message}`
            );
        }

        if (!Array.isArray(Candle.data)) {
            throw new AppError(
                'NO_DATA',
                'Invalid historical candle response.'
            );
        }

        const data: AngelOneCandle[] = Candle.data;

        const result = getWeek52HighLow(data);

        return result;

    } catch (error) {
        throw toAppError(error);
    }
}


export function getWeek52HighLow(Candle: AngelOneCandle[]) {

    if (!Array.isArray(Candle) || Candle.length === 0) {
        throw new AppError(
            'NO_DATA',
            'No historical candle data available.'
        );
    }

    // Validate candle structure and OHLC values
    const candles = Candle.map((candle) => {
        if (!Array.isArray(candle) || candle.length < 5) {
            throw new AppError(
                'VALIDATION_ERROR',
                'Invalid candle structure.'
            );
        }

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
            throw new AppError(
                'VALIDATION_ERROR',
                'Invalid candle OHLC values.'
            );
        }

        return { high, low, close };
    });

    // Validate chronological order
    for (let i = 1; i < Candle.length; i++) {
        const previousTime = new Date(Candle[i - 1][0]).getTime();
        const currentTime = new Date(Candle[i][0]).getTime();

        if (
            !Number.isFinite(previousTime) ||
            !Number.isFinite(currentTime) ||
            currentTime <= previousTime
        ) {
            throw new AppError(
                'VALIDATION_ERROR',
                'Candles must be in valid chronological ascending order.'
            );
        }
    }

    // Calculate 52-week high and low
    const high52Week = Math.max(
        ...candles.map((candle) => candle.high)
    );

    const low52Week = Math.min(
        ...candles.map((candle) => candle.low)
    );

    const latestClose = candles[candles.length - 1].close;

    const distanceFromHigh =
        ((latestClose - high52Week) / high52Week) * 100;

    const distanceFromLow =
        ((latestClose - low52Week) / low52Week) * 100;

    return {
        indicator: '52_WEEK_HIGH_LOW',
        source: 'daily-high-low-close',
        '52 week high': Number(high52Week.toFixed(2)),
        '52 week low': Number(low52Week.toFixed(2)),
        'latest close': Number(latestClose.toFixed(2)),
        'distance from high (%)': Number(distanceFromHigh.toFixed(2)),
        'distance from low (%)': Number(distanceFromLow.toFixed(2)),
        timestamp: Candle[Candle.length - 1][0]
    };
}