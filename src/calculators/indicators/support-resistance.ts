import { AppError, toAppError } from '../../core/errors.js';
import fromToDate from '../../util/fromToDate.js';
import { getDailyCandles, toAngelOneCandles } from '../../candles/candles.repository.js';
import { AngelOneCandle } from '../../types/angelone.js';

export default async function SupportResistance(
    exchange: string,
    symboltoken: string,
    interval: string = 'ONE_DAY',
    lookbackCandles: number = 250,
    leftBars: number = 5,
    rightBars: number = 5,
    tolerancePercent: number = 1
) {
    try {
        if (!exchange || !symboltoken || !interval) {
            throw new AppError(
                'VALIDATION_ERROR',
                'Exchange, symbol token and interval are required.'
            );
        }

        if (
            !Number.isSafeInteger(lookbackCandles) ||
            !Number.isSafeInteger(leftBars) ||
            !Number.isSafeInteger(rightBars) ||
            lookbackCandles <= 0 ||
            leftBars <= 0 ||
            rightBars <= 0
        ) {
            throw new AppError(
                'VALIDATION_ERROR',
                'Lookback, left bars and right bars must be positive safe integers.'
            );
        }

        if (
            !Number.isFinite(tolerancePercent) ||
            tolerancePercent <= 0 ||
            tolerancePercent >= 100
        ) {
            throw new AppError(
                'VALIDATION_ERROR',
                'Tolerance must be between 0 and 100.'
            );
        }

        const candleCount = lookbackCandles;

        const currentDate = new Date().toLocaleDateString('en-CA', {
            timeZone: 'Asia/Kolkata'
        });

        const tradingDays = fromToDate(
            currentDate,
            'backward',
            candleCount
        );

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

        if (!Array.isArray(Candle.data)) {
            throw new AppError(
                'NO_DATA',
                'Invalid historical candle response.'
            );
        }

        const data: AngelOneCandle[] = toAngelOneCandles(Candle.data);

        const result = getSupportResistance(
            data,
            leftBars,
            rightBars,
            tolerancePercent
        );

        return result;

    } catch (error) {
        throw toAppError(error);
    }
}


export function getSupportResistance(
    Candle: AngelOneCandle[],
    leftBars: number = 5,
    rightBars: number = 5,
    tolerancePercent: number = 1
) {

    if (
        !Number.isSafeInteger(leftBars) ||
        !Number.isSafeInteger(rightBars) ||
        leftBars <= 0 ||
        rightBars <= 0
    ) {
        throw new AppError(
            'VALIDATION_ERROR',
            'Left bars and right bars must be positive safe integers.'
        );
    }

    if (
        !Number.isFinite(tolerancePercent) ||
        tolerancePercent <= 0 ||
        tolerancePercent >= 100
    ) {
        throw new AppError(
            'VALIDATION_ERROR',
            'Tolerance must be between 0 and 100.'
        );
    }

    if (
        !Array.isArray(Candle) ||
        Candle.length < leftBars + rightBars + 1
    ) {
        throw new AppError(
            'NO_DATA',
            'Not enough candles available for swing detection.'
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

        return {
            high,
            low,
            close,
            timestamp: candle[0]
        };
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

    const latestClose = candles[candles.length - 1].close;

    type SwingPoint = {
        price: number;
        timestamp: string;
    };

    const swingHighs: SwingPoint[] = [];
    const swingLows: SwingPoint[] = [];

    // Detect swing highs and swing lows
    for (
        let i = leftBars;
        i < candles.length - rightBars;
        i++
    ) {
        const current = candles[i];

        let isSwingHigh = true;
        let isSwingLow = true;

        // Check previous candles
        for (let j = i - leftBars; j < i; j++) {
            if (candles[j].high >= current.high) {
                isSwingHigh = false;
            }

            if (candles[j].low <= current.low) {
                isSwingLow = false;
            }
        }

        // Check following candles
        for (let j = i + 1; j <= i + rightBars; j++) {
            if (candles[j].high > current.high) {
                isSwingHigh = false;
            }

            if (candles[j].low < current.low) {
                isSwingLow = false;
            }
        }

        if (isSwingHigh) {
            swingHighs.push({
                price: current.high,
                timestamp: String(current.timestamp)
            });
        }

        if (isSwingLow) {
            swingLows.push({
                price: current.low,
                timestamp: String(current.timestamp)
            });
        }
    }

    // Group nearby swing points into price zones
    function groupLevels(points: SwingPoint[]) {

        const sortedPoints = [...points].sort(
            (a, b) => a.price - b.price
        );

        const groups: SwingPoint[][] = [];

        for (const point of sortedPoints) {

            const lastGroup = groups[groups.length - 1];

            if (!lastGroup) {
                groups.push([point]);
                continue;
            }

            const averagePrice =
                lastGroup.reduce((sum, item) => sum + item.price, 0) /
                lastGroup.length;

            const difference =
                Math.abs(point.price - averagePrice) / averagePrice * 100;

            if (difference <= tolerancePercent) {
                lastGroup.push(point);
            } else {
                groups.push([point]);
            }
        }

        return groups.map((group) => {

            const averagePrice =
                group.reduce((sum, item) => sum + item.price, 0) /
                group.length;

            const latestTouch = group.reduce((latest, item) =>
                new Date(item.timestamp).getTime() >
                new Date(latest).getTime()
                    ? item.timestamp
                    : latest,
                group[0].timestamp
            );

            return {
                price: Number(averagePrice.toFixed(2)),
                touches: group.length,
                lastTouched: latestTouch
            };
        });
    }

    const resistanceLevels = groupLevels(swingHighs)
        .filter((level) => level.price > latestClose)
        .sort((a, b) => a.price - b.price);

    const supportLevels = groupLevels(swingLows)
        .filter((level) => level.price < latestClose)
        .sort((a, b) => b.price - a.price);

    return {
        indicator: 'SUPPORT_RESISTANCE',
        source: 'daily-swing-high-low',
        latestClose: Number(latestClose.toFixed(2)),
        tolerancePercent,
        swingSettings: {
            leftBars,
            rightBars
        },
        nearestSupport: supportLevels[0] ?? null,
        nearestResistance: resistanceLevels[0] ?? null,
        supportLevels,
        resistanceLevels,
        timestamp: Candle[Candle.length - 1][0]
    };
}