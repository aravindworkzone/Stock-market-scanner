import tradingDay from "../util/tradingDay.js";
import { addCalendarDays, isAfterMarketCloseIst, istDateString } from "../util/ist.js";

/**
 * Latest trading date whose daily candle is complete at `now`:
 * today (IST) only once it is 15:30 IST plus `marketCloseBufferMinutes`, otherwise the
 * previous day; then rolled back to the most recent trading day (weekends and the
 * holidays in src/config/holidays.ts skipped).
 */
export function latestCompleteCandleDate(now: Date, marketCloseBufferMinutes: number): string {
  const todayIst = istDateString(now);
  const candidateDate = isAfterMarketCloseIst(now, marketCloseBufferMinutes) ? todayIst : addCalendarDays(todayIst, -1);
  return tradingDay(candidateDate, "backward", 1)[0];
}
