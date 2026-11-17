
import tradingDay from './tradingDay.js';
import { Direction } from '../types/indices.js';

export default function fromToDate(
    date: string,
    direction: Direction,
    period: number
) {
    const tradingDays = tradingDay(date, direction, period);

    tradingDays.sort((a, b) => a.localeCompare(b));

    const from = tradingDays[0];
    const to = tradingDays[tradingDays.length - 1];

    return {
        fromdate: from.includes("T")
            ? from.replace("T", " ").slice(0, 16)
            : `${from} 00:00`,

        todate: to.includes("T")
            ? to.replace("T", " ").slice(0, 16)
            : `${to} 15:30`
    };
}
