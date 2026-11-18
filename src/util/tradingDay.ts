import holidays, { specialTradingDays } from '../config/holidays.js';
import { Direction } from '../types/indices.js';

export default function tradingDay(
    date: string,
    direction: Direction,
    nod: number
): string[] {
    if (!date) {
        throw new Error('Date is required');
    }

    if (!['forward', 'backward'].includes(direction)) {
        throw new Error('Invalid direction');
    }

    if (!Number.isInteger(nod) || nod <= 0) {
        throw new Error('Number of days must be positive');
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        throw new Error('Invalid date format : ' + date);
    }

    const currentDate = new Date(`${date}T00:00:00.000Z`);

    if (
        Number.isNaN(currentDate.getTime()) ||
        currentDate.toISOString().slice(0, 10) !== date
    ) {
        throw new Error('Invalid date');
    }

    const tradingDays: string[] = [];

    while (tradingDays.length < nod) {

        const formattedDate = currentDate.toISOString().slice(0, 10);

        const day = currentDate.getUTCDay();

        const isWeekend = day === 0 || day === 6;

        const isHoliday = holidays.includes(formattedDate);

        const isSpecialTradingDay =
            specialTradingDays.includes(formattedDate);

        if (
            (!isWeekend && !isHoliday) ||
            isSpecialTradingDay
        ) {
            tradingDays.push(formattedDate);
        }

        currentDate.setUTCDate(
            currentDate.getUTCDate() +
            (direction === 'forward' ? 1 : -1)
        );
    }

    return tradingDays;
}