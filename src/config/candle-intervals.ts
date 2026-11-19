/**
 * Candle intervals accepted by the tool schemas. Angel One's official list is UNKNOWN
 * (audit/REPORT.md A5: the SDK only shows ONE_MINUTE and ONE_HOUR); this is the list
 * the project has always used. DB-backed indicator tools accept only ONE_DAY at runtime.
 */
export const CANDLE_INTERVALS = [
    "ONE_MINUTE",
    "THREE_MINUTE",
    "FIVE_MINUTE",
    "TEN_MINUTE",
    "FIFTEEN_MINUTE",
    "THIRTY_MINUTE",
    "ONE_HOUR",
    "ONE_DAY",
] as const;

export type CandleInterval = (typeof CANDLE_INTERVALS)[number];
