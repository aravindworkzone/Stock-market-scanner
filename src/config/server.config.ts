import { z } from "zod";

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
        description: "Search the local Angel One instrument master by company name or trading symbol on NSE or BSE. Case-insensitive, spaces ignored ('HDFC BANK' matches 'HDFCBANK'), partial matches allowed. Returns all matching instruments, so use a specific query. Use this to find the exact symbol and token before calling other market tools. Read-only; does not place trades or fetch live prices.",
        inputSchema: {
            query: z.string().trim().min(1).max(100)
                .describe("Stock name or trading symbol, e.g. HDFC BANK"),
            exchange: z.enum(["NSE", "BSE"])
                .describe("Exchange to search: NSE or BSE"),
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
            interval: z.enum([
                "ONE_MINUTE", "THREE_MINUTE", "FIVE_MINUTE", "TEN_MINUTE",
                "FIFTEEN_MINUTE", "THIRTY_MINUTE", "ONE_HOUR", "ONE_DAY",
            ]).describe("Candle size, e.g. FIVE_MINUTE or ONE_DAY"),
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
            "Calculate the Simple Moving Average (SMA) of closing prices for one instrument. Uses 'period' trading days (weekends and holidays skipped, the given date itself excluded) taken backward or forward from 'date', fetches candles from Angel One, and returns the SMA series plus the latest value. Best with ONE_DAY interval. Get symboltoken from search_instruments first. Fails if fewer than 'period' candles are available. Read-only; does not place trades.",
        inputSchema: {
            exchange: z.enum(["NSE", "BSE"])
                .describe("Exchange of the instrument: NSE or BSE"),
            symboltoken: z.string().trim().min(1)
                .describe("Angel One instrument token from search_instruments, e.g. 1333"),
            interval: z.enum([
                "ONE_MINUTE", "THREE_MINUTE", "FIVE_MINUTE", "TEN_MINUTE",
                "FIFTEEN_MINUTE", "THIRTY_MINUTE", "ONE_HOUR", "ONE_DAY",
            ]).describe("Candle size, e.g. ONE_DAY"),
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
        "Calculate the latest Exponential Moving Average (EMA) of closing prices for one instrument, as of the most recent completed trading day. Fetches candles for a warm-up window of period x 5 trading days from Angel One, seeds with the SMA of the first 'period' candles, then applies smoothing 2/(period+1). Returns only the latest EMA value. Best with ONE_DAY interval. Get symboltoken from search_instruments first. Read-only; does not place trades.",
    inputSchema: {
        exchange: z.enum(["NSE", "BSE"])
        .describe("Exchange of the instrument: NSE or BSE"),
        symboltoken: z.string().trim().min(1)
        .describe("Angel One instrument token from search_instruments, e.g. 1333"),
        interval: z.enum([
        "ONE_MINUTE", "THREE_MINUTE", "FIVE_MINUTE", "TEN_MINUTE",
        "FIFTEEN_MINUTE", "THIRTY_MINUTE", "ONE_HOUR", "ONE_DAY",
        ]).describe("Candle size, e.g. ONE_DAY"),
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
        "Calculate the latest Relative Strength Index (RSI) of closing prices for one instrument, as of the most recent completed trading day. Uses Wilder's smoothing over a warm-up window of period x 5 trading days from Angel One. Returns a value from 0 to 100 (above 70 is commonly read as overbought, below 30 as oversold). Best with ONE_DAY interval. Get symboltoken from search_instruments first. Read-only; does not place trades.",
    inputSchema: {
        exchange: z.enum(["NSE", "BSE"])
        .describe("Exchange of the instrument: NSE or BSE"),
        symboltoken: z.string().trim().min(1)
        .describe("Angel One instrument token from search_instruments, e.g. 1333"),
        interval: z.enum([
        "ONE_MINUTE", "THREE_MINUTE", "FIVE_MINUTE", "TEN_MINUTE",
        "FIFTEEN_MINUTE", "THIRTY_MINUTE", "ONE_HOUR", "ONE_DAY",
        ]).describe("Candle size, e.g. ONE_DAY"),
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
        "Calculate the latest MACD (Moving Average Convergence Divergence) of closing prices for one instrument, as of the most recent completed trading day. Fetches a warm-up window of slowPeriod x 5 + signalPeriod trading days from Angel One. Returns the MACD line, signal line, and histogram (positive histogram means MACD is above signal). Defaults are the standard 12, 26, 9. fastPeriod must be smaller than slowPeriod. Best with ONE_DAY interval. Get symboltoken from search_instruments first. Read-only; does not place trades.",
    inputSchema: {
        exchange: z.enum(["NSE", "BSE"])
        .describe("Exchange of the instrument: NSE or BSE"),
        symboltoken: z.string().trim().min(1)
        .describe("Angel One instrument token from search_instruments, e.g. 1333"),
        interval: z.enum([
        "ONE_MINUTE", "THREE_MINUTE", "FIVE_MINUTE", "TEN_MINUTE",
        "FIFTEEN_MINUTE", "THIRTY_MINUTE", "ONE_HOUR", "ONE_DAY",
        ]).describe("Candle size, e.g. ONE_DAY"),
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
        "Calculate the latest Average True Range (ATR) for one instrument, as of the most recent completed trading day. ATR measures volatility in price units (rupees) using high, low, and previous close with Wilder's smoothing. Fetches a warm-up window of period x 5 + 1 trading days from Angel One. Default period is 14. Best with ONE_DAY interval. Get symboltoken from search_instruments first. Read-only; does not place trades.",
    inputSchema: {
        exchange: z.enum(["NSE", "BSE"])
        .describe("Exchange of the instrument: NSE or BSE"),
        symboltoken: z.string().trim().min(1)
        .describe("Angel One instrument token from search_instruments, e.g. 1333"),
        interval: z.enum([
        "ONE_MINUTE", "THREE_MINUTE", "FIVE_MINUTE", "TEN_MINUTE",
        "FIFTEEN_MINUTE", "THIRTY_MINUTE", "ONE_HOUR", "ONE_DAY",
        ]).describe("Candle size, e.g. ONE_DAY"),
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
        "Find support and resistance price zones for one instrument from swing highs and lows. A swing high or low must be higher or lower than leftBars candles before and rightBars candles after it, so the most recent rightBars candles cannot form swings. Nearby swing points within tolerancePercent are merged into zones with a touch count and last-touched time. Returns the latest close, nearest support below it, nearest resistance above it, and full lists sorted by distance. Lookback is counted in trading days. Best with ONE_DAY interval. Get symboltoken from search_instruments first. Read-only; does not place trades.",
    inputSchema: {
        exchange: z.enum(["NSE", "BSE"])
        .describe("Exchange of the instrument: NSE or BSE"),
        symboltoken: z.string().trim().min(1)
        .describe("Angel One instrument token from search_instruments, e.g. 1333"),
        interval: z.enum([
        "ONE_MINUTE", "THREE_MINUTE", "FIVE_MINUTE", "TEN_MINUTE",
        "FIFTEEN_MINUTE", "THIRTY_MINUTE", "ONE_HOUR", "ONE_DAY",
        ]).default("ONE_DAY").describe("Candle size, default ONE_DAY"),
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
        "Calculate the average traded volume over the last 'period' candles for one instrument, and compare the latest candle's volume to it. Returns latest volume, average volume, and relative volume (latest divided by average; above 1 means higher than usual activity). Uses candles up to the most recent completed trading day. Default period is 20. Best with ONE_DAY interval. Get symboltoken from search_instruments first. Read-only; does not place trades.",
    inputSchema: {
        exchange: z.enum(["NSE", "BSE"])
        .describe("Exchange of the instrument: NSE or BSE"),
        symboltoken: z.string().trim().min(1)
        .describe("Angel One instrument token from search_instruments, e.g. 1333"),
        interval: z.enum([
        "ONE_MINUTE", "THREE_MINUTE", "FIVE_MINUTE", "TEN_MINUTE",
        "FIFTEEN_MINUTE", "THIRTY_MINUTE", "ONE_HOUR", "ONE_DAY",
        ]).describe("Candle size, e.g. ONE_DAY"),
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
        "Calculate a full technical snapshot for one instrument in one call: SMA and EMA (10, 20, 50), RSI, MACD (12, 26, 9), ATR, volume average with relative volume, 52-week high and low, and support/resistance zones. Period applies to RSI, ATR, and volume average (default 14). Uses candles up to the most recent completed trading day. Best with ONE_DAY interval. Get symboltoken from search_instruments first. Use the single indicator tools instead when you need custom periods. Read-only; does not place trades.",
    inputSchema: {
        exchange: z.enum(["NSE", "BSE"])
        .describe("Exchange of the instrument: NSE or BSE"),
        symboltoken: z.string().trim().min(1)
        .describe("Angel One instrument token from search_instruments, e.g. 1333"),
        interval: z.enum([
        "ONE_MINUTE", "THREE_MINUTE", "FIVE_MINUTE", "TEN_MINUTE",
        "FIFTEEN_MINUTE", "THIRTY_MINUTE", "ONE_HOUR", "ONE_DAY",
        ]).default("ONE_DAY").describe("Candle size, default ONE_DAY"),
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
} as const;