/**
 * India Standard Time helpers. IST is UTC+05:30 with no daylight saving, so a fixed
 * offset is exact.
 */
const IST_OFFSET_MINUTES = 5 * 60 + 30;
const MILLISECONDS_PER_MINUTE = 60_000;
const MILLISECONDS_PER_DAY = 24 * 60 * MILLISECONDS_PER_MINUTE;

/** NSE cash market close, minutes after IST midnight (15:30). */
export const MARKET_CLOSE_MINUTES_IST = 15 * 60 + 30;

/** Calendar date in IST as YYYY-MM-DD. */
export function istDateString(moment: Date): string {
  return new Date(moment.getTime() + IST_OFFSET_MINUTES * MILLISECONDS_PER_MINUTE).toISOString().slice(0, 10);
}

/** Minutes since IST midnight. */
export function istMinutesOfDay(moment: Date): number {
  const istMilliseconds = moment.getTime() + IST_OFFSET_MINUTES * MILLISECONDS_PER_MINUTE;
  return Math.floor((((istMilliseconds % MILLISECONDS_PER_DAY) + MILLISECONDS_PER_DAY) % MILLISECONDS_PER_DAY) / MILLISECONDS_PER_MINUTE);
}

/** Adds whole days to a YYYY-MM-DD date (pure calendar arithmetic). */
export function addCalendarDays(dateString: string, dayCount: number): string {
  const shiftedDate = new Date(`${dateString}T00:00:00.000Z`);
  shiftedDate.setUTCDate(shiftedDate.getUTCDate() + dayCount);
  return shiftedDate.toISOString().slice(0, 10);
}

/** True once IST time is at or after 15:30 plus `bufferMinutes`. */
export function isAfterMarketCloseIst(moment: Date, bufferMinutes: number): boolean {
  return istMinutesOfDay(moment) >= MARKET_CLOSE_MINUTES_IST + bufferMinutes;
}
