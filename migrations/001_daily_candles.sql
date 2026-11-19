-- 001_daily_candles.sql
--
-- Documents the daily_candles table this project reads and writes
-- (src/candles/candles.repository.ts).
--
-- IMPORTANT: this file was written from the application's SQL, not exported from the
-- live Neon database; the live column types and any extra indexes are UNKNOWN.
-- Before applying it anywhere, compare it with the live table:
--     \d+ daily_candles
-- Every statement is idempotent (IF NOT EXISTS), so applying it to a database that
-- already has the table is a no-op for existing objects.

CREATE TABLE IF NOT EXISTS daily_candles (
    -- Returned by the upsert (RETURNING id); exact type in the live DB is UNKNOWN.
    id            BIGSERIAL PRIMARY KEY,
    exchange      TEXT        NOT NULL,          -- e.g. 'NSE'
    symbol_token  TEXT        NOT NULL,          -- Angel One instrument token
    symbol        TEXT        NOT NULL,          -- trading symbol, e.g. 'SBIN-EQ'
    candle_date   DATE        NOT NULL,          -- IST trading date of the daily candle
    open          NUMERIC     NOT NULL CHECK (open  > 0),
    high          NUMERIC     NOT NULL CHECK (high  > 0),
    low           NUMERIC     NOT NULL CHECK (low   > 0),
    close         NUMERIC     NOT NULL CHECK (close > 0),
    volume        BIGINT      NOT NULL CHECK (volume >= 0),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Required by saveDailyCandles: ON CONFLICT (exchange, symbol_token, candle_date).
-- Also serves getDailyCandles (range scan per symbol) and getLatestCandleDates
-- (MAX(candle_date) per symbol).
CREATE UNIQUE INDEX IF NOT EXISTS daily_candles_exchange_token_date_key
    ON daily_candles (exchange, symbol_token, candle_date);

-- Freshness checks across all symbols for a given date.
CREATE INDEX IF NOT EXISTS daily_candles_candle_date_idx
    ON daily_candles (candle_date);
