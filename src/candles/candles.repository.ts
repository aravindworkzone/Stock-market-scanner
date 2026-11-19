import { Neon } from "../database/index.js";
import { AppError } from "../core/errors.js";
import { logger } from "../core/logger.js";
import type { AngelOneCandle } from "../types/angelone.js";

interface DailyCandleRecord {
  exchange: string;
  symbol_token: string;
  symbol: string;
  candle_date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const BATCH_SIZE = 500;

/** Tagged-template SQL client (Neon in production, a fake in tests). */
export type SqlClient = (templateStrings: TemplateStringsArray, ...templateValues: unknown[]) => Promise<Record<string, unknown>[]>;

const defaultSqlClient = Neon as unknown as SqlClient;

/** candle_date comes back from Neon as a Date (or a string from fakes); normalise to YYYY-MM-DD in IST. */
export function normalizeCandleDate(rawDate: unknown): string {
  return rawDate instanceof Date
    ? rawDate.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" })
    : String(rawDate).slice(0, 10);
}

/**
 * Last stored candle_date per symbol token (tokens with no rows are absent from the map).
 * Read-only.
 */
export async function getLatestCandleDates(
  exchange: string,
  symbolTokens: string[],
  sqlClient: SqlClient = defaultSqlClient,
): Promise<Map<string, string>> {
  if (symbolTokens.length === 0) {
    return new Map();
  }
  try {
    const latestRows = await sqlClient`
      SELECT symbol_token, MAX(candle_date) AS last_candle_date
      FROM daily_candles
      WHERE exchange = ${exchange}
        AND symbol_token = ANY(${symbolTokens})
      GROUP BY symbol_token
    `;
    return new Map(
      latestRows.map((latestRow) => [String(latestRow.symbol_token), normalizeCandleDate(latestRow.last_candle_date)]),
    );
  } catch (error: unknown) {
    const databaseError = error as { message?: string; code?: string };
    throw new AppError(
      "DATABASE_ERROR",
      `[DATABASE_ERROR] Failed to read latest candle dates: ${databaseError.message ?? "Unknown error"} | Code: ${databaseError.code ?? "N/A"}`,
    );
  }
}

export async function saveDailyCandles(
  exchange: string,
  symbolToken: string,
  symbol: string,
  candles: AngelOneCandle[],
): Promise<number> {
  try {
    if (!candles.length) {
      return 0;
    }

    const records: DailyCandleRecord[] = candles.map((candle) => {
      const [
        timestamp,
        open,
        high,
        low,
        close,
        volume,
      ] = candle;

      const candleDate = String(timestamp).slice(0, 10);

      if (!/^\d{4}-\d{2}-\d{2}$/.test(candleDate)) {
        throw new AppError(
          "VALIDATION_ERROR",
          `Invalid candle date: ${timestamp}`,
        );
      }

      const prices = [
        Number(open),
        Number(high),
        Number(low),
        Number(close),
      ];

      const candleVolume = Number(volume);

      if (
        !prices.every((price) => Number.isFinite(price) && price > 0) ||
        !Number.isSafeInteger(candleVolume) ||
        candleVolume < 0
      ) {
        throw new AppError(
          "VALIDATION_ERROR",
          `Invalid candle values for ${symbol} on ${candleDate}`,
        );
      }

      return {
        exchange,
        symbol_token: symbolToken,
        symbol,
        candle_date: candleDate,
        open: prices[0],
        high: prices[1],
        low: prices[2],
        close: prices[3],
        volume: candleVolume,
      };
    });

    let savedCount = 0;

    for (let i = 0; i < records.length; i += BATCH_SIZE) {
      const batch = records.slice(i, i + BATCH_SIZE);

      const result = await Neon`
        INSERT INTO daily_candles (
          exchange,
          symbol_token,
          symbol,
          candle_date,
          open,
          high,
          low,
          close,
          volume
        )
        SELECT
          candle.exchange,
          candle.symbol_token,
          candle.symbol,
          candle.candle_date,
          candle.open,
          candle.high,
          candle.low,
          candle.close,
          candle.volume
        FROM jsonb_to_recordset(
          ${JSON.stringify(batch)}::jsonb
        ) AS candle (
          exchange TEXT,
          symbol_token TEXT,
          symbol TEXT,
          candle_date DATE,
          open NUMERIC,
          high NUMERIC,
          low NUMERIC,
          close NUMERIC,
          volume BIGINT
        )
        ON CONFLICT (
          exchange,
          symbol_token,
          candle_date
        )
        DO UPDATE SET
          symbol = EXCLUDED.symbol,
          open = EXCLUDED.open,
          high = EXCLUDED.high,
          low = EXCLUDED.low,
          close = EXCLUDED.close,
          volume = EXCLUDED.volume,
          updated_at = NOW()
        RETURNING id
      `;

      savedCount += result.length;
    }

    logger.info(
      `Successfully saved ${savedCount} candle records for ${exchange} - ${symbolToken}.`
    );

    return savedCount;

  } catch (error: unknown) {
    if (error instanceof AppError) {
      throw error;
    }

    const dbError = error as {
      message?: string;
      code?: string;
      detail?: string;
    };

    throw new AppError(
      "DATABASE_ERROR",
      `Failed to save daily candles: ${dbError.message ?? "Unknown error"
      } | Code: ${dbError.code ?? "N/A"} | Details: ${dbError.detail ?? "N/A"
      }`,
    );
  }
}

/**
 * Converts daily_candles rows (objects keyed by column name) into
 * AngelOne-style candle tuples: [timestamp, open, high, low, close, volume].
 * candle_date comes back from Neon as a UTC Date, so it is formatted in IST.
 */
export function toAngelOneCandles(
  rows: Record<string, unknown>[],
): AngelOneCandle[] {
  return rows.map((row) => {
    const candleDate = normalizeCandleDate(row.candle_date);

    return [
      `${candleDate}T00:00:00+05:30`,
      Number(row.open),
      Number(row.high),
      Number(row.low),
      Number(row.close),
      Number(row.volume),
    ];
  });
}

export async function getDailyCandles(
  exchange: string,
  symbolToken: string,
  fromdate: string,
  todate: string
) {
  try {
    const candles = await Neon`
      SELECT *
      FROM daily_candles
      WHERE exchange = ${exchange}
        AND symbol_token = ${symbolToken}
        AND candle_date >= ${fromdate}
        AND candle_date <= ${todate}
      ORDER BY candle_date
    `;

    return {status: true, message: "Fetch Scuccessfull", data: candles};
  } catch (error: unknown) {
    const dbError = error as {
      message?: string;
      code?: string;
      detail?: string;
    };

    throw new AppError(
      "DATABASE_ERROR",
      `Failed to retrieve daily candles: ${dbError.message ?? "Unknown error"
      } | Code: ${dbError.code ?? "N/A"} | Details: ${dbError.detail ?? "N/A"
      }`,
    );
  }
}
