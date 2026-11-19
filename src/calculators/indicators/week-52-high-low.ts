import { AppError, toAppError } from '../../core/errors.js';
import fromToDate from '../../util/fromToDate.js';
import { getDailyCandles, toAngelOneCandles } from '../../candles/candles.repository.js';
import { AngelOneCandle } from '../../types/angelone.js';
import { readValidatedHighLowClose } from './candle-validation.js';

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

        const Candle = await getDailyCandles(
            exchange,
            symboltoken,
            fromdate,
            todate
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

    const candles = readValidatedHighLowClose(Candle);

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