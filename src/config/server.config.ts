import { z } from "zod";
import { CANDLE_INTERVALS } from "./candle-intervals.js";

export default {
    health: {
        title: "Ping",
        description:
            "Health check for the s-market-scanner MCP server. Call this first to verify the server is online. Takes no arguments. Returns the text 'pong' if the server is responding. Does not fetch any market data.",
        inputSchema: {},
        annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false,
        }
    },
    search_instruments: {
    title: "Search Instruments",
    description:
        "Search the local Angel One instrument master on NSE or BSE by company name, trading symbol, or exact token. At least one of name, symbol, or token is required; if you give several, all must match. Name and symbol are case-insensitive, ignore spaces ('HDFC BANK' matches 'HDFCBANK'), and allow partial matches. Token must match exactly. Returns up to 'limit' matching instruments plus the total match count, so use a specific query. Call this first to get the exact symbol and symboltoken for other market tools. Read-only; does not place trades or fetch live prices.",
    inputSchema: {
        query: z.object({
        name: z.string().trim().min(1).max(100).optional()
            .describe("Company name, partial allowed, e.g. HDFC BANK"),
        symbol: z.string().trim().min(1).max(100).optional()
            .describe("Trading symbol, partial allowed, e.g. HDFCBANK-EQ"),
        token: z.string().trim().min(1).max(20).optional()
            .describe("Exact Angel One symbol token, e.g. 1333"),
        }),
        exchange: z.enum(["NSE", "BSE"])
        .describe("Exchange to search: NSE or BSE"),
        limit: z.number().int().min(1).max(100).default(20)
        .describe("Maximum results to return, default 20"),
    },
    annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
    },
    },
    get_historical_candles: {
        title: "Get Historical Candles",
        description:
            "Fetch historical OHLCV candles (open, high, low, close, volume) for one instrument from Angel One SmartAPI. Use search_instruments first to get the exact symboltoken. Returns a list of candles for the requested interval and date range. Maximum range per request depends on the interval, so split long ranges into several calls. Read-only; does not place trades.",
        inputSchema: {
            exchange: z.enum(["NSE", "BSE"])
                .describe("Exchange of the instrument: NSE or BSE"),
            symboltoken: z.string().trim().min(1)
                .describe("Angel One instrument token from search_instruments, e.g. 1333"),
            interval: z.enum(CANDLE_INTERVALS).describe("Candle size, e.g. FIVE_MINUTE or ONE_DAY"),
            fromdate: z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
                .describe("Start date/time as 'YYYY-MM-DD HH:mm', e.g. 2025-01-10 00:00"),
            todate: z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
                .describe("End date/time as 'YYYY-MM-DD HH:mm', e.g. 2025-01-10 15:30"),
        },
        annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: true,
        },
    },
    get_index_stocks: {
        title: "Get Index Stocks",
        description:
            "List all stocks in an NSE index (NIFTY 50 or NIFTY 500), matched to Angel One instruments. Use this to get the full constituent list with symbol tokens in one call, then pass a symboltoken to get_historical_candles. Returns index name, total count, and for each stock the company name, trading symbol, series, ISIN, and Angel One symbol token. Constituents come from NSE's published index CSV; tokens come from the local instrument master. Read-only; does not place trades. NIFTY 500 returns a large list.",
        inputSchema: {
            indexName: z.enum(["NIFTY 50", "NIFTY 500"])
                .describe("NSE index to list: 'NIFTY 50' or 'NIFTY 500'"),
        },
        annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: true,
        },
    },
    calculate_sma: {
        title: "Calculate SMA",
        description:
            "Calculate the Simple Moving Average (SMA) of closing prices for one instrument. Uses 'period' trading days (weekends and holidays skipped, the given date itself included when it is a trading day) taken backward or forward from 'date', reads stored daily candles, and returns the latest SMA value. Only ONE_DAY is supported (computed from stored daily candles); other intervals are rejected. Get symboltoken from search_instruments first. Fails if fewer than 'period' candles are available. Read-only; does not place trades.",
        inputSchema: {
            exchange: z.enum(["NSE", "BSE"])
                .describe("Exchange of the instrument: NSE or BSE"),
            symboltoken: z.string().trim().min(1)
                .describe("Angel One instrument token from search_instruments, e.g. 1333"),
            interval: z.enum(CANDLE_INTERVALS).describe("Candle size; only ONE_DAY is supported for stored-candle indicators"),
            period: z.number().int().min(1).max(500)
                .describe("SMA period, e.g. 20 for a 20-candle SMA"),
            date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
                .describe("Anchor date as 'YYYY-MM-DD', e.g. 2025-01-10"),
            direction: z.enum(["forward", "backward"])
                .describe("'backward' uses trading days before the date (normal for SMA); 'forward' uses days after"),
        },
        annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: true,
        },
    },
    calculate_ema: {
    title: "Calculate EMA",
    description:
        "Calculate the latest Exponential Moving Average (EMA) of closing prices for one instrument, as of the most recent completed trading day. Reads a warm-up window of period x 5 trading days of stored daily candles, seeds with the SMA of the first 'period' candles, then applies smoothing 2/(period+1). Returns only the latest EMA value. Only ONE_DAY is supported (computed from stored daily candles); other intervals are rejected. Get symboltoken from search_instruments first. Read-only; does not place trades.",
    inputSchema: {
        exchange: z.enum(["NSE", "BSE"])
        .describe("Exchange of the instrument: NSE or BSE"),
        symboltoken: z.string().trim().min(1)
        .describe("Angel One instrument token from search_instruments, e.g. 1333"),
        interval: z.enum(CANDLE_INTERVALS).describe("Candle size; only ONE_DAY is supported for stored-candle indicators"),
        period: z.number().int().min(1).max(200)
        .describe("EMA period, e.g. 20 for a 20-candle EMA"),
    },
    annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
    },
    },
    get_profile: {
  title: "Get Profile",
  description:
    "Fetch the logged-in Angel One account's profile: client code, name, email, mobile number, and enabled exchanges and products. Use to confirm which account the server is connected to. Takes no arguments. Contains personal data, so do not repeat it unless the user asks. Read-only; does not place trades.",
  inputSchema: {},
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },

    get_funds_and_margin: {
    title: "Get Funds and Margin",
    description:
        "Fetch the account's RMS limits: available cash, utilised margin, net balance, and related funds data. Use before judging how much capital is free. Takes no arguments. Read-only; does not place trades.",
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },

    get_holdings: {
    title: "Get Holdings",
    description:
        "Fetch the list of long-term delivery holdings (stocks held in demat) with quantity, average price, and last traded price for each. Use for 'what do I own'. For portfolio totals and overall P&L, use get_all_holdings instead. Takes no arguments. Read-only; does not place trades.",
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },

    get_all_holdings: {
    title: "Get All Holdings",
    description:
        "Fetch holdings together with portfolio-level totals: total invested value, current value, and overall profit and loss. Use for a full portfolio summary. For only the stock list, use get_holdings. Takes no arguments. Read-only; does not place trades.",
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },

    get_positions: {
    title: "Get Positions",
    description:
        "Fetch today's open and closed trading positions (intraday and carry-forward) with quantity, buy/sell values, and P&L per position. Use for 'what am I trading right now'. Takes no arguments. Read-only; does not place trades or square off positions.",
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    
    calculate_rsi: {
    title: "Calculate RSI",
    description:
        "Calculate the latest Relative Strength Index (RSI) of closing prices for one instrument, as of the most recent completed trading day. Uses Wilder's smoothing over a warm-up window of max(period x 5, 365) trading days of stored daily candles, the same window as calculate_all_indicators, so both tools return the same RSI. Returns a value from 0 to 100 (above 70 is commonly read as overbought, below 30 as oversold). Only ONE_DAY is supported (computed from stored daily candles); other intervals are rejected. Get symboltoken from search_instruments first. Read-only; does not place trades.",
    inputSchema: {
        exchange: z.enum(["NSE", "BSE"])
        .describe("Exchange of the instrument: NSE or BSE"),
        symboltoken: z.string().trim().min(1)
        .describe("Angel One instrument token from search_instruments, e.g. 1333"),
        interval: z.enum(CANDLE_INTERVALS).describe("Candle size; only ONE_DAY is supported for stored-candle indicators"),
        period: z.number().int().min(2).max(100)
        .describe("RSI period, commonly 14"),
    },
    annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
    },
    },

    calculate_macd: {
    title: "Calculate MACD",
    description:
        "Calculate the latest MACD (Moving Average Convergence Divergence) of closing prices for one instrument, as of the most recent completed trading day. Reads a warm-up window of slowPeriod x 5 + signalPeriod trading days of stored daily candles. Returns the MACD line, signal line, and histogram (positive histogram means MACD is above signal). Defaults are the standard 12, 26, 9. fastPeriod must be smaller than slowPeriod. Only ONE_DAY is supported (computed from stored daily candles); other intervals are rejected. Get symboltoken from search_instruments first. Read-only; does not place trades.",
    inputSchema: {
        exchange: z.enum(["NSE", "BSE"])
        .describe("Exchange of the instrument: NSE or BSE"),
        symboltoken: z.string().trim().min(1)
        .describe("Angel One instrument token from search_instruments, e.g. 1333"),
        interval: z.enum(CANDLE_INTERVALS).describe("Candle size; only ONE_DAY is supported for stored-candle indicators"),
        fastPeriod: z.number().int().min(1).max(100).default(12)
        .describe("Fast EMA period, default 12. Must be smaller than slowPeriod"),
        slowPeriod: z.number().int().min(2).max(100).default(26)
        .describe("Slow EMA period, default 26"),
        signalPeriod: z.number().int().min(1).max(100).default(9)
        .describe("Signal line EMA period, default 9"),
    },
    annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
    },
    },

    calculate_atr: {
    title: "Calculate ATR",
    description:
        "Calculate the latest Average True Range (ATR) for one instrument, as of the most recent completed trading day. ATR measures volatility in price units (rupees) using high, low, and previous close with Wilder's smoothing. Reads a warm-up window of period x 5 + 1 trading days of stored daily candles. Default period is 14. Only ONE_DAY is supported (computed from stored daily candles); other intervals are rejected. Get symboltoken from search_instruments first. Read-only; does not place trades.",
    inputSchema: {
        exchange: z.enum(["NSE", "BSE"])
        .describe("Exchange of the instrument: NSE or BSE"),
        symboltoken: z.string().trim().min(1)
        .describe("Angel One instrument token from search_instruments, e.g. 1333"),
        interval: z.enum(CANDLE_INTERVALS).describe("Candle size; only ONE_DAY is supported for stored-candle indicators"),
        period: z.number().int().min(1).max(100).default(14)
        .describe("ATR period, default 14"),
    },
    annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
    },
    },

    calculate_support_resistance: {
    title: "Calculate Support and Resistance",
    description:
        "Find support and resistance price zones for one instrument from swing highs and lows. A swing high or low must be higher or lower than leftBars candles before and rightBars candles after it, so the most recent rightBars candles cannot form swings. Nearby swing points within tolerancePercent are merged into zones with a touch count and last-touched time. Returns the latest close, nearest support below it, nearest resistance above it, and full lists sorted by distance. Lookback is counted in trading days. Only ONE_DAY is supported (computed from stored daily candles); other intervals are rejected. Get symboltoken from search_instruments first. Read-only; does not place trades.",
    inputSchema: {
        exchange: z.enum(["NSE", "BSE"])
        .describe("Exchange of the instrument: NSE or BSE"),
        symboltoken: z.string().trim().min(1)
        .describe("Angel One instrument token from search_instruments, e.g. 1333"),
        interval: z.enum(CANDLE_INTERVALS).default("ONE_DAY").describe("Candle size, default ONE_DAY; only ONE_DAY is supported"),
        lookbackCandles: z.number().int().min(20).max(1000).default(250)
        .describe("Number of past trading days to analyse, default 250 (about 1 year)"),
        leftBars: z.number().int().min(1).max(20).default(5)
        .describe("Candles before a swing that must be lower/higher, default 5"),
        rightBars: z.number().int().min(1).max(20).default(5)
        .describe("Candles after a swing that confirm it, default 5"),
        tolerancePercent: z.number().gt(0).max(10).default(1)
        .describe("Swing points within this percent are merged into one zone, default 1"),
    },
    annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
    },
    },

    get_52_week_high_low: {
    title: "Get 52-Week High and Low",
    description:
        "Get the 52-week high and low for one instrument from daily Angel One candles covering the last 52 weeks (364 calendar days). Returns the highest daily high, the lowest daily low, the latest close (most recent completed trading day), and the percentage distance of the close from each. Prices are as returned by Angel One and may not be adjusted for splits or bonuses. Get symboltoken from search_instruments first. Read-only; does not place trades.",
    inputSchema: {
        exchange: z.enum(["NSE", "BSE"])
        .describe("Exchange of the instrument: NSE or BSE"),
        symboltoken: z.string().trim().min(1)
        .describe("Angel One instrument token from search_instruments, e.g. 1333"),
    },
    annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
    },
    },

    calculate_volume_average: {
    title: "Calculate Volume Average",
    description:
        "Calculate the average traded volume over the last 'period' candles for one instrument, and compare the latest candle's volume to it. Returns latest volume, average volume, and relative volume (latest divided by average; above 1 means higher than usual activity). Uses candles up to the most recent completed trading day. Default period is 20. Only ONE_DAY is supported (computed from stored daily candles); other intervals are rejected. Get symboltoken from search_instruments first. Read-only; does not place trades.",
    inputSchema: {
        exchange: z.enum(["NSE", "BSE"])
        .describe("Exchange of the instrument: NSE or BSE"),
        symboltoken: z.string().trim().min(1)
        .describe("Angel One instrument token from search_instruments, e.g. 1333"),
        interval: z.enum(CANDLE_INTERVALS).describe("Candle size; only ONE_DAY is supported for stored-candle indicators"),
        period: z.number().int().min(1).max(200).default(20)
        .describe("Number of candles to average, default 20"),
    },
    annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
    },
    },

    calculate_all_indicators: {
    title: "Calculate All Indicators",
    description:
        "Calculate a full technical snapshot for one instrument in one call: SMA and EMA (10, 20, 50, 200), RSI, MACD (12, 26, 9), ATR, volume average with relative volume, 52-week high and low (last 364 calendar days), and support/resistance zones. Period applies to RSI, ATR, and volume average (default 14). Uses candles up to the most recent completed trading day. Only ONE_DAY is supported (computed from stored daily candles); other intervals are rejected. Get symboltoken from search_instruments first. Use the single indicator tools instead when you need custom periods. Read-only; does not place trades.",
    inputSchema: {
        exchange: z.enum(["NSE", "BSE"])
        .describe("Exchange of the instrument: NSE or BSE"),
        symboltoken: z.string().trim().min(1)
        .describe("Angel One instrument token from search_instruments, e.g. 1333"),
        interval: z.enum(CANDLE_INTERVALS).default("ONE_DAY").describe("Candle size, default ONE_DAY; only ONE_DAY is supported"),
        period: z.number().int().min(2).max(100).default(14)
        .describe("Period for RSI, ATR, and volume average, default 14"),
    },
    annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
    },
    },

    bulk_indicators_scanner: {
    title: "Bulk Indicators Scanner",
    description:
        "Scan every stock in an NSE index (NIFTY 50 or NIFTY 500) and return one compact row of daily indicators per stock: close, SMA and EMA (10, 20, 50, 200), RSI, MACD line/signal/histogram, ATR, relative volume, 52-week high/low with distance %, and nearest support/resistance. Uses daily candles stored in the database. Results are paginated with offset and limit, sorted by symbol; the scan is cached for 15 minutes so fetching further pages is fast. Stocks without enough candle history are listed in failedStocks with the reason. Use calculate_all_indicators for full detail on one stock. Read-only; does not place trades.",
    inputSchema: {
        index: z.enum(["NIFTY 50", "NIFTY 500"]).default("NIFTY 500")
        .describe("Index to scan, default NIFTY 500"),
        period: z.number().int().min(2).max(100).default(14)
        .describe("Period for RSI, ATR, and volume average, default 14"),
        offset: z.number().int().min(0).default(0)
        .describe("Number of stocks to skip (sorted by symbol), default 0"),
        limit: z.number().int().min(1).max(100).default(50)
        .describe("Number of stocks to return per page, default 50, max 100"),
    },
    annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
    },
    },

    get_candle_freshness: {
    title: "Get Candle Data Freshness",
    description:
        "Check how fresh the stored daily candles are for an NSE index (NIFTY 50 or NIFTY 500). Returns the date the latest candle should have (today only after 15:30 IST plus a buffer, otherwise the previous trading day), the newest and oldest last-candle dates across the index, counts of up-to-date, stale and missing symbols, and the stale symbols (oldest first, with their last candle date). Use before trusting scan results; if many symbols are stale, the daily candle update has not run. Reads the database only; does not call the broker or place trades.",
    inputSchema: {
        index: z.enum(["NIFTY 50", "NIFTY 500"]).default("NIFTY 500")
        .describe("Index to check, default NIFTY 500"),
        staleListLimit: z.number().int().min(1).max(500).default(50)
        .describe("Maximum stale symbols to list, default 50"),
    },
    annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
    },
    },
} as const;